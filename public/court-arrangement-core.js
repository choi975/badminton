(function attachCourtArrangementCore(root) {
  "use strict";
  const MODES = ["auto", "fixed", "roam", "competitive"];
  const COACHES = ["none", "friends", "selected", "any"];
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const positiveId = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
  const uniqueIds = (values) => [...new Set((Array.isArray(values) ? values : []).map(positiveId).filter(Boolean))];
  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
  function level(value) {
    if (value == null || value === "" || value === "不详") return null;
    const number = Number(String(value).replace(/级$/, "").trim());
    return number >= 0.5 && number <= 9 && Number.isInteger(number * 2) ? number : null;
  }
  function validDate(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  }
  function preference(value = {}) {
    return { mode: MODES.includes(value?.mode) ? value.mode : "auto", coach: COACHES.includes(value?.coach) ? value.coach : "none", targets: uniqueIds(value?.targets) };
  }
  function settings(value = {}) {
    const preferences = {};
    for (const [id, pref] of Object.entries(value?.preferences || {})) if (positiveId(id)) preferences[id] = preference(pref);
    const seen = new Set();
    const groups = (Array.isArray(value?.groups) ? value.groups : []).filter((g) => g && typeof g.id === "string" && !seen.has(g.id) && seen.add(g.id))
      .map((g) => ({ id: g.id.slice(0, 80), name: String(g.name || "小团体").trim().slice(0, 60), members: uniqueIds(g.members) }))
      .filter((g) => g.members.length >= 2 && g.members.length <= 8);
    return { version: 1, preferences, groups, excludedCandidates: [...new Set((Array.isArray(value?.excludedCandidates) ? value.excludedCandidates : []).filter((s) => typeof s === "string"))] };
  }
  function guestKey(value) {
    let a = 2166136261, b = 5381;
    for (const char of String(value)) { const code = char.codePointAt(0); a = Math.imul(a ^ code, 16777619); b = Math.imul(b, 33) ^ code; }
    return "g-" + (a >>> 0).toString(36) + "-" + (b >>> 0).toString(36);
  }
  function roster(entries = []) {
    const used = new Set(), members = new Set();
    return entries.map((entry, index) => {
      let playerId = positiveId(entry.playerId);
      if (playerId && members.has(playerId)) playerId = null;
      if (playerId) members.add(playerId);
      let key = String(entry.key || (playerId ? "p-" + playerId : "g-" + index));
      if (used.has(key)) key += "-" + index;
      used.add(key);
      return { key, playerId, ownerPlayerId: positiveId(entry.ownerPlayerId), name: String(entry.name || entry.clean || "未命名球友").trim().slice(0, 80), level: level(entry.level ?? entry.levelText) };
    });
  }
  function effective(person, config, plan) {
    const pref = preference(plan?.overrides?.[person.key] || config?.preferences?.[person.playerId] || {});
    const rank = plan?.overrides?.[person.key]?.level !== undefined ? level(plan.overrides[person.key].level) : person.level;
    const mode = pref.mode !== "auto" ? pref.mode : rank === 2 || rank === 2.5 || (rank >= 3 && pref.coach !== "none") ? "roam" : "fixed";
    return { ...pref, mode, level: rank };
  }
  function defaultCourtCount(count) { return Math.min(32, Math.max(1, Math.ceil(count / 7))); }
  function makeCourts(count) {
    return Array.from({ length: clamp(count, 1, 32) }, (_, i) => ({ id: "court-" + (i + 1), label: String(i + 1), x: 24 + (count <= 4 ? i : i % 3) * 278, y: count <= 4 ? 24 : 24 + Math.floor(i / 3) * 290 }));
  }
  function plan(value = {}) {
    const courts = Array.isArray(value.courts) && value.courts.length ? value.courts.map((c, i) => ({ id: String(c.id), label: String(c.label || i + 1), x: clamp(c.x, 0, 20000), y: clamp(c.y, 0, 20000) })) : makeCourts(1);
    const ids = new Set(courts.map((c) => c.id)), people = roster(value.roster || []), assignments = {}, overrides = {};
    for (const person of people) {
      const raw = value.assignments?.[person.key] || {};
      const courtId = ids.has(raw.courtId) ? raw.courtId : null;
      const allowed = courtId ? [courtId] : [...new Set((raw.allowed || []).filter((id) => ids.has(id)))];
      assignments[person.key] = { courtId, allowed, locked: raw.locked === true };
      if (!courtId && raw.position) assignments[person.key].position = { x: clamp(raw.position.x, 0, 20000), y: clamp(raw.position.y, 0, 20000) };
      if (value.overrides?.[person.key]) {
        overrides[person.key] = preference(value.overrides[person.key]);
        if (value.overrides[person.key].level !== undefined) overrides[person.key].level = level(value.overrides[person.key].level);
      }
    }
    return { version: 1, courts, roster: people, assignments, overrides, lineMode: value.lineMode === "selected" ? "selected" : "bundled" };
  }
  // Contiguous grade partitions favor similar levels without imposing a minimum court population.
  function partition(people, count, ranks, prefs) {
    if (!people.length) return Array.from({ length: count }, () => []);
    if (people.length < count) return Array.from({ length: count }, (_, i) => people[i] ? [people[i]] : []);
    const n = people.length, target = n / count, prefix = [0], squares = [0], fixedPrefix = [0];
    people.forEach((p) => { const r = ranks.get(p.key) ?? 2; prefix.push(prefix.at(-1) + r); squares.push(squares.at(-1) + r * r); fixedPrefix.push(fixedPrefix.at(-1) + (prefs.get(p.key).mode === "roam" ? 0 : 1)); });
    const dp = Array.from({ length: count + 1 }, () => Array(n + 1).fill(Infinity)), cuts = dp.map(() => Array(n + 1).fill(0));
    dp[0][0] = 0;
    for (let k = 1; k <= count; k++) for (let end = k; end <= n; end++) for (let start = k - 1; start < end; start++) {
      const len = end - start, sum = prefix[end] - prefix[start];
      const fixedCount = fixedPrefix[end] - fixedPrefix[start];
      const cost = dp[k - 1][start] + 3 * Math.max(0, fixedCount - 7) ** 2 + (n >= 4 * count ? 10 * Math.max(0, 4 - len) ** 2 : 0) + 4 * (squares[end] - squares[start] - sum * sum / len) + 0.25 * (len - target) ** 2;
      if (cost < dp[k][end]) { dp[k][end] = cost; cuts[k][end] = start; }
    }
    const result = []; let end = n;
    for (let k = count; k > 0; k--) { const start = cuts[k][end]; result.unshift(people.slice(start, end)); end = start; }
    return result;
  }
  function recommend(entries, config = {}, previous = null) {
    config = settings(config);
    const people = roster(entries), result = plan({ ...(previous || {}), roster: people, courts: previous?.courts || makeCourts(defaultCourtCount(people.length)) });
    const prefs = new Map(people.map((p) => [p.key, effective(p, config, result)]));
    const ranks = new Map([...prefs].map(([key, p]) => [key, p.level]));
    const sorted = [...people].sort((a, b) => (ranks.get(a.key) ?? 2) - (ranks.get(b.key) ?? 2) || a.key.localeCompare(b.key));
    const competitive = sorted.filter((p) => prefs.get(p.key).mode === "competitive" && ranks.get(p.key) >= 3);
    const rest = sorted.filter((p) => !competitive.includes(p));
    let protectedCount = competitive.length >= 6 && rest.length && result.courts.length > 1
      ? Math.min(result.courts.length - (rest.length ? 1 : 0), Math.max(1, Math.floor(competitive.length / 6))) : 0;
    while (protectedCount && people.length >= result.courts.length * 4 && people.length - protectedCount * 6 < 4) protectedCount--;
    const reserved = protectedCount ? competitive.slice(-protectedCount * 6) : [];
    const outside = sorted.filter((p) => !reserved.includes(p));
    const protectedCourts = new Set(result.courts.slice(result.courts.length - protectedCount).map((c) => c.id));
    const buckets = protectedCount
      ? [...partition(outside, result.courts.length - protectedCount, ranks, prefs), ...partition(reserved, protectedCount, ranks, prefs)]
      : partition(sorted, result.courts.length, ranks, prefs);
    const openCourts = result.courts.filter((c) => !protectedCourts.has(c.id)).map((c) => c.id);
    const targetCourts = (pref, person) => {
      if (pref.level < 3 || !["friends", "selected"].includes(pref.coach)) return openCourts;
      const targets = new Set(pref.coach === "selected" ? pref.targets : config.groups.filter((g) => g.members.includes(person.playerId)).flatMap((g) => g.members).filter((id) => id !== person.playerId));
      const matching = buckets.flatMap((bucket, index) => {
        const id = result.courts[index]?.id;
        return openCourts.includes(id) && bucket.some((p) => targets.has(p.playerId) || Math.abs((ranks.get(p.key) ?? -10) - pref.level) <= .5) ? [id] : [];
      });
      return matching.length ? matching : openCourts.slice(-1);
    };
    buckets.forEach((bucket, index) => {
      const court = result.courts[index]; if (!court) return;
      for (const person of bucket) {
        const old = result.assignments[person.key];
        if (old?.locked && (old.courtId || old.allowed.length)) continue;
        const moving = prefs.get(person.key).mode === "roam";
        result.assignments[person.key] = moving ? { courtId: null, allowed: openCourts.length ? [...targetCourts(prefs.get(person.key), person)] : [court.id], locked: false }
          : { courtId: court.id, allowed: [court.id], locked: false };
      }
    });
    const actualProtected = new Set(courtInfo(result, config).filter((c) => c.protected).map((c) => c.id));
    for (const person of people) {
      const a = result.assignments[person.key];
      if (!a.courtId && !a.locked) {
        const allowed = a.allowed.filter((id) => !actualProtected.has(id));
        a.allowed = allowed.length ? allowed : result.courts.filter((c) => !actualProtected.has(c.id)).map((c) => c.id);
        if (!a.allowed.length) a.allowed = result.courts.map((c) => c.id);
      }
    }
    return result;
  }
  function reconcile(value, entries, config) {
    const previous = plan(value), people = roster(entries), oldKeys = new Set(previous.roster.map((p) => p.key));
    const result = recommend(people, config, previous);
    for (const person of people) if (oldKeys.has(person.key)) result.assignments[person.key] = previous.assignments[person.key];
    return result;
  }
  function courtInfo(value, config = {}) {
    return value.courts.map((court) => {
      const fixed = value.roster.filter((p) => value.assignments[p.key]?.courtId === court.id);
      const moving = value.roster.filter((p) => !value.assignments[p.key]?.courtId && value.assignments[p.key]?.allowed.includes(court.id));
      const competitive = fixed.filter((p) => { const pref = effective(p, config, value); return pref.mode === "competitive" && pref.level >= 3; });
      const ranks = fixed.map((p) => effective(p, config, value).level).filter((r) => r !== null);
      return { ...court, fixed, moving, competitive, protected: competitive.length >= 6 && competitive.length === fixed.length && (value.courts.length > 1 || value.roster.length === fixed.length),
        min: ranks.length ? Math.min(...ranks) : null, max: ranks.length ? Math.max(...ranks) : null,
        height: Math.max(224, 108 + Math.ceil(fixed.length / 2) * 52) };
    });
  }
  function bundles(value) {
    const groups = new Map(), order = value.courts.map((c) => c.id);
    for (const person of value.roster) {
      const a = value.assignments[person.key]; if (a?.courtId) continue;
      const allowed = order.filter((id) => a?.allowed.includes(id)), key = allowed.join("|");
      if (!groups.has(key)) groups.set(key, { key, allowed, people: [] });
      groups.get(key).people.push(person);
    }
    return [...groups.values()];
  }
  function diagnostics(value, config = {}) {
    const messages = [], info = courtInfo(value, config);
    if (!value.roster.length) return [{ type: "info", text: "先在接龙助手中填写本次参加人员。" }];
    for (const c of info) {
      if (c.fixed.length + c.moving.length < 4) messages.push({ type: "warning", courtId: c.id, text: `${c.label}号场目前只有${c.fixed.length + c.moving.length}人可去，需要补位或调整场地数量。` });
      if (c.competitive.length && !c.protected) messages.push({ type: "info", courtId: c.id, text: `${c.label}号场的“只打高手局”人员未形成独立6人场，允许其他人员补位。` });
      if (c.protected && c.moving.length) messages.push({ type: "warning", courtId: c.id, text: `${c.label}号场已有${c.competitive.length}名只打高手局人员；手动允许了${c.moving.length}人串入，请确认对局偏好。` });
      if (c.fixed.length > 7) messages.push({ type: "info", courtId: c.id, text: `${c.label}号场固定${c.fixed.length}人，等候可能较久，可手动分流。` });
      if (c.min !== null && c.max - c.min > 1.5) messages.push({ type: "info", courtId: c.id, text: `${c.label}号场固定人员跨度${c.min}～${c.max}级，可检查是否需要分开或安排高低混搭。` });
    }
    const unknown = value.roster.filter((p) => effective(p, config, value).level === null);
    if (unknown.length) messages.push({ type: "warning", text: `${unknown.length}人等级不详，未猜测等级；可选中人名补充本次等级。` });
    const stranded = value.roster.filter((p) => !value.assignments[p.key]?.courtId && !value.assignments[p.key]?.allowed.length);
    if (stranded.length) messages.push({ type: "warning", text: `${stranded.length}名流动人员尚未选择可去场地。` });
    if (info.some((c) => !c.fixed.length && c.moving.length)) messages.push({ type: "info", text: "流动场没有固定人员，需要流动人员现场凑齐四人；连线不代表同时占用多个场地。" });
    return messages;
  }
  function relationshipGroups(config, pairs = []) {
    const manual = settings(config).groups.map((g) => ({ ...g, source: "manual" }));
    const signatures = new Set(manual.map((g) => [...g.members].sort((a, b) => a - b).join(":")));
    for (const pair of pairs) {
      const members = uniqueIds(pair.playerIds), signature = members.sort((a, b) => a - b).join(":");
      if (members.length === 2 && !signatures.has(signature)) manual.push({ id: "partner-" + signature, name: "最佳拍档", members, source: "partner" });
    }
    return manual;
  }
  // Only mutually connected pair sets are candidates. A—B—C never implies an A—C relationship.
  function groupCandidates(config, pairs = []) {
    const neighbors = new Map();
    for (const pair of pairs) { const ids = uniqueIds(pair.playerIds); if (ids.length !== 2) continue;
      for (const [a, b] of [ids, [...ids].reverse()]) { if (!neighbors.has(a)) neighbors.set(a, new Set()); neighbors.get(a).add(b); } }
    const confirmed = relationshipGroups(config, pairs).map((g) => new Set(g.members)), excluded = new Set(config.excludedCandidates || []), result = new Map();
    for (const [a, adjacent] of neighbors) for (const b of adjacent) {
      if (a >= b) continue;
      const group = [a, b];
      for (const c of [...(neighbors.get(a) || [])].sort((x, y) => x - y)) if (!group.includes(c) && group.length < 8 && group.every((id) => neighbors.get(id)?.has(c))) group.push(c);
      const key = group.sort((x, y) => x - y).join(":");
      if (group.length >= 3 && !excluded.has(key) && !confirmed.some((s) => group.every((id) => s.has(id)))) result.set(key, { key, members: group });
    }
    return [...result.values()].sort((a, b) => b.members.length - a.members.length || a.key.localeCompare(b.key))
      .filter((g, i, all) => !all.slice(0, i).some((larger) => g.members.every((id) => larger.members.includes(id)))).slice(0, 12);
  }
  function validateSettings(raw, knownIds) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || !raw.preferences || typeof raw.preferences !== "object" || Array.isArray(raw.preferences) || !Array.isArray(raw.groups) || raw.groups.length > 500) throw new Error("偏好或小团体格式无效");
    const checkIds = (ids) => Array.isArray(ids) && ids.length <= 200 && ids.every((id) => positiveId(id) && (!knownIds || knownIds.has(Number(id))));
    for (const [id, p] of Object.entries(raw.preferences)) if (!positiveId(id) || (knownIds && !knownIds.has(Number(id))) || !MODES.includes(p?.mode) || !COACHES.includes(p?.coach) || !checkIds(p.targets)) throw new Error("成员偏好无效，请重新选择成员或偏好");
    if (Object.keys(raw.preferences).length > 2000) throw new Error("偏好数量过多");
    const ids = new Set();
    for (const g of raw.groups) {
      if (typeof g.id !== "string" || !/^[\w:-]{1,80}$/.test(g.id) || ids.has(g.id) || typeof g.name !== "string" || !g.name.trim() || g.name.length > 60
        || !checkIds(g.members) || g.members.length < 2 || g.members.length > 8 || new Set(g.members.map(Number)).size !== g.members.length) throw new Error("小团体须选择2～8位不同成员，并填写名称");
      ids.add(g.id);
    }
    if (raw.excludedCandidates && (!Array.isArray(raw.excludedCandidates) || raw.excludedCandidates.length > 500 || raw.excludedCandidates.some((k) => typeof k !== "string" || k.length > 160))) throw new Error("候选关系格式无效");
    return settings(raw);
  }
  function validatePlan(raw) {
    if (!raw || !Array.isArray(raw.courts) || raw.courts.length < 1 || raw.courts.length > 32 || !Array.isArray(raw.roster) || raw.roster.length > 200) throw new Error("场地或人员数量无效");
    const ids = new Set(), labels = new Set(), keys = new Set(), players = new Set();
    const point = (p) => p && Number.isFinite(p.x) && p.x >= 0 && p.x <= 20000 && Number.isFinite(p.y) && p.y >= 0 && p.y <= 20000;
    for (const c of raw.courts) {
      if (typeof c.id !== "string" || !/^[\w-]{1,80}$/.test(c.id) || ids.has(c.id) || typeof c.label !== "string" || !c.label.trim() || c.label.length > 16 || labels.has(c.label.trim()) || !point(c)) throw new Error("场地编号须唯一且非空，位置须在画布内");
      ids.add(c.id); labels.add(c.label.trim());
    }
    for (const p of raw.roster) {
      if (typeof p.key !== "string" || !/^(?:p-\d+|g-[^\u0000-\u001f]{1,150})$/.test(p.key) || p.key.length > 160 || keys.has(p.key) || typeof p.name !== "string" || !p.name.trim() || p.name.length > 80 || (p.level !== null && level(p.level) === null)
        || (p.playerId !== null && (!positiveId(p.playerId) || players.has(p.playerId)))) throw new Error("人员名称、身份或等级无效");
      keys.add(p.key); if (p.playerId) players.add(p.playerId);
      const a = raw.assignments?.[p.key];
      if (!a || (a.courtId !== null && !ids.has(a.courtId)) || !Array.isArray(a.allowed) || a.allowed.some((id) => !ids.has(id)) || new Set(a.allowed).size !== a.allowed.length
        || (a.courtId && (a.allowed.length !== 1 || a.allowed[0] !== a.courtId)) || (!a.courtId && !a.allowed.length) || (a.position && !point(a.position))) throw new Error("每个人须有固定场地或至少一个可串场地");
      const o = raw.overrides?.[p.key];
      if (o && (!MODES.includes(o.mode) || !COACHES.includes(o.coach) || !Array.isArray(o.targets) || o.targets.length > 200 || o.targets.some((id) => !positiveId(id)) || (o.level !== undefined && o.level !== null && level(o.level) === null))) throw new Error("本次个人偏好无效");
    }
    if (Object.keys(raw.assignments || {}).some((key) => !keys.has(key)) || Object.keys(raw.overrides || {}).some((key) => !keys.has(key))) throw new Error("安排包含不在本次名单中的人员");
    return plan(raw);
  }
  root.BadmintonCourtArrangementCore = Object.freeze({ MODES, COACHES, level, validDate, preference, settings, roster, guestKey, effective, defaultCourtCount, makeCourts, plan, recommend, reconcile, courtInfo, bundles, diagnostics, relationshipGroups, groupCandidates, validateSettings, validatePlan, clone });
})(globalThis);
