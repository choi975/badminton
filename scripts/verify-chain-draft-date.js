import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import vm from "node:vm";
import "../session-planner-core.js";
import "../chain-activity-date.js";
import { handleSessionPlans } from "../src/session-plans.js";
const core = globalThis.BadmintonSessionPlannerCore;
const activityDates = globalThis.BadmintonChainActivityDate;
const source = readFileSync(new URL("../session-planner.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const uiSources = ["getChainActivityDate", "hasConfirmedChainActivityDate", "isChainActivityDatePending", "onChainDraftDateChanged", "renderChainActivityDate", "selectChainActivityDate", "handleChainActivityDateChange", "extractMiniProgramRoster"].map(name => {
  const start = html.search(new RegExp("    (?:async )?function " + name + "\\("));
  assert.ok(start >= 0, name);
  return html.slice(start, html.indexOf("\n    }", start) + 6);
}).join("\n");
const key = "badminton.session-plans.v1";
const sql = new DatabaseSync(":memory:");
sql.exec(readFileSync(new URL("../migrations/0026_session_plans.sql", import.meta.url), "utf8"));
const db = { prepare(text) { return { values: [], bind(...values) { this.values = values; return this; },
  async first() { return sql.prepare(text).get(...this.values) || null; }, async all() { return { results: sql.prepare(text).all(...this.values) }; } }; } };
const makeDay = (text) => core.normalizeDay({ text, slots: text.split("\n").filter(line => /^\d+\./.test(line)).map(line => line.replace(/^\d+\.\s*/, "")) });
const seed = (date, text) => {
  sql.prepare("INSERT INTO session_plans (activity_date, revision, content_json, mutation_id, updated_at) VALUES (?, 1, ?, ?, ?)")
    .run(date, JSON.stringify(makeDay(text)), randomUUID(), "2026-11-11T05:00:00Z");
};
const row = (date) => {
  const item = sql.prepare("SELECT * FROM session_plans WHERE activity_date = ?").get(date);
  return item ? { date, revision: item.revision, day: JSON.parse(item.content_json) } : null;
};
seed("2026-11-11", "1. Today's original");
seed("2026-10-05", "1. Existing historical draft");
seed("2026-10-06", "1. Another device's draft");
const storage = new Map([[key, JSON.stringify({ version: 1, days: { "2026-11-11": row("2026-11-11") }, pending: {} })]]);
function harness() {
  class Element {
    dataset = {}; listeners = {}; textContent = ""; open = false;
    addEventListener(name, fn) { this.listeners[name] = fn; }
    setAttribute(name, value) { this[name] = value; }
    removeAttribute(name) { delete this[name]; }
    focus() {}
  }
  const elements = Object.fromEntries(["planSaveStatus", "sessionPlanDialog", "planGrid", "planMembers", "closeSessionPlan", "retryPlanSave", "useCloudPlan", "chainPlanSaveStatus", "chainPlanRetryBtn", "clearPlanSlot", "editPlanSlot"].map(id => [id, new Element()]));
  let today = "2026-11-11", online = true, approve = true, timerId = 0, delayedDate = null, release;
  const timers = new Map(), calls = [], confirmations = [], messages = [];
  const state = { players: [], sessions: [], plusOverrides: {}, chainInputUserOwned: false };
  const input = Object.assign(new Element(), { value: "" });
  const els = { chainInput: input, chainActivityDateBar: new Element(), chainActivityDateInput: new Element(), chainActivityDateHint: new Element(), extractRosterBtn: new Element(), paymentBtn: new Element() };
  const navigator = { get onLine() { return online; } };
  const names = () => input.value.split("\n").filter(line => /^\d+\./.test(line)).map(line => line.replace(/^\d+\.\s*/, ""));
  const dispatch = (url, options = {}) => handleSessionPlans(new Request("https://badminton.choi975.workers.dev" + url, {
    ...options, headers: { ...options.headers, origin: "https://badminton.choi975.workers.dev" },
  }), { DB: db }, { json: (data, status = 200) => Response.json(data, { status }), rateLimit: async () => true, now: new Date(today + "T05:00:00Z") });
  const context = vm.createContext({ state, els, ChainActivityDate: activityDates, getBeijingDateString: () => today,
    updateShakePeopleButtonVisibility() {}, updatePaymentButton: () => { els.paymentBtn.disabled = Boolean(state.chainDateChanging); },
    getChainEntryBaseName: entry => entry.clean, scheduleGroupAttemptSnapshot() {},
    toast: message => messages.push(message),
    parseMiniProgramChain: text => text.includes("活动时间") ? { participantLines: text.split("\n").filter(line => /^\d+\./.test(line)) } : null,
    BadmintonSessionPlannerCore: { ...core, date: () => today }, navigator, crypto: { randomUUID }, AbortController,
    document: { getElementById: id => elements[id], addEventListener() {}, visibilityState: "visible" }, window: { addEventListener() {} },
    localStorage: { getItem: name => storage.get(name) ?? null, setItem: (name, value) => storage.set(name, value) },
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; }, clearTimeout: id => timers.delete(id), setInterval() {},
    confirm: message => { confirmations.push(message); return approve; },
    fetch: async (url, options) => {
      calls.push({ url, method: options?.method || "GET", body: options?.body ? JSON.parse(options.body) : null });
      if (!online) throw new Error("Offline");
      if (delayedDate && new URL("https://example.test" + url).searchParams.get("date") === delayedDate) await new Promise(resolve => { release = resolve; });
      return dispatch(url, options);
    },
  });
  vm.runInContext(source + "\n" + uiSources, context);
  let controller;
  context.processChain = () => { state.chainEntries = names().map(clean => ({ clean })); controller?.capture(); };
  controller = context.BadmintonSessionPlanner.create({ state, input, process: context.processChain, apiUrl: path => path,
    names, toast: message => messages.push(message), forecastChanged() {}, dateChanged: context.onChainDraftDateChanged, forecastEntries: () => core.entries(names()),
    deferActivityDate: context.isChainActivityDatePending, activityDateConfirmed: context.hasConfirmedChainActivityDate,
  });
  context.sessionPlannerController = controller;
  const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); };
  const flush = async () => {
    for (let round = 0; round < 4; round++) {
      await settle();
      const jobs = [...timers].filter(([, job]) => job.delay === 550);
      if (!jobs.length) break;
      for (const [id, job] of jobs) { timers.delete(id); job.fn(); }
    }
    await settle();
  };
  return { controller, state, input, calls, elements, els, api: context, confirmations, messages, settle, flush,
    store: () => JSON.parse(storage.get(key)), setToday: value => { today = value; }, setOnline: value => { online = value; },
    approve: value => { approve = value; }, delay: date => { delayedDate = date; }, release: () => { delayedDate = null; release(); } };
}
const ui = harness(); await ui.settle();
assert.equal(ui.input.value, "1. Today's original");
ui.input.value = "活动时间：2026-09-09 19:00 ~ 22:00\n1. Imported";
ui.state.chainInputUserOwned = true;
ui.controller.capture(); await ui.flush();
assert.equal(ui.store().unassigned.day.text, ui.input.value, "A historical paste is backed up locally before date acceptance");
assert.equal(ui.store().pending["2026-11-11"], undefined);
assert.equal(row("2026-11-11").day.text, "1. Today's original", "Pasting must not overwrite today's cloud draft");
assert.match(ui.elements.chainPlanSaveStatus.textContent, /确认活动日期/);
const historical = makeDay("1. Imported");
assert.equal(await ui.controller.selectDate("2026-09-09", { day: historical }), true);
ui.input.value = historical.text; ui.controller.capture(); await ui.flush();
assert.equal(row("2026-09-09").day.text, historical.text, "Older dates synchronize outside the seven-day window");
assert.equal(row("2026-11-11").day.text, "1. Today's original");
assert.equal(ui.store().selectedDate, "2026-09-09");
assert.equal(ui.store().unassigned, undefined);
assert.equal(ui.controller.plannedEntries()["2026-11-11"][0].clean, "Today's original", "Historical imports are not today's sign-ups");
const restored = harness(); await restored.settle();
assert.equal(restored.state.chainActivityDate, "2026-09-09");
assert.equal(restored.input.value, historical.text, "Reloading restores the selected historical date and its cloud draft");
restored.setToday("2026-11-12"); restored.controller.rollover(); await restored.settle();
assert.equal(restored.state.chainActivityDate, "2026-09-09", "Midnight does not erase a pinned historical draft");
assert.equal(restored.input.value, historical.text);
restored.input.value = "1. Replacement"; restored.state.chainInputUserOwned = true;
restored.approve(false);
assert.equal(await restored.controller.selectDate("2026-10-05"), false, "Replacing an existing date needs explicit confirmation");
assert.equal(restored.state.chainActivityDate, "2026-09-09");
assert.equal(restored.input.value, "1. Replacement", "Declining date replacement preserves the source roster");
assert.equal(row("2026-10-05").day.text, "1. Existing historical draft");
restored.approve(true);
assert.equal(await restored.controller.selectDate("2026-10-05"), true);
restored.controller.capture(); await restored.flush();
assert.equal(row("2026-10-05").day.text, "1. Replacement");
assert.equal(row("2026-10-05").revision, 2);
assert.equal(row("2026-09-09").day.text, historical.text, "A date change never deletes other activity drafts");
restored.setOnline(false); restored.input.value = "1. Offline import";
assert.equal(await restored.controller.selectDate("2026-10-06"), true);
restored.controller.capture(); await restored.flush();
assert.equal(restored.store().pending["2026-10-06"].revision, 0, "An unknown offline date cannot assume the server revision");
assert.equal(row("2026-10-06").day.text, "1. Another device's draft");
restored.setOnline(true); await restored.controller.refresh(); await restored.settle();
assert.equal(row("2026-10-06").day.text, "1. Another device's draft", "Reconnecting must not silently overwrite an unknown cloud draft");
assert.equal(restored.store().pending["2026-10-06"].day.text, "1. Offline import");
assert.match(restored.elements.chainPlanSaveStatus.textContent, /2026-10-06.*云端有更新/);
assert.equal(restored.elements.chainPlanRetryBtn.hidden, false, "Historical drafts expose conflict recovery even when today’s probability button is hidden");
assert.equal(typeof restored.elements.chainPlanRetryBtn.listeners.click, "function");
restored.approve(false); restored.elements.retryPlanSave.listeners.click(); await restored.settle();
assert.equal(row("2026-10-06").day.text, "1. Another device's draft");
restored.approve(true); restored.elements.retryPlanSave.listeners.click(); await restored.settle();
assert.equal(row("2026-10-06").day.text, "1. Offline import", "Only confirmed conflict recovery may replace the cloud draft");
restored.input.value = "1. Before request"; restored.delay("2026-10-07");
const selection = restored.controller.selectDate("2026-10-07");
restored.input.value = "1. Edited while loading"; restored.release();
assert.equal(await selection, false, "A stale async selection cannot apply to a newer roster");
assert.equal(restored.state.chainActivityDate, "2026-10-06");
assert.equal(row("2026-10-07"), null);
assert.equal(sql.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'booking_sessions'").get().n, 0, "Draft operations never create or overwrite booking records");
function freshToday() {
  storage.set(key, JSON.stringify({ version: 1, days: { "2026-11-11": row("2026-11-11") }, pending: {} }));
  return harness();
}
const example = freshToday(); await example.settle();
example.input.value = "活动时间：11-09 (周一) 19:00 ~ 22:00\n1. November nine";
example.state.chainInputUserOwned = true; example.api.processChain();
assert.equal(example.state.chainActivityDate, "2026-11-11", "Pasting never changes the selected date");
const todayBefore = row("2026-11-11").day.text;
await example.api.extractMiniProgramRoster(); await example.flush();
assert.equal(example.state.chainActivityDate, "2026-11-09");
assert.equal(example.input.value, "1. November nine");
assert.equal(row("2026-11-09").day.text, "1. November nine");
assert.equal(row("2026-11-11").day.text, todayBefore);
assert.equal(example.els.chainActivityDateHint.textContent, "周一 · 识别");
assert.equal(example.els.paymentBtn.disabled, false, "Date selection unlocks the payment action in finally");

const manual = freshToday(); await manual.settle();
manual.input.value = "活动时间：2026-09-08\n1. Manual correction";
manual.state.chainInputUserOwned = true; manual.api.processChain();
assert.equal(await manual.api.selectChainActivityDate("2026-09-10"), true);
manual.api.processChain(); await manual.flush();
assert.equal(manual.store().unassigned, undefined, "A manual date overrides conflicting text metadata");
assert.equal(row("2026-09-10").day.text, manual.input.value);
assert.equal(row("2026-09-10").day.activityDateConfirmed, true, "Explicit manual confirmation must survive cloud persistence");
manual.input.value += "\n2. Roster-only change"; manual.api.processChain(); await manual.flush();
assert.equal(row("2026-09-10").day.text, manual.input.value, "Editing members must not invalidate the manual date");
const reloadManual = harness(); await reloadManual.settle();
assert.equal(reloadManual.api.isChainActivityDatePending(), false, "A dated cloud draft retains its confirmed date after reload");
const confirmationsBefore = reloadManual.confirmations.length;
await reloadManual.api.extractMiniProgramRoster(); await reloadManual.flush();
assert.equal(reloadManual.state.chainActivityDate, "2026-09-10", "Cleanup must not undo an already confirmed manual date");
assert.equal(reloadManual.confirmations.length, confirmationsBefore);
assert.equal(row("2026-09-10").day.text, "1. Manual correction\n2. Roster-only change");
reloadManual.input.value = "活动时间：2026-09-07\n1. A different activity";
reloadManual.state.chainInputUserOwned = true; reloadManual.api.processChain(); await reloadManual.flush();
assert.equal(reloadManual.api.isChainActivityDatePending(), true, "New activity metadata requires a fresh date decision");
assert.notEqual(row("2026-09-10").day.text, reloadManual.input.value);

for (const header of ["活动时间：2026-02-30", "活动时间：11-09 ~ 11-10", "活动时间：11-11 (周一)"]) {
  const uncertain = freshToday(); await uncertain.settle();
  const before = row("2026-11-11").day.text;
  uncertain.input.value = header + "\n1. Needs confirmation";
  uncertain.state.chainInputUserOwned = true; uncertain.api.processChain(); await uncertain.flush();
  assert.equal(row("2026-11-11").day.text, before, "Even same-day weekday mismatches stay local before confirmation");
  const raw = uncertain.input.value; uncertain.approve(false);
  await uncertain.api.extractMiniProgramRoster(); await uncertain.flush();
  assert.equal(uncertain.input.value, raw, "Declining an uncertain date keeps all original activity evidence");
  assert.equal(row("2026-11-11").day.text, before);
  uncertain.approve(true); await uncertain.api.extractMiniProgramRoster(); await uncertain.flush();
  assert.equal(uncertain.input.value, "1. Needs confirmation");
  assert.equal(uncertain.state.chainActivityDate, "2026-11-11");
  assert.equal(row("2026-11-11").day.text, "1. Needs confirmation");
}

const race = freshToday(); await race.settle();
race.input.value = "1. Keep this input while looking up a date";
race.delay("2026-08-01");
const selecting = race.controller.selectDate("2026-08-01");
await race.controller.refresh();
assert.equal(race.input.value, "1. Keep this input while looking up a date", "A background read cannot replace the roster during date selection");
race.release(); assert.equal(await selecting, true);
race.delay("2026-08-02");
const oldSelection = race.controller.selectDate("2026-08-02");
assert.equal(await race.controller.selectDate("2026-08-03"), true);
race.release(); assert.equal(await oldSelection, false, "Only the latest date-selection request can win");
assert.equal(race.state.chainActivityDate, "2026-08-03");
race.delay("2026-08-04");
const oldContext = race.api.selectChainActivityDate("2026-08-04");
race.state.pendingSessionEdit = { id: 42, date: "2024-11-09" };
race.release(); assert.equal(await oldContext, false, "A different booking edit invalidates the in-flight draft date selection");
assert.equal(race.state.pendingSessionEdit.date, "2024-11-09");
assert.equal(race.state.chainActivityDate, "2026-08-03");

const rollover = freshToday(); await rollover.settle();
rollover.setToday("2026-11-12"); rollover.controller.rollover(); await rollover.settle();
assert.equal(rollover.state.chainActivityDate, "2026-11-12");
assert.equal(rollover.input.value, "", "Ordinary today's drafts still reset at Beijing midnight");
rollover.setToday("2026-11-13"); rollover.controller.rollover(); await rollover.settle();
rollover.input.value = "活动时间：11-09 (周一) 19:00 ~ 22:00\n1. Unconfirmed import";
rollover.state.chainInputUserOwned = true; rollover.api.processChain();
const unconfirmed = rollover.input.value;
rollover.setToday("2026-11-14"); rollover.controller.rollover(); await rollover.settle();
assert.equal(rollover.state.chainActivityDate, "2026-11-13");
assert.equal(rollover.input.value, unconfirmed, "An unconfirmed historical import is preserved across midnight");
assert.equal(rollover.store().unassigned.day.text, unconfirmed);
// Older clients auto-saved historical activity text under today without any date decision.
// Merely loading such a legacy cloud row must never count as explicit confirmation.
sql.prepare("UPDATE session_plans SET content_json = ? WHERE activity_date = ?")
  .run(JSON.stringify(makeDay("活动时间：11-09 (周一) 19:00 ~ 22:00\n1. Legacy cloud import")), "2026-11-11");
const legacy = freshToday(); await legacy.settle();
assert.equal(legacy.state.chainActivityDate, "2026-11-11");
assert.equal(legacy.api.isChainActivityDatePending(), true);
assert.equal(legacy.api.hasConfirmedChainActivityDate(), false, "Legacy auto-save is not date confirmation");
await legacy.api.extractMiniProgramRoster(); await legacy.flush();
assert.equal(legacy.state.chainActivityDate, "2026-11-09", "The original requested case must work even if the old app already auto-saved it under today");
assert.equal(row("2026-11-09").day.text, "1. Legacy cloud import");
assert.equal(row("2026-11-09").day.activityDateConfirmed, true);
console.log("Dated drafts passed: real November 9 button flow, manual-date precedence/reload, uncertain-date cancellation, historical reads/writes, rollover, overwrite confirmation, reachable offline conflicts, latest-only selection, refresh races and edit-context guards. No production writes.");