import assert from "node:assert/strict";
import { loadPaymentFunctions, paymentHtml } from "./payment-test-helpers.js";

function css(selector) {
  const start = paymentHtml.indexOf(selector + " {");
  assert.ok(start >= 0, "Missing CSS rule: " + selector);
  return paymentHtml.slice(start, paymentHtml.indexOf("}", start) + 1);
}
const detailZ = Number(css("#calendarDetailModal").match(/z-index: (\d+)/)[1]);
const sidebarZ = Number(css(".nav-preview-sidebar").match(/z-index: (\d+)/)[1]);
assert.ok(detailZ > sidebarZ, "The details and backdrop must cover, not sit behind, the sidebar");
assert.match(css(".modal.calendar-detail-dialog"), /width: min\(1120px, 100%\)/);
assert.match(css(".modal.calendar-detail-dialog"), /max-height: min\(88dvh, 860px\)/);
assert.match(css(".modal.calendar-detail-dialog"), /grid-template-rows: auto minmax\(0, 1fr\)/);
assert.match(css(".calendar-detail-dialog .modal-body"), /min-height: 0/);
assert.match(css(".calendar-detail-dialog .modal-body"), /overflow: hidden/);
assert.match(css(".calendar-detail-table-wrap"), /min-height: 0/);
assert.match(css(".calendar-detail-table-wrap"), /width: 100%/);
assert.match(css(".calendar-detail-table-wrap"), /overflow: auto/);
assert.match(css(".calendar-detail-table-wrap"), /scrollbar-gutter: stable/);
assert.match(css(".calendar-detail-table"), /min-width: 0/, "Do not inherit the main database table minimum width");
assert.match(css(".calendar-detail-table th"), /position: sticky/);
assert.match(css(".calendar-detail-table th"), /top: 0/);
assert.match(css(".calendar-detail-table td[data-column-key=\"name\"]:first-child"), /left: 0/);
assert.match(paymentHtml, /\.calendar-detail-name,\s*\.calendar-detail-partners \{[^}]*white-space: normal;[^}]*overflow-wrap: anywhere;/);
assert.match(paymentHtml, /\.calendar-detail-name \{ width: clamp\(100px, 12vw, 160px\); \}/, "Names must not shrink to a one-character column on mobile");
assert.match(paymentHtml, /\.calendar-detail-partners \{ width: clamp\(180px, 24vw, 280px\); \}/);
assert.match(paymentHtml, /id="calendarDetailTableWrap"[^>]*role="region"[^>]*tabindex="0"[^>]*aria-label="成员详细统计，可上下及左右滚动"/);
assert.match(paymentHtml, /\.modal\.calendar-detail-dialog \{ max-height: 100dvh; \}/);

function node(tagName = "div") {
  const classes = new Set();
  return {
    tagName, children: [], dataset: {}, style: {}, attrs: {}, events: {}, inert: false,
    ownText: "", className: "",
    get textContent() { return this.ownText + this.children.map((child) => child.textContent).join(""); },
    set textContent(value) { this.ownText = String(value); this.children = []; },
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.ownText = ""; this.children = items; },
    setAttribute(key, value) { this.attrs[key] = String(value); },
    removeAttribute(key) { delete this.attrs[key]; },
    addEventListener(key, fn) { this.events[key] = fn; },
    classList: {
      add(key) { classes.add(key); }, remove(key) { classes.delete(key); },
      contains(key) { return classes.has(key); },
      toggle(key, enabled) { if (enabled) classes.add(key); else classes.delete(key); },
    },
  };
}
const declaration = paymentHtml.match(/    const CALENDAR_DETAIL_COLUMNS = \[[\s\S]*?\n    \];/)[0];
const columns = new Function(declaration + "\nreturn CALENDAR_DETAIL_COLUMNS;")();
const state = {
  calendarDetailColumnOrder: columns.map((column) => column.key),
  calendarDetailSort: { key: "playCount", dir: "desc" }, calendarDetailEntries: [],
};
const wrap = node();
const sidebar = node(), header = node(), appShell = node();
const modals = Object.fromEntries(["calendarModal", "calendarDetailModal", "memberCreateModal", "rosterReviewModal"].map((id) => [id, node()]));
const modalStack = [];
const document = {
  createElement: node,
  createTextNode: (value) => { const text = node("#text"); text.textContent = value; return text; },
  getElementById: (id) => modals[id],
  querySelector: () => appShell,
  querySelectorAll: (selector) => selector.includes("nav-preview-sidebar") ? [sidebar, header] : [],
};
const ui = loadPaymentFunctions([
  "getOrderedCalendarDetailColumns", "renderCalendarDetailTable", "createCalendarDetailCell",
  "createCalendarDetailHeatmap", "formatCalendarDetailPercent", "formatCalendarDetailChange",
  "getCalendarDetailChangeClass", "getCalendarDetailSortValue", "sortCalendarDetailEntries",
  "toggleCalendarDetailSort", "createCalendarDetailSortButton", "syncModalLayers",
], {
  state, document, els: { calendarDetailTableWrap: wrap }, modalStack,
  CALENDAR_DETAIL_COLUMNS: columns, collator: new Intl.Collator("zh-CN"),
  draggedCalendarDetailColumnKey: null,
});
const entries = Array.from({ length: 80 }, (_, index) => ({
  playerId: index + 1, name: index ? "成员" + index : "长姓名🌸".repeat(25),
  playCount: 80 - index, guestCount: index % 3, amountTotal: 100 - index,
  bestPartners: index ? ["拍档A", "拍档B"] : Array.from({ length: 50 }, (_, i) => "长拍档🌸".repeat(8) + i),
  bestPartnerSource: "partners", weekdays: [1, 2, 3, 4, 5, 6, 7], previousPlayCount: 2,
}));
const original = structuredClone(entries);
state.calendarDetailEntries = entries;
ui.renderCalendarDetailTable(entries);
let table = wrap.children[0];
assert.equal(table.children[1].children.length, 80, "Keep all members, not just those in the viewport");
assert.deepEqual(table.children[0].children[0].children.map((th) => th.dataset.columnKey), columns.map((column) => column.key));
const firstRow = table.children[1].children[0];
assert.equal(firstRow.children[0].children[0].className, "calendar-detail-name");
assert.equal(firstRow.children[0].textContent, entries[0].name, "Wrap names without truncating or injecting HTML");
assert.equal(firstRow.children[3].children[0].className, "calendar-detail-partners");
assert.equal(firstRow.children[3].textContent, entries[0].bestPartners.join("，"), "Every partner remains present and in the original order");
assert.equal(firstRow.children[4].children[0].children.length, 7, "Keep all seven weekday cells");
assert.match(firstRow.children[5].textContent, /上期 2 次/);
assert.deepEqual(firstRow.children.map((td) => td.dataset.columnKey), columns.map((column) => column.key));
assert.deepEqual(entries, original, "Rendering must not modify attendance, partners, or saved totals");
ui.toggleCalendarDetailSort("playCount");
assert.equal(wrap.children[0].children[1].children[0].children[0].textContent, entries.at(-1).name, "Sorting still toggles to ascending");
state.calendarDetailColumnOrder = [...state.calendarDetailColumnOrder].reverse();
ui.renderCalendarDetailTable(entries);
assert.deepEqual(wrap.children[0].children[0].children[0].children.map((th) => th.dataset.columnKey), state.calendarDetailColumnOrder, "Reordered columns preserve their semantic keys");
assert.equal(ui.createCalendarDetailCell({ ...entries[0], bestPartners: [] }, columns.find((column) => column.key === "bestPartners")).textContent, "—");
ui.renderCalendarDetailTable([]);
assert.equal(wrap.children[0].textContent, "本期没有关联成员的统计");

for (const blockingId of ["calendarDetailModal", "memberCreateModal", "rosterReviewModal"]) {
  modals.calendarModal.classList.add("open");
  modals[blockingId].classList.add("open");
  modalStack.push("calendarModal", blockingId);
  ui.syncModalLayers();
  assert.equal(sidebar.inert, true, blockingId + " blocks background navigation");
  assert.equal(header.attrs["aria-hidden"], "true");
  assert.equal(modals.calendarModal.inert, true);
  modals[blockingId].classList.remove("open");
  ui.syncModalLayers();
  assert.equal(sidebar.inert, false, "Closing a blocking dialog restores navigation");
  assert.equal(header.attrs["aria-hidden"], undefined);
  assert.equal(modals.calendarModal.inert, false);
  modalStack.length = 0;
  modals.calendarModal.classList.remove("open");
}
console.log("Calendar details passed: bounded modal, single two-axis table scroller, sticky labels, full long-text content, 80 members, sorting/reordering, empty state, and navigation focus restoration.");
