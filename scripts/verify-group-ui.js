import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

assert.ok(html.includes('document.createTextNode("到场概率 ")'));
assert.doesNotMatch(html, /document\.createTextNode\("成局概率 "\)/);
assert.ok(html.includes('`${today}${formatRuleWeekdaySuffix(today)}   当前成局概率 ${todayPercent}%'));
assert.match(html, /\.shake-people-summary \{[^}]*white-space: pre-wrap/);
assert.ok(html.includes("模型每天北京时间12:05自动训练"));
assert.doesNotMatch(html, /document\.createTextNode\("预计到场 "\)/);

const probabilityIndex = html.indexOf('id="groupProbability"');
const trialIndex = html.indexOf('id="attemptTrialModeBtn"');
const shakeIndex = html.indexOf('id="shakePeopleBtn"');
const pasteIndex = html.indexOf('id="pasteInputBtn"');
const levelModeIndex = html.indexOf('id="levelDisplayModeBtn"');
assert.ok(trialIndex > 0 && trialIndex < probabilityIndex && probabilityIndex < shakeIndex && shakeIndex < pasteIndex);
assert.match(html, /id="attemptTrialModeBtn"[^>]*aria-label="试算模式"[^>]*aria-pressed="false"[^>]*>\s*<i data-lucide="flask-conical"/);
assert.match(html, /id="shakePeopleBtn"[^>]*aria-label="摇人"[^>]*title="摇人"[^>]*>\s*<i data-lucide="dices"/);
assert.match(html, /id="pasteInputBtn"[^>]*aria-label="一键粘贴"[^>]*title="一键粘贴"[^>]*>\s*<i data-lucide="clipboard-paste"/);
assert.match(html, /id="levelDisplayModeBtn"[^>]*class="chain-icon-btn"[^>]*aria-label="精确等级显示，切换为分组"[^>]*aria-pressed="false"[^>]*>\s*<i data-lucide="arrow-left-right"/);
assert.doesNotMatch(html.slice(shakeIndex, pasteIndex), /🎲|摇人<\/button>/);
assert.ok(levelModeIndex > pasteIndex);
assert.doesNotMatch(html, /levelDisplayModeBtn\.textContent/);
assert.match(html, /levelDisplayModeBtn\.setAttribute\(\s*"aria-label",\s*grouped \? "分组显示，切换为精确等级" : "精确等级显示，切换为分组"/);
assert.match(html, /今天组局成功的概率：--%<\/span>\s*<span[^>]*>明天组局成功的概率：--%/);
assert.match(html, /\.group-probability-wrap:hover \.group-probability-tooltip/);
assert.match(html, /\.group-probability-wrap:focus-within \.group-probability-tooltip/);
assert.doesNotMatch(html, /id="attemptTrialToggle"|后续名单为试算/);
assert.match(html, /id="shakeGenderFilter" class="shake-filter-select"/);
assert.match(html, /id="shakeLevelFilter" class="shake-filter-select"/);
assert.match(html, /id="shakeFilterReset" class="shake-filter-reset"[^>]*hidden/);
assert.match(html, /shakeFilters: \{ gender: "", levelGroup: "" \}/);
assert.match(html, /function filterShakePeopleRecommendations\(recommendations\)/);
assert.match(html, /trainingState: observation\.trainingState/);
assert.match(html, /chainInputUserOwned/);
assert.match(html, /attemptTrackingObservation\.trainingState = state\.attemptTrialRequested/);
assert.match(html, /includeCandidates: true/);
assert.match(html, /location\.pathname\.includes\("\/badminton-navigation-homepage\/"\)/);
assert.match(html, /activeGroupDate !== date[\s\S]*els\.chainInput\.value = ""[\s\S]*processChain\(\)/);
assert.match(html, /\.nav-preview \.modal-backdrop\.nav-page \.chain-dialog[\s\S]*grid-template-rows: minmax\(0, 1fr\)/);
assert.match(html, /function hasUnparenthesizedLockMarker\(value\)[\s\S]*outsideParentheses[\s\S]*includes\("锁车"\)/);

assert.match(html, /BadmintonGroupProbability/);
assert.match(html, /groupLearningSignals: state\.groupLearningSignals/);
assert.match(html, /scheduleGroupForecastRender\(\)/);
assert.match(html, /scheduleGroupAttemptSnapshot\("input"\)/);
assert.match(html, /scheduleGroupAttemptSnapshot\("paste"\)/);
assert.match(html, /scheduleGroupAttemptSnapshot\("companion"\)/);
assert.match(html, /scheduleGroupAttemptSnapshot\("rule_change"\)/);
assert.match(html, /knownPlayerIds/);
assert.match(html, /companionsByOwner/);
assert.match(html, /currentParticipantCount/);
assert.match(html, /className = "shake-person-action shake-person-add"/);
assert.match(html, /className = "shake-person-action shake-person-bottom"/);
assert.match(html, /actions\.append\(addButton, bottomButton\);\s*heading\.append\(actions, name\);/);
assert.match(html, /bottomIcon\.setAttribute\("data-lucide", isBottomed \? "arrow-up-from-line" : "arrow-down-to-line"\)/);
assert.match(html, /shakeBottomedPlayerIds: new Set\(\)/);
assert.match(html, /state\.shakeBottomedPlayerIds\.clear\(\)/);
assert.match(html, /addShakePersonToChain\(item\.player, \{ focusNext: event\.detail === 0 \}\)/);
assert.match(html, /scheduleGroupAttemptSnapshot\("input"\);[\s\S]*renderShakePeopleModal\(\);/);
assert.doesNotMatch(html, /rawClipboard|chainInput\.value[^\n]*features/);

const toggleBottomStart = html.indexOf("function toggleShakePersonBottom(");
const toggleBottomEnd = html.indexOf("\n    function appendMemberToChainInput(", toggleBottomStart);
assert.ok(toggleBottomStart >= 0 && toggleBottomEnd > toggleBottomStart, "Expected shake bottom toggle");
const toggleBottomSource = html.slice(toggleBottomStart, toggleBottomEnd);
assert.match(toggleBottomSource, /renderShakePeopleSummary\(recommendations\);\s*renderShakePeopleList\(recommendations\);/);
assert.doesNotMatch(toggleBottomSource, /renderShakePeopleModal\(\)/);

const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
assert.ok(inlineScripts.length > 0, "Expected an inline application script");
for (const script of inlineScripts) new vm.Script(script[1]);

const orderRecommendationsStart = html.indexOf("function shakeProbabilityValue(");
const orderRecommendationsEnd = html.indexOf("\n    function renderShakePeopleList(", orderRecommendationsStart);
assert.ok(orderRecommendationsStart >= 0 && orderRecommendationsEnd > orderRecommendationsStart, "Expected shake ordering helper");
const orderRecommendationsContext = vm.createContext({});
vm.runInContext(`
${html.slice(orderRecommendationsStart, orderRecommendationsEnd)}
globalThis.orderShakePeopleRecommendations = orderShakePeopleRecommendations;
`, orderRecommendationsContext);
const orderedRecommendations = orderRecommendationsContext.orderShakePeopleRecommendations([
  { player: { id: 1 } },
  { player: { id: 2 } },
  { player: { id: 3 } },
], [2]);
assert.equal(orderedRecommendations.map((item) => item.player.id).join(","), "1,3,2");

// Small predictions stay honest; no fabricated minimum percentage or false impossibility.
const display = orderRecommendationsContext.formatShakeAttendanceProbability;
assert.equal(display(0.62439), "62.4%");
assert.equal(display(0.5), "50%");
assert.equal(display(0.99999), "超过99.9%");
assert.equal(display(0.008), "0.8%");
assert.equal(display(0.012), "1.2%");
assert.equal(display(0.0002), "不足0.1%");
assert.equal(display(0), "0%");
assert.equal(display(1), "100%");
for (const invalid of [null, undefined, "", "0.5", NaN, Infinity, -0.1, 1.1]) {
  assert.equal(display(invalid), "暂无估算");
}
const rankItems = [
  { player: { id: 1 }, attendanceProbability: 0.008, uplift: 0.025 },
  { player: { id: 2 }, attendanceProbability: 0.012, uplift: 0.008 },
  { player: { id: 3 }, attendanceProbability: 0.012, uplift: 0.033 },
  { player: { id: 4 }, attendanceProbability: 0, uplift: 0.05 },
  { player: { id: 5 }, attendanceProbability: null, uplift: null },
];
const order = orderRecommendationsContext.orderShakePeopleRecommendations;
const ids = (items) => items.map((item) => item.player.id).join(",");
assert.equal(ids(order(rankItems, [], "attendanceProbability")), "3,2,1,4,5");
assert.equal(ids(order(rankItems, [], "uplift")), "4,3,1,2,5");
assert.equal(ids(order(rankItems, [3, 4], "attendanceProbability")), "2,1,5,3,4");
assert.equal(ids(order(rankItems, [3, 4], "uplift")), "1,2,5,4,3");
assert.equal(ids(rankItems), "1,2,3,4,5", "sorting must not mutate model recommendations");
const ties = [6, 7, 8].map((id) => ({ player: { id }, attendanceProbability: 0.01, uplift: 0.02 }));
assert.equal(ids(order(ties, [])), "6,7,8", "equal probabilities preserve stable order");
assert.equal(order([], []).length, 0);
assert.doesNotMatch(html, /相对较高|相对中等|到场倾向|shakeAttendanceRange/);
assert.match(html, /attendanceValue.textContent = formatShakeAttendanceProbability\(item.attendanceProbability\)/);
assert.match(html, /id="shakeSortBtn"[^>]*aria-controls="shakePeopleList"/);
assert.match(html, /els\.shakeSortBtn\.addEventListener\("click", toggleShakePeopleSort\)/);
// Attendance is informational text, not an expandable action.
assert.ok(html.includes("到场概率根据此人和已接龙人员亲密度、近期出勤率、喜欢周几打、喜欢多少人打、体力是否支持连打（昨天前天是否有打）计算得出，仅供参考。"));
assert.match(html, /const attendance = document\.createElement\("span"\);/);
assert.doesNotMatch(html, /attendance\.(?:addEventListener|setAttribute)|attendance\.(?:type|title)\s*=/);
assert.doesNotMatch(html, /attendanceDetail|shake-attendance-detail|点击百分比|点击查看到场概率/);
const attendanceCss = html.match(/\.shake-person-attendance \{([^}]*)\}/)?.[1];
assert.ok(attendanceCss, "Expected attendance text styling");
assert.doesNotMatch(attendanceCss, /text-decoration|text-underline-offset|cursor:\s*pointer/);
assert.doesNotMatch(html, /\.shake-person-attendance:(?:hover|focus-visible)/);
assert.match(html, /event\.target\.closest\("button, \.shake-person-attendance"\)/);
assert.doesNotMatch(html, /probabilityPercent\(item\.attendanceProbability\)/);

const toggleStart = html.indexOf("function syncShakePeopleSort(");
const toggleEnd = html.indexOf("\n    function renderShakePeopleModal(", toggleStart);
const button = { setAttribute(key, value) { this[key] = value; } };
const sortState = { shakeSortMode: "attendanceProbability", shakeRecommendations: rankItems };
let rendered = null;
const toggleContext = vm.createContext({
  state: sortState,
  els: { shakeSortLabel: {}, shakeSortBtn: button },
  filterShakePeopleRecommendations: (items) => items,
  buildShakePeopleRecommendations: () => { throw new Error("sort must not recompute the forecast"); },
  getBeijingDateString: () => "2026-10-19",
  renderShakePeopleList: (items) => { rendered = items; },
});
vm.runInContext(html.slice(toggleStart, toggleEnd), toggleContext);
toggleContext.toggleShakePeopleSort();
assert.equal(sortState.shakeSortMode, "uplift");
assert.equal(toggleContext.els.shakeSortLabel.textContent, "成局概率");
assert.match(button["aria-label"], /成局概率提升从高到低/);
assert.equal(rendered, rankItems);
toggleContext.toggleShakePeopleSort();
assert.equal(sortState.shakeSortMode, "attendanceProbability");
assert.equal(toggleContext.els.shakeSortLabel.textContent, "到场概率");

// Member rows permanently show attendance only; no dormant impact control or state remains.
assert.doesNotMatch(html, /shakeImpactToggle|shakeImpactVisible|syncShakeImpactVisibility|toggleShakeImpactVisibility|shake-person-impact|shake-impact-visible-icon|shake-impact-hidden-icon|data-show-impact|formatProbabilityPointLift/);
assert.doesNotMatch(html, /显示成局概率|隐藏成局概率/);
const summaryActions = html.match(/<div class="shake-summary-actions">([\s\S]*?)<\/div>/)?.[1];
assert.ok(summaryActions, "shake toolbar remains available");
assert.deepEqual([...summaryActions.matchAll(/<button id="([^"]+)"/g)].map((match) => match[1]), [
  "shakeSortBtn", "shakeFiltersToggle",
], "only the existing sort and filter controls remain in the toolbar");
for (const target of ["../public/index.html", "../src/index.html"]) {
  assert.equal(readFileSync(new URL(target, import.meta.url), "utf8").replaceAll("\r\n", "\n"),
    html.replaceAll("\r\n", "\n"), target + " must ship the same attendance-only UI");
}

assert.match(html, /state\.shakeRecommendations = allRecommendations;\s*syncShakePeopleSort\(\);\s*const recommendations = filterShakePeopleRecommendations/);
assert.match(html, /id="shakePeopleList"[^>]*aria-describedby="shakeProbabilityNote"/);

// Execute the real renderer so recommendations with valid, zero and missing uplift
// cannot accidentally bring back a second metric after sorting, filtering or reopening.
class RenderNode {
  constructor(tagName = null) {
    this.tagName = tagName;
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.listeners = {};
    this.className = "";
    this.ownText = "";
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(name, listener) { this.listeners[name] = listener; }
  set textContent(value) { this.ownText = value; this.children = []; }
  get textContent() { return this.ownText + this.children.map((node) => node.textContent).join(""); }
  get childElementCount() { return this.children.filter((node) => node.tagName).length; }
}
const memberList = new RenderNode("div");
const rowActions = [];
const renderState = { chainEntries: [], shakeBottomedPlayerIds: new Set([2]), shakeSortMode: "attendanceProbability" };
const rendererContext = vm.createContext({
  state: renderState,
  els: { shakePeopleList: memberList },
  document: {
    createElement: (tagName) => new RenderNode(tagName),
    createTextNode: (text) => Object.assign(new RenderNode(), { textContent: text }),
  },
  window: {},
  firstName: (name) => name,
  normalizePlayerId: Number,
  getMemberStatistics: () => ({}),
  getBeijingDateString: () => "2026-10-26",
  getShakeRecommendationBadges: () => [{ text: "近期常打", risk: false }],
  orderShakePeopleRecommendations: order,
  formatShakeAttendanceProbability: display,
  addShakePersonToChain: (player, options) => rowActions.push({ action: "add", id: player.id, options }),
  toggleShakePersonBottom: (player, recommendations, options) => rowActions.push({ action: "bottom", id: player.id, options }),
  createQuickTodayRule: (player) => rowActions.push({ action: "skip", id: player.id }),
});
const renderListStart = html.indexOf("function renderShakePeopleList(");
const renderListEnd = html.indexOf("\n    function toggleShakePersonBottom(", renderListStart);
assert.ok(renderListStart >= 0 && renderListEnd > renderListStart);
vm.runInContext(html.slice(renderListStart, renderListEnd), rendererContext);
const rowItems = [
  { player: { id: 1, name: "甲" }, attendanceProbability: 0.67, uplift: 0.33 },
  { player: { id: 2, name: "乙" }, attendanceProbability: 0.624, uplift: 0 },
  { player: { id: 3, name: "丙" }, attendanceProbability: null, uplift: null },
];
const originalRowItems = JSON.stringify(rowItems);
for (const mode of ["attendanceProbability", "uplift"]) {
  renderState.shakeSortMode = mode;
  rendererContext.renderShakePeopleList(rowItems);
  assert.equal(memberList.children.length, rowItems.length);
  assert.doesNotMatch(memberList.textContent, /成局概率|\+33%/);
  for (const row of memberList.children) {
    const score = row.children.find((node) => node.className === "shake-person-score");
    assert.equal(score.childElementCount, 1, "each row has only the attendance metric");
    assert.equal(score.children[0].className, "shake-person-attendance");
    assert.match(score.textContent, /^到场概率 (67%|62\.4%|暂无估算)$/);
    assert.equal(row.children.at(-1).className, "shake-person-skip");
  }
}
assert.equal(JSON.stringify(rowItems), originalRowItems, "rendering preserves forecast recommendations");
rendererContext.renderShakePeopleList([rowItems[0]]);
const singleRow = memberList.children[0];
const memberActions = singleRow.children[0].children[0].children[0].children;
assert.equal(memberActions[0].attributes["aria-label"], "将甲加入接龙名单");
assert.equal(memberActions[1].attributes["aria-label"], "置底甲");
const clickEvent = { detail: 0, stopPropagation() {} };
memberActions[0].listeners.click(clickEvent);
memberActions[1].listeners.click(clickEvent);
singleRow.children.at(-1).listeners.click(clickEvent);
assert.equal(rowActions.map(({ action }) => action).join(","), "add,bottom,skip");
assert.ok(rowActions.every(({ id }) => id === 1));
assert.equal(rowActions[0].options.focusNext, true);
assert.equal(rowActions[1].options.focusButton, true);
rendererContext.renderShakePeopleList([]);
assert.equal(memberList.children.length, 1);
assert.equal(memberList.textContent, "暂时没有合适的人可摇");
rendererContext.renderShakePeopleList(rowItems);
assert.equal(memberList.children.length, 3, "reopening restores rows without a visibility setting");
assert.doesNotMatch(memberList.textContent, /成局概率/);

const filterRecommendationsStart = html.indexOf("function filterShakePeopleRecommendations(");
const filterRecommendationsEnd = html.indexOf("\n    function renderShakePeopleList(", filterRecommendationsStart);
assert.ok(filterRecommendationsStart >= 0 && filterRecommendationsEnd > filterRecommendationsStart, "Expected shake filter helper");
const filterRecommendationsContext = vm.createContext({
  state: { shakeFilters: { gender: "女", levelGroup: "高手" } },
  getLevelGroupLabel: (level) => level === "4级" ? "高手" : "不详",
});
vm.runInContext(`
${html.slice(filterRecommendationsStart, filterRecommendationsEnd)}
globalThis.filterShakePeopleRecommendations = filterShakePeopleRecommendations;
`, filterRecommendationsContext);
const filteredRecommendations = filterRecommendationsContext.filterShakePeopleRecommendations([
  { player: { id: 1, gender: "女", level: "4级" } },
  { player: { id: 2, gender: "女", level: "3级" } },
  { player: { id: 3, gender: "男", level: "4级" } },
]);
assert.deepEqual(filteredRecommendations.map((item) => item.player.id), [1]);

const appendMemberStart = html.indexOf("function appendMemberToChainInput(");
const appendMemberEnd = html.indexOf("\n    function addShakePersonToChain(", appendMemberStart);
const sharedParserStart = html.indexOf("function parseSharedChainLevelPrefix(");
const sharedParserEnd = html.indexOf("\n    function getChainInputLines(", sharedParserStart);
assert.ok(appendMemberStart >= 0 && appendMemberEnd > appendMemberStart, "Expected chain append helper");
assert.ok(sharedParserStart >= 0 && sharedParserEnd > sharedParserStart, "Expected shared-chain parser helpers");
const appendMemberContext = vm.createContext({});
vm.runInContext(`
const CHAIN_NUMBER_PREFIX = /^\\s*\\d+\\s*[\\.、\\):：-]\\s*/;
const SHARED_CHAIN_METADATA_PREFIXES = ["组织者", "活动时间", "活动地点", "收费类型", "AA预收费用", "已报名"];
${html.slice(sharedParserStart, sharedParserEnd)}
${html.slice(appendMemberStart, appendMemberEnd)}
globalThis.parseMiniProgramChain = parseMiniProgramChain;
globalThis.appendMemberToChainInput = appendMemberToChainInput;
`, appendMemberContext);
assert.equal(appendMemberContext.appendMemberToChainInput("", "甲"), "1. 甲");
assert.equal(appendMemberContext.appendMemberToChainInput("1. 甲\n3. 乙\n", "丙"), "1. 甲\n3. 乙\n4. 丙");
assert.equal(appendMemberContext.appendMemberToChainInput("甲\n乙", "丙"), "甲\n乙\n丙");

const miniProgramInput = `周一   19点  广羽（马安店）
组织者：choi&#x20;
活动时间：09-21 (周一) 19:00 ~ 22:00
活动地点：广羽体育俱乐部（马安店）
收费类型:AA收款(多退少补)
AA预收费用：￥20.00起
已报名：2/21(男2女0)

【场地：1，2 号场】

1、【2.5级】choi
2、【3级】阿达

[庆祝]报名链接：weixin://dl/business/?t=720doSHSe1i
活动开始前可退款，超时费用照A！`;
const parsedMiniProgram = appendMemberContext.parseMiniProgramChain(miniProgramInput);
assert.equal(parsedMiniProgram.outputText, `周一   19点  广羽（马安店）
【场地：1，2 号场】

1、【2.5级】choi
2、【3级】阿达

[庆祝]报名链接：weixin://dl/business/?t=720doSHSe1i`);
assert.match(
  appendMemberContext.appendMemberToChainInput(miniProgramInput, "新球友", "3.5级"),
  /2、【3级】阿达\n3、【3\.5级】新球友\n\n\[庆祝\]报名链接/
);
assert.match(html, /id="chainSpecialOutput"[^>]*aria-label="删减后的活动接龙文本"/);
assert.match(html, /function handleChainInputPaste\(event\)/);
assert.match(html, /copySpecialChainOutput\(\{ automatic: true \}\)/);
assert.match(html, /setChainOutputActionIcon\("copy"\)/);

console.log("Group probability controls, accessibility, tracking triggers, and inline syntax checks passed.");
