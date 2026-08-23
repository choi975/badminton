import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { trainEstimatorModel, predictEstimator, assessEstimatorAnomaly } from "../src/estimator-core.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [model, snapshot] = await Promise.all([
  readJson(resolve(root, "data/booking-estimator.json")),
  readJson(resolve(root, "data/bootstrap-snapshot.json")),
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

function typesById() {
  assert.ok(Array.isArray(model.shuttleTypes) && model.shuttleTypes.length, "shuttleTypes 必须非空");
  return new Map(model.shuttleTypes.map((type) => [String(type.id), type]));
}

function participantCount(session) {
  return (session.players || []).reduce((sum, player) => sum + Math.max(0, Number(player.slots) || 0), 0);
}

function shuttleRows(session) {
  if (Array.isArray(session.shuttlePriceRows) && session.shuttlePriceRows.length) return session.shuttlePriceRows;
  return Number(session.shuttleCount) > 0
    ? [{ price: session.shuttlePrice, count: session.shuttleCount }]
    : [];
}

function typeForRow(row) {
  const types = typesById();
  if (types.has(String(row.type))) return types.get(String(row.type));
  const price = Number(row.price);
  return [...types.values()].find((type) => (type.prices || []).some((known) => Math.abs(Number(known) - price) < 0.02));
}

function actualWorkload(session) {
  return shuttleRows(session).reduce((sum, row) => {
    const type = typeForRow(row);
    assert.ok(type, `${session.date} 的球型号无法识别`);
    return sum + Number(row.count || 0) * Number(type.weight ?? type.durability ?? 1);
  }, 0);
}

await check("模型与快照使用同一份 v4 产物", () => {
  assert.equal(model.version, 4);
  assert.equal(snapshot?.data?.estimator?.version, 4);
  assert.deepEqual(snapshot.data.estimator, model);
});

await check("场地模型使用动态容量公式", () => {
  assert.equal(model.court.formula, "ceil(participantCount / peoplePerCourt)");
  assert.equal(model.court.minimum, 1);
  assert.equal(model.court.selection.strategy, "grid-search");
  assert.ok(model.court.peoplePerCourt >= model.court.selection.candidates.min);
  assert.ok(model.court.peoplePerCourt <= model.court.selection.candidates.max);
  assert.equal(model.court.genderLevelWeights, undefined);
  assert.equal(model.court.memberAdjustments, undefined);
});

await check("每种球独立学习权重并保留价格", () => {
  const types = typesById();
  const rsl3 = types.get("rsl3");
  const as05 = types.get("as05");
  assert.equal(rsl3.weight, 1);
  assert.ok(as05 && Number.isFinite(as05.weight) && as05.weight > 0);
  assert.ok(["learned", "estimated-prior"].includes(as05.weightSource));
  assert.ok(Array.isArray(as05.prices) && as05.prices.length);
  assert.equal(as05.durability, undefined);
});

await check("稀疏球型号也由数据推导而非固定倍数", () => {
  const trained = trainEstimatorModel({
    generatedAt: "test",
    shuttleTypes: [
      { id: "rsl3", name: "亚3", prices: [10] },
      { id: "as05", name: "AS05", prices: [13] },
      { id: "new", name: "新球", prices: [15] },
    ],
    sessions: [
      { date: "1", participantCount: 10, courtCount: 2, shuttleCounts: { rsl3: 10 } },
      { date: "2", participantCount: 20, courtCount: 3, shuttleCounts: { rsl3: 20 } },
      { date: "3", participantCount: 10, courtCount: 2, shuttleCounts: { as05: 5 } },
    ],
  });
  const types = new Map(trained.shuttleTypes.map((type) => [type.id, type]));
  assert.equal(types.get("as05").weight, 2);
  assert.equal(types.get("as05").weightSource, "learned");
  assert.equal(types.get("new").weight, 2);
  assert.equal(types.get("new").weightSource, "estimated-prior");
});

await check("用球公式按型号权重计算", () => {
  const types = typesById();
  assert.equal(model.shuttle.formula, "ceil((participantCount * weightedShuttlesPerParticipant + riskBuffer) / weight)");
  const prediction = predictEstimator(model, 20);
  assert.equal(prediction.shuttleCounts.rsl3, Math.ceil(prediction.workload / Number(types.get("rsl3").weight)));
  assert.ok(prediction.shuttleCounts.as05 > 0);
});

await check("训练标记能分别控制场地和用球样本", () => {
  const excludedCourt = sessions.find((session) => session.date === "2026-08-10");
  const excludedShuttle = sessions.find((session) => session.date === "2026-08-04");
  assert.equal(excludedCourt?.trainCourt, false);
  assert.equal(excludedCourt?.trainShuttle, true);
  assert.equal(excludedShuttle?.trainCourt, true);
  assert.equal(excludedShuttle?.trainShuttle, false);
  assert.ok(model.training.court.sampleCount > 0);
  assert.ok(model.training.shuttle.sampleCount > 0);
});

await check("历史回放维持合理误差", () => {
  const courtErrors = [];
  const shuttleErrors = [];
  for (const session of sessions) {
    const count = participantCount(session);
    if (!count) continue;
    const prediction = predictEstimator(model, count);
    if (session.trainCourt !== false && Number(session.courtCount) > 0) {
      courtErrors.push(prediction.courts - Number(session.courtCount));
    }
    if (session.trainShuttle !== false && shuttleRows(session).length) {
      shuttleErrors.push(prediction.workload - actualWorkload(session));
    }
  }
  assert.ok(courtErrors.length && shuttleErrors.length);
  const mae = (errors) => errors.reduce((sum, error) => sum + Math.abs(error), 0) / errors.length;
  assert.ok(mae(courtErrors) <= 1);
  assert.ok(mae(shuttleErrors) <= 6);
});

await check("异常阈值为场地超过1个或用球超过2颗", () => {
  const prediction = predictEstimator(model, 10);
  const normal = assessEstimatorAnomaly({
    estimator: model,
    participantCount: 10,
    courtCount: prediction.courts,
    shuttleRows: [{ type: "rsl3", count: prediction.shuttleCounts.rsl3 }],
  });
  assert.equal(normal.anomalous, false);
  const abnormal = assessEstimatorAnomaly({
    estimator: model,
    participantCount: 10,
    courtCount: prediction.courts + 2,
    shuttleRows: [{ type: "rsl3", count: prediction.shuttleCounts.rsl3 + 3 }],
  });
  assert.equal(abnormal.anomalous, true);
});

console.log(`\n${checks.filter(Boolean).length}/${checks.length} estimator checks passed`);
if (checks.some((passed) => !passed)) process.exitCode = 1;
