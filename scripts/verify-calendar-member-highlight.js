import assert from "node:assert/strict";
import { loadPaymentFunctions, paymentHtml } from "./payment-test-helpers.js";

function element(tag = "div") {
  let text = "";
  const el = {
    tagName: tag.toUpperCase(), children: [], className: "", dataset: {}, attrs: {}, events: {},
    get textContent() { return text + this.children.map((child) => child.textContent).join(""); },
    set textContent(value) { text = value; this.children = []; },
    append(...children) { this.children.push(...children); children.forEach((child) => { child.parentElement = this; }); },
    replaceChildren(...children) { text = ""; this.children = []; this.append(...children); },
    setAttribute(key, value) { this.attrs[key] = String(value); },
    getAttribute(key) { return this.attrs[key]; },
    addEventListener(event, handler) { this.events[event] = handler; },
    querySelectorAll(selector) {
      return descendants(this).slice(1).filter((child) => selector.startsWith(".calendar-day[")
        ? child.classList.contains("calendar-day") && child.dataset.date
        : child.classList.contains("calendar-member-name") && child.dataset.memberKey);
    },
    closest() {
      if (["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA"].includes(this.tagName)
        || this.attrs.role === "button" || this.attrs.contenteditable === "true") return this;
      return this.parentElement?.closest() || null;
    },
  };
  el.classList = {
    contains(name) { return el.className.split(" ").includes(name); },
    toggle(name, on) {
      const classes = new Set(el.className.split(" ").filter(Boolean));
      if (on) classes.add(name); else classes.delete(name);
      el.className = [...classes].join(" ");
    },
  };
  return el;
}
const descendants = (el) => [el, ...el.children.flatMap(descendants)];
const byClass = (el, name) => descendants(el).filter((child) => child.classList.contains(name));
const row = (id, extra = {}) => ({
  playerId: id, ownerPlayerId: id, ownerName: id === 2 ? "阿11" : "choi", playerName: id === 2 ? "阿11" : "choi",
  isCompanion: false, slots: 1, plusCount: 0, amount: 20, ...extra,
});
const session = (id, date, players) => ({ id, date, players, venue: "广羽", courtCount: 1, courtFee: 70 });
const sessions = [
  session(1, "2026-11-01", [row(1), row(2)]),
  session(2, "2026-11-02", [row(1, { isCompanion: true, playerId: null, playerName: "choi+1" })]),
  session(3, "2026-11-03", [row(1, { slots: 0, amount: 0 }), row(1, { isCompanion: true, playerId: null })]),
  session(4, "2026-11-04", [row(1, { slots: 2, plusCount: 2 })]),
  session(5, "2026-11-05", [row(1, { slots: 3, plusCount: 2 })]),
  session(6, "2026-11-05", [row(1, { isCompanion: true, playerId: null })]),
  session(7, "2026-11-06", [row(3)]), // Same display name, different member identity.
  session(8, "2026-11-07", [row(1, { amount: 0 })]), // A free attendance still counts.
  session(9, "2026-10-31", [row(1)]),
  session(10, "2026-12-01", [row(1, { ownerName: "旧昵称" })]),
  session(11, "2026-11-08", [row(null, { ownerName: " Ａｎｎ ", playerName: "Ａｎｎ" })]),
  session(12, "2026-11-09", [row(null, { ownerName: "Ann", isCompanion: true })]),
  session(13, "2026-11-10", []),
  session(14, "2026-11-11", [row(1, { slots: "2", plusCount: "1" })]),
];
const originalSessions = structuredClone(sessions);
const state = {
  sessions, readOnly: true,
  players: [{ id: 1, name: "choi,旧昵称" }, { id: 2, name: "阿11" }, { id: 3, name: "choi" }],
  calendar: { year: 2026, month: 11, selectedDates: ["2026-11-05"], highlightedMember: null, highlightPointerStartedOnControl: false },
};
const els = { calendarGrid: element(), calendarDayRecords: element() };
const ui = loadPaymentFunctions([
  "calendarHighlightTargetIsControl", "handleCalendarHighlightPointerDown", "clearCalendarMemberHighlightOnBlank",
  "getCalendarMemberAttendanceDates", "refreshCalendarMemberHighlights", "toggleCalendarMemberHighlight",
  "createCalendarMemberLabel", "createAggregateCalendarCard", "createCalendarRecordCard", "setCalendarRecordMetaText",
  "getSessionOwnerKey", "projectSessionParticipants", "normalizePlayerId", "getPlayerById", "normalizeAlias",
  "splitAliases", "firstName", "paymentDisplayName", "formatMoney",
], {
  state, els, collator: new Intl.Collator("zh-CN"),
  document: { createElement: element, createTextNode(text) { const el = element("#text"); el.textContent = text; return el; } },
  buildCalendarSummaryLine: () => "原有费用汇总", openCalendarDetailModal() {},
});
const dates = (key) => [...ui.getCalendarMemberAttendanceDates(key)].sort();
const choiDates = ["2026-10-31", "2026-11-01", "2026-11-05", "2026-11-07", "2026-11-11", "2026-12-01"];
assert.deepEqual(dates("player:1"), choiDates, "Only actual self-attendance counts, across months and multiple sessions");
assert.deepEqual(dates("player:2"), ["2026-11-01"]);
assert.deepEqual(dates("player:3"), ["2026-11-06"], "Never match a different member by display name");
assert.deepEqual(dates("name:ann"), ["2026-11-08"], "Historical name-only identities retain normalization but exclude companions");
assert.deepEqual(dates(undefined), []);
assert.deepEqual(dates("player:999"), []);

for (const date of [...new Set(sessions.map((s) => s.date))]) {
  const cell = element("button");
  cell.className = "calendar-day";
  cell.dataset.date = date;
  if (date === "2026-11-05") cell.classList.toggle("selected", true);
  if (date === "2026-11-07") cell.classList.toggle("today", true);
  els.calendarGrid.append(cell);
}
const aggregate = ui.createAggregateCalendarCard(sessions, "11月合计");
const daily = ui.createCalendarRecordCard(sessions[0], "第1场 · 广羽");
els.calendarDayRecords.append(aggregate, daily);
const labels = byClass(els.calendarDayRecords, "calendar-record-player");
const originalLabels = labels.map((el) => el.textContent);
const buttons = () => byClass(els.calendarDayRecords, "calendar-member-name");
const memberButton = (key) => buttons().find((el) => el.dataset.memberKey === key);
const highlightedDates = () => byClass(els.calendarGrid, "member-highlighted").map((el) => el.dataset.date).sort();
const selectedDate = () => byClass(els.calendarGrid, "selected").map((el) => el.dataset.date);
const click = (target) => {
  ui.handleCalendarHighlightPointerDown({ target });
  target.events.click?.({ target });
  ui.clearCalendarMemberHighlightOnBlank({ target });
};
click(memberButton("player:1"));
assert.deepEqual(highlightedDates(), choiDates);
assert.ok(buttons().filter((el) => el.dataset.memberKey === "player:1").every((el) => el.attrs["aria-pressed"] === "true"), "Repeated names in multiple session cards stay in sync");
assert.equal(memberButton("player:2").attrs["aria-pressed"], "false");
assert.equal(memberButton("player:1").attrs["aria-controls"], "calendarGrid");
assert.equal(memberButton("player:1").type, "button");
assert.deepEqual(byClass(els.calendarDayRecords, "calendar-record-player"), labels, "Highlighting must not rebuild or move the detail rows");
assert.deepEqual(labels.map((el) => el.textContent), originalLabels, "Names, amounts and sorting must remain unchanged");
assert.deepEqual(selectedDate(), ["2026-11-05"]);
assert.deepEqual(state.calendar.selectedDates, ["2026-11-05"], "Attendance highlighting is not a date selection/filter");
assert.equal(byClass(els.calendarGrid, "today").length, 1);
assert.equal(ui.createCalendarMemberLabel({ key: "player:1", name: "choi", amount: 20 }).children[0].attrs["aria-pressed"], "true", "New daily/monthly detail rows retain the selection");

click(memberButton("player:2"));
assert.deepEqual(highlightedDates(), ["2026-11-01"], "Switch members instead of stacking highlights");
click(memberButton("player:2"));
assert.deepEqual(highlightedDates(), [], "Clicking the same name again cancels");
assert.equal(state.calendar.highlightedMember, null);
click(memberButton("player:1"));
const blank = element();
click(blank);
assert.deepEqual(highlightedDates(), [], "Clicking non-interactive calendar whitespace cancels");
assert.ok(buttons().every((el) => el.attrs["aria-pressed"] === "false"));
assert.deepEqual(selectedDate(), ["2026-11-05"], "Blank cancellation must not clear the user's selected dates");

click(memberButton("player:1"));
for (const tag of ["button", "a", "input", "select", "textarea"]) {
  const control = element(tag), nested = element("span");
  control.append(nested);
  click(nested);
  assert.equal(state.calendar.highlightedMember.key, "player:1", "Calendar controls and their children do not cancel highlights");
}
const venue = element("span"); venue.setAttribute("role", "button"); click(venue);
assert.equal(state.calendar.highlightedMember.key, "player:1");
ui.handleCalendarHighlightPointerDown({ target: els.calendarGrid.children[0] });
ui.clearCalendarMemberHighlightOnBlank({ target: els.calendarGrid });
assert.equal(state.calendar.highlightedMember.key, "player:1", "A rectangular date drag's synthetic blank click must not cancel highlights");

state.calendar.month = 12;
const newDate = element("button"); newDate.className = "calendar-day ghost"; newDate.dataset.date = "2026-12-01";
els.calendarGrid.append(newDate);
ui.refreshCalendarMemberHighlights();
assert.equal(state.calendar.highlightedMember.key, "player:1", "Month navigation retains the selected member");
assert.ok(newDate.classList.contains("member-highlighted"), "Newly rendered and ghost-month cells must also highlight");
state.sessions = sessions.filter((s) => s.id !== 10);
ui.refreshCalendarMemberHighlights();
assert.ok(!newDate.classList.contains("member-highlighted"), "Deleted/updated attendance must not leave stale highlights");
assert.equal(newDate.title, "");
state.sessions = sessions;
state.calendar.highlightedMember = null;
ui.refreshCalendarMemberHighlights();
assert.deepEqual(highlightedDates(), []);
assert.equal(ui.createCalendarMemberLabel({ key: "unresolved:1", name: "未知成员", amount: 5 }).textContent, "未知成员（5.00元）");
assert.equal(ui.createCalendarMemberLabel({ key: "unresolved:1", name: "未知成员", amount: 5 }).children.length, 0, "Unresolved identities must not match unrelated unknown members");
assert.deepEqual(sessions, originalSessions, "The feature must not mutate any saved attendance, identity, or amount");

const reset = paymentHtml.slice(paymentHtml.indexOf("    function openCalendarModal("), paymentHtml.indexOf("    function shiftCalendarMonth("));
assert.match(reset, /highlightedMember: null/, "Reopening the calendar clears highlights");
const render = paymentHtml.slice(paymentHtml.indexOf("    function renderCalendar("), paymentHtml.indexOf("    function ensureCalendarMonthRendered("));
assert.match(render, /refreshCalendarMemberHighlights\(\)/, "Every grid rerender reapplies highlights");
assert.match(paymentHtml, /calendarModal\.addEventListener\("pointerdown", handleCalendarHighlightPointerDown, \{ capture: true \}\)/);
assert.match(paymentHtml, /calendarModal\.addEventListener\("click", clearCalendarMemberHighlightOnBlank\)/);
assert.match(paymentHtml, /\.calendar-day\.member-highlighted\s*\{\s*background: var\(--amber-soft\)/, "The full cell, not just its text, gets the highlight");
assert.match(paymentHtml, /\.calendar-day\.member-highlighted:not\(\.selected\):not\(\.today\)/, "Preserve selected-date and today borders");
assert.match(paymentHtml, /\.calendar-record-player \.calendar-member-name\s*\{[^}]*min-height: 0;[^}]*padding: 0;[^}]*border: 0;[^}]*font: inherit;/);
assert.ok(paymentHtml.indexOf("    .calendar-day.member-highlighted {") > paymentHtml.indexOf("      .calendar-day.has-bookings {"), "Member highlight backgrounds must win over the mobile booking background");
console.log("Calendar member highlights verified: actual attendance, identity, unchanged details, switching/toggling, whitespace cancellation, date-drag coexistence, month continuity and read-only use.");
