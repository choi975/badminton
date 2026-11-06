import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { normalizeShuttleDefaultPrice, normalizeShuttleTypeRow, editRegisteredShuttleType } from "../src/shuttle-types.js";
import { trainEstimatorModel } from "../src/estimator-core.js";

for (const price of [null, undefined, "", "abc", -1, 0, Infinity, 1001, 11.333]) assert.equal(normalizeShuttleDefaultPrice(price), null);
assert.equal(normalizeShuttleDefaultPrice("12.80"), 12.8);
assert.equal(normalizeShuttleDefaultPrice(1000), 1000);
const sql = new DatabaseSync(":memory:");
for (const name of readdirSync(new URL("../migrations/", import.meta.url)).filter(name => name.endsWith(".sql")).sort()) sql.exec(readFileSync(new URL("../migrations/" + name, import.meta.url), "utf8"));
const wrap = { prepare(query) { let values = []; return {
  bind(...args) { values = args; return this; },
  async first() { return sql.prepare(query).get(...values) || null; },
  async all() { return { results: sql.prepare(query).all(...values) }; },
  async run() { const result = sql.prepare(query).run(...values); return { meta: { changes: Number(result.changes) } }; },
}; } };
const types = () => sql.prepare("SELECT * FROM shuttle_types ORDER BY id").all().map(normalizeShuttleTypeRow);
const get = id => types().find(type => type.id === id);
assert.equal(get("rsl3").defaultPrice, 11.3);
assert.equal(get("as05").defaultPrice, 13.5);
const aliases = sql.prepare("SELECT id, prices_json FROM shuttle_types ORDER BY id").all();
sql.exec(`INSERT INTO booking_sessions (date, court_count, court_fee, shuttle_price, shuttle_count, shuttle_price_rows) VALUES ('2026-11-05', 1, 70, 13.5, 1, '[{"type":"as05","price":13.5,"count":1}]')`);
const ledger = sql.prepare("SELECT * FROM booking_sessions").all();
const request = (id, price, extra = {}) => ({ name: get(id).name, defaultPrice: price, expectedName: get(id).name, expectedDefaultPrice: get(id).defaultPrice, ...extra });
assert.equal((await editRegisteredShuttleType(wrap, "missing", { name: "不存在", defaultPrice: 10, expectedName: "不存在", expectedDefaultPrice: 10 })).status, 404);
assert.equal((await editRegisteredShuttleType(wrap, "rsl3", request("rsl3", 0))).status, 400);
assert.equal((await editRegisteredShuttleType(wrap, "rsl3", request("rsl3", 12.345))).status, 400);
assert.equal((await editRegisteredShuttleType(wrap, "rsl3", request("rsl3", 12.5, { name: "as05" }))).status, 409);
const firstBody = request("rsl3", 13.5);
assert.equal((await editRegisteredShuttleType(wrap, "rsl3", firstBody)).status, 200);
assert.equal(get("rsl3").defaultPrice, 13.5);
const revision = sql.prepare("SELECT revision FROM booking_estimator_training_state WHERE id='current'").get().revision;
assert.equal((await editRegisteredShuttleType(wrap, "rsl3", firstBody)).unchanged, true, "lost-response retries of the same desired value are idempotent");
assert.equal(sql.prepare("SELECT revision FROM booking_estimator_training_state WHERE id='current'").get().revision, revision);
const stale = await editRegisteredShuttleType(wrap, "rsl3", { ...firstBody, defaultPrice: 16 });
assert.equal(stale.status, 409);
assert.equal(stale.type.defaultPrice, 13.5);
const raceBody = request("as05", 14);
const races = await Promise.all([editRegisteredShuttleType(wrap, "as05", raceBody), editRegisteredShuttleType(wrap, "as05", { ...raceBody, defaultPrice: 15 })]);
assert.deepEqual(races.map(result => result.status).sort(), [200, 409]);
const oldFullName = get("rsl3").fullName;
assert.equal((await editRegisteredShuttleType(wrap, "rsl3", request("rsl3", 13.5, { name: "亚3市场价" }))).status, 200);
assert.equal(get("rsl3").name, "亚3市场价");
assert.equal(get("rsl3").fullName, oldFullName);
assert.deepEqual(sql.prepare("SELECT id, prices_json FROM shuttle_types ORDER BY id").all(), aliases, "history aliases are never overwritten by market-price edits");
assert.deepEqual(sql.prepare("SELECT * FROM booking_sessions").all(), ledger, "no saved price, count or amount is changed");

// Execute the actual PATCH dispatch, including read-only protection and partial-training success.
const worker = readFileSync(new URL("../src/worker.js", import.meta.url), "utf8");
const start = worker.indexOf("  const shuttleTypeEditMatch ="), end = worker.indexOf('  if (pathname === "/api/estimator/shuttle-types" && method === "POST")', start);
assert.ok(start >= 0 && end > start);
const route = worker.slice(start, end);
let trainingFails = false;
const dispatch = new Function("db", "editRegisteredShuttleType", "json", "isAdminRequest", "readJson", "retrainEstimator", "getCurrentEstimator", "listShuttleTypes", "getEstimatorTrainingRevision", `return async request => { const env = { DB: db }, pathname = new URL(request.url).pathname, method = request.method; ${route} return json({},405); };`)(
  wrap, editRegisteredShuttleType, (body, status = 200) => ({ body, status }), req => req.headers.get("origin") === "https://badminton.choi975.workers.dev", req => req.json(),
  async () => { if (trainingFails) throw Error("training unavailable"); return { shuttleTypes: types() }; }, async () => ({ shuttleTypes: types() }), async () => types(), async () => sql.prepare("SELECT revision FROM booking_estimator_training_state WHERE id='current'").get().revision,
);
const patch = (body, origin = "https://badminton.choi975.workers.dev") => new Request("https://badminton.choi975.workers.dev/api/estimator/shuttle-types/rsl3", { method: "PATCH", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
assert.equal((await dispatch(patch(request("rsl3", 16), "https://choi975.github.io"))).status, 403);
assert.equal(get("rsl3").defaultPrice, 13.5);
trainingFails = true;
const partial = await dispatch(patch(request("rsl3", 16)));
assert.equal(partial.status, 200);
assert.equal(partial.body.estimatorPending, true);
assert.equal(partial.body.type.defaultPrice, 16);
assert.equal(partial.body.shuttleTypes.find(type => type.id === "rsl3").defaultPrice, 16);
assert.ok(partial.body.trainingRevision > revision);

// Market defaults, even when they overlap another type's old price, cannot relabel legacy history.
const matcherStart = worker.indexOf("function shuttleTypeForPrice("), matcherEnd = worker.indexOf("\n}", matcherStart) + 2;
const matcher = new Function("BOOKING_ESTIMATOR_DATA", `return ${worker.slice(matcherStart, matcherEnd)};`)({ shuttleTypes: [] });
assert.equal(matcher(13.5, types()).id, "as05");
const sessions = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, date: `2026-10-${String(i+1).padStart(2,"0")}`, participantCount: 4, participants: Array.from({ length: 4 }, (_, j) => ({ playerId: j+1, gender: "男", level: "3级" })), courtCount: 1, shuttleCounts: { rsl3: 4 } }));
const beforeTypes = types().map(type => ({ ...type, defaultPrice: 11.3 }));
const before = trainEstimatorModel({ sessions, shuttleTypes: beforeTypes, generatedAt: "2026-11-06T00:00:00Z" });
const after = trainEstimatorModel({ sessions, shuttleTypes: types(), generatedAt: "2026-11-06T00:00:00Z" });
assert.deepEqual(before.shuttle, after.shuttle, "market defaults do not alter learned shuttle-consumption formulas");
assert.deepEqual(before.court, after.court);
assert.equal(after.shuttleTypes.find(type => type.id === "rsl3").defaultPrice, 16);
sql.close();
console.log("Shuttle edits passed: real migrations/SQLite, validation, naming, default persistence, stale writes, idempotent retry, concurrent edits, read-only PATCH, training-pending success, unchanged ledgers/aliases and prediction invariance. No production data changed.");
