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
  "formatShortRuleDate",
  "normalizeShortRuleNote",
  "findPlayerForShortRule",
  "parseShortRuleText",
  "shortRuleDescription",
];
vm.runInContext(`${functionNames.map((name) => extractFunction(indexHtml, name)).join("\n\n")}
globalThis.shortRuleApi = { parseShortRuleText, parseChineseNumber, shortRuleDescription };`, context);

const { parseShortRuleText, parseChineseNumber, shortRuleDescription } = context.shortRuleApi;
const today = "2026-08-31";

const shakePeopleSection = indexHtml.slice(
  indexHtml.indexOf('<div id="shakePeopleModal"'),
  indexHtml.indexOf('<div id="shortRuleModal"'),
);
assert.match(shakePeopleSection, /id="newShortRuleBtn"[^>]*aria-label="新建短期规则"[^>]*>\+<\/button>/);
assert.doesNotMatch(shakePeopleSection, /modal-footer/);
assert.match(indexHtml, /newShortRuleBtn\.addEventListener\("click", \(\) => openShortRuleModal\(\)\)/);
assert.doesNotMatch(indexHtml, /newShortRuleBtn\.addEventListener\("click", openShortRuleModal\)/);

const within = parseShortRuleText("果花 三天内 不打 培训", today);
assert.equal(within.type, "not_within_days");
assert.equal(within.startsOn, today);
assert.equal(within.expiresOn, "2026-09-02");
assert.equal(within.rule.resumeOn, "2026-09-03");
assert.equal(within.rule.note, "培训");
assert.equal(shortRuleDescription(within), "9.3 再打 培训");

const after = parseShortRuleText("果花 15天后 再打 军训", today);
assert.equal(after.expiresOn, "2026-09-14");
assert.equal(after.rule.resumeOn, "2026-09-15");
assert.equal(after.rule.note, "军训");

const nextTuesday = parseShortRuleText("阿达 下周二 再打 加班", today);
assert.equal(nextTuesday.expiresOn, "2026-09-07");
assert.equal(nextTuesday.rule.resumeOn, "2026-09-08");
assert.equal(shortRuleDescription(nextTuesday), "9.8 再打 加班");

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

assert.match(workerSource, /starts_on <= \?/);
assert.match(workerSource, /expires_on >= \?/);
assert.match(workerSource, /COALESCE\(p\.is_companion, 0\) = 0/);
assert.match(workerSource, /DELETE FROM short_term_rules WHERE player_id = \? AND expires_on IS NOT NULL/);
assert.match(workerSource, /findDuplicateWeeklyShortTermRule/);
assert.match(migrationSource, /ADD COLUMN starts_on TEXT/);
assert.match(migrationSource, /date\(created_at, '\+8 hours'\)/);
assert.match(correctionMigrationSource, /starts_on = substr\(created_at, 1, 10\)/);

console.log("Short-term rule parsing, normalization, replacement, and early-return checks passed.");
