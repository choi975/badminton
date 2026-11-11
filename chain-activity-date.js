(function (root) {
  "use strict";
  const core = root.BadmintonSessionPlannerCore;
  const DAY = 86400000;
  const token = /(?<![\d:])(?:(\d{4})\s*(?:年|[-/.])\s*)?(\d{1,2})\s*(?:月|[-/.])\s*(\d{1,2})(?:\s*日)?(?![\d:])/g;
  const weekdayToken = /(?:周|星期|礼拜)\s*([一二三四五六日天1-7])/;
  const weekday = (date) => "周" + "日一二三四五六"[new Date(date + "T00:00:00Z").getUTCDay()];
  const iso = (year, month, day) => String(year).padStart(4, "0") + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
  function inferYear(month, day, referenceDate) {
    const year = Number(referenceDate.slice(0, 4));
    const candidates = [year, year - 1, year + 1].map((y) => iso(y, month, day)).filter(core.validDate);
    const distance = (date) => Math.abs(Date.parse(date + "T00:00:00Z") - Date.parse(referenceDate + "T00:00:00Z"));
    candidates.sort((a, b) => distance(a) - distance(b));
    const nearest = candidates[0];
    // Ordinary month/day dates use the reference year. Only a nearby year boundary is inferred.
    return nearest && nearest.slice(0, 4) !== String(year) && distance(nearest) <= 90 * DAY
      ? { date: nearest, inferredYear: true }
      : { date: iso(year, month, day), inferredYear: false };
  }
  function metadata(rawInput) {
    return String(rawInput || "").normalize("NFKC").replace(/\r\n?/g, "\n").split("\n")
      .map((line) => line.trim()).filter((line) => /^活动(?:时间|日期)\s*:/.test(line)).join("\n");
  }
  function parse(rawInput, { today = core.date(), referenceDate = today } = {}) {
    if (!core.validDate(referenceDate)) referenceDate = today;
    // Do not mistake prices, member grades, or arbitrary dates in the roster for the activity date.
    const activityLines = metadata(rawInput).split("\n").filter(Boolean);
    if (!activityLines.length) return { status: "missing", date: null, warnings: [], candidates: [] };
    const candidates = [], warnings = [];
    let invalid = false, inferredYear = false;
    for (const line of activityLines) {
      const content = line.replace(/^活动(?:时间|日期)\s*:\s*/, "");
      const matches = [...content.matchAll(token)];
      if (!matches.length) { invalid = true; continue; }
      const declaredWeekday = line.match(weekdayToken)?.[1];
      for (const match of matches) {
        const resolved = match[1]
          ? { date: iso(Number(match[1]), Number(match[2]), Number(match[3])), inferredYear: false }
          : inferYear(Number(match[2]), Number(match[3]), referenceDate);
        if (!core.validDate(resolved.date) || Number(resolved.date.slice(0, 4)) < 1) { invalid = true; continue; }
        candidates.push(resolved.date);
        inferredYear ||= resolved.inferredYear;
        if (declaredWeekday && matches.length === 1) {
          const expected = /[1-7]/.test(declaredWeekday) ? Number(declaredWeekday) % 7 : "日一二三四五六".indexOf(declaredWeekday === "天" ? "日" : declaredWeekday);
          if (expected !== new Date(resolved.date + "T00:00:00Z").getUTCDay()) {
            warnings.push("文本中的星期与日期不一致：" + resolved.date + " 实际是" + weekday(resolved.date));
          }
        }
      }
    }
    const dates = [...new Set(candidates)];
    if (invalid) return { status: "invalid", date: null, warnings: ["活动时间中的日期无效或不完整"], candidates: dates };
    if (dates.length !== 1) return { status: "ambiguous", date: null, warnings: ["检测到多个活动日期，请手动选择"], candidates: dates };
    if (inferredYear) warnings.unshift("文本没有年份，按临近日期推测为 " + dates[0]);
    return { status: "found", date: dates[0], needsConfirmation: warnings.length > 0,
      inferredYear, warnings: [...new Set(warnings)], candidates: dates };
  }
  root.BadmintonChainActivityDate = Object.freeze({ parse, weekday, metadata });
})(globalThis);
