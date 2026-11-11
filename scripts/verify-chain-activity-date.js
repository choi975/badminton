import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import "../session-planner-core.js";
import "../chain-activity-date.js";
const dates = globalThis.BadmintonChainActivityDate;
const parse = (text, today = "2026-11-11", referenceDate = today) => dates.parse(text, { today, referenceDate });
for (const text of ["活动时间：11-09 (周一) 19:00 ~ 22:00", "活动时间: 11/9（星期一）19:00-22:00", "活动日期：11月9日", "活动时间：2026-11-09 19:00 ~ 22:00", "活动时间：2026年11月9日", "活动时间：2026.11.9", "活动时间：２０２６－１１－０９ （周一）"]) {
  assert.equal(parse(text).date, "2026-11-09", text);
  assert.equal(Boolean(parse(text).needsConfirmation), false, "Unambiguous same-year dates need no interruption");
}
assert.equal(parse("活动时间：2025/11/09 (周日)").date, "2025-11-09", "An explicit year always wins");
assert.equal(parse("活动时间：11-09 (周日)", "2026-11-11", "2025-11-09").date, "2025-11-09", "Editing an older record preserves its year");
assert.equal(parse("活动时间：11-09 (周二)").needsConfirmation, true, "A weekday mismatch needs confirmation, not silent date arithmetic");
assert.equal(parse("活动时间：11-09 (周二)").date, "2026-11-09");
assert.equal(parse("活动时间：12-31", "2027-01-02").date, "2026-12-31");
assert.equal(parse("活动时间：12-31", "2027-01-02").needsConfirmation, true);
assert.equal(parse("活动时间：1月2日", "2026-12-30").date, "2027-01-02");
assert.equal(parse("活动时间：1月2日", "2026-12-30").needsConfirmation, true);
assert.equal(parse("活动时间：06-01").date, "2026-06-01", "Ordinary dates default to the current year");
for (const text of ["活动时间：2026-02-30", "活动时间：13-09", "活动时间：11-00", "活动时间：19:00 ~ 22:00", "活动时间：2026-99-99", "活动时间：0000-11-09", "活动时间：2026-11-310"]) assert.equal(parse(text).status, "invalid", text);
assert.equal(parse("活动时间：2024-02-29 (星期四)").date, "2024-02-29");
assert.equal(parse("活动时间：11-09 ~ 11-10").status, "ambiguous");
assert.equal(parse("活动时间：11-09\n活动时间：11-10").status, "ambiguous");
assert.equal(parse("活动时间：11-09\n活动日期：2026-11-09").date, "2026-11-09");
for (const text of ["", "周一 11-09\nAA费用：11.09元\n1. 【3级】某人", "活动地点：11-09馆"]) assert.equal(parse(text).status, "missing", "Only activity date/time metadata is authoritative");
assert.equal(dates.weekday("2026-11-09"), "周一");
assert.equal(dates.metadata("  活动时间：２０２６－１１－０９ \r\n1. A"), dates.metadata("活动时间:2026-11-09\n1. B"), "Roster-only edits retain a manual date decision");

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8").replaceAll("\r\n", "\n");
function source(name) {
  const start = html.search(new RegExp("    (?:async )?function " + name + "\\("));
  assert.ok(start >= 0, name);
  return html.slice(start, html.indexOf("\n    }", start) + 6);
}
const state = { chainActivityDate: "2026-11-09", currentPaymentRecord: { courtFee: 70, shuttlePrice: 10, shuttleCount: 0, players: [] },
  trainingAnomaly: { trainCourt: true, trainShuttle: true, actualShuttleConfirmed: true } };
const submitted = [];
const noop = () => {};
const context = vm.createContext({ state, getBeijingDateString: () => "2026-11-11", els: { paymentRecordBtn: {} },
  setSync: noop, assessCurrentRecordAnomaly: () => ({}), saveSessionRequest: async (path, body) => { submitted.push({ path, body }); return { session: { id: 1 } }; },
  upsertSession: noop, applyEdcBalanceResponse: () => "", finishSessionSaveFollowups: noop, applyGroupAttemptResponse: noop,
  closeModal: noop, renderTable: noop, appendTodoCounterMessage: noop, toast: noop,
});
vm.runInContext(source("getChainActivityDate") + "\n" + source("savePaymentRecordDirect"), context);
assert.equal(context.getChainActivityDate(), "2026-11-09");
await context.savePaymentRecordDirect(1);
assert.equal(submitted[0].body.date, "2026-11-09", "The direct-save path must use the selected activity date, not today's date");
assert.equal(submitted[0].path, "/api/sessions");
state.pendingSessionEdit = { id: 2, date: "2025-11-09" };
assert.equal(context.getChainActivityDate(), "2025-11-09", "An existing record's selected date remains authoritative");
assert.match(html, /recordDateInput\.value = session\?\.date \|\| getChainActivityDate\(\)/);
assert.match(html, /const reportDate = getChainActivityDate\(\)/);
assert.match(html, /id="chainActivityDateInput" type="date"/);
assert.match(html, /getChainActivityDate\(\) !== getBeijingDateString\(\) \|\| isChainActivityDatePending\(\)/);
console.log("Activity dates passed: labeled formats, Beijing defaults, explicit/old years, cross-year confirmation, invalid/ambiguous dates, weekday checks, selected-date saves and historical training isolation.");
