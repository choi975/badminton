import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const STANDARD_COURT_UNIT_PRICE = 70;
const FRIDAY_SATURDAY_COURT_UNIT_PRICE = 80;

function parseLocalDate(value) {
  const parts = String(value || "").split("-").map(Number);
  return new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1);
}

function getCourtUnitPriceForDate(dateString) {
  const weekday = parseLocalDate(dateString).getDay();
  return weekday === 5 || weekday === 6
    ? FRIDAY_SATURDAY_COURT_UNIT_PRICE
    : STANDARD_COURT_UNIT_PRICE;
}

assert.equal(getCourtUnitPriceForDate("2026-08-17"), 70, "周一应为每场 70 元");
assert.equal(getCourtUnitPriceForDate("2026-08-18"), 70, "周二应为每场 70 元");
assert.equal(getCourtUnitPriceForDate("2026-08-19"), 70, "周三应为每场 70 元");
assert.equal(getCourtUnitPriceForDate("2026-08-20"), 70, "周四应为每场 70 元");
assert.equal(getCourtUnitPriceForDate("2026-08-21"), 80, "周五应为每场 80 元");
assert.equal(getCourtUnitPriceForDate("2026-08-22"), 80, "周六应为每场 80 元");
assert.equal(getCourtUnitPriceForDate("2026-08-23"), 70, "周日应为每场 70 元");
assert.equal(4 * getCourtUnitPriceForDate("2026-08-21"), 320, "周五 4 个场地应为 320 元");

const balanceMigration = readFileSync(new URL("../migrations/0022_edc_balance.sql", import.meta.url), "utf8");
const database = new DatabaseSync(":memory:");
database.exec(`
  CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '');
  CREATE TABLE booking_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    venue TEXT NOT NULL DEFAULT 'EDC',
    court_count INTEGER NOT NULL DEFAULT 1,
    court_fee REAL NOT NULL DEFAULT 0
  );
`);
database.exec(balanceMigration);

const readBalance = () => Number(database.prepare("SELECT value FROM app_settings WHERE key = 'edc_balance'").get().value);
assert.equal(readBalance(), 860, "EDC余额初始值应为860元");
database.prepare("INSERT INTO booking_sessions (date, venue, court_count, court_fee) VALUES (?, 'EDC', ?, ?)")
  .run("2026-09-07", 1, 70);
assert.equal(readBalance(), 780, "周一场地费显示70元时，EDC余额仍应按每场80元扣减");
database.prepare("INSERT INTO booking_sessions (date, venue, court_count, court_fee) VALUES (?, 'EDC', ?, ?)")
  .run("2026-09-11", 2, 160);
assert.equal(readBalance(), 620, "两个EDC场地应扣减160元");
database.prepare("UPDATE booking_sessions SET court_fee = 140 WHERE id = 2").run();
assert.equal(readBalance(), 620, "编辑已有记录不应重复扣减EDC余额");
database.prepare("INSERT INTO booking_sessions (date, venue, court_count, court_fee) VALUES (?, '文体', ?, ?)")
  .run("2026-09-12", 1, 80);
assert.equal(readBalance(), 620, "非EDC订场不应自动扣减EDC余额");
database.close();

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const worker = readFileSync(new URL("../src/worker.js", import.meta.url), "utf8");
assert.match(html, /id="edcBalanceInput"[^>]*type="number"[^>]*value="860"/);
assert.match(html, /api\("\/api\/edc-balance"[\s\S]*method: "PUT"/);
assert.match(worker, /pathname === "\/api\/edc-balance" && method === "PUT"/);
assert.match(worker, /edcCharge: input\.venue === "EDC" \? input\.courtCount \* 80 : 0/);
assert.match(worker, /statements\.push\(\.\.\.buildSessionPlayerStatements\(db, null, input\.players, true\)\)[\s\S]*await db\.batch\(statements\)/);

console.log("Court-pricing and EDC-balance verification passed.");
