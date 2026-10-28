(function (root) {
  "use strict";
  const DAY = 86400000;
  const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "") && Number.isFinite(Date.parse(s + "T00:00:00Z")) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
  const date = (now = new Date()) => new Date(new Date(now).getTime() + 8 * 3600000).toISOString().slice(0, 10);
  const addDays = (s, n) => new Date(Date.parse(s + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
  const dates = (today = date()) => Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const label = (s, today = date()) => s === today ? "今天" : "周" + "日一二三四五六"[new Date(s + "T00:00:00Z").getUTCDay()];
  function normalizeDay(raw = {}) {
    return { text: String(raw.text || "").slice(0, 20000),
      plusOverrides: raw.plusOverrides && typeof raw.plusOverrides === "object" && !Array.isArray(raw.plusOverrides) ? raw.plusOverrides : {},
      slots: Array.from({ length: 10 }, (_, i) => String(raw.slots?.[i] || "").trim().slice(0, 100)) };
  }
  const equal = (a, b) => JSON.stringify(normalizeDay(a)) === JSON.stringify(normalizeDay(b));
  function entries(slots, players = []) {
    const seen = new Set();
    return slots.filter(Boolean).map((name) => {
      const matches = players.filter((p) => String(p.name).split(/[、,，;；/|\n]+/).some((alias) => alias.trim().toLowerCase() === name.trim().toLowerCase()));
      const player = matches.length === 1 ? matches[0] : null, id = Number(player?.id) || null;
      const companion = id !== null && seen.has(id); if (id) seen.add(id);
      return { clean: name, playerId: companion ? null : id, ownerPlayerId: id, isCompanion: companion, slots: 1, levelText: player?.level || "不详" };
    });
  }
  function recentMembers(players, sessions, today = date()) {
    const start = addDays(today, -15), counts = new Map();
    // Count real self attendance per session; guests and future plans are never training evidence.
    for (const session of sessions || []) {
      if (session.date < start || session.date >= today) continue;
      const ids = new Set((session.players || []).filter((p) => ![true, 1, "1"].includes(p.isCompanion ?? p.is_companion)
        && Number(p.slots ?? 1) > Number(p.plusCount ?? p.plus_count ?? 0))
        .map((p) => Number(p.playerId ?? p.player_id ?? p.ownerPlayerId ?? p.owner_player_id)).filter(Boolean));
      for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1);
    }
    return players.filter((p) => counts.has(Number(p.id))).map((p) => ({ ...p, attendance15: counts.get(Number(p.id)) }))
      .sort((a, b) => b.attendance15 - a.attendance15 || a.name.localeCompare(b.name, "zh-CN"));
  }
  root.BadmintonSessionPlannerCore = Object.freeze({ validDate, date, addDays, dates, label, normalizeDay, equal, entries, recentMembers });
})(globalThis);
