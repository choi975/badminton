(function attachCalendarStatistics(root) {
  "use strict";
  const DAY_MS = 86400000;
  const WEEKDAYS = Object.freeze(["周日", "周一", "周二", "周三", "周四", "周五", "周六"]);

  function validDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + "T00:00:00Z");
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function addDays(date, days) {
    return new Date(Date.parse(date + "T00:00:00Z") + days * DAY_MS).toISOString().slice(0, 10);
  }

  function weekday(date) {
    return new Date(date + "T00:00:00Z").getUTCDay();
  }

  function today(now = new Date()) {
    // Calendar statistics use the club's Beijing date, not the browser's timezone.
    return new Date(new Date(now).getTime() + 8 * 3600000).toISOString().slice(0, 10);
  }

  function normalizeDates(dates) {
    return [...new Set((dates || []).filter(validDate))].sort();
  }

  function monthScope(year, month) {
    const index = Number(year) * 12 + Number(month) - 1;
    const normalizedYear = Math.floor(index / 12);
    if (!Number.isInteger(index) || normalizedYear < 1 || normalizedYear > 9999) throw new RangeError("Invalid calendar month");
    return { kind: "month", year: normalizedYear, month: index - normalizedYear * 12 + 1 };
  }

  function recentWeekdayDates(day, before = today(), count = 5) {
    if (!Number.isInteger(day) || day < 0 || day > 6 || !validDate(before) || !Number.isInteger(count) || count < 1) {
      throw new RangeError("Invalid weekday statistics range");
    }
    // Strictly before today: yesterday's weekday is allowed, today's is not.
    const distance = (weekday(before) - day + 7) % 7 || 7;
    const last = addDays(before, -distance);
    return Array.from({ length: count }, (_, index) => addDays(last, -7 * (count - index - 1)));
  }

  function recentWeekdayScope(day, before = today()) {
    return { kind: "weekday", mode: "recent", weekday: day, dates: recentWeekdayDates(day, before) };
  }

  function selectionScope(selectedDates, year, month) {
    const dates = normalizeDates(selectedDates);
    if (!dates.length) return monthScope(year, month);
    const day = weekday(dates[0]);
    if (dates.length > 1 && dates.every(date => weekday(date) === day)) {
      return { kind: "weekday", mode: "manual", weekday: day, dates };
    }
    return { kind: "dates", dates };
  }

  function navigate(scope, direction, before = today()) {
    if (direction !== -1 && direction !== 1) throw new RangeError("Navigation must move one period");
    if (scope.kind === "month") return monthScope(scope.year, scope.month + direction);
    if (scope.kind !== "weekday") return scope;
    const day = (scope.weekday + direction + 7) % 7;
    if (scope.mode === "recent") return recentWeekdayScope(day, before);
    // Manual selections retain their exact Monday-Sunday weeks, including gaps.
    // Sunday -> Monday wraps within those same weeks rather than moving a week.
    const offset = (day + 6) % 7 - (scope.weekday + 6) % 7;
    return { ...scope, weekday: day, dates: scope.dates.map(date => addDays(date, offset)) };
  }

  function comparisonScope(scope) {
    if (scope.kind === "month") return monthScope(scope.year, scope.month - 1);
    if (scope.kind === "weekday") {
      return { kind: "dates", dates: recentWeekdayDates(scope.weekday, scope.dates[0], scope.dates.length) };
    }
    const end = addDays(scope.dates[0], -1);
    return { kind: "range", start: addDays(end, 1 - scope.dates.length), end };
  }

  function sessionsForScope(sessions, scope) {
    if (scope.kind === "month") {
      const prefix = `${String(scope.year).padStart(4, "0")}-${String(scope.month).padStart(2, "0")}-`;
      return sessions.filter(session => session.date?.startsWith(prefix));
    }
    if (scope.kind === "range") return sessions.filter(session => session.date >= scope.start && session.date <= scope.end);
    const dates = new Set(scope.dates);
    return sessions.filter(session => dates.has(session.date));
  }

  function label(scope) {
    if (scope.kind === "month") return `${scope.month}月`;
    if (scope.kind === "weekday") return WEEKDAYS[scope.weekday];
    return `选中 ${scope.dates.length} 天`;
  }

  function describe(scope) {
    const dateLabel = date => `${Number(date.slice(0, 4))}年${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
    if (scope.kind === "month") return `${scope.year}年${scope.month}月`;
    if (scope.kind === "range") return `${dateLabel(scope.start)}～${dateLabel(scope.end)}`;
    return scope.dates.map(dateLabel).join("、");
  }

  root.BadmintonCalendarStatistics = Object.freeze({ WEEKDAYS, today, normalizeDates, monthScope,
    recentWeekdayDates, recentWeekdayScope, selectionScope, navigate, comparisonScope, sessionsForScope, label, describe });
})(globalThis);
