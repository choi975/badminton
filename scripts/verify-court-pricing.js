import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import "../court-pricing.js";
import { loadPaymentFunctions } from "./payment-test-helpers.js";
const CourtPricing = globalThis.BadmintonCourtPricing;
const STANDARD_COURT_UNIT_PRICE = 70;

const { getCourtUnitPriceForDate } = loadPaymentFunctions(["getCourtUnitPriceForDate"], { STANDARD_COURT_UNIT_PRICE });

assert.equal(getCourtUnitPriceForDate("2026-08-17"), 70, "周一应为每场 70 元");
assert.equal(getCourtUnitPriceForDate("2026-08-18"), 70, "周二应为每场 70 元");
assert.equal(getCourtUnitPriceForDate("2026-08-19"), 70, "周三应为每场 70 元");
assert.equal(getCourtUnitPriceForDate("2026-08-20"), 70, "周四应为每场 70 元");
assert.equal(getCourtUnitPriceForDate("2026-08-21"), 70, "周五应为每场 70 元");
assert.equal(getCourtUnitPriceForDate("2026-08-22"), 70, "周六应为每场 70 元");
assert.equal(getCourtUnitPriceForDate("2026-08-23"), 70, "周日应为每场 70 元");
assert.equal(4 * getCourtUnitPriceForDate("2026-08-21"), 280, "周五 4 个场地应为 280 元");

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
database.prepare("INSERT INTO booking_sessions (date, venue, court_count, court_fee) VALUES (?, 'EDC', ?, ?)")
  .run("2026-09-07", 1.5, 105);
assert.equal(readBalance(), 500, "1.5 courts should deduct 120 from the EDC balance");
assert.equal(database.prepare("SELECT court_count FROM booking_sessions WHERE id = 4").get().court_count, 1.5);
database.close();

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const worker = readFileSync(new URL("../src/worker.js", import.meta.url), "utf8");
const normalizePriceRows = new Function("CourtPricing", `return ${worker.slice(worker.indexOf("function normalizePriceRows("), worker.indexOf("function parseStoredPriceRows("))}`)(CourtPricing);
for (const count of [0.333, 0.666, 1, 1.333, 1.666, 2, 2.333, 2.666, 4 / 3, 5 / 3, 1.667, 0.5, 1.5, 2.5]) {
  assert.deepEqual(normalizePriceRows([{ price: 70, count }], false, false), [{ price: 70, count }]);
}
for (const count of [0, -0.5, 1.25, 1.332, 1.999, Infinity, NaN]) {
  assert.equal(normalizePriceRows([{ price: 70, count }], false, false), null);
}
assert.equal(normalizePriceRows([{ price: 11.3, count: 1.5 }], true, true), null);
assert.equal(normalizePriceRows([{ price: 11.3, count: 1.333 }], true, true), null);
const node = () => ({ children: [], listeners: {}, append(...items) { this.children.push(...items); }, addEventListener(type, handler) { this.listeners[type] = handler; }, setAttribute() {} });
const { createPriceRowElement } = loadPaymentFunctions(["createPriceRowElement"], { document: { createElement: node }, formatCompactNumber: String });
const row = { price: 70, count: 1 };
const element = createPriceRowElement(row, { kind: "court", isLast: true, onlyRow: true });
const countControl = element.children[2];
const [countInput, steps] = countControl.children;
assert.equal(countInput.step, "any");
assert.equal(countInput.inputMode, "decimal");
for (const [count, fee] of [[1.333, 94], [1.666, 117], [2, 140], [2.333, 164]]) {
  steps.children[0].listeners.click();
  assert.equal(row.count, count);
  assert.equal(countInput.value, String(count));
  assert.equal(CourtPricing.rowFee(row), fee);
}
for (const count of [2, 1.666, 1.333, 1, 0.666, 0.333, 0, 0]) {
  steps.children[1].listeners.click();
  assert.equal(row.count, count);
}
countInput.value = "1.666";
countInput.listeners.input();
assert.equal(row.count, 1.666);
assert.equal(CourtPricing.rowFee(row), 117);
countInput.listeners.keydown({ key: "ArrowUp", preventDefault() {} });
assert.equal(row.count, 2);
countInput.listeners.keydown({ key: "ArrowDown", preventDefault() {} });
assert.equal(row.count, 1.666);
countInput.value = "1.667";
countInput.listeners.change();
assert.equal(countInput.value, "1.666");
for (let hours = 1; hours <= 120; hours++) {
  const count = CourtPricing.fromHours(hours);
  const fee = Math.floor(hours / 3) * 70 + [0, 24, 47][hours % 3];
  assert.equal(CourtPricing.toHours(count), hours);
  assert.equal(CourtPricing.rowFee({ price: 70, count }), fee);
  assert.equal(CourtPricing.countForFee(fee), count);
}
assert.equal(CourtPricing.rowFee({ price: 70, count: 1.5 }), 105, "Historical half courts retain their fee");
assert.equal(CourtPricing.rowFee({ price: 80, count: 1.5 }), 120, "Custom prices remain linear");
const twoShortRows = [{ price: 70, count: 0.333 }, { price: 70, count: 0.333 }];
assert.equal(CourtPricing.sumCounts(twoShortRows), 0.666);
assert.equal(twoShortRows.reduce((sum, row) => sum + CourtPricing.rowFee(row), 0), 48, "Two courts for one hour each are NOT one court for two hours");
assert.equal(CourtPricing.sumCounts([...twoShortRows, { price: 70, count: 0.333 }]), 1);
const state = { advancedRows: { court: [{ price: 70, count: 1.333 }], shuttle: [{ price: 11.3, count: 4 }] } };
const api = loadPaymentFunctions(["getAdvancedTotals", "courtPriceBreakdown", "deriveCourtRows", "inferCourtCounts", "inferPreferredCourtCount"], { state });
assert.equal(api.getAdvancedTotals().courtFee, 94);
assert.equal(api.getAdvancedTotals().courtCount, 1.333);
assert.equal(api.getAdvancedTotals().shuttleCost, 45.2);
assert.deepEqual(api.inferCourtCounts(94), [1.333]);
assert.equal(api.inferPreferredCourtCount(117), 1.666);
assert.deepEqual(api.deriveCourtRows(94, 1.333), [{ price: 70, count: 1.333 }]);
assert.deepEqual(api.courtPriceBreakdown({ courtCount: 1.5, courtFee: 105 }), [{ price: 70, count: 1.5 }]);
const normalizeSessionInput = new Function("CourtPricing", "normalizePriceRows", "SESSION_DATE_PATTERN", "normalizeSessionVenue", "BOOKING_ESTIMATOR_DATA", `return ${worker.slice(worker.indexOf("function normalizeSessionInput("), worker.indexOf("function normalizePriceRows("))}`)(CourtPricing, normalizePriceRows, /^\d{4}-\d{2}-\d{2}$/, (venue) => venue, { shuttleTypes: [] });
const baseSession = { date: "2026-10-10", venue: "广羽", players: [], shuttlePrice: 0, shuttleCount: 0, shuttlePriceRows: [] };
for (const [count, fee] of [[0.333, 24], [0.666, 47], [1, 70], [1.333, 94], [1.666, 117], [2, 140], [1.5, 105]]) {
  const saved = normalizeSessionInput({ ...baseSession, courtPriceRows: [{ price: 70, count }] });
  assert.ok(saved);
  assert.equal(saved.courtFee, fee);
  assert.equal(saved.courtCount, count);
  assert.deepEqual(saved.courtPriceRows, [{ price: 70, count }]);
  assert.equal(normalizeSessionInput(saved).courtFee, fee, "Save/load/edit round trip preserves the fee");
  assert.ok(normalizeSessionInput({ ...baseSession, courtCount: count, courtFee: fee }));
}
assert.equal(normalizeSessionInput({ ...baseSession, courtPriceRows: twoShortRows }).courtFee, 48);
assert.equal(normalizeSessionInput({ ...baseSession, courtCount: 1.25, courtFee: 70 }), null);
assert.equal(normalizeSessionInput({ ...baseSession, courtPriceRows: [{ price: 70, count: 1.332 }] }), null);
assert.equal(readFileSync(new URL("../public/court-pricing.js", import.meta.url), "utf8"), readFileSync(new URL("../court-pricing.js", import.meta.url), "utf8"));
assert.equal(readFileSync(new URL("../src/court-pricing.txt", import.meta.url), "utf8"), readFileSync(new URL("../court-pricing.js", import.meta.url), "utf8"));
assert.match(worker, /VALID_SESSION_VENUES = new Set\(\["文体", "EDC", "广羽"\]\)/);
assert.match(html, /const venues = \["EDC", "文体", "广羽"\]/);
assert.match(html, /els\.recordModal\.dataset\.venue = editing \? session\.venue : "广羽"/);
assert.match(html, /venue: editing \? \(els\.recordModal\.dataset\.venue \|\| "文体"\) : "广羽"/);
assert.doesNotMatch(html, /FRIDAY_SATURDAY_COURT_UNIT_PRICE|paymentWeekendNotice|周五周六场地80元/);
assert.match(worker, /normalizeSessionInput\(await readJson\(request\), "广羽", shuttleTypes\)/);
assert.doesNotMatch(html, /id="edcBalanceInput"|id="edcHistoryBtn"|id="edcHistoryPanel"/);
assert.match(worker, /pathname === "\/api\/edc-balance" && method === "PUT"/);
assert.match(worker, /edcCharge: input\.venue === "EDC" \? input\.courtCount \* 80 : 0/);
assert.match(worker, /statements\.push\(\.\.\.buildSessionPlayerStatements\(db, null, input\.players, true\)\)[\s\S]*await db\.batch\(statements\)/);

console.log("Court-pricing and EDC-balance verification passed.");
