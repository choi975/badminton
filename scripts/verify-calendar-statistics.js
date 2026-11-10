import assert from "node:assert/strict";
import "../calendar-statistics.js";

const core = globalThis.BadmintonCalendarStatistics;
const today = "2026-11-10";
const mondayDates = ["2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09"];
const tuesdayDates = ["2026-10-06", "2026-10-13", "2026-10-20", "2026-10-27", "2026-11-03"];
assert.deepEqual(core.recentWeekdayDates(1, today), mondayDates);
assert.deepEqual(core.recentWeekdayDates(2, today), tuesdayDates);
assert.deepEqual(core.recentWeekdayDates(3, today), ["2026-10-07", "2026-10-14", "2026-10-21", "2026-10-28", "2026-11-04"]);
assert.equal(core.today("2026-11-09T15:59:59Z"), "2026-11-09");
assert.equal(core.today("2026-11-09T16:00:00Z"), today, "Beijing midnight determines today's exclusion");
assert.equal(core.today("2026-11-10T07:00:00-08:00"), today, "browser timezone does not change club dates");
for (let day = 0; day < 7; day++) {
  for (const date of [today, "2026-11-09", "2026-11-15", "2026-11-16", "2027-01-01", "2028-03-01"]) {
    const dates = core.recentWeekdayDates(day, date);
    assert.equal(dates.length, 5);
    assert.equal(new Set(dates).size, 5);
    assert.ok(dates.every(value => value < date && new Date(value + "T00:00:00Z").getUTCDay() === day));
    assert.deepEqual(dates, [...dates].sort());
    assert.ok(dates.every((value, index) => !index || Date.parse(value) - Date.parse(dates[index - 1]) === 7 * 86400000));
  }
}
assert.equal(core.recentWeekdayDates(3, "2026-11-11").at(-1), "2026-11-04");
assert.equal(core.recentWeekdayDates(3, "2026-11-12").at(-1), "2026-11-11", "completed days this week become eligible the next day");
assert.equal(core.recentWeekdayDates(2, "2026-11-11").at(-1), today);

const recentMonday = core.recentWeekdayScope(1, today);
const recentTuesday = core.navigate(recentMonday, 1, today);
assert.deepEqual(recentTuesday.dates, tuesdayDates, "recent-mode navigation recomputes before-today dates, not Monday + one day");
assert.deepEqual(core.navigate(recentTuesday, -1, today), recentMonday);
assert.equal(core.navigate(recentMonday, -1, today).weekday, 0);
assert.equal(core.navigate(core.recentWeekdayScope(0, today), 1, today).weekday, 1);
assert.deepEqual(core.comparisonScope(recentMonday).dates, ["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05"]);
assert.deepEqual(core.comparisonScope(recentTuesday).dates, ["2026-09-01", "2026-09-08", "2026-09-15", "2026-09-22", "2026-09-29"]);

const selected = ["2026-11-04", "2026-10-21", "2026-10-28", "2026-10-21"];
const manual = core.selectionScope(selected, 2026, 11);
assert.deepEqual(manual, { kind: "weekday", mode: "manual", weekday: 3, dates: ["2026-10-21", "2026-10-28", "2026-11-04"] });
assert.deepEqual(selected, ["2026-11-04", "2026-10-21", "2026-10-28", "2026-10-21"], "normalizing does not mutate calendar selection");
assert.deepEqual(core.navigate(manual, 1, today).dates, ["2026-10-22", "2026-10-29", "2026-11-05"]);
assert.deepEqual(core.navigate(manual, -1, today).dates, ["2026-10-20", "2026-10-27", "2026-11-03"]);
assert.deepEqual(core.comparisonScope(manual).dates, ["2026-09-30", "2026-10-07", "2026-10-14"]);
const gapped = core.selectionScope(["2026-10-14", "2026-11-04"], 2026, 11);
assert.deepEqual(core.navigate(gapped, 1, today).dates, ["2026-10-15", "2026-11-05"], "nonconsecutive weeks remain nonconsecutive");
const sunday = core.selectionScope(["2026-11-01", "2026-11-15"], 2026, 11);
assert.deepEqual(core.navigate(sunday, 1, today).dates, ["2026-10-26", "2026-11-09"], "weekday wrap retains the selected weeks");
assert.deepEqual(core.navigate(core.navigate(sunday, 1, today), -1, today), sunday, "manual future selections are retained on round-trip");
let roundTrip = manual;
for (let index = 0; index < 7; index++) roundTrip = core.navigate(roundTrip, 1, today);
assert.deepEqual(roundTrip, manual);
const mixed = core.selectionScope(["2026-11-04", "2026-11-05"], 2026, 11);
assert.equal(mixed.kind, "dates");
assert.equal(core.navigate(mixed, 1, today), mixed, "arbitrary selections have no implied period navigation");
assert.deepEqual(core.comparisonScope(mixed), { kind: "range", start: "2026-11-02", end: "2026-11-03" });
assert.equal(core.selectionScope(["2026-11-04"], 2026, 11).kind, "dates", "single-day selection stays in the daily-record flow");
const month = core.selectionScope([], 2026, 11);
assert.deepEqual(month, { kind: "month", year: 2026, month: 11 });
assert.deepEqual(core.comparisonScope(month), { kind: "month", year: 2026, month: 10 });
assert.deepEqual(core.navigate(core.monthScope(2026, 12), 1), { kind: "month", year: 2027, month: 1 });
assert.deepEqual(core.navigate(core.monthScope(2026, 1), -1), { kind: "month", year: 2025, month: 12 });
assert.deepEqual(core.normalizeDates(["2026-02-29", "2028-02-29", "invalid", "2028-02-29"]), ["2028-02-29"]);
assert.throws(() => core.recentWeekdayDates(7, today), RangeError);

const sessions = [
  ...mondayDates.map((date, index) => ({ id: index + 1, date })),
  { id: 6, date: "2026-11-09" }, { id: 7, date: today }, { id: 8, date: "2026-11-16" },
  { id: 9, date: "2026-09-07" }, { id: 10, date: "2026-09-08" }, { id: 11, date: "2026-10-05" },
  { id: 12, date: "2028-02-29" },
];
const before = structuredClone(sessions);
assert.deepEqual(core.sessionsForScope(sessions, recentMonday).map(s => s.id), [1, 2, 3, 4, 5, 6], "count all sessions on selected dates, including holidays and same-day games");
assert.deepEqual(core.sessionsForScope(sessions, core.comparisonScope(recentMonday)).map(s => s.id), [9, 11], "same-weekday comparison excludes intervening dates");
assert.deepEqual(core.sessionsForScope(sessions, month).map(s => s.id), [4, 5, 6, 7, 8], "monthly views retain existing full-month semantics");
assert.deepEqual(core.sessionsForScope(sessions, core.monthScope(2028, 2)).map(s => s.id), [12]);
assert.deepEqual(sessions, before);
assert.equal(core.label(month), "11月");
assert.equal(core.label(manual), "周三");
assert.equal(core.describe(core.monthScope(2025, 12)), "2025年12月");
assert.ok(core.describe(manual).includes("2026年10月21日"));
console.log("Calendar statistics core passed: latest five strictly past weekdays, Beijing midnight, manual-week preservation, month/year wrap, same-weekday comparison, gaps, duplicates, holidays, and read-only filtering.");

// Exercise the real modal controller and aggregation, not only the date helper.
const { paymentHtml: html, loadPaymentFunctions } = await import("./payment-test-helpers.js");
const element = () => ({ textContent: "", title: "", hidden: false, attrs: {}, scrollTop: 70,
  setAttribute(key, value) { this.attrs[key] = String(value); } });
const els = Object.fromEntries(["calendarDetailTitle", "calendarDetailPeriodLabel", "calendarDetailPrevBtn",
  "calendarDetailNextBtn", "calendarDetailTableWrap"].map(key => [key, element()]));
const state = { calendar: { year: 2026, month: 11, selectedDates: [...manual.dates], anchorDate: manual.dates[0] },
  players: [{ id: 1, name: "成员A" }],
  sessions: sessions.map(session => ({ ...session, players: [{ ownerPlayerId: 1, ownerPresent: true, guestCount: 0, amount: 10 }] })),
  calendarDetailScope: null, calendarDetailEntries: [], calendarDetailSort: { key: "playCount", dir: "asc" },
  calendarDetailColumnOrder: ["weekdays", "name", "playCount"] };
const untouchedCalendar = structuredClone(state.calendar), untouchedSessions = structuredClone(state.sessions);
const fixedClock = { ...core, recentWeekdayScope: day => core.recentWeekdayScope(day, today), navigate: (scope, direction) => core.navigate(scope, direction, today) };
let opens = 0, renders = 0;
const ui = loadPaymentFunctions(["openCalendarMonthDetail", "openCalendarWeekdayDetail", "openCalendarDetailModal",
  "shiftCalendarDetail", "renderCalendarDetailPeriod", "renderCalendarDetailStatistics",
  "getMemberDetailStatsMap", "getMemberStatsMapForSessions", "parseLocalDate"], {
  state, els, CalendarStatistics: fixedClock, projectSessionParticipants: rows => rows,
  globalThis: { BadmintonMemberStatistics: { partnerIdsMap: () => new Map() } },
  getMemberStatistics: () => ({}), getBestPartnerIdsMap: () => new Map(), firstName: name => name,
  collator: new Intl.Collator("zh-CN"), renderCalendarDetailTable: () => { renders++; },
  openModal: id => { assert.equal(id, "calendarDetailModal"); opens++; },
});
ui.openCalendarMonthDetail();
assert.equal(els.calendarDetailPeriodLabel.textContent, "11月");
assert.equal(state.calendarDetailEntries[0].playCount, 5, "month shortcut ignores a previous manual selection");
assert.equal(state.calendarDetailEntries[0].previousPlayCount, 4);
assert.ok(els.calendarDetailPeriodLabel.title.includes("2026年11月") && els.calendarDetailPeriodLabel.title.includes("2026年10月"));
assert.equal(els.calendarDetailPrevBtn.attrs["aria-label"], "上个月：2026年10月");
assert.equal(els.calendarDetailNextBtn.attrs["aria-label"], "下个月：2026年12月");
ui.shiftCalendarDetail(1);
assert.equal(els.calendarDetailPeriodLabel.textContent, "12月");
assert.equal(state.calendarDetailEntries.length, 0, "empty periods remain navigable");
assert.ok(!els.calendarDetailPrevBtn.hidden && !els.calendarDetailNextBtn.hidden);
ui.shiftCalendarDetail(1);
assert.equal(els.calendarDetailPeriodLabel.textContent, "1月");
assert.ok(els.calendarDetailPeriodLabel.title.includes("2027年1月"));
assert.equal(opens, 1, "navigation rerenders without reopening or resetting modal focus");
ui.openCalendarWeekdayDetail(1);
assert.equal(els.calendarDetailPeriodLabel.textContent, "周一");
assert.deepEqual(state.calendarDetailSessions.map(session => session.id), [1, 2, 3, 4, 5, 6]);
assert.equal(state.calendarDetailEntries[0].playCount, 6);
assert.equal(state.calendarDetailEntries[0].previousPlayCount, 2, "previous counts come only from the previous five Mondays");
assert.deepEqual(Object.values(state.calendarDetailEntries[0].weekdays), [0, 6, 0, 0, 0, 0, 0]);
ui.shiftCalendarDetail(1);
assert.deepEqual(state.calendarDetailScope.dates, tuesdayDates);
assert.equal(els.calendarDetailPeriodLabel.textContent, "周二");
assert.equal(state.calendarDetailSessions.length, 0, "today's Tuesday record is excluded");
ui.openCalendarDetailModal([], "选中 3 天");
assert.equal(els.calendarDetailPeriodLabel.textContent, "周三");
assert.deepEqual(state.calendarDetailScope.dates, manual.dates);
ui.shiftCalendarDetail(1);
assert.deepEqual(state.calendarDetailScope.dates, ["2026-10-22", "2026-10-29", "2026-11-05"]);
assert.deepEqual(state.calendar, untouchedCalendar, "no shortcut or detail navigation changes the calendar selection");
assert.deepEqual(state.sessions, untouchedSessions, "statistics never mutate saved bookings");
assert.deepEqual(state.calendarDetailSort, { key: "playCount", dir: "asc" });
assert.deepEqual(state.calendarDetailColumnOrder, ["weekdays", "name", "playCount"]);
assert.equal(els.calendarDetailTableWrap.scrollTop, 0);
ui.openCalendarDetailModal([], "", mixed);
assert.equal(els.calendarDetailPeriodLabel.textContent, "选中 2 天");
assert.ok(els.calendarDetailPrevBtn.hidden && els.calendarDetailNextBtn.hidden);
assert.ok(renders >= 7);

assert.match(html, /<button id="calendarMonthLabel"[^>]*type="button"[^>]*aria-haspopup="dialog"/);
assert.match(html, /id="calendarWeekdayRow"[^>]*role="group"/);
assert.equal((html.match(/<button type="button" data-weekday="[0-6]"/g) || []).length, 7);
assert.doesNotMatch(html, /查看订场记录与成员出勤|上下滚动连续查看日期|上下滑动连续查看 · 点按日期/);
assert.doesNotMatch(html, /calendar-weekday-row" aria-hidden/);
assert.match(html, /els\.calendarMonthLabel\.addEventListener\("click", openCalendarMonthDetail\)/);
assert.match(html, /els\.calendarDetailPrevBtn\.addEventListener\("click", \(\) => shiftCalendarDetail\(-1\)\)/);
assert.match(html, /els\.calendarDetailNextBtn\.addEventListener\("click", \(\) => shiftCalendarDetail\(1\)\)/);
assert.match(html, /navSubtitle\.hidden = !subtitle/);
assert.match(html, /class="calendar-detail-period" role="status" aria-live="polite"/);
assert.match(html, /\.calendar-detail-nav\[hidden\] \{ display: none; \}/);
console.log("Calendar statistics UI passed: period/weekday shortcuts, sparse/manual selection, comparison rows, independent state, concise accessible labels, empty navigation, and preserved sorting.");

// Month shortcut must not pick an intermediate month during smooth scrolling.
const scrollState = { calendar: { scrollTargetMonth: { year: 2026, month: 11 }, monthScrollTimer: 0 } };
let nextTimer = 0, settled = 0;
const callbacks = new Map(), cancelled = [];
const settleUi = loadPaymentFunctions(["scheduleCalendarMonthScrollEnd"], { state: scrollState,
  setTimeout(callback, delay) { assert.equal(delay, 160); callbacks.set(++nextTimer, callback); return nextTimer; },
  clearTimeout(timer) { cancelled.push(timer); }, syncCalendarMonthFromViewport() { settled++; } });
settleUi.scheduleCalendarMonthScrollEnd();
settleUi.scheduleCalendarMonthScrollEnd();
assert.deepEqual(cancelled, [1], "each scroll event renews the settling timer");
callbacks.get(2)();
assert.equal(scrollState.calendar.scrollTargetMonth, null);
assert.equal(scrollState.calendar.monthScrollTimer, 0);
assert.equal(settled, 1);
const lockedUi = loadPaymentFunctions(["syncCalendarMonthFromViewport"], {
  state: { calendar: { scrollTargetMonth: { year: 2026, month: 11 } } },
  els: { calendarScroll: { getBoundingClientRect() { throw new Error("intermediate viewport must not replace the chosen month"); } } },
});
lockedUi.syncCalendarMonthFromViewport();
console.log("Calendar month shortcut stays stable during programmatic smooth scrolling.");
