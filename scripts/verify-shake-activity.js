import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import "../member-statistics.js";
const core = globalThis.BadmintonMemberStatistics;
const now = "2026-10-23T10:00:00+08:00";
const players = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, name: `成员${i + 1}`, gender: "男", level: "3级" }));
let nextId = 1;
const self = (playerId) => ({ playerId, slots: 1, plusCount: 0 });
const game = (date, ids) => ({ id: nextId++, date, players: [...ids.map(self), { playerId: null, isCompanion: true, slots: 11, plusCount: 11 }] });
const sessions = [
  game("2026-09-22", [1, 10]), // just outside the 30-day window
  game("2026-09-23", [2]), // first included day; one signup is enough for recommendations
  game("2026-10-20", [3, 4, 11]), game("2026-10-20", [3, 4, 11]), // distinct games, same date
  game("2026-10-21", [4]), game("2026-10-22", [9, 10]),
  game("2026-10-12", [12]), game("2026-10-19", [12]), // one per week, twice in 30 days
  game("2026-10-23", [7]), game("2026-10-24", [8]), // today and future do not count as history
  { id: nextId++, date: "2026-10-20", players: [{ playerId: 5, isCompanion: "1", slots: 1 }, { playerId: 6, slots: 2, plusCount: 2 }] },
];
sessions.push(sessions[1]); // duplicated API row, not a second signup
const stats = core.build({ players, sessions, now });
const restricted = (key) => key === "onlyLargeSessions" || key.startsWith("noWeekday") || key.startsWith("weeklyMax");
const byId = new Map(stats.members.map((m) => [m.playerId, m]));
for (const list of stats.lists.filter((l) => restricted(l.key))) {
  assert.ok(list.memberIds.every((id) => byId.get(id).attendance30 >= 2), `${list.key} must exclude zero/one signup members`);
}
assert.equal(byId.get(1).attendance30, 0);
assert.equal(byId.get(2).attendance30, 1, "duplicate API row does not pass the two-signup gate");
assert.equal(byId.get(3).attendance30, 2, "two distinct same-day sessions count twice");
assert.equal(byId.get(4).attendance30, 3);
const ids = (key) => stats.lists.find((l) => l.key === key).memberIds;
assert.deepEqual(ids("onlyLargeSessions").slice().sort((a, b) => a - b), [3, 4, 11, 12]);
assert.deepEqual(ids("weeklyMax1"), [12], "a member can satisfy >=2 total with one session per week");
assert.ok(ids("weeklyMax2").includes(3));
assert.ok(ids("noWeekday0").includes(3));
assert.ok(ids("attendance15").includes(9), "one signup still participates in the attendance ranking");
assert.ok(byId.get(1).onlyLargeSessions && byId.get(2).onlyLargeSessions, "display gates do not erase model features");
assert.deepEqual(core.build({ players, sessions: [...sessions].reverse(), now }).lists, stats.lists);
const holidayStats = core.build({ players, sessions: [game("2026-10-02", [1]), game("2026-10-10", [1])], now });
assert.ok(holidayStats.lists.find((l) => l.key === "noWeekday5").memberIds.includes(1), "holiday signups meet activity gate but do not establish ordinary-Friday attendance");
assert.ok(holidayStats.lists.find((l) => l.key === "noWeekday6").memberIds.includes(1));

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const recommendationSource = html.slice(html.indexOf("    function buildShakePeopleRecommendations("), html.indexOf("    function getMemberStatistics("));
assert.ok(recommendationSource.length > 0);
const state = { players, sessions, shortTermRules: [], chainEntries: [{ player: players[2] }], shakeFilters: { gender: "", levelGroup: "" } };
let clock = now;
let forecast = { candidates: [...players.map((p) => ({ playerId: p.id, eligible: p.id !== 11, attendanceProbability: p.id / 20, uplift: p.id / 100 })), { playerId: 999 }] };
const context = vm.createContext({
  state,
  getMemberStatistics: () => core.build({ players: state.players, sessions: state.sessions, now: clock }),
  BadmintonMemberStatistics: core,
  getJoinedSelfPlayerIds: () => new Set(state.chainEntries.filter((e) => !e.isCompanion).map((e) => e.player.id)),
  renderGroupForecast: () => forecast,
  getPlayerById: (id) => players.find((p) => p.id === Number(id)),
  normalizePlayerId: (id) => Number(id) || null,
  getBestPartnerIdsMap: () => new Map(),
  levelRank: () => 3,
  ruleBlocksPlayerToday: (r, id) => r.playerId === id,
  getMemberStatsMap: () => new Map(players.map((p) => [p.id, { playCount: 100 - p.id }])),
  collator: new Intl.Collator("zh-CN"), firstName: (s) => s,
  getLevelGroupLabel: () => "中级",
});
Object.defineProperty(state, "groupForecast", { get: () => forecast });
vm.runInContext(recommendationSource, context);
const recommend = () => Array.from(context.buildShakePeopleRecommendations(clock.slice(0, 10)));
let recommendations = recommend();
assert.deepEqual(recommendations.map((r) => r.player.id), [2, 4, 9, 10, 12], "normal path requires recent activity and still excludes joined/ineligible/missing members");
for (const candidate of recommendations) {
  const original = forecast.candidates.find((r) => r.playerId === candidate.playerId);
  assert.equal(candidate.attendanceProbability, original.attendanceProbability);
  assert.equal(candidate.uplift, original.uplift);
}
vm.runInContext(html.slice(html.indexOf("    function filterShakePeopleRecommendations("), html.indexOf("    function renderShakePeopleList(")), context);
assert.deepEqual(Array.from(context.filterShakePeopleRecommendations(recommendations), (r) => r.player.id), [2, 4, 9, 10, 12]);
state.shakeFilters.gender = "女";
assert.equal(context.filterShakePeopleRecommendations(recommendations).length, 0);
state.shakeFilters.gender = "";
assert.equal(context.filterShakePeopleRecommendations(recommendations).length, 5, "reset filters cannot restore inactive members");
clock = "2026-10-24T00:00:00+08:00";
assert.ok(!recommend().some((r) => r.player.id === 2), "oldest signup expires at Beijing midnight");
assert.ok(recommend().some((r) => r.player.id === 7), "yesterday's completed signup now becomes eligible");
clock = now;
const archivedSessions = state.sessions;
state.sessions = state.sessions.filter((s) => !s.players.some((p) => p.playerId === 2));
assert.ok(!recommend().some((r) => r.player.id === 2), "deleting the last recent signup immediately removes eligibility");
state.sessions = archivedSessions;
forecast = null;
state.shortTermRules = [{ playerId: 12 }];
assert.deepEqual(recommend().map((r) => r.player.id), [2, 4, 9, 10, 11], "fallback applies activity/joins/rules and preserves its own ordering");
state.sessions = [];
assert.deepEqual(recommend(), [], "fallback must not fill empty recommendations with stale members");
forecast = { candidates: players.map((p) => ({ playerId: p.id })) };
assert.deepEqual(recommend(), []);

// The rebuilt probability model shares the display list's minimum-activity gate.
const probabilitySource = readFileSync(new URL("../group-probability.js", import.meta.url), "utf8");
const modelContext = vm.createContext({ LEARNING_EVIDENCE_PRIOR: 5 });
vm.runInContext(probabilitySource.slice(probabilitySource.indexOf("  function buildStatisticsProfile("), probabilitySource.indexOf("  function memberStatisticsEffect(")), modelContext);
const profile = modelContext.buildStatisticsProfile(players, stats);
assert.ok(!profile.largeIds.has(1) && !profile.largeIds.has(2));
assert.deepEqual([...profile.largeIds], ids("onlyLargeSessions"));
assert.equal(profile.largeConfidenceById.get(3), byId.get(3).attendance60 / (byId.get(3).attendance60 + 5));

assert.match(html, /id="shakeMemberStatisticsBlock"[^>]*\bopen[ >]/);
let rendered = 0, opened = 0;
const block = { open: false };
const modalContext = vm.createContext({
  state: { readOnly: false }, els: { shakeMemberStatisticsBlock: block },
  processChain() {}, loadShortTermRules: async () => {}, loadMemberStatistics: async () => {}, loadShakeState: async () => {}, updateShakeSyncStatus() {},
  renderShakePeopleModal() { rendered++; assert.ok(block.open); }, openModal() { opened++; }, toast() {},
});
vm.runInContext(html.slice(html.indexOf("    async function openShakePeopleModal("), html.indexOf("    function openShortRuleModal(")), modalContext);
await modalContext.openShakePeopleModal();
assert.ok(block.open);
block.open = false;
await modalContext.openShakePeopleModal();
assert.ok(block.open, "each deliberate reopen defaults to expanded");
assert.equal(opened, 2); assert.equal(rendered, 2);
const renderSource = html.slice(html.indexOf("    function renderShakePeopleModal("), html.indexOf("    function setShakeFiltersExpanded("));
assert.doesNotMatch(renderSource, /shakeMemberStatisticsBlock\.open/, "automatic render and filter changes must not force-expand a user-collapsed block");
modalContext.loadMemberStatistics = async () => { throw Error("offline"); };
block.open = false; await modalContext.openShakePeopleModal(); assert.ok(block.open, "offline open still expands and falls back to available records");
// The GitHub/offline review shell has a separate, read-only entry point.
const readonlyStart = html.indexOf('        sourceShakeButton.addEventListener("click", () => {');
const readonlyEnd = html.indexOf('        });', readonlyStart);
const readonlyBody = html.slice(readonlyStart + '        sourceShakeButton.addEventListener("click", () => {'.length, readonlyEnd);
assert.ok(readonlyStart > 0 && readonlyEnd > readonlyStart);
vm.runInContext('globalThis.openReadonlyShake = () => {' + readonlyBody + '};', modalContext);
modalContext.state.readOnly = true; block.open = false; modalContext.openReadonlyShake();
assert.ok(block.open, "GitHub/offline shell also expands on every open without cloud writes");
console.log("Shake activity passed: 0/1/2+ gates, ten restricted lists, dates, duplicates, companions, live/fallback eligibility, joins/rules, filter reset, midnight, edits, probability-feature isolation and accordion reopen.");
