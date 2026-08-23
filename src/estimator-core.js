const DEFAULT_PEOPLE_PER_COURT = 7.5;
const COURT_CAPACITY_SEARCH = { min: 6, max: 9, step: 0.25 };
const DEFAULT_SHUTTLE_RISK_QUANTILE = 0.7;
const MINIMUM_ROLLING_TRAINING_SESSIONS = 5;
const WEIGHT_SEARCH = { min: 0.5, max: 2.5, step: 0.01, passes: 3 };

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 3) {
  return Number(value.toFixed(digits));
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function quantile(values, probability) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const fraction = index - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * fraction;
}

function courtCapacityCandidates() {
  const candidates = [];
  for (let value = COURT_CAPACITY_SEARCH.min; value <= COURT_CAPACITY_SEARCH.max + 1e-9; value += COURT_CAPACITY_SEARCH.step) {
    candidates.push(round(value, 4));
  }
  return candidates;
}

function courtPrediction(sample, peoplePerCourt) {
  return Math.max(1, Math.ceil(sample.participantCount / peoplePerCourt));
}

function compareCourtCandidates(left, right) {
  for (const key of ["mae", "rmse"]) {
    if (Math.abs(left[key] - right[key]) > 1e-12) return left[key] - right[key];
  }
  const leftDistance = Math.abs(left.peoplePerCourt - DEFAULT_PEOPLE_PER_COURT);
  const rightDistance = Math.abs(right.peoplePerCourt - DEFAULT_PEOPLE_PER_COURT);
  if (Math.abs(leftDistance - rightDistance) > 1e-12) return leftDistance - rightDistance;
  return left.peoplePerCourt - right.peoplePerCourt;
}

function selectCourtCapacity(samples) {
  if (!samples.length) return DEFAULT_PEOPLE_PER_COURT;
  return courtCapacityCandidates().map((peoplePerCourt) => {
    const errors = samples.map((sample) => courtPrediction(sample, peoplePerCourt) - sample.courtCount);
    return {
      peoplePerCourt,
      mae: errors.reduce((sum, error) => sum + Math.abs(error), 0) / errors.length,
      rmse: Math.sqrt(errors.reduce((sum, error) => sum + error ** 2, 0) / errors.length),
    };
  }).sort(compareCourtCandidates)[0].peoplePerCourt;
}

function workloadForSample(sample, weights) {
  return Object.entries(sample.shuttleCounts || {}).reduce((sum, [typeId, count]) => (
    sum + number(count) * number(weights[typeId], 1)
  ), 0);
}

function weightObjective(samples, weights) {
  const rates = samples
    .filter((sample) => sample.participantCount > 0)
    .map((sample) => workloadForSample(sample, weights) / sample.participantCount)
    .filter((value) => value > 0 && Number.isFinite(value));
  if (!rates.length) return Number.POSITIVE_INFINITY;
  const center = median(rates);
  if (!(center > 0)) return Number.POSITIVE_INFINITY;
  return rates.reduce((sum, value) => sum + Math.abs(value - center) / center, 0) / rates.length;
}

function learnShuttleWeights(samples, shuttleTypes, baseType) {
  const weights = Object.fromEntries(shuttleTypes.map((type) => [type.id, type.id === baseType ? 1 : 1]));
  const sampleCounts = Object.fromEntries(shuttleTypes.map((type) => [
    type.id,
    samples.filter((sample) => number(sample.shuttleCounts?.[type.id]) > 0).length,
  ]));

  for (let pass = 0; pass < WEIGHT_SEARCH.passes; pass += 1) {
    for (const type of shuttleTypes) {
      if (type.id === baseType || sampleCounts[type.id] <= 0) continue;
      let best = { weight: weights[type.id], objective: Number.POSITIVE_INFINITY };
      for (let candidate = WEIGHT_SEARCH.min; candidate <= WEIGHT_SEARCH.max + 1e-9; candidate += WEIGHT_SEARCH.step) {
        const weight = round(candidate, 4);
        const objective = weightObjective(samples, { ...weights, [type.id]: weight });
        const currentDistance = Math.abs(weight - 1);
        const bestDistance = Math.abs(best.weight - 1);
        if (objective < best.objective - 1e-12 || (Math.abs(objective - best.objective) <= 1e-12 && currentDistance < bestDistance)) {
          best = { weight, objective };
        }
      }
      weights[type.id] = best.weight;
    }
  }
  weights[baseType] = 1;
  const learnedWeights = shuttleTypes
    .filter((type) => type.id !== baseType && sampleCounts[type.id] > 0)
    .map((type) => weights[type.id])
    .filter((weight) => Number.isFinite(weight) && weight > 0);
  const estimatedPrior = learnedWeights.length ? median(learnedWeights) : 1;
  for (const type of shuttleTypes) {
    if (type.id !== baseType && sampleCounts[type.id] === 0) weights[type.id] = estimatedPrior;
  }
  return { weights, sampleCounts, estimatedPrior };
}

function fitShuttleFormula(samples, weights, riskQuantile) {
  const squaredParticipants = samples.reduce((sum, sample) => sum + sample.participantCount ** 2, 0);
  if (!(squaredParticipants > 0)) return { rate: 0.81, riskBuffer: 0 };
  const moment = samples.reduce((sum, sample) => (
    sum + sample.participantCount * workloadForSample(sample, weights)
  ), 0);
  const rate = moment / squaredParticipants;
  const residuals = samples.map((sample) => workloadForSample(sample, weights) - sample.participantCount * rate);
  return { rate, riskBuffer: Math.max(0, quantile(residuals, riskQuantile)) };
}

function errorSummary(records) {
  if (!records.length) return { folds: 0, mae: null, rmse: null, exactRate: null, bias: null, underPredictionRate: null, overPredictionRate: null };
  const errors = records.map(({ predicted, actual }) => predicted - actual);
  return {
    folds: records.length,
    mae: round(errors.reduce((sum, error) => sum + Math.abs(error), 0) / errors.length),
    rmse: round(Math.sqrt(errors.reduce((sum, error) => sum + error ** 2, 0) / errors.length)),
    exactRate: round(errors.filter((error) => Math.abs(error) < 1e-9).length / errors.length),
    bias: round(errors.reduce((sum, error) => sum + error, 0) / errors.length),
    underPredictionRate: round(errors.filter((error) => error < -1e-9).length / errors.length),
    overPredictionRate: round(errors.filter((error) => error > 1e-9).length / errors.length),
  };
}

function sampleDateRange(samples) {
  const dates = samples.map((sample) => sample.date).filter(Boolean).sort();
  return { from: dates[0] || null, to: dates.at(-1) || null };
}

export function predictEstimator(estimator, participantCount) {
  const count = Math.max(0, Number(participantCount) || 0);
  if (!count) return { courts: 0, workload: 0, shuttleCounts: {} };
  const capacity = number(estimator?.court?.peoplePerCourt, DEFAULT_PEOPLE_PER_COURT);
  const rate = number(estimator?.shuttle?.weightedShuttlesPerParticipant, estimator?.shuttle?.rsl3EquivalentPerParticipant || 0.81);
  const buffer = number(estimator?.shuttle?.riskBuffer, 0);
  const workload = Math.max(number(estimator?.shuttle?.minimum, 1), count * rate + buffer);
  const shuttleCounts = Object.fromEntries((estimator?.shuttleTypes || []).map((type) => [
    type.id,
    Math.max(1, Math.ceil(workload / Math.max(0.01, number(type.weight, type.durability || 1)))),
  ]));
  return {
    courts: Math.max(number(estimator?.court?.minimum, 1), Math.ceil(count / Math.max(0.01, capacity))),
    workload,
    shuttleCounts,
  };
}

export function trainEstimatorModel({ sessions, shuttleTypes, generatedAt = new Date().toISOString(), riskQuantile = DEFAULT_SHUTTLE_RISK_QUANTILE }) {
  const types = shuttleTypes.filter((type) => type?.id && type?.name).map((type) => ({
    id: String(type.id),
    name: String(type.name),
    fullName: String(type.fullName || type.name),
    prices: [...new Set((type.prices || []).map(Number).filter((price) => Number.isFinite(price) && price >= 0))],
  }));
  if (!types.length) throw new Error("至少需要登记一个球型号");
  const baseType = types.some((type) => type.id === "rsl3") ? "rsl3" : types[0].id;
  types.sort((left, right) => (left.id === baseType ? -1 : right.id === baseType ? 1 : 0));
  const validSessions = sessions.filter((session) => session.participantCount > 0);
  const courtSamples = validSessions.filter((session) => session.trainCourt !== false && Number.isInteger(session.courtCount) && session.courtCount > 0);
  const shuttleSamples = validSessions.filter((session) => (
    session.trainShuttle !== false && Object.values(session.shuttleCounts || {}).some((count) => number(count) > 0)
  ));
  const peoplePerCourt = selectCourtCapacity(courtSamples);
  const { weights, sampleCounts, estimatedPrior } = learnShuttleWeights(shuttleSamples, types, baseType);
  const formula = fitShuttleFormula(shuttleSamples, weights, riskQuantile);
  const courtRecords = courtSamples.map((sample) => ({ predicted: courtPrediction(sample, peoplePerCourt), actual: sample.courtCount }));
  const workloadRecords = shuttleSamples.map((sample) => ({
    predicted: sample.participantCount * formula.rate + formula.riskBuffer,
    actual: workloadForSample(sample, weights),
  }));

  return {
    version: 4,
    generatedAt,
    training: {
      dateRange: sampleDateRange(validSessions),
      court: { sampleCount: courtSamples.length, dateRange: sampleDateRange(courtSamples) },
      shuttle: { sampleCount: shuttleSamples.length, dateRange: sampleDateRange(shuttleSamples) },
    },
    shuttleTypes: types.map((type) => ({
      ...type,
      weight: round(weights[type.id] || 1, 4),
      sampleCount: sampleCounts[type.id] || 0,
      weightSource: type.id === baseType ? "reference" : (sampleCounts[type.id] ? "learned" : "estimated-prior"),
    })),
    court: {
      formula: "ceil(participantCount / peoplePerCourt)",
      peoplePerCourt,
      minimum: 1,
      selection: { strategy: "grid-search", objective: "mae-then-rmse", candidates: COURT_CAPACITY_SEARCH },
      validation: { method: "in-sample", minimumTrainingSessions: MINIMUM_ROLLING_TRAINING_SESSIONS, ...errorSummary(courtRecords) },
    },
    shuttle: {
      baseType,
      formula: "ceil((participantCount * weightedShuttlesPerParticipant + riskBuffer) / weight)",
      weightedShuttlesPerParticipant: round(formula.rate, 6),
      riskQuantile,
      riskBuffer: round(formula.riskBuffer, 6),
      riskBufferSource: "residual-quantile",
      minimum: 1,
      weightSearch: { ...WEIGHT_SEARCH, estimatedPrior: round(estimatedPrior, 4) },
      validation: { method: "weighted-workload", ...errorSummary(workloadRecords) },
    },
  };
}

export function assessEstimatorAnomaly({ estimator, participantCount, courtCount, shuttleRows }) {
  const prediction = predictEstimator(estimator, participantCount);
  const courtDifference = Math.abs((Number(courtCount) || 0) - prediction.courts);
  const types = new Map((estimator?.shuttleTypes || []).map((type) => [type.id, type]));
  const actualCount = (shuttleRows || []).reduce((sum, row) => sum + (Number(row.count) || 0), 0);
  const actualWorkload = (shuttleRows || []).reduce((sum, row) => {
    const type = types.get(row.type);
    return sum + (Number(row.count) || 0) * number(type?.weight, type?.durability || 1);
  }, 0);
  const averageWeight = actualCount > 0 ? actualWorkload / actualCount : 1;
  const primaryType = estimator?.shuttleTypes?.[0];
  const primaryPrediction = primaryType ? prediction.shuttleCounts[primaryType.id] || 0 : 0;
  const predictedMixedCount = actualCount > 0
    ? Math.ceil(prediction.workload / Math.max(0.01, averageWeight))
    : primaryPrediction;
  const shuttleDifference = Math.abs(actualCount - predictedMixedCount);
  return {
    anomalous: courtDifference > 1 || shuttleDifference > 2,
    court: { predicted: prediction.courts, actual: Number(courtCount) || 0, difference: courtDifference },
    shuttle: { predicted: predictedMixedCount, actual: actualCount, difference: shuttleDifference },
  };
}
