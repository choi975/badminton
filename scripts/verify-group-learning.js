import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildGroupLearningSignals,
  GROUP_LEARNING_VERSION,
} from "../src/group-learning-core.js";

const publishSource = readFileSync(new URL("./publish-group-learning-cache.js", import.meta.url), "utf8");

const NOW = "2026-09-04T04:30:00.000Z";

function players(count, createdAt = "2026-01-01 00:00:00") {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    name: `成员${index + 1}`,
    createdAt,
  }));
}

function snapshot(id, observedAt, ids, options = {}) {
  const companions = options.companions || [];
  const companionCount = companions.reduce((sum, item) => sum + Number(item.count || item[1] || 0), 0);
  return {
    id,
    observedAt,
    trainingState: options.trainingState || "eligible",
    participantCount: options.participantCount ?? ids.length + companionCount,
    knownPlayerIds: ids,
    companionsByOwner: companions,
  };
}

function attempt(id, date, snapshots, options = {}) {
  return {
    id,
    activityDate: date,
    outcome: options.outcome || "failure",
    trainingState: options.trainingState || "eligible",
    source: options.source || "tracked",
    snapshots,
  };
}

function session(id, date, ids, participantCount = Math.max(6, ids.length), companions = {}) {
  const rows = ids.map((playerId) => ({
    playerId,
    ownerPlayerId: playerId,
    isCompanion: false,
    slots: 1 + Number(companions[playerId] || 0),
    plusCount: Number(companions[playerId] || 0),
  }));
  return { id, date, participantCount, players: rows };
}

function build(overrides = {}) {
  return buildGroupLearningSignals({
    players: overrides.players || players(12),
    sessions: overrides.sessions || [],
    attempts: overrides.attempts || [],
    now: overrides.now || NOW,
    halfLifeDays: overrides.halfLifeDays || 30,
  });
}

function oddsScaledProbability(probability, multiplier = 0.2) {
  const scaledOdds = (probability / (1 - probability)) * multiplier;
  return scaledOdds / (1 + scaledOdds);
}

const cold = build({ players: players(2) });
assert.equal(GROUP_LEARNING_VERSION, "group-learning-v1");
assert.equal(cold.version, GROUP_LEARNING_VERSION);
assert.equal(cold.generatedAt, NOW);
assert.equal(cold.generatedDate, "2026-09-04", "generatedDate必须使用北京时间日期边界");
assert.equal(cold.priors.regularRetention, 0.95, "无留存数据必须回退0.95先验");
assert.equal(cold.priors.fatigueMultiplier, 0.2, "无体力数据必须回退0.2先验");
assert.equal(cold.members[1].secondDayRate, Number(oddsScaledProbability(cold.members[1].participationRate).toFixed(6)));
assert.equal(cold.priors.largeLowRetention, 0.3, "无大局退出数据必须回退0.3先验");
assert.equal(cold.members[1].participationRate, cold.priors.participationRate, "冷启动成员应使用群体先验");
assert.equal(cold.members[1].participationReliability, 0);
assert.doesNotThrow(() => JSON.stringify(cold), "训练结果必须可安全序列化");
assert.deepEqual(cold, build({ players: players(2) }), "同一输入和now必须得到确定性结果");

const trialAttempts = [
  attempt(1, "2026-09-01", [snapshot(1, "2026-09-01T08:00:00Z", [1])], { trainingState: "excluded" }),
  attempt(2, "2026-09-02", [snapshot(2, "2026-09-02T08:00:00Z", [1])], { source: "trial" }),
  attempt(3, "2026-09-03", [
    snapshot(3, "2026-09-03T08:00:00Z", [1], { trainingState: "excluded" }),
    snapshot(4, "2026-09-03T08:05:00Z", [2]),
  ]),
];
const trialSafe = build({ players: players(2), attempts: trialAttempts });
assert.equal(trialSafe.training.eligibleAttemptCount, 1, "整次试算和trial来源都不得训练");
assert.equal(trialSafe.training.eligibleSnapshotCount, 1, "单张excluded快照不得训练");
assert.equal(trialSafe.members[1].joinedWeight, 0, "试算名单不能污染成员频率");
assert.ok(trialSafe.members[2].joinedWeight > 0);

const membershipPlayers = [
  { id: 1, name: "老成员", createdAt: "2026-01-01 00:00:00" },
  { id: 2, name: "新成员", createdAt: "2026-09-03 23:59:00" },
  { id: 3, name: "尚无历史的新成员" },
];
const membershipAttempts = [
  attempt(1, "2026-08-01", [snapshot(1, "2026-08-01T08:00:00Z", [])]),
  attempt(2, "2026-09-03", [snapshot(2, "2026-09-03T08:00:00Z", [])]),
  attempt(3, "2026-09-04", [snapshot(3, "2026-09-04T02:00:00Z", [1, 2])], { outcome: "success" }),
];
const membership = build({ players: membershipPlayers, attempts: membershipAttempts });
assert.ok(membership.members[1].attemptWeight > membership.members[2].attemptWeight);
assert.equal(membership.members[2].attemptWeight, 1, "北京时间入群当天起才应计机会日");
assert.equal(membership.members[3].attemptWeight, 0, "无创建日且从未出现的新成员不得背历史缺席");
assert.equal(membership.members[3].participationRate, membership.priors.participationRate);

const frequencyAttempts = [];
for (let index = 0; index < 6; index += 1) {
  const oldDay = String(index + 1).padStart(2, "0");
  frequencyAttempts.push(attempt(index + 1, `2026-06-${oldDay}`, [
    snapshot(index + 1, `2026-06-${oldDay}T08:00:00Z`, [1]),
  ]));
  const recentDay = String(27 + index).padStart(2, "0");
  frequencyAttempts.push(attempt(20 + index, `2026-08-${recentDay}`, [
    snapshot(20 + index, `2026-08-${recentDay}T08:00:00Z`, [2]),
  ]));
}
const frequency = build({ players: players(2), attempts: frequencyAttempts });
assert.ok(
  frequency.members[2].participationRate > frequency.members[1].participationRate,
  "相同次数下，近期频繁成员应高于很久以前频繁成员",
);
assert.equal(
  frequency.members[1].lastObservedDate,
  "2026-08-31",
  "近期持续缺席也必须把参与率信号的新鲜度更新到最近机会日",
);
assert.equal(frequency.members[2].lastObservedDate, "2026-08-31");

const decay = build({
  players: players(1),
  attempts: [
    attempt(1, "2026-08-05", [snapshot(1, "2026-08-05T08:00:00Z", [1])]),
    attempt(2, "2026-09-04", [snapshot(2, "2026-09-04T02:00:00Z", [1])], { outcome: "success" }),
  ],
});
assert.equal(decay.members[1].attemptWeight, 1.5, "30天前证据权重应正好衰减一半");
assert.equal(decay.members[1].joinedWeight, 1.5);

function relationshipAttempt(id, date) {
  return attempt(id, date, [
    snapshot(id * 10 + 1, `${date}T07:00:00Z`, [1]),
    snapshot(id * 10 + 2, `${date}T07:05:00Z`, [1, 2]),
    snapshot(id * 10 + 3, `${date}T07:10:00Z`, [1, 2, 3]),
  ]);
}

const oneRelationshipEvent = build({
  players: players(3),
  attempts: [relationshipAttempt(1, "2026-09-01")],
});
const twoRelationshipEvents = build({
  players: players(3),
  attempts: [relationshipAttempt(1, "2026-09-01"), relationshipAttempt(2, "2026-09-02")],
});
assert.equal(oneRelationshipEvent.influence[1]?.[2], undefined, "单次私有时间线事件不得进入公开关系聚合");
assert.equal(twoRelationshipEvents.influence[1]?.[2], undefined, "两次私有时间线事件仍不足以发布关系");

const relationship = build({
  players: players(3),
  attempts: [
    relationshipAttempt(1, "2026-09-01"),
    relationshipAttempt(2, "2026-09-02"),
    relationshipAttempt(3, "2026-09-03"),
  ],
});
assert.ok(relationship.influence[1][2].lift > 0, "先加入的成员应对下一位形成收缩后的正向概率点差");
assert.ok(relationship.influence[2][3].lift > 0);
assert.equal(relationship.influence[1][2].rawSuccessEvents, 3, "关系门槛必须按独立事件数而非衰减权重判断");
assert.equal(relationship.influence[2]?.[1], undefined, "时间顺序相反时不得生成反向关系");
assert.equal(relationship.influence[1]?.[3], undefined, "只有曝光但未在下一步加入不能生成负关系边");
assert.ok(relationship.influence[1][2].lift <= 0.15, "关系lift必须严格封顶");

const tenIds = Array.from({ length: 10 }, (_, index) => index + 1);
const largeExit = build({
  players: players(10),
  attempts: [attempt(1, "2026-09-03", [
    snapshot(1, "2026-09-03T07:00:00Z", tenIds, { participantCount: 10 }),
    snapshot(2, "2026-09-03T07:10:00Z", tenIds.slice(1), { participantCount: 9 }),
  ])],
});
assert.ok(
  largeExit.members[1].largePreferenceConfidence > largeExit.members[2].largePreferenceConfidence,
  "跌破10人时退出应比留在小局提供更强的大局偏好证据",
);
assert.ok(largeExit.members[1].largePreferenceEvidence > 0);
assert.ok(largeExit.priors.largeLowRetention < 0.3, "大局偏好成员的小局退出应向下校准留存率");

const staminaSessions = [
  session(1, "2026-09-01", [1, 2, 3, 4, 5, 6]),
  session(2, "2026-09-02", [1, 3, 4, 5, 6, 7]),
  session(3, "2026-09-03", [1, 4, 5, 6, 7, 8]),
];
const sessionsOnly = build({ players: players(10), sessions: staminaSessions });
assert.equal(sessionsOnly.priors.fatigueMultiplier, 0.2, "没有真实追踪机会时不得只从成功局学习体力");
assert.equal(sessionsOnly.priors.fatigueEvidence, 0);
assert.equal(sessionsOnly.priors.observedFatigueEvidence, 0);
assert.equal(sessionsOnly.priors.largePreferenceEvidence, 0, "订场历史的大局信息由概率核心直接学习，聚合器不得双计");
assert.equal(sessionsOnly.priors.companionEvidence, 0, "订场历史的带人信息由概率核心直接学习，聚合器不得双计");

const explicitZeroSession = {
  id: 10,
  date: "2026-09-01",
  players: [
    { playerId: 1, ownerPlayerId: 1, slots: 0, plusCount: 0 },
    ...[2, 3, 4, 5, 6].map((playerId) => ({ playerId, ownerPlayerId: playerId })),
  ],
};
const explicitZero = build({ players: players(6), sessions: [explicitZeroSession] });
assert.equal(explicitZero.members[1].lastObservedDate, null, "显式slots=0的本人绝不能算实际出席");
assert.equal(explicitZero.members[2].lastObservedDate, "2026-09-01", "缺失slots的简化测试行应默认1人");
const explicitZeroFatigue = build({
  players: players(6),
  sessions: [explicitZeroSession],
  attempts: [attempt(1, "2026-09-02", [snapshot(1, "2026-09-02T08:00:00Z", [])])],
});
assert.equal(explicitZeroFatigue.priors.observedFatigueEvidence, 0, "显式0不得把实际5人误计为达到6人的昨日场次");

const staminaAttempts = [
  attempt(1, "2026-09-02", [snapshot(1, "2026-09-02T08:00:00Z", [1, 3, 4, 5, 6, 7])], { outcome: "success" }),
  attempt(2, "2026-09-03", [snapshot(2, "2026-09-03T08:00:00Z", [1, 4, 5, 6, 7, 8])], { outcome: "success" }),
];
const stamina = build({ players: players(10), sessions: staminaSessions, attempts: staminaAttempts });
assert.ok(stamina.members[1].secondDayRate > stamina.members[2].secondDayRate, "连续出席者应学到更高的第二天出席率");
assert.ok(stamina.members[1].secondDayEvidence > 0);
assert.ok(stamina.members[1].thirdDayEvidence > 0, "连续两天后第三天应形成独立体力证据");
assert.ok(stamina.members[1].thirdDayRate > stamina.members[3].thirdDayRate);
assert.equal(stamina.priors.fatigueMultiplier, 0.2, "活跃成员样本不得上调群体体力倍率");
assert.equal(stamina.priors.fatigueEvidence, 0, "消费者不得启用有选择偏差的群体体力样本");
assert.ok(stamina.priors.observedFatigueEvidence > 0, "原始体力机会可保留作诊断");
assert.ok(
  stamina.members[1].secondDayRate > oddsScaledProbability(stamina.members[1].participationRate) + 0.1,
  "具体成员重复连打的证据仍应明显提高个人条件率",
);

const failedFatigue = build({
  players: players(6),
  sessions: [session(1, "2026-09-01", [1, 2, 3, 4, 5, 6])],
  attempts: [attempt(1, "2026-09-02", [snapshot(1, "2026-09-02T08:00:00Z", [])], { outcome: "failure" })],
});
assert.equal(failedFatigue.priors.fatigueEvidence, 0);
assert.ok(failedFatigue.priors.observedFatigueEvidence > 0, "昨天出席者在今天真实尝试中应形成诊断机会");
assert.equal(failedFatigue.priors.fatigueMultiplier, 0.2, "成员失败证据不能改变群体倍率");
assert.ok(
  failedFatigue.members[1].secondDayRate < oddsScaledProbability(failedFatigue.members[1].participationRate),
  "流局最后名单无人时应下调具体成员条件率",
);

const partialFailureFatigue = build({
  players: players(6),
  sessions: [session(1, "2026-09-01", [1, 2, 3, 4, 5, 6])],
  attempts: [attempt(1, "2026-09-02", [
    snapshot(1, "2026-09-02T08:00:00Z", [1, 2, 3, 4, 5]),
  ], { outcome: "failure" })],
});
assert.equal(partialFailureFatigue.members[1].secondDayEvidence, partialFailureFatigue.members[6].secondDayEvidence);
assert.ok(
  partialFailureFatigue.members[1].secondDayRate > partialFailureFatigue.members[6].secondDayRate,
  "流局最后名单中的昨日球友应算连续意愿成功，缺席者才算失败",
);
assert.ok(
  partialFailureFatigue.priors.observedFatigueSuccessWeight > failedFatigue.priors.observedFatigueSuccessWeight,
  "流局不能把最后仍报名的成员全部记为0",
);

const neutralFrequencyAttempts = [];
const neutralFatigueSessions = [];
for (const [index, firstDay] of [4, 8, 12, 16, 20, 24, 28].entries()) {
  const secondDate = `2026-08-${String(firstDay + 1).padStart(2, "0")}`;
  neutralFatigueSessions.push(session(20 + index * 2, `2026-08-${String(firstDay).padStart(2, "0")}`, [1, 2, 3, 4, 5, 6]));
  neutralFatigueSessions.push(session(21 + index * 2, `2026-08-${String(firstDay + 1).padStart(2, "0")}`, [1, 2, 3, 7, 8, 9]));
  neutralFrequencyAttempts.push(attempt(20 + index, secondDate, [
    snapshot(20 + index, `${secondDate}T08:00:00Z`, [1, 2, 3, 7, 8, 9]),
  ], { outcome: "success" }));
}
neutralFatigueSessions.push(session(40, "2026-09-01", [1, 2, 3, 4, 5, 6]));
neutralFatigueSessions.push(session(41, "2026-09-02", [1, 2, 3, 7, 8, 9]));
neutralFrequencyAttempts.push(attempt(40, "2026-09-02", [
  snapshot(40, "2026-09-02T08:00:00Z", [1, 2, 3, 7, 8, 9]),
], { outcome: "success" }));
const neutralFatigue = build({
  players: players(12),
  attempts: neutralFrequencyAttempts,
  sessions: neutralFatigueSessions,
});
assert.ok(
  Math.abs(
    neutralFatigue.priors.fatigueConditionalRate
      - oddsScaledProbability(neutralFatigue.priors.participationRate)
  ) < 0.000002,
  "群体条件率必须始终由参与率赔率乘保守倍率得到",
);
assert.equal(neutralFatigue.priors.fatigueMultiplier, 0.2, "固定活跃成员不能因选择偏差把全局倍率推高");
assert.ok(neutralFatigue.members[1].secondDayRate > neutralFatigue.members[10].secondDayRate);

const companion = build({
  players: players(2),
  attempts: [attempt(1, "2026-09-03", [
    snapshot(1, "2026-09-03T08:00:00Z", [1, 2], {
      companions: [{ ownerPlayerId: 1, count: 3 }],
    }),
  ])],
});
assert.ok(companion.members[1].companionMean > companion.members[2].companionMean, "+N应自动形成成员带人信号");
assert.ok(companion.members[1].companionReliability > 0);

const temporaryFiveAttempt = attempt(1, "2026-09-03", [
  snapshot(1, "2026-09-03T07:00:00Z", [1, 2, 3, 4, 5, 6], {
    companions: [{ ownerPlayerId: 1, count: 5 }],
  }),
], { outcome: "success" });
const temporaryFiveRemoved = build({
  players: players(6),
  attempts: [temporaryFiveAttempt],
  sessions: [session(1, "2026-09-03", [1, 2, 3, 4, 5, 6], 6)],
});
const finalFive = build({
  players: players(6),
  attempts: [temporaryFiveAttempt],
  sessions: [session(1, "2026-09-03", [1, 2, 3, 4, 5, 6], 11, { 1: 5 })],
});
assert.ok(
  temporaryFiveRemoved.members[1].companionMean < finalFive.members[1].companionMean,
  "成功局临时+5后全撤必须以实际订场的最终0人为标签",
);
assert.ok(temporaryFiveRemoved.members[1].companionMean < 0.1, "全天峰值不得泄漏到最终带人数标签");

const failedTemporaryFive = build({
  players: players(2),
  attempts: [attempt(1, "2026-09-03", [
    snapshot(1, "2026-09-03T07:00:00Z", [1], { companions: [{ ownerPlayerId: 1, count: 5 }] }),
    snapshot(2, "2026-09-03T08:00:00Z", [1]),
  ])],
});
assert.ok(failedTemporaryFive.members[1].companionReliability > 0);
assert.ok(failedTemporaryFive.members[1].companionMean < 0.1, "流局必须用最后快照的0人而不是全天+N峰值");

const absentOwnerGuests = build({
  players: players(2),
  attempts: [attempt(1, "2026-09-03", [
    snapshot(1, "2026-09-03T08:00:00Z", [], {
      companions: [{ ownerPlayerId: 1, count: 2 }],
    }),
  ])],
});
assert.equal(absentOwnerGuests.members[1].joinedWeight, 0, "只有随行者出现时不能算owner本人参与");
assert.equal(absentOwnerGuests.members[1].retentionReliability, 0, "只有随行者出现时不能算owner留存");
assert.equal(absentOwnerGuests.members[1].largePreferenceEvidence, 0, "只有随行者出现时不能算owner大局偏好");
assert.ok(absentOwnerGuests.members[1].companionReliability > 0, "owner缺席时仍应学习其最终随行人数");
assert.ok(absentOwnerGuests.members[1].companionMean > absentOwnerGuests.members[2].companionMean);

for (const model of [cold, trialSafe, membership, frequency, decay, oneRelationshipEvent, twoRelationshipEvents, relationship, largeExit, sessionsOnly, explicitZero, explicitZeroFatigue, stamina, failedFatigue, partialFailureFatigue, neutralFatigue, companion, temporaryFiveRemoved, finalFive, failedTemporaryFive, absentOwnerGuests]) {
  assert.ok(model.priors.regularRetention >= 0.5 && model.priors.regularRetention <= 0.995);
  assert.ok(model.priors.fatigueMultiplier >= 0.05 && model.priors.fatigueMultiplier <= 1.25);
  assert.equal(model.priors.fatigueEvidence, 0);
  assert.ok(model.priors.fatigueConditionalRate >= 0.001 && model.priors.fatigueConditionalRate <= 0.95);
  assert.ok(model.priors.largeLowRetention >= 0.05 && model.priors.largeLowRetention <= 0.9);
  for (const member of Object.values(model.members)) {
    assert.ok(member.participationRate >= 0.01 && member.participationRate <= 0.95);
    assert.ok(member.retentionRate >= 0.5 && member.retentionRate <= 0.995);
    assert.ok(member.largePreferenceConfidence >= 0 && member.largePreferenceConfidence <= 0.95);
  }
}

assert.throws(
  () => buildGroupLearningSignals({ now: NOW, halfLifeDays: 0 }),
  /greater than zero/,
);

assert.match(publishSource, /group_learning_model_cache/);
assert.match(publishSource, /"--remote", "--file"/);
assert.match(publishSource, /mkdtemp/);
assert.match(publishSource, /replaceAll\("'", "''"\)/);

console.log("Group learning verification passed.");
