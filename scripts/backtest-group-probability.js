import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import "../member-statistics.js";
import "../group-probability.js";
import { buildGroupLearningSignals } from "../src/group-learning-core.js";
const baseCommit = "86be731614df382f638bd331165a50a252074969";
const previous = vm.createContext({ console });
vm.runInContext(execFileSync("git", ["show", baseCommit + ":member-statistics.js"], { encoding: "utf8" }), previous);
// Counterfactual ranking is not scored here; skip that expensive, unrelated work in the legacy engine.
const oldSource = execFileSync("git", ["show", baseCommit + ":group-probability.js"], { encoding: "utf8" })
  .replace("function counterfactualUplift(model, todayContext, player, seed, simulations) {", "function counterfactualUplift(model, todayContext, player, seed, simulations) { return 0;");
vm.runInContext(oldSource, previous);
const core = BadmintonMemberStatistics, data = JSON.parse(readFileSync(new URL("../data/bootstrap-snapshot.json", import.meta.url), "utf8")).data;
const end = core.addDays(core.beijingDate(), -1), start = core.addDays(end, -27);
const attendees = (session) => new Set((session.players || []).filter((row) => !row.isCompanion && Number(row.slots) > Number(row.plusCount || 0)).map((row) => Number(row.playerId)).filter(Boolean));
const size = (session) => (session.players || []).reduce((sum, row) => sum + Math.max(0, Number(row.slots) || 0), 0);
const successful = new Map();
for (const session of data.sessions) if (session.date <= end && size(session) >= 6) {
  const ids = successful.get(session.date) || new Set();
  attendees(session).forEach((id) => ids.add(id)); successful.set(session.date, ids);
}
const outcomes = new Map((data.groupAttemptOutcomes || []).filter((row) => row.trainingState === "eligible" && row.hasEligibleSnapshots && ["success", "failure"].includes(row.outcome)).map((row) => [row.activityDate, row.outcome === "success"]));
const folds = [], samples = { previous: { group: [], attendance: [] }, current: { group: [], attendance: [] } };
for (let date = start; date <= end; date = core.addDays(date, 1)) {
  if (!successful.has(date) && !outcomes.has(date)) continue; // No booking alone is NOT an observed failure.
  const sessions = data.sessions.filter((session) => session.date < date);
  if (new Set(sessions.filter((session) => size(session) >= 6).map((session) => session.date)).size < 8) continue;
  const seen = new Set(sessions.flatMap((session) => [...attendees(session)]));
  const players = data.players.filter((player) => seen.has(player.id) || (player.createdAt && String(player.createdAt).slice(0, 10) < date));
  const now = date + "T09:00:00+08:00";
  const learning = buildGroupLearningSignals({ players, sessions, attempts: [], now: new Date(now), halfLifeDays: 30 });
  const statistics = core.build({ players, sessions, now });
  const active = new Set(statistics.members.filter((row) => row.attendance30 > 0).map((row) => row.playerId));
  const input = { players, sessions, groupAttemptOutcomes: (data.groupAttemptOutcomes || []).filter((row) => row.activityDate < date),
    groupLearningSignals: learning, entries: [], now, targetDate: date, simulations: 800, calibrationSimulations: 250,
    includeCandidates: true, includeCounterfactuals: false, seed: 27421 };
  // No present-day manual overrides or future-trained model is fed into historical folds.
  const predictions = { previous: previous.BadmintonGroupProbability.estimate(input), current: BadmintonGroupProbability.estimate(input) };
  const outcome = outcomes.has(date) ? outcomes.get(date) : true;
  const fold = { date, success: outcome, peopleScored: 0 };
  for (const [name, prediction] of Object.entries(predictions)) {
    samples[name].group.push([prediction.todayProbability, Number(outcome)]);
    fold[name] = prediction.todayProbability;
    if (successful.has(date)) {
      const currentIds = successful.get(date);
      for (const member of prediction.candidates) if (active.has(member.playerId)) {
        samples[name].attendance.push([member.attendanceProbability, Number(currentIds.has(member.playerId))]);
        if (name === "current") fold.peopleScored++;
      }
    }
  }
  folds.push(fold);
}
const round = (n) => Math.round(n * 1e6) / 1e6;
function metrics(rows) {
  if (!rows.length) return { samples: 0 };
  return { samples: rows.length, positives: rows.filter(([, y]) => y).length,
    meanPrediction: round(rows.reduce((sum, [p]) => sum + p, 0) / rows.length),
    observedRate: round(rows.reduce((sum, [, y]) => sum + y, 0) / rows.length),
    brier: round(rows.reduce((sum, [p, y]) => sum + (p - y) ** 2, 0) / rows.length),
    logLoss: round(rows.reduce((sum, [p, y]) => sum - Math.log(Math.max(1e-6, y ? p : 1 - p)), 0) / rows.length) };
}
const report = { generatedAt: new Date().toISOString(), range: { start, end }, baseCommit,
  protocol: "Rolling-origin 09:00 empty-roster predictions; only prior records and fold-rebuilt learning. No invitation-response claim. Unrecorded days are not labeled failures. Personal attendance scored only on actual organized days and recently active, previously known members.",
  limitations: "Small, selected sample of booked days / explicitly tracked attempts; not population-wide calibration. Historical friendship lift is tested separately with deterministic cases, not inferred causally from this backtest.",
  metrics: Object.fromEntries(Object.entries(samples).map(([name, row]) => [name, { group: metrics(row.group), attendance: metrics(row.attendance) }])), folds };
mkdirSync(new URL("../output/", import.meta.url), { recursive: true });
writeFileSync(new URL("../output/group-probability-v4-backtest.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ range: report.range, metrics: report.metrics, limitations: report.limitations }, null, 2));
