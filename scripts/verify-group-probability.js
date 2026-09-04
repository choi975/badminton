import assert from "node:assert/strict";
import fs from "node:fs";

await import("../group-probability.js");

const probabilityApi = globalThis.BadmintonGroupProbability;
assert.ok(probabilityApi, "browser global should be attached after importing the core");

function isoDate(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function logOdds(probability) {
  const bounded = Math.min(0.999999, Math.max(0.000001, probability));
  return Math.log(bounded / (1 - bounded));
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
assert.ok(Math.abs(realBaseline.weekdayBaseline.today - 0.530204) < 0.000001, "Friday EB baseline should use 30-day decay, 5% soft failures, and k=10 shrinkage");
assert.ok(Math.abs(realBaseline.weekdayBaseline.tomorrow - 0.404013) < 0.000001, "Saturday decayed EB baseline should be selected for tomorrow");
assert.equal(realBaseline.weekdayBaseline.rows.find((row) => row.name === "周五").effectiveDays, 3.860242);

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

const baselineStart = Date.parse("2026-07-01T00:00:00Z");
const baselineDates = Array.from({ length: 65 }, (_, index) => isoDate(baselineStart + index * 86400000));
const baselineFridays = baselineDates.filter((date) => new Date(`${date}T00:00:00Z`).getUTCDay() === 5);
function outcomeShift(successDates) {
  const successful = new Set(successDates);
  return estimate({
    sessions: [],
    entries: [],
    includeCandidates: false,
    groupAttemptOutcomes: baselineDates.map((activityDate) => ({
      activityDate,
      outcome: successful.has(activityDate) ? "success" : "failure",
      trainingState: "eligible",
      hasEligibleSnapshots: true,
    })),
  });
}
const oldFridaySuccesses = outcomeShift(baselineFridays.slice(0, 4));
const recentFridaySuccesses = outcomeShift(baselineFridays.slice(-4));
assert.equal(oldFridaySuccesses.weekdayBaseline.rows.find((row) => row.name === "周五").successes, 4);
assert.equal(recentFridaySuccesses.weekdayBaseline.rows.find((row) => row.name === "周五").successes, 4);
assert.ok(
  recentFridaySuccesses.weekdayBaseline.today > oldFridaySuccesses.weekdayBaseline.today + 0.08,
  "recent group outcomes must outweigh the same number of old outcomes in the weekday baseline",
);

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

const shiftingPlayers = makePlayers(14);
const shiftingStart = Date.parse("2026-06-30T00:00:00Z");
function shiftingHistory(recentlyFrequent) {
  return Array.from({ length: 33 }, (_, index) => {
    const candidateIsPresent = recentlyFrequent ? index >= 17 : index < 16;
    return session(
      isoDate(shiftingStart + index * 2 * 86400000),
      candidateIsPresent ? [1, 2, 3, 4, 5, 12] : [1, 2, 3, 4, 5, 6],
    );
  });
}
const recentHighFrequency = estimate({
  players: shiftingPlayers,
  sessions: shiftingHistory(true),
  entries: [],
  simulations: 5000,
  counterfactualSimulations: 100,
});
const recentLowFrequency = estimate({
  players: shiftingPlayers,
  sessions: shiftingHistory(false),
  entries: [],
  simulations: 5000,
  counterfactualSimulations: 100,
});
const recentHighCandidate = recentHighFrequency.candidates.find((candidate) => candidate.playerId === 12);
const recentLowCandidate = recentLowFrequency.candidates.find((candidate) => candidate.playerId === 12);
assert.ok(
  recentHighCandidate.attendanceProbability > recentLowCandidate.attendanceProbability * 1.2,
  "30-day half-life must let a recent frequency change outweigh equally sized older history",
);
assert.equal(recentHighFrequency.adaptation.historyHalfLifeDays, 30);
assert.equal(recentHighFrequency.adaptation.rawSuccessfulSessions, 33);
assert.ok(recentHighFrequency.adaptation.weightedSuccessfulSessions < 25, "old sessions should retain raw counts but lose effective weight");

const learningPlayers = makePlayers(15);
const newMemberId = 15;
const establishedLearningHistory = buildHistory(makePlayers(14));
const neverJoinedBase = {
  players: learningPlayers,
  sessions: establishedLearningHistory,
  entries: learningPlayers.slice(0, 5).map(regularEntry),
  includeCandidates: true,
  simulations: 5000,
  counterfactualSimulations: 160,
};
const neverJoined = estimate(neverJoinedBase);
assert.equal(
  neverJoined.candidates.find((candidate) => candidate.playerId === newMemberId),
  undefined,
  "a member without any real signup history must not enter shake recommendations",
);
const trackedSignupWithoutSuccessfulSession = estimate({
  ...neverJoinedBase,
  groupLearningSignals: {
    members: { [newMemberId]: { joinedWeight: 0.5 } },
  },
});
assert.ok(
  trackedSignupWithoutSuccessfulSession.candidates.some((candidate) => candidate.playerId === newMemberId),
  "a prior eligible signup should qualify even when that attempt did not become a successful session",
);
const companionOnlyPlayers = makePlayers(7);
const companionOnlyHistory = [session("2026-09-01", [1, 2, 3, 4, 5, 6], { 7: 1 })];
const companionOnlyOwner = estimate({
  players: companionOnlyPlayers,
  sessions: companionOnlyHistory,
  entries: [],
});
assert.equal(
  companionOnlyOwner.candidates.find((candidate) => candidate.playerId === 7),
  undefined,
  "being named only as a companion owner must not count as a personal signup",
);
const learningBase = {
  ...neverJoinedBase,
  sessions: [
    ...establishedLearningHistory,
    session("2026-06-01", [1, 2, 3, 4, 5, newMemberId]),
  ],
};
const newMemberColdStart = estimate(learningBase);
const zeroEvidenceColdStart = estimate({
  ...learningBase,
  groupLearningSignals: {
    priors: {
      participationRate: 0.7,
      participationEvidence: 0,
      regularRetention: 0.6,
      regularRetentionEvidence: 0,
      fatigueMultiplier: 0.8,
      fatigueEvidence: 0,
      largeLowRetention: 0.8,
      largeLowRetentionEvidence: 0,
    },
    members: {
      [newMemberId]: {
        participationRate: 0.9,
        participationReliability: 0,
        retentionRate: 0.6,
        retentionReliability: 0,
        largePreferenceConfidence: 0.9,
        largePreferenceEvidence: 0,
        secondDayRate: 0.9,
        secondDayEvidence: 0,
        thirdDayRate: 0.9,
        thirdDayEvidence: 0,
        companionRate: 0.9,
        companionMean: 3,
        companionReliability: 0,
      },
    },
  },
});
assert.equal(zeroEvidenceColdStart.todayProbability, newMemberColdStart.todayProbability, "zero-evidence signals must retain the existing prior");
assert.equal(zeroEvidenceColdStart.tomorrowProbability, newMemberColdStart.tomorrowProbability);
assert.deepEqual(zeroEvidenceColdStart.candidates, newMemberColdStart.candidates);
const newMemberLearnedHigh = estimate({
  ...learningBase,
  groupLearningSignals: {
    members: {
      [newMemberId]: {
        participationRate: 0.92,
        participationReliability: 0.98,
        retentionRate: 0.97,
        retentionReliability: 0.9,
        lastObservedDate: "2026-09-03",
      },
    },
  },
});
const coldNewCandidate = newMemberColdStart.candidates.find((candidate) => candidate.playerId === newMemberId);
const learnedNewCandidate = newMemberLearnedHigh.candidates.find((candidate) => candidate.playerId === newMemberId);
assert.ok(coldNewCandidate, "a member with successful-session history must enter the candidate pool");
assert.ok(coldNewCandidate.risks.includes("历史样本较少"));
assert.ok(
  learnedNewCandidate.attendanceProbability > coldNewCandidate.attendanceProbability * 1.5,
  "a reliable participation signal must replace cold-start behavior as new-member observations arrive",
);
assert.ok(learnedNewCandidate.reasons.includes("近期更常来"));
assert.equal(newMemberLearnedHigh.adaptation.memberSignalsApplied, 1);
const mediumReliabilityPosterior = estimate({
  ...learningBase,
  counterfactualSimulations: 40,
  groupLearningSignals: {
    generatedAt: "2026-09-04T00:00:00.000Z",
    members: { [newMemberId]: { participationRate: 0.7, participationReliability: 0.25 } },
  },
});
const highReliabilitySamePosterior = estimate({
  ...learningBase,
  counterfactualSimulations: 40,
  groupLearningSignals: {
    generatedAt: "2026-09-04T00:00:00.000Z",
    members: { [newMemberId]: { participationRate: 0.7, participationReliability: 1 } },
  },
});
assert.equal(
  mediumReliabilityPosterior.candidates.find((candidate) => candidate.playerId === newMemberId).attendanceProbability,
  highReliabilitySamePosterior.candidates.find((candidate) => candidate.playerId === newMemberId).attendanceProbability,
  "posterior participation must not be shrunk a second time by reliability",
);
const freshModelWithOldMemberObservation = estimate({
  ...learningBase,
  counterfactualSimulations: 40,
  groupLearningSignals: {
    generatedAt: "2026-09-04T00:00:00.000Z",
    members: {
      [newMemberId]: {
        participationRate: 0.7,
        participationReliability: 0.25,
        lastObservedDate: "2026-07-06",
      },
    },
  },
});
assert.equal(
  freshModelWithOldMemberObservation.candidates.find((candidate) => candidate.playerId === newMemberId).attendanceProbability,
  mediumReliabilityPosterior.candidates.find((candidate) => candidate.playerId === newMemberId).attendanceProbability,
  "lastObservedDate must not decay evidence already decayed by the learning core",
);
const thirtyDayOldPosterior = estimate({
  ...learningBase,
  counterfactualSimulations: 40,
  groupLearningSignals: {
    generatedAt: "2026-08-05T00:00:00.000Z",
    members: { [newMemberId]: { participationRate: 0.7, participationReliability: 0.25 } },
  },
});
const coldAttendance = coldNewCandidate.attendanceProbability;
const freshAttendance = mediumReliabilityPosterior.candidates.find((candidate) => candidate.playerId === newMemberId).attendanceProbability;
const staleAttendance = thirtyDayOldPosterior.candidates.find((candidate) => candidate.playerId === newMemberId).attendanceProbability;
const finalEffectDecay = (logOdds(staleAttendance) - logOdds(coldAttendance))
  / (logOdds(freshAttendance) - logOdds(coldAttendance));
assert.ok(
  finalEffectDecay > 0.4 && finalEffectDecay < 0.72,
  "a model generated 30 days ago should retain about half its end-to-end effect, not w^2 or w^3",
);
assert.equal(thirtyDayOldPosterior.adaptation.effectivePriors.freshness, 0.5);
for (const generatedAt of ["2026-09-03T16:00:00.000Z", "2026-09-03T23:59:59.000Z"]) {
  const legacyBeijingMorning = estimate({
    ...learningBase,
    includeCandidates: false,
    simulations: 400,
    groupLearningSignals: { generatedAt },
  });
  assert.equal(
    legacyBeijingMorning.adaptation.effectivePriors.freshness,
    1,
    "legacy UTC generatedAt during Beijing 00:00-07:59 must not decay an extra day",
  );
}
const explicitGeneratedDate = estimate({
  ...learningBase,
  includeCandidates: false,
  simulations: 400,
  groupLearningSignals: {
    generatedDate: "2026-09-04",
    generatedAt: "2026-08-05T00:00:00.000Z",
  },
});
assert.equal(explicitGeneratedDate.adaptation.effectivePriors.freshness, 1, "generatedDate must take precedence over legacy generatedAt");
const newMemberLearnedLow = estimate({
  ...learningBase,
  groupLearningSignals: {
    priors: { participationRate: 0.2, participationEvidence: 80 },
    members: {
      [newMemberId]: {
        participationRate: 0.03,
        participationReliability: 0.98,
        lastObservedDate: "2026-09-03",
      },
    },
  },
});
assert.ok(newMemberLearnedLow.candidates.find((candidate) => candidate.playerId === newMemberId).risks.includes("近期较少参与"));

const directionalForward = estimate({
  ...learningBase,
  entries: [regularEntry(learningPlayers[0])],
  groupLearningSignals: {
    influence: { 1: { 12: { lift: 0.15, evidence: 60, reliability: 0.95 } } },
  },
});
const directionalReverse = estimate({
  ...learningBase,
  entries: [regularEntry(learningPlayers[0])],
  groupLearningSignals: {
    influence: { 12: { 1: { lift: 0.15, evidence: 60, reliability: 0.95 } } },
  },
});
assert.ok(
  directionalForward.candidates.find((candidate) => candidate.playerId === 12).attendanceProbability
    > directionalReverse.candidates.find((candidate) => candidate.playerId === 12).attendanceProbability * 1.2,
  "learned social influence must be directional from the joined source to the candidate target",
);
assert.equal(directionalForward.adaptation.influenceEdgesApplied, 1);
const directionalMediumReliability = estimate({
  ...learningBase,
  entries: [regularEntry(learningPlayers[0])],
  groupLearningSignals: {
    influence: { 1: { 12: { lift: 0.15, evidence: 60, reliability: 0.2 } } },
  },
});
assert.equal(
  directionalMediumReliability.candidates.find((candidate) => candidate.playerId === 12).attendanceProbability,
  directionalForward.candidates.find((candidate) => candidate.playerId === 12).attendanceProbability,
  "posterior influence lift must use reliability as a gate, not multiply by it again",
);

const retainedSix = learningPlayers.slice(0, 6).map(regularEntry);
const reliableRetention = estimate({
  ...learningBase,
  entries: retainedSix,
  now: "2026-09-04T16:59:00+08:00",
  includeCandidates: false,
  groupLearningSignals: {
    members: { 6: { retentionRate: 0.99, retentionReliability: 1, lastObservedDate: "2026-09-03" } },
  },
});
const unreliableRetention = estimate({
  ...learningBase,
  entries: retainedSix,
  now: "2026-09-04T16:59:00+08:00",
  includeCandidates: false,
  groupLearningSignals: {
    members: { 6: { retentionRate: 0.08, retentionReliability: 1, lastObservedDate: "2026-09-03" } },
  },
});
assert.ok(reliableRetention.todayProbability > unreliableRetention.todayProbability + 0.2, "member retention learning must affect a current signup's stability");

const learnedLargePreference = estimate({
  ...learningBase,
  entries: retainedSix,
  now: "2026-09-04T16:59:00+08:00",
  includeCandidates: false,
  groupLearningSignals: {
    priors: { largeLowRetention: 0.12, largeLowRetentionEvidence: 80 },
    members: { 6: { largePreferenceConfidence: 0.99, largePreferenceEvidence: 80, lastObservedDate: "2026-09-03" } },
  },
});
const learnedSmallFriendly = estimate({
  ...learningBase,
  entries: retainedSix,
  now: "2026-09-04T16:59:00+08:00",
  includeCandidates: false,
  groupLearningSignals: {
    priors: { largeLowRetention: 0.12, largeLowRetentionEvidence: 80 },
    members: { 6: { largePreferenceConfidence: 0.001, largePreferenceEvidence: 80, lastObservedDate: "2026-09-03" } },
  },
});
assert.ok(
  learnedSmallFriendly.todayProbability > learnedLargePreference.todayProbability + 0.25,
  "learned large-session preference and low-count retention prior must affect sub-ten stability",
);
const learnedLargeMediumEvidence = estimate({
  ...learningBase,
  entries: retainedSix,
  now: "2026-09-04T16:59:00+08:00",
  includeCandidates: false,
  groupLearningSignals: {
    priors: {
      largePreferenceRate: 0.08,
      largePreferenceEvidence: 2,
      largeLowRetention: 0.12,
      largeLowRetentionEvidence: 2,
    },
    members: { 6: { largePreferenceConfidence: 0.99, largePreferenceEvidence: 2 } },
  },
});
const learnedLargeHighEvidenceSamePosterior = estimate({
  ...learningBase,
  entries: retainedSix,
  now: "2026-09-04T16:59:00+08:00",
  includeCandidates: false,
  groupLearningSignals: {
    priors: {
      largePreferenceRate: 0.08,
      largePreferenceEvidence: 200,
      largeLowRetention: 0.12,
      largeLowRetentionEvidence: 200,
    },
    members: { 6: { largePreferenceConfidence: 0.99, largePreferenceEvidence: 200 } },
  },
});
assert.equal(
  learnedLargeMediumEvidence.todayProbability,
  learnedLargeHighEvidenceSamePosterior.todayProbability,
  "large-session posteriors must not be shrunk again by evidence",
);

const adaptiveFatigueHistory = [...buildHistory(learningPlayers), session("2026-09-03", [10, 11, 12, 13, 14, 1])];
const learnedSecondDayStrong = estimate({
  ...learningBase,
  sessions: adaptiveFatigueHistory,
  entries: [],
  groupLearningSignals: {
    members: {
      10: {
        participationRate: 0.7,
        participationReliability: 0.9,
        secondDayRate: 0.68,
        secondDayEvidence: 80,
        lastObservedDate: "2026-09-03",
      },
    },
  },
});
const learnedSecondDayWeak = estimate({
  ...learningBase,
  sessions: adaptiveFatigueHistory,
  entries: [],
  groupLearningSignals: {
    members: {
      10: {
        participationRate: 0.7,
        participationReliability: 0.9,
        secondDayRate: 0.05,
        secondDayEvidence: 80,
        lastObservedDate: "2026-09-03",
      },
    },
  },
});
assert.ok(
  learnedSecondDayStrong.candidates.find((candidate) => candidate.playerId === 10).attendanceProbability
    > learnedSecondDayWeak.candidates.find((candidate) => candidate.playerId === 10).attendanceProbability * 2,
  "learned consecutive-day rates must adapt the fatigue penalty",
);
const learnedSecondDayMediumEvidence = estimate({
  ...learningBase,
  sessions: adaptiveFatigueHistory,
  entries: [],
  groupLearningSignals: {
    members: {
      10: {
        participationRate: 0.7,
        participationReliability: 0.2,
        secondDayRate: 0.68,
        secondDayEvidence: 2,
      },
    },
  },
});
assert.equal(
  learnedSecondDayMediumEvidence.candidates.find((candidate) => candidate.playerId === 10).attendanceProbability,
  learnedSecondDayStrong.candidates.find((candidate) => candidate.playerId === 10).attendanceProbability,
  "member fatigue posteriors must use evidence as a gate rather than a second shrinkage factor",
);

const thirdDayHistory = [
  ...buildHistory(learningPlayers),
  session("2026-09-02", [10, 11, 12, 13, 14, 1]),
  session("2026-09-03", [10, 11, 12, 13, 14, 1]),
];
const learnedThirdDayStrong = estimate({
  ...learningBase,
  sessions: thirdDayHistory,
  entries: [],
  groupLearningSignals: {
    members: { 10: {
      participationRate: 0.7,
      participationReliability: 0.9,
      thirdDayRate: 0.68,
      thirdDayEvidence: 80,
      lastObservedDate: "2026-09-03",
    } },
  },
});
const learnedThirdDayWeak = estimate({
  ...learningBase,
  sessions: thirdDayHistory,
  entries: [],
  groupLearningSignals: {
    members: { 10: {
      participationRate: 0.7,
      participationReliability: 0.9,
      thirdDayRate: 0.04,
      thirdDayEvidence: 80,
      lastObservedDate: "2026-09-03",
    } },
  },
});
assert.ok(
  learnedThirdDayStrong.candidates.find((candidate) => candidate.playerId === 10).attendanceProbability
    > learnedThirdDayWeak.candidates.find((candidate) => candidate.playerId === 10).attendanceProbability * 2,
  "third-day evidence must adapt independently from second-day evidence",
);

const companionOwnerEntry = regularEntry(learningPlayers[13]);
const learnedCompanionHigh = estimate({
  ...learningBase,
  entries: [...learningPlayers.slice(0, 4).map(regularEntry), companionOwnerEntry],
  now: "2026-09-04T16:59:00+08:00",
  includeCandidates: false,
  groupLearningSignals: {
    members: { 14: {
      companionRate: 0.9,
      companionMean: 1.8,
      companionReliability: 0.98,
      lastObservedDate: "2026-09-03",
    } },
  },
});
const learnedCompanionLow = estimate({
  ...learningBase,
  entries: [...learningPlayers.slice(0, 4).map(regularEntry), companionOwnerEntry],
  now: "2026-09-04T16:59:00+08:00",
  includeCandidates: false,
  groupLearningSignals: {
    members: { 14: {
      companionRate: 0.01,
      companionMean: 0,
      companionReliability: 0.98,
      lastObservedDate: "2026-09-03",
    } },
  },
});
assert.ok(
  learnedCompanionHigh.todayProbability > learnedCompanionLow.todayProbability + 0.35,
  "learned companion rate and mean must adapt the +N distribution even without successful-session history",
);
const establishedGuestStart = Date.parse("2026-07-25T00:00:00Z");
const establishedGuestHistory = Array.from({ length: 20 }, (_, index) => session(
  isoDate(establishedGuestStart + index * 2 * 86400000),
  [1, 2, 3, 4, 5, 14],
  { 14: 3 },
));
const establishedGuestInput = {
  ...learningBase,
  sessions: establishedGuestHistory,
  entries: [...learningPlayers.slice(0, 4).map(regularEntry), companionOwnerEntry],
  now: "2026-09-04T16:59:00+08:00",
  includeCandidates: false,
};
const establishedGuestBase = estimate(establishedGuestInput);
const oneNegativeCompanionObservation = estimate({
  ...establishedGuestInput,
  groupLearningSignals: {
    generatedAt: "2026-09-04T00:00:00.000Z",
    members: { 14: {
      companionRate: 0.05,
      companionMean: 0.05,
      companionReliability: 1 / 6,
    } },
  },
});
assert.ok(
  oneNegativeCompanionObservation.todayProbability >= establishedGuestBase.todayProbability - 0.15,
  "one tracked no-companion observation must not replace twenty recent +3 session observations",
);

const retentionCurvePlayers = makePlayers(6);
const retentionCurveInput = {
  players: retentionCurvePlayers,
  sessions: [session("2026-08-30", [1, 2, 3, 4, 5, 6])],
  entries: retentionCurvePlayers.map(regularEntry),
  includeCandidates: false,
  groupLearningSignals: {
    priors: { regularRetention: 0.7, regularRetentionEvidence: 100 },
  },
  simulations: 8000,
};
const learnedRetentionMorning = estimate({ ...retentionCurveInput, now: "2026-09-04T09:00:00+08:00" });
const learnedRetentionNearCutoff = estimate({ ...retentionCurveInput, now: "2026-09-04T16:59:00+08:00" });
assert.ok(
  learnedRetentionNearCutoff.todayProbability > learnedRetentionMorning.todayProbability,
  "a learned regular-retention prior must preserve the existing increase near activity time",
);
const multiplierOnePointOne = estimate({
  ...learningBase,
  includeCandidates: false,
  simulations: 400,
  groupLearningSignals: {
    generatedAt: "2026-09-04T00:00:00.000Z",
    priors: { fatigueMultiplier: 1.1, fatigueEvidence: 2 },
  },
});
const multiplierOnePointOneMoreEvidence = estimate({
  ...learningBase,
  includeCandidates: false,
  simulations: 400,
  groupLearningSignals: {
    generatedAt: "2026-09-04T00:00:00.000Z",
    priors: { fatigueMultiplier: 1.1, fatigueEvidence: 200 },
  },
});
const multiplierAtUpperBound = estimate({
  ...learningBase,
  includeCandidates: false,
  simulations: 400,
  groupLearningSignals: {
    generatedAt: "2026-09-04T00:00:00.000Z",
    priors: { fatigueMultiplier: 1.25, fatigueEvidence: 2 },
  },
});
assert.equal(multiplierOnePointOne.adaptation.effectivePriors.fatigueMultiplier, 1.1);
assert.equal(multiplierOnePointOneMoreEvidence.adaptation.effectivePriors.fatigueMultiplier, 1.1, "global posterior evidence must gate, not shrink twice");
assert.equal(multiplierAtUpperBound.adaptation.effectivePriors.fatigueMultiplier, 1.25, "fatigue multipliers above one must not be truncated as probabilities");

const impossible = estimate({ players: [], sessions: [], entries: [], simulations: 400, calibrationSimulations: 200 });
assert.equal(impossible.todayProbability, 0, "without players or entries a group cannot form");
assert.equal(impossible.tomorrowProbability, 0);
assert.deepEqual(impossible.candidates, []);

console.log("Group probability verification passed.");
