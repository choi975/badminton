import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { handleRosterReview } from "../src/roster-review-api.js";

class D1 {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    this.sqlite.exec(`CREATE TABLE players (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, gender TEXT NOT NULL DEFAULT '男',
      level TEXT NOT NULL DEFAULT '不详', affiliation TEXT NOT NULL DEFAULT '球友', notes TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE group_join_numbers (affiliation TEXT NOT NULL, player_id INTEGER NOT NULL, join_number INTEGER NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (affiliation, player_id));`);
    this.sqlite.exec(readFileSync(new URL("../migrations/0028_roster_review_commits.sql", import.meta.url), "utf8"));
    this.sqlite.exec("INSERT INTO players (name, level) VALUES ('oi', '3.5级'), ('choi', '2.5级'), ('羊', '不详'); INSERT INTO group_join_numbers (affiliation, player_id, join_number) VALUES ('球友', 1, 1);");
    this.beforeBatch = null;
    this.failName = "";
  }
  prepare(sql) {
    const db = this;
    return { sql, values: [], bind(...values) { this.values = values; return this; },
      async first() { return db.sqlite.prepare(sql).get(...this.values) || null; },
      async all() { return { results: db.sqlite.prepare(sql).all(...this.values) }; },
      async run() {
        if (sql.startsWith("INSERT INTO players") && this.values[0] === db.failName) throw new Error("Injected database failure");
        const result = db.sqlite.prepare(sql).run(...this.values);
        return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
      } };
  }
  async batch(statements) {
    this.beforeBatch?.(); this.beforeBatch = null;
    this.sqlite.exec("BEGIN");
    try { const results = []; for (const statement of statements) results.push(await statement.run()); this.sqlite.exec("COMMIT"); return results; }
    catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
  close() { this.sqlite.close(); }
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const listPlayers = async db => (await db.prepare("SELECT * FROM players ORDER BY id").all()).results.map(row => ({ ...row, updatedAt: row.updated_at }));
const getPaymentOrderState = async db => ({ groupJoinNumbers: { 球友: (await db.prepare("SELECT player_id AS playerId, join_number AS joinNumber FROM group_join_numbers ORDER BY join_number").all()).results, Hytronik: [] } });
const deps = { json, listPlayers, getPaymentOrderState, isAdminRequest: req => req.headers.get("origin") === "https://badminton.choi975.workers.dev" };
const db = new D1(), env = { DB: db };
const body = (updates = [], creates = []) => ({ requestId: randomUUID(), updates, creates });
const expected = async id => { const p = (await listPlayers(db)).find(p => p.id === id); return { name: p.name, level: p.level, updatedAt: p.updatedAt }; };
async function post(payload, origin = "https://badminton.choi975.workers.dev") {
  const response = await handleRosterReview(new Request("https://badminton.choi975.workers.dev/api/roster-review", { method: "POST", headers: { origin }, body: JSON.stringify(payload) }), env, deps);
  return { status: response.status, ...(await response.json()) };
}
db.sqlite.exec("UPDATE players SET notes = '已有成员备注' WHERE id = 2");
const initial = await listPlayers(db);
const rawNotes = "  喜欢双打 🌸\n周末参加 <只记文字> & \"备注\"  ";
const commit = body([{ playerId: 2, expected: await expected(2), aliases: ["joker唐"], level: "3级" }, { playerId: 3, expected: await expected(3), level: "2.5级" }],
  [{ key: "friend", name: "新球友", aliases: ["新的报名名"], gender: "女", level: "2.5级", affiliation: "球友", notes: rawNotes },
    { key: "special", name: "新特殊", gender: "男", level: "3.5级", affiliation: "特殊", notes: " \n " },
    { key: "friend2", name: "另一个球友", gender: "男", level: "5.5级", affiliation: "球友" }]);
let result = await post(commit);
assert.equal(result.status, 200, JSON.stringify(result));
assert.equal(result.players.find(p => p.id === 2).name, "choi，joker唐");
assert.equal(result.players.find(p => p.id === 2).level, "3级");
assert.equal(result.players.find(p => p.id === 3).level, "2.5级");
assert.equal(result.players.find(p => p.id === 2).notes, "已有成员备注", "Level and alias updates must not overwrite existing notes");
assert.equal(result.createdPlayers.length, 3);
for (const created of result.createdPlayers) {
  const player = result.players.find(p => p.id === created.playerId);
  assert.ok(player, "Receipt must retain each created player's actual id");
  assert.equal(player.affiliation, created.key === "special" ? "特殊" : "球友");
  assert.equal(player.notes, created.key === "friend" ? rawNotes.trim() : "", "D1 stores multiline notes or optional blank defaults per member");
}
const joinRows = (await getPaymentOrderState(db)).groupJoinNumbers.球友;
assert.deepEqual(joinRows.map(row => row.joinNumber), [1, 2, 3]);
assert.equal(joinRows[1].playerId, result.createdPlayers.find(p => p.key === "friend").playerId);
assert.equal(joinRows[2].playerId, result.createdPlayers.find(p => p.key === "friend2").playerId, "Receipt writes never confuse last_insert_rowid with join numbers");
assert.equal(result.players.find(p => p.name.startsWith("新球友")).name, "新球友，新的报名名");
const retried = await post(commit);
assert.equal(retried.status, 200, "Retrying the same request is idempotent");
assert.equal(retried.players.find(p => p.name.startsWith("新球友")).notes, rawNotes.trim(), "An idempotent retry returns the saved note");
assert.equal((await post({ ...commit, creates: commit.creates.map(create => ({ ...create, notes: "修改后的备注" })) })).status, 409, "The same request id cannot be reused for different notes");
assert.equal((await listPlayers(db)).length, initial.length + 3);
assert.equal((await post({ ...commit, creates: [] })).status, 409, "One request id cannot be reused for different edits");
const beforeFailure = await listPlayers(db);
db.failName = "故障新成员";
const failed = body([{ playerId: 2, expected: await expected(2), level: "4级" }], [{ key: "fail", name: db.failName, gender: "男", level: "2级", affiliation: "球友", notes: "失败重试保留的备注" }]);
result = await post(failed);
assert.equal(result.status, 500);
assert.deepEqual(await listPlayers(db), beforeFailure, "Failed create rolls back earlier grade updates as well");
assert.equal(await db.prepare("SELECT * FROM roster_review_commits WHERE request_id = ?").bind(failed.requestId).first(), null);
db.failName = "";
const recovered = await post(failed);
assert.equal(recovered.status, 200, "A failed transaction remains safely retryable");
assert.equal(recovered.players.find(p => p.name === "故障新成员").notes, "失败重试保留的备注");
const beforeInvalid = await listPlayers(db);
for (const notes of [null, 42, true, [], {}]) {
  const invalid = body([], [{ key: "badnotes", name: "无效备注", gender: "男", level: "2级", affiliation: "球友", notes }]);
  const rejected = await post(invalid);
  assert.equal(rejected.status, 400, "Non-text notes must be rejected before writing any member");
  assert.match(rejected.error, /备注需填写文字/);
  assert.equal(await db.prepare("SELECT * FROM roster_review_commits WHERE request_id = ?").bind(invalid.requestId).first(), null);
}
for (const create of [{ key: "duplicate", name: "ＣＨＯＩ", gender: "男", level: "2级", affiliation: "球友" },
  { key: "badlevel", name: "等级未标准化", gender: "男", level: "2.8级", affiliation: "球友" },
  { key: "badgroup", name: "非法分组", gender: "男", level: "2级", affiliation: "Hytronik" }]) assert.equal((await post(body([], [create]))).status, 400);
assert.equal((await post(body([{ playerId: 1, expected: await expected(1), aliases: ["joker唐"] }]))).status, 400, "An alias cannot be taken from another member");
assert.equal((await post(body([{ playerId: 2, expected: { name: "choi", level: "2.5级" }, level: "4级" }]))).status, 409);
assert.deepEqual(await listPlayers(db), beforeInvalid, "Validation failures do not partially save any rows");
const concurrencyRequest = body([{ playerId: 3, expected: await expected(3), level: "3级" }], [{ key: "race", name: "竞争插入", gender: "男", level: "2级", affiliation: "球友" }]);
db.beforeBatch = () => db.sqlite.exec("UPDATE players SET level = '4级' WHERE id = 1");
result = await post(concurrencyRequest);
assert.equal(result.status, 409);
assert.equal((await listPlayers(db)).find(p => p.id === 3).level, "2.5级");
assert.equal((await listPlayers(db)).find(p => p.id === 1).level, "4级", "Another editor's change is retained, not rolled back or overwritten");
assert.ok(!(await listPlayers(db)).some(p => p.name === "竞争插入"));
assert.equal(await db.prepare("SELECT * FROM roster_review_commits WHERE request_id = ?").bind(concurrencyRequest.requestId).first(), null);
assert.equal((await post(body(), "https://choi975.github.io")).status, 403);
assert.equal((await post(body(), "https://unknown.example")).status, 403);
const badJson = await handleRosterReview(new Request("https://badminton.choi975.workers.dev/api/roster-review", { method: "POST", headers: { origin: "https://badminton.choi975.workers.dev" }, body: "{" }), env, deps);
assert.equal(badJson.status, 400);
const get = await handleRosterReview(new Request("https://badminton.choi975.workers.dev/api/roster-review"), env, deps);
assert.equal(get.status, 405);
db.close();
console.log("Roster review API: atomic levels/aliases/member creation and optional multiline notes, join numbers, durable idempotency, rollback/retry, stale profiles, concurrent name changes, normalized alias collisions, standard levels and admin-only writes passed.");
