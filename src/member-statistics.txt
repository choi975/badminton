(function attachMemberStatistics(root) {
  "use strict";
  const DAY_MS = 86400000;
  const VERSION = "member-statistics-v4";
  const DEFINITIONS = [
    { key: "attendance15", label: "近半个月出勤率排名" },
    { key: "threeDayStreak", label: "能够连打三天的成员" },
    { key: "twoDayStreak", label: "能够连打两天的成员" },
    { key: "onlyLargeSessions", label: "只打10人以上球局的成员" },
    ...[1, 2, 3, 4, 5, 6, 0].map((day) => ({ key: `noWeekday${day}`, label: `不打周${"日一二三四五六"[day]}的成员` })),
    { key: "weeklyMax1", label: "每周最多打一局的成员" },
    { key: "weeklyMax2", label: "每周最多打两局的成员" },
    { key: "bestPartners", label: "最佳拍档" },
  ];
  // Official holiday and adjusted-workday dates; refreshed by the Worker daily.
  const BUILTIN_CALENDAR = {"knownYears":[2025,2026],"excludedDates":["2025-01-01","2025-01-26","2025-01-28","2025-01-29","2025-01-30","2025-01-31","2025-02-01","2025-02-02","2025-02-03","2025-02-04","2025-02-08","2025-04-04","2025-04-05","2025-04-06","2025-04-27","2025-05-01","2025-05-02","2025-05-03","2025-05-04","2025-05-05","2025-05-31","2025-06-01","2025-06-02","2025-09-28","2025-10-01","2025-10-02","2025-10-03","2025-10-04","2025-10-05","2025-10-06","2025-10-07","2025-10-08","2025-10-11","2026-01-01","2026-01-02","2026-01-03","2026-01-04","2026-02-14","2026-02-15","2026-02-16","2026-02-17","2026-02-18","2026-02-19","2026-02-20","2026-02-21","2026-02-22","2026-02-23","2026-02-28","2026-04-04","2026-04-05","2026-04-06","2026-05-01","2026-05-02","2026-05-03","2026-05-04","2026-05-05","2026-05-09","2026-06-19","2026-06-20","2026-06-21","2026-09-20","2026-09-25","2026-09-26","2026-09-27","2026-10-01","2026-10-02","2026-10-03","2026-10-04","2026-10-05","2026-10-06","2026-10-07","2026-10-10"],"sources":{"2025":["https://www.gov.cn/zhengce/zhengceku/202411/content_6986383.htm"],"2026":["https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm"]}};

  function validDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))
      && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
      && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  }
  function addDays(date, days) {
    return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
  }
  function beijingDate(now = new Date()) {
    const date = new Date(now);
    if (!Number.isFinite(date.getTime())) throw new Error("Invalid statistics date");
    return new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  }
  function weekday(date) { return new Date(`${date}T00:00:00Z`).getUTCDay(); }
  function weekStart(date) { return addDays(date, -((weekday(date) + 6) % 7)); }
  function normalizeCalendar(calendar) {
    return {
      knownYears: [...new Set([...BUILTIN_CALENDAR.knownYears, ...(calendar?.knownYears || [])].map(Number).filter((year) => Number.isInteger(year) && year >= 2020 && year <= 2100))],
      excludedDates: [...new Set([...BUILTIN_CALENDAR.excludedDates.filter((date) => !(calendar?.knownYears || []).map(Number).includes(Number(date.slice(0, 4)))), ...(calendar?.excludedDates || [])].filter(validDate))].sort(),
      sources: { ...BUILTIN_CALENDAR.sources, ...(calendar?.sources || {}) },
    };
  }
  function isOrdinaryDate(date, calendar) {
    const normalized = normalizeCalendar(calendar);
    return validDate(date) && normalized.knownYears.includes(Number(date.slice(0, 4))) && !normalized.excludedDates.includes(date);
  }
  function maxStreak(dates) {
    let best = 0, streak = 0, previous = "";
    for (const date of [...dates].sort()) {
      streak = previous && addDays(previous, 1) === date ? streak + 1 : 1;
      best = Math.max(best, streak);
      previous = date;
    }
    return best;
  }

  const PARTNER_POLICY = Object.freeze({
    windowDays: 90, halfLifeDays: 30, priorStrength: 4,
    minAttendanceDays: 5, minTogetherDays: 3, minAbsentDays: 3,
    minTogetherSpanDays: 7, minAdjustedLift: 0.15, minScore: 0.12,
  });
  function selfPlayerIds(session, knownIds) {
    return new Set((Array.isArray(session?.players) ? session.players : []).filter((row) => {
      const companion = row.isCompanion ?? row.is_companion;
      return ![true, 1, "1"].includes(companion)
        && Math.max(0, Number(row.slots) || 0) > Math.max(0, Number(row.plusCount ?? row.plus_count) || 0);
    }).map((row) => Number(row.playerId ?? row.player_id ?? row.ownerPlayerId ?? row.owner_player_id))
      .filter((id) => Number.isInteger(id) && id > 0 && knownIds.has(id)));
  }
  function memberStartDate(player, firstAttendance) {
    const value = String(player.createdAt ?? player.created_at ?? "");
    let registered = "";
    if (validDate(value)) registered = value;
    else if (validDate(value.slice(0, 10))) {
      const timestamp = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(value) ? value.replace(" ", "T") + "Z" : value);
      if (Number.isFinite(timestamp.getTime())) registered = beijingDate(timestamp);
    }
    // Earlier attendance is evidence of membership before a profile was registered.
    return [registered, firstAttendance].filter(Boolean).sort()[0] || null;
  }
  function tableRates(table) {
    const [both, onlyA, onlyB, neither] = table;
    const total = both + onlyA + onlyB + neither;
    return { both, onlyA, onlyB, neither, total, attendanceA: both + onlyA, attendanceB: both + onlyB };
  }
  function conditionalLift(table) {
    const t = tableRates(table), prior = PARTNER_POLICY.priorStrength;
    const baseA = t.attendanceA / t.total, baseB = t.attendanceB / t.total;
    const aWithB = (t.both + prior * baseA) / (t.attendanceB + prior);
    const aWithoutB = (t.onlyA + prior * baseA) / (t.total - t.attendanceB + prior);
    const bWithA = (t.both + prior * baseB) / (t.attendanceA + prior);
    const bWithoutA = (t.onlyB + prior * baseB) / (t.total - t.attendanceA + prior);
    return { aWithB, aWithoutB, bWithA, bWithoutA, aLift: aWithB - aWithoutB, bLift: bWithA - bWithoutA };
  }
  function adjustedLift(strata) {
    let covariance = 0, varianceA = 0, varianceB = 0;
    for (const table of strata.values()) {
      const t = tableRates(table);
      if (!t.total) continue;
      covariance += t.both - t.attendanceA * t.attendanceB / t.total;
      varianceA += t.attendanceA * (t.total - t.attendanceA) / t.total;
      varianceB += t.attendanceB * (t.total - t.attendanceB) / t.total;
    }
    // No within-stratum contrast (e.g. both always play Saturdays) is not friendship evidence.
    return { aLift: varianceB > 1e-9 ? covariance / varianceB : 0,
      bLift: varianceA > 1e-9 ? covariance / varianceA : 0 };
  }
  function buildBestPartners({ players = [], sessions = [], asOf, calendar, includeDiagnostics = false } = {}) {
    const date = validDate(asOf) ? asOf : addDays(beijingDate(), -1);
    const start90 = addDays(date, -(PARTNER_POLICY.windowDays - 1)), start30 = addDays(date, -29);
    const knownIds = new Set(players.map((p) => Number(p.id)));
    const normalizedCalendar = normalizeCalendar(calendar), excluded = new Set(normalizedCalendar.excludedDates);
    const seenSessions = new Set(), firstAttendance = new Map(), dayCounts = new Map();
    const records = [];
    for (const session of sessions) {
      if (!validDate(session?.date) || session.date > date) continue;
      if (session.id != null) {
        if (seenSessions.has(String(session.id))) continue;
        seenSessions.add(String(session.id));
      }
      const ids = selfPlayerIds(session, knownIds);
      // A saved session is an opportunity even when only guests or other members played.
      if (!Array.isArray(session.players) || !session.players.some((row) => Number(row.slots) > 0)) continue;
      for (const id of ids) if (!firstAttendance.has(id) || session.date < firstAttendance.get(id)) firstAttendance.set(id, session.date);
      if (session.date < start90) continue;
      const age = (Date.parse(date) - Date.parse(session.date)) / DAY_MS;
      records.push({ date: session.date, ids, age,
        weekday: excluded.has(session.date) ? "holiday" : weekday(session.date),
        period: Math.floor(age / 30) });
      dayCounts.set(session.date, (dayCounts.get(session.date) || 0) + 1);
    }
    // Stable summation and sorting make browser, Worker and snapshot results identical.
    records.sort((a, b) => a.date.localeCompare(b.date)
      || [...a.ids].sort((x, y) => x - y).join(",").localeCompare([...b.ids].sort((x, y) => x - y).join(",")));
    for (const row of records) row.weight = 0.5 ** (row.age / PARTNER_POLICY.halfLifeDays) / dayCounts.get(row.date);
    const members = players.map((player) => {
      const id = Number(player.id), attendance = records.filter((r) => r.ids.has(id));
      return { id, name: String(player.name || "").split(/[,，]/)[0].trim(),
        start: memberStartDate(player, firstAttendance.get(id)),
        days: new Set(attendance.map((r) => r.date)), active: attendance.some((r) => r.date >= start30) };
    }).filter((p) => p.start && p.active && p.days.size >= PARTNER_POLICY.minAttendanceDays)
      .sort((a, b) => a.id - b.id);
    const pairs = [], diagnostics = [];
    for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) {
      const a = members[i], b = members[j], pairStart = [start90, a.start, b.start].sort().at(-1);
      const raw = [0, 0, 0, 0], weighted = [0, 0, 0, 0];
      const weekdays = new Map(), periods = new Map();
      const aDays = new Set(), bDays = new Set(), togetherDays = new Set(), opportunityDays = new Set();
      for (const row of records) {
        if (row.date < pairStart) continue;
        const hasA = row.ids.has(a.id), hasB = row.ids.has(b.id);
        const cell = hasA ? (hasB ? 0 : 1) : (hasB ? 2 : 3);
        raw[cell]++; weighted[cell] += row.weight;
        opportunityDays.add(row.date);
        if (hasA) aDays.add(row.date);
        if (hasB) bDays.add(row.date);
        if (hasA && hasB) togetherDays.add(row.date);
        for (const [strata, key] of [[weekdays, row.weekday], [periods, row.period]]) {
          if (!strata.has(key)) strata.set(key, [0, 0, 0, 0]);
          strata.get(key)[cell] += row.weight;
        }
      }
      if (!raw.some(Boolean)) continue;
      const rawRates = tableRates(raw), conditional = conditionalLift(weighted);
      const weekdayAdjusted = adjustedLift(weekdays), periodAdjusted = adjustedLift(periods);
      const aLift = Math.min(conditional.aLift, weekdayAdjusted.aLift, periodAdjusted.aLift);
      const bLift = Math.min(conditional.bLift, weekdayAdjusted.bLift, periodAdjusted.bLift);
      const absentA = opportunityDays.size - aDays.size, absentB = opportunityDays.size - bDays.size;
      const together = [...togetherDays].sort();
      const span = together.length ? (Date.parse(together.at(-1)) - Date.parse(together[0])) / DAY_MS : 0;
      const reliability = together.length / (together.length + 5) * Math.min(1, Math.min(absentA, absentB) / 5);
      const score = Math.max(0, Math.min(aLift, bLift)) * reliability;
      const reasons = [];
      if (Math.min(aDays.size, bDays.size) < PARTNER_POLICY.minAttendanceDays) reasons.push("出勤样本不足");
      if (together.length < PARTNER_POLICY.minTogetherDays) reasons.push("共同出勤样本不足");
      if (Math.min(absentA, absentB) < PARTNER_POLICY.minAbsentDays) reasons.push("缺少对方未参加的对照");
      if (span < PARTNER_POLICY.minTogetherSpanDays) reasons.push("共同记录跨度不足");
      if (aLift < PARTNER_POLICY.minAdjustedLift || bLift < PARTNER_POLICY.minAdjustedLift) reasons.push("校正后双向关联不足");
      if (score < PARTNER_POLICY.minScore) reasons.push("综合证据不足");
      const round = (n) => Math.round(n * 1e6) / 1e6;
      const pair = {
        playerIds: [a.id, b.id], names: [a.name, b.name], start: pairStart, end: date,
        togetherSessions: rawRates.both, togetherDays: together.length,
        attendanceDays: [aDays.size, bDays.size], opportunityDays: opportunityDays.size,
        raw: rawRates,
        directions: [
          { playerId: a.id, partnerId: b.id, withPartner: { attended: rawRates.both, opportunities: rawRates.attendanceB },
            withoutPartner: { attended: rawRates.onlyA, opportunities: rawRates.total - rawRates.attendanceB }, adjustedLift: round(aLift) },
          { playerId: b.id, partnerId: a.id, withPartner: { attended: rawRates.both, opportunities: rawRates.attendanceA },
            withoutPartner: { attended: rawRates.onlyB, opportunities: rawRates.total - rawRates.attendanceA }, adjustedLift: round(bLift) },
        ], score: round(score), reliability: round(reliability),
      };
      if (!reasons.length) pairs.push(pair);
      if (includeDiagnostics) diagnostics.push({ ...pair, qualified: !reasons.length, reasons,
        conditional, weekdayAdjusted, periodAdjusted });
    }
    pairs.sort((a, b) => b.score - a.score || b.togetherDays - a.togetherDays || a.playerIds[0] - b.playerIds[0] || a.playerIds[1] - b.playerIds[1]);
    return { version: "best-partners-v1", start: start90, end: date, policy: PARTNER_POLICY, pairs,
      ...(includeDiagnostics ? { diagnostics } : {}) };
  }

  function build({ players = [], sessions = [], now = new Date(), asOf, calendar } = {}) {
    const date = validDate(asOf) ? asOf : addDays(beijingDate(now), -1);
    const start60 = addDays(date, -59), start30 = addDays(date, -29), start15 = addDays(date, -14);
    const holidayCalendar = normalizeCalendar(calendar);
    const excluded = new Set(holidayCalendar.excludedDates);
    const missingYears = new Set();
    const ordinaryDays = Array(7).fill(0);
    for (let day = start30; day <= date; day = addDays(day, 1)) {
      if (!holidayCalendar.knownYears.includes(Number(day.slice(0, 4)))) missingYears.add(Number(day.slice(0, 4)));
      else if (!excluded.has(day)) ordinaryDays[weekday(day)] += 1;
    }
    const allMembers = new Map(players.map((player) => [Number(player.id), {
      playerId: Number(player.id), name: String(player.name || "").split(/[,，]/)[0].trim(),
      attendance15: 0, attendance30: 0, attendance60: 0, dates60: new Set(),
      weekdays30: new Set(), weeklyCounts30: {}, allLarge: true,
    }]));
    const seenSessions = new Set();
    for (const session of sessions) {
      if (!validDate(session?.date) || session.date < start60 || session.date > date) continue;
      // Different sessions on one day are distinct signups; a duplicate API row is not.
      if (session.id != null) {
        if (seenSessions.has(String(session.id))) continue;
        seenSessions.add(String(session.id));
      }
      const rows = Array.isArray(session.players) ? session.players : [];
      const size = rows.reduce((sum, row) => sum + Math.max(0, Number(row.slots) || 0), 0);
      const ids = new Set();
      for (const row of rows) {
        const companion = row.isCompanion ?? row.is_companion;
        if (companion === true || companion === 1 || companion === "1") continue;
        if (Math.max(0, Number(row.slots) || 0) <= Math.max(0, Number(row.plusCount ?? row.plus_count) || 0)) continue;
        const id = Number(row.playerId ?? row.player_id ?? row.ownerPlayerId ?? row.owner_player_id);
        if (allMembers.has(id)) ids.add(id);
      }
      for (const id of ids) {
        const member = allMembers.get(id);
        member.attendance60 += 1;
        member.dates60.add(session.date);
        member.allLarge &&= size > 10;
        if (session.date >= start15) member.attendance15 += 1;
        if (session.date >= start30) {
          member.attendance30 += 1;
          const week = weekStart(session.date);
          member.weeklyCounts30[week] = (member.weeklyCounts30[week] || 0) + 1;
          if (!excluded.has(session.date) && holidayCalendar.knownYears.includes(Number(session.date.slice(0, 4)))) member.weekdays30.add(weekday(session.date));
        }
      }
    }
    const members = [...allMembers.values()].filter((member) => member.attendance60 > 0).map((member) => {
      const streak60 = maxStreak(member.dates60);
      const maxWeekly30 = Math.max(0, ...Object.values(member.weeklyCounts30));
      return {
        ...member, dates60: [...member.dates60].sort(), weekdays30: [...member.weekdays30].sort(),
        streak60, maxWeekly30, weeklyLimit: [1, 2].includes(maxWeekly30) ? maxWeekly30 : null,
        onlyLargeSessions: member.allLarge,
        noPlayWeekdays: missingYears.size ? [] : [0, 1, 2, 3, 4, 5, 6].filter((day) => ordinaryDays[day] > 0 && !member.weekdays30.has(day)),
      };
    }).sort((a, b) => b.attendance15 - a.attendance15 || a.name.localeCompare(b.name, "zh-CN") || a.playerId - b.playerId);
    let rank = 0;
    members.forEach((member, index) => {
      if (!index || member.attendance15 !== members[index - 1].attendance15) rank = index + 1;
      member.rank15 = rank;
    });
    const attendanceCutoff = Math.max(1, members[9]?.attendance15 || 0);
    const bestPartners = buildBestPartners({ players, sessions, asOf: date, calendar: holidayCalendar });
    const partnerIds = new Set(bestPartners.pairs.flatMap((pair) => pair.playerIds));
    const matching = (key, member) => {
      if (key === "attendance15") return member.attendance15 >= attendanceCutoff;
      if (key === "bestPartners") return partnerIds.has(member.playerId);
      if (key === "threeDayStreak") return member.streak60 >= 3;
      if (key === "twoDayStreak") return member.streak60 === 2;
      if (member.attendance30 < 2) return false;
      if (key === "onlyLargeSessions") return member.onlyLargeSessions;
      if (key.startsWith("noWeekday")) return member.noPlayWeekdays.includes(Number(key.slice(9)));
      return member.maxWeekly30 === Number(key.slice(-1));
    };
    return {
      version: VERSION, asOf: date, generatedAt: new Date(now).toISOString(),
      windows: { start15, start30, start60, end: date }, activeMemberCount: members.length,
      calendar: holidayCalendar, missingCalendarYears: [...missingYears], members, bestPartners,
      lists: DEFINITIONS.map((definition) => ({ ...definition, memberIds: members.filter((member) => matching(definition.key, member)).map((member) => member.playerId) })),
    };
  }

  function recommendationTags({ statistics, playerId, targetDate, currentCount = 0 } = {}) {
    const member = statistics?.members?.find((row) => row.playerId === Number(playerId));
    const reasons = [], risks = [];
    if (!member || !validDate(targetDate)) return { reasons, risks };
    const inList = (key) => statistics.lists?.find((list) => list.key === key)?.memberIds.includes(member.playerId);
    // A single day cannot establish a frequent-playing habit, even if it has multiple bookings.
    const recentDays = member.dates60.filter((date) => date >= statistics.windows.start15);
    if (inList("attendance15") && recentDays.length >= 2) reasons.push("近期常打");
    const day = weekday(targetDate);
    if (isOrdinaryDate(targetDate, statistics.calendar) && inList(`noWeekday${day}`)) {
      risks.push(`周${"日一二三四五六"[day]}可能无法打球`);
    }
    const limit = inList("weeklyMax1") ? 1 : inList("weeklyMax2") ? 2 : null;
    if (limit !== null && (member.weeklyCounts30[weekStart(targetDate)] || 0) >= limit) {
      risks.push(`每周可能最多打${limit}局`);
    }
    if (inList("onlyLargeSessions") && Number(currentCount) <= 10) risks.push("可能不喜欢人少的局");
    return { reasons, risks };
  }

  root.BadmintonMemberStatistics = Object.freeze({ VERSION, DEFINITIONS, PARTNER_POLICY, build, buildBestPartners, recommendationTags, validDate, beijingDate, addDays, weekStart, normalizeCalendar, isOrdinaryDate });
})(globalThis);
