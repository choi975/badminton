import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import "../level-groups.js";
const LevelGroups = globalThis.BadmintonLevelGroups;
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const worker = readFileSync(new URL("../src/worker.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const defaults = LevelGroups.normalize(null);
assert.deepEqual(LevelGroups.ranks.map(rank => LevelGroups.getLabel(rank + "级")), ["新手", "新手", "新手", "新手", "中手", "中手", "中手", "高手", "高手", "高手", "比赛级高手", "比赛级高手", "比赛级高手", "比赛级高手"]);
for (const level of [null, "", "不详", "等级不详", "NaN", "3级oops", "0级", "10级"]) assert.equal(LevelGroups.getLabel(level), "不详");
assert.deepEqual(LevelGroups.fromStored("bad json"), defaults);
assert.deepEqual(LevelGroups.fromStored("[]"), defaults);
assert.deepEqual(LevelGroups.fromStored(JSON.stringify(defaults)), defaults);
const groups = [{ name: "入门", min: 0.5, max: 1.5 }, { name: "进阶", min: 2, max: 4 }, { name: "竞赛", min: 6, max: 9 }];
assert.equal(LevelGroups.validate(groups).error, undefined);
assert.equal(LevelGroups.getLabel("2级", groups), "进阶");
assert.equal(LevelGroups.getLabel("4.5级", groups), "未分组");
for (const invalid of [null, [], Array(15).fill(groups[0]), [{ name: "", min: 1, max: 2 }], [{ name: "不详", min: 1, max: 2 }], [{ name: "等级不详", min: 1, max: 2 }], [{ name: "未分组", min: 1, max: 2 }], [{ name: "x".repeat(21), min: 1, max: 2 }], [{ name: "a\nb", min: 1, max: 2 }], [{ name: "a", min: 3, max: 2 }], [{ name: "a", min: 5.5, max: 9 }], [{ name: "a", min: "1", max: 2 }], [{ name: "a", min: null, max: 2 }], [{ name: "A", min: 1, max: 2 }, { name: " a ", min: 3, max: 4 }], [{ name: "a", min: 1, max: 2 }, { name: "b", min: 2, max: 3 }]]) assert.ok(LevelGroups.validate(invalid).error, JSON.stringify(invalid));
assert.deepEqual(LevelGroups.validate([{ name: " 单级 ", min: 4, max: 4 }]).groups, [{ name: "单级", min: 4, max: 4 }]);
assert.equal(LevelGroups.options().find(option => option.label === "新手").level, "2级");
assert.equal(LevelGroups.options().find(option => option.label === "比赛级高手").level, "6级");
assert.equal(LevelGroups.options(groups).find(option => option.label === "进阶").level, "2级");
assert.equal(LevelGroups.options(groups).find(option => option.level === "4.5级").text, "未分组（4.5级）");
assert.equal(LevelGroups.annotationLabels([{ name: "超级高手", min: 8, max: 9 }]).find(([label]) => "超级高手".includes(label))[0], "超级高手");
assert.equal(LevelGroups.annotationLabels(groups).find(([label]) => label === "比赛级高手")[1], "6级", "Old annotations remain supported after a rename");
const entries = LevelGroups.ranks.map(rank => ({ levelText: rank + "级", levelGroupLabel: "stale cached name" })).concat([{ levelText: "不详", levelGroupLabel: "高手" }]);
const stats = LevelGroups.stats(entries, groups);
assert.deepEqual(stats, ["竞赛：4人", "进阶：5人", "入门：3人", "未分组：2人", "等级不详：1人"]);
assert.equal(stats.reduce((total, line) => total + Number(line.match(/：(\d+)人/)[1]), 0), entries.length, "Every person appears in exactly one bucket");
function front(name) {
  const start = html.indexOf("    function " + name + "(");
  assert.ok(start >= 0, name);
  return html.slice(start, html.indexOf("\n    }", start) + 6);
}
const state = { levelGroups: groups, chainLevelMode: "group" };
const context = vm.createContext({ LevelGroups, state, LEVELS: ["不详", ...LevelGroups.ranks.map(rank => rank + "级")] });
vm.runInContext(["getLevelGroupLabel", "getChainLevelDisplay", "buildGroupedLevelStats", "getInlinePlusLevelOptions", "getInlinePlusLevelLabel"].map(front).join("\n"), context);
assert.equal(context.getChainLevelDisplay({ levelText: "2级", levelGroupLabel: "新手" }), "进阶");
assert.equal(context.getInlinePlusLevelLabel({ levelText: "4.5级", levelGroupLabel: "高手" }), "4.5级");
assert.deepEqual(Array.from(context.buildGroupedLevelStats(entries)), stats);
state.chainLevelMode = "exact";
assert.equal(context.getChainLevelDisplay({ levelText: "2级", levelGroupLabel: "新手" }), "2级");
assert.equal(context.getInlinePlusLevelLabel({ levelText: "4.5级", levelGroupLabel: "高手" }), "4.5级");
function backend(name, async = false) {
  const start = worker.indexOf((async ? "async " : "") + "function " + name + "(");
  assert.ok(start >= 0, name);
  return worker.slice(start, worker.indexOf("\n}", start) + 2);
}
const saved = new Map();
let writes = 0;
let rejectWrite = false;
const env = { DB: { prepare(sql) { return {
  bind(value) { this.value = value; return this; },
  async first() { return saved.has("level_groups") ? { value: saved.get("level_groups") } : null; },
  async run() { if (rejectWrite) throw new Error("D1 unavailable"); writes++; saved.set("level_groups", this.value); },
}; } } };
const server = vm.createContext({ LevelGroups, Response, Request, URL, json: (data, status = 200) => Response.json(data, { status }), readJson: request => request.json() });
vm.runInContext([backend("isAdminRequest"), backend("getLevelGroups", true), backend("handleApi", true)].join("\n"), server);
const call = (method, body, origin = "https://badminton.choi975.workers.dev") => {
  const request = new Request("https://badminton.choi975.workers.dev/api/level-groups", { method, headers: { origin, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return server.handleApi(request, env, new URL(request.url));
};
assert.deepEqual((await (await call("GET")).json()).levelGroups, defaults);
assert.equal((await call("PUT", { levelGroups: groups }, "https://choi975.github.io")).status, 403);
assert.equal(writes, 0);
assert.equal((await call("PUT", { levelGroups: [{ name: "a", min: 3, max: 2 }] })).status, 400);
assert.equal(writes, 0);
assert.deepEqual((await (await call("PUT", { levelGroups: groups })).json()).levelGroups, groups);
assert.equal(writes, 1);
assert.deepEqual((await (await call("GET")).json()).levelGroups, groups);
rejectWrite = true;
await assert.rejects(call("PUT", { levelGroups: defaults }), /D1 unavailable/);
assert.deepEqual((await (await call("GET")).json()).levelGroups, groups);
assert.match(worker, /getLevelGroups\(env.DB\)/);
assert.match(worker, /groupLearningSignals,\s+edcBalance,\s+levelGroups,/);
assert.match(html, /id="estimatorAdvancedBtn"[^>]*aria-controls="estimatorAdvancedPanel"/);
assert.match(html, /localStorage.setItem\(LEVEL_GROUPS_LOCAL_KEY/);
assert.match(html, /state.levelGroupsSaving\) return/);
assert.match(html, /panel.querySelector\(".level-group-editor"\) \|\| createLevelGroupEditor/);
console.log("Level groups: defaults, edit validation, boundaries, gaps, stats, stale labels, options, API persistence and read-only protection passed");

// Exercise the production save handler independently of the browser's network.
const saveStart = html.indexOf("    async function saveLevelGroups(");
const saveCode = html.slice(saveStart, html.indexOf("\n    }", saveStart) + 6);
const uiState = { levelGroups: defaults, levelGroupDraft: groups, levelGroupsSaving: false, chainEntries: [{ overrideKey: "guest", levelText: "2级", gender: "女" }], plusOverrides: {} };
const feedback = { dataset: {}, textContent: "" };
const editor = { querySelector: () => ({ focus() {} }) };
let cloud = true;
let requests = 0;
let resolveSave;
let rejectSave;
let processCount = 0;
let localWrites = 0;
let localError = false;
const saveContext = vm.createContext({
  state: uiState, LevelGroups,
  els: { estimatorAdvancedPanel: { querySelector: selector => selector === ".level-group-feedback" ? feedback : editor }, shakePeopleModal: { classList: { contains: () => false } } },
  updateLevelGroupFeedback: () => LevelGroups.validate(uiState.levelGroupDraft),
  usesCloudLevelGroups: () => cloud,
  refreshLevelGroupEditor() {},
  api: () => { requests++; return new Promise((resolve, reject) => { resolveSave = resolve; rejectSave = reject; }); },
  readCachedBootstrap: () => null,
  cacheBootstrap() {},
  renderShakeLevelOptions() {},
  processChain: () => { processCount++; },
  canEditChainEntryLevel: () => true,
  toast() {},
  LEVEL_GROUPS_LOCAL_KEY: "test-groups",
  localStorage: { setItem() { if (localError) throw new Error("storage unavailable"); localWrites++; } },
});
vm.runInContext(saveCode, saveContext);
const firstSave = saveContext.saveLevelGroups();
assert.equal(uiState.levelGroupsSaving, true);
await saveContext.saveLevelGroups();
assert.equal(requests, 1, "Double submit must send only one request");
rejectSave(new Error("network unavailable"));
await firstSave;
assert.equal(uiState.levelGroupsSaving, false);
assert.deepEqual(uiState.levelGroups, defaults);
assert.equal(uiState.levelGroupDraft, groups, "Failed saves must retain the draft");
assert.match(feedback.textContent, /network unavailable/);
assert.equal(processCount, 0);
const retry = saveContext.saveLevelGroups();
resolveSave({ levelGroups: groups });
await retry;
assert.equal(JSON.stringify(uiState.levelGroups), JSON.stringify(groups));
assert.equal(uiState.levelGroupDraft, null);
assert.equal(uiState.plusOverrides.guest.levelText, "2级", "Regrouping preserves the companion's chosen numeric level");
assert.equal(processCount, 1);
cloud = false;
uiState.levelGroupDraft = defaults;
localError = true;
await saveContext.saveLevelGroups();
assert.equal(JSON.stringify(uiState.levelGroups), JSON.stringify(groups));
assert.equal(uiState.levelGroupDraft, defaults);
localError = false;
await saveContext.saveLevelGroups();
assert.equal(localWrites, 1);
assert.equal(requests, 2, "Local mode must not write through the cloud API");
assert.equal(JSON.stringify(uiState.levelGroups), JSON.stringify(defaults));
console.log("Level group editor saves: duplicate guard, failure/retry, draft retention, companion levels and local/cloud isolation passed");
