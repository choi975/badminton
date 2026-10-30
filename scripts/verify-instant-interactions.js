import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import vm from "node:vm";
import "../member-statistics.js";
import "../optimistic-sync.js";
import "../forecast-client.js";
import { handleShakeMutation, readShakeState } from "../src/shake-mutations.js";
const core = BadmintonMemberStatistics;
class Storage {
  data = new Map();
  get length() { return this.data.size; }
  key(i) { return [...this.data.keys()][i] ?? null; }
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
}
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const worker = readFileSync(new URL("../src/worker.js", import.meta.url), "utf8");
function extract(source, name, indent = "") {
  const a = source.indexOf("function " + name + "("); assert.ok(a >= 0, name);
  return (source.slice(Math.max(0, a - 6), a) === "async " ? "async " : "") + source.slice(a, source.indexOf("\n" + indent + "}", a) + indent.length + 2);
}
const weeklyTypes = JSON.parse(worker.match(/const WEEKLY_SHORT_TERM_RULE_TYPES = new Set\((\[[^\]]*\])\)/)[1]);
assert.deepEqual(weeklyTypes, ["not_days"]);
const backend = vm.createContext({ WEEKLY_SHORT_TERM_RULE_TYPES: new Set(weeklyTypes),
  EXPIRING_SHORT_TERM_RULE_TYPES: new Set(["not_before_days", "not_within_days", "not_before_next_week", "not_before_date"]),
  SESSION_DATE_PATTERN: /^\d{4}-\d{2}-\d{2}$/, Date });
for (const name of ["isValidDateString", "addDaysToDateString", "normalizedWeekdays", "normalizeShortTermRuleInput"]) vm.runInContext(extract(worker, name), backend);
const sql = new DatabaseSync(":memory:");
sql.exec("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE players (id INTEGER PRIMARY KEY);");
sql.exec(readFileSync(new URL("../migrations/0013_short_term_rules.sql", import.meta.url), "utf8"));
sql.exec("ALTER TABLE short_term_rules ADD COLUMN starts_on TEXT;");
sql.exec(readFileSync(new URL("../migrations/0025_shake_mutation_receipts.sql", import.meta.url), "utf8"));
sql.exec("INSERT INTO players VALUES (1), (2), (3), (4), (5), (6);");
let forceDbFailure = false;
const db = {
  prepare(text) { return { text, values: [], bind(...values) { this.values = values; return this; },
    async first() { return sql.prepare(text).get(...this.values) || null; } }; },
  async batch(statements) {
    sql.exec("BEGIN");
    try {
      const results = statements.map((statement, index) => {
        if (forceDbFailure && index === 1) throw Error("forced database fault");
        const prepared = sql.prepare(statement.text);
        if (/^SELECT/i.test(statement.text)) return { results: prepared.all(...statement.values), success: true };
        const r = prepared.run(...statement.values); return { results: [], success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
      });
      sql.exec("COMMIT"); return results;
    } catch (error) { sql.exec("ROLLBACK"); throw error; }
  },
};
const players = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, name: "成员" + (i + 1) }));
const helpers = { json: (data, status = 200) => Response.json(data, { status }),
  normalizeShortTermRuleInput: backend.normalizeShortTermRuleInput,
  findEarlyReturnSession: async () => null, listPlayers: async () => players, listSessions: async () => [],
  readMemberStatisticsCalendar: async () => core.normalizeCalendar(null),
  readBestPartnerSettings: async () => { const raw = sql.prepare("SELECT value FROM app_settings WHERE key='best_partner_overrides'").get()?.value || "";
    return { raw, overrides: core.normalizePartnerOverrides(raw) }; },
};
const call = (body) => handleShakeMutation(new Request("https://example.test/api/shake-mutations", { method: "POST", body: JSON.stringify(body) }), { DB: db }, helpers);
const send = async (body) => { const r = await call(body), data = await r.json(); if (!r.ok) throw Object.assign(Error(data.error), { status: r.status, data }); return data; };
const payload = (playerId = 1) => ({ playerId, type: "not_days", rawText: "周二不打", startsOn: "2026-10-27", expiresOn: null, rule: { weekdays: [2], note: "" } });
const retiredPayload = { ...payload(), type: "only_days", rawText: "只打周二" };
assert.equal(backend.normalizeShortTermRuleInput(retiredPayload), null, "both rule creation APIs share the retired-type rejection");
await assert.rejects(send({ id: randomUUID(), kind: "rule-create", payload: retiredPayload }), (e) => e.status === 400);
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM shake_mutation_receipts").get().n, 0, "rejected old outbox writes must not acquire a receipt");
sql.exec("INSERT INTO short_term_rules (player_id, rule_type, rule_json) VALUES (1, 'only_days', '{}');");
assert.equal((await readShakeState(db)).rules.length, 0, "state API filters legacy rows even before migration");
sql.exec("DELETE FROM short_term_rules;");
const body = { id: randomUUID(), kind: "rule-create", payload: payload() };
const first = await send(body), replay = await send(body);
assert.equal(first.result.ruleId, replay.result.ruleId);
assert.equal(replay.replayed, true);
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM short_term_rules").get().n, 1);
assert.equal(replay.confirmed.revision, 1, "retry must not increment revision");
const raceBody = { id: randomUUID(), kind: "rule-create", payload: payload(2) };
const race = await Promise.all([send(raceBody), send(raceBody)]);
assert.equal(race[0].result.ruleId, race[1].result.ruleId);
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM short_term_rules WHERE player_id=2").get().n, 1);
await assert.rejects(send({ ...body, payload: payload(3) }), (e) => e.status === 409);
const failing = { id: randomUUID(), kind: "rule-create", payload: payload(3) };
forceDbFailure = true;
await assert.rejects(send(failing), /database fault/);
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM shake_mutation_receipts WHERE id=?").get(failing.id).n, 0);
forceDbFailure = false;
await send(failing);
const deletion = { id: randomUUID(), kind: "rule-delete", payload: { createOperationId: failing.id } };
await send(deletion); await send(deletion);
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM short_term_rules WHERE player_id=3").get().n, 0, "delete can resolve a pending create receipt after reload");
const partner = { id: randomUUID(), kind: "partner", payload: { action: "create", playerIds: [1, 2], revision: 0 } };
await send(partner); await send(partner);
const more = { id: randomUUID(), kind: "partner", payload: { action: "create", playerIds: [2, 3], revision: 1 } };
await send(more);
const move = { id: randomUUID(), kind: "partner", payload: { action: "move", playerIds: [1, 2], direction: "up", revision: 2 } };
const moved = await send(move); await send(move);
assert.equal(moved.confirmed.bestPartnerOverrides.revision, 3);
assert.deepEqual((await readShakeState(db)).bestPartnerOverrides.order, ["1:2", "2:3"], "lost response cannot move the row twice");
await assert.rejects(send({ ...move, id: randomUUID() }), (e) => e.status === 409 && e.data.code === "partner_conflict");

// Durable outbox: optimistic state is immediate; an acknowledged write with a lost response is safe to replay after reload.
const storage = new Storage(); let confirmed = await readShakeState(db), online = false, changed = 0, rejected = [];
const config = { storage, randomId: randomUUID, setTimer: () => 0, clearTimer() {}, canSend: () => online,
  prepare: (row) => ({ id: row.id, kind: row.kind, payload: row.payload }), send,
  onCommit: (response) => { confirmed = response.confirmed; }, onChange: () => changed++, onReject: (error, row) => rejected.push(row.id) };
let outbox = new BadmintonOptimisticSync.Outbox(config);
const queued = outbox.enqueue("rule-create", payload(4), "成员4不打");
assert.equal(outbox.list().length, 1);
assert.ok(BadmintonOptimisticSync.projectRules(confirmed.rules, outbox.list()).some((row) => row.playerId === 4));
assert.ok(changed > 0, "optimistic change happens before any network request");
let lostResponse = true;
outbox.send = async (body) => { const data = await send(body); if (lostResponse) { lostResponse = false; throw Error("connection reset after commit"); } return data; };
online = true; await outbox.flush();
assert.equal(outbox.list().length, 1);
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM short_term_rules WHERE player_id=4").get().n, 1);
outbox.destroy();
outbox = new BadmintonOptimisticSync.Outbox(config);
outbox.resume(); await outbox.flush();
assert.equal(outbox.list().length, 0);
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM short_term_rules WHERE player_id=4").get().n, 1);
outbox.enqueueMany([{ kind: "rule-create", payload: payload(999), label: "invalid" }, { kind: "rule-create", payload: payload(5), label: "valid" }]);
await outbox.flush();
assert.equal(rejected.length, 1);
assert.ok(confirmed.rules.some((row) => row.playerId === 5), "rejection rolls back only that operation; later valid work survives");
assert.equal(outbox.list().length, 0);
let writes = 0;
const unavailable = new Storage(); unavailable.setItem = () => { throw Error("quota"); };
const noStorage = new BadmintonOptimisticSync.Outbox({ ...config, storage: unavailable, onChange: () => writes++ });
assert.throws(() => noStorage.enqueue("rule-create", payload(), "x"), /quota/);
assert.equal(writes, 0, "do not show a durable edit when persistence failed");

// Direct overlays: pending create/delete ordering and independent manual rankings.
const pcreate = { id: "a", kind: "rule-create", payload: payload(6), createdAt: new Date().toISOString() };
const pdelete = { id: "b", kind: "rule-delete", payload: { createOperationId: "a" }, createdAt: new Date().toISOString() };
assert.ok(!BadmintonOptimisticSync.projectRules([], [pcreate, pdelete]).length);
const base = core.build({ players, sessions: [] });
const projectedState = { players, memberStatistics: base, shortTermRules: [] };
const overlay = vm.createContext({ state: projectedState, BadmintonOptimisticSync,
  confirmedShake: { rules: [{ id: 99, ...retiredPayload }], bestPartnerOverrides: null },
  pendingShakeOperations: () => [pcreate, { ...pcreate, id: "legacy", payload: retiredPayload }],
  updateShakeSyncStatus() {}, shakeViewSource: null,
});
vm.runInContext(extract(html, "applyPendingShake", "    "), overlay);
overlay.applyPendingShake({ render: false });
assert.deepEqual(projectedState.shortTermRules.map((rule) => rule.type), ["not_days"], "cached and pending retired rules are removed without losing supported optimistic edits");
const pending = [{ id: "p1", kind: "partner", payload: { action: "create", playerIds: [1, 2] }, createdAt: new Date().toISOString() },
 { id: "p2", kind: "partner", payload: { action: "create", playerIds: [2, 3] }, createdAt: new Date().toISOString() },
 { id: "p3", kind: "partner", payload: { action: "move", playerIds: [1, 2], direction: "up" }, createdAt: new Date().toISOString() }];
assert.deepEqual(BadmintonOptimisticSync.projectPartners(base, null, pending, players).bestPartners.pairs.map((p) => p.playerIds), [[1, 2], [2, 3]]);

// Latest-only worker scheduler: stale results never paint, burst requests are coalesced.
const jobs = [], painted = [], errors = [];
let fake;
const client = new BadmintonForecastClient.LatestForecast({ createWorker: () => (fake = { postMessage: (job) => jobs.push(job), terminate() {} }),
  onResult: (value, key) => painted.push(key), onError: (error) => errors.push(error), setTimer: () => 0, clearTimer() {} });
client.request("a", {}); client.request("b", {}); client.request("c", {}); client.request("c", {});
assert.equal(jobs.length, 1);
fake.onmessage({ data: { id: jobs[0].id, key: "a", forecast: {} } });
assert.deepEqual(painted, []); assert.equal(jobs.length, 2); assert.equal(jobs[1].key, "c");
fake.onmessage({ data: { id: jobs[1].id, key: "c", forecast: {} } });
assert.deepEqual(painted, ["c"]);
client.request("c", {}); assert.equal(jobs.length, 2);
client.request("d", {}); fake.onerror({ message: "worker unavailable" }); assert.equal(errors.length, 1);
assert.ok(!html.includes("engine.estimate("));
assert.ok(!html.includes("BadmintonMemberStatistics.build({"), "statistics must not be rebuilt on the UI thread");
assert.ok(html.includes("到场概率根据其与已接龙人员亲密度、近期出勤、人数偏好、星期、体力等综合推算，仅供参考。"));
assert.ok(!html.includes("自动识别看近90天，双方近30天均有本人记录"));
assert.ok(html.includes("new Worker(new URL(\"./forecast-worker.js\", location.href))"));
assert.ok(html.includes("forecastPending || pendingShakeOperations().length"), "do not train on unconfirmed optimistic state or stale probabilities");

// Existing member cells are optimistic too; late failures must not overwrite newer fields.
const cellState = { readOnly: false, players: [{ id: 1, name: "A", gender: "男", level: "2级" }] };
const calls = [];
const cells = vm.createContext({ state: cellState, playerSaveQueues: new Map(), playerPendingEdits: new Map(), playerConfirmedEdits: new Map(),
  getPlayerByKey: () => cellState.players[0], getPlayerById: () => cellState.players[0],
  replacePlayer: (player) => { cellState.players[0] = player; }, renderTable() {}, setSync() {}, toast() {}, applyPaymentOrderState() {}, scheduleGroupForecastRender() {},
  api: (url, options) => new Promise((resolve, reject) => calls.push({ body: JSON.parse(options.body), resolve, reject })),
});
vm.runInContext(extract(html, "saveCell", "    "), cells);
const gender = cells.saveCell("1", "gender", "女"), level = cells.saveCell("1", "level", "4级");
assert.equal(cellState.players[0].gender, "女"); assert.equal(cellState.players[0].level, "4级");
await new Promise(resolve => setImmediate(resolve));
assert.equal(calls.length, 1, "member requests are serialized, not raced");
calls[0].reject(Error("validation failed")); await gender;
await new Promise(resolve => setImmediate(resolve));
assert.equal(cellState.players[0].gender, "男"); assert.equal(cellState.players[0].level, "4级", "earlier rollback preserves later optimistic edit");
assert.equal(calls.length, 2);
calls[1].resolve({ player: { id: 1, name: "A", gender: "男", level: "4级" } }); await level;
assert.equal(cellState.players[0].level, "4级");

sql.close();
console.log("Instant interactions: atomic receipts, replay/races, rollback, durable reload, individual rejection, storage failure, direct optimistic overlays and latest-only background forecasts passed.");
