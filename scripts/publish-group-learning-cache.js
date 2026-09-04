import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { GROUP_LEARNING_VERSION } from "../src/group-learning-core.js";

const execFileAsync = promisify(execFile);
const snapshot = JSON.parse(await readFile(resolve("data/bootstrap-snapshot.json"), "utf8"));
const model = snapshot?.data?.groupLearningSignals;
if (!model || model.version !== GROUP_LEARNING_VERSION) {
  throw new Error("Bootstrap snapshot does not contain a valid group-learning model");
}

const escapeSql = (value) => String(value).replaceAll("'", "''");
const modelJson = JSON.stringify(model);
const generatedAt = String(model.generatedAt || snapshot.generatedAt || new Date().toISOString());
const sql = `INSERT INTO group_learning_model_cache (id, model_json, generated_at, updated_at)
VALUES ('current', '${escapeSql(modelJson)}', '${escapeSql(generatedAt)}', CURRENT_TIMESTAMP)
ON CONFLICT(id) DO UPDATE SET
  model_json = excluded.model_json,
  generated_at = excluded.generated_at,
  updated_at = CURRENT_TIMESTAMP;
`;

const tempDirectory = await mkdtemp(join(tmpdir(), "badminton-group-learning-"));
const sqlPath = join(tempDirectory, "publish.sql");
try {
  await writeFile(sqlPath, sql, "utf8");
  const wrangler = resolve("node_modules", "wrangler", "bin", "wrangler.js");
  const { stdout } = await execFileAsync(
    process.execPath,
    [wrangler, "d1", "execute", "DB", "--remote", "--file", sqlPath],
    { cwd: resolve("."), maxBuffer: 10 * 1024 * 1024 },
  );
  process.stdout.write(stdout);
  console.log(`Published ${model.version} to D1 group-learning cache`);
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}
