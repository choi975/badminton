import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { loadPaymentFunctions, paymentHtml } from "./payment-test-helpers.js";

function node() {
  return {
    children: [], dataset: {}, attrs: {}, events: {}, value: "", hidden: false, disabled: false,
    textContent: "", className: "", scrollTop: 0,
    classList: { toggle() {}, contains() { return false; } },
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = items; },
    setAttribute(key, value) { this.attrs[key] = value; },
    getAttribute(key) { return this.attrs[key]; },
    addEventListener(key, fn) { this.events[key] = fn; },
    focus() {},
  };
}
assert.match(paymentHtml, /id="calendarDayRecords"[^>]*><\/div>\s*<button id="calendarAddSessionBtn"[^>]*>新增记录<\/button>/, "The shared add-record button must follow the records, not sit in the heading");
const noop = () => {};
const state = { readOnly: false, sessions: [], feeMode: "basic", calendar: {
  year: 2026, month: 10, selectedDates: ["2026-10-08"], showLedger: false,
} };
const els = Object.fromEntries([
  "calendarDayTitle", "calendarAddSessionBtn", "calendarDayRecords", "calendarLedgerTotal", "calendarSelectionText",
  "recordAdvancedArea", "recordTitle", "recordDateInput", "recordCourtFeeInput", "recordCourtCountInput", "recordShuttlePriceInput",
  "recordShuttleCountInput", "recordCourtCountHint", "recordModal", "saveRecordBtn", "calendarModal", "chainModal",
  "chainInput", "feeAdvancedArea", "feeBasicGrid", "feeAdvancedBtn", "courtFeeInput", "shuttlePriceInput", "shuttleCountInput",
].map((key) => [key, node()]));
els.calendarDayTitle.parentElement = node();
const calls = [], opened = [], messages = [];
const first = { id: 10, date: "2026-10-08", venue: "广羽", courtCount: 1, courtFee: 70,
  shuttlePrice: 0, shuttleCount: 0, players: [] };
const second = { ...first, id: 11, venue: "文体", courtCount: 2, courtFee: 140 };
state.sessions = [first, second];
const names = ["getSessionsOnDate", "getSessionsForSelection", "createCalendarDayButton", "renderCalendarDayPanel",
  "renderCalendarSelection", "createCalendarRecordCard", "getLocalDateString", "calendarMonthKey", "formatCalendarDate",
  "formatCalendarSummaryMonth", "parseLocalDate", "openChainForNewDate", "maybeCancelChainEditFlow",
  "openRecordDialog", "openRecordDialogForChainEdit", "inferCourtCounts", "makeCourtCountHint", "formatCompactNumber", "formatMoney",
  "upsertSession"];
const ui = loadPaymentFunctions(names, {
  state, els, document: { createElement: node }, setTimeout: (fn) => fn(),
  calculateSessionsLedgerAmount: () => 0, buildCalendarSummaryLine: (sessions) => `费用${sessions[0].courtFee}`,
  setCalendarRecordMetaText: (el, title, text) => { el.textContent = `${title}：${text}`; },
  createAggregateCalendarCard: node, projectSessionParticipants: (rows) => rows,
  openChainForSessionEdit: (s) => calls.push(["edit", s.id]),
  deleteSessionRecord: (s) => calls.push(["delete", s.id]),
  toggleSessionVenue: (s) => calls.push(["venue", s.id]),
  resetPaymentRule: noop, updateShakePeopleButtonVisibility: noop, processChain: noop,
  openModal: (name) => opened.push(name), closeModal: noop, renderCalendar: noop,
  getCourtUnitPriceForDate: () => 70, toast: (text) => messages.push(text),
  applyRecordFeeMode: (advanced) => { els.recordAdvancedArea.hidden = !advanced; },
  normalizeSessionPlayers: (rows) => structuredClone(rows), renderRecordMembers: noop,
  normalizeSessions: (sessions) => structuredClone(sessions),
});
const descendants = (el) => [el, ...el.children.flatMap(descendants)];
const byClass = (el, css) => descendants(el).find((child) => child.className.split(" ").includes(css));
ui.renderCalendarDayPanel();
assert.equal(els.calendarAddSessionBtn.hidden, false, "A populated date must still allow another session");
assert.equal(els.calendarAddSessionBtn.textContent, "新增记录");
assert.equal(els.calendarDayTitle.parentElement.hidden, false);
assert.equal(els.calendarDayRecords.children.length, 2);
assert.match(byClass(els.calendarDayRecords.children[0], "calendar-record-meta").textContent, /第1场 · 广羽/);
assert.match(byClass(els.calendarDayRecords.children[1], "calendar-record-meta").textContent, /第2场 · 文体/);
const secondButtons = byClass(els.calendarDayRecords.children[1], "calendar-record-actions").children;
secondButtons.forEach((button) => button.events.click());
assert.deepEqual(calls, [["venue", 11], ["edit", 11], ["delete", 11]], "Every action targets the actual record ID");
let day = ui.createCalendarDayButton(new Date(2026, 9, 8));
assert.equal(byClass(day, "calendar-day-session-count").textContent, "2局");
assert.equal(byClass(day, "calendar-day-count").textContent, "3");
assert.equal(byClass(day, "calendar-day-venue").textContent, "多球馆");
assert.equal(byClass(day, "calendar-day-venue").attrs.role, undefined, "Daily aggregate must not silently change the first session");
assert.match(day.attrs["aria-label"], /2场球局，3个场地，广羽、文体/);
ui.renderCalendarSelection();
assert.match(els.calendarSelectionText.textContent, /2 场球局 · 3 个场地/);
second.venue = "广羽";
assert.equal(byClass(ui.createCalendarDayButton(new Date(2026, 9, 8)), "calendar-day-venue").textContent, "广羽");
state.sessions = [first];
ui.renderCalendarDayPanel();
assert.equal(els.calendarAddSessionBtn.hidden, false);
assert.equal(els.calendarAddSessionBtn.textContent, "新增记录");
els.calendarAddSessionBtn.onclick();
assert.deepEqual(state.pendingSessionEdit, { id: null, date: first.date });
assert.equal(state.sessions.length, 1, "Starting another session must preserve the existing one");
ui.maybeCancelChainEditFlow();
day = ui.createCalendarDayButton(new Date(2026, 9, 8));
assert.equal(byClass(day, "calendar-day-session-count"), undefined);
assert.equal(byClass(day, "calendar-day-venue").attrs.role, "button", "Keep single-session quick venue switching");
state.readOnly = true;
ui.renderCalendarDayPanel();
assert.equal(els.calendarAddSessionBtn.hidden, true);
assert.equal(byClass(els.calendarDayRecords.children[0], "calendar-record-actions"), undefined);
assert.equal(byClass(ui.createCalendarDayButton(new Date(2026, 9, 8)), "calendar-day-venue").attrs.role, undefined);
state.readOnly = false;
state.calendar.selectedDates = [];
ui.renderCalendarDayPanel();
assert.equal(els.calendarAddSessionBtn.hidden, true, "Month view has no implicit date for creation");
state.calendar.selectedDates = ["2026-10-08", "2026-10-09"];
ui.renderCalendarDayPanel();
assert.equal(els.calendarAddSessionBtn.hidden, true);
state.calendar.selectedDates = ["2026-10-09"];
ui.renderCalendarDayPanel();
assert.equal(els.calendarAddSessionBtn.textContent, "新增记录");
assert.equal(els.calendarAddSessionBtn.hidden, false);
state.trainingAnomaly = { trainCourt: false };
state.currentPaymentRecord = first;
els.calendarAddSessionBtn.onclick();
assert.deepEqual(state.pendingSessionEdit, { id: null, date: "2026-10-09" });
assert.equal(state.trainingAnomaly, null, "A new session must not inherit the previous training decision");
assert.equal(state.currentPaymentRecord, null);
assert.equal(els.chainInput.value, "", "A new session starts with its own roster");
state.currentPaymentRecord = { ...first, players: [] };
ui.openRecordDialogForChainEdit();
assert.equal(els.recordTitle.textContent, "记录本次订场");
assert.equal(els.recordDateInput.value, "2026-10-09", "New-session dialog preserves the selected date, not today");
assert.equal(els.recordModal.dataset.editing, "0");
assert.equal(els.recordModal.dataset.sessionId, "");
ui.maybeCancelChainEditFlow();
assert.equal(state.pendingSessionEdit, null);
assert.equal(state.sessions.length, 1, "Cancel must not change saved sessions");
ui.openRecordDialog({ session: first });
assert.equal(els.recordTitle.textContent, "编辑订场记录");
assert.equal(els.recordModal.dataset.sessionId, "10");
assert.equal(els.recordModal.dataset.editing, "1");

// Exercise the real worker INSERT/UPDATE SQL against the real migrations.
const db = new DatabaseSync(":memory:");
const migrations = new URL("../migrations/", import.meta.url);
for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
  db.exec(readFileSync(new URL(file, migrations), "utf8"));
}
const adapter = {
  prepare(sql) {
    let params = [];
    return { bind(...values) { params = values; return this; },
      run() { const result = db.prepare(sql).run(...params); return { meta: { last_row_id: Number(result.lastInsertRowid) } }; },
    };
  },
  async batch(statements) {
    db.exec("BEGIN");
    try { const results = statements.map((statement) => statement.run()); db.exec("COMMIT"); return results; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  },
};
function extract(source, name, indent = "") {
  const start = source.search(new RegExp(`^${indent}(?:async )?function ${name}\\(`, "m"));
  assert.ok(start >= 0, `Missing ${name}`);
  return source.slice(start, source.indexOf(`\n${indent}}`, start) + indent.length + 2);
}
const worker = readFileSync(new URL("../src/worker.js", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const getStored = (_db, id) => {
  const row = db.prepare("SELECT * FROM booking_sessions WHERE id = ?").get(id);
  return { id: row.id, date: row.date, venue: row.venue, courtCount: row.court_count, courtFee: row.court_fee,
    shuttlePrice: row.shuttle_price, shuttleCount: row.shuttle_count,
    players: db.prepare("SELECT * FROM booking_session_players WHERE session_id = ? ORDER BY id").all(id).map((row) => ({ ...row })),
  };
};
const backend = new Function("getSessionById", ["createSession", "updateSession", "serializePriceRows", "buildSessionPlayerStatements"]
  .map((name) => extract(worker, name)).join("\n") + "\nreturn { createSession, updateSession };")(getStored);
const participant = { playerId: null, playerName: "测试甲", ownerPlayerId: null, ownerName: "测试甲", isCompanion: false,
  slots: 1, plusCount: 0, amount: 70, isFemale: false, gender: "男", level: "不详", profileSnapshotReliable: true };
const input = { ...first, players: [participant], trainCourt: false, trainShuttle: false, actualShuttleConfirmed: true };
const saved1 = await backend.createSession(adapter, input);
const original = structuredClone(saved1);
const saved2 = await backend.createSession(adapter, { ...input, venue: "文体", courtFee: 140,
  players: [{ ...participant, playerName: "测试乙", ownerName: "测试乙", amount: 140 }] });
assert.notEqual(saved1.id, saved2.id);
assert.deepEqual(getStored(adapter, saved1.id), original, "Creating a same-date record preserves the first bill and roster");
await backend.updateSession(adapter, saved2.id, { ...input, courtFee: 210 });
assert.deepEqual(getStored(adapter, saved1.id), original, "Editing the second session preserves the first");
assert.equal(getStored(adapter, saved2.id).courtFee, 210);

// Submit the production dialog through POST then PATCH, using the actual SQL above.
const requests = [];
const dependencies = { ...ui, state, els, CourtPricing: globalThis.BadmintonCourtPricing,
  buildRecordParticipantsFromEditor: () => [participant], normalizePlayerId: (id) => id,
  deriveCourtRows: (fee, count) => [{ price: fee / count, count }], hasUnknownShuttleType: () => false,
  setSync: noop, closeModal: noop, openModal: (name) => opened.push(name), renderTable: noop, renderCalendar: noop,
  applyEdcBalanceResponse: () => "", applyGroupAttemptResponse: noop, appendTodoCounterMessage: noop,
  toast: (text) => messages.push(text), window: { confirm: (text) => { messages.push(text); return true; } },
  async api(url, options) {
    requests.push([url, options.method]);
    const body = options.body ? JSON.parse(options.body) : null;
    if (options.method === "DELETE") {
      const id = Number(url.split("/").at(-1));
      db.prepare("DELETE FROM booking_session_players WHERE session_id = ?").run(id);
      db.prepare("DELETE FROM booking_sessions WHERE id = ?").run(id);
      return { ok: true };
    }
    const session = options.method === "POST" ? await backend.createSession(adapter, body)
      : await backend.updateSession(adapter, Number(url.split("/").at(-1)), body);
    return { session };
  },
};
const saves = new Function(...Object.keys(dependencies), ["saveRecordDialog", "deleteSessionRecord"]
  .map((name) => extract(paymentHtml, name, "    ")).join("\n") + "\nreturn { saveRecordDialog, deleteSessionRecord };")(...Object.values(dependencies));
state.sessions = [saved1, getStored(adapter, saved2.id)];
state.currentPaymentRecord = input;
state.pendingSessionEdit = { id: null, date: first.date };
state.trainingAnomaly = { trainCourt: false, trainShuttle: false };
ui.openRecordDialogForChainEdit();
await saves.saveRecordDialog();
assert.deepEqual(requests.at(-1), ["/api/sessions", "POST"]);
assert.equal(state.sessions.length, 3, "Submitting a new same-date session appends rather than overwrites");
assert.equal(state.pendingSessionEdit, null);
assert.ok(opened.includes("calendarModal"));
const third = state.sessions.at(-1);
ui.openRecordDialog({ session: third });
els.recordCourtFeeInput.value = "210";
await saves.saveRecordDialog();
assert.deepEqual(requests.at(-1), [`/api/sessions/${third.id}`, "PATCH"]);
assert.equal(state.sessions.length, 3);
assert.deepEqual(getStored(adapter, saved1.id), original);
await saves.deleteSessionRecord(third);
assert.deepEqual(requests.at(-1), [`/api/sessions/${third.id}`, "DELETE"]);
assert.equal(state.sessions.length, 2);
assert.deepEqual(getStored(adapter, saved1.id), original);
assert.match(messages.at(-2), /第3场.*其他球局不会受影响/);
state.readOnly = true;
const requestCount = requests.length;
await saves.saveRecordDialog();
await saves.deleteSessionRecord(saved1);
assert.equal(requests.length, requestCount);
db.close();
console.log("Multiple calendar sessions passed: empty/populated/read-only UI, counts, venues, independent actions, draft date, cancellation, real migrated SQLite INSERT/UPDATE, POST/PATCH/DELETE isolation and return flow.");
