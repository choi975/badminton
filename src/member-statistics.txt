(function attachMemberStatistics(root) {
  "use strict";
  const DAY_MS = 86400000;
  const VERSION = "member-statistics-v1";
  const DEFINITIONS = [
    { key: "attendance15", label: "近半个月出勤率排名" },
    { key: "threeDayStreak", label: "能够连打三天的成员" },
    { key: "twoDayStreak", label: "能够连打两天的成员" },
    { key: "onlyLargeSessions", label: "只打10人以上球局的成员" },
    ...[1, 2, 3, 4, 5, 6, 0].map((day) => ({ key: `noWeekday${day}`, label: `不打周${"日一二三四五六"[day]}的成员` })),
    { key: "weeklyMax1", label: "每周最多打一局的成员" },
    { key: "weeklyMax2", label: "每周最多打两局的成员" },
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
    const matching = (key, member) => {
      if (key === "attendance15") return true;
      if (key === "threeDayStreak") return member.streak60 >= 3;
      if (key === "twoDayStreak") return member.streak60 === 2;
      if (key === "onlyLargeSessions") return member.onlyLargeSessions;
      if (key.startsWith("noWeekday")) return member.noPlayWeekdays.includes(Number(key.slice(9)));
      return member.maxWeekly30 === Number(key.slice(-1));
    };
    return {
      version: VERSION, asOf: date, generatedAt: new Date(now).toISOString(),
      windows: { start15, start30, start60, end: date }, activeMemberCount: members.length,
      calendar: holidayCalendar, missingCalendarYears: [...missingYears], members,
      lists: DEFINITIONS.map((definition) => ({ ...definition, memberIds: members.filter((member) => matching(definition.key, member)).map((member) => member.playerId) })),
    };
  }
  root.BadmintonMemberStatistics = Object.freeze({ VERSION, DEFINITIONS, build, validDate, beijingDate, addDays, weekStart, normalizeCalendar, isOrdinaryDate });
})(globalThis);
