import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import {
  expandEstimatorParticipants,
  trainEstimatorModel,
} from "../src/estimator-core.js";

const execFileAsync = promisify(execFile);
const outputPath = resolve("data/booking-estimator.json");
const wrangler = resolve("node_modules", "wrangler", "bin", "wrangler.js");
const query = `
SELECT id, date, court_count, train_court, train_shuttle, actual_shuttle_confirmed, shuttle_price_rows, shuttle_price, shuttle_count FROM booking_sessions ORDER BY date ASC, id ASC;
SELECT session_id, player_id, is_companion, slots, plus_count, gender_snapshot, level_snapshot, profile_snapshot_reliable
FROM booking_session_players ORDER BY session_id ASC, id ASC;
SELECT id, name, full_name, prices_json, enabled FROM shuttle_types WHERE enabled = 1 ORDER BY CASE WHEN id = 'rsl3' THEN 0 ELSE 1 END, created_at ASC, id ASC;
SELECT revision FROM booking_estimator_training_state WHERE id = 'current';
`;

const { stdout } = await execFileAsync(
  process.execPath,
  [wrangler, "d1", "execute", "DB", "--remote", "--json", "--command", query],
  { cwd: resolve("."), maxBuffer: 20 * 1024 * 1024 },
);
const resultSets = JSON.parse(stdout);
if (!Array.isArray(resultSets) || resultSets.length < 4 || resultSets.some((set) => !set.success)) {
  throw new Error("Could not read estimator training data from D1");
}

const [sessionRows, playerRows, shuttleRows, revisionRows] = resultSets.map((set) => set.results || []);
const playersBySession = new Map();
for (const row of playerRows) {
  const list = playersBySession.get(Number(row.session_id)) || [];
  list.push(row);
  playersBySession.set(Number(row.session_id), list);
}

const shuttleTypes = shuttleRows.map((row) => ({
  id: String(row.id),
  name: String(row.name),
  fullName: String(row.full_name || row.name),
  prices: JSON.parse(row.prices_json || "[]").map(Number),
}));
const shuttleTypesById = new Map(shuttleTypes.map((type) => [type.id, type]));

function parseRows(raw) {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function typeForPrice(price) {
  const matches = shuttleTypes.filter((type) => type.prices.some((known) => Math.abs(Number(known) - Number(price)) < 0.02));
  return matches.length === 1 ? matches[0] : null;
}

const sessions = sessionRows.map((row) => {
  const shuttleCounts = {};
  let rows = parseRows(row.shuttle_price_rows);
  if (!rows.length && Number(row.shuttle_count) > 0) rows = [{ price: row.shuttle_price, count: row.shuttle_count }];
  for (const shuttle of rows) {
    const type = shuttleTypesById.get(shuttle.type) || typeForPrice(shuttle.price);
    const typeId = type?.id || "unknown";
    shuttleCounts[typeId] = (shuttleCounts[typeId] || 0) + Number(shuttle.count || 0);
  }
  const playerRows = playersBySession.get(Number(row.id)) || [];
  const participants = expandEstimatorParticipants(playerRows);
  return {
    id: Number(row.id),
    date: String(row.date || ""),
    participants,
    participantCount: participants.length,
    courtCount: Number(row.court_count),
    trainCourt: Number(row.train_court) !== 0,
    trainShuttle: Number(row.train_shuttle) !== 0,
    actualShuttleConfirmed: Number(row.actual_shuttle_confirmed) !== 0,
    shuttleCounts,
  };
});

const trainingRevision = Math.max(0, Number(revisionRows[0]?.revision) || 0);
const model = trainEstimatorModel({ sessions, shuttleTypes, trainingRevision });
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(model, null, 2)}\n`, "utf8");
console.log(`Trained ${outputPath}: court=${model.training.court.sampleCount} sessions, shuttle=${model.training.shuttle.sampleCount} sessions`);
