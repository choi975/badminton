(function attachBadmintonGroupProbability(root) {
  "use strict";

  const DAY_MS = 86400000;
  const SUCCESS_THRESHOLD = 6;
  const LARGE_SESSION_THRESHOLD = 10;
  const WEEKDAY_PRIOR_STRENGTH = 10;
  const MISSING_BOOKING_SOFT_SUCCESS = 0.05;
  const MEMBER_PRIOR_STRENGTH = 6;
  const GUEST_PRIOR_STRENGTH = 5;
  const HISTORY_HALF_LIFE_DAYS = 30;
  const LEARNING_EVIDENCE_PRIOR = 5;
  const FATIGUE_MULTIPLIER = 0.2;
  const JOINED_FATIGUE_RETENTION = 0.55;
  const LARGE_LOW_RETENTION = 0.3;
  const LARGE_HIGH_RETENTION = 0.95;
  const OWNER_BUNDLE_CORRELATION = 0.6;
  const DEFAULT_SIMULATIONS = 2000;
  const DEFAULT_CALIBRATION_SIMULATIONS = 300;
  const DEFAULT_COUNTERFACTUAL_SIMULATIONS = 120;
  const DEFAULT_BASELINE = 0.44;
  const DEFAULT_PARTICIPATION_RATE = 0.18;
  const DEFAULT_LARGE_PREFERENCE_RATE = 0.08;
  const CUTOFF_HOUR = 17;
  const ACTIVITY_HOUR = 19;
  const WEEKDAY_NAMES = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function round(value, digits = 6) {
    const scale = 10 ** digits;
    return Math.round((Number(value) + Number.EPSILON) * scale) / scale;
  }

  function sigmoid(value) {
    if (value >= 0) {
      const z = Math.exp(-value);
      return 1 / (1 + z);
    }
    const z = Math.exp(value);
    return z / (1 + z);
  }

  function logit(value) {
    const probability = clamp(Number(value) || 0, 0.0001, 0.9999);
    return Math.log(probability / (1 - probability));
  }

  function parseIsoDate(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const timestamp = Date.UTC(year, month - 1, day);
    const parsed = new Date(timestamp);
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
    return { year, month, day, timestamp };
  }

  function addDays(dateString, amount) {
    const parsed = parseIsoDate(dateString);
    if (!parsed) return "";
    return new Date(parsed.timestamp + Number(amount || 0) * DAY_MS).toISOString().slice(0, 10);
  }

  function compareDates(left, right) {
    return String(left || "").localeCompare(String(right || ""));
  }

  function daysBetween(left, right) {
    const parsedLeft = parseIsoDate(left);
    const parsedRight = parseIsoDate(right);
    if (!parsedLeft || !parsedRight) return 0;
    return (parsedRight.timestamp - parsedLeft.timestamp) / DAY_MS;
  }

  function historyWeight(date, targetDate) {
    return 0.5 ** (Math.max(0, daysBetween(date, targetDate)) / HISTORY_HALF_LIFE_DAYS);
  }

  function weekdayOf(dateString) {
    const parsed = parseIsoDate(dateString);
    return parsed ? new Date(parsed.timestamp).getUTCDay() : 0;
  }

  function beijingNowParts(value) {
    const date = value instanceof Date ? value : new Date(value || Date.now());
    const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(safeDate).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    return {
      date: `${parts.year}-${parts.month}-${parts.day}`,
      hour: Number(parts.hour),
      minute: Number(parts.minute),
      second: Number(parts.second),
    };
  }

  function signalGeneratedDate(value) {
    if (!value) return "";
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return beijingNowParts(parsed).date;
    const dateOnly = String(value).slice(0, 10);
    return parseIsoDate(dateOnly) ? dateOnly : "";
  }

  function localClockTimestamp(dateString, hour, minute = 0) {
    const parsed = parseIsoDate(dateString);
    return parsed ? parsed.timestamp + hour * 3600000 + minute * 60000 : 0;
  }

  function nowLocalTimestamp(parts) {
    return localClockTimestamp(parts.date, parts.hour, parts.minute) + parts.second * 1000;
  }

  function remainingExposure(targetDate, nowParts) {
    const dayComparison = compareDates(targetDate, nowParts.date);
    if (dayComparison > 0) return 1;
    if (dayComparison < 0) return 0;
    const minute = nowParts.hour * 60 + nowParts.minute;
    const points = [
      [0, 1],
      [9 * 60, 1],
      [12 * 60, 0.75],
      [15 * 60, 0.4],
      [16 * 60, 0.18],
      [CUTOFF_HOUR * 60, 0],
    ];
    for (let index = 1; index < points.length; index += 1) {
      const [rightMinute, rightValue] = points[index];
      const [leftMinute, leftValue] = points[index - 1];
      if (minute <= rightMinute) {
        const fraction = (minute - leftMinute) / Math.max(1, rightMinute - leftMinute);
        return clamp(leftValue + (rightValue - leftValue) * fraction, 0, 1);
      }
    }
    return 0;
  }

  function regularRetention(targetDate, nowParts) {
    const remainingHours = (localClockTimestamp(targetDate, ACTIVITY_HOUR) - nowLocalTimestamp(nowParts)) / 3600000;
    return round(0.995 - 0.045 * clamp(remainingHours / 24, 0, 1), 9);
  }

  function normalizeName(value) {
    return String(value || "").normalize("NFKC").toLowerCase().replace(/\s+/g, "").trim();
  }

  function aliasesForPlayer(player) {
    return String(player?.name || "").split(/[,，]/).map(normalizeName).filter(Boolean);
  }

  function normalizePlayerId(value) {
    if (value === null || value === undefined || value === "") return null;
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
  }

  function hashString(value) {
    let hash = 2166136261;
    for (const char of String(value || "")) {
      hash ^= char.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function mulberry32(seed) {
    let state = seed >>> 0;
    return function random() {
      state = (state + 0x6D2B79F5) | 0;
      let value = Math.imul(state ^ (state >>> 15), 1 | state);
      value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function participantCount(session) {
    return (session?.players || []).reduce((sum, row) => sum + Math.max(0, Number(row?.slots) || 0), 0);
  }

  function isCompanionRow(row) {
    return row?.isCompanion === true || row?.isCompanion === 1 || row?.isCompanion === "1";
  }

  function isOwnerPresent(row) {
    return !isCompanionRow(row) && Math.max(0, Number(row?.slots) || 0) > Math.max(0, Number(row?.plusCount) || 0);
  }

  function rowOwnerId(row) {
    return normalizePlayerId(row?.ownerPlayerId ?? row?.owner_player_id ?? row?.playerId ?? row?.player_id);
  }

  function rowGuestCount(row) {
    const slots = Math.max(0, Math.floor(Number(row?.slots) || 0));
    const plusCount = Math.max(0, Math.floor(Number(row?.plusCount ?? row?.plus_count) || 0));
    if (isCompanionRow(row)) return Math.max(1, slots);
    return Math.max(plusCount, slots - (isOwnerPresent(row) ? 1 : 0));
  }

  function uniqueSelfIds(session) {
    return [...new Set((session?.players || [])
      .filter(isOwnerPresent)
      .map((row) => normalizePlayerId(row?.playerId ?? row?.player_id ?? rowOwnerId(row)))
      .filter(Boolean))];
  }

  function normalizeSessions(rawSessions, historyEnd) {
    return (Array.isArray(rawSessions) ? rawSessions : [])
      .filter((session) => parseIsoDate(session?.date) && (!historyEnd || compareDates(session.date, historyEnd) <= 0))
      .map((session) => ({
        ...session,
        date: String(session.date),
        participantCount: participantCount(session),
        selfIds: uniqueSelfIds(session),
      }))
      .sort((left, right) => compareDates(left.date, right.date) || Number(left.id || 0) - Number(right.id || 0));
  }

  function normalizeAttemptOutcomes(rawAttempts, historyEnd) {
    const outcomes = new Map();
    for (const attempt of Array.isArray(rawAttempts) ? rawAttempts : []) {
      const date = String(attempt?.activityDate ?? attempt?.activity_date ?? attempt?.targetDate ?? attempt?.target_date ?? attempt?.date ?? "");
      if (!parseIsoDate(date) || (historyEnd && compareDates(date, historyEnd) > 0)) continue;
      const trainingState = String(attempt?.trainingState ?? attempt?.training_state ?? "").toLowerCase();
      const hasEligibleSnapshots = attempt?.hasEligibleSnapshots ?? attempt?.has_eligible_snapshots;
      const eligible = attempt?.eligible !== false
        && attempt?.eligibleForTraining !== false
        && attempt?.eligible_for_training !== false
        && (!trainingState || trainingState === "eligible")
        && (hasEligibleSnapshots === undefined || hasEligibleSnapshots === true || hasEligibleSnapshots === 1);
      const status = String(attempt?.status || "").toLowerCase();
      const outcome = String(attempt?.outcome || "").toLowerCase();
      const explicitSuccess = typeof attempt?.success === "boolean"
        ? attempt.success
        : typeof attempt?.outcomeSuccess === "boolean"
          ? attempt.outcomeSuccess
          : typeof attempt?.outcome_success === "boolean"
            ? attempt.outcome_success
            : outcome === "success"
              ? true
              : outcome === "failure"
                ? false
                : null;
      const finalCountRaw = attempt?.finalCount
        ?? attempt?.finalParticipantCount
        ?? attempt?.final_count
        ?? attempt?.final_participant_count;
      const finalCount = finalCountRaw === null || finalCountRaw === undefined || finalCountRaw === ""
        ? null
        : Number(finalCountRaw);
      const settled = attempt?.settled === true
        || attempt?.isSettled === true
        || attempt?.is_settled === true
        || Boolean(attempt?.settledAt ?? attempt?.settled_at ?? attempt?.completedAt ?? attempt?.completed_at)
        || ["settled", "completed", "success", "failed", "cancelled", "canceled"].includes(status)
        || ["success", "failure"].includes(outcome);
      if (!eligible || !settled || (explicitSuccess === null && !Number.isFinite(finalCount))) continue;
      outcomes.set(date, explicitSuccess === null ? finalCount >= SUCCESS_THRESHOLD : explicitSuccess);
    }
    return outcomes;
  }

  function computeWeekdayBaselines(sessions, attempts, historyStart, historyEnd, softSuccess, priorStrength, targetDate) {
    const rows = Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      days: 0,
      observedSuccesses: 0,
      softSuccesses: 0,
      effectiveDays: 0,
      effectiveObservedSuccesses: 0,
      effectiveSoftSuccesses: 0,
    }));
    const successfulDates = new Set(sessions.filter((session) => session.participantCount >= SUCCESS_THRESHOLD).map((session) => session.date));
    const attemptOutcomes = normalizeAttemptOutcomes(attempts, historyEnd);
    const parsedStart = parseIsoDate(historyStart);
    const parsedEnd = parseIsoDate(historyEnd);
    if (parsedStart && parsedEnd && parsedStart.timestamp <= parsedEnd.timestamp) {
      for (let timestamp = parsedStart.timestamp; timestamp <= parsedEnd.timestamp; timestamp += DAY_MS) {
        const date = new Date(timestamp).toISOString().slice(0, 10);
        const row = rows[new Date(timestamp).getUTCDay()];
        const explicitOutcome = attemptOutcomes.get(date);
        const success = explicitOutcome === undefined ? successfulDates.has(date) : explicitOutcome;
        const label = explicitOutcome === undefined ? (success ? 1 : softSuccess) : (success ? 1 : 0);
        const weight = historyWeight(date, targetDate);
        row.days += 1;
        row.observedSuccesses += success ? 1 : 0;
        row.softSuccesses += label;
        row.effectiveDays += weight;
        row.effectiveObservedSuccesses += success ? weight : 0;
        row.effectiveSoftSuccesses += label * weight;
      }
    }
    const totalDays = rows.reduce((sum, row) => sum + row.days, 0);
    const totalEffectiveDays = rows.reduce((sum, row) => sum + row.effectiveDays, 0);
    const totalEffectiveSoftSuccesses = rows.reduce((sum, row) => sum + row.effectiveSoftSuccesses, 0);
    const overall = totalEffectiveDays ? totalEffectiveSoftSuccesses / totalEffectiveDays : DEFAULT_BASELINE;
    rows.forEach((row) => {
      const probability = row.effectiveDays
        ? (row.effectiveSoftSuccesses + priorStrength * overall) / (row.effectiveDays + priorStrength)
        : overall;
      row.probability = clamp(probability, 0.01, 0.99);
      row.rawProbability = row.days ? row.observedSuccesses / row.days : null;
      row.name = WEEKDAY_NAMES[row.weekday];
    });
    return { overall: clamp(overall, 0.01, 0.99), totalDays, totalEffectiveDays, rows };
  }

  function buildHistoryStats(players, sessions, targetDate) {
    const playerCount = Math.max(1, players.length);
    const statsById = new Map(players.map((player) => [player.id, {
      id: player.id,
      playCount: 0,
      rawPlayCount: 0,
      weekdayCounts: Array(7).fill(0),
      rawWeekdayCounts: Array(7).fill(0),
      dates: new Set(),
      sessionSizes: [],
      largeSessionWeight: 0,
      rawLargeSessionCount: 0,
      guestHistogram: new Map(),
      rawGuestHistogram: new Map(),
      guestSessionCount: 0,
      rawGuestSessionCount: 0,
      guestTotal: 0,
      rawGuestTotal: 0,
    }]));
    const pairCounts = new Map();
    const rawPairCounts = new Map();
    const successSessionsByWeekday = Array(7).fill(0);
    const rawSuccessSessionsByWeekday = Array(7).fill(0);
    const selfAppearancesByWeekday = Array(7).fill(0);
    const rawSelfAppearancesByWeekday = Array(7).fill(0);
    const globalGuestHistogram = new Map();
    const rawGlobalGuestHistogram = new Map();
    let globalGuestSamples = 0;
    let rawGlobalGuestSamples = 0;
    let successfulSessions = 0;
    let rawSuccessfulSessions = 0;

    for (const session of sessions) {
      if (session.participantCount < SUCCESS_THRESHOLD) continue;
      const weight = historyWeight(session.date, targetDate);
      const weekday = weekdayOf(session.date);
      successfulSessions += weight;
      rawSuccessfulSessions += 1;
      successSessionsByWeekday[weekday] += weight;
      rawSuccessSessionsByWeekday[weekday] += 1;
      const selfIds = session.selfIds.filter((id) => statsById.has(id));
      selfAppearancesByWeekday[weekday] += selfIds.length * weight;
      rawSelfAppearancesByWeekday[weekday] += selfIds.length;
      for (const id of selfIds) {
        const stats = statsById.get(id);
        stats.playCount += weight;
        stats.rawPlayCount += 1;
        stats.weekdayCounts[weekday] += weight;
        stats.rawWeekdayCounts[weekday] += 1;
        stats.dates.add(session.date);
        stats.sessionSizes.push(session.participantCount);
        if (session.participantCount >= LARGE_SESSION_THRESHOLD) {
          stats.largeSessionWeight += weight;
          stats.rawLargeSessionCount += 1;
        }
      }
      for (const left of selfIds) {
        for (const right of selfIds) {
          if (left === right) continue;
          const key = `${left}:${right}`;
          pairCounts.set(key, (pairCounts.get(key) || 0) + weight);
          rawPairCounts.set(key, (rawPairCounts.get(key) || 0) + 1);
        }
      }

      const ownerGroups = new Map();
      for (const row of session.players || []) {
        const ownerId = rowOwnerId(row);
        if (!ownerId || !statsById.has(ownerId)) continue;
        const group = ownerGroups.get(ownerId) || { present: false, guests: 0 };
        group.present = group.present || isOwnerPresent(row);
        group.guests += rowGuestCount(row);
        ownerGroups.set(ownerId, group);
      }
      for (const [ownerId, group] of ownerGroups) {
        const count = clamp(group.guests, 0, 12);
        const stats = statsById.get(ownerId);
        stats.guestHistogram.set(count, (stats.guestHistogram.get(count) || 0) + weight);
        stats.rawGuestHistogram.set(count, (stats.rawGuestHistogram.get(count) || 0) + 1);
        stats.guestSessionCount += weight;
        stats.rawGuestSessionCount += 1;
        stats.guestTotal += count * weight;
        stats.rawGuestTotal += count;
        globalGuestHistogram.set(count, (globalGuestHistogram.get(count) || 0) + weight);
        rawGlobalGuestHistogram.set(count, (rawGlobalGuestHistogram.get(count) || 0) + 1);
        globalGuestSamples += weight;
        rawGlobalGuestSamples += 1;
      }
    }

    if (!globalGuestSamples) {
      globalGuestHistogram.set(0, 1);
      rawGlobalGuestHistogram.set(0, 1);
      globalGuestSamples = 1;
      rawGlobalGuestSamples = 1;
    }
    const totalSelfAppearances = selfAppearancesByWeekday.reduce((sum, count) => sum + count, 0);
    return {
      statsById,
      pairCounts,
      rawPairCounts,
      successfulSessions,
      rawSuccessfulSessions,
      successSessionsByWeekday,
      rawSuccessSessionsByWeekday,
      selfAppearancesByWeekday,
      rawSelfAppearancesByWeekday,
      groupConditionalRate: clamp(totalSelfAppearances / Math.max(1, successfulSessions * playerCount), 0.01, 0.95),
      globalGuestHistogram,
      rawGlobalGuestHistogram,
      globalGuestSamples,
      rawGlobalGuestSamples,
      halfLifeDays: HISTORY_HALF_LIFE_DAYS,
    };
  }

  function listValue(longTermLists, key) {
    if (Array.isArray(longTermLists)) {
      const found = longTermLists.find((item) => item?.key === key || item?.listKey === key);
      return { present: Boolean(found), members: Array.isArray(found?.members) ? found.members : [] };
    }
    if (!longTermLists || typeof longTermLists !== "object") return { present: false, members: [] };
    const present = Object.prototype.hasOwnProperty.call(longTermLists, key);
    const raw = longTermLists[key];
    const members = Array.isArray(raw) ? raw : Array.isArray(raw?.members) ? raw.members : [];
    return { present, members };
  }

  function resolveMemberRefs(refs, players, aliasToId) {
    const ids = new Set();
    for (const ref of refs || []) {
      const directId = normalizePlayerId(typeof ref === "object" ? ref?.id ?? ref?.playerId : ref);
      if (directId && players.some((player) => player.id === directId)) {
        ids.add(directId);
        continue;
      }
      const normalized = normalizeName(typeof ref === "object" ? ref?.name : ref);
      if (aliasToId.has(normalized)) ids.add(aliasToId.get(normalized));
    }
    return ids;
  }

  function maximumStreak(dates) {
    const sorted = [...dates].sort(compareDates);
    let best = 0;
    let current = 0;
    let previous = "";
    for (const date of sorted) {
      current = previous && addDays(previous, 1) === date ? current + 1 : 1;
      best = Math.max(best, current);
      previous = date;
    }
    return best;
  }

  function buildLongTermProfile(players, history, longTermLists) {
    const aliasToId = new Map();
    for (const player of players) {
      for (const alias of aliasesForPlayer(player)) {
        if (!aliasToId.has(alias)) aliasToId.set(alias, player.id);
      }
    }
    const three = listValue(longTermLists, "threeDayStreak");
    const two = listValue(longTermLists, "twoDayStreak");
    const large = listValue(longTermLists, "onlyLargeSessions");
    const threeIds = three.present
      ? resolveMemberRefs(three.members, players, aliasToId)
      : new Set(players.filter((player) => maximumStreak(history.statsById.get(player.id)?.dates || []) >= 3).map((player) => player.id));
    const twoIds = two.present
      ? resolveMemberRefs(two.members, players, aliasToId)
      : new Set(players.filter((player) => maximumStreak(history.statsById.get(player.id)?.dates || []) >= 2).map((player) => player.id));
    const largeIds = large.present
      ? resolveMemberRefs(large.members, players, aliasToId)
      : new Set(players.filter((player) => {
        const stats = history.statsById.get(player.id);
        const largeRate = (stats?.largeSessionWeight || 0) / Math.max(0.0001, stats?.playCount || 0);
        return (stats?.rawPlayCount || 0) > 0 && largeRate >= 0.8;
      }).map((player) => player.id));
    const capacityById = new Map(players.map((player) => [player.id, threeIds.has(player.id) ? 3 : twoIds.has(player.id) ? 2 : 1]));
    const largeConfidenceById = new Map(players.map((player) => {
      const stats = history.statsById.get(player.id);
      const sampleCount = stats?.playCount || 0;
      const largeRate = (stats?.largeSessionWeight || 0) / Math.max(0.0001, sampleCount);
      const preferenceRate = large.present ? Number(largeIds.has(player.id)) : (largeIds.has(player.id) ? largeRate : 0);
      return [player.id, preferenceRate * sampleCount / (sampleCount + LEARNING_EVIDENCE_PRIOR)];
    }));
    return { capacityById, largeConfidenceById, threeIds, twoIds, largeIds };
  }

  function firstFinite(source, keys) {
    for (const key of keys) {
      const rawValue = source?.[key];
      if (rawValue === null || rawValue === undefined || rawValue === "") continue;
      const value = Number(rawValue);
      if (Number.isFinite(value)) return value;
    }
    return null;
  }

  function probabilityField(source, keys) {
    const value = firstFinite(source, keys);
    return value === null ? null : clamp(value, 0.001, 0.999);
  }

  function multiplierField(source, keys) {
    const value = firstFinite(source, keys);
    return value === null ? null : clamp(value, 0.05, 1.25);
  }

  function reliabilityField(source, keys) {
    const value = firstFinite(source, keys);
    return value === null ? 0 : clamp(value, 0, 1);
  }

  function evidenceField(source, keys) {
    const value = firstFinite(source, keys);
    return value === null ? 0 : Math.max(0, value);
  }

  function optionalEvidenceField(source, keys) {
    const value = firstFinite(source, keys);
    return value === null ? null : Math.max(0, value);
  }

  function normalizeLearningSignals(rawSignals, players) {
    const raw = rawSignals && typeof rawSignals === "object" ? rawSignals : {};
    const suppliedGeneratedDate = String(raw.generatedDate ?? raw.generated_date ?? "");
    const rawPriors = raw.priors && typeof raw.priors === "object" ? raw.priors : {};
    const priors = {
      participationRate: probabilityField(rawPriors, ["participationRate", "participation_rate"]),
      participationEvidence: optionalEvidenceField(rawPriors, ["participationEvidence", "participation_evidence"]),
      regularRetention: probabilityField(rawPriors, ["regularRetention", "regular_retention"]),
      regularRetentionEvidence: optionalEvidenceField(rawPriors, ["regularRetentionEvidence", "regular_retention_evidence"]),
      fatigueMultiplier: multiplierField(rawPriors, ["fatigueMultiplier", "fatigue_multiplier"]),
      fatigueEvidence: optionalEvidenceField(rawPriors, ["fatigueEvidence", "fatigue_evidence"]),
      largePreferenceRate: probabilityField(rawPriors, ["largePreferenceRate", "large_preference_rate"]),
      largePreferenceEvidence: optionalEvidenceField(rawPriors, ["largePreferenceEvidence", "large_preference_evidence"]),
      largeLowRetention: probabilityField(rawPriors, ["largeLowRetention", "large_low_retention"]),
      largeLowRetentionEvidence: optionalEvidenceField(rawPriors, ["largeLowRetentionEvidence", "large_low_retention_evidence"]),
    };
    const validIds = new Set(players.map((player) => player.id));
    const membersById = new Map();
    const rawMembers = raw.members;
    const memberRows = Array.isArray(rawMembers)
      ? rawMembers.map((member) => [member?.playerId ?? member?.player_id ?? member?.id, member])
      : rawMembers && typeof rawMembers === "object"
        ? Object.entries(rawMembers)
        : [];
    for (const [rawId, member] of memberRows) {
      const playerId = normalizePlayerId(member?.playerId ?? member?.player_id ?? member?.id ?? rawId);
      if (!playerId || !validIds.has(playerId) || !member || typeof member !== "object") continue;
      const participation = member.participation && typeof member.participation === "object" ? member.participation : {};
      const retention = member.retention && typeof member.retention === "object" ? member.retention : {};
      const largePreference = member.largePreference && typeof member.largePreference === "object" ? member.largePreference : {};
      const secondDay = member.secondDay && typeof member.secondDay === "object" ? member.secondDay : {};
      const thirdDay = member.thirdDay && typeof member.thirdDay === "object" ? member.thirdDay : {};
      membersById.set(playerId, {
        playerId,
        participationRate: probabilityField(member, ["participationRate", "participation_rate"])
          ?? probabilityField(participation, ["rate"]),
        participationReliability: reliabilityField(member, ["participationReliability", "participation_reliability"])
          || reliabilityField(participation, ["reliability"]),
        retentionRate: probabilityField(member, ["retentionRate", "retention_rate"])
          ?? probabilityField(retention, ["rate"]),
        retentionReliability: reliabilityField(member, ["retentionReliability", "retention_reliability"])
          || reliabilityField(retention, ["reliability"]),
        largePreferenceConfidence: probabilityField(member, ["largePreferenceConfidence", "large_preference_confidence"])
          ?? probabilityField(largePreference, ["confidence"]),
        largePreferenceEvidence: evidenceField(member, ["largePreferenceEvidence", "large_preference_evidence"])
          || evidenceField(largePreference, ["evidence"]),
        secondDayRate: probabilityField(member, ["secondDayRate", "second_day_rate"])
          ?? probabilityField(secondDay, ["rate"]),
        secondDayEvidence: evidenceField(member, ["secondDayEvidence", "second_day_evidence"])
          || evidenceField(secondDay, ["evidence"]),
        thirdDayRate: probabilityField(member, ["thirdDayRate", "third_day_rate"])
          ?? probabilityField(thirdDay, ["rate"]),
        thirdDayEvidence: evidenceField(member, ["thirdDayEvidence", "third_day_evidence"])
          || evidenceField(thirdDay, ["evidence"]),
        companionRate: probabilityField(member, ["companionRate", "companion_rate"]),
        companionMean: firstFinite(member, ["companionMean", "companion_mean"]),
        companionReliability: reliabilityField(member, ["companionReliability", "companion_reliability"]),
        lastObservedDate: String(member.lastObservedDate ?? member.last_observed_date ?? ""),
      });
    }

    const influenceByTarget = new Map();
    const rawInfluence = raw.influence ?? raw.influences;
    const influences = Array.isArray(rawInfluence) ? [...rawInfluence] : [];
    if (rawInfluence && typeof rawInfluence === "object" && !Array.isArray(rawInfluence)) {
      for (const [sourcePlayerId, targets] of Object.entries(rawInfluence)) {
        if (!targets || typeof targets !== "object") continue;
        for (const [targetPlayerId, edge] of Object.entries(targets)) {
          influences.push({ ...edge, sourcePlayerId, targetPlayerId });
        }
      }
    }
    for (const edge of influences) {
      const sourcePlayerId = normalizePlayerId(edge?.sourcePlayerId ?? edge?.source_player_id);
      const targetPlayerId = normalizePlayerId(edge?.targetPlayerId ?? edge?.target_player_id);
      const lift = firstFinite(edge, ["lift"]);
      const evidence = evidenceField(edge, ["evidence"]);
      const suppliedReliability = firstFinite(edge, ["reliability"]);
      if (!sourcePlayerId || !targetPlayerId || sourcePlayerId === targetPlayerId
        || !validIds.has(sourcePlayerId) || !validIds.has(targetPlayerId) || lift === null || !evidence) continue;
      const rows = influenceByTarget.get(targetPlayerId) || [];
      const edgeReliability = suppliedReliability === null ? evidenceReliability(evidence) : clamp(suppliedReliability, 0, 1);
      if (!edgeReliability) continue;
      rows.push({
        sourcePlayerId,
        targetPlayerId,
        lift: clamp(lift, -0.12, 0.15),
        evidence,
        reliability: edgeReliability,
      });
      influenceByTarget.set(targetPlayerId, rows);
    }
    return {
      priors,
      membersById,
      influenceByTarget,
      generatedDate: parseIsoDate(suppliedGeneratedDate)
        ? suppliedGeneratedDate
        : signalGeneratedDate(raw.generatedAt ?? raw.generated_at),
      supplied: Boolean(rawSignals && typeof rawSignals === "object"),
      memberSignalCount: [...membersById.values()].filter((member) => (
        member.participationReliability > 0
          || member.retentionReliability > 0
          || member.largePreferenceEvidence > 0
          || member.secondDayEvidence > 0
          || member.thirdDayEvidence > 0
          || member.companionReliability > 0
      )).length,
      influenceCount: [...influenceByTarget.values()].reduce((sum, rows) => sum + rows.length, 0),
    };
  }

  function learningFreshness(learning, targetDate) {
    if (!parseIsoDate(learning?.generatedDate)) return 1;
    return historyWeight(learning.generatedDate, targetDate);
  }

  function evidenceReliability(evidence) {
    return Math.max(0, Number(evidence) || 0) / (Math.max(0, Number(evidence) || 0) + LEARNING_EVIDENCE_PRIOR);
  }

  function hasPosteriorEvidence(value, evidence) {
    return value !== null && (evidence === null || evidence > 0);
  }

  function adaptiveProbabilityPrior(defaultValue, learnedValue, evidence, freshness) {
    if (!hasPosteriorEvidence(learnedValue, evidence)) return defaultValue;
    return clamp(sigmoid(
      logit(defaultValue) + freshness * (logit(learnedValue) - logit(defaultValue)),
    ), 0.001, 0.999);
  }

  function adaptiveMultiplierPrior(defaultValue, learnedValue, evidence, freshness) {
    if (!hasPosteriorEvidence(learnedValue, evidence)) return defaultValue;
    return clamp(Math.exp(
      Math.log(defaultValue) + freshness * (Math.log(learnedValue) - Math.log(defaultValue)),
    ), 0.01, 1.25);
  }

  function adaptiveRegularRetention(timeAdjustedDefault, groupRegularRetention) {
    return clamp(sigmoid(
      logit(timeAdjustedDefault)
        + logit(groupRegularRetention) - logit(0.95),
    ), 0.5, 0.999);
  }

  function learnedParticipationEffect(participationPrior, signal, freshness) {
    if (!signal || signal.participationRate === null || !signal.participationReliability) return 0;
    return clamp(
      freshness * (logit(signal.participationRate) - logit(participationPrior)),
      -1.75,
      1.75,
    );
  }

  function learnedRetention(baseRetention, groupRegularRetention, signal, freshness) {
    if (!signal || signal.retentionRate === null || !signal.retentionReliability) return baseRetention;
    return clamp(sigmoid(
      logit(baseRetention) + freshness * (logit(signal.retentionRate) - logit(groupRegularRetention)),
    ), 0.05, 0.999);
  }

  function learnedLargeConfidence(baseConfidence, groupPreferenceRate, signal, freshness) {
    if (!signal || signal.largePreferenceConfidence === null || !signal.largePreferenceEvidence) return baseConfidence;
    return clamp(baseConfidence + freshness * (signal.largePreferenceConfidence - groupPreferenceRate), 0, 0.999);
  }

  function learnedFatigueFactor(defaultFactor, rate, evidence, participationReference, groupFatigueFactor, freshness) {
    if (rate === null || !evidence) return defaultFactor;
    const rateOdds = rate / Math.max(0.001, 1 - rate);
    const participationOdds = participationReference / Math.max(0.001, 1 - participationReference);
    const learnedFactor = clamp(rateOdds / Math.max(0.001, participationOdds), 0.05, 1.25);
    const relativeFactor = learnedFactor / Math.max(0.05, groupFatigueFactor);
    return clamp(defaultFactor * (relativeFactor ** freshness), 0.05, 1.25);
  }

  function learnedGuestDistribution(baseDistribution, signal, freshness) {
    if (!signal || signal.companionRate === null || signal.companionMean === null || !signal.companionReliability) {
      return baseDistribution;
    }
    const companionRate = clamp(signal.companionRate, 0.001, 0.95);
    const mixWeight = signal.companionReliability * freshness;
    const conditionalMean = clamp(Math.max(0, signal.companionMean) / companionRate, 1, 12);
    const lower = Math.floor(conditionalMean);
    const upper = Math.min(12, Math.ceil(conditionalMean));
    const upperShare = upper === lower ? 0 : conditionalMean - lower;
    const learned = new Map([[0, 1 - companionRate]]);
    learned.set(lower, (learned.get(lower) || 0) + companionRate * (1 - upperShare));
    if (upperShare) learned.set(upper, (learned.get(upper) || 0) + companionRate * upperShare);
    const base = new Map(baseDistribution.map((row) => [row.count, row.probability]));
    const maximum = Math.max(0, ...base.keys(), ...learned.keys());
    const rows = [];
    for (let count = 0; count <= maximum; count += 1) {
      rows.push({
        count,
        probability: (1 - mixWeight) * (base.get(count) || 0) + mixWeight * (learned.get(count) || 0),
      });
    }
    const total = rows.reduce((sum, row) => sum + row.probability, 0) || 1;
    return rows.map((row) => ({ count: row.count, probability: row.probability / total }));
  }

  function resolveLearningPriors(learning, history, targetDate) {
    const freshness = learningFreshness(learning, targetDate);
    return {
      freshness,
      participationRate: adaptiveProbabilityPrior(
        history.rawSuccessfulSessions ? history.groupConditionalRate : DEFAULT_PARTICIPATION_RATE,
        learning.priors.participationRate,
        learning.priors.participationEvidence,
        freshness,
      ),
      regularRetention: adaptiveProbabilityPrior(
        0.95,
        learning.priors.regularRetention,
        learning.priors.regularRetentionEvidence,
        freshness,
      ),
      fatigueMultiplier: adaptiveMultiplierPrior(
        FATIGUE_MULTIPLIER,
        learning.priors.fatigueMultiplier,
        learning.priors.fatigueEvidence,
        freshness,
      ),
      largePreferenceRate: adaptiveProbabilityPrior(
        DEFAULT_LARGE_PREFERENCE_RATE,
        learning.priors.largePreferenceRate,
        learning.priors.largePreferenceEvidence,
        freshness,
      ),
      largeLowRetention: adaptiveProbabilityPrior(
        LARGE_LOW_RETENTION,
        learning.priors.largeLowRetention,
        learning.priors.largeLowRetentionEvidence,
        freshness,
      ),
    };
  }

  function ruleFields(rule) {
    return {
      playerId: normalizePlayerId(rule?.playerId ?? rule?.player_id),
      type: String(rule?.type ?? rule?.ruleType ?? rule?.rule_type ?? ""),
      data: rule?.rule && typeof rule.rule === "object"
        ? rule.rule
        : (() => { try { return JSON.parse(rule?.rule_json || "{}"); } catch (error) { return {}; } })(),
      startsOn: String(rule?.startsOn ?? rule?.starts_on ?? ""),
      expiresOn: String(rule?.expiresOn ?? rule?.expires_on ?? ""),
    };
  }

  function ruleBlocksPlayer(rules, playerId, targetDate) {
    const weekday = weekdayOf(targetDate);
    return (rules || []).some((rawRule) => {
      const rule = ruleFields(rawRule);
      if (rule.playerId !== playerId) return false;
      if (rule.startsOn && compareDates(targetDate, rule.startsOn) < 0) return false;
      if (rule.type === "only_days") return !(rule.data.weekdays || []).map(Number).includes(weekday);
      if (rule.type === "not_days") return (rule.data.weekdays || []).map(Number).includes(weekday);
      return Boolean(rule.expiresOn && compareDates(targetDate, rule.expiresOn) <= 0);
    });
  }

  function normalizeEntries(rawEntries) {
    const normalized = (Array.isArray(rawEntries) ? rawEntries : []).filter((entry) => entry?.clean !== "").map((entry) => {
      const companion = Boolean(entry?.companion || entry?.isCompanion || entry?.plusEntry);
      const playerId = normalizePlayerId(entry?.playerId ?? entry?.player?.id);
      const ownerId = normalizePlayerId(entry?.ownerId ?? entry?.ownerPlayerId ?? entry?.ownerPlayer?.id ?? (!companion ? playerId : null));
      return {
        index: 0,
        companion,
        playerId,
        ownerId,
        count: companion ? Math.max(1, Math.floor(Number(entry?.slots) || 1)) : 1,
        level: String(entry?.levelText ?? entry?.level ?? entry?.player?.level ?? "不详"),
        name: String(entry?.displayName ?? entry?.clean ?? entry?.player?.name ?? entry?.playerName ?? ""),
      };
    });
    normalized.sort((left, right) => (
      Number(left.companion) - Number(right.companion)
      || Number(left.playerId || 0) - Number(right.playerId || 0)
      || Number(left.ownerId || 0) - Number(right.ownerId || 0)
      || left.name.localeCompare(right.name, "zh-Hans-CN")
      || left.count - right.count
    ));
    normalized.forEach((entry, index) => { entry.index = index; });
    return normalized;
  }

  function currentEntryState(entries) {
    const selfIds = new Set();
    const companionRows = [];
    let unknownSelfCount = 0;
    const observedGuestOwners = new Set();
    for (const entry of entries) {
      if (entry.companion) {
        companionRows.push(entry);
        if (entry.ownerId) observedGuestOwners.add(entry.ownerId);
      } else if (entry.playerId) {
        selfIds.add(entry.playerId);
      } else {
        unknownSelfCount += 1;
      }
    }
    return { selfIds, companionRows, unknownSelfCount, observedGuestOwners };
  }

  function historicalStreakBefore(history, playerId, targetDate) {
    const dates = history.statsById.get(playerId)?.dates || new Set();
    let streak = 0;
    let cursor = addDays(targetDate, -1);
    while (cursor && dates.has(cursor) && streak < 14) {
      streak += 1;
      cursor = addDays(cursor, -1);
    }
    return streak;
  }

  function memberEffect(history, playerId, weekday, playerCount) {
    const stats = history.statsById.get(playerId);
    if (!stats || stats.playCount < 2 || history.successfulSessions < 2) return 0;
    const groupOverall = history.groupConditionalRate;
    const overall = (stats.playCount + MEMBER_PRIOR_STRENGTH * groupOverall)
      / (history.successfulSessions + MEMBER_PRIOR_STRENGTH);
    const weekdaySessions = history.successSessionsByWeekday[weekday];
    const groupWeekday = weekdaySessions
      ? clamp(history.selfAppearancesByWeekday[weekday] / (weekdaySessions * Math.max(1, playerCount)), 0.01, 0.95)
      : groupOverall;
    const weekdayRate = (stats.weekdayCounts[weekday] + 4 * overall) / (weekdaySessions + 4);
    return clamp(0.5 * (logit(weekdayRate) - logit(groupWeekday)), -0.7, 0.7);
  }

  function socialEffect(history, learning, candidateId, joinedIds, freshness) {
    const candidateStats = history.statsById.get(candidateId);
    if (!candidateStats || !joinedIds.size) return 0;
    const base = (candidateStats.playCount + 2) / Math.max(4, history.successfulSessions + 4);
    const historicalLifts = [];
    for (const joinedId of joinedIds) {
      const joinedPlays = history.statsById.get(joinedId)?.playCount || 0;
      if (!joinedPlays) continue;
      const coattendance = history.pairCounts.get(`${joinedId}:${candidateId}`) || 0;
      if (!coattendance) continue;
      const conditional = (coattendance + 2 * base) / (joinedPlays + 2);
      const reliability = coattendance / (coattendance + 5);
      historicalLifts.push(clamp(Math.log(Math.max(0.001, conditional) / Math.max(0.001, base)) * reliability, 0, Math.log(1.35)));
    }
    const historical = clamp(
      historicalLifts.sort((left, right) => right - left).slice(0, 2).reduce((sum, value) => sum + value, 0),
      0,
      Math.log(1.6),
    );
    const learnedLifts = [];
    for (const edge of learning.influenceByTarget.get(candidateId) || []) {
      if (!joinedIds.has(edge.sourcePlayerId)) continue;
      const targetRate = clamp(base + freshness * edge.lift, 0.01, 0.99);
      learnedLifts.push(clamp(logit(targetRate) - logit(base), -Math.log(2), Math.log(2)));
    }
    const learned = learnedLifts
      .sort((left, right) => Math.abs(right) - Math.abs(left))
      .slice(0, 2)
      .reduce((sum, value) => sum + value, 0);
    return clamp(historical + learned, -Math.log(1.8), Math.log(2));
  }

  function levelRank(level) {
    const value = Number.parseFloat(String(level || "").replace("级", ""));
    return Number.isFinite(value) ? value : -1;
  }

  function hasLowLevelJoined(entries, playerById) {
    return entries.some((entry) => {
      if (entry.companion) return false;
      const rank = levelRank(entry.level || playerById.get(entry.playerId)?.level);
      return rank >= 0 && rank < 3;
    });
  }

  function guestDistribution(history, playerId) {
    const stats = history.statsById.get(playerId);
    const maximum = Math.max(0, ...history.globalGuestHistogram.keys(), ...(stats?.guestHistogram?.keys?.() || []));
    const rows = [];
    let denominator = (stats?.guestSessionCount || 0) + GUEST_PRIOR_STRENGTH;
    if (!denominator) denominator = 1;
    for (let count = 0; count <= maximum; count += 1) {
      const globalProbability = (history.globalGuestHistogram.get(count) || 0) / history.globalGuestSamples;
      const probability = ((stats?.guestHistogram.get(count) || 0) + GUEST_PRIOR_STRENGTH * globalProbability) / denominator;
      rows.push({ count, probability });
    }
    const sum = rows.reduce((total, row) => total + row.probability, 0) || 1;
    return rows.map((row) => ({ count: row.count, probability: row.probability / sum }));
  }

  function sampleDistribution(distribution, random) {
    const value = random();
    let cumulative = 0;
    for (const row of distribution) {
      cumulative += row.probability;
      if (value <= cumulative) return row.count;
    }
    return distribution.at(-1)?.count || 0;
  }

  function makeBundleUniform(ownerKey, bundles, random) {
    let bundle = bundles.get(ownerKey);
    if (!bundle) {
      bundle = { sharedUniform: random() };
      bundles.set(ownerKey, bundle);
    }
    return random() < OWNER_BUNDLE_CORRELATION ? bundle.sharedUniform : random();
  }

  function priorStreakAt(context, index, previousStreaks) {
    if (previousStreaks instanceof Map) return previousStreaks.get(context.players[index].id) ?? context.memberData[index].baseStreak;
    if (previousStreaks && previousStreaks[index] !== undefined) return previousStreaks[index];
    return context.memberData[index].baseStreak;
  }

  function fatigueFactorFor(member, priorStreak) {
    if (priorStreak <= 0) return 1;
    return priorStreak === 1 ? member.secondDayFatigueFactor : member.thirdDayFatigueFactor;
  }

  function joinProbability(context, index, previousStreaks, ignoreRulesAndFatigue = false) {
    const member = context.memberData[index];
    if (!ignoreRulesAndFatigue && member.blocked) return 0;
    const priorStreak = priorStreakAt(context, index, previousStreaks);
    const fatigue = ignoreRulesAndFatigue ? 1 : fatigueFactorFor(member, priorStreak);
    const dayProbability = sigmoid(
      context.intercept
      + member.baseEffect
      + Math.log(fatigue)
      + (ignoreRulesAndFatigue ? 0 : member.stateEffect)
    );
    return clamp(1 - ((1 - dayProbability) ** (ignoreRulesAndFatigue ? 1 : context.exposure)), 0, 1);
  }

  function simulateDay(context, random, previousStreaks = null, options = {}) {
    let ordinaryCount = 0;
    const attended = new Uint8Array(context.players.length);
    const largeCandidates = [];
    const bundles = new Map();
    const ownerIntents = new Set();

    for (let index = 0; index < context.players.length; index += 1) {
      const player = context.players[index];
      const member = context.memberData[index];
      if (player.id === options.forcedAbsentId) continue;
      const forcedPresent = player.id === options.forcedPresentId;
      const isCurrent = member.current;
      const joinIntent = forcedPresent || isCurrent || random() < joinProbability(context, index, previousStreaks, Boolean(options.neutral));
      if (!joinIntent) continue;
      ownerIntents.add(index);
      if (forcedPresent) {
        ordinaryCount += 1;
        attended[index] = 1;
        continue;
      }
      const priorStreak = priorStreakAt(context, index, previousStreaks);
       const staticFatigue = fatigueFactorFor({
         secondDayFatigueFactor: member.staticSecondDayFatigueFactor,
         thirdDayFatigueFactor: member.staticThirdDayFatigueFactor,
       }, priorStreak);
       const adaptiveFatigue = fatigueFactorFor(member, priorStreak);
       const joinedFatigueRetention = options.neutral || !isCurrent || priorStreak <= 0 || adaptiveFatigue >= 0.999
         ? 1
         : clamp(JOINED_FATIGUE_RETENTION * adaptiveFatigue / Math.max(0.05, staticFatigue), 0.2, 1);
       const blocked = !options.neutral && member.blocked;
       const conflictMultiplier = isCurrent && blocked ? 0.6 : 1;
       const regularStay = member.retention;
       const largeConfidence = member.largeConfidence;
       const followsLargeRule = random() < largeConfidence;
       const decisionUniform = makeBundleUniform(`owner:${player.id}`, bundles, random);
       const retentionAdjustment = clamp(member.retention / Math.max(0.05, context.regularRetention), 0.1, 1.5);
       if (followsLargeRule) {
         largeCandidates.push({
           index,
           highProbability: clamp(LARGE_HIGH_RETENTION * retentionAdjustment * joinedFatigueRetention * conflictMultiplier, 0, 0.999),
           lowProbability: clamp(context.largeLowRetention * retentionAdjustment * joinedFatigueRetention * conflictMultiplier, 0, 0.999),
           decisionUniform,
         });
      } else if (decisionUniform < regularStay * joinedFatigueRetention * conflictMultiplier) {
        ordinaryCount += 1;
        attended[index] = 1;
      }
    }

    for (let index = 0; index < context.current.unknownSelfCount; index += 1) {
      if (random() < 0.88) ordinaryCount += 1;
    }
    for (const entry of context.current.companionRows) {
      const ownerKey = entry.ownerId ? `owner:${entry.ownerId}` : `guest:${entry.index}`;
      for (let count = 0; count < entry.count; count += 1) {
        if (makeBundleUniform(ownerKey, bundles, random) < context.guestRetention) ordinaryCount += 1;
      }
    }

    for (const ownerIndex of ownerIntents) {
      const ownerId = context.players[ownerIndex].id;
      if (context.current.observedGuestOwners.has(ownerId)) continue;
      const guestCount = sampleDistribution(context.memberData[ownerIndex].guestDistribution, random);
      for (let count = 0; count < guestCount; count += 1) {
        if (makeBundleUniform(`owner:${ownerId}`, bundles, random) < context.guestRetention) ordinaryCount += 1;
      }
    }

    const highLargeCount = largeCandidates.filter((candidate) => candidate.decisionUniform < candidate.highProbability).length;
    const reachesLargeThreshold = ordinaryCount + highLargeCount >= LARGE_SESSION_THRESHOLD;
    let largeCount = 0;
    for (const candidate of largeCandidates) {
      const probability = reachesLargeThreshold ? candidate.highProbability : candidate.lowProbability;
      if (candidate.decisionUniform < probability) {
        largeCount += 1;
        attended[candidate.index] = 1;
      }
    }
    const finalCount = ordinaryCount + largeCount;
    return { finalCount, success: finalCount >= SUCCESS_THRESHOLD, attended };
  }

  function simulateSettledDay(context, random) {
    const attended = new Uint8Array(context.players.length);
    if (context.effectiveCurrentCount < SUCCESS_THRESHOLD) {
      return { finalCount: context.effectiveCurrentCount, success: false, attended };
    }

    if (context.effectiveCurrentCount >= LARGE_SESSION_THRESHOLD) {
      context.memberData.forEach((member, index) => {
        if (member.current) attended[index] = 1;
      });
      return { finalCount: context.effectiveCurrentCount, success: true, attended };
    }

    let finalCount = context.current.unknownSelfCount
      + context.current.companionRows.reduce((sum, row) => sum + row.count, 0);
    context.memberData.forEach((member, index) => {
      if (!member.current) return;
      const followsLargeRule = random() < member.largeConfidence;
      if (!followsLargeRule || random() < context.largeLowRetention) {
        finalCount += 1;
        attended[index] = 1;
      }
    });
    return { finalCount, success: finalCount >= SUCCESS_THRESHOLD, attended };
  }

  function makeDayContext(model, targetDate, entries, intercept, options = {}) {
    const normalizedEntries = normalizeEntries(entries);
    const current = currentEntryState(normalizedEntries);
    const resolvedPriors = resolveLearningPriors(model.learning, model.history, targetDate);
    const context = {
      ...model,
      targetDate,
      entries: normalizedEntries,
      current,
      intercept,
      shortTermRules: options.shortTermRules ?? model.shortTermRules,
      exposure: options.neutral ? 1 : remainingExposure(targetDate, model.nowParts),
      resolvedPriors,
      regularRetention: adaptiveRegularRetention(regularRetention(targetDate, model.nowParts), resolvedPriors.regularRetention),
      largeLowRetention: resolvedPriors.largeLowRetention,
      effectiveCurrentCount: current.selfIds.size + current.unknownSelfCount + current.companionRows.reduce((sum, row) => sum + row.count, 0),
      lowLevelJoined: hasLowLevelJoined(normalizedEntries, model.playerById),
    };
    context.guestRetention = Math.max(0.5, context.regularRetention - 0.03);
    const weekday = weekdayOf(targetDate);
    const countMomentum = options.neutral ? 0 : 0.1 * Math.min(context.effectiveCurrentCount, SUCCESS_THRESHOLD);
    context.memberData = context.players.map((player) => {
      const rank = levelRank(player.level);
      const signal = context.learning.membersById.get(player.id);
      const stats = context.history.statsById.get(player.id);
      const historicalParticipation = ((stats?.playCount || 0) + MEMBER_PRIOR_STRENGTH * context.resolvedPriors.participationRate)
        / Math.max(MEMBER_PRIOR_STRENGTH, context.history.successfulSessions + MEMBER_PRIOR_STRENGTH);
      const participationReference = signal?.participationRate ?? historicalParticipation;
      const capacity = context.longTerm.capacityById.get(player.id) || 1;
      const fatigueMultiplier = context.resolvedPriors.fatigueMultiplier;
      const staticSecondDayFatigueFactor = capacity >= 2 ? 1 : fatigueMultiplier;
      const staticThirdDayFatigueFactor = capacity >= 3 ? 1 : fatigueMultiplier;
      const social = options.neutral ? 0 : socialEffect(
        context.history,
        context.learning,
        player.id,
        current.selfIds,
        context.resolvedPriors.freshness,
      );
      const levelMatch = !options.neutral && context.lowLevelJoined && rank >= 0 && rank < 3 ? Math.log(1.1) : 0;
      return {
        current: current.selfIds.has(player.id),
        blocked: options.neutral ? false : ruleBlocksPlayer(context.shortTermRules, player.id, targetDate),
        capacity,
        largeConfidence: learnedLargeConfidence(
          context.longTerm.largeConfidenceById.get(player.id) || 0,
          context.resolvedPriors.largePreferenceRate,
          signal,
          context.resolvedPriors.freshness,
        ),
        baseStreak: historicalStreakBefore(context.history, player.id, targetDate),
        baseEffect: memberEffect(context.history, player.id, weekday, context.players.length)
          + learnedParticipationEffect(context.resolvedPriors.participationRate, signal, context.resolvedPriors.freshness),
        stateEffect: social + levelMatch + countMomentum,
        social,
        retention: learnedRetention(
          context.regularRetention,
          context.resolvedPriors.regularRetention,
          signal,
          context.resolvedPriors.freshness,
        ),
        staticSecondDayFatigueFactor,
        staticThirdDayFatigueFactor,
        secondDayFatigueFactor: learnedFatigueFactor(
          staticSecondDayFatigueFactor,
          signal?.secondDayRate ?? null,
          signal?.secondDayEvidence || 0,
          participationReference,
          context.resolvedPriors.fatigueMultiplier,
          context.resolvedPriors.freshness,
        ),
        thirdDayFatigueFactor: learnedFatigueFactor(
          staticThirdDayFatigueFactor,
          signal?.thirdDayRate ?? null,
          signal?.thirdDayEvidence || 0,
          participationReference,
          context.resolvedPriors.fatigueMultiplier,
          context.resolvedPriors.freshness,
        ),
        guestDistribution: learnedGuestDistribution(
          context.guestDistributionById.get(player.id),
          signal,
          context.resolvedPriors.freshness,
        ),
      };
    });
    return context;
  }

  function calibrateIntercept(model, targetDate, baseline, seed, calibrationSimulations) {
    let low = -8;
    let high = 1;
    const context = makeDayContext(model, targetDate, [], 0, { neutral: true, shortTermRules: [] });
    for (let iteration = 0; iteration < 9; iteration += 1) {
      const midpoint = (low + high) / 2;
      context.intercept = midpoint;
      const random = mulberry32(seed);
      let successes = 0;
      for (let sample = 0; sample < calibrationSimulations; sample += 1) {
        successes += simulateDay(context, random, null, { neutral: true }).success ? 1 : 0;
      }
      if (successes / calibrationSimulations < baseline) low = midpoint;
      else high = midpoint;
    }
    return (low + high) / 2;
  }

  function counterfactualUplift(model, todayContext, player, seed, simulations) {
    const candidateEntry = {
      clean: player.name,
      playerId: player.id,
      ownerId: player.id,
      companion: false,
      level: player.level,
      name: player.name,
    };
    const presentContext = makeDayContext(
      model,
      todayContext.targetDate,
      [...todayContext.entries, candidateEntry],
      todayContext.intercept,
    );
    const absentRandom = mulberry32(seed);
    const presentRandom = mulberry32(seed);
    let absentSuccesses = 0;
    let presentSuccesses = 0;
    for (let sample = 0; sample < simulations; sample += 1) {
      absentSuccesses += simulateDay(todayContext, absentRandom, null, { forcedAbsentId: player.id }).success ? 1 : 0;
      presentSuccesses += simulateDay(presentContext, presentRandom, null, { forcedPresentId: player.id }).success ? 1 : 0;
    }
    return (presentSuccesses - absentSuccesses) / simulations;
  }

  function candidateRows(model, todayContext, attendanceCounts, simulationCount, seed, counterfactualSimulations) {
    const currentIds = todayContext.current.selfIds;
    const rows = [];
    for (let index = 0; index < model.players.length; index += 1) {
      const player = model.players[index];
      if (currentIds.has(player.id)) continue;
      const member = todayContext.memberData[index];
      const stats = model.history.statsById.get(player.id);
      const blocked = member.blocked;
      const priorStreak = member.baseStreak;
      const fatigued = priorStreak > 0 && fatigueFactorFor(member, priorStreak) < 0.8;
      const social = member.social;
      const largeConfidence = member.largeConfidence;
      const learningSignal = model.learning.membersById.get(player.id);
      const attendanceProbability = blocked ? 0 : attendanceCounts[index] / Math.max(1, simulationCount);
      const rawUplift = blocked ? 0 : counterfactualUplift(
        model,
        todayContext,
        player,
        seed ^ hashString(`candidate:${player.id}`),
        counterfactualSimulations,
      );
      const uplift = Math.max(0, rawUplift);
      const reasons = [];
      const risks = [];
      if (social > 0.02) reasons.push("常与已接龙成员同场");
      if (learningSignal?.participationRate !== null && learningSignal?.participationReliability > 0
        && learningSignal.participationRate > todayContext.resolvedPriors.participationRate + 0.08) reasons.push("近期更常来");
      if ((stats?.rawPlayCount || 0) >= Math.max(3, model.history.rawSuccessfulSessions / 3)) reasons.push("历史参与较多");
      if ((stats?.rawGuestTotal || 0) >= 2) reasons.push("常带随行人员");
      if (learningSignal?.companionReliability > 0.25
        && (learningSignal.companionMean || 0) >= 0.35) reasons.push("近期常带随行人员");
      const rank = levelRank(player.level);
      if (todayContext.lowLevelJoined && rank >= 0 && rank < 3) reasons.push("水平相近");
      if (blocked) risks.push("规则显示当天不打");
      if (fatigued) risks.push("超过连续打球体力上限");
      if (largeConfidence > 0) risks.push("不足10人时可能退出");
      if (learningSignal?.participationRate !== null && learningSignal?.participationReliability > 0
        && learningSignal.participationRate < todayContext.resolvedPriors.participationRate - 0.08) risks.push("近期较少参与");
      if ((stats?.rawPlayCount || 0) < 2) risks.push((stats?.rawPlayCount || 0) === 0 ? "新成员样本少" : "历史样本较少");
      rows.push({
        playerId: player.id,
        name: String(player.name || `#${player.id}`),
        attendanceProbability: round(attendanceProbability),
        uplift: round(uplift),
        score: round(attendanceProbability * Math.max(uplift, 0)),
        eligible: !blocked,
        reasons,
        risks,
      });
    }
    rows.sort((left, right) => {
      return right.score - left.score
        || right.attendanceProbability - left.attendanceProbability
        || left.name.localeCompare(right.name, "zh-Hans-CN");
    });
    return { rows, rankingMode: "attendanceProbabilityTimesUplift" };
  }

  function buildModel(input, targetDate, nowParts) {
    const players = (Array.isArray(input.players) ? input.players : []).map((player, index) => ({
      ...player,
      id: normalizePlayerId(player?.id) || index + 1,
      name: String(player?.name || `#${index + 1}`),
    }));
    const playerById = new Map(players.map((player) => [player.id, player]));
    const completedDate = addDays(nowParts.date, -1);
    const historyEnd = compareDates(completedDate, addDays(targetDate, -1)) < 0 ? completedDate : addDays(targetDate, -1);
    const attempts = [
      ...(Array.isArray(input.attempts) ? input.attempts : []),
      ...(Array.isArray(input.groupAttempts) ? input.groupAttempts : []),
      ...(Array.isArray(input.groupAttemptOutcomes) ? input.groupAttemptOutcomes : []),
    ];
    const eligibleAttemptDates = [...normalizeAttemptOutcomes(attempts, historyEnd).keys()];
    const rawHistoryDates = [
      ...(Array.isArray(input.sessions) ? input.sessions : []).map((session) => String(session?.date || "")),
      ...eligibleAttemptDates,
    ].filter(parseIsoDate).sort(compareDates);
    const historyStart = rawHistoryDates.find((date) => compareDates(date, historyEnd) <= 0) || addDays(historyEnd, -52);
    const sessions = normalizeSessions(input.sessions, historyEnd);
    const learning = normalizeLearningSignals(input.groupLearningSignals, players);
    const history = buildHistoryStats(players, sessions, targetDate);
    learning.resolvedPriors = resolveLearningPriors(learning, history, targetDate);
    const baselines = computeWeekdayBaselines(
      sessions,
      attempts,
      historyStart,
      historyEnd,
      Number.isFinite(Number(input.missingBookingSoftSuccess)) ? clamp(Number(input.missingBookingSoftSuccess), 0, 0.5) : MISSING_BOOKING_SOFT_SUCCESS,
      Number.isFinite(Number(input.weekdayPriorStrength)) ? Math.max(0, Number(input.weekdayPriorStrength)) : WEEKDAY_PRIOR_STRENGTH,
      targetDate,
    );
    const guestDistributionById = new Map(players.map((player) => [player.id, guestDistribution(history, player.id)]));
    return {
      players,
      playerById,
      sessions,
      history,
      learning,
      guestDistributionById,
      baselines,
      historyStart,
      historyEnd,
      longTerm: buildLongTermProfile(players, history, input.longTermLists),
      shortTermRules: Array.isArray(input.shortTermRules) ? input.shortTermRules : [],
      nowParts,
    };
  }

  function isHardSettled(targetDate, nowParts) {
    const dateComparison = compareDates(targetDate, nowParts.date);
    return dateComparison < 0
      || (dateComparison === 0 && nowParts.hour * 60 + nowParts.minute >= CUTOFF_HOUR * 60);
  }

  function estimate(input = {}) {
    const nowParts = beijingNowParts(input.now);
    const targetDate = parseIsoDate(input.targetDate) ? String(input.targetDate) : nowParts.date;
    const tomorrowDate = addDays(targetDate, 1);
    const model = buildModel(input, targetDate, nowParts);
    const simulations = clamp(Math.floor(Number(input.simulations) || DEFAULT_SIMULATIONS), 200, 20000);
    const calibrationSimulations = clamp(Math.floor(Number(input.calibrationSimulations) || DEFAULT_CALIBRATION_SIMULATIONS), 200, 3000);
    const counterfactualSimulations = clamp(
      Math.floor(Number(input.counterfactualSimulations) || DEFAULT_COUNTERFACTUAL_SIMULATIONS),
      40,
      1000,
    );
    const todayBaseline = model.baselines.rows[weekdayOf(targetDate)].probability;
    const tomorrowBaseline = model.baselines.rows[weekdayOf(tomorrowDate)].probability;
    const normalizedEntries = normalizeEntries(input.entries);
    const compactEntries = normalizedEntries
      .map((entry) => `${entry.companion ? "c" : "p"}:${entry.playerId || 0}:${entry.ownerId || 0}:${entry.count}`)
      .sort()
      .join("|");
    const seed = Number.isFinite(Number(input.seed))
      ? Number(input.seed) >>> 0
      : hashString(`${targetDate}|${model.historyStart}|${model.historyEnd}|${compactEntries}`);
    const todayIntercept = calibrateIntercept(model, targetDate, todayBaseline, seed ^ 0x13579BDF, calibrationSimulations);
    const tomorrowIntercept = calibrateIntercept(model, tomorrowDate, tomorrowBaseline, seed ^ 0x2468ACE0, calibrationSimulations);
    const todayContext = makeDayContext(model, targetDate, normalizedEntries, todayIntercept);
    const tomorrowContext = makeDayContext(model, tomorrowDate, [], tomorrowIntercept);
    const todayRandom = mulberry32(seed ^ 0xA5A5A5A5);
    const tomorrowRandom = mulberry32(seed ^ 0x5A5A5A5A);
    const attendanceCounts = new Uint32Array(model.players.length);
    const hardSettled = isHardSettled(targetDate, nowParts);
    let todaySuccesses = 0;
    let tomorrowSuccesses = 0;
    let todayCountTotal = 0;
    let tomorrowCountTotal = 0;

    for (let sample = 0; sample < simulations; sample += 1) {
      const today = hardSettled
        ? simulateSettledDay(todayContext, todayRandom)
        : simulateDay(todayContext, todayRandom);
      todaySuccesses += today.success ? 1 : 0;
      todayCountTotal += today.finalCount;
      for (let index = 0; index < model.players.length; index += 1) {
        attendanceCounts[index] += today.attended[index];
      }
      const tomorrowStreaks = new Uint8Array(model.players.length);
      if (today.success) {
        for (let index = 0; index < model.players.length; index += 1) {
          tomorrowStreaks[index] = today.attended[index]
            ? todayContext.memberData[index].baseStreak + 1
            : 0;
        }
      }
      const tomorrow = simulateDay(tomorrowContext, tomorrowRandom, tomorrowStreaks);
      tomorrowSuccesses += tomorrow.success ? 1 : 0;
      tomorrowCountTotal += tomorrow.finalCount;
    }

    const todayProbability = todaySuccesses / simulations;
    const tomorrowProbability = tomorrowSuccesses / simulations;
    const includeCandidates = input.includeCandidates !== false;
    const candidates = hardSettled || !includeCandidates
      ? { rows: [], rankingMode: "attendanceProbabilityTimesUplift" }
      : candidateRows(model, todayContext, attendanceCounts, simulations, seed, counterfactualSimulations);
    const baselineRows = model.baselines.rows.map((row) => ({
      weekday: row.weekday,
      name: row.name,
      days: row.days,
      successes: row.observedSuccesses,
      effectiveDays: round(row.effectiveDays),
      effectiveSuccesses: round(row.effectiveObservedSuccesses),
      rawProbability: row.rawProbability === null ? null : round(row.rawProbability),
      probability: round(row.probability),
    }));
    const today = {
      date: targetDate,
      probability: round(todayProbability),
      percent: Math.round(todayProbability * 100),
      weekdayBaseline: round(todayBaseline),
      expectedFinalCount: round(todayCountTotal / simulations, 3),
      settled: hardSettled,
    };
    const tomorrow = {
      date: tomorrowDate,
      probability: round(tomorrowProbability),
      percent: Math.round(tomorrowProbability * 100),
      weekdayBaseline: round(tomorrowBaseline),
      expectedFinalCount: round(tomorrowCountTotal / simulations, 3),
    };
    return {
      modelVersion: "group-probability-v1",
      today,
      tomorrow,
      todayProbability: today.probability,
      tomorrowProbability: tomorrow.probability,
      weekdayBaseline: {
        overall: round(model.baselines.overall),
        today: today.weekdayBaseline,
        tomorrow: tomorrow.weekdayBaseline,
        historyStart: model.historyStart,
        historyEnd: model.historyEnd,
        rows: baselineRows,
      },
      candidates: candidates.rows,
      candidatesIncluded: includeCandidates && !hardSettled,
      rankingMode: candidates.rankingMode,
      simulationCount: simulations,
      counterfactualSimulationCount: hardSettled || !includeCandidates ? 0 : counterfactualSimulations,
      assumptions: {
        cutoffTime: "17:00",
        activityTime: "19:00",
        successThreshold: SUCCESS_THRESHOLD,
        largeSessionThreshold: LARGE_SESSION_THRESHOLD,
        missingBookingSoftSuccess: Number.isFinite(Number(input.missingBookingSoftSuccess))
          ? clamp(Number(input.missingBookingSoftSuccess), 0, 0.5)
          : MISSING_BOOKING_SOFT_SUCCESS,
        joinedFatigueRetention: JOINED_FATIGUE_RETENTION,
        historyHalfLifeDays: HISTORY_HALF_LIFE_DAYS,
        learningEvidencePrior: LEARNING_EVIDENCE_PRIOR,
        adaptiveSignalSemantics: {
          posteriorContract: "learning rates and lifts are already prior-shrunk; reliability and evidence gate application except companion source fusion",
          freshness: "generatedAt-to-targetDate decay is applied once after model generation",
          influenceLift: "directional posterior probability-point change",
          fatigueRates: "conditional consecutive-day posterior converted with participation odds",
          largePreference: "member posterior deviation from the group preference posterior adjusts history evidence",
        },
      },
      adaptation: {
        enabled: model.learning.supplied,
        historyHalfLifeDays: HISTORY_HALF_LIFE_DAYS,
        rawOutcomeDays: model.baselines.totalDays,
        effectiveOutcomeDays: round(model.baselines.totalEffectiveDays),
        rawSuccessfulSessions: model.history.rawSuccessfulSessions,
        weightedSuccessfulSessions: round(model.history.successfulSessions),
        memberSignalsReceived: model.learning.membersById.size,
        memberSignalsApplied: model.learning.memberSignalCount,
        influenceEdgesApplied: model.learning.influenceCount,
        learnedPriorsApplied: ["participationRate", "regularRetention", "fatigueMultiplier", "largePreferenceRate", "largeLowRetention"]
          .filter((key) => {
            const evidenceKey = key === "regularRetention"
              ? "regularRetentionEvidence"
              : key === "largePreferenceRate"
                ? "largePreferenceEvidence"
              : key === "largeLowRetention"
                ? "largeLowRetentionEvidence"
                : key === "fatigueMultiplier"
                  ? "fatigueEvidence"
                  : "participationEvidence";
            return model.learning.priors[key] !== null
              && (model.learning.priors[evidenceKey] === null || model.learning.priors[evidenceKey] > 0);
          }).length,
        effectivePriors: {
          freshness: round(model.learning.resolvedPriors.freshness),
          participationRate: round(model.learning.resolvedPriors.participationRate),
          regularRetention: round(model.learning.resolvedPriors.regularRetention),
          regularRetentionToday: round(adaptiveRegularRetention(
            regularRetention(targetDate, nowParts),
            model.learning.resolvedPriors.regularRetention,
          )),
          fatigueMultiplier: round(model.learning.resolvedPriors.fatigueMultiplier),
          largePreferenceRate: round(model.learning.resolvedPriors.largePreferenceRate),
          largeLowRetention: round(model.learning.resolvedPriors.largeLowRetention),
        },
      },
    };
  }

  root.BadmintonGroupProbability = Object.freeze({
    estimate,
    constants: Object.freeze({
      successThreshold: SUCCESS_THRESHOLD,
      largeSessionThreshold: LARGE_SESSION_THRESHOLD,
      weekdayPriorStrength: WEEKDAY_PRIOR_STRENGTH,
      missingBookingSoftSuccess: MISSING_BOOKING_SOFT_SUCCESS,
      fatigueMultiplier: FATIGUE_MULTIPLIER,
      historyHalfLifeDays: HISTORY_HALF_LIFE_DAYS,
      joinedFatigueRetention: JOINED_FATIGUE_RETENTION,
      largeLowRetention: LARGE_LOW_RETENTION,
      largeHighRetention: LARGE_HIGH_RETENTION,
      cutoffHour: CUTOFF_HOUR,
      activityHour: ACTIVITY_HOUR,
    }),
  });
})(globalThis);
