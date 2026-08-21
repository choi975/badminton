import assert from "node:assert/strict";

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

console.log("Court-pricing verification passed.");
