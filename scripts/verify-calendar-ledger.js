import assert from "node:assert/strict";
import { loadPaymentFunctions, paymentHtml } from "./payment-test-helpers.js";

function node() {
  return {
    children: [], dataset: {}, attrs: {}, textContent: "", className: "", hidden: false,
    classList: { values: new Set(), toggle(key, enabled) { enabled ? this.values.add(key) : this.values.delete(key); } },
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = items; },
    setAttribute(key, value) { this.attrs[key] = value; },
    getAttribute(key) { return this.attrs[key]; },
    getBoundingClientRect() { return { top: 10, bottom: 74 }; },
    addEventListener() {}, querySelector() { return null; },
  };
}
const state = {
  readOnly: true,
  players: [{ id: 1, name: "蔡,choi" }, { id: 2, name: "队友" }],
  sessions: [],
  calendar: { year: 2026, month: 10, selectedDates: [], showLedger: false },
};
const els = Object.fromEntries(["calendarLedgerToggle", "calendarLedgerTotal", "calendarGrid", "calendarScroll", "calendarDayTitle", "calendarDayRecords"].map((key) => [key, node()]));
els.calendarScroll.scrollTop = 120;
els.calendarDayTitle.parentElement = node();
const names = [
  "calculateSessionsLedgerAmount", "calculateLedgerAmount", "isChoiPaymentRow",
  "projectSessionParticipants", "getSessionOwnerKey", "normalizePlayerId", "normalizeAlias",
  "getPlayerById", "paymentDisplayName", "firstName", "splitAliases", "formatMoney",
  "getSessionsForSelection", "getSessionsOnDate", "getLocalDateString", "calendarMonthKey",
  "createCalendarDayButton", "updateCalendarLedgerControls", "renderCalendarDayPanel",
  "formatCalendarDate", "formatCalendarSummaryMonth", "parseLocalDate", "toggleCalendarLedger",
];
let renders = 0;
const api = loadPaymentFunctions(names, {
  state, els,
  document: { createElement: node },
  renderCalendar: () => { renders++; api.updateCalendarLedgerControls(); api.renderCalendarDayPanel(); },
  resizeCalendarToActiveMonth() {},
  createCalendarRecordCard: node, createAggregateCalendarCard: node,
});
const participant = (ownerPlayerId, ownerName, amount, options = {}) => ({
  playerId: ownerPlayerId, playerName: ownerName, ownerPlayerId, ownerName,
  slots: 1, plusCount: 0, amount, isCompanion: false, ...options,
});
const session = (date, courtFee, players, options = {}) => ({ date, courtFee, courtCount: 1, venue: "广羽", players, ...options });
const first = session("2026-10-08", 70, [
  participant(1, "蔡", 35),
  participant(1, "蔡", 35, { playerId: null, playerName: "蔡+1", isCompanion: true }),
  participant(2, "队友", 80),
  participant(2, "队友", 25.5, { playerId: null, playerName: "队友+1", isCompanion: true }),
  participant(null, "特殊成员", 20, { slots: 0 }),
]);
assert.equal(api.calculateSessionsLedgerAmount([first]), 55.5, "Uses saved payer amounts; excludes choi and choi's companions, includes special payments");
assert.equal(api.calculateSessionsLedgerAmount([first]), api.calculateLedgerAmount({ friends: [
  { playerId: 1, name: "蔡", amount: 70 }, { playerId: 2, name: "队友", amount: 105.5 }, { name: "特殊成员", amount: 20 },
]}, 70), "Matches the group collection ledger exactly");
assert.equal(api.calculateSessionsLedgerAmount([session("2026-10-01", 30, [participant(null, "choi", 30)])]), -30, "Historical name fallback excludes choi even without a player ID");
assert.equal(api.calculateSessionsLedgerAmount([session("2026-10-01", "70", [participant(2, "队友", 25)])]), -45);
assert.equal(api.calculateSessionsLedgerAmount([]), 0);
const second = session("2026-10-08", 10, [participant(2, "队友", 12.34)]);
const zero = session("2026-10-09", 70, [participant(2, "队友", 70)], { courtCount: 0 });
const negative = session("2026-10-10", 70, [participant(2, "队友", 20)]);
state.sessions = [first, second, zero, negative, session("2026-11-01", 10, [participant(2, "队友", 100)])];
assert.equal(api.formatMoney(api.calculateSessionsLedgerAmount(api.getSessionsForSelection())), "7.84", "Month sum excludes adjacent months");
const day = (dayNumber) => api.createCalendarDayButton(new Date(2026, 9, dayNumber));
const ledger = (button) => button.children.find((child) => child.className === "calendar-day-ledger");
assert.equal(ledger(day(8)), undefined, "Private amounts default to hidden");
api.renderCalendarDayPanel();
assert.equal(els.calendarLedgerTotal.hidden, true);
assert.equal(els.calendarLedgerTotal.textContent, "");
api.toggleCalendarLedger();
assert.equal(renders, 1);
assert.equal(state.calendar.showLedger, true);
assert.equal(els.calendarLedgerToggle.textContent, "隐藏记账");
assert.equal(els.calendarLedgerToggle.attrs["aria-pressed"], "true");
assert.equal(els.calendarGrid.classList.values.has("show-ledger"), true);
assert.equal(els.calendarLedgerTotal.textContent, "记账合计：¥7.84");
assert.equal(ledger(day(8)).textContent, "57.84", "All sessions on the same date are summed");
assert.equal(ledger(day(9)).textContent, "0.00", "A saved zero amount is displayed even with zero courts");
assert.equal(ledger(day(10)).textContent, "-50.00");
assert.equal(ledger(day(11)), undefined, "Days without records have no amount");
assert.match(day(8).attrs["aria-label"], /记账57\.84元/);
state.calendar.selectedDates = ["2026-10-08"];
api.renderCalendarDayPanel();
assert.equal(els.calendarLedgerTotal.textContent, "记账合计：¥57.84", "Single-day panel shows the combined total, not just one session");
state.calendar.selectedDates = ["2026-10-09", "2026-11-01"];
api.renderCalendarDayPanel();
assert.equal(els.calendarLedgerTotal.textContent, "记账合计：¥90.00", "Cross-month selections follow the existing summary scope");
state.calendar.selectedDates = ["2026-10-11"];
api.renderCalendarDayPanel();
assert.equal(els.calendarLedgerTotal.textContent, "记账合计：¥0.00");
api.toggleCalendarLedger();
assert.equal(els.calendarLedgerToggle.attrs["aria-pressed"], "false");
assert.equal(els.calendarLedgerTotal.hidden, true);
assert.equal(els.calendarLedgerTotal.textContent, "");
assert.equal(ledger(day(8)), undefined);
assert.doesNotMatch(day(8).attrs["aria-label"], /记账/);
assert.deepEqual(state.calendar.selectedDates, ["2026-10-11"], "Toggling does not clear date selection");
assert.match(paymentHtml, /calendarLedgerToggle\.addEventListener\("click", toggleCalendarLedger\)/);
const openCalendar = paymentHtml.slice(paymentHtml.indexOf("    function openCalendarModal("), paymentHtml.indexOf("    function shiftCalendarMonth("));
assert.match(openCalendar, /showLedger: false/, "Reopening the calendar resets private amounts to hidden");
console.log("Calendar ledger passed: group-payment parity, ownership, saved adjustments, daily/month/range totals, zero/negative/empty records, visibility and accessible labels.");

