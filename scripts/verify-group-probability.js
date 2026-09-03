import assert from "node:assert/strict";
import fs from "node:fs";

await import("../group-probability.js");

const probabilityApi = globalThis.BadmintonGroupProbability;
assert.ok(probabilityApi, "browser global should be attached after importing the core");

function isoDate(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function makePlayers(count = 14) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    name: `成员${index + 1}`,
    level: index < 7 ? "2.5级" : "4级",
    gender: index % 3 === 0 ? "女" : "男",
  }));
}

function session(date, ids, guestsByOwner = {}) {
  const players = ids.map((id) => ({
    playerId: id,
    playerName: `成员${id}`,
    ownerPlayerId: id,
    ownerName: `成员${id}`,
    isCompanion: false,
    slots: 1,
    plusCount: 0,
  }));
  Object.entries(guestsByOwner).forEach(([ownerId, count]) => {
    for (let index = 1; index <= count; index += 1) {
      players.push({
        playerId: null,
        playerName: `成员${ownerId}+${index}`,
        ownerPlayerId: Number(ownerId),
        ownerName: `成员${ownerId}`,
        isCompanion: true,
        slots: 1,
        plusCount: 0,
      });
    }
  });
  return { date, players };
}

function regularEntry(player) {
  return {
    clean: player.name,
    player,
    playerId: player.id,
    ownerPlayer: player,
    ownerPlayerId: player.id,
    isCompanion: false,
    plusEntry: false,
    levelText: player.level,
  };
}

function companionEntry(owner, number = 1) {
  return {
    clean: `${owner.name}+${number}`,
    player: null,
    ownerPlayer: owner,
    ownerPlayerId: owner.id,
    isCompanion: true,
    plusEntry: true,
    levelText: "不详",
  };
}

function buildHistory(players, { days = 42, start = "2026-07-20", largePlayerId = null, guestOwnerId = null } = {}) {
  const startTimestamp = Date.parse(`${start}T00:00:00Z`);
  const sessions = [];
  for (let day = 0; day < days; day += 2) {
    const ids = [1, 2, 3, 4, 5, 6, 7 + ((day / 2) % Math.max(1, players.length - 6))]
      .map((id) => ((id - 1) % players.length) + 1);
    if (largePlayerId && !ids.includes(largePlayerId)) ids.push(largePlayerId);
    while (largePlayerId && ids.length < 10) ids.push(((ids.length + 2) % players.length) + 1);
    const uniqueIds = [...new Set(ids)];
    const guests = guestOwnerId && day % 4 === 0 ? { [guestOwnerId]: 2 } : {};
    sessions.push(session(isoDate(startTimestamp + day * 86400000), uniqueIds, guests));
  }
  return sessions;
}

function estimate(overrides = {}) {
  const players = overrides.players || makePlayers();
  const sessions = overrides.sessions || buildHistory(players);
  return probabilityApi.estimate({
    players,
    sessions,
    entries: [],
    shortTermRules: [],
    longTermLists: {
      threeDayStreak: { members: [] },
      twoDayStreak: { members: [] },
      onlyLargeSessions: { members: [] },
    },
    targetDate: "2026-09-04",
    now: "2026-09-04T09:00:00+08:00",
    simulations: 2400,
    calibrationSimulations: 500,
    seed: 8675309,
    ...overrides,
  });
}

const snapshot = JSON.parse(fs.readFileSync(new URL("../data/bootstrap-snapshot.json", import.meta.url), "utf8")).data;
const realBaseline = probabilityApi.estimate({
  ...snapshot,
  entries: [],
  shortTermRules: [],
  longTermLists: {},
  targetDate: "2026-09-04",
  now: "2026-09-04T09:00:00+08:00",
  simulations: 1000,
  calibrationSimulations: 400,
  seed: 11,
});
assert.equal(realBaseline.weekdayBaseline.historyStart, "2026-07-13");
assert.equal(realBaseline.weekdayBaseline.historyEnd, "2026-09-03");
assert.equal(realBaseline.weekdayBaseline.rows.find((row) => row.name === "周五").successes, 5);
assert.equal(realBaseline.weekdayBaseline.rows.find((row) => row.name === "周五").days, 7);
assert.ok(Math.abs(realBaseline.weekdayBaseline.today - 0.561376) < 0.000001, "Friday EB baseline should include 5% soft failures and k=10 shrinkage");
assert.ok(Math.abs(realBaseline.weekdayBaseline.tomorrow - 0.393729) < 0.000001, "Saturday EB baseline should be selected for tomorrow");

const explicitAttemptFailure = probabilityApi.estimate({
  ...snapshot,
  entries: [],
  shortTermRules: [],
  longTermLists: {},
  groupAttemptOutcomes: [{
    activityDate: "2026-08-28",
    outcome: "failure",
    trainingState: "eligible",
    hasEligibleSnapshots: true,
  }],
  targetDate: "2026-09-04",
  now: "2026-09-04T09:00:00+08:00",
  simulations: 800,
  calibrationSimulations: 300,
  counterfactualSimulations: 60,
  seed: 11,
});
assert.equal(explicitAttemptFailure.weekdayBaseline.rows.find((row) => row.name === "周五").successes, 4);
assert.ok(explicitAttemptFailure.weekdayBaseline.today < realBaseline.weekdayBaseline.today, "eligible settled attempts must override the date's soft/session label");
const excludedAttempt = probabilityApi.estimate({
  ...snapshot,
  entries: [],
  shortTermRules: [],
  longTermLists: {},
  groupAttemptOutcomes: [{
    activityDate: "2026-08-28",
    outcome: "failure",
    trainingState: "excluded",
    hasEligibleSnapshots: true,
  }],
  targetDate: "2026-09-04",
  now: "2026-09-04T09:00:00+08:00",
  simulations: 800,
  calibrationSimulations: 300,
  counterfactualSimulations: 60,
  seed: 11,
});
assert.equal(excludedAttempt.weekdayBaseline.today, realBaseline.weekdayBaseline.today, "excluded attempts must not affect calibration");

const deterministicInput = {
  entries: makePlayers().slice(0, 4).map(regularEntry),
};
assert.deepEqual(estimate(deterministicInput), estimate(deterministicInput), "fixed seed must make all probability output deterministic");
const probabilityOnly = estimate({ ...deterministicInput, includeCandidates: false });
assert.deepEqual(probabilityOnly.candidates, [], "probability-only rendering should skip candidate counterfactual work");
assert.equal(probabilityOnly.candidatesIncluded, false);
assert.equal(probabilityOnly.counterfactualSimulationCount, 0);

const players = makePlayers();
const fiveJoined = estimate({ entries: players.slice(0, 5).map(regularEntry) });
const sixJoined = estimate({ entries: players.slice(0, 6).map(regularEntry) });
assert.ok(sixJoined.todayProbability > fiveJoined.todayProbability, "a sixth ordinary signup should raise success probability");
assert.ok(sixJoined.todayProbability > 0 && sixJoined.todayProbability <= 1);
assert.ok(sixJoined.tomorrowProbability >= 0 && sixJoined.tomorrowProbability <= 1);

const blockedRule = {
  playerId: 10,
  type: "not_days",
  rule: { weekdays: [5] },
  startsOn: "2026-09-01",
  expiresOn: null,
};
const blocked = estimate({ entries: players.slice(0, 3).map(regularEntry), shortTermRules: [blockedRule] });
const blockedCandidate = blocked.candidates.find((candidate) => candidate.playerId === 10);
assert.equal(blockedCandidate.attendanceProbability, 0, "an active weekly rule should hard-block an unjoined candidate");
assert.equal(blockedCandidate.eligible, false);
assert.ok(blockedCandidate.risks.some((risk) => risk.includes("规则")));
const allowedTomorrowOnly = estimate({
  entries: players.slice(0, 3).map(regularEntry),
  shortTermRules: [{ ...blockedRule, type: "only_days", rule: { weekdays: [5] } }],
});
assert.ok(allowedTomorrowOnly.candidates.find((candidate) => candidate.playerId === 10).attendanceProbability > 0);

const yesterday = session("2026-09-03", [10, 11, 12, 13, 14, 1]);
const fatigueSessions = [...buildHistory(players), yesterday];
const fatigued = estimate({ sessions: fatigueSessions });
const staminaProtected = estimate({
  sessions: fatigueSessions,
  longTermLists: {
    threeDayStreak: { members: [] },
    twoDayStreak: { members: ["成员10"] },
    onlyLargeSessions: { members: [] },
  },
});
const tiredProbability = fatigued.candidates.find((candidate) => candidate.playerId === 10).attendanceProbability;
const restedProbability = staminaProtected.candidates.find((candidate) => candidate.playerId === 10).attendanceProbability;
assert.ok(restedProbability > tiredProbability * 2, "two-day stamina list should avoid the 20% fatigue multiplier after one prior day");
assert.ok(fatigued.candidates.find((candidate) => candidate.playerId === 10).risks.some((risk) => risk.includes("体力")));

const largePlayers = makePlayers(16);
const largeHistory = buildHistory(largePlayers, { days: 70, largePlayerId: 10 });
const largeLists = {
  threeDayStreak: { members: largePlayers.map((player) => player.name) },
  twoDayStreak: { members: largePlayers.map((player) => player.name) },
  onlyLargeSessions: { members: ["成员10"] },
};
const belowLargeThreshold = estimate({
  players: largePlayers,
  sessions: largeHistory,
  entries: [...largePlayers.slice(0, 5).map(regularEntry), regularEntry(largePlayers[9])],
  longTermLists: largeLists,
});
const ordinaryAtSix = estimate({
  players: largePlayers,
  sessions: largeHistory,
  entries: largePlayers.slice(0, 6).map(regularEntry),
  longTermLists: largeLists,
});
assert.ok(ordinaryAtSix.todayProbability > belowLargeThreshold.todayProbability, "a large-session-only sixth signup should be less stable below ten than an ordinary signup");
const nineWithLarge = estimate({
  players: largePlayers,
  sessions: largeHistory,
  entries: [...largePlayers.slice(0, 8).map(regularEntry), regularEntry(largePlayers[9])],
  longTermLists: largeLists,
});
const tenWithLarge = estimate({
  players: largePlayers,
  sessions: largeHistory,
  entries: [...largePlayers.slice(0, 9).map(regularEntry), regularEntry(largePlayers[9])],
  longTermLists: largeLists,
});
assert.ok(tenWithLarge.todayProbability >= nineWithLarge.todayProbability, "reaching ten must not reduce success when a large-session member is present");

const fivePlusGuest = estimate({
  entries: [...players.slice(0, 5).map(regularEntry), companionEntry(players[9])],
});
assert.ok(fivePlusGuest.todayProbability > fiveJoined.todayProbability, "an explicit +N line should contribute one current participant");
assert.ok(fivePlusGuest.candidates.some((candidate) => candidate.playerId === 10), "a companion must not imply that its owner is personally present");

const guestHistory = buildHistory(players, { guestOwnerId: 12 });
const guestInfluencer = estimate({ sessions: guestHistory, entries: players.slice(0, 2).map(regularEntry) });
const guestCandidate = guestInfluencer.candidates.find((candidate) => candidate.playerId === 12);
assert.ok(guestCandidate.reasons.includes("常带随行人员"));
assert.ok(guestCandidate.uplift > 0);

const thresholdPlayers = makePlayers(6);
const thresholdStart = Date.parse("2026-07-01T00:00:00Z");
const thresholdSessions = Array.from({ length: 30 }, (_, index) => session(
  isoDate(thresholdStart + index * 2 * 86400000),
  [1, 2, 3, 4, 5, 6],
  { 6: 4 },
));
const thresholdCounterfactual = estimate({
  players: thresholdPlayers,
  sessions: thresholdSessions,
  entries: thresholdPlayers.slice(0, 5).map(regularEntry),
  longTermLists: {
    threeDayStreak: { members: thresholdPlayers.map((player) => player.name) },
    twoDayStreak: { members: thresholdPlayers.map((player) => player.name) },
    onlyLargeSessions: { members: thresholdPlayers.slice(0, 5).map((player) => player.name) },
  },
  counterfactualSimulations: 500,
});
const thresholdCandidate = thresholdCounterfactual.candidates.find((candidate) => candidate.playerId === 6);
assert.ok(thresholdCandidate.uplift > 0.4, "true counterfactual uplift should include a candidate's +N bundle crossing ten and retaining large-session members");

const socialPlayers = makePlayers(13);
const socialStart = Date.parse("2026-07-02T00:00:00Z");
const highSocialSessions = Array.from({ length: 20 }, (_, index) => session(
  isoDate(socialStart + index * 2 * 86400000),
  [3, 4, 5, 6, 7, 8],
));
const lowSocialSessions = Array.from({ length: 20 }, (_, index) => session(
  isoDate(socialStart + index * 2 * 86400000),
  [1, 2, 3, 9, 10, 11],
));
const blockedLowPartners = [9, 10, 11].map((playerId) => ({
  playerId,
  type: "not_days",
  rule: { weekdays: [5] },
  startsOn: "2026-07-01",
}));
const highSocial = estimate({
  players: socialPlayers,
  sessions: highSocialSessions,
  entries: socialPlayers.slice(0, 2).map(regularEntry),
  shortTermRules: blockedLowPartners,
  longTermLists: {
    threeDayStreak: { members: [] },
    twoDayStreak: { members: [] },
    onlyLargeSessions: { members: [] },
  },
  counterfactualSimulations: 500,
});
const lowSocial = estimate({
  players: socialPlayers,
  sessions: lowSocialSessions,
  entries: socialPlayers.slice(0, 2).map(regularEntry),
  shortTermRules: blockedLowPartners,
  longTermLists: {
    threeDayStreak: { members: [] },
    twoDayStreak: { members: [] },
    onlyLargeSessions: { members: [] },
  },
  counterfactualSimulations: 500,
});
assert.ok(
  highSocial.candidates.find((candidate) => candidate.playerId === 3).uplift
    > lowSocial.candidates.find((candidate) => candidate.playerId === 3).uplift,
  "candidate counterfactual must include the extra arrivals caused by their social links",
);

const noTodayEntries = estimate({ sessions: fatigueSessions, entries: [] });
const strongTodayAttendance = estimate({
  sessions: fatigueSessions,
  entries: players.slice(0, 10).map(regularEntry),
});
assert.ok(strongTodayAttendance.tomorrowProbability < noTodayEntries.tomorrowProbability, "tomorrow should integrate the fatigue caused by likely attendance today");

for (let index = 1; index < fiveJoined.candidates.length; index += 1) {
  const previous = fiveJoined.candidates[index - 1];
  const current = fiveJoined.candidates[index];
  assert.ok(previous.score >= current.score - 0.000001, "candidate order should always use attendanceProbability * counterfactual uplift");
  if (Math.abs(previous.score - current.score) < 0.000001) {
    assert.ok(previous.attendanceProbability >= current.attendanceProbability - 0.000001, "attendance probability should break equal-score ties");
  }
}
assert.equal(fiveJoined.rankingMode, "attendanceProbabilityTimesUplift");

const beforeCutoffFive = estimate({
  sessions: guestHistory,
  entries: players.slice(0, 5).map(regularEntry),
  now: "2026-09-04T16:59:00+08:00",
});
assert.ok(beforeCutoffFive.todayProbability > 0, "future arrivals may still contribute before cutoff");
const settledFive = estimate({
  sessions: guestHistory,
  entries: players.slice(0, 5).map(regularEntry),
  now: "2026-09-04T17:00:00+08:00",
});
assert.equal(settledFive.todayProbability, 0, "five current names must settle to failure at 17:00 even for a historical guest-bringer");
assert.equal(settledFive.today.expectedFinalCount, 5);
assert.equal(settledFive.today.settled, true);
assert.deepEqual(settledFive.candidates, [], "no candidate may be recommended after hard settlement");
const settledSix = estimate({
  entries: players.slice(0, 6).map(regularEntry),
  now: "2026-09-04T17:00:00+08:00",
});
assert.equal(settledSix.todayProbability, 1, "six explicit current names must settle to success at 17:00");
const settledSixWithLargePreference = estimate({
  entries: players.slice(0, 6).map(regularEntry),
  sessions: buildHistory(players, { days: 70, largePlayerId: 6 }),
  longTermLists: {
    threeDayStreak: { members: players.map((player) => player.name) },
    twoDayStreak: { members: players.map((player) => player.name) },
    onlyLargeSessions: { members: [players[5].name] },
  },
  now: "2026-09-04T17:00:00+08:00",
});
assert.ok(
  settledSixWithLargePreference.todayProbability > 0 && settledSixWithLargePreference.todayProbability < 1,
  "six names below ten must retain cancellation risk when one has a supported large-session preference",
);
const settledWithExplicitGuest = estimate({
  sessions: guestHistory,
  entries: [...players.slice(0, 5).map(regularEntry), companionEntry(players[11])],
  now: "2026-09-04T17:00:00+08:00",
});
assert.equal(settledWithExplicitGuest.todayProbability, 1, "an explicit +N still counts at settlement");

const orderedEntries = [...players.slice(0, 4).map(regularEntry), companionEntry(players[9])];
const orderForward = estimate({ entries: orderedEntries, seed: undefined });
const orderReverse = estimate({ entries: [...orderedEntries].reverse(), seed: undefined });
assert.deepEqual(orderForward, orderReverse, "semantically identical roster order must not change the default seed or output");
const atTen = estimate({ entries: [], now: "2026-09-04T10:00:00+08:00", seed: undefined });
const atTenOhOne = estimate({ entries: [], now: "2026-09-04T10:01:00+08:00", seed: undefined });
assert.ok(Math.abs(atTen.todayProbability - atTenOhOne.todayProbability) <= 0.03, "one minute should only move probability through the continuous time formula, not a new random seed");

const failedTodayNoFatigue = estimate({
  sessions: fatigueSessions,
  entries: players.slice(0, 5).map(regularEntry),
  now: "2026-09-04T17:00:00+08:00",
  seed: 404,
});
const emptyFailedToday = estimate({
  sessions: fatigueSessions,
  entries: [],
  now: "2026-09-04T17:00:00+08:00",
  seed: 404,
});
assert.equal(failedTodayNoFatigue.tomorrowProbability, emptyFailedToday.tomorrowProbability, "a settled failed group must not create tomorrow fatigue");
const successfulTodayCreatesFatigue = estimate({
  sessions: fatigueSessions,
  entries: players.slice(0, 6).map(regularEntry),
  now: "2026-09-04T17:00:00+08:00",
  seed: 404,
});
assert.ok(successfulTodayCreatesFatigue.tomorrowProbability < emptyFailedToday.tomorrowProbability, "only a successful group should pass today's attendance into tomorrow stamina");

const sixPlayerSet = makePlayers(6);
const sixPlayerHistory = [
  session("2026-09-01", [1, 2, 3, 4, 5, 6]),
  session("2026-09-03", [1, 2, 3, 4, 5, 6]),
];
const joinedFatigue = estimate({
  players: sixPlayerSet,
  sessions: sixPlayerHistory,
  entries: sixPlayerSet.map(regularEntry),
  now: "2026-09-04T16:00:00+08:00",
  longTermLists: {
    threeDayStreak: { members: [] },
    twoDayStreak: { members: sixPlayerSet.slice(0, 5).map((player) => player.name) },
    onlyLargeSessions: { members: [] },
  },
  simulations: 5000,
});
assert.ok(joinedFatigue.todayProbability > 0.4 && joinedFatigue.todayProbability < 0.7, "an over-capacity current signup should use the single weaker 55% retention penalty");

const impossible = estimate({ players: [], sessions: [], entries: [], simulations: 400, calibrationSimulations: 200 });
assert.equal(impossible.todayProbability, 0, "without players or entries a group cannot form");
assert.equal(impossible.tomorrowProbability, 0);
assert.deepEqual(impossible.candidates, []);

console.log("Group probability verification passed.");
