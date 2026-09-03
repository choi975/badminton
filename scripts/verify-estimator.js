import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assessEstimatorAnomaly,
  expandEstimatorParticipants,
  predictEstimator,
  trainEstimatorModel,
} from "../src/estimator-core.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [model, snapshot, html, workerSource, revisionMigration, provenanceMigration, confirmationMigration] = await Promise.all([
  readJson(resolve(root, "data/booking-estimator.json")),
  readJson(resolve(root, "data/bootstrap-snapshot.json")),
  readFile(resolve(root, "index.html"), "utf8"),
  readFile(resolve(root, "src/worker.js"), "utf8"),
  readFile(resolve(root, "migrations/0018_estimator_training_revision.sql"), "utf8"),
  readFile(resolve(root, "migrations/0019_participant_snapshot_provenance.sql"), "utf8"),
  readFile(resolve(root, "migrations/0020_actual_shuttle_confirmation.sql"), "utf8"),
]);
const sessions = snapshot?.data?.sessions || [];
const checks = [];

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function check(name, callback) {
  try {
    await callback();
    checks.push(true);
    console.log(`ok - ${name}`);
  } catch (error) {
    checks.push(false);
    console.error(`not ok - ${name}`);
    console.error(`  ${error.message}`);
  }
}

function typesById(target = model) {
  assert.ok(Array.isArray(target.shuttleTypes) && target.shuttleTypes.length, "shuttleTypes must not be empty");
  return new Map(target.shuttleTypes.map((type) => [String(type.id), type]));
}

function sessionParticipants(session) {
  return expandEstimatorParticipants(session.players || []);
}

function shuttleRows(session) {
  if (Array.isArray(session.shuttlePriceRows) && session.shuttlePriceRows.length) return session.shuttlePriceRows;
  if (!(Number(session.shuttleCount) > 0)) return [];
  const type = [...typesById().values()].find((candidate) => (
    (candidate.prices || []).some((price) => Math.abs(Number(price) - Number(session.shuttlePrice)) < 0.02)
  ));
  return [{ type: type?.id || "unknown", price: session.shuttlePrice, count: session.shuttleCount }];
}

function pureTypeRow(session) {
  const counts = sessionTypeCounts(session);
  return counts.size === 1 ? [...counts.entries()][0] : null;
}

function sessionTypeCounts(session) {
  const counts = new Map();
  for (const row of shuttleRows(session)) {
    if (!(Number(row.count) > 0)) continue;
    counts.set(String(row.type || "unknown"), (counts.get(String(row.type || "unknown")) || 0) + Number(row.count));
  }
  return counts;
}

function participant(playerId, gender = "男", level = "3级") {
  return { playerId, gender, level };
}

function syntheticSession(date, typeId, actual, participants, extra = {}) {
  return {
    date,
    participants,
    participantCount: participants.length,
    courtCount: 1,
    shuttleCounts: { [typeId]: actual },
    ...extra,
  };
}

function syntheticTypes() {
  return [
    { id: "rsl3", name: "RSL3", prices: [10] },
    { id: "as05", name: "AS05", prices: [13] },
  ];
}

await check("model and snapshot use the same v5 artifact", () => {
  assert.equal(model.version, 5);
  assert.equal(snapshot?.data?.estimator?.version, 5);
  assert.ok(Number.isInteger(model.trainingRevision) && model.trainingRevision > 0);
  assert.deepEqual(snapshot.data.estimator, model);
});

await check("court capacity remains data-trained and independent from shuttle profiles", () => {
  assert.equal(model.court.formula, "ceil(participantCount / peoplePerCourt)");
  assert.equal(model.court.minimum, 1);
  assert.equal(model.court.selection.strategy, "grid-search");
  assert.ok(model.court.peoplePerCourt >= model.court.selection.candidates.min);
  assert.ok(model.court.peoplePerCourt <= model.court.selection.candidates.max);
});

await check("every shuttle type owns a complete independent model", () => {
  assert.deepEqual(model.shuttle.hierarchy, ["type", "gender", "genderLevel", "member"]);
  assert.equal(model.shuttle.formula, "ceil(rawExpected + riskScale * sqrt(max(rawExpected, 1)))");
  assert.match(model.shuttle.participantRateFormula, /exp/);
  assert.equal(model.shuttle.baseType, undefined);
  assert.equal(model.shuttle.weightedShuttlesPerParticipant, undefined);
  for (const type of typesById().values()) {
    assert.equal(type.weight, undefined);
    assert.equal(type.durability, undefined);
    const typeModel = model.shuttle.models[type.id];
    assert.ok(typeModel);
    assert.ok(Number.isFinite(typeModel.baseRate) && typeModel.baseRate > 0);
    assert.ok(Number.isFinite(typeModel.riskScale) && typeModel.riskScale >= 0);
    assert.equal(typeModel.riskBuffer, undefined);
    assert.equal(typeModel.support, undefined);
    assert.ok(typeModel.effects?.gender && typeModel.effects?.genderLevel && typeModel.effects?.member);
  }
});

await check("hierarchical effects are enabled only after beating the global baseline", () => {
  for (const typeModel of Object.values(model.shuttle.models)) {
    if (typeModel.trainingMode === "hierarchical") {
      assert.ok(Number.isFinite(typeModel.regularization.baselineMae));
      assert.ok(typeModel.validation.mae < typeModel.regularization.baselineMae - typeModel.regularization.requiredImprovement);
      assert.ok(Object.values(typeModel.effects).some((effects) => Object.keys(effects).length > 0));
    } else {
      assert.ok(Object.values(typeModel.effects).every((effects) => Object.keys(effects).length === 0));
    }
  }
});

await check("exclusive and mixed records are classified from the committed history", () => {
  for (const type of typesById().values()) {
    const exclusive = sessions.filter((session) => session.trainShuttle !== false && pureTypeRow(session)?.[0] === type.id).length;
    const mixed = sessions.filter((session) => {
      const counts = sessionTypeCounts(session);
      return session.trainShuttle !== false && counts.size > 1 && counts.has(type.id);
    }).length;
    const expectedWindow = Math.min(exclusive, model.shuttle.maximumTrainingSessionsPerType);
    assert.equal(model.shuttle.models[type.id].training.sampleCount, expectedWindow);
    assert.equal(model.shuttle.models[type.id].training.availableSampleCount, exclusive);
    assert.equal(model.shuttle.models[type.id].training.mixedExcludedCount, mixed);
    assert.equal(type.sampleCount, expectedWindow);
    if (!exclusive) assert.equal(model.shuttle.models[type.id].trainingMode, "cold-start");
  }
});

await check("legacy aggregate rows keep one known member and anonymize extra slots", () => {
  const expanded = expandEstimatorParticipants([
    { player_id: 7, slots: 3, plus_count: 2, gender_snapshot: "男", level_snapshot: "4级" },
    { player_id: null, is_companion: 1, slots: 1, gender_snapshot: "女", level_snapshot: "3级" },
  ]);
  assert.equal(expanded.length, 4);
  assert.deepEqual(expanded[0], { playerId: "7", gender: "男", level: "4级" });
  assert.deepEqual(expanded.slice(1, 3), [
    { playerId: null, gender: "不详", level: "不详" },
    { playerId: null, gender: "不详", level: "不详" },
  ]);
  assert.deepEqual(expanded[3], { playerId: null, gender: "女", level: "3级" });
});

await check("absent owners and unreliable legacy profiles never leak into participant features", () => {
  const absentOwner = expandEstimatorParticipants([
    { player_id: 7, slots: 2, plus_count: 2, gender_snapshot: "男", level_snapshot: "4级" },
  ]);
  assert.deepEqual(absentOwner, [
    { playerId: null, gender: "不详", level: "不详" },
    { playerId: null, gender: "不详", level: "不详" },
  ]);
  const anonymousKnownProfile = expandEstimatorParticipants([
    { player_id: null, slots: 2, plus_count: 0, gender_snapshot: "女", level_snapshot: "3级" },
  ]);
  assert.deepEqual(anonymousKnownProfile[0], { playerId: null, gender: "女", level: "3级" });
  assert.deepEqual(anonymousKnownProfile[1], { playerId: null, gender: "不详", level: "不详" });
  const unreliable = expandEstimatorParticipants([
    { player_id: 9, slots: 1, plus_count: 0, gender_snapshot: "女", level_snapshot: "5级" },
  ], 0, { profileReliable: false });
  assert.deepEqual(unreliable, [{ playerId: "9", gender: "不详", level: "不详" }]);
});

await check("gender and gender-level effects change independent predictions", () => {
  const training = [];
  for (let index = 0; index < 8; index += 1) {
    training.push(syntheticSession(`2026-01-${String(index + 1).padStart(2, "0")}`, "rsl3", 1, [participant(null, "男", "3级")]));
    training.push(syntheticSession(`2026-02-${String(index + 1).padStart(2, "0")}`, "rsl3", 2, [participant(null, "女", "3级")]));
    training.push(syntheticSession(`2026-03-${String(index + 1).padStart(2, "0")}`, "rsl3", 3, [participant(null, "男", "5级")]));
  }
  training.sort((left, right) => left.date.localeCompare(right.date));
  const trained = trainEstimatorModel({ sessions: training, shuttleTypes: syntheticTypes(), generatedAt: "test" });
  assert.equal(trained.shuttle.models.rsl3.trainingMode, "hierarchical");
  const maleThree = predictEstimator(trained, [participant(null, "男", "3级")]).shuttleExpected.rsl3;
  const femaleThree = predictEstimator(trained, [participant(null, "女", "3级")]).shuttleExpected.rsl3;
  const maleFive = predictEstimator(trained, [participant(null, "男", "5级")]).shuttleExpected.rsl3;
  assert.ok(femaleThree > maleThree, `${femaleThree} should exceed ${maleThree}`);
  assert.ok(maleFive > maleThree, `${maleFive} should exceed ${maleThree}`);
  assert.ok(Object.keys(trained.shuttle.models.rsl3.effects.gender).length > 0);
  assert.ok(Object.keys(trained.shuttle.models.rsl3.effects.genderLevel).length > 0);
});

await check("same-profile members can learn opposite preferences for different shuttle types", () => {
  const training = [];
  for (let index = 0; index < 8; index += 1) {
    const day = String(index + 1).padStart(2, "0");
    training.push(syntheticSession(`2026-01-${day}`, "rsl3", 1, [participant(1)]));
    training.push(syntheticSession(`2026-02-${day}`, "rsl3", 3, [participant(2)]));
    training.push(syntheticSession(`2026-03-${day}`, "as05", 3, [participant(1)]));
    training.push(syntheticSession(`2026-04-${day}`, "as05", 1, [participant(2)]));
  }
  training.sort((left, right) => left.date.localeCompare(right.date));
  const trained = trainEstimatorModel({ sessions: training, shuttleTypes: syntheticTypes(), generatedAt: "test" });
  assert.equal(trained.shuttle.models.rsl3.trainingMode, "hierarchical");
  assert.equal(trained.shuttle.models.as05.trainingMode, "hierarchical");
  const a = predictEstimator(trained, [participant(1)]).shuttleExpected;
  const b = predictEstimator(trained, [participant(2)]).shuttleExpected;
  assert.ok(a.rsl3 < b.rsl3, `RSL3: ${a.rsl3} should be below ${b.rsl3}`);
  assert.ok(a.as05 > b.as05, `AS05: ${a.as05} should exceed ${b.as05}`);
  assert.ok(trained.shuttle.models.rsl3.effects.member["1"] < trained.shuttle.models.rsl3.effects.member["2"]);
  assert.ok(trained.shuttle.models.as05.effects.member["1"] > trained.shuttle.models.as05.effects.member["2"]);
});

await check("small holdouts and one extreme record cannot prematurely enable or explode the hierarchy", () => {
  const training = [];
  for (let index = 0; index < 5; index += 1) {
    training.push(syntheticSession(`2026-01-0${index + 1}`, "rsl3", 1, [participant(1)]));
  }
  training.push(syntheticSession("2026-01-06", "rsl3", 10, [participant(2)]));
  const six = trainEstimatorModel({ sessions: training, shuttleTypes: syntheticTypes(), generatedAt: "six" });
  assert.equal(six.shuttle.models.rsl3.trainingMode, "global-only");
  assert.ok(six.shuttle.models.rsl3.riskScale <= 2);
  assert.ok(predictEstimator(six, [participant(1)]).shuttleCounts.rsl3 <= 5);

  training.push(syntheticSession("2026-01-07", "rsl3", 1, [participant(1)]));
  const seven = trainEstimatorModel({ sessions: training, shuttleTypes: syntheticTypes(), generatedAt: "seven" });
  assert.equal(seven.shuttle.models.rsl3.trainingMode, "global-only");
  assert.ok(predictEstimator(seven, [participant(1)]).shuttleCounts.rsl3 <= 5);
});

await check("changing one shuttle type never changes another type model", () => {
  const base = [];
  for (let index = 0; index < 8; index += 1) {
    const day = String(index + 1).padStart(2, "0");
    base.push(syntheticSession(`2026-01-${day}`, "rsl3", index % 2 ? 2 : 1, [participant(index % 2 ? 1 : 2)]));
    base.push(syntheticSession(`2026-02-${day}`, "as05", 1, [participant(index % 2 ? 1 : 2)]));
  }
  const changed = base.map((session) => session.shuttleCounts.as05
    ? { ...session, shuttleCounts: { as05: session.shuttleCounts.as05 + 3 } }
    : session);
  const first = trainEstimatorModel({ sessions: base, shuttleTypes: syntheticTypes(), generatedAt: "first" });
  const second = trainEstimatorModel({ sessions: changed, shuttleTypes: syntheticTypes(), generatedAt: "second" });
  assert.deepEqual(first.shuttle.models.rsl3, second.shuttle.models.rsl3);
});

await check("training output is deterministic regardless of input order", () => {
  const training = [];
  for (let index = 0; index < 10; index += 1) {
    const day = String(index + 1).padStart(2, "0");
    training.push(syntheticSession(`2026-05-${day}`, "rsl3", index % 2 ? 2 : 1, [participant(index % 2 ? 1 : 2)]));
  }
  const forward = trainEstimatorModel({ sessions: training, shuttleTypes: syntheticTypes(), generatedAt: "same" });
  const reversed = trainEstimatorModel({ sessions: [...training].reverse(), shuttleTypes: syntheticTypes(), generatedAt: "same" });
  assert.deepEqual(forward, reversed);
});

await check("the rolling training window remains bounded after 120 type-specific records", () => {
  const training = Array.from({ length: 121 }, (_, index) => syntheticSession(
    `2026-${String(Math.floor(index / 28) + 1).padStart(2, "0")}-${String((index % 28) + 1).padStart(2, "0")}`,
    "rsl3",
    index === 0 ? 5 : 1,
    [participant(1)],
  ));
  const trained = trainEstimatorModel({ sessions: training, shuttleTypes: syntheticTypes(), generatedAt: "window" });
  assert.equal(trained.shuttle.models.rsl3.training.sampleCount, 120);
  assert.equal(trained.shuttle.models.rsl3.training.availableSampleCount, 121);
  assert.equal(trained.shuttle.models.rsl3.training.olderExcludedCount, 1);
  assert.equal(trained.shuttle.models.rsl3.training.dateRange.from, training[1].date);
});

await check("mixed-type sessions are excluded rather than converted through a multiplier", () => {
  const trained = trainEstimatorModel({
    generatedAt: "test",
    shuttleTypes: syntheticTypes(),
    sessions: [{
      date: "2026-01-01",
      participants: [participant(1), participant(2)],
      participantCount: 2,
      courtCount: 1,
      shuttleCounts: { rsl3: 2, as05: 3 },
    }],
  });
  assert.equal(trained.shuttle.models.rsl3.training.sampleCount, 0);
  assert.equal(trained.shuttle.models.as05.training.sampleCount, 0);
  assert.equal(trained.shuttle.models.rsl3.training.mixedExcludedCount, 1);
  assert.equal(trained.shuttle.models.as05.training.mixedExcludedCount, 1);
  assert.equal(trained.shuttle.models.rsl3.trainingMode, "cold-start");
  assert.equal(trained.shuttle.models.as05.trainingMode, "cold-start");
});

await check("unconfirmed estimates never become shuttle training labels", () => {
  const trained = trainEstimatorModel({
    generatedAt: "test",
    shuttleTypes: syntheticTypes(),
    sessions: [
      syntheticSession("2026-01-01", "rsl3", 1, [participant(1)]),
      syntheticSession("2026-01-02", "rsl3", 100, [participant(1)], { actualShuttleConfirmed: false }),
    ],
  });
  assert.equal(trained.training.shuttle.unconfirmedExcludedCount, 1);
  assert.equal(trained.shuttle.models.rsl3.training.sampleCount, 1);
  assert.equal(trained.shuttle.models.rsl3.baseRate, 1);
});

await check("numeric callers remain supported with an anonymous-profile fallback", () => {
  const prediction = predictEstimator(model, 20);
  assert.equal(prediction.participantCount, 20);
  assert.ok(prediction.courts > 0);
  for (const count of Object.values(prediction.shuttleCounts)) assert.ok(Number.isInteger(count) && count > 0);
});

await check("historical exclusive records replay with finite bounded outputs", () => {
  const errors = [];
  for (const session of sessions) {
    if (session.trainShuttle === false) continue;
    const pure = pureTypeRow(session);
    if (!pure || !model.shuttle.models[pure[0]]) continue;
    const prediction = predictEstimator(model, sessionParticipants(session));
    assert.ok(Number.isFinite(prediction.shuttleExpected[pure[0]]));
    errors.push(prediction.shuttleCounts[pure[0]] - pure[1]);
  }
  assert.ok(errors.length > 0);
  const mae = errors.reduce((sum, error) => sum + Math.abs(error), 0) / errors.length;
  assert.ok(mae <= 6, `historical shuttle MAE ${mae} is too high`);
});

await check("anomaly checks compare exclusive types and abstain for mixed records", () => {
  const roster = [participant(1), participant(2), participant(3)];
  const prediction = predictEstimator(model, roster);
  const primaryType = model.shuttleTypes[0].id;
  const boundary = assessEstimatorAnomaly({
    estimator: model,
    participants: roster,
    courtCount: prediction.courts,
    shuttleRows: [{ type: primaryType, count: prediction.shuttleCounts[primaryType] + 2 }],
  });
  assert.equal(boundary.shuttle.comparable, true);
  assert.equal(boundary.anomalous, true);
  const partlyUnknown = assessEstimatorAnomaly({
    estimator: model,
    participants: roster,
    courtCount: prediction.courts,
    shuttleRows: [
      { type: primaryType, count: prediction.shuttleCounts[primaryType] },
      { type: "unknown", count: 20 },
    ],
  });
  assert.equal(partlyUnknown.shuttle.comparable, false);
  assert.equal(partlyUnknown.anomalous, false);
  if (model.shuttleTypes.length > 1) {
    const mixed = assessEstimatorAnomaly({
      estimator: model,
      participants: roster,
      courtCount: prediction.courts,
      shuttleRows: model.shuttleTypes.slice(0, 2).map((type) => ({ type: type.id, count: 99 })),
    });
    assert.equal(mixed.shuttle.comparable, false);
    assert.equal(mixed.anomalous, false);
  }
});

await check("browser estimator mirrors the positive-rate and dynamic-risk formulas", () => {
  assert.match(html, /Math\.exp\(Math\.min\(Math\.log\(5\)/);
  assert.match(html, /typeModel\.riskScale/);
  assert.match(html, /Math\.sqrt\(Math\.max\(rawExpected, 1\)\)/);
  assert.match(html, /型号 × 性别 × 等级 × 成员/);
  assert.doesNotMatch(html, /rsl3Equivalent\s*=/);
});

await check("record confirmation and edit round-trips protect training labels", () => {
  assert.match(html, /openTrainingDecision\(\{ mode: "direct", record, courtCount \}\)/);
  assert.match(html, /不是系统预估值/);
  assert.match(html, /trainCourt: confirmation \? true : shouldTrain/);
  assert.match(html, /preserveSnapshot: true/);
  assert.match(html, /preservedPlayerId/);
  assert.match(html, /preservedProfileSnapshotReliable/);
  assert.match(html, /trainCourt: session\.trainCourt !== false/);
  assert.match(html, /trainShuttle: session\.trainShuttle !== false/);
  assert.match(html, /courtRows\.length > 1 \|\| shuttleRows\.length > 0/);
  assert.match(html, /unknownOption\.textContent = "待确认型号"/);
  assert.doesNotMatch(html, /findShuttleTypeByPrice\(Number\(row\.price\)\)\s*\|\|\s*types\[0\]/);
});

await check("profile provenance is persisted instead of inferred from editable dates", () => {
  assert.match(provenanceMigration, /ADD COLUMN profile_snapshot_reliable INTEGER NOT NULL DEFAULT 1/);
  assert.match(provenanceMigration, /SET profile_snapshot_reliable = 0/);
  assert.match(workerSource, /p\.profile_snapshot_reliable/);
  assert.match(workerSource, /profile_snapshot_reliable, updated_at/);
  assert.ok(sessions.flatMap((session) => session.players || [])
    .every((player) => typeof player.profileSnapshotReliable === "boolean"));
});

await check("actual shuttle confirmation is persisted separately from training inclusion", () => {
  assert.match(confirmationMigration, /ADD COLUMN actual_shuttle_confirmed INTEGER NOT NULL DEFAULT 0/);
  assert.match(confirmationMigration, /SET actual_shuttle_confirmed = 1/);
  assert.match(workerSource, /actual_shuttle_confirmed/);
  assert.match(html, /actualShuttleConfirmed/);
  assert.match(html, /trainShuttle: shouldTrain,/);
  assert.match(html, /actualShuttleConfirmed: Number\(pending\.record\?\.shuttleCount\) > 0 \? shouldTrain : true/);
  assert.ok(sessions.every((session) => typeof session.actualShuttleConfirmed === "boolean"));
});

await check("D1 revisions make stale v5 models self-healing", () => {
  const triggerCount = (revisionMigration.match(/CREATE TRIGGER IF NOT EXISTS/g) || []).length;
  assert.equal(triggerCount, 9);
  assert.match(workerSource, /Number\(model\.trainingRevision\) === trainingRevision/);
  assert.match(workerSource, /trainingRevision !== startingRevision/);
  assert.match(workerSource, /storedRevision !== trainingRevision/);
  assert.match(workerSource, /trainEstimatorModel\(\{ sessions, shuttleTypes, trainingRevision \}\)/);
});

console.log(`\n${checks.filter(Boolean).length}/${checks.length} estimator checks passed`);
if (checks.some((passed) => !passed)) process.exitCode = 1;
