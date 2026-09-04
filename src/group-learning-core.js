const DAY_MS = 86_400_000;
const LARGE_SESSION_SIZE = 10;
export const GROUP_LEARNING_VERSION = "group-learning-v1";

const DEFAULTS = Object.freeze({
  participationRate: 0.18,
  regularRetention: 0.95,
  fatigueMultiplier: 0.2,
  largeLowRetention: 0.3,
  largePreferenceRate: 0.08,
  companionRate: 0.08,
  companionMean: 0.1,
});

const PRIOR_STRENGTH = Object.freeze({
  participation: 12,
  regularRetention: 20,
  largeLowRetention: 12,
  memberParticipation: 6,
  memberRetention: 5,
  memberFatigue: 4,
  memberLargePreference: 5,
  companion: 5,
  influence: 10,
});

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value, digits = 6) {
  if (!Number.isFinite(Number(value))) return 0;
  const scale = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * scale) / scale;
}

function count(value, maximum = 100) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? clamp(Math.floor(numeric), 0, maximum) : 0;
}

function playerId(value) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized > 0 ? normalized : null;
}

function isoDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "";
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const timestamp = Date.parse(`${date}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === date ? date : "";
}

function dateTimestamp(date) {
  return Date.parse(`${date}T00:00:00.000Z`);
}

function addDays(date, amount) {
  return new Date(dateTimestamp(date) + amount * DAY_MS).toISOString().slice(0, 10);
}

function beijingDate(value) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const fields = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function decayWeight(date, today, halfLifeDays) {
  const age = Math.max(0, (dateTimestamp(today) - dateTimestamp(date)) / DAY_MS);
  return 2 ** (-age / halfLifeDays);
}

function betaMean(prior, strength, successes, trials, limits) {
  if (!(trials > 0)) return prior;
  const value = (prior * strength + clamp(successes, 0, trials)) / (strength + trials);
  return clamp(value, limits[0], limits[1]);
}

function reliability(evidence, strength) {
  return evidence > 0 ? clamp(evidence / (evidence + strength), 0, 1) : 0;
}

function odds(probability) {
  const value = clamp(Number(probability) || 0, 0.0001, 0.9999);
  return value / (1 - value);
}

function probabilityFromOdds(value) {
  return value / (1 + value);
}

function isCompanion(row) {
  return row?.isCompanion === true || row?.isCompanion === 1 || row?.isCompanion === "1";
}

function sessionSlots(row) {
  const raw = row?.slots;
  return raw === undefined || raw === null || raw === "" ? 1 : count(raw);
}

function sessionOwnerId(row) {
  return playerId(row?.ownerPlayerId ?? row?.owner_player_id ?? row?.playerId ?? row?.player_id);
}

function sessionSelfId(row) {
  if (isCompanion(row)) return null;
  const id = playerId(row?.playerId ?? row?.player_id ?? row?.ownerPlayerId ?? row?.owner_player_id);
  const slots = sessionSlots(row);
  const plusCount = count(row?.plusCount ?? row?.plus_count);
  return slots > plusCount ? id : null;
}

function sessionGuestCount(row) {
  const slots = sessionSlots(row);
  const plusCount = count(row?.plusCount ?? row?.plus_count);
  if (isCompanion(row)) return slots;
  const ownerPresent = Boolean(sessionSelfId(row));
  return Math.max(plusCount, slots - (ownerPresent ? 1 : 0));
}

function normalizeSession(raw) {
  const date = isoDate(raw?.date ?? raw?.activityDate ?? raw?.activity_date);
  if (!date) return null;
  const ids = new Set();
  const guests = new Map();
  let calculatedCount = 0;
  for (const row of Array.isArray(raw?.players) ? raw.players : Array.isArray(raw?.participants) ? raw.participants : []) {
    const id = sessionSelfId(row);
    if (id) ids.add(id);
    const ownerId = sessionOwnerId(row);
    const guestCount = sessionGuestCount(row);
    if (ownerId && guestCount > 0) guests.set(ownerId, (guests.get(ownerId) || 0) + guestCount);
    calculatedCount += sessionSlots(row);
  }
  const suppliedCount = Number(raw?.participantCount ?? raw?.participant_count);
  const participantCount = Number.isFinite(suppliedCount) && suppliedCount >= 0
    ? Math.floor(suppliedCount)
    : calculatedCount;
  return { date, ids, guests, participantCount, id: Number(raw?.id) || 0 };
}

function normalizeCompanions(value) {
  const result = new Map();
  const add = (rawId, rawCount) => {
    const id = playerId(rawId);
    const guestCount = count(rawCount);
    if (id && guestCount) result.set(id, (result.get(id) || 0) + guestCount);
  };
  if (Array.isArray(value)) {
    for (const item of value) {
      if (Array.isArray(item)) add(item[0], item[1]);
      else add(item?.ownerPlayerId ?? item?.owner_player_id ?? item?.playerId, item?.count);
    }
  } else if (value && typeof value === "object") {
    for (const [id, count] of Object.entries(value)) add(id, count);
  }
  return result;
}

function isTrialSource(value) {
  return /trial|simulation|hypothetical|what.?if|test/i.test(String(value || ""));
}

function settledOutcome(attempt, activityDate, today) {
  const outcome = String(attempt?.outcome ?? attempt?.status ?? "").toLowerCase();
  if (["success", "failure", "failed", "cancelled", "canceled"].includes(outcome)) return true;
  if (["pending", "open", "active"].includes(outcome)) return false;
  return activityDate < today;
}

function snapshotTimestamp(snapshot, activityDate) {
  const raw = snapshot?.observedAt ?? snapshot?.observed_at;
  const timestamp = Date.parse(String(raw || ""));
  return Number.isFinite(timestamp) ? timestamp : dateTimestamp(activityDate);
}

function normalizeAttempt(raw, today, nowTimestamp) {
  const activityDate = isoDate(raw?.activityDate ?? raw?.activity_date ?? raw?.date);
  if (!activityDate || activityDate > today) return null;
  const attemptState = String(raw?.trainingState ?? raw?.training_state ?? "eligible").toLowerCase();
  if (attemptState !== "eligible" || isTrialSource(raw?.source)) return null;
  const snapshots = (Array.isArray(raw?.snapshots) ? raw.snapshots : [])
    .filter((snapshot) => {
      const state = String(snapshot?.trainingState ?? snapshot?.training_state ?? "eligible").toLowerCase();
      return state === "eligible"
        && !isTrialSource(snapshot?.source)
        && snapshotTimestamp(snapshot, activityDate) <= nowTimestamp;
    })
    .map((snapshot) => ({
      id: Number(snapshot?.id) || 0,
      timestamp: snapshotTimestamp(snapshot, activityDate),
      participantCount: count(snapshot?.participantCount ?? snapshot?.participant_count),
      ids: new Set((Array.isArray(snapshot?.knownPlayerIds ?? snapshot?.known_player_ids)
        ? snapshot.knownPlayerIds ?? snapshot.known_player_ids
        : []).map(playerId).filter(Boolean)),
      guests: normalizeCompanions(snapshot?.companionsByOwner ?? snapshot?.companions_by_owner),
    }))
    .sort((left, right) => left.timestamp - right.timestamp || left.id - right.id);
  if (!snapshots.length) return null;
  return {
    id: Number(raw?.id) || 0,
    activityDate,
    outcome: String(raw?.outcome || "").toLowerCase(),
    settled: settledOutcome(raw, activityDate, today),
    snapshots,
  };
}

function memberTemplate(id, membershipStart) {
  return {
    id,
    membershipStart,
    attemptWeight: 0,
    joinedWeight: 0,
    retainedWeight: 0,
    retentionWeight: 0,
    companionWeight: 0,
    companionTotal: 0,
    largePositive: 0,
    largeNegative: 0,
    secondSuccess: 0,
    secondEvidence: 0,
    thirdSuccess: 0,
    thirdEvidence: 0,
    lastObservedDate: null,
  };
}

function latestDate(left, right) {
  if (!right) return left;
  return !left || right > left ? right : left;
}

function createdDate(player) {
  const raw = String(player?.createdAt ?? player?.created_at ?? player?.joinedAt ?? player?.joined_at ?? "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return isoDate(raw);
  const sqlUtc = raw.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/)
    ? `${raw.replace(" ", "T")}Z`
    : raw;
  const timestamp = new Date(sqlUtc);
  return Number.isNaN(timestamp.getTime()) ? isoDate(raw) : beijingDate(timestamp);
}

function firstObservedDates(sessions, attempts) {
  const result = new Map();
  const observe = (id, date) => {
    if (!id) return;
    const previous = result.get(id);
    if (!previous || date < previous) result.set(id, date);
  };
  for (const session of sessions) for (const id of session.ids) observe(id, session.date);
  for (const attempt of attempts) {
    for (const snapshot of attempt.snapshots) for (const id of snapshot.ids) observe(id, attempt.activityDate);
  }
  return result;
}

function attendanceByDate(sessions) {
  const result = new Map();
  for (const session of sessions) {
    const current = result.get(session.date) || { ids: new Set(), guests: new Map(), participantCount: 0 };
    for (const id of session.ids) current.ids.add(id);
    for (const [id, count] of session.guests) current.guests.set(id, (current.guests.get(id) || 0) + count);
    current.participantCount = Math.max(current.participantCount, session.participantCount);
    result.set(session.date, current);
  }
  return result;
}

function rosterDelta(current, previous) {
  return [...current].filter((id) => !previous.has(id)).sort((left, right) => left - right);
}

/**
 * Aggregate completed group attempts into recency-weighted, JSON-safe learning signals.
 */
export function buildGroupLearningSignals({
  players = [],
  sessions = [],
  attempts = [],
  now,
  halfLifeDays = 30,
} = {}) {
  const nowDate = now === undefined ? new Date() : new Date(now);
  if (Number.isNaN(nowDate.getTime())) throw new TypeError("now must be a valid date");
  if (!Number.isFinite(Number(halfLifeDays)) || Number(halfLifeDays) <= 0) {
    throw new RangeError("halfLifeDays must be greater than zero");
  }
  const halfLife = Number(halfLifeDays);
  const today = beijingDate(nowDate);
  const normalizedSessions = (Array.isArray(sessions) ? sessions : [])
    .map(normalizeSession)
    .filter((session) => session && session.date <= today)
    .sort((left, right) => left.date.localeCompare(right.date) || left.id - right.id);
  const normalizedAttempts = (Array.isArray(attempts) ? attempts : [])
    .map((attempt) => normalizeAttempt(attempt, today, nowDate.getTime()))
    .filter(Boolean)
    .sort((left, right) => left.activityDate.localeCompare(right.activityDate) || left.id - right.id);
  const completedAttempts = normalizedAttempts.filter((attempt) => attempt.settled);
  const attendance = attendanceByDate(normalizedSessions);
  const observedStarts = firstObservedDates(normalizedSessions, normalizedAttempts);

  const knownIds = new Set((Array.isArray(players) ? players : []).map((player) => playerId(player?.id)).filter(Boolean));
  for (const id of observedStarts.keys()) knownIds.add(id);
  const playerById = new Map((Array.isArray(players) ? players : [])
    .map((player) => [playerId(player?.id), player])
    .filter(([id]) => id));
  const memberStats = new Map([...knownIds].sort((left, right) => left - right).map((id) => {
    const explicitStart = createdDate(playerById.get(id));
    const inferredStart = observedStarts.get(id) || "";
    const membershipStart = explicitStart || inferredStart || null;
    return [id, memberTemplate(id, membershipStart)];
  }));

  let totalAttemptWeight = 0;
  let totalJoinedWeight = 0;
  let retentionTrials = 0;
  let retentionSuccesses = 0;
  const lowRetentionRows = [];
  const influenceCounts = new Map();
  let eligibleSnapshotCount = 0;

  for (const attempt of completedAttempts) {
    const weight = decayWeight(attempt.activityDate, today, halfLife);
    const last = attempt.snapshots.at(-1);
    const actual = attendance.get(attempt.activityDate);
    const everIds = new Set();
    const guestActivityOwners = new Set();
    let maxObservedCount = 0;
    for (const snapshot of attempt.snapshots) {
      eligibleSnapshotCount += 1;
      maxObservedCount = Math.max(maxObservedCount, snapshot.participantCount);
      for (const id of snapshot.ids) everIds.add(id);
      for (const id of snapshot.guests.keys()) guestActivityOwners.add(id);
    }
    const hasActualOutcome = actual && attempt.outcome === "success";
    const finalIds = hasActualOutcome ? actual.ids : last.ids;
    const finalGuests = hasActualOutcome ? actual.guests : last.guests;
    const finalCount = hasActualOutcome ? actual.participantCount : last.participantCount;
    for (const id of finalGuests.keys()) guestActivityOwners.add(id);

    for (const [id, stats] of memberStats) {
      if (!stats.membershipStart || attempt.activityDate < stats.membershipStart) continue;
      stats.attemptWeight += weight;
      stats.lastObservedDate = latestDate(stats.lastObservedDate, attempt.activityDate);
      totalAttemptWeight += weight;
      const ownerJoined = everIds.has(id) || finalIds.has(id);
      if (ownerJoined) {
        stats.joinedWeight += weight;
        totalJoinedWeight += weight;
        stats.retentionWeight += weight;
        retentionTrials += weight;
        if (finalIds.has(id)) {
          stats.retainedWeight += weight;
          retentionSuccesses += weight;
        }

        if (finalCount < LARGE_SESSION_SIZE) {
          if (finalIds.has(id)) stats.largeNegative += weight;
          else stats.largePositive += weight * (maxObservedCount >= LARGE_SESSION_SIZE ? 2 : 1.5);
          lowRetentionRows.push({ id, retained: finalIds.has(id), weight });
        } else if (finalIds.has(id)) {
          stats.largePositive += weight * 0.25;
        }
      }

      if (ownerJoined || guestActivityOwners.has(id)) {
        stats.companionWeight += weight;
        stats.companionTotal += weight * (finalGuests.get(id) || 0);
      }
    }

    // A source is credited only when it was newly added in one snapshot and the
    // target arrived in the immediately following roster change.
    const additions = [];
    let previousIds = new Set();
    for (const snapshot of attempt.snapshots) {
      const added = rosterDelta(snapshot.ids, previousIds);
      const changed = added.length || rosterDelta(previousIds, snapshot.ids).length;
      if (changed) additions.push({ ids: added, roster: snapshot.ids, timestamp: snapshot.timestamp });
      previousIds = snapshot.ids;
    }
    const attemptInfluenceKey = `${attempt.activityDate}:${attempt.id}`;
    for (let index = 0; index + 1 < additions.length; index += 1) {
      const sources = additions[index].ids;
      const targets = additions[index + 1].ids;
      if (!sources.length) continue;
      for (const source of sources) {
        if (!memberStats.has(source)) continue;
        for (const [target, targetStats] of memberStats) {
          if (source === target || additions[index].roster.has(target)) continue;
          if (!targetStats.membershipStart || attempt.activityDate < targetStats.membershipStart) continue;
          const key = `${source}:${target}`;
          const row = influenceCounts.get(key) || {
            source,
            target,
            evidence: 0,
            successes: 0,
            evidenceAttempts: new Set(),
            successAttempts: new Set(),
          };
          if (!row.evidenceAttempts.has(attemptInfluenceKey)) {
            row.evidence += weight;
            row.evidenceAttempts.add(attemptInfluenceKey);
          }
          if (targets.includes(target) && !row.successAttempts.has(attemptInfluenceKey)) {
            row.successes += weight;
            row.successAttempts.add(attemptInfluenceKey);
          }
          influenceCounts.set(key, row);
        }
      }
    }
  }

  // Bookings establish actual attendance and stamina context. Large-session and
  // companion behavior stay attempt-only because the probability core already
  // learns those two signals directly from historical sessions.
  for (const session of normalizedSessions) {
    for (const id of session.ids) {
      const stats = memberStats.get(id);
      if (!stats) continue;
      stats.lastObservedDate = latestDate(stats.lastObservedDate, session.date);
    }
  }

  let fatigueTrials = 0;
  let fatigueSuccesses = 0;
  for (const attempt of completedAttempts) {
    const date = attempt.activityDate;
    const yesterday = addDays(date, -1);
    const yesterdaySession = attendance.get(yesterday);
    if (!yesterdaySession || yesterdaySession.participantCount < 6) continue;
    const todaySession = attendance.get(date);
    const todayAttendance = attempt.outcome === "success" && todaySession?.participantCount >= 6
      ? todaySession.ids
      : attempt.outcome === "failure"
        ? attempt.snapshots.at(-1).ids
        : new Set();
    const yesterdayAttendance = yesterdaySession.ids;
    const twoDaysAgo = addDays(date, -2);
    const priorSession = attendance.get(twoDaysAgo);
    const priorAttendance = priorSession?.participantCount >= 6 ? priorSession.ids : new Set();
    const weight = decayWeight(date, today, halfLife);
    for (const id of yesterdayAttendance) {
      const stats = memberStats.get(id);
      if (!stats || (stats.membershipStart && date < stats.membershipStart)) continue;
      stats.secondEvidence += weight;
      fatigueTrials += weight;
      if (todayAttendance.has(id)) {
        stats.secondSuccess += weight;
        fatigueSuccesses += weight;
      }
      if (priorAttendance.has(id)) {
        stats.thirdEvidence += weight;
        if (todayAttendance.has(id)) stats.thirdSuccess += weight;
      }
    }
  }

  const calibratedParticipation = betaMean(
    DEFAULTS.participationRate,
    PRIOR_STRENGTH.participation,
    totalJoinedWeight,
    totalAttemptWeight,
    [0.02, 0.85],
  );
  const calibratedRetention = betaMean(
    DEFAULTS.regularRetention,
    PRIOR_STRENGTH.regularRetention,
    retentionSuccesses,
    retentionTrials,
    [0.5, 0.995],
  );
  const fatigueConditionalPrior = probabilityFromOdds(
    odds(calibratedParticipation) * DEFAULTS.fatigueMultiplier,
  );
  const calibratedFatigueConditional = fatigueConditionalPrior;
  const calibratedFatigueMultiplier = DEFAULTS.fatigueMultiplier;

  let totalLargePositive = 0;
  let totalLargeTrials = 0;
  let totalCompanionWeight = 0;
  let totalCompanionSuccess = 0;
  let totalCompanionCount = 0;
  for (const stats of memberStats.values()) {
    const rawLargeEvidence = stats.largePositive + stats.largeNegative;
    const memberEvidence = reliability(rawLargeEvidence, 5);
    const memberSignal = stats.largePositive
      / Math.max(1e-9, stats.largePositive + 2 * stats.largeNegative + 5);
    totalLargePositive += memberEvidence * memberSignal;
    totalLargeTrials += memberEvidence;
    totalCompanionWeight += stats.companionWeight;
    totalCompanionSuccess += Math.min(stats.companionWeight, stats.companionTotal);
    totalCompanionCount += stats.companionTotal;
  }
  const calibratedLargePreference = betaMean(
    DEFAULTS.largePreferenceRate,
    PRIOR_STRENGTH.participation,
    totalLargePositive,
    totalLargeTrials,
    [0.01, 0.35],
  );
  const calibratedCompanionRate = betaMean(
    DEFAULTS.companionRate,
    PRIOR_STRENGTH.companion,
    totalCompanionSuccess,
    totalCompanionWeight,
    [0.01, 0.8],
  );
  const calibratedCompanionMean = clamp(
    (DEFAULTS.companionMean * PRIOR_STRENGTH.companion + totalCompanionCount)
      / (PRIOR_STRENGTH.companion + totalCompanionWeight),
    0,
    12,
  );

  const preliminaryMembers = new Map();
  for (const [id, stats] of memberStats) {
    const largeEvidence = stats.largePositive + stats.largeNegative;
    preliminaryMembers.set(id, {
      participationRate: betaMean(
        calibratedParticipation,
        PRIOR_STRENGTH.memberParticipation,
        stats.joinedWeight,
        stats.attemptWeight,
        [0.01, 0.95],
      ),
      largePreferenceConfidence: betaMean(
        calibratedLargePreference,
        PRIOR_STRENGTH.memberLargePreference,
        stats.largePositive,
        stats.largePositive + 2 * stats.largeNegative,
        [0.01, 0.95],
      ),
      largePreferenceEvidence: largeEvidence,
    });
  }

  let largeLowTrials = 0;
  let largeLowSuccesses = 0;
  for (const row of lowRetentionRows) {
    const confidence = preliminaryMembers.get(row.id)?.largePreferenceConfidence || 0;
    const preferenceSpecificity = clamp(
      (confidence - calibratedLargePreference) / Math.max(0.01, 1 - calibratedLargePreference),
      0,
      1,
    );
    const weightedTrial = row.weight * preferenceSpecificity;
    largeLowTrials += weightedTrial;
    if (row.retained) largeLowSuccesses += weightedTrial;
  }
  const calibratedLargeLowRetention = betaMean(
    DEFAULTS.largeLowRetention,
    PRIOR_STRENGTH.largeLowRetention,
    largeLowSuccesses,
    largeLowTrials,
    [0.05, 0.9],
  );

  const members = {};
  for (const [id, stats] of memberStats) {
    const preliminary = preliminaryMembers.get(id);
    const memberFatiguePrior = probabilityFromOdds(
      odds(preliminary.participationRate) * DEFAULTS.fatigueMultiplier,
    );
    const retentionRate = betaMean(
      calibratedRetention,
      PRIOR_STRENGTH.memberRetention,
      stats.retainedWeight,
      stats.retentionWeight,
      [0.5, 0.995],
    );
    const secondDayRate = betaMean(
      memberFatiguePrior,
      PRIOR_STRENGTH.memberFatigue,
      stats.secondSuccess,
      stats.secondEvidence,
      [0.001, 0.98],
    );
    const thirdDayRate = betaMean(
      memberFatiguePrior,
      PRIOR_STRENGTH.memberFatigue,
      stats.thirdSuccess,
      stats.thirdEvidence,
      [0.001, 0.98],
    );
    members[String(id)] = {
      attemptWeight: round(stats.attemptWeight),
      joinedWeight: round(stats.joinedWeight),
      participationRate: round(preliminary.participationRate),
      participationReliability: round(reliability(stats.attemptWeight, PRIOR_STRENGTH.memberParticipation)),
      retentionRate: round(retentionRate),
      retentionReliability: round(reliability(stats.retentionWeight, PRIOR_STRENGTH.memberRetention)),
      largePreferenceConfidence: round(preliminary.largePreferenceConfidence),
      largePreferenceEvidence: round(preliminary.largePreferenceEvidence),
      secondDayRate: round(secondDayRate),
      secondDayEvidence: round(stats.secondEvidence),
      thirdDayRate: round(thirdDayRate),
      thirdDayEvidence: round(stats.thirdEvidence),
      companionRate: round(betaMean(
        calibratedCompanionRate,
        PRIOR_STRENGTH.companion,
        Math.min(stats.companionWeight, stats.companionTotal),
        stats.companionWeight,
        [0.01, 0.95],
      )),
      companionMean: round(stats.companionWeight > 0
        ? (calibratedCompanionMean * PRIOR_STRENGTH.companion + stats.companionTotal)
          / (PRIOR_STRENGTH.companion + stats.companionWeight)
        : calibratedCompanionMean),
      companionReliability: round(reliability(stats.companionWeight, PRIOR_STRENGTH.companion)),
      lastObservedDate: stats.lastObservedDate,
    };
  }

  const influence = {};
  for (const row of [...influenceCounts.values()].sort((left, right) => left.source - right.source || left.target - right.target)) {
    const rawSuccessEvents = row.successAttempts.size;
    if (rawSuccessEvents < 3) continue;
    const targetRate = preliminaryMembers.get(row.target)?.participationRate || calibratedParticipation;
    const conditionalRate = (
      row.successes + PRIOR_STRENGTH.influence * targetRate
    ) / (row.evidence + PRIOR_STRENGTH.influence);
    const shrinkage = reliability(row.evidence, PRIOR_STRENGTH.influence);
    const lift = clamp(conditionalRate - targetRate, -0.12, 0.15);
    const sourceKey = String(row.source);
    if (!influence[sourceKey]) influence[sourceKey] = {};
    influence[sourceKey][String(row.target)] = {
      lift: round(lift),
      evidence: round(row.evidence),
      rawSuccessEvents,
      reliability: round(shrinkage),
    };
  }

  const excludedSnapshotCount = (Array.isArray(attempts) ? attempts : []).reduce((sum, attempt) => (
    sum + (Array.isArray(attempt?.snapshots) ? attempt.snapshots : []).filter((snapshot) => (
      String(snapshot?.trainingState ?? snapshot?.training_state ?? "eligible").toLowerCase() !== "eligible"
    )).length
  ), 0);

  return {
    version: GROUP_LEARNING_VERSION,
    generatedAt: nowDate.toISOString(),
    generatedDate: today,
    halfLifeDays: halfLife,
    training: {
      playerCount: Object.keys(members).length,
      sessionCount: normalizedSessions.length,
      attemptCount: Array.isArray(attempts) ? attempts.length : 0,
      eligibleAttemptCount: completedAttempts.length,
      eligibleSnapshotCount,
      excludedSnapshotCount,
      effectiveAttemptWeight: round(completedAttempts.reduce(
        (sum, attempt) => sum + decayWeight(attempt.activityDate, today, halfLife),
        0,
      )),
    },
    priors: {
      participationRate: round(calibratedParticipation),
      participationEvidence: round(totalAttemptWeight),
      regularRetention: round(calibratedRetention),
      regularRetentionEvidence: round(retentionTrials),
      fatigueMultiplier: round(calibratedFatigueMultiplier),
      fatigueConditionalRate: round(calibratedFatigueConditional),
      fatigueEvidence: 0,
      observedFatigueEvidence: round(fatigueTrials),
      observedFatigueSuccessWeight: round(fatigueSuccesses),
      largePreferenceRate: round(calibratedLargePreference),
      largePreferenceEvidence: round(totalLargeTrials),
      largeLowRetention: round(calibratedLargeLowRetention),
      largeLowRetentionEvidence: round(largeLowTrials),
      companionRate: round(calibratedCompanionRate),
      companionMean: round(calibratedCompanionMean),
      companionEvidence: round(totalCompanionWeight),
    },
    members,
    influence,
  };
}

export default buildGroupLearningSignals;
