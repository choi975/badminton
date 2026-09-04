import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { buildGroupLearningSignals } from "../src/group-learning-core.js";

const execFileAsync = promisify(execFile);
const outputPath = resolve("data/bootstrap-snapshot.json");
const GROUP_LEARNING_LOOKBACK_DAYS = 365;
const GROUP_LEARNING_MAX_ATTEMPTS = 50;
const GROUP_LEARNING_MAX_ROWS = 10_000;
const GROUP_LEARNING_HALF_LIFE_DAYS = 30;
const snapshotNow = new Date();
const snapshotToday = new Date(snapshotNow.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
const learningEarliestDate = new Date(
  Date.parse(`${snapshotToday}T00:00:00.000Z`) - (GROUP_LEARNING_LOOKBACK_DAYS - 1) * 86_400_000,
).toISOString().slice(0, 10);
const query = `
SELECT * FROM players ORDER BY id ASC;
SELECT key, value FROM app_settings ORDER BY key ASC;
SELECT level, description, sort_order FROM level_guides ORDER BY sort_order ASC;
SELECT affiliation, player_id, join_number FROM group_join_numbers ORDER BY affiliation ASC, join_number ASC, player_id ASC;
SELECT id, date, venue, court_count, court_fee, shuttle_price, shuttle_count, court_price_rows, shuttle_price_rows, train_court, train_shuttle, actual_shuttle_confirmed, created_at, updated_at FROM booking_sessions ORDER BY date ASC, id ASC;
SELECT id, session_id, player_id, player_name, owner_player_id, owner_name_snapshot, is_companion, slots, plus_count, amount, is_female, gender_snapshot, level_snapshot, profile_snapshot_reliable FROM booking_session_players ORDER BY session_id ASC, id ASC;
SELECT id, player_id, rule_type, rule_json, starts_on, expires_on, raw_text, created_at, updated_at FROM short_term_rules ORDER BY CASE WHEN expires_on IS NULL THEN 0 ELSE 1 END ASC, expires_on ASC, created_at ASC, id ASC;
SELECT list_key, label, members_json, updated_at FROM shake_long_term_lists ORDER BY list_key ASC;
SELECT attempts.activity_date, attempts.outcome, attempts.training_state, attempts.source, EXISTS (SELECT 1 FROM group_attempt_snapshots snapshots WHERE snapshots.attempt_id = attempts.id AND snapshots.training_state = 'eligible') AS has_eligible_snapshots FROM group_attempts attempts WHERE attempts.group_key = 'main' ORDER BY attempts.activity_date ASC;
WITH selected_group_learning_attempts AS (
  SELECT attempts.id AS attempt_id, attempts.activity_date, attempts.outcome AS attempt_outcome,
         attempts.training_state AS attempt_training_state, attempts.source AS attempt_source
  FROM group_attempts attempts
  WHERE attempts.group_key = 'main'
    AND attempts.activity_date >= '${learningEarliestDate}'
    AND attempts.activity_date <= '${snapshotToday}'
    AND attempts.training_state = 'eligible'
    AND EXISTS (
      SELECT 1
      FROM group_attempt_snapshots eligible_snapshots
      WHERE eligible_snapshots.attempt_id = attempts.id
        AND eligible_snapshots.training_state = 'eligible'
    )
  ORDER BY attempts.activity_date DESC, attempts.id DESC
  LIMIT ${GROUP_LEARNING_MAX_ATTEMPTS}
)
SELECT attempts.attempt_id, attempts.activity_date, attempts.attempt_outcome, attempts.attempt_training_state, attempts.attempt_source,
       snapshots.id AS snapshot_id, snapshots.observed_at AS snapshot_observed_at, snapshots.training_state AS snapshot_training_state,
       snapshots.participant_count AS snapshot_participant_count, snapshots.known_player_ids_json, snapshots.companions_by_owner_json
FROM selected_group_learning_attempts attempts
INNER JOIN group_attempt_snapshots snapshots
  ON snapshots.attempt_id = attempts.attempt_id
 AND snapshots.training_state = 'eligible'
ORDER BY attempts.activity_date ASC, attempts.attempt_id ASC, snapshots.observed_at ASC, snapshots.id ASC;
`;

const wrangler = resolve("node_modules", "wrangler", "bin", "wrangler.js");
const { stdout } = await execFileAsync(
  process.execPath,
  [wrangler, "d1", "execute", "DB", "--remote", "--json", "--command", query],
  { cwd: resolve("."), maxBuffer: 64 * 1024 * 1024 },
);
const resultSets = JSON.parse(stdout);
if (!Array.isArray(resultSets) || resultSets.length < 10 || resultSets.some((set) => !set.success)) {
  throw new Error("Could not read all snapshot tables from D1");
}

const [
  playerRows,
  settingRows,
  levelRows,
  joinRows,
  sessionRows,
  sessionPlayerRows,
  shortTermRuleRows,
  shakeLongTermListRows,
  groupAttemptOutcomeRows,
  groupLearningRows,
] = resultSets.map((set) => set.results || []);
if (groupLearningRows.length > GROUP_LEARNING_MAX_ROWS) {
  throw new Error("Group-learning query exceeded its complete-attempt row bound");
}
const estimator = JSON.parse(await readFile(resolve("data/booking-estimator.json"), "utf8"));
const shuttleTypes = Array.isArray(estimator.shuttleTypes) ? estimator.shuttleTypes : [];
const shuttleTypeIds = new Set(shuttleTypes.map((type) => type.id));
const players = playerRows.map((row) => ({
  id: Number(row.id),
  name: row.name || "",
  gender: row.gender || "男",
  level: row.level || "不详",
  affiliation: row.affiliation || "球友",
  notes: row.notes || "",
  photoKey: row.photo_key || "",
  participatesPayment: Number(row.participates_payment) !== 0,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
}));
const levelDescriptions = Object.fromEntries(levelRows.map((row) => [row.level, row.description]));
const levelGuideRaw = settingRows.find((row) => row.key === "level_guide_raw")?.value || "";
const groupJoinNumbers = { "球友": [], "Hytronik": [] };
for (const row of joinRows) {
  if (!groupJoinNumbers[row.affiliation]) continue;
  groupJoinNumbers[row.affiliation].push({
    playerId: Number(row.player_id),
    joinNumber: Number(row.join_number),
  });
}
const paymentOrders = Object.fromEntries(Object.entries(groupJoinNumbers).map(([affiliation, entries]) => [
  affiliation,
  entries.map((entry) => entry.playerId),
]));
const shuttleTypeForPrice = (price) => {
  const matches = shuttleTypes.filter((type) => (
    Array.isArray(type.prices)
      && type.prices.some((known) => Math.abs(Number(known) - Number(price)) < 0.02)
  ));
  return matches.length === 1 ? matches[0].id : "unknown";
};
const parsePriceRows = (raw, includeShuttleType = false) => {
  if (!raw) return null;
  const rows = JSON.parse(raw);
  if (!Array.isArray(rows)) return null;
  return rows.map((row) => includeShuttleType
    ? {
        ...row,
        type: shuttleTypeIds.has(row.type) ? row.type : shuttleTypeForPrice(row.price),
      }
    : row);
};
const sessionPlayersBySession = new Map();
for (const row of sessionPlayerRows) {
  const sessionId = Number(row.session_id);
  if (!sessionPlayersBySession.has(sessionId)) sessionPlayersBySession.set(sessionId, []);
  sessionPlayersBySession.get(sessionId).push({
    playerId: row.player_id === null ? null : Number(row.player_id),
    playerName: row.player_name || "",
    ownerPlayerId: row.owner_player_id === null ? null : Number(row.owner_player_id),
    ownerName: row.owner_name_snapshot || row.player_name || "",
    isCompanion: Number(row.is_companion) !== 0,
    slots: Number(row.slots),
    plusCount: Number(row.plus_count),
    amount: Number(row.amount),
    isFemale: Number(row.is_female) !== 0,
    gender: row.gender_snapshot || (Number(row.is_female) !== 0 ? "女" : "不详"),
    level: row.level_snapshot || "不详",
    profileSnapshotReliable: Number(row.profile_snapshot_reliable) !== 0,
  });
}
const sessions = sessionRows.map((row) => {
  const id = Number(row.id);
  return {
    id,
    date: row.date,
    venue: row.venue === "EDC" ? "EDC" : "文体",
    courtCount: Number(row.court_count),
    courtFee: Number(row.court_fee),
    shuttlePrice: Number(row.shuttle_price),
    shuttleCount: Number(row.shuttle_count),
    courtPriceRows: parsePriceRows(row.court_price_rows),
    shuttlePriceRows: parsePriceRows(row.shuttle_price_rows, true),
    trainCourt: Number(row.train_court) !== 0,
    trainShuttle: Number(row.train_shuttle) !== 0,
    actualShuttleConfirmed: Number(row.actual_shuttle_confirmed) !== 0,
    players: sessionPlayersBySession.get(id) || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
});
const parseJsonObject = (raw) => {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw || "{}") : raw;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    return {};
  }
};
const parseMemberList = (raw) => {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw || "[]") : raw;
    return Array.isArray(parsed)
      ? parsed.map((name) => String(name || "").trim()).filter(Boolean)
      : [];
  } catch (error) {
    return [];
  }
};
const shortTermRules = shortTermRuleRows.map((row) => ({
  id: Number(row.id),
  playerId: Number(row.player_id),
  type: String(row.rule_type || ""),
  rule: parseJsonObject(row.rule_json),
  startsOn: row.starts_on || null,
  expiresOn: row.expires_on || null,
  rawText: String(row.raw_text || ""),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
}));
const shakeLongTermLists = shakeLongTermListRows.map((row) => ({
  key: String(row.list_key || ""),
  label: String(row.label || row.list_key || ""),
  members: parseMemberList(row.members_json),
  updatedAt: row.updated_at,
}));
const groupAttemptOutcomes = groupAttemptOutcomeRows.map((row) => ({
  activityDate: String(row.activity_date || ""),
  outcome: String(row.outcome || ""),
  trainingState: String(row.training_state || ""),
  source: String(row.source || ""),
  hasEligibleSnapshots: Boolean(Number(row.has_eligible_snapshots)),
}));
const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const parseLearningJson = (value, fallback) => {
  if (Array.isArray(value) || isPlainObject(value)) return value;
  if (typeof value !== "string") return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) || isPlainObject(parsed) ? parsed : fallback;
  } catch (error) {
    return fallback;
  }
};
const isValidLearningDate = (value) => {
  const date = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const timestamp = Date.parse(`${date}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === date;
};
const groupLearningAttemptsById = new Map();
const groupLearningSnapshotIds = new Map();
for (const row of groupLearningRows) {
  const attemptId = Number(row.attempt_id);
  const activityDate = String(row.activity_date || "");
  if (!Number.isInteger(attemptId) || attemptId <= 0 || !isValidLearningDate(activityDate)) continue;
  let attempt = groupLearningAttemptsById.get(attemptId);
  if (!attempt) {
    attempt = {
      id: attemptId,
      activityDate,
      outcome: String(row.attempt_outcome || ""),
      trainingState: String(row.attempt_training_state || ""),
      source: String(row.attempt_source || ""),
      snapshots: [],
    };
    groupLearningAttemptsById.set(attemptId, attempt);
    groupLearningSnapshotIds.set(attemptId, new Set());
  }
  const snapshotId = Number(row.snapshot_id);
  const seenSnapshotIds = groupLearningSnapshotIds.get(attemptId);
  if (!Number.isInteger(snapshotId) || snapshotId <= 0 || seenSnapshotIds.has(snapshotId)) continue;
  seenSnapshotIds.add(snapshotId);
  const knownPlayerIds = parseLearningJson(row.known_player_ids_json, []);
  const companionsByOwner = parseLearningJson(row.companions_by_owner_json, []);
  const rawParticipantCount = Number(row.snapshot_participant_count);
  attempt.snapshots.push({
    id: snapshotId,
    observedAt: row.snapshot_observed_at || null,
    trainingState: String(row.snapshot_training_state || ""),
    participantCount: Number.isFinite(rawParticipantCount) && rawParticipantCount > 0
      ? Math.floor(rawParticipantCount)
      : 0,
    knownPlayerIds: Array.isArray(knownPlayerIds) ? knownPlayerIds : [],
    companionsByOwner: Array.isArray(companionsByOwner) || isPlainObject(companionsByOwner)
      ? companionsByOwner
      : [],
  });
}
const groupLearningAttempts = [...groupLearningAttemptsById.values()]
  .map((attempt) => ({
    ...attempt,
    snapshots: attempt.snapshots.sort((left, right) => (
      String(left.observedAt || "").localeCompare(String(right.observedAt || "")) || left.id - right.id
    )),
  }))
  .sort((left, right) => left.activityDate.localeCompare(right.activityDate) || left.id - right.id);
const groupLearningSignals = buildGroupLearningSignals({
  players,
  sessions,
  attempts: groupLearningAttempts,
  now: snapshotNow,
  halfLifeDays: GROUP_LEARNING_HALF_LIFE_DAYS,
});

const snapshot = {
  generatedAt: snapshotNow.toISOString(),
  source: "Cloudflare D1: Badminton",
  data: {
    players,
    levelDescriptions,
    levelGuideRaw,
    groupJoinNumbers,
    paymentOrders,
    sessions,
    estimator,
    shortTermRules,
    shakeLongTermLists,
    groupAttemptOutcomes,
    groupLearningSignals,
  },
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
console.log(`Generated ${outputPath} with ${players.length} players`);
