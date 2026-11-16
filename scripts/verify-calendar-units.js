import assert from "node:assert/strict";
import { loadPaymentFunctions, paymentHtml } from "./payment-test-helpers.js";

function node() {
  return {
    children: [], dataset: {}, attrs: {}, className: "", textContent: "", scrollTop: 0,
    classList: { values: new Set(), toggle(key, enabled) { enabled ? this.values.add(key) : this.values.delete(key); } },
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = items; },
    setAttribute(key, value) { this.attrs[key] = value; },
    getAttribute(key) { return this.attrs[key]; },
    addEventListener() {},
  };
}
const dateString = "2026-10-08";
const state = {
  readOnly: true, sessions: [],
  calendar: { year: 2026, month: 10, selectedDates: [dateString], showLedger: false, showCourtCount: false,
    anchorDate: dateString, highlightedMember: { key: "player:1" } },
};
const els = Object.fromEntries(["calendarUnitToggle", "calendarLedgerToggle", "calendarGrid", "calendarScroll"].map((key) => [key, node()]));
els.calendarScroll.scrollTop = 120;
const ledgerIcon = node();
els.calendarLedgerToggle.append(ledgerIcon);
const names = ["createCalendarDayButton", "getSessionsOnDate", "getLocalDateString", "calendarMonthKey", "formatMoney",
  "updateCalendarUnitControls", "updateCalendarLedgerControls", "toggleCalendarUnit", "openCalendarModal"];
let renders = 0;
const api = loadPaymentFunctions(names, {
  state, els, document: { createElement: node }, calculateSessionsLedgerAmount: () => -12.34,
  renderCalendar() {
    renders++;
    api.updateCalendarUnitControls();
    api.updateCalendarLedgerControls();
    els.calendarGrid.replaceChildren(api.createCalendarDayButton(new Date(2026, 9, 8)));
  },
  updateCalendarLayoutControls() {}, openModal() {}, resizeCalendarToActiveMonth() {},
  requestAnimationFrame: (callback) => callback(), scrollCalendarToMonth() {},
});
const descendants = (element) => [element, ...element.children.flatMap(descendants)];
const byClass = (element, name) => descendants(element).find((child) => child.className.split(" ").includes(name));
const day = () => api.createCalendarDayButton(new Date(2026, 9, 8));
const session = (courtCount, extra = {}) => ({ date: dateString, venue: "广羽", courtCount, courtFee: 999, players: [], ...extra });
const display = (expected, unit) => {
  const button = day();
  assert.equal(byClass(button, "calendar-day-count").textContent, expected);
  assert.equal(byClass(button, "calendar-day-unit").textContent, unit);
  assert.ok(button.attrs["aria-label"].includes(expected + unit), "Accessible quantity follows the visible unit");
  return button;
};

api.updateCalendarUnitControls();
assert.equal(els.calendarUnitToggle.attrs["aria-pressed"], "false");
assert.equal(els.calendarUnitToggle.attrs["aria-label"], "切换为场数（3小时=1个场）");
assert.ok(!els.calendarGrid.classList.values.has("show-court-count"));
for (const [hours, count] of [[0, "0"], [0.5, "0.166"], [1, "0.333"], [1.5, "0.5"], [2, "0.666"],
  [2.5, "0.833"], [3, "1"], [4, "1.333"], [5, "1.666"], [5.5, "1.833"], [6, "2"], [8, "2.666"], [15, "5"]]) {
  state.sessions = [session(globalThis.BadmintonCourtPricing.fromHours(hours))];
  const saved = structuredClone(state.sessions);
  state.calendar.showCourtCount = false;
  display(String(hours), "小时");
  state.calendar.showCourtCount = true;
  display(count, "个场");
  assert.deepEqual(state.sessions, saved, "Display conversion must not rewrite historical records or fees");
}
state.sessions = [session("1.833")];
display("1.833", "个场");
state.sessions = [session(0.333), session(0.333), session(0.333)];
display("1", "个场");
state.calendar.showCourtCount = false;
display("3", "小时");
state.sessions = [session(0.666), session(0.666, { venue: "文体" })];
state.calendar.showCourtCount = true;
let button = display("1.333", "个场");
assert.equal(byClass(button, "calendar-day-session-count").textContent, "2局");
assert.equal(byClass(button, "calendar-day-venue").textContent, "多球馆");
assert.equal(byClass(button, "calendar-day-ledger"), undefined, "Unit toggle never reveals hidden ledger amounts");
state.sessions = [];
assert.equal(byClass(day(), "calendar-day-badge"), undefined, "Empty dates stay empty in court mode");

state.sessions = [session(2)];
state.calendar.showCourtCount = false;
state.calendar.showLedger = true;
const before = structuredClone(state);
api.toggleCalendarUnit();
assert.equal(renders, 1);
assert.equal(state.calendar.showCourtCount, true);
assert.equal(els.calendarUnitToggle.attrs["aria-pressed"], "true");
assert.equal(els.calendarUnitToggle.attrs["aria-label"], "切换为小时");
assert.match(els.calendarUnitToggle.title, /当前显示场数/);
assert.ok(els.calendarGrid.classList.values.has("show-court-count"));
button = display("2", "个场");
assert.equal(byClass(button, "calendar-day-ledger").textContent, "-12.34");
assert.ok(els.calendarGrid.classList.values.has("show-ledger"));
assert.equal(els.calendarLedgerToggle.children[0], ledgerIcon, "Updating ledger state must preserve its icon");
assert.deepEqual(state.calendar.selectedDates, before.calendar.selectedDates);
assert.deepEqual(state.calendar.highlightedMember, before.calendar.highlightedMember);
assert.equal(state.calendar.anchorDate, before.calendar.anchorDate);
assert.deepEqual(state.sessions, before.sessions);
assert.equal(els.calendarScroll.scrollTop, 120);
api.toggleCalendarUnit();
display("6", "小时");
assert.equal(state.calendar.showLedger, true);
assert.equal(els.calendarUnitToggle.attrs["aria-pressed"], "false");
assert.ok(!els.calendarGrid.classList.values.has("show-court-count"));
state.calendar.showCourtCount = true;
state.readOnly = false;
display("2", "个场");
api.openCalendarModal();
assert.equal(state.calendar.showCourtCount, true, "Reopening keeps the current display preference");
assert.equal(state.calendar.showLedger, false, "Reopening still hides private ledger amounts");

for (const [id, icon] of [["calendarUnitToggle", "arrow-left-right"], ["calendarLedgerToggle", "notebook-pen"]]) {
  const markup = paymentHtml.match(new RegExp('<button id="' + id + '"[^>]*>.*?</button>'))?.[0];
  assert.ok(markup, "Missing calendar icon toggle: " + id);
  assert.ok(markup.includes('data-lucide="' + icon + '"'));
  assert.match(markup, /aria-label=/);
  assert.match(markup, /title=/);
  assert.match(markup, /aria-hidden="true"/);
  assert.ok(markup.endsWith("</i></button>"), "Icon toggle has no visible text label");
}
assert.ok(paymentHtml.includes('calendarUnitToggle.addEventListener("click", toggleCalendarUnit)'));
const renderSource = paymentHtml.slice(paymentHtml.indexOf("    function renderCalendar("), paymentHtml.indexOf("    function ensureCalendarMonthRendered("));
assert.ok(renderSource.includes("updateCalendarUnitControls()"));
assert.ok(renderSource.includes("if (preserveScroll) els.calendarScroll.scrollTop = previousScrollTop"));
assert.ok(paymentHtml.includes(".calendar-summary .calendar-icon-toggle"));
assert.ok(paymentHtml.includes(".calendar-continuous-grid.show-court-count .calendar-day-badge"));
console.log("Calendar units passed: icon-only controls, exact-hour thirds, half-hours, multiple sessions, accessible labels, private ledger isolation, read-only use and preserved selection/scroll.");
