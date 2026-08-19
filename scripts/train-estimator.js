import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const outputPath = resolve("data/booking-estimator.json");
const wrangler = resolve("node_modules", "wrangler", "bin", "wrangler.js");

const EXCLUDED_SESSIONS = [
  {
    date: "2026-08-04",
    reason: "球友请客，实际用球数量不完整，不能作为训练样本。",
  },
  {
    date: "2026-08-10",
    reason: "低水平且场地拥挤，实际订场数量不代表常规需求。",
  },
];

const SHUTTLE_TYPES = [
  { id: "rsl3", name: "亚3", fullName: "亚狮龙3号", prices: [11, 11.3, 11.5], durability: 1 },
  { id: "as05", name: "AS05", fullName: "尤尼克斯AS05", prices: [13.5], durability: 1.2 },
];

const query = `
SELECT * FROM players ORDER BY id ASC;
SELECT * FROM booking_sessions ORDER BY date ASC, id ASC;
SELECT * FROM booking_session_players ORDER BY session_id ASC, id ASC;
`;

const { stdout } = await execFileAsync(
  process.execPath,
  [wrangler, "d1", "execute", "DB", "--remote", "--json", "--command", query],
  { cwd: resolve("."), maxBuffer: 20 * 1024 * 1024 },
);
const resultSets = JSON.parse(stdout);
if (!Array.isArray(resultSets) || resultSets.length < 3 || resultSets.some((set) => !set.success)) {
  throw new Error("Could not read estimator training data from D1");
}

const [playerRows, sessionRows, sessionPlayerRows] = resultSets.map((set) => set.results || []);
const playersById = new Map(playerRows.map((player) => [Number(player.id), player]));
const excludedDates = new Set(EXCLUDED_SESSIONS.map((item) => item.date));
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

function levelValue(level) {
  const parsed = Number.parseFloat(String(level || "").replace("级", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function validGender(value) {
  return value === "男" || value === "女" || value === "不详" ? value : "不详";
}

function validLevel(value) {
  return levelValue(value) === null ? "不详" : value;
}

function shuttleTypeForPrice(price) {
  return SHUTTLE_TYPES.find((type) => type.prices.some((knownPrice) => Math.abs(knownPrice - price) < 0.02)) || null;
}

function parseShuttleRows(session) {
  let rows = [];
  try {
    rows = Array.isArray(JSON.parse(session.shuttle_price_rows || "")) ? JSON.parse(session.shuttle_price_rows) : [];
  } catch (error) {
    rows = [];
  }
  if (!rows.length && number(session.shuttle_count) > 0) {
    rows = [{ price: number(session.shuttle_price), count: number(session.shuttle_count) }];
  }
  return rows;
}

const knownLevels = [];
let maleCount = 0;
let knownGenderCount = 0;
for (const row of sessionPlayerRows) {
  const player = playersById.get(Number(row.player_id));
  const level = validLevel(row.level_snapshot || player?.level);
  const gender = validGender(row.gender_snapshot || player?.gender);
  const levelNumber = levelValue(level);
  if (levelNumber !== null) knownLevels.push(levelNumber);
  if (gender === "男" || gender === "女") {
    knownGenderCount += 1;
    if (gender === "男") maleCount += 1;
  }
}
const fallbackLevel = knownLevels.length
  ? knownLevels.reduce((sum, value) => sum + value, 0) / knownLevels.length
  : 3;
const unknownMaleProbability = knownGenderCount ? maleCount / knownGenderCount : 0.5;

function buildParticipants(session) {
  const participants = [];
  for (const row of rowsBySession.get(Number(session.id)) || []) {
    const player = playersById.get(Number(row.player_id));
    const gender = validGender(row.gender_snapshot || player?.gender || (Number(row.is_female) ? "女" : "不详"));
    const level = validLevel(row.level_snapshot || player?.level);
    participants.push({
      playerId: row.player_id === null || row.player_id === undefined ? null : Number(row.player_id),
      gender,
      level,
    });
    const companions = Math.max(0, Math.floor(number(row.plus_count, Math.max(0, number(row.slots) - 1))));
    for (let index = 0; index < companions; index += 1) {
      participants.push({ playerId: null, gender: "不详", level: "不详" });
    }
  }
  return participants;
}

function asRsl3Equivalent(session) {
  return parseShuttleRows(session).reduce((sum, row) => {
    const type = shuttleTypeForPrice(number(row.price));
    return sum + Math.max(0, number(row.count)) * (type?.durability || 1);
  }, 0);
}

const sessions = sessionRows
  .filter((session) => !excludedDates.has(String(session.date || "")))
  .map((session) => ({
    id: Number(session.id),
    date: String(session.date),
    courtTarget: Math.max(0, Math.round(number(session.court_count))),
    shuttleTarget: asRsl3Equivalent(session),
    participants: buildParticipants(session),
  }))
  .filter((session) => session.participants.length && session.courtTarget > 0 && session.shuttleTarget > 0);

if (sessions.length < 3) throw new Error("至少需要三场有效订场记录才能训练预估模型");

const STANDARD_LEVEL_KEYS = ["不详", "0.5", "1", "1.5", "2", "2.5", "3", "3.5", "4", "4.5", "5", "6", "7", "8", "9"];
const GENDER_LEVEL_KEYS = [
  ...["male", "female"].flatMap((gender) => STANDARD_LEVEL_KEYS.map((level) => `${gender}:${level}`)),
  "unknown:unknown",
];

function genderLevelKey(participant) {
  const gender = participant.gender === "男" ? "male" : participant.gender === "女" ? "female" : "unknown";
  const level = participant.level === "不详" ? "不详" : String(levelValue(participant.level));
  const key = `${gender}:${level}`;
  return GENDER_LEVEL_KEYS.includes(key) ? key : "unknown:unknown";
}

function categoryCounts(session) {
  const counts = new Map(GENDER_LEVEL_KEYS.map((key) => [key, 0]));
  for (const participant of session.participants) {
    const key = genderLevelKey(participant);
    counts.set(key, counts.get(key) + 1);
  }
  return counts;
}

function solveLinearSystem(matrix, vector) {
  const size = matrix.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const pivotValue = augmented[column][column];
    if (Math.abs(pivotValue) < 1e-12) continue;
    for (let col = column; col <= size; col += 1) augmented[column][col] /= pivotValue;
    for (let row = 0; row < size; row += 1) {
      if (row === column || Math.abs(augmented[row][column]) < 1e-12) continue;
      const factor = augmented[row][column];
      for (let col = column; col <= size; col += 1) augmented[row][col] -= factor * augmented[column][col];
    }
  }
  return augmented.map((row) => row[size]);
}

function ridgeCoefficients(samples, kind, lambda) {
  const featureCount = GENDER_LEVEL_KEYS.length;
  const size = 1 + featureCount;
  const gram = Array.from({ length: size }, () => Array(size).fill(0));
  const moment = Array(size).fill(0);
  for (const sample of samples) {
    const features = [1, ...GENDER_LEVEL_KEYS.map((key) => sample.counts.get(key) || 0)];
    const target = kind === "court" ? sample.session.courtTarget : sample.session.shuttleTarget;
    for (let row = 0; row < size; row += 1) {
      moment[row] += features[row] * target;
      for (let column = 0; column < size; column += 1) {
        gram[row][column] += features[row] * features[column];
      }
    }
  }
  for (let index = 1; index < size; index += 1) gram[index][index] += lambda;
  return solveLinearSystem(gram, moment);
}

function modelFromCoefficients(samples, coefficients) {
  const rawWeights = coefficients.slice(1).map((value) => Math.max(0.4, value));
  const meanTarget = samples.reduce((sum, sample) => sum + sample.target, 0) / samples.length;
  const intercept = meanTarget - GENDER_LEVEL_KEYS.reduce((sum, key, index) => {
    const meanCount = samples.reduce((total, sample) => total + (sample.counts.get(key) || 0), 0) / samples.length;
    return sum + rawWeights[index] * meanCount;
  }, 0);
  return { intercept, weights: rawWeights };
}

function trainModel(samples, kind, lambda) {
  const coefficients = ridgeCoefficients(samples, kind, lambda);
  return modelFromCoefficients(samples, coefficients);
}

function rawPrediction(sample, model) {
  return model.intercept + GENDER_LEVEL_KEYS.reduce((sum, key, index) => (
    sum + model.weights[index] * (sample.counts.get(key) || 0)
  ), 0);
}

function countPrediction(sample, model, kind, roundingOffset = 0) {
  const raw = rawPrediction(sample, model);
  return kind === "court"
    ? Math.max(1, Math.ceil(raw - roundingOffset))
    : Math.max(1, Math.ceil(raw));
}

function leaveOneOutScore(samples, kind, lambda, roundingOffset = 0) {
  let absoluteError = 0;
  let squaredError = 0;
  for (let holdout = 0; holdout < samples.length; holdout += 1) {
    const training = samples.filter((_, index) => index !== holdout);
    const model = trainModel(training, kind, lambda);
    const sample = samples[holdout];
    const error = countPrediction(sample, model, kind, roundingOffset) - sample.target;
    absoluteError += Math.abs(error);
    squaredError += error ** 2;
  }
  return {
    looMae: absoluteError / samples.length,
    looRmse: Math.sqrt(squaredError / samples.length),
  };
}

function selectModel(kind) {
  const samples = sessions.map((session) => ({
    session,
    counts: categoryCounts(session),
    target: kind === "court" ? session.courtTarget : session.shuttleTarget,
  }));
  const lambdas = [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10, 20];
  const offsets = kind === "court" ? [0, 0.2, 0.4, 0.6, 0.8] : [0];
  let best = null;
  for (const lambda of lambdas) {
    for (const roundingOffset of offsets) {
      const validation = leaveOneOutScore(samples, kind, lambda, roundingOffset);
      const score = validation.looMae + validation.looRmse * 0.08;
      if (!best || score < best.score) {
        best = { lambda, roundingOffset, score, ...validation };
      }
    }
  }
  const model = trainModel(samples, kind, best.lambda);
  return {
    ...best,
    model,
    looMae: best.looMae,
    looRmse: best.looRmse,
  };
}

function expectedLoad(session, model) {
  return model.intercept + GENDER_LEVEL_KEYS.reduce((sum, key, index) => {
    const counts = categoryCounts(session);
    return sum + model.weights[index] * (counts.get(key) || 0);
  }, 0);
}

function memberAdjustments(kind, model) {
  const values = new Map();
  for (const session of sessions) {
    const expected = expectedLoad(session, model);
    const target = kind === "court" ? session.courtTarget : session.shuttleTarget;
    const members = session.participants.filter((participant) => participant.playerId !== null);
    if (!members.length) continue;
    const share = (target - expected) / members.length;
    for (const member of members) {
      const record = values.get(member.playerId) || { sum: 0, count: 0 };
      record.sum += share;
      record.count += 1;
      values.set(member.playerId, record);
    }
  }
  const cap = kind === "court" ? 0.35 : 2;
  return Object.fromEntries([...values.entries()].map(([playerId, record]) => {
    const raw = record.sum / record.count;
    const shrunk = raw * (record.count / (record.count + 4));
    return [String(playerId), Math.max(-cap, Math.min(cap, Number(shrunk.toFixed(3))))];
  }));
}

const court = selectModel("court");
const shuttle = selectModel("shuttle");
const model = {
  version: 2,
  generatedAt: new Date().toISOString(),
  training: {
    validSessions: sessions.length,
    excludedSessions: EXCLUDED_SESSIONS,
    fallbackLevel: Number(fallbackLevel.toFixed(3)),
    unknownMaleProbability: Number(unknownMaleProbability.toFixed(3)),
  },
  shuttleTypes: SHUTTLE_TYPES,
  court: {
    genderLevelWeights: Object.fromEntries(GENDER_LEVEL_KEYS.map((key, index) => [key, Number(court.model.weights[index].toFixed(4))])),
    intercept: Number(court.model.intercept.toFixed(4)),
    roundingOffset: court.roundingOffset,
    memberAdjustments: memberAdjustments("court", court.model),
    validation: { looMae: Number(court.looMae.toFixed(3)), looRmse: Number(court.looRmse.toFixed(3)) },
  },
  shuttle: {
    baseType: "rsl3",
    genderLevelWeights: Object.fromEntries(GENDER_LEVEL_KEYS.map((key, index) => [key, Number(shuttle.model.weights[index].toFixed(4))])),
    intercept: Number(shuttle.model.intercept.toFixed(4)),
    memberAdjustments: memberAdjustments("shuttle", shuttle.model),
    validation: { looMae: Number(shuttle.looMae.toFixed(3)), looRmse: Number(shuttle.looRmse.toFixed(3)) },
  },
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(model, null, 2)}\n`, "utf8");
console.log(`Trained ${outputPath} from ${sessions.length} valid sessions`);
