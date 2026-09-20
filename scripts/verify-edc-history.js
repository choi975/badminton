import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const worker = read("../src/worker.js");
const html = read("../index.html");
const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE booking_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT,
    venue TEXT, court_count REAL, court_fee REAL);`);
db.exec(read("../migrations/0022_edc_balance.sql"));
db.exec("UPDATE app_settings SET value = '140' WHERE key = 'edc_balance'");
db.exec(read("../migrations/0023_edc_balance_history.sql"));
const balance = () => Number(db.prepare("SELECT value FROM app_settings WHERE key = 'edc_balance'").get().value);
const rows = () => db.prepare("SELECT * FROM edc_balance_history ORDER BY id").all();
assert.equal(balance(), 140, "Upgrade must preserve the current balance");
assert.equal(rows()[0].type, "opening");
assert.equal(rows()[0].balance_after, 140);
db.exec("INSERT INTO booking_sessions VALUES (1, '2026-09-14', 'EDC', 1.5, 105)");
assert.equal(balance(), 20);
assert.equal(rows()[1].amount, -120);
assert.equal(rows()[1].balance_before, 140);
assert.equal(rows()[1].balance_after, 20);
assert.equal(rows()[1].session_id, 1);
db.exec(`UPDATE booking_sessions SET court_count = 2 WHERE id = 1;
  DELETE FROM booking_sessions WHERE id = 1;
  INSERT INTO booking_sessions VALUES (2, '2026-09-15', '文体', 1, 70)`);
assert.equal(balance(), 20);
assert.equal(rows().length, 2, "Edits, deletes and other venues must not charge again or erase history");

const adapter = {
  prepare(sql) {
    let params = [];
    return {
      bind(...values) { params = values; return this; },
      run() { return db.prepare(sql).run(...params); },
      all() { return { results: db.prepare(sql).all(...params) }; },
    };
  },
  async batch(statements) {
    db.exec("BEGIN");
    try {
      const results = statements.map((statement) => statement.run());
      db.exec("COMMIT");
      return results;
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  },
};
const save = new Function("DEFAULT_EDC_BALANCE", `return ${worker.slice(worker.indexOf("async function saveEdcBalance("), worker.indexOf("async function saveLevelGuide("))}`)(860);
await save(adapter, 1000.25);
assert.equal(balance(), 1000.25);
assert.equal(rows()[2].amount, 980.25);
await save(adapter, 1000.25);
assert.equal(rows().length, 3, "Saving the same amount must not add a record");
await save(adapter, -10.5);
assert.equal(rows()[3].amount, -1010.75);
assert.equal(rows()[3].balance_after, -10.5);
for (let i = 0; i < 35; i += 1) await save(adapter, i);
const start = worker.indexOf('  if (pathname === "/api/edc-balance/history"');
const end = worker.indexOf('  if (pathname === "/api/edc-balance"', start);
const get = new Function("json", `return async function(env, url) {
  const pathname = url.pathname, method = 'GET'; ${worker.slice(start, end)}
}`)((body, status = 200) => ({ body, status }));
const first = await get({ DB: adapter }, new URL("https://example.com/api/edc-balance/history"));
assert.equal(first.body.records.length, 30);
const second = await get({ DB: adapter }, new URL(`https://example.com/api/edc-balance/history?before=${first.body.nextCursor}`));
assert.equal(second.body.nextCursor, null);
assert.equal(new Set([...first.body.records, ...second.body.records].map((row) => row.id)).size, rows().length);
for (const value of ["", "0", "-1", "1.5", "abc", "9007199254740992"]) {
  assert.equal((await get({ DB: adapter }, new URL(`https://example.com/api/edc-balance/history?before=${value}`))).status, 400);
}
assert.doesNotMatch(html, /id="edcBalanceInput"|id="edcHistoryBtn"|id="edcHistoryPanel"/);
assert.match(html, /timeZone: "Asia\/Shanghai"/);
db.close();
console.log("EDC ledger upgrade, charging, adjustments and pagination verification passed.");
