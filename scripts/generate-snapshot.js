import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const outputPath = resolve("data/bootstrap-snapshot.json");
const query = `
SELECT * FROM players ORDER BY id ASC;
SELECT key, value FROM app_settings ORDER BY key ASC;
SELECT level, description, sort_order FROM level_guides ORDER BY sort_order ASC;
SELECT affiliation, player_id, join_number FROM group_join_numbers ORDER BY affiliation ASC, join_number ASC, player_id ASC;
SELECT id, date, venue, court_count, court_fee, shuttle_price, shuttle_count, court_price_rows, shuttle_price_rows, created_at, updated_at FROM booking_sessions ORDER BY date ASC, id ASC;
SELECT id, session_id, player_id, player_name, slots, plus_count, amount, is_female, gender_snapshot, level_snapshot FROM booking_session_players ORDER BY session_id ASC, id ASC;
`;

const wrangler = resolve("node_modules", "wrangler", "bin", "wrangler.js");
const { stdout } = await execFileAsync(
  process.execPath,
  [wrangler, "d1", "execute", "DB", "--remote", "--json", "--command", query],
  { cwd: resolve("."), maxBuffer: 20 * 1024 * 1024 },
);
const resultSets = JSON.parse(stdout);
if (!Array.isArray(resultSets) || resultSets.length < 6 || resultSets.some((set) => !set.success)) {
  throw new Error("Could not read all snapshot tables from D1");
}

const [playerRows, settingRows, levelRows, joinRows, sessionRows, sessionPlayerRows] = resultSets.map((set) => set.results || []);
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
  if ([11, 11.3, 11.5].some((known) => Math.abs(known - Number(price)) < 0.02)) return "rsl3";
  if (Math.abs(13.5 - Number(price)) < 0.02) return "as05";
  return "unknown";
};
const parsePriceRows = (raw, includeShuttleType = false) => {
  if (!raw) return null;
  const rows = JSON.parse(raw);
  if (!Array.isArray(rows)) return null;
  return rows.map((row) => includeShuttleType
    ? { ...row, type: shuttleTypeForPrice(row.price) }
    : row);
};
const sessionPlayersBySession = new Map();
for (const row of sessionPlayerRows) {
  const sessionId = Number(row.session_id);
  if (!sessionPlayersBySession.has(sessionId)) sessionPlayersBySession.set(sessionId, []);
  sessionPlayersBySession.get(sessionId).push({
    playerId: row.player_id === null ? null : Number(row.player_id),
    playerName: row.player_name || "",
    slots: Number(row.slots),
    plusCount: Number(row.plus_count),
    amount: Number(row.amount),
    isFemale: Number(row.is_female) !== 0,
    gender: row.gender_snapshot || (Number(row.is_female) !== 0 ? "女" : "不详"),
    level: row.level_snapshot || "不详",
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
    players: sessionPlayersBySession.get(id) || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
});

const estimator = JSON.parse(await readFile(resolve("data/booking-estimator.json"), "utf8"));

const snapshot = {
  generatedAt: new Date().toISOString(),
  source: "Cloudflare D1: Badminton",
  data: { players, levelDescriptions, levelGuideRaw, groupJoinNumbers, paymentOrders, sessions, estimator },
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
console.log(`Generated ${outputPath} with ${players.length} players`);
