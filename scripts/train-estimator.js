import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const outputPath = resolve("data/booking-estimator.json");
const wrangler = resolve("node_modules", "wrangler", "bin", "wrangler.js");

const COURT_EXCLUDED_SESSIONS = [
  {
    date: "2026-08-10",
    reason: "低水平且场地拥挤，实际订场数量不代表常规需求。",
  },
];

const SHUTTLE_EXCLUDED_SESSIONS = [
  {
    date: "2026-08-04",
    reason: "球友请客，实际用球数量不完整，不能作为训练样本。",
  },
];

const SHUTTLE_TYPES = [
  { id: "rsl3", name: "亚3", fullName: "亚狮龙3号", prices: [11, 11.3, 11.5], durability: 1 },
  { id: "as05", name: "AS05", fullName: "尤尼克斯AS05", prices: [13.5], durability: 1.2 },
];

const BASE_SHUTTLE_TYPE = "rsl3";
const DEFAULT_PEOPLE_PER_COURT = 7.5;
const COURT_CAPACITY_SEARCH = { min: 6, max: 9, step: 0.25 };
const MINIMUM_ROLLING_TRAINING_SESSIONS = 5;
const DEFAULT_SHUTTLE_RISK_QUANTILE = 0.7;

function configurationNumber(name, fallback, { min = -Infinity, max = Infinity } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} 必须是 ${min} 到 ${max} 之间的数字`);
  }
  return value;
}

const shuttleRiskQuantile = configurationNumber(
  "BOOKING_ESTIMATOR_SHUTTLE_RISK_QUANTILE",
  DEFAULT_SHUTTLE_RISK_QUANTILE,
  { min: 0.5, max: 0.99 },
);
const shuttleRiskBufferOverride = configurationNumber(
  "BOOKING_ESTIMATOR_SHUTTLE_RISK_BUFFER",
  null,
  { min: 0 },
);

const query = `
SELECT * FROM booking_sessions ORDER BY date ASC, id ASC;
SELECT * FROM booking_session_players ORDER BY session_id ASC, id ASC;
`;

const { stdout } = await execFileAsync(
  process.execPath,
  [wrangler, "d1", "execute", "DB", "--remote", "--json", "--command", query],
  { cwd: resolve("."), maxBuffer: 20 * 1024 * 1024 },
);
const resultSets = JSON.parse(stdout);
if (!Array.isArray(resultSets) || resultSets.length < 2 || resultSets.some((set) => !set.success)) {
  throw new Error("Could not read estimator training data from D1");
}

const [sessionRows, sessionPlayerRows] = resultSets.map((set) => set.results || []);
const rowsBySession = new Map();
for (const row of sessionPlayerRows) {
  const sessionId = Number(row.session_id);
  if (!rowsBySession.has(sessionId)) rowsBySession.set(sessionId, []);
  rowsBySession.get(sessionId).push(row);
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 3) {
  return Number(value.toFixed(digits));
}

function participantCount(session) {
  return (rowsBySession.get(Number(session.id)) || []).reduce((sum, row) => {
    const slots = Number(row.slots);
    return sum + (Number.isInteger(slots) && slots >= 0 ? slots : 0);
  }, 0);
}

function shuttleTypeForPrice(price) {
  return SHUTTLE_TYPES.find((type) => (
    type.prices.some((knownPrice) => Math.abs(knownPrice - price) < 0.02)
  )) || null;
}

function shuttleTypeForRow(row, session) {
  const explicitType = row.type === null || row.type === undefined
    ? ""
    : String(row.type).trim().toLowerCase();
  if (explicitType) {
    const type = SHUTTLE_TYPES.find((candidate) => candidate.id === explicitType);
    if (!type) {
      throw new Error(
        `${session.date}（场次 ${session.id}）包含未登记球型号 “${row.type}”，请先登记型号再训练`,
      );
    }
    return type;
  }

  const price = Number(row.price);
  const inferred = Number.isFinite(price) ? shuttleTypeForPrice(price) : null;
  if (!inferred) {
    throw new Error(
      `${session.date}（场次 ${session.id}）的球价 ${row.price ?? "未填写"} 元无法识别球型号，请先登记型号再训练`,
    );
  }
  return inferred;
}

function parseShuttleRows(session) {
  const raw = String(session.shuttle_price_rows || "").trim();
  let rows = [];
  if (raw) {
    try {
      rows = JSON.parse(raw);
    } catch (error) {
      throw new Error(`${session.date}（场次 ${session.id}）的用球明细不是有效 JSON`, { cause: error });
    }
    if (!Array.isArray(rows)) {
      throw new Error(`${session.date}（场次 ${session.id}）的用球明细必须是数组`);
    }
  }

  if (!rows.length && number(session.shuttle_count) > 0) {
    rows = [{ price: number(session.shuttle_price), count: number(session.shuttle_count) }];
  }
  return rows;
}

function asRsl3Equivalent(session) {
  return parseShuttleRows(session).reduce((sum, row) => {
    const count = Number(row.count);
    if (!Number.isInteger(count) || count < 0) {
      throw new Error(`${session.date}（场次 ${session.id}）包含无效用球数量 “${row.count}”`);
    }
    if (count === 0) return sum;
    const type = shuttleTypeForRow(row, session);
    return sum + count * type.durability;
  }, 0);
}

const sessions = sessionRows.map((session) => ({
  source: session,
  id: Number(session.id),
  date: String(session.date || ""),
  participantCount: participantCount(session),
  courtTarget: Number(session.court_count),
})).sort((left, right) => left.date.localeCompare(right.date) || left.id - right.id);

function buildCourtSamples() {
  const excludedDates = new Set(COURT_EXCLUDED_SESSIONS.map((item) => item.date));
  const samples = [];
  const skippedSessions = [];
  for (const session of sessions) {
    if (excludedDates.has(session.date)) continue;
    if (session.participantCount <= 0) {
      skippedSessions.push({ date: session.date, id: session.id, reason: "没有有效参与人次" });
      continue;
    }
    if (!Number.isInteger(session.courtTarget) || session.courtTarget <= 0) {
      skippedSessions.push({ date: session.date, id: session.id, reason: "没有有效场地数量" });
      continue;
    }
    samples.push({
      id: session.id,
      date: session.date,
      participantCount: session.participantCount,
      target: session.courtTarget,
    });
  }
  return { samples, skippedSessions };
}

function buildShuttleSamples() {
  const excludedDates = new Set(SHUTTLE_EXCLUDED_SESSIONS.map((item) => item.date));
  const samples = [];
  const skippedSessions = [];
  for (const session of sessions) {
    if (excludedDates.has(session.date)) continue;
    if (session.participantCount <= 0) {
      skippedSessions.push({ date: session.date, id: session.id, reason: "没有有效参与人次" });
      continue;
    }
    const target = asRsl3Equivalent(session.source);
    if (!(target > 0)) {
      skippedSessions.push({ date: session.date, id: session.id, reason: "没有有效用球数量" });
      continue;
    }
    samples.push({
      id: session.id,
      date: session.date,
      participantCount: session.participantCount,
      target,
    });
  }
  return { samples, skippedSessions };
}

const courtTrainingData = buildCourtSamples();
const shuttleTrainingData = buildShuttleSamples();
const courtSamples = courtTrainingData.samples;
const shuttleSamples = shuttleTrainingData.samples;

for (const [label, samplesForKind] of [["场地", courtSamples], ["用球", shuttleSamples]]) {
  if (samplesForKind.length <= MINIMUM_ROLLING_TRAINING_SESSIONS) {
    throw new Error(`${label}预估至少需要 ${MINIMUM_ROLLING_TRAINING_SESSIONS + 1} 场有效记录才能训练和滚动验证`);
  }
}

function courtCapacityCandidates() {
  const candidates = [];
  for (
    let value = COURT_CAPACITY_SEARCH.min;
    value <= COURT_CAPACITY_SEARCH.max + 1e-9;
    value += COURT_CAPACITY_SEARCH.step
  ) {
    candidates.push(round(value, 4));
  }
  return candidates;
}

function courtPrediction(sample, peoplePerCourt) {
  return Math.max(1, Math.ceil(sample.participantCount / peoplePerCourt));
}

function errorSummary(records) {
  if (!records.length) throw new Error("没有可用于验证的测试场次");
  const errors = records.map(({ predicted, actual }) => predicted - actual);
  const absoluteError = errors.reduce((sum, error) => sum + Math.abs(error), 0);
  const squaredError = errors.reduce((sum, error) => sum + error ** 2, 0);
  const bias = errors.reduce((sum, error) => sum + error, 0) / records.length;
  return {
    folds: records.length,
    mae: round(absoluteError / records.length),
    rmse: round(Math.sqrt(squaredError / records.length)),
    exactRate: round(errors.filter((error) => Math.abs(error) < 1e-9).length / records.length),
    bias: round(bias),
    underPredictionRate: round(errors.filter((error) => error < -1e-9).length / records.length),
    overPredictionRate: round(errors.filter((error) => error > 1e-9).length / records.length),
  };
}

function compareCourtCandidates(left, right) {
  const keys = ["mae", "rmse"];
  for (const key of keys) {
    if (Math.abs(left[key] - right[key]) > 1e-12) return left[key] - right[key];
  }
  const leftDistance = Math.abs(left.peoplePerCourt - DEFAULT_PEOPLE_PER_COURT);
  const rightDistance = Math.abs(right.peoplePerCourt - DEFAULT_PEOPLE_PER_COURT);
  if (Math.abs(leftDistance - rightDistance) > 1e-12) return leftDistance - rightDistance;
  return left.peoplePerCourt - right.peoplePerCourt;
}

function selectCourtCapacity(samplesForFit) {
  return courtCapacityCandidates()
    .map((peoplePerCourt) => {
      const records = samplesForFit.map((sample) => ({
        predicted: courtPrediction(sample, peoplePerCourt),
        actual: sample.target,
      }));
      const errors = records.map(({ predicted, actual }) => predicted - actual);
      return {
        peoplePerCourt,
        mae: errors.reduce((sum, error) => sum + Math.abs(error), 0) / errors.length,
        rmse: Math.sqrt(errors.reduce((sum, error) => sum + error ** 2, 0) / errors.length),
      };
    })
    .sort(compareCourtCandidates)[0].peoplePerCourt;
}

function quantile(values, probability) {
  if (!values.length) throw new Error("分位数至少需要一个数值");
  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const fraction = index - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * fraction;
}

function trainShuttleFormula(samplesForFit) {
  const squaredParticipants = samplesForFit.reduce(
    (sum, sample) => sum + sample.participantCount ** 2,
    0,
  );
  const participantTargetMoment = samplesForFit.reduce(
    (sum, sample) => sum + sample.participantCount * sample.target,
    0,
  );
  if (!(squaredParticipants > 0)) throw new Error("用球训练样本缺少有效参与人次");

  const rate = participantTargetMoment / squaredParticipants;
  const residuals = samplesForFit.map((sample) => sample.target - sample.participantCount * rate);
  const learnedBuffer = Math.max(0, quantile(residuals, shuttleRiskQuantile));
  return {
    rate,
    riskBuffer: shuttleRiskBufferOverride ?? learnedBuffer,
  };
}

function shuttlePrediction(sample, formula, durability = 1) {
  const equivalentDemand = sample.participantCount * formula.rate + formula.riskBuffer;
  return Math.max(1, Math.ceil(equivalentDemand / durability));
}

function rollingOriginRecords(samplesForValidation, fit, predict) {
  const records = [];
  for (const holdout of samplesForValidation) {
    const trainingPrefix = samplesForValidation.filter((sample) => sample.date < holdout.date);
    if (trainingPrefix.length < MINIMUM_ROLLING_TRAINING_SESSIONS) continue;
    const fitted = fit(trainingPrefix);
    records.push({
      date: holdout.date,
      predicted: predict(holdout, fitted),
      actual: holdout.target,
    });
  }
  return records;
}

function validationSummary(records) {
  return {
    method: "rolling-origin",
    minimumTrainingSessions: MINIMUM_ROLLING_TRAINING_SESSIONS,
    firstValidationDate: records[0]?.date || null,
    lastValidationDate: records.at(-1)?.date || null,
    ...errorSummary(records),
  };
}

function sampleDateRange(samplesForRange) {
  const dates = samplesForRange.map((sample) => sample.date).sort();
  return { from: dates[0] || null, to: dates.at(-1) || null };
}

function trainingSummary(samplesForSummary, excludedSessions, skippedSessions) {
  return {
    sampleCount: samplesForSummary.length,
    dateRange: sampleDateRange(samplesForSummary),
    excludedSessions,
    skippedSessions,
  };
}

const peoplePerCourt = selectCourtCapacity(courtSamples);
const courtValidationRecords = rollingOriginRecords(
  courtSamples,
  selectCourtCapacity,
  (sample, capacity) => courtPrediction(sample, capacity),
);
const shuttleFormula = trainShuttleFormula(shuttleSamples);
const shuttleValidationRecords = rollingOriginRecords(
  shuttleSamples,
  trainShuttleFormula,
  (sample, formula) => shuttlePrediction(sample, formula),
);
const allTrainingSamples = [...courtSamples, ...shuttleSamples];

const model = {
  version: 3,
  generatedAt: new Date().toISOString(),
  training: {
    dateRange: sampleDateRange(allTrainingSamples),
    court: trainingSummary(
      courtSamples,
      COURT_EXCLUDED_SESSIONS,
      courtTrainingData.skippedSessions,
    ),
    shuttle: trainingSummary(
      shuttleSamples,
      SHUTTLE_EXCLUDED_SESSIONS,
      shuttleTrainingData.skippedSessions,
    ),
  },
  shuttleTypes: SHUTTLE_TYPES,
  court: {
    formula: "ceil(participantCount / peoplePerCourt)",
    peoplePerCourt,
    minimum: 1,
    selection: {
      strategy: "grid-search",
      objective: "mae-then-rmse",
      tieBreak: "closest-to-default",
      defaultPeoplePerCourt: DEFAULT_PEOPLE_PER_COURT,
      candidates: COURT_CAPACITY_SEARCH,
    },
    validation: validationSummary(courtValidationRecords),
  },
  shuttle: {
    baseType: BASE_SHUTTLE_TYPE,
    formula: "ceil((participantCount * rsl3EquivalentPerParticipant + riskBuffer) / durability)",
    rsl3EquivalentPerParticipant: round(shuttleFormula.rate, 6),
    riskQuantile: shuttleRiskQuantile,
    riskBuffer: round(shuttleFormula.riskBuffer, 6),
    riskBufferSource: shuttleRiskBufferOverride === null
      ? "residual-quantile"
      : "environment-override",
    minimum: 1,
    validation: validationSummary(shuttleValidationRecords),
  },
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(model, null, 2)}\n`, "utf8");
console.log(
  `Trained ${outputPath}: court=${courtSamples.length} sessions, shuttle=${shuttleSamples.length} sessions`,
);
