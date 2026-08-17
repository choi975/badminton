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

function participantWeight(participant, params) {
  const rawLevel = levelValue(participant.level);
  const level = rawLevel === null ? fallbackLevel : rawLevel;
  const genderLoad = participant.gender === "男" ? 1 : participant.gender === "不详" ? unknownMaleProbability : 0;
  return Math.max(0.4, 1 + params.levelSlope * (level - fallbackLevel) + params.maleBonus * genderLoad);
}

function loadFor(session, params) {
  return session.participants.reduce((sum, participant) => sum + participantWeight(participant, params), 0);
}

function fitLine(samples) {
  const count = samples.length;
  const meanX = samples.reduce((sum, sample) => sum + sample.x, 0) / count;
  const meanY = samples.reduce((sum, sample) => sum + sample.y, 0) / count;
  const denominator = samples.reduce((sum, sample) => sum + (sample.x - meanX) ** 2, 0);
  let slope = denominator > 1e-9
    ? samples.reduce((sum, sample) => sum + (sample.x - meanX) * (sample.y - meanY), 0) / denominator
    : 0;
  slope = Math.max(0, slope);
  const intercept = meanY - slope * meanX;
  return { intercept, slope };
}

function prediction(line, load, kind, roundingOffset = 0) {
  const raw = line.intercept + line.slope * load;
  if (kind === "court") return Math.max(1, Math.ceil(raw - roundingOffset));
  return Math.max(1, Math.ceil(raw));
}

function candidates(kind) {
  const result = [];
  const levelSlopes = kind === "court"
    ? [0.06, 0.08, 0.1, 0.12, 0.14, 0.16]
    : [0.04, 0.08, 0.12, 0.16, 0.2];
  const maleBonuses = kind === "court"
    ? [0.02, 0.04, 0.06, 0.08, 0.1]
    : [0.04, 0.08, 0.12, 0.16, 0.2];
  for (const levelSlope of levelSlopes) {
    for (const maleBonus of maleBonuses) {
      result.push({ levelSlope, maleBonus });
    }
  }
  return result;
}

function selectModel(kind) {
  const offsets = kind === "court" ? [0, 0.2, 0.4, 0.6, 0.8] : [0];
  let best = null;
  for (const params of candidates(kind)) {
    for (const roundingOffset of offsets) {
      let absoluteError = 0;
      let squaredError = 0;
      for (let holdout = 0; holdout < sessions.length; holdout += 1) {
        const training = sessions.filter((_, index) => index !== holdout).map((session) => ({
          x: loadFor(session, params),
          y: kind === "court" ? session.courtTarget : session.shuttleTarget,
        }));
        const line = fitLine(training);
        const held = sessions[holdout];
        const predicted = prediction(line, loadFor(held, params), kind, roundingOffset);
        const actual = kind === "court" ? held.courtTarget : held.shuttleTarget;
        const error = predicted - actual;
        absoluteError += Math.abs(error);
        squaredError += error ** 2;
      }
      const complexity = params.levelSlope + params.maleBonus;
      const score = absoluteError + squaredError * 0.08 + complexity * 0.02;
      if (!best || score < best.score) best = { params, roundingOffset, score, absoluteError, squaredError };
    }
  }
  const line = fitLine(sessions.map((session) => ({
    x: loadFor(session, best.params),
    y: kind === "court" ? session.courtTarget : session.shuttleTarget,
  })));
  return {
    ...best,
    line,
    looMae: best.absoluteError / sessions.length,
    looRmse: Math.sqrt(best.squaredError / sessions.length),
  };
}

function memberAdjustments(kind, model) {
  const values = new Map();
  for (const session of sessions) {
    const expected = model.line.intercept + model.line.slope * loadFor(session, model.params);
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
  version: 1,
  generatedAt: new Date().toISOString(),
  training: {
    validSessions: sessions.length,
    excludedSessions: EXCLUDED_SESSIONS,
    fallbackLevel: Number(fallbackLevel.toFixed(3)),
    unknownMaleProbability: Number(unknownMaleProbability.toFixed(3)),
  },
  shuttleTypes: SHUTTLE_TYPES,
  court: {
    levelSlope: court.params.levelSlope,
    maleBonus: court.params.maleBonus,
    intercept: Number(court.line.intercept.toFixed(4)),
    slope: Number(court.line.slope.toFixed(4)),
    roundingOffset: court.roundingOffset,
    memberAdjustments: memberAdjustments("court", court),
    validation: { looMae: Number(court.looMae.toFixed(3)), looRmse: Number(court.looRmse.toFixed(3)) },
  },
  shuttle: {
    baseType: "rsl3",
    levelSlope: shuttle.params.levelSlope,
    maleBonus: shuttle.params.maleBonus,
    intercept: Number(shuttle.line.intercept.toFixed(4)),
    slope: Number(shuttle.line.slope.toFixed(4)),
    memberAdjustments: memberAdjustments("shuttle", shuttle),
    validation: { looMae: Number(shuttle.looMae.toFixed(3)), looRmse: Number(shuttle.looRmse.toFixed(3)) },
  },
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(model, null, 2)}\n`, "utf8");
console.log(`Trained ${outputPath} from ${sessions.length} valid sessions`);
