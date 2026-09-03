const DEFAULT_PEOPLE_PER_COURT = 7.5;
const COURT_CAPACITY_SEARCH = { min: 6, max: 9, step: 0.25 };
const DEFAULT_SHUTTLES_PER_PARTICIPANT = 0.81;
const DEFAULT_SHUTTLE_RISK_QUANTILE = 0.7;
const MINIMUM_ROLLING_TRAINING_SESSIONS = 5;
const MINIMUM_HIERARCHY_TRAINING_SESSIONS = 8;
const MAXIMUM_HOLDOUT_SESSIONS = 5;
const MAXIMUM_TYPE_TRAINING_SESSIONS = 120;
const MINIMUM_MODEL_SELECTION_RECORDS = 3;
const MINIMUM_RISK_CALIBRATION_RECORDS = 3;
const RISK_SCALE_PRIOR_STRENGTH = 5;
const MAXIMUM_RISK_SCALE = 2;
const MINIMUM_GENDER_LEVEL_SESSIONS = 2;
const MINIMUM_MEMBER_SESSIONS = 3;
const MINIMUM_PARTICIPANT_RATE = 0.05;
const MAXIMUM_PARTICIPANT_RATE = 5;
const REGULARIZATION_SCALES = [0.001, 0.01, 0.1];
const DEFAULT_REGULARIZATION_SCALE = 0.1;
const REGULARIZATION_MULTIPLIERS = { gender: 1, genderLevel: 2, member: 4 };
const MAX_OPTIMIZER_STEPS = 50;
const MINIMUM_OPTIMIZER_STEPS = 20;
const OPTIMIZER_LEARNING_RATE = 0.04;
const OPTIMIZER_TOLERANCE = 1e-7;
const UNKNOWN = "\u4e0d\u8be6";
const VALID_GENDERS = new Set(["\u7537", "\u5973", UNKNOWN]);

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 3) {
  return Number(value.toFixed(digits));
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
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

function normalizePlayerId(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? String(parsed) : null;
}

function normalizeParticipant(row = {}) {
  const genderValue = row.gender ?? row.genderSnapshot ?? row.gender_snapshot;
  const gender = VALID_GENDERS.has(genderValue)
    ? genderValue
    : (row.isFemale === true || number(row.is_female) === 1 ? "\u5973" : UNKNOWN);
  const levelValue = String(row.level ?? row.levelSnapshot ?? row.level_snapshot ?? UNKNOWN).trim();
  return {
    playerId: normalizePlayerId(row.playerId ?? row.player_id ?? row.player?.id),
    gender,
    level: levelValue || UNKNOWN,
  };
}

function anonymousParticipant() {
  return { playerId: null, gender: UNKNOWN, level: UNKNOWN };
}

export function expandEstimatorParticipants(rows = [], fallbackCount = 0, options = {}) {
  const participants = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const hasSlots = row?.slots !== undefined && row?.slots !== null;
    const slots = Math.max(0, Math.floor(number(hasSlots ? row.slots : 1)));
    if (!slots) continue;
    const rawProfile = normalizeParticipant(row);
    const submittedReliability = row?.profileSnapshotReliable
      ?? row?.profile_snapshot_reliable
      ?? row?.profileReliable;
    const rowProfileReliable = submittedReliability === undefined
      || (submittedReliability !== false && number(submittedReliability, 1) !== 0);
    const profileReliable = options.profileReliable !== false && rowProfileReliable;
    const profile = profileReliable
      ? rawProfile
      : { ...rawProfile, gender: UNKNOWN, level: UNKNOWN };
    const isCompanion = row?.isCompanion === true || number(row?.is_companion) === 1;
    const plusCount = Math.max(0, Math.floor(number(row?.plusCount ?? row?.plus_count)));
    const selfPresent = !isCompanion && profile.playerId !== null && slots > plusCount;
    const hasReliableDemographics = profile.gender !== UNKNOWN || profile.level !== UNKNOWN;
    const keepFirstProfile = selfPresent || isCompanion || (profile.playerId === null && hasReliableDemographics);

    if (keepFirstProfile) participants.push(profile);
    const anonymousCount = slots - (keepFirstProfile ? 1 : 0);
    for (let index = 0; index < anonymousCount; index += 1) participants.push(anonymousParticipant());
  }

  const targetCount = Math.max(0, Math.floor(number(fallbackCount)));
  while (participants.length < targetCount) participants.push(anonymousParticipant());
  return participants;
}

function genderLevelKey(participant) {
  return `${participant.gender}|${participant.level}`;
}

function increment(map, key, amount = 1) {
  map.set(key, (map.get(key) || 0) + amount);
}

function featureCounts(participants) {
  const features = new Map();
  for (const participant of participants) {
    increment(features, `gender:${participant.gender}`);
    increment(features, `genderLevel:${genderLevelKey(participant)}`);
    if (participant.playerId !== null) increment(features, `member:${participant.playerId}`);
  }
  return features;
}

function featureLayer(feature) {
  return feature.slice(0, feature.indexOf(":"));
}

function featureName(feature) {
  return feature.slice(feature.indexOf(":") + 1);
}

function buildFeatureColumns(samples) {
  const columns = new Map();
  samples.forEach((sample, sampleIndex) => {
    sample.features = featureCounts(sample.participants);
    for (const [feature, count] of sample.features) {
      if (!columns.has(feature)) columns.set(feature, []);
      columns.get(feature).push([sampleIndex, count]);
    }
  });
  return [...columns.entries()]
    .map(([feature, entries]) => ({ feature, layer: featureLayer(feature), entries }))
    .filter((column) => (
      column.layer === "gender"
      || (column.layer === "genderLevel" && column.entries.length >= MINIMUM_GENDER_LEVEL_SESSIONS)
      || (column.layer === "member" && column.entries.length >= MINIMUM_MEMBER_SESSIONS)
    ))
    .sort((left, right) => {
      const order = { gender: 0, genderLevel: 1, member: 2 };
      return (order[left.layer] - order[right.layer]) || left.feature.localeCompare(right.feature);
    });
}

function baseRateForSamples(samples) {
  const denominator = samples.reduce((sum, sample) => sum + sample.participants.length ** 2, 0);
  if (!(denominator > 0)) return DEFAULT_SHUTTLES_PER_PARTICIPANT;
  const numerator = samples.reduce((sum, sample) => sum + sample.participants.length * sample.actual, 0);
  return clamp(numerator / denominator, MINIMUM_PARTICIPANT_RATE, MAXIMUM_PARTICIPANT_RATE);
}

function fitHierarchicalRates(inputSamples, regularizationScale) {
  const samples = inputSamples.map((sample) => ({ ...sample, participants: [...sample.participants] }));
  const columns = buildFeatureColumns(samples);
  const allowedFeatures = new Set(columns.map((column) => column.feature));
  const profiles = samples.map((sample) => sample.participants.map((participant) => ({
    participant,
    features: [
      `gender:${participant.gender}`,
      `genderLevel:${genderLevelKey(participant)}`,
      ...(participant.playerId === null ? [] : [`member:${participant.playerId}`]),
    ].filter((feature) => allowedFeatures.has(feature)),
  })));
  let logBaseRate = Math.log(baseRateForSamples(samples));
  let baseFirstMoment = 0;
  let baseSecondMoment = 0;
  const effects = new Map(columns.map((column) => [column.feature, 0]));
  const firstMoments = new Map(columns.map((column) => [column.feature, 0]));
  const secondMoments = new Map(columns.map((column) => [column.feature, 0]));

  for (let step = 1; step <= MAX_OPTIMIZER_STEPS; step += 1) {
    let baseGradient = 0;
    const gradients = new Map(columns.map((column) => [column.feature, 0]));
    for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
      const rates = profiles[sampleIndex].map((profile) => {
        const logRate = logBaseRate + profile.features.reduce((sum, feature) => sum + (effects.get(feature) || 0), 0);
        return Math.exp(clamp(logRate, Math.log(MINIMUM_PARTICIPANT_RATE), Math.log(MAXIMUM_PARTICIPANT_RATE)));
      });
      const expected = Math.max(1e-9, rates.reduce((sum, rate) => sum + rate, 0));
      const likelihoodGradient = 1 - samples[sampleIndex].actual / expected;
      baseGradient += likelihoodGradient * expected;
      profiles[sampleIndex].forEach((profile, participantIndex) => {
        const contribution = likelihoodGradient * rates[participantIndex];
        for (const feature of profile.features) gradients.set(feature, gradients.get(feature) + contribution);
      });
    }

    const sampleScale = 1 / Math.max(1, samples.length);
    baseGradient *= sampleScale;
    for (const column of columns) {
      const feature = column.feature;
      const penalty = regularizationScale * (REGULARIZATION_MULTIPLIERS[column.layer] || 1);
      gradients.set(feature, gradients.get(feature) * sampleScale + penalty * (effects.get(feature) || 0));
    }

    const beta1 = 0.9;
    const beta2 = 0.999;
    const epsilon = 1e-8;
    baseFirstMoment = beta1 * baseFirstMoment + (1 - beta1) * baseGradient;
    baseSecondMoment = beta2 * baseSecondMoment + (1 - beta2) * baseGradient ** 2;
    const correctedBaseFirst = baseFirstMoment / (1 - beta1 ** step);
    const correctedBaseSecond = baseSecondMoment / (1 - beta2 ** step);
    const baseUpdate = OPTIMIZER_LEARNING_RATE * correctedBaseFirst / (Math.sqrt(correctedBaseSecond) + epsilon);
    logBaseRate = clamp(
      logBaseRate - baseUpdate,
      Math.log(MINIMUM_PARTICIPANT_RATE),
      Math.log(MAXIMUM_PARTICIPANT_RATE),
    );
    let maximumUpdate = Math.abs(baseUpdate);

    for (const column of columns) {
      const feature = column.feature;
      const gradient = gradients.get(feature) || 0;
      const first = beta1 * (firstMoments.get(feature) || 0) + (1 - beta1) * gradient;
      const second = beta2 * (secondMoments.get(feature) || 0) + (1 - beta2) * gradient ** 2;
      firstMoments.set(feature, first);
      secondMoments.set(feature, second);
      const correctedFirst = first / (1 - beta1 ** step);
      const correctedSecond = second / (1 - beta2 ** step);
      const update = OPTIMIZER_LEARNING_RATE * correctedFirst / (Math.sqrt(correctedSecond) + epsilon);
      effects.set(feature, clamp((effects.get(feature) || 0) - update, -2, 2));
      maximumUpdate = Math.max(maximumUpdate, Math.abs(update));
    }
    if (step >= MINIMUM_OPTIMIZER_STEPS && maximumUpdate < OPTIMIZER_TOLERANCE) break;
  }

  const splitEffects = { gender: {}, genderLevel: {}, member: {} };
  for (const [feature, value] of effects) {
    splitEffects[featureLayer(feature)][featureName(feature)] = value;
  }
  return { baseRate: Math.exp(logBaseRate), effects: splitEffects };
}

function participantRate(fit, participant) {
  const logRate = Math.log(Math.max(MINIMUM_PARTICIPANT_RATE, number(fit.baseRate, DEFAULT_SHUTTLES_PER_PARTICIPANT)))
    + number(fit.effects?.gender?.[participant.gender])
    + number(fit.effects?.genderLevel?.[genderLevelKey(participant)])
    + (participant.playerId === null ? 0 : number(fit.effects?.member?.[participant.playerId]));
  return Math.exp(clamp(logRate, Math.log(MINIMUM_PARTICIPANT_RATE), Math.log(MAXIMUM_PARTICIPANT_RATE)));
}

function rawTypePrediction(fit, participants) {
  return participants.reduce((sum, participant) => sum + participantRate(fit, participant), 0);
}

function riskScaleForFit(fit, samples, riskQuantile) {
  const records = samples.map((sample) => ({
    actual: sample.actual,
    rawPredicted: rawTypePrediction(fit, sample.participants),
  }));
  return riskScaleForRecords(records, riskQuantile);
}

function riskScaleForRecords(records, riskQuantile) {
  const scores = records.map((record) => (
    (record.actual - record.rawPredicted) / Math.sqrt(Math.max(record.rawPredicted, 1))
  ));
  return Math.max(0, quantile(scores, riskQuantile));
}

function riskBufferForExpected(riskScale, expected) {
  return Math.max(0, number(riskScale)) * Math.sqrt(Math.max(expected, 1));
}

function calibratedRiskScale(records, riskQuantile) {
  const rawScale = riskScaleForRecords(records, riskQuantile);
  const reliability = records.length / (records.length + RISK_SCALE_PRIOR_STRENGTH);
  return Math.min(MAXIMUM_RISK_SCALE, rawScale * reliability);
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

function fitCandidate(samples, candidate) {
  if (candidate.kind === "global-only") {
    return { baseRate: baseRateForSamples(samples), effects: { gender: {}, genderLevel: {}, member: {} } };
  }
  return fitHierarchicalRates(samples, candidate.scale);
}

function timeHoldoutValidation(samples, candidate, riskQuantile) {
  if (samples.length <= MINIMUM_ROLLING_TRAINING_SESSIONS) return { rawRecords: [], recommendedRecords: [] };
  const desiredHoldout = Math.max(1, Math.round(samples.length * 0.25));
  const holdoutCount = Math.min(MAXIMUM_HOLDOUT_SESSIONS, desiredHoldout, samples.length - MINIMUM_ROLLING_TRAINING_SESSIONS);
  const splitIndex = samples.length - holdoutCount;
  const training = samples.slice(0, splitIndex);
  const holdout = samples.slice(splitIndex);
  const fit = fitCandidate(training, candidate);
  const trainingRiskScale = riskScaleForFit(fit, training, riskQuantile);
  const rawRecords = holdout.map((sample) => {
    const rawPredicted = rawTypePrediction(fit, sample.participants);
    return { rawPredicted, predicted: rawPredicted, actual: sample.actual };
  });
  const recommendedRecords = rawRecords.map((record) => ({
    predicted: Math.max(1, Math.ceil(record.rawPredicted + riskBufferForExpected(trainingRiskScale, record.rawPredicted))),
    actual: record.actual,
  }));
  return { rawRecords, recommendedRecords };
}

function compareCandidates(left, right) {
  for (const key of ["mae", "rmse"]) {
    if (left.summary[key] !== null && Math.abs(left.summary[key] - right.summary[key]) > 1e-12) {
      return left.summary[key] - right.summary[key];
    }
  }
  if (left.kind !== right.kind) return left.kind === "global-only" ? -1 : 1;
  return number(right.scale) - number(left.scale);
}

function selectRegularization(samples, riskQuantile) {
  if (samples.length <= MINIMUM_ROLLING_TRAINING_SESSIONS) {
    return { kind: "global-only", scale: null, rawRecords: [], recommendedRecords: [], source: "small-sample-default" };
  }
  const specifications = [
    { kind: "global-only", scale: null },
    ...REGULARIZATION_SCALES.map((scale) => ({ kind: "hierarchical", scale })),
  ];
  const candidates = specifications.map((candidate) => {
    const validation = timeHoldoutValidation(samples, candidate, riskQuantile);
    return {
      ...candidate,
      ...validation,
      summary: errorSummary(validation.rawRecords),
    };
  });
  const globalCandidate = candidates.find((candidate) => candidate.kind === "global-only");
  if ((globalCandidate?.rawRecords?.length || 0) < MINIMUM_MODEL_SELECTION_RECORDS) {
    return {
      ...globalCandidate,
      source: "insufficient-holdout-global-only",
      baselineMae: globalCandidate?.summary?.mae ?? null,
      requiredImprovement: null,
    };
  }
  const hierarchicalCandidate = candidates.filter((candidate) => candidate.kind === "hierarchical").sort(compareCandidates)[0];
  const requiredImprovement = Math.max(0.25, number(globalCandidate?.summary?.mae) * 0.05);
  const hierarchyWins = hierarchicalCandidate?.summary?.mae !== null
    && globalCandidate?.summary?.mae !== null
    && hierarchicalCandidate.summary.mae < globalCandidate.summary.mae - requiredImprovement
    && hierarchicalCandidate.summary.rmse <= globalCandidate.summary.rmse;
  const selected = hierarchyWins ? hierarchicalCandidate : globalCandidate;
  return {
    ...selected,
    source: "time-holdout-conservative-grid-search",
    baselineMae: globalCandidate?.summary?.mae ?? null,
    requiredImprovement,
  };
}

function sampleDateRange(samples) {
  const dates = samples.map((sample) => sample.date).filter(Boolean).sort();
  return { from: dates[0] || null, to: dates.at(-1) || null };
}

function roundedMap(values) {
  return Object.fromEntries(Object.entries(values || {}).map(([key, value]) => [key, round(number(value), 6)]));
}

function coldStartTypeModel(typeId, mixedExcludedCount, riskQuantile) {
  return {
    typeId,
    trainingMode: "cold-start",
    formula: "ceil(rawExpected + riskScale * sqrt(max(rawExpected, 1)))",
    baseRate: DEFAULT_SHUTTLES_PER_PARTICIPANT,
    riskQuantile,
    riskScale: 0,
    effects: { gender: {}, genderLevel: {}, member: {} },
    training: { sampleCount: 0, availableSampleCount: 0, mixedExcludedCount, dateRange: { from: null, to: null } },
    regularization: {
      selectedKind: "cold-start",
      scale: null,
      multipliers: { ...REGULARIZATION_MULTIPLIERS },
      candidates: [...REGULARIZATION_SCALES],
      source: "cold-start",
    },
    validation: { method: "time-holdout", raw: errorSummary([]), ...errorSummary([]) },
    fit: { method: "cold-start", ...errorSummary([]) },
  };
}

function trainTypeModel(typeId, samples, mixedExcludedCount, riskQuantile) {
  if (!samples.length) return coldStartTypeModel(typeId, mixedExcludedCount, riskQuantile);
  const trainingSamples = samples.slice(-MAXIMUM_TYPE_TRAINING_SESSIONS);
  const selection = selectRegularization(trainingSamples, riskQuantile);
  const fit = fitCandidate(trainingSamples, selection);
  const holdoutCalibrationRecords = selection.rawRecords || [];
  const fullFitCalibrationRecords = trainingSamples.map((sample) => ({
    actual: sample.actual,
    rawPredicted: rawTypePrediction(fit, sample.participants),
  }));
  const calibrationRecords = holdoutCalibrationRecords.length >= MINIMUM_RISK_CALIBRATION_RECORDS
    ? selection.rawRecords
    : fullFitCalibrationRecords;
  const riskScale = calibratedRiskScale(calibrationRecords, riskQuantile);
  const fitRecords = trainingSamples.map((sample) => {
    const rawPredicted = rawTypePrediction(fit, sample.participants);
    return {
      predicted: Math.max(1, Math.ceil(rawPredicted + riskBufferForExpected(riskScale, rawPredicted))),
      actual: sample.actual,
    };
  });
  const calibrationFitRecords = calibrationRecords.map((record) => ({
    predicted: Math.max(1, Math.ceil(record.rawPredicted + riskBufferForExpected(riskScale, record.rawPredicted))),
    actual: record.actual,
  }));
  return {
    typeId,
    trainingMode: selection.kind,
    formula: "ceil(rawExpected + riskScale * sqrt(max(rawExpected, 1)))",
    baseRate: round(fit.baseRate, 6),
    riskQuantile,
    riskScale: round(riskScale, 6),
    effects: {
      gender: roundedMap(fit.effects.gender),
      genderLevel: roundedMap(fit.effects.genderLevel),
      member: roundedMap(fit.effects.member),
    },
    training: {
      sampleCount: trainingSamples.length,
      availableSampleCount: samples.length,
      olderExcludedCount: samples.length - trainingSamples.length,
      mixedExcludedCount,
      dateRange: sampleDateRange(trainingSamples),
    },
    regularization: {
      selectedKind: selection.kind,
      scale: selection.scale,
      multipliers: { ...REGULARIZATION_MULTIPLIERS },
      candidates: [...REGULARIZATION_SCALES],
      source: selection.source,
      baselineMae: selection.baselineMae ?? null,
      requiredImprovement: selection.requiredImprovement ?? null,
    },
    validation: { method: "time-holdout", ...errorSummary(selection.rawRecords || []) },
    riskCalibration: {
      method: holdoutCalibrationRecords.length >= MINIMUM_RISK_CALIBRATION_RECORDS ? "time-holdout" : "shrunken-in-sample",
      sampleCount: calibrationRecords.length,
      priorStrength: RISK_SCALE_PRIOR_STRENGTH,
      maximumScale: MAXIMUM_RISK_SCALE,
      ...errorSummary(calibrationFitRecords),
    },
    fit: { method: selection.kind === "hierarchical" ? "regularized-hierarchical-poisson" : "global-rate", ...errorSummary(fitRecords) },
  };
}

function predictionParticipants(input) {
  if (Array.isArray(input)) return expandEstimatorParticipants(input);
  if (input && Array.isArray(input.participants)) return expandEstimatorParticipants(input.participants);
  return expandEstimatorParticipants([], Math.max(0, Math.floor(number(input?.participantCount ?? input))));
}

function typeModelParticipantRate(typeModel, participant) {
  const baseRate = Math.max(MINIMUM_PARTICIPANT_RATE, number(typeModel?.baseRate, DEFAULT_SHUTTLES_PER_PARTICIPANT));
  const logRate = Math.log(baseRate)
    + number(typeModel?.effects?.gender?.[participant.gender])
    + number(typeModel?.effects?.genderLevel?.[genderLevelKey(participant)])
    + (participant.playerId === null ? 0 : number(typeModel?.effects?.member?.[participant.playerId]));
  return Math.exp(clamp(logRate, Math.log(MINIMUM_PARTICIPANT_RATE), Math.log(MAXIMUM_PARTICIPANT_RATE)));
}

export function predictEstimator(estimator, participantsOrCount) {
  const participants = predictionParticipants(participantsOrCount);
  if (!participants.length) return { courts: 0, shuttleCounts: {}, shuttleExpected: {}, shuttleRawExpected: {}, shuttleRiskBuffers: {}, participantCount: 0 };
  const capacity = number(estimator?.court?.peoplePerCourt, DEFAULT_PEOPLE_PER_COURT);
  const minimum = Math.max(1, number(estimator?.shuttle?.minimum, 1));
  const typeModels = estimator?.shuttle?.models || {};
  const shuttleExpected = {};
  const shuttleRawExpected = {};
  const shuttleRiskBuffers = {};
  const shuttleCounts = {};
  for (const type of estimator?.shuttleTypes || []) {
    const typeModel = typeModels[type.id] || coldStartTypeModel(type.id, 0, DEFAULT_SHUTTLE_RISK_QUANTILE);
    const rawExpected = participants.reduce((sum, participant) => sum + typeModelParticipantRate(typeModel, participant), 0);
    const riskBuffer = typeModel.riskScale === undefined
      ? Math.max(0, number(typeModel.riskBuffer))
      : riskBufferForExpected(typeModel.riskScale, rawExpected);
    const expected = rawExpected + riskBuffer;
    shuttleRawExpected[type.id] = rawExpected;
    shuttleRiskBuffers[type.id] = riskBuffer;
    shuttleExpected[type.id] = expected;
    shuttleCounts[type.id] = Math.max(minimum, Math.ceil(expected));
  }
  return {
    courts: Math.max(number(estimator?.court?.minimum, 1), Math.ceil(participants.length / Math.max(0.01, capacity))),
    shuttleCounts,
    shuttleExpected,
    shuttleRawExpected,
    shuttleRiskBuffers,
    participantCount: participants.length,
  };
}

export function trainEstimatorModel({ sessions, shuttleTypes, generatedAt = new Date().toISOString(), riskQuantile = DEFAULT_SHUTTLE_RISK_QUANTILE, trainingRevision = null }) {
  const types = shuttleTypes.filter((type) => type?.id && type?.name).map((type) => ({
    id: String(type.id),
    name: String(type.name),
    fullName: String(type.fullName || type.name),
    prices: [...new Set((type.prices || []).map(Number).filter((price) => Number.isFinite(price) && price >= 0))],
  }));
  if (!types.length) throw new Error("At least one shuttle type is required");
  const typeIds = new Set(types.map((type) => type.id));
  const validSessions = sessions.map((session) => {
    const participants = expandEstimatorParticipants(
      session.participants || [],
      session.participantCount,
      { profileReliable: session.profileSnapshotsReliable !== false },
    );
    return { ...session, participants, participantCount: participants.length };
  }).filter((session) => session.participantCount > 0)
    .sort((left, right) => String(left.date || "").localeCompare(String(right.date || "")) || number(left.id) - number(right.id));
  const courtSamples = validSessions.filter((session) => session.trainCourt !== false && Number.isInteger(session.courtCount) && session.courtCount > 0);
  const shuttleTrainingEnabledSessions = validSessions.filter((session) => session.trainShuttle !== false);
  const shuttleEligibleSessions = shuttleTrainingEnabledSessions.filter((session) => session.actualShuttleConfirmed !== false);
  const unconfirmedExcludedCount = shuttleTrainingEnabledSessions.length - shuttleEligibleSessions.length;
  const samplesByType = Object.fromEntries(types.map((type) => [type.id, []]));
  const mixedExcludedByType = Object.fromEntries(types.map((type) => [type.id, 0]));
  let unknownTypeExcludedCount = 0;

  for (const session of shuttleEligibleSessions) {
    const positiveRows = Object.entries(session.shuttleCounts || {})
      .map(([typeId, count]) => [String(typeId), number(count)])
      .filter(([, count]) => count > 0);
    if (!positiveRows.length) continue;
    const hasUnknownType = positiveRows.some(([typeId]) => !typeIds.has(typeId));
    if (hasUnknownType) {
      unknownTypeExcludedCount += 1;
      continue;
    }
    if (positiveRows.length !== 1) {
      for (const [typeId] of positiveRows) mixedExcludedByType[typeId] += 1;
      continue;
    }
    const [typeId, actual] = positiveRows[0];
    samplesByType[typeId].push({
      id: session.id,
      date: String(session.date || ""),
      participants: session.participants,
      actual,
    });
  }

  const peoplePerCourt = selectCourtCapacity(courtSamples);
  const courtRecords = courtSamples.map((sample) => ({ predicted: courtPrediction(sample, peoplePerCourt), actual: sample.courtCount }));
  const typeModels = Object.fromEntries(types.map((type) => [
    type.id,
    trainTypeModel(type.id, samplesByType[type.id], mixedExcludedByType[type.id], riskQuantile),
  ]));
  const pureSampleCount = Object.values(samplesByType).reduce((sum, samples) => sum + samples.length, 0);
  const mixedExcludedCount = shuttleEligibleSessions.filter((session) => (
    Object.entries(session.shuttleCounts || {}).filter(([typeId, count]) => typeIds.has(typeId) && number(count) > 0).length > 1
  )).length;

  return {
    version: 5,
    generatedAt,
    trainingRevision: trainingRevision === null ? null : number(trainingRevision),
    training: {
      dateRange: sampleDateRange(validSessions),
      court: { sampleCount: courtSamples.length, dateRange: sampleDateRange(courtSamples) },
      shuttle: {
        sampleCount: pureSampleCount,
        eligibleSessionCount: shuttleEligibleSessions.length,
        unconfirmedExcludedCount,
        mixedExcludedCount,
        unknownTypeExcludedCount,
        byType: Object.fromEntries(types.map((type) => [type.id, {
          sampleCount: samplesByType[type.id].length,
          mixedExcludedCount: mixedExcludedByType[type.id],
          dateRange: sampleDateRange(samplesByType[type.id]),
        }])),
      },
    },
    shuttleTypes: types.map((type) => ({
      ...type,
      sampleCount: typeModels[type.id].training.sampleCount,
      trainingMode: typeModels[type.id].trainingMode,
    })),
    court: {
      formula: "ceil(participantCount / peoplePerCourt)",
      peoplePerCourt,
      minimum: 1,
      selection: { strategy: "grid-search", objective: "mae-then-rmse", candidates: COURT_CAPACITY_SEARCH },
      validation: { method: "in-sample", minimumTrainingSessions: MINIMUM_ROLLING_TRAINING_SESSIONS, ...errorSummary(courtRecords) },
    },
    shuttle: {
      formula: "ceil(rawExpected + riskScale * sqrt(max(rawExpected, 1)))",
      participantRateFormula: "baseRate * exp(genderEffect + genderLevelEffect + memberEffect)",
      hierarchy: ["type", "gender", "genderLevel", "member"],
      minimum: 1,
      riskQuantile,
      minimumHierarchyTrainingSessions: MINIMUM_HIERARCHY_TRAINING_SESSIONS,
      maximumTrainingSessionsPerType: MAXIMUM_TYPE_TRAINING_SESSIONS,
      models: typeModels,
    },
  };
}

export function assessEstimatorAnomaly({ estimator, participants, participantCount, courtCount, shuttleRows }) {
  const predictionInput = Array.isArray(participants) ? participants : participantCount;
  const prediction = predictEstimator(estimator, predictionInput);
  const courtDifference = Math.abs((Number(courtCount) || 0) - prediction.courts);
  const knownTypes = new Set((estimator?.shuttleTypes || []).map((type) => type.id));
  const counts = new Map();
  let hasUnrecognizedPositiveRow = false;
  for (const row of shuttleRows || []) {
    if (!(number(row.count) > 0)) continue;
    if (!knownTypes.has(row.type)) {
      hasUnrecognizedPositiveRow = true;
      continue;
    }
    counts.set(row.type, (counts.get(row.type) || 0) + number(row.count));
  }
  const comparable = !hasUnrecognizedPositiveRow && counts.size === 1;
  const [typeId, actual] = comparable ? [...counts.entries()][0] : [null, null];
  const predicted = comparable ? prediction.shuttleCounts[typeId] || 0 : null;
  const shuttleDifference = comparable ? Math.abs(actual - predicted) : null;
  return {
    anomalous: courtDifference > 1 || (comparable && shuttleDifference >= 2),
    court: { predicted: prediction.courts, actual: Number(courtCount) || 0, difference: courtDifference },
    shuttle: { comparable, typeId, predicted, actual, difference: shuttleDifference },
  };
}
