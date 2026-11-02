(function attachBadmintonRosterReview(root) {
  "use strict";

  const ranks = Object.freeze(Array.from({ length: 18 }, (_, index) => (index + 1) / 2));
  const levels = Object.freeze(["不详", ...ranks.map(rank => rank + "级")]);
  const normalizeName = value => String(value || "").normalize("NFKC").toLowerCase().replace(/\s+/g, "");
  const splitAliases = value => String(value || "").split(/[,，]/).map(name => name.trim()).filter(Boolean);
  const removeAnnotations = value => String(value || "").replace(/\([^)]*\)|（[^）]*）/g, " ");

  function normalizeLevel(value) {
    const text = String(value ?? "").normalize("NFKC").trim().replace(/\s*级$/, "");
    if (!text || text === "不详" || text === "等级不详") return "不详";
    if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
    const integer = Number(text.split(".")[0]);
    // Use the decimal text rather than subtracting floats at the .3 / .8 boundaries.
    const fraction = Number("0." + (text.split(".")[1] || "0"));
    const rank = integer + (fraction >= 0.8 ? 1 : fraction >= 0.3 ? 0.5 : 0);
    return ranks.includes(rank) ? rank + "级" : null;
  }

  function parseLevelPrefix(value) {
    const match = String(value || "").match(/^\s*[【[]\s*(\d+(?:\.\d+)?\s*级?|等级不详|不详)\s*[】\]]\s*(.+?)\s*$/);
    if (!match) return null;
    const rawLevel = match[1].trim();
    const normalizedLevel = normalizeLevel(rawLevel);
    return { name: match[2], level: /级$/.test(rawLevel) || /不详$/.test(rawLevel) ? rawLevel : rawLevel + "级", rawLevel, normalizedLevel };
  }

  function findPlayerMatch(value, aliasIndex) {
    const original = normalizeName(value);
    const candidate = normalizeName(removeAnnotations(value).replace(/[🌸🍀]/g, ""));
    const exact = aliasIndex.filter(item => [original, candidate].includes(item.normalized));
    const matches = exact.length ? exact : aliasIndex.filter(item => {
      const alias = normalizeName(removeAnnotations(item.alias).replace(/[🌸🍀]/g, ""));
      if (!alias) return false;
      const offset = candidate.indexOf(alias);
      if (offset < 0) return false;
      const before = candidate.slice(0, offset);
      const after = candidate.slice(offset + alias.length);
      // Never recognize "oi" inside an unregistered "choi", or split a real Hx7 / 1fan.
      if (/[\p{L}\p{N}]/u.test(before)) return false;
      return !/[\p{L}\p{N}]/u.test(after)
        || /^\d+$/.test(after)
        || /^(?:[+＋➕]|代|加)(?:\d+|[零〇一二两三四五六七八九十百千万]+)/.test(after);
    });
    if (!matches.length) return { player: null, ambiguousPlayers: [] };
    const longest = Math.max(...matches.map(item => item.normalized.length));
    const players = new Map(matches.filter(item => item.normalized.length === longest).map(item => [Number(item.player.id), item.player]));
    const candidates = [...players.values()];
    return candidates.length === 1 ? { player: candidates[0], ambiguousPlayers: [] } : { player: null, ambiguousPlayers: candidates };
  }

  function canonicalNumberedCompanion(value, suffix) {
    if (!/^\d+$/.test(suffix)) return value;
    const pattern = new RegExp(suffix + "(?=\\s*(?:[🌸🍀]|\\([^)]*\\)|（[^）]*）|\\s)*$)", "u");
    return String(value).replace(pattern, "+" + suffix);
  }

  function findPendingCompanion(value, members) {
    const clean = text => normalizeName(removeAnnotations(text).replace(/[🌸🍀]/gu, ""));
    const candidate = clean(value);
    const aliases = members.flatMap(member => splitAliases([member.name, ...(member.aliases || [])].join("，"))
      .map(alias => ({ key: member.key, alias: clean(alias) })).filter(item => item.alias));
    // Complete names win, including a draft whose actual name contains digits.
    if (!candidate || aliases.some(item => item.alias === candidate)) return null;
    const matches = aliases.flatMap(item => {
      if (!candidate.startsWith(item.alias)) return [];
      const suffix = candidate.slice(item.alias.length).match(/^(?:([0-9]+)|(?:[+➕]|代|加)([0-9]+|[零〇一二两三四五六七八九十百千万]+))$/u);
      const number = suffix?.[1] || suffix?.[2];
      if (!number || /^[0零〇]+$/u.test(number)) return [];
      return [{ key: item.key, suffix: number, length: item.alias.length }];
    });
    if (!matches.length) return null;
    const longest = Math.max(...matches.map(item => item.length));
    const owners = new Map(matches.filter(item => item.length === longest).map(item => [item.key, item]));
    if (owners.size !== 1) return null;
    const { key, suffix } = [...owners.values()][0];
    return { key, suffix };
  }

  function sameProfile(expected, player) {
    return Boolean(expected && player && expected.name === player.name && expected.level === player.level
      && (expected.updatedAt === undefined || expected.updatedAt === player.updatedAt));
  }

  root.BadmintonRosterReview = Object.freeze({ ranks, levels, normalizeName, splitAliases, normalizeLevel, parseLevelPrefix,
    findPlayerMatch, canonicalNumberedCompanion, findPendingCompanion, sameProfile });
})(globalThis);
