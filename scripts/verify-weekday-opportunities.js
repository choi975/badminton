import assert from 'node:assert/strict';
import '../member-statistics.js';
import '../group-probability.js';

const core = globalThis.BadmintonMemberStatistics;
const engine = globalThis.BadmintonGroupProbability;
const calendar = { knownYears: [2026], excludedDates: [] };
const targetDates = ['2026-11-15', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14'];
const logit = p => Math.log(p / (1 - p));
const odds = p => p / (1 - p);
const summaries = [];
assert.equal(core.WEEKDAY_POLICY.minAvoidedOpportunities, 1);
assert.equal(core.WEEKDAY_POLICY.minOtherAttendanceDays, 2);

for (const [weekday, targetDate] of targetDates.entries()) {
  const now = targetDate + 'T09:00:00+08:00';
  const players = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, name: '成员' + (i + 1), level: '3级', createdAt: '2026-01-01' }));
  players[2].createdAt = core.addDays(targetDate, -6);
  let nextId = 1;
  const session = (date, ids, count = 10) => ({ id: nextId++, date, players: [
    ...ids.map(playerId => ({ playerId, ownerPlayerId: playerId, slots: 1, plusCount: 0 })),
    { playerId: null, ownerPlayerId: 5, isCompanion: true, slots: count - ids.length, plusCount: count - ids.length },
  ] });
  const base = [
    session(core.addDays(targetDate, -10), [1, 2, 4]),
    session(core.addDays(targetDate, -9), [1, 2]),
    session(core.addDays(targetDate, -4), [3]),
    session(core.addDays(targetDate, -3), [3]),
  ];
  const opportunityDates = [7, 14, 21, 28].map(days => core.addDays(targetDate, -days));
  const opportunities = opportunityDates.map(date => session(date, [2]));
  const build = (sessions, extra = {}) => core.build({ players, sessions, now, calendar, ...extra });
  const ids = statistics => statistics.lists.find(list => list.key === 'noWeekday' + weekday).memberIds;
  const evidence = (statistics, id = 1) => statistics.members.find(m => m.playerId === id)?.weekdayEvidence30[weekday];
  const tag = '周' + '日一二三四五六'[weekday] + '可能无法打球';
  const tags = (statistics, id = 1, date = targetDate) => core.recommendationTags({ statistics, playerId: id, targetDate: date, currentCount: 10 });
  const entries = Array.from({ length: 10 }, (_, i) => ({ clean: '确认' + i, slots: 1 }));
  const estimate = (sessions, extra = {}) => engine.estimate({ players, sessions, now, targetDate, entries, memberStatistics: { calendar },
    simulations: 120, calibrationSimulations: 100, includeCounterfactuals: false, seed: 611, ...extra });
  const candidate = prediction => prediction.candidates.find(row => row.playerId === 1);
  const results = [];
  for (let count = 0; count <= 4; count++) {
    const sessions = [...base, ...opportunities.slice(0, count)];
    const statistics = build(sessions);
    assert.equal(evidence(statistics).opportunityDays, count);
    assert.equal(evidence(statistics).otherAttendanceDays, 2);
    assert.equal(ids(statistics).includes(1), count >= 1, 'all seven weekday groups use the one-opportunity gate');
    assert.equal(tags(statistics).risks.includes(tag), count >= 1, 'labels use exactly the same gate as the lists');
    assert.ok(!ids(statistics).includes(2), 'a member who attended is not labeled unavailable');
    assert.ok(!ids(statistics).includes(3), 'pre-membership games are not missed opportunities');
    assert.ok(!ids(statistics).includes(4), 'one other attendance day is still insufficient');
    assert.ok(!ids(statistics).includes(5), 'companion-only participation does not create owner attendance');
    const prediction = estimate(sessions);
    const row = candidate(prediction);
    assert.equal(prediction.assumptions.weekdayHabits.minAvoidedOpportunities, 1);
    assert.equal(prediction.assumptions.weekdayHabits.avoidanceEvidencePriorStrength, 6);
    assert.equal(row.risks.includes(tag), count >= 1);
    const multiplier = row.factors.weekdayOddsMultiplier;
    if (!count) assert.equal(multiplier, 1, 'zero opportunities remain neutral');
    else {
      assert.ok(multiplier > 0 && multiplier < 1, 'one/two opportunities change probability, not just the label');
      const neutral = candidate(estimate(sessions, { memberStatistics: { calendar: { ...calendar, excludedDates: [targetDate] } } }));
      const overall = neutral.factors.baseline;
      const weekdayRate = 2 * overall / (evidence(statistics).opportunityWeight + 2);
      const boundedEffect = Math.max(Math.log(0.2), Math.min(0, 2.5 * (logit(weekdayRate) - logit(overall))));
      const confidence = count === 1 ? 1 / 7 : count === 2 ? 1 / 4 : (count - 2) / 3;
      assert.ok(Math.abs(multiplier - Math.exp(confidence * boundedEffect)) < 0.00002,
        'one/two opportunities are conservative; three/four keep the previous exact confidence');
      assert.ok(Math.abs(odds(row.attendanceProbability) / odds(neutral.attendanceProbability) - multiplier) < 0.00005,
        'weekday probability effect is applied once');
      assert.ok(row.attendanceProbability < neutral.attendanceProbability);
      assert.ok(row.attendanceProbability > 0, 'inferred absence is not a hard ban');
      if (count <= 2) assert.ok(multiplier >= 0.2 ** confidence - 0.000001, 'sparse evidence cannot apply the maximum penalty');
    }
    results.push({ opportunities: count, multiplier });
  }
  const once = [...base, opportunities[0]];
  const statistics = build(once);
  const twiceSameDay = build([...once, { ...opportunities[0] }, session(opportunityDates[0], [2])]);
  assert.equal(evidence(twiceSameDay).opportunityDays, 1, 'duplicates and same-day sessions do not inflate evidence');
  assert.deepEqual(ids(twiceSameDay), ids(statistics));
  assert.equal(ids(build([...base, session(opportunityDates[0], [2], 5)])).includes(1), false, 'unformed games remain excluded');
  assert.equal(ids(build(once, { calendar: { ...calendar, excludedDates: [opportunityDates[0]] } })).includes(1), false, 'holiday opportunities remain excluded');
  assert.ok(!tags({ ...statistics, calendar: { ...calendar, excludedDates: [targetDate] } }).risks.includes(tag), 'holiday targets hide the label');
  assert.ok(!tags(statistics, 1, core.addDays(targetDate, 1)).risks.includes(tag), 'labels do not leak into other weekdays');
  assert.ok(!ids(build([...once, session(opportunityDates[0], [1])])).includes(1), 'correcting attendance removes the absence label');
  assert.ok(!ids(build([...base, session(targetDate, [2]), session(core.addDays(targetDate, 7), [2])])).includes(1), 'today/future plans are not past opportunities');
  const blocked = candidate(estimate(once, { shortTermRules: [{ playerId: 1, type: 'not_days', rule: { weekdays: [weekday] } }] }));
  assert.equal(blocked.attendanceProbability, 0, 'explicit rules retain priority');
  summaries.push({ weekday, multipliers: results });
}
console.log(JSON.stringify({ result: 'One-opportunity weekday policy passed', weekdayGroupsChecked: summaries.length,
  tuesday: summaries[2], thursday: summaries[4] }));
