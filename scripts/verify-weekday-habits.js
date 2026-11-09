import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import "../member-statistics.js";
import "../group-probability.js";
import { GROUP_LEARNING_VERSION } from "../src/group-learning-core.js";

const core = globalThis.BadmintonMemberStatistics, model = globalThis.BadmintonGroupProbability;
const now = "2026-11-09T09:00:00+08:00", targetDate = "2026-11-09";
const calendar = { knownYears: [2026], excludedDates: [] };
const players = Array.from({ length: 10 }, (_, index) => ({ id: index + 1, name: "成员" + (index + 1), level: "3级", createdAt: "2026-01-01" }));
players[7].createdAt = "2026-11-04 00:00:00";
let nextId = 1;
function session(date, ids, count = 10) {
  const rows = ids.map(playerId => ({ playerId, ownerPlayerId: playerId, slots: 1, plusCount: 0 }));
  if (count > ids.length) rows.push({ playerId: null, ownerPlayerId: 10, isCompanion: true, slots: count - ids.length, plusCount: count - ids.length });
  return { id: nextId++, date, players: rows };
}
const history = [
  session("2026-10-12", [1, 2]), session("2026-10-19", [1, 2, 3, 5]),
  session("2026-10-26", [1, 2]), session("2026-11-02", [1, 3]),
  session("2026-10-12", [1]), session("2026-10-19", [3, 5]),
  session("2026-11-02", [3]), session("2026-10-19", [5]),
  session("2026-10-14", [1, 4]), session("2026-10-21", [1, 4, 6]),
  session("2026-10-16", [1, 7]), session("2026-10-23", [1, 7]),
  session("2026-11-06", [8]), session("2026-10-22", [5], 9),
  session("2026-10-09", [9]), // outside the rolling 30-day window
  session("2026-11-09", [9]), session("2026-11-16", [9]), // current/future excluded
];
const build = (sessions = history, overrides = {}) => core.build({ players, sessions, now, calendar, ...overrides });
const statistics = build();
const ids = (key, s = statistics) => s.lists.find(list => list.key === key).memberIds;
const member = (id, s = statistics) => s.members.find(row => row.playerId === id);
const tags = (id, date = targetDate, s = statistics, count = 10) => core.recommendationTags({ statistics: s, playerId: id, targetDate: date, currentCount: count });
const keys = statistics.lists.map(list => list.key);
assert.equal(statistics.version, "member-statistics-v6.1");
assert.equal(keys.length, 21);
assert.deepEqual(keys.slice(keys.indexOf("noWeekday0") + 1, keys.indexOf("weeklyMax1")), [1, 2, 3, 4, 5, 6, 0].map(day => "preferredWeekday" + day));
assert.deepEqual(ids("preferredWeekday1"), [1, 3, 2], "sort by Monday session count, not lifetime/15-day attendance or distinct Monday count");
assert.equal(member(3).weekdayCounts30[1], 4);
assert.equal(member(3).weekdayEvidence30[1].attendanceDays, 2);
assert.equal(member(5).weekdayCounts30[1], 3);
assert.ok(!ids("preferredWeekday1").includes(5), "three sessions on a single Monday cannot establish a weekly routine");
assert.deepEqual(build([...history, { ...history[0] }]).lists, statistics.lists, "duplicate API rows do not affect counts or ordering");
assert.deepEqual(build([...history].reverse(), { players: [...players].reverse() }).lists, statistics.lists, "group ordering is deterministic");
assert.ok(ids("noWeekday1").includes(4));
assert.equal(member(4).weekdayEvidence30[1].opportunityDays, 4, "same-day multiple games provide one comparable opportunity");
assert.equal(member(4).weekdayEvidence30[1].otherAttendanceDays, 2);
assert.ok(!ids("noWeekday1").includes(6), "only one other attendance day is insufficient");
assert.ok(!ids("noWeekday1").includes(8), "a member registered after the Mondays has no missed opportunities");
assert.equal(member(8).weekdayEvidence30[1].opportunityDays, 0);
assert.equal(ids("noWeekday2").length, 0, "no organized Tuesday is not Tuesday unavailability");
assert.ok(!ids("preferredWeekday1").includes(9), "outside-window and current/future attendance do not qualify");
assert.ok(!statistics.members.some(row => row.playerId === 10), "companions never create owner attendance");
assert.ok(tags(1).reasons.includes("周一喜欢打球"));
assert.ok(tags(4).risks.includes("周一可能无法打球"));
assert.ok(!tags(1, "2026-11-10").reasons.some(label => label.includes("喜欢打球")), "only the target weekday label is shown");
assert.ok(tags(7, "2026-11-13").reasons.includes("周五喜欢打球"));
for (const day of ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]) {
  for (const p of players) {
    const t = tags(p.id, day);
    assert.ok(!(t.reasons.some(s => s.includes("喜欢打球")) && t.risks.some(s => s.includes("可能无法打球"))), "preferred and avoided weekday labels are mutually exclusive");
  }
}
const holiday = build(history, { calendar: { knownYears: [2026], excludedDates: ["2026-10-12", "2026-10-19", targetDate] } });
assert.ok(!ids("preferredWeekday1", holiday).includes(2));
assert.ok(ids("noWeekday1", holiday).includes(4), "two ordinary Mondays meet the one-opportunity gate; holiday target still suppresses the label");
assert.ok(!tags(1, targetDate, holiday).reasons.some(s => s.includes("喜欢打球")));
assert.ok(!tags(4, targetDate, holiday).risks.some(s => s.includes("可能无法打球")));
const noOpportunities = build(history.filter(s => new Date(s.date + "T00:00:00Z").getUTCDay() !== 1));
assert.equal(ids("noWeekday1", noOpportunities).length, 0);
const unsuccessful = build([...history.filter(s => new Date(s.date + "T00:00:00Z").getUTCDay() !== 1), ...["2026-10-12", "2026-10-19", "2026-10-26"].map(date => session(date, [], 5))]);
assert.equal(ids("noWeekday1", unsuccessful).length, 0, "unformed attempts do not become weekday attendance opportunities");
const expired = build(history, { now: "2026-12-10T09:00:00+08:00" });
assert.equal(ids("preferredWeekday1", expired).length, 0, "weekday groups expire with the rolling window");
const unknown = build([session("2027-01-04", [1]), session("2027-01-11", [1])], { now: "2027-01-18T09:00:00+08:00", calendar: { knownYears: [], excludedDates: [] } });
assert.ok(unknown.lists.filter(l => /^(preferredWeekday|noWeekday)/.test(l.key)).every(l => l.memberIds.length === 0));

// Inclusive threshold in historical groups, target labels, and learned exit evidence.
for (const count of [9, 10, 11]) {
  const sizeStats = build([session("2026-10-12", [1], count), session("2026-10-19", [1], count)]);
  assert.equal(ids("onlyLargeSessions", sizeStats).includes(1), count >= 10);
  assert.equal(tags(1, targetDate, statistics, count).risks.includes("可能不喜欢人少的局"), count < 10);
}
assert.equal(core.LARGE_SESSION_THRESHOLD, 10);
assert.equal(model.constants.largeSessionThreshold, 10);
assert.equal(GROUP_LEARNING_VERSION, "group-learning-v3");

const entries = Array.from({ length: 10 }, (_, i) => ({ clean: "已确认" + i, slots: 1 }));
const estimate = (overrides = {}) => model.estimate({ players, sessions: history, now, targetDate,
  entries, memberStatistics: { calendar }, simulations: 160, calibrationSimulations: 120,
  includeCounterfactuals: false, seed: 619, ...overrides });
const prediction = estimate();
const neutral = estimate({ memberStatistics: { calendar: { ...calendar, excludedDates: [targetDate] } } });
const candidate = (id, p = prediction) => p.candidates.find(row => row.playerId === id);
const odds = p => p / (1 - p);
assert.equal(prediction.modelVersion, "group-probability-v5.1");
assert.equal(prediction.assumptions.largeSessionThreshold, 10);
assert.deepEqual(prediction.assumptions.weekdayHabits.oddsRange, [0.2, 3]);
assert.ok(candidate(1).factors.weekdayOddsMultiplier > 1.3, "repeated preferred weekdays materially boost attendance");
assert.ok(candidate(1).factors.weekdayOddsMultiplier <= 3);
assert.ok(candidate(4).factors.weekdayOddsMultiplier <= 0.35, "repeated missed opportunities materially suppress attendance");
assert.ok(candidate(4).factors.weekdayOddsMultiplier >= 0.2);
assert.equal(candidate(6).factors.weekdayOddsMultiplier, 1, "insufficient other attendance does not create a penalty");
assert.equal(candidate(8).factors.weekdayOddsMultiplier, 1, "pre-membership dates never create weekday penalties");
for (const id of [1, 4]) {
  assert.ok(Math.abs(odds(candidate(id).attendanceProbability) / odds(candidate(id, neutral).attendanceProbability)
    - candidate(id).factors.weekdayOddsMultiplier) < 0.0001, "the new weekday shift enters exactly once");
}
const threeOpportunities = estimate({ sessions: history.filter(row => row.date !== "2026-10-12") });
assert.ok(candidate(4, threeOpportunities).factors.weekdayOddsMultiplier > candidate(4).factors.weekdayOddsMultiplier,
  "three missed opportunities receive less penalty than four, not an immediate maximum penalty");
const fiveOpportunities = estimate({ now: "2026-11-11T09:00:00+08:00", targetDate: "2026-11-16",
  sessions: [...history, session("2026-11-09", [1])] });
assert.equal(candidate(4, fiveOpportunities).factors.weekdayOddsMultiplier, 0.2, "five supported misses can reach the agreed lower odds bound");
assert.ok(candidate(2).factors.weekdayOddsMultiplier > candidate(3).factors.weekdayOddsMultiplier,
  "three attended Mondays carry stronger evidence than two, even if two Mondays had more sessions");
const blocked = estimate({ shortTermRules: [{ playerId: 1, type: "not_days", rule: { weekdays: [1] } }] });
assert.equal(candidate(1, blocked).attendanceProbability, 0, "explicit unavailability overrides a preferred weekday");
const holidayAll = estimate({ memberStatistics: { calendar: { knownYears: [2026], excludedDates: [targetDate] } } });
assert.equal(candidate(1, holidayAll).factors.weekdayOddsMultiplier, 1);
assert.equal(candidate(4, holidayAll).factors.weekdayOddsMultiplier, 1);
const nine = estimate({ entries: entries.slice(0, 9) }), eleven = estimate({ entries: [...entries, { clean: "再一人", slots: 1 }] });
assert.ok(candidate(1).attendanceProbability > candidate(1, nine).attendanceProbability, "the large-session risk is released at exactly ten people");
assert.equal(candidate(1).attendanceProbability, candidate(1, eleven).attendanceProbability, "ten and eleven have the same resolved large-session status");
assert.ok(candidate(8).factors.historyConfidence < 1);
assert.ok(candidate(8).factors.positiveEvidenceConfidence < 1);
assert.ok(candidate(8).risks.includes("历史样本较少"));
assert.ok(candidate(8).attendanceProbability < candidate(1).attendanceProbability, "a one-record member is ranked more conservatively than an established regular");
assert.ok(prediction.candidates.every((row, i, rows) => !i || rows[i - 1].attendanceProbability >= row.attendanceProbability));
const withFriends = estimate({ entries: [{ playerId: 1, slots: 1 }, ...entries.slice(1)], bestPartnerOverrides: { manualPairs: [{ playerIds: [1, 8], createdAt: "2026-10-01T00:00:00Z" }] } });
assert.ok(candidate(8, withFriends).factors.friendOddsMultiplier > 1);
assert.ok(candidate(8, withFriends).factors.friendOddsMultiplier < 1.25, "one attendance record cannot receive the entire friendship lift");
const oldHistory = [session("2026-07-01", [8]), session("2026-07-02", [8]), session("2026-07-03", [8]),
  ...Array.from({ length: 8 }, (_, i) => session("2026-07-" + String(i + 4).padStart(2, "0"), [1]))];
const established = estimate({ sessions: [...oldHistory, ...history] });
assert.equal(candidate(8, established).factors.historyConfidence, 1, "old comparable history remains evidence even if recent activity is low");
assert.equal(candidate(8, established).factors.positiveEvidenceConfidence, 1);

// Cached forecast labels must be refreshed, not leaked across target weekdays.
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const sandbox = vm.createContext({ BadmintonMemberStatistics: core, getJoinedSelfPlayerIds: () => new Set(), getPlayerById: () => null, firstName: n => n });
vm.runInContext(html.slice(html.indexOf("    function getShakeRecommendationBadges("), html.indexOf("    function shakeProbabilityValue(")), sandbox);
const stale = { player: players[0], reasons: ["周五喜欢打球"], risks: ["周一可能无法打球"] };
const badges = Array.from(sandbox.getShakeRecommendationBadges(stale, statistics, targetDate, 10), b => b.text);
assert.ok(badges.includes("周一喜欢打球"));
assert.ok(!badges.includes("周五喜欢打球"));
assert.ok(!badges.includes("周一可能无法打球"));
const renderer = html.slice(html.indexOf("    function renderShakeMemberStatistics("), html.indexOf("    function shortRuleSchedule("));
assert.ok(renderer.includes('else value.textContent = definition.memberIds.map((id) => byId.get(id).name).join("、")'), "new preferred groups use the plain-name renderer, without counts");
assert.ok(!renderer.includes('definition.key.startsWith("preferredWeekday")'), "no separate count renderer is introduced for preferred groups");
console.log(JSON.stringify({ result: "Weekday habits passed", groups: statistics.lists.length, preferredMondayOrder: ids("preferredWeekday1"),
  positiveWeekdayMultiplier: candidate(1).factors.weekdayOddsMultiplier,
  negativeWeekdayMultiplier: candidate(4).factors.weekdayOddsMultiplier,
  newcomerProbability: candidate(8).attendanceProbability, regularProbability: candidate(1).attendanceProbability }));
