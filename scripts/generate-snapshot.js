import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const outputPath = resolve("data/bootstrap-snapshot.json");
const query = `
SELECT * FROM players ORDER BY id ASC;
SELECT key, value FROM app_settings ORDER BY key ASC;
SELECT level, description, sort_order FROM level_guides ORDER BY sort_order ASC;
SELECT affiliation, player_id, join_number FROM group_join_numbers ORDER BY affiliation ASC, join_number ASC, player_id ASC;
`;

const wrangler = resolve("node_modules", "wrangler", "bin", "wrangler.js");
const { stdout } = await execFileAsync(
  process.execPath,
  [wrangler, "d1", "execute", "DB", "--remote", "--json", "--command", query],
  { cwd: resolve("."), maxBuffer: 20 * 1024 * 1024 },
);
const resultSets = JSON.parse(stdout);
if (!Array.isArray(resultSets) || resultSets.length < 4 || resultSets.some((set) => !set.success)) {
  throw new Error("Could not read all snapshot tables from D1");
}

const [playerRows, settingRows, levelRows, joinRows] = resultSets.map((set) => set.results || []);
const players = playerRows.map((row) => ({
  id: Number(row.id),
  name: row.name || "",
  gender: row.gender || "男",
  level: row.level || "不详",
  bookingTime: row.booking_time || "19:00~22:00",
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

const snapshot = {
  generatedAt: new Date().toISOString(),
  source: "Cloudflare D1: Badminton-level",
  data: { players, levelDescriptions, levelGuideRaw, groupJoinNumbers, paymentOrders },
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
console.log(`Generated ${outputPath} with ${players.length} players`);
