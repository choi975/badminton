import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import vm from "node:vm";
import "../member-statistics.js";
import "../group-probability.js";

const core = globalThis.BadmintonMemberStatistics;
const now = "2026-10-22T10:00:00+08:00";
const players = Array.from({ length: 20 }, (_, index) => ({ id: index + 1, name: `成员${index + 1}`, level: "3级" }));
let nextId = 1;
function session(date, ids, size = ids.length) {
  const rows = ids.map((id) => ({ playerId: id, ownerPlayerId: id, slots: 1, plusCount: 0, isCompanion: false }));
  if (size > ids.length) rows.push({ playerId: null, ownerPlayerId: 20, isCompanion: true, slots: size - ids.length, plusCount: size - ids.length });
  return { id: nextId++, date, players: rows };
}
const sessions = [
  session("2026-10-12", [1, 2], 11), session("2026-10-13", [1, 2], 12), session("2026-10-14", [1], 11),
  session("2026-10-15", [3], 11), session("2026-10-16", [3], 10),
  session("2026-08-23", [4, 5], 11), // first included day of the completed 60-day window
  session("2026-08-22", [5, 6], 10), // excluded; cannot break member 5's large-only group
  session("2026-10-22", [6, 7], 11), session("2026-10-23", [6, 7], 11), // current/future excluded
  session("2026-10-08", [8], 11), session("2026-10-08", [8], 11), // same date, two distinct games
  session("2026-10-07", [9], 11), session("2026-10-06", [10], 11), // 15-day boundary
  session("2026-09-22", [11], 11), session("2026-09-21", [12], 11), // 30-day boundary
  session("2026-10-02", [13], 11), // holiday Friday: never ordinary Friday
  session("2026-10-10", [14], 11), // adjusted-workday Saturday: never ordinary Saturday
  session("2026-10-16", [15], 11), session("2026-10-17", [16], 11),
  session("2026-10-18", [17], 11), session("2026-10-19", [17], 11), // Sunday/Monday are different weeks
  session("2026-10-20", [18], 11), session("2026-10-21", [18], 11),
  { id: nextId++, date: "2026-10-19", players: [
    { playerId: 19, ownerPlayerId: 19, slots: 2, plusCount: 2 }, // plus-only, owner absent
    { playerId: 20, ownerPlayerId: 20, isCompanion: "1", slots: 1, plusCount: 0 },
  ] },
];
const result = core.build({ players, sessions, now });
const ids = (key, statistics = result) => statistics.lists.find((list) => list.key === key).memberIds;
const member = (id, statistics = result) => statistics.members.find((row) => row.playerId === id);
assert.equal(result.lists.length, 14);
assert.equal(result.asOf, "2026-10-21");
assert.deepEqual(result.windows, { start15: "2026-10-07", start30: "2026-09-22", start60: "2026-08-23", end: "2026-10-21" });
for (const excluded of [6, 7, 19, 20]) {
  assert.equal(member(excluded), undefined);
  assert.ok(result.lists.every((list) => !list.memberIds.includes(excluded)), "inactive or companion-only members never enter any statistic");
}
assert.ok(ids("threeDayStreak").includes(1));
assert.ok(!ids("twoDayStreak").includes(1));
assert.ok(ids("twoDayStreak").includes(2));
assert.ok(ids("threeDayStreak").every((id) => !ids("twoDayStreak").includes(id)));
assert.ok(!ids("onlyLargeSessions").includes(5), "60-day-only activity must not enter the large-session display list");
assert.ok(member(5).onlyLargeSessions, "the underlying model evidence is preserved");
assert.ok(ids("onlyLargeSessions").includes(8), "two distinct sessions on one day satisfy the two-signup threshold");
assert.ok(!ids("onlyLargeSessions").includes(3), "even one ten-person game disqualifies the member");
assert.equal(member(8).attendance15, 2, "count sessions, not distinct days, for the ranking");
assert.equal(member(8).streak60, 1, "two games on one day are not consecutive days");
assert.equal(member(9).attendance15, 1);
assert.equal(member(10).attendance15, 0);
assert.equal(member(11).attendance30, 1);
assert.equal(member(12).attendance30, 0);
assert.equal(member(12).weeklyLimit, null, "zero recent games is not a fabricated one-game weekly cap");
assert.equal(member(17).weeklyLimit, 1, "calendar weeks start Monday, not a sliding seven-day period");
assert.equal(member(18).weeklyLimit, 2);
assert.ok(ids("weeklyMax1").every((id) => !ids("weeklyMax2").includes(id)));
assert.ok(!ids("noWeekday5").includes(13), "one signup is insufficient for weekday lists");
assert.ok(member(13).noPlayWeekdays.includes(5), "holiday weekday evidence is still excluded");
assert.ok(!ids("noWeekday6").includes(14));
assert.ok(member(14).noPlayWeekdays.includes(6), "adjusted-workday evidence is still excluded");
assert.ok(!ids("noWeekday5").includes(15));
assert.ok(!ids("noWeekday6").includes(16));
assert.ok(!ids("noWeekday0").includes(12), "members with no 30-day play do not enter weekday lists");
assert.ok(result.lists.filter((list) => list.key.startsWith("noWeekday")).every((list) => !list.memberIds.includes(12)));
assert.ok(member(12).noPlayWeekdays.includes(0), "display eligibility does not change the existing probability-model features");
assert.equal(member(2).rank15, member(8).rank15, "equal counts have the same rank");
assert.deepEqual(core.build({ players, sessions: [...sessions, ...sessions], now }).members, result.members, "repeated session IDs are deduplicated");
assert.deepEqual(core.build({ players, sessions: [...sessions].reverse(), now }).lists, result.lists, "input ordering does not change lists");
assert.equal(core.build({ players, sessions: [], now }).activeMemberCount, 0);
const expired = core.build({ players, sessions: [session("2026-08-23", [1], 11)], now: "2026-10-23T00:00:00+08:00" });
assert.equal(expired.members.length, 0, "rolling expiry works at Beijing midnight without a data write");
const beforeMidnight = core.build({ players, sessions: [session("2026-08-23", [1], 11)], now: "2026-10-22T15:59:59Z" });
assert.equal(beforeMidnight.members.length, 1);
assert.equal(core.isOrdinaryDate("2026-10-10"), false);
assert.equal(core.isOrdinaryDate("2026-10-17"), true);
const crossYear = core.build({ players, sessions: [session("2025-12-31", [1], 11), session("2026-01-01", [1], 11)], now: "2026-01-03T08:00:00+08:00" });
assert.equal(member(1, crossYear).streak60, 2);
assert.ok(!member(1, crossYear).weekdays30.includes(4), "New Year holiday excluded across year boundaries");
const unknownYear = core.build({ players, sessions: [session("2027-01-03", [1], 11)], now: "2027-01-05T08:00:00+08:00" });
assert.deepEqual(unknownYear.missingCalendarYears, [2027]);
assert.ok(unknownYear.lists.filter((list) => list.key.startsWith("noWeekday")).every((list) => list.memberIds.length === 0));
const customCalendar = { knownYears: [2027], excludedDates: ["2027-01-01"] };
assert.ok(core.isOrdinaryDate("2027-01-03", customCalendar));
assert.ok(!core.isOrdinaryDate("2027-01-01", customCalendar));

// The exact same shared result powers both UI/API and probability inference.
const estimate = (overrides = {}) => globalThis.BadmintonGroupProbability.estimate({
  players, sessions, now, targetDate: "2026-10-22", seed: 407, simulations: 500, calibrationSimulations: 200,
  counterfactualSimulations: 40, ...overrides,
});
const forecast = estimate();
assert.deepEqual(forecast.memberStatistics.members, result.members);
assert.equal(globalThis.BadmintonGroupProbability.constants.largeSessionThreshold, 11);
const legacyOverrides = estimate({ longTermLists: { threeDayStreak: { members: players.map((player) => player.id) }, onlyLargeSessions: { members: [3] } } });
assert.deepEqual(legacyOverrides, forecast, "obsolete manual member lists cannot override the model or current statistics");
const capped = forecast.candidates.find((row) => row.playerId === 18);
assert.ok(capped.risks.includes("已达到近30天观察到的每周局数上限"));
assert.ok(capped.attendanceProbability > 0, "inferred limits are soft evidence, not hard unavailability");
const manualBlock = estimate({ shortTermRules: [{ playerId: 18, type: "not_days", rule: { weekdays: [4] } }] });
assert.equal(manualBlock.candidates.find((row) => row.playerId === 18).attendanceProbability, 0);
const ordinary = forecast.candidates.find((row) => row.playerId === 18);
const holidayForecast = estimate({ memberStatistics: { calendar: { ...result.calendar, excludedDates: [...result.calendar.excludedDates, "2026-10-22"] } } });
assert.ok(holidayForecast.candidates.find((row) => row.playerId === 18).attendanceProbability > ordinary.attendanceProbability, "weekday avoidance does not penalize a holiday target");
assert.notEqual(holidayForecast.todayProbability, forecast.todayProbability, "member statistics must also feed formation simulation");
assert.ok(forecast.candidates.every((row) => Number.isFinite(row.attendanceProbability) && row.attendanceProbability >= 0 && row.attendanceProbability <= 1));


// Top ten PEOPLE, not ten distinct frequencies; zero attendance never fills the list.
const rankedPlayers = Array.from({ length: 22 }, (_, i) => ({ id: i + 1, name: String(i + 1) }));
const rankedSessions = Array.from({ length: 15 }, (_, i) => session("2026-10-20", rankedPlayers
  .filter((p) => (p.id <= 9 ? 16 - p.id : p.id <= 13 ? 5 : p.id <= 20 ? 3 : 0) > i).map((p) => p.id)));
const ranked = core.build({ players: rankedPlayers, sessions: [...rankedSessions, session("2026-09-01", [21, 22])], now });
assert.equal(ids("attendance15", ranked).length, 13);
assert.deepEqual([...ids("attendance15", ranked)].sort((a, b) => a - b), Array.from({ length: 13 }, (_, i) => i + 1));
assert.ok(ids("attendance15", ranked).every((id) => member(id, ranked).attendance15 >= 5));
const tied = core.build({ players: rankedPlayers, sessions: [session("2026-10-20", rankedPlayers.map((p) => p.id))], now });
assert.equal(ids("attendance15", tied).length, 22, "a tie at the tenth person keeps the entire tie");
const sparse = core.build({ players: rankedPlayers, sessions: [session("2026-10-20", [1, 2]), session("2026-09-01", [3, 4])], now });
assert.deepEqual(ids("attendance15", sparse), [1, 2], "do not pad a short ranking with zero-count members");
assert.ok(ids("attendance15", result).every((id) => member(id).attendance15 > 0));

// Execute real cache and refresh helpers against SQLite instead of a string-only contract.
const worker = readFileSync(new URL("../src/worker.js", import.meta.url), "utf8");
const sql = new DatabaseSync(":memory:");
sql.exec(readFileSync(new URL("../migrations/0024_member_statistics_cache.sql", import.meta.url), "utf8"));
const db = { prepare(text) {
  let values = [];
  return {
    bind(...args) { values = args; return this; },
    async first() { return sql.prepare(text).get(...values) || null; },
    async run() { const result = sql.prepare(text).run(...values); return { meta: { changes: result.changes } }; },
  };
} };
let liveSessions = sessions;
let fetchMode = "valid";
let fetchCalls = 0;
const sandbox = vm.createContext({
  Date, Set, Map, JSON, Number, String, Array, Error, AbortSignal,
  BadmintonMemberStatistics: core, listPlayers: async () => players, listSessions: async () => liveSessions,
  console: { warn() {} },
  fetch: async () => {
    fetchCalls++;
    if (fetchMode === "failed") throw new Error("offline");
    return { ok: true, json: async () => ({
      year: 2026, papers: ["https://www.gov.cn/zhengce/test.htm"],
      days: Array.from({ length: 10 }, (_, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, isOffDay: true })),
    }) };
  },
});
vm.runInContext(worker.slice(worker.indexOf("async function readMemberStatisticsCalendar(")), sandbox);
const stored = await sandbox.rebuildMemberStatistics(db, new Date(now), false);
assert.equal(stored.version, core.VERSION);
assert.deepEqual(stored.members, result.members);
assert.equal(JSON.parse(sql.prepare("SELECT statistics_json FROM member_statistics_cache").get().statistics_json).asOf, "2026-10-21");
liveSessions = [session("2026-10-21", [7], 11)];
const refreshed = await sandbox.rebuildMemberStatistics(db, new Date(now), false);
assert.deepEqual(refreshed.members.map((row) => row.playerId), [7], "same-day edits replace the cache rather than append stale memberships");
const replacedCalendar = await sandbox.refreshMemberStatisticsCalendar(result.calendar, new Date(now));
assert.equal(fetchCalls, 1);
assert.ok(!replacedCalendar.excludedDates.includes("2026-10-01"), "a corrected verified calendar replaces that year's dates");
fetchMode = "failed";
const fallback = await sandbox.refreshMemberStatisticsCalendar(result.calendar, new Date(now));
assert.deepEqual(JSON.parse(JSON.stringify(fallback)), result.calendar, "calendar failure preserves the verified fallback");
sql.close();

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert.doesNotMatch(html, /长期规则|短期规则|成员统计名单|每周固定安排/);
assert.match(html, /<summary>成员统计<\/summary>/);
assert.match(html, /id="shortRuleTitle"[^>]*>新建规则</);
assert.ok(html.indexOf('src="./member-statistics.js"') < html.indexOf('src="./group-probability.js"'));
assert.match(html, /memberStatistics: getMemberStatistics\(\)/);
assert.doesNotMatch(html, /saveShakeLongTermList|getVisibleLongTermListValue/);
assert.match(worker, /pathname === "\/api\/member-statistics"/);
assert.match(worker, /memberStatistics: globalThis.BadmintonMemberStatistics.build/);
assert.match(readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8"), /crons = \["5 4 \* \* \*", "5 16 \* \* \*"\]/);
console.log("Member statistics passed: 14 groups, boundaries, rankings, ownership, holidays, weekly caps, probability integration, daily expiry, and SQLite cache refresh.");
