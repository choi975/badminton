import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const workerSource = readFileSync(new URL("../src/worker.js", import.meta.url), "utf8");
const migrationSource = readFileSync(new URL("../migrations/0014_short_term_rule_starts.sql", import.meta.url), "utf8");
const correctionMigrationSource = readFileSync(new URL("../migrations/0015_fix_short_rule_beijing_starts.sql", import.meta.url), "utf8");

function extractFunction(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Expected ${name} to exist`);
  const next = source.indexOf("\n    function ", start + marker.length);
  return source.slice(start, next === -1 ? source.length : next).trim();
}

const players = [
  { id: 1, name: "果花，花花" },
  { id: 2, name: "海尼克-刘赵达，阿达，达哥" },
];
const context = vm.createContext({
  console,
  Date,
  Intl,
  Number,
  String,
  Set,
  Map,
  Object,
  RegExp,
  buildAliasIndex() {
    return players.flatMap((player) => player.name.split(/[，,]/).map((alias) => ({
      alias: alias.trim(),
      normalized: alias.trim().toLocaleLowerCase(),
      player,
    }))).sort((a, b) => b.alias.length - a.alias.length);
  },
});

const functionNames = [
  "addDaysToIsoDate",
  "getBeijingWeekday",
  "getNextMondayIso",
  "getNextWeekdayIso",
  "isValidIsoDate",
  "getNextMonthDayIso",
  "parseChineseNumber",
  "parseWeekdayNames",
  "formatWeekdayNames",
  "formatRuleWeekdaySuffix",
  "formatShortRuleDate",
  "normalizeShortRuleNote",
  "findPlayerForShortRule",
  "findRuleClauseStart",
  "parseShortRuleText",
  "parseShortRuleTextMultiple",
  "shortRuleSchedule",
  "shortRuleDescription",
];
vm.runInContext(`${functionNames.map((name) => extractFunction(indexHtml, name)).join("\n\n")}
globalThis.shortRuleApi = { parseShortRuleText, parseShortRuleTextMultiple, parseChineseNumber, shortRuleDescription };`, context);

const { parseShortRuleText, parseShortRuleTextMultiple, parseChineseNumber, shortRuleDescription } = context.shortRuleApi;
const today = "2026-08-31";

const shakePeopleSection = indexHtml.slice(
  indexHtml.indexOf('<div id="shakePeopleModal"'),
  indexHtml.indexOf('<div id="shortRuleModal"'),
);
assert.match(shakePeopleSection, /id="newShortRuleBtn"[^>]*aria-label="新建规则"[^>]*>\+<\/button>/);
assert.match(shakePeopleSection, /id="shakeLongTermRulesBlock"/);
assert.match(shakePeopleSection, /id="shakeShortTermRulesBlock"/);
assert.doesNotMatch(shakePeopleSection, /modal-footer/);
assert.match(indexHtml, /newShortRuleBtn\.addEventListener\("click", \(\) => openShortRuleModal\(\)\)/);
assert.doesNotMatch(indexHtml, /newShortRuleBtn\.addEventListener\("click", openShortRuleModal\)/);

const within = parseShortRuleText("果花 三天内 不打 培训", today);
assert.equal(within.type, "not_within_days");
assert.equal(within.startsOn, today);
assert.equal(within.expiresOn, "2026-09-02");
assert.equal(within.rule.resumeOn, "2026-09-03");
assert.equal(within.rule.note, "培训");
assert.equal(shortRuleDescription(within), "9.3（星期四） 再打 培训");

const after = parseShortRuleText("果花 15天后 再打 军训", today);
assert.equal(after.expiresOn, "2026-09-14");
assert.equal(after.rule.resumeOn, "2026-09-15");
assert.equal(after.rule.note, "军训");

const nextTuesday = parseShortRuleText("阿达 下周二 再打 加班", today);
assert.equal(nextTuesday.expiresOn, "2026-09-07");
assert.equal(nextTuesday.rule.resumeOn, "2026-09-08");
assert.equal(shortRuleDescription(nextTuesday), "9.8（星期二） 再打 加班");

const nextMonday = parseShortRuleText("阿达 下周一 再打", today);
assert.equal(nextMonday.rule.resumeOn, "2026-09-07");

const absolute = parseShortRuleText("阿达 9.10 再打", today);
assert.equal(absolute.type, "not_before_date");
assert.equal(absolute.rule.resumeOn, "2026-09-10");
assert.equal(absolute.expiresOn, "2026-09-09");

const crossYear = parseShortRuleText("阿达 1.2 再打", "2026-12-31");
assert.equal(crossYear.rule.resumeOn, "2027-01-02");
const explicitYear = parseShortRuleText("阿达 2027.1.2 再打", today);
assert.equal(explicitYear.rule.resumeOn, "2027-01-02");

const onlyDays = parseShortRuleText("果花 只打 周五、周六 周末限定", today);
assert.deepEqual([...onlyDays.rule.weekdays], [5, 6]);
assert.equal(shortRuleDescription(onlyDays), "只打 周五、周六 周末限定");
const notDays = parseShortRuleText("果花 周五、周六、周日 不打", today);
assert.deepEqual([...notDays.rule.weekdays], [5, 6, 0]);
assert.equal(shortRuleDescription(notDays), "周五、周六、周日 不打");

assert.equal(parseChineseNumber("十五"), 15);
assert.equal(parseChineseNumber("三千六百六十"), 3660);
assert.match(parseShortRuleText("阿达 9.10 不打", today).error, /格式无法识别/);
assert.match(parseShortRuleText("阿达 三天后 不打", today).error, /格式无法识别/);

const multiple = parseShortRuleTextMultiple("果花、阿达 三天内 不打 培训", today);
assert.equal(multiple.rules.length, 2);
assert.equal(multiple.rules[0].rule.note, "培训");
assert.equal(multiple.rules[1].rule.note, "培训");
assert.match(parseShortRuleTextMultiple("果花、阿达、花花、海尼克-刘赵达 周五 不打", today).error, /最多添加三名/);

assert.match(workerSource, /starts_on <= \?/);
assert.match(workerSource, /expires_on >= \?/);
assert.match(workerSource, /COALESCE\(p\.is_companion, 0\) = 0/);
assert.match(workerSource, /DELETE FROM short_term_rules WHERE player_id = \? AND expires_on IS NOT NULL/);
assert.match(workerSource, /findDuplicateWeeklyShortTermRule/);
assert.match(migrationSource, /ADD COLUMN starts_on TEXT/);
assert.match(migrationSource, /date\(created_at, '\+8 hours'\)/);
assert.match(correctionMigrationSource, /starts_on = substr\(created_at, 1, 10\)/);


// Date labels use the activity's calendar day, independent of the browser timezone.
assert.equal(context.formatShortRuleDate("2026-10-18"), "10.18（星期日）");
assert.equal(context.formatShortRuleDate("2026-12-31"), "12.31（星期四）");
assert.equal(context.formatShortRuleDate("2027-01-01"), "1.1（星期五）");
assert.equal(context.formatShortRuleDate("2028-02-29"), "2.29（星期二）");
assert.equal(context.formatShortRuleDate("2026-02-29"), "日期未知");
assert.equal(context.formatRuleWeekdaySuffix(""), "");
assert.equal(context.shortRuleSchedule(crossYear), "1.2（星期六） 再打");
assert.equal(context.shortRuleSchedule(onlyDays), "只打 周五、周六");
for (let day = 18; day <= 24; day += 1) {
  assert.equal(context.formatRuleWeekdaySuffix(`2026-10-${day}`), `（星期${"日一二三四五六"[day - 18]}）`);
}

// Both categorized lists and the rule editor share independent, aligned cells.
class RuleElement {
  constructor(tagName) { this.tagName = tagName; this.children = []; this.listeners = {}; this.textContent = ""; }
  append(...children) { this.children.push(...children); }
  addEventListener(name, handler) { this.listeners[name] = handler; }
}
let deletedRuleId = null;
context.document = { createElement: (tagName) => new RuleElement(tagName) };
context.getPlayerById = (id) => players.find((player) => player.id === id);
context.firstName = (name) => name.split("，")[0];
context.deleteShortRule = (id) => { deletedRuleId = id; };
vm.runInContext(extractFunction(indexHtml, "isLongTermRuleType"), context);
vm.runInContext(extractFunction(indexHtml, "createRuleRow"), context);
const displayRule = { ...within, id: 42 };
const displayRow = context.createRuleRow(displayRule);
assert.deepEqual(displayRow.children.map((cell) => cell.className || cell.tagName), [
  "short-rule-name", "short-rule-schedule", "short-rule-note", "button",
]);
assert.equal(displayRow.children[0].textContent, "果花");
assert.equal(displayRow.children[0].children[0].textContent, "短期");
assert.equal(displayRow.children[1].textContent, "9.3（星期四） 再打");
assert.equal(displayRow.children[2].textContent, "培训");
displayRow.children[3].listeners.click();
assert.equal(deletedRuleId, 42);
const weeklyRow = context.createRuleRow(notDays);
assert.equal(weeklyRow.children[0].children[0].textContent, "长期");
assert.equal(weeklyRow.children[1].textContent, "周五、周六、周日 不打");
assert.equal(weeklyRow.children[2].textContent, "—");
assert.equal(context.createRuleRow({ playerId: 999, rule: { note: "<b>原样显示</b>" } }).children[2].textContent, "<b>原样显示</b>");
assert.equal(context.createRuleRow({ playerId: 999 }).children[0].textContent, "#999");
assert.match(indexHtml, /\.short-rule-row \{\s*display: grid;/);
assert.match(indexHtml, /\.short-rule-note \{ grid-column: 2; grid-row: 2; \}/);

console.log("Short-term rule parsing, aligned display, weekday labels, deletion, and early-return checks passed.");
