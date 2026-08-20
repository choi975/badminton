import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const modelPath = resolve(root, "data/booking-estimator.json");
const snapshotPath = resolve(root, "data/bootstrap-snapshot.json");

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`无法读取 ${path}: ${error.message}`);
  }
}

const [model, snapshot] = await Promise.all([
  readJson(modelPath),
  readJson(snapshotPath),
]);

const sessions = snapshot?.data?.sessions;
assert.ok(Array.isArray(sessions), "bootstrap snapshot 缺少 data.sessions");

const checks = [];

async function check(name, callback) {
  try {
    await callback();
    checks.push({ name, passed: true });
    console.log(`ok - ${name}`);
  } catch (error) {
    checks.push({ name, passed: false, error });
    console.error(`not ok - ${name}`);
    console.error(`  ${error.message}`);
  }
}

function finiteNumber(value, label) {
  assert.equal(typeof value, "number", `${label} 必须是数字`);
  assert.ok(Number.isFinite(value), `${label} 必须是有限数字`);
  return value;
}

function assertNear(actual, expected, tolerance, label) {
  finiteNumber(actual, label);
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label} 应为 ${expected}（允许误差 ${tolerance}），实际为 ${actual}`,
  );
}

function excludedDates(trainingSection) {
  assert.ok(Array.isArray(trainingSection?.excludedSessions), "excludedSessions 必须是数组");
  return new Set(trainingSection.excludedSessions.map((item) => (
    typeof item === "string" ? item : String(item?.date || "")
  )));
}

function participantCount(session) {
  assert.ok(Array.isArray(session.players), `${session.date} 缺少参与者列表`);
  return session.players.reduce((total, participant) => {
    const slots = Number(participant.slots);
    if (Number.isInteger(slots) && slots >= 0) return total + slots;
    const plusCount = Math.max(0, Math.floor(Number(participant.plusCount) || 0));
    return total + 1 + plusCount;
  }, 0);
}

function shuttleTypesById(estimator = model) {
  assert.ok(Array.isArray(estimator.shuttleTypes), "shuttleTypes 必须是数组");
  return new Map(estimator.shuttleTypes.map((type) => [String(type.id), type]));
}

function resolveShuttleType(row, estimator = model) {
  const types = shuttleTypesById(estimator);
  const explicitType = String(row?.type || "").trim();
  if (explicitType) {
    const type = types.get(explicitType);
    assert.ok(type, `未登记球型号 ${explicitType}`);
    return type;
  }

  const price = Number(row?.price);
  assert.ok(Number.isFinite(price), "旧用球记录缺少可识别的价格");
  const matches = [...types.values()].filter((type) => (
    Array.isArray(type.prices)
      && type.prices.some((knownPrice) => Math.abs(Number(knownPrice) - price) < 0.02)
  ));
  assert.equal(matches.length, 1, `价格 ${price} 未能唯一匹配球型号`);
  return matches[0];
}

function shuttleEquivalent(session, estimator = model) {
  const rows = Array.isArray(session.shuttlePriceRows)
    ? session.shuttlePriceRows.filter((row) => Number(row?.count) > 0)
    : [];
  const effectiveRows = rows.length
    ? rows
    : [{ price: session.shuttlePrice, count: session.shuttleCount }];
  return effectiveRows.reduce((total, row) => {
    const count = Number(row.count);
    assert.ok(Number.isFinite(count) && count > 0, `${session.date} 的用球数量无效`);
    const type = resolveShuttleType(row, estimator);
    const durability = finiteNumber(type.durability, `${type.id}.durability`);
    assert.ok(durability > 0, `${type.id}.durability 必须大于 0`);
    return total + count * durability;
  }, 0);
}

function estimateCourts(count, estimator = model) {
  assert.ok(Number.isInteger(count) && count >= 0, "participantCount 必须是非负整数");
  if (count === 0) return 0;
  const capacity = finiteNumber(estimator.court?.peoplePerCourt, "court.peoplePerCourt");
  const minimum = finiteNumber(estimator.court?.minimum, "court.minimum");
  assert.ok(capacity > 0, "court.peoplePerCourt 必须大于 0");
  return Math.max(minimum, Math.ceil(count / capacity));
}

function estimateShuttles(count, typeId, estimator = model) {
  assert.ok(Number.isInteger(count) && count >= 0, "participantCount 必须是非负整数");
  if (count === 0) return 0;
  const type = shuttleTypesById(estimator).get(String(typeId || ""));
  assert.ok(type, `未登记球型号 ${typeId || "(缺失)"}`);
  const rate = finiteNumber(
    estimator.shuttle?.rsl3EquivalentPerParticipant,
    "shuttle.rsl3EquivalentPerParticipant",
  );
  const buffer = finiteNumber(estimator.shuttle?.riskBuffer, "shuttle.riskBuffer");
  const minimum = finiteNumber(estimator.shuttle?.minimum, "shuttle.minimum");
  const durability = finiteNumber(type.durability, `${type.id}.durability`);
  assert.ok(rate > 0, "shuttle.rsl3EquivalentPerParticipant 必须大于 0");
  assert.ok(buffer >= 0, "shuttle.riskBuffer 不能小于 0");
  assert.ok(durability > 0, `${type.id}.durability 必须大于 0`);
  return Math.max(minimum, Math.ceil((count * rate + buffer) / durability));
}

function validationContract(validation, historicalRows, label) {
  assert.equal(validation?.method, "rolling-origin", `${label}.validation.method 必须是 rolling-origin`);
  const minimumTrainingSessions = finiteNumber(
    validation.minimumTrainingSessions,
    `${label}.validation.minimumTrainingSessions`,
  );
  const folds = finiteNumber(validation.folds, `${label}.validation.folds`);
  assert.ok(Number.isInteger(minimumTrainingSessions) && minimumTrainingSessions >= 3);
  assert.ok(Number.isInteger(folds) && folds > 0);
  const expectedFolds = historicalRows.filter((holdout) => (
    historicalRows.filter((candidate) => String(candidate.date) < String(holdout.date)).length
      >= minimumTrainingSessions
  )).length;
  assert.equal(
    folds,
    expectedFolds,
    `${label}.validation.folds 应覆盖每个有足够历史前缀的日期`,
  );

  const mae = finiteNumber(validation.mae, `${label}.validation.mae`);
  const rmse = finiteNumber(validation.rmse, `${label}.validation.rmse`);
  const exactRate = finiteNumber(validation.exactRate, `${label}.validation.exactRate`);
  const bias = finiteNumber(validation.bias, `${label}.validation.bias`);
  const underPredictionRate = finiteNumber(
    validation.underPredictionRate,
    `${label}.validation.underPredictionRate`,
  );
  assert.ok(mae >= 0, `${label}.validation.mae 不能小于 0`);
  assert.ok(rmse + 1e-9 >= mae, `${label}.validation.rmse 不应小于 mae`);
  assert.ok(exactRate >= 0 && exactRate <= 1, `${label}.validation.exactRate 必须在 0 到 1 之间`);
  assert.ok(Math.abs(bias) <= rmse + 1e-9, `${label}.validation.bias 超出 rmse 合理范围`);
  assert.ok(
    underPredictionRate >= 0 && underPredictionRate <= 1,
    `${label}.validation.underPredictionRate 必须在 0 到 1 之间`,
  );
}

function dateRange(rows) {
  const dates = rows.map((session) => String(session.date)).sort();
  return { from: dates[0], to: dates.at(-1) };
}

function eligibleSessions(kind) {
  const training = model.training?.[kind];
  const exclusions = excludedDates(training);
  return sessions.filter((session) => {
    if (exclusions.has(String(session.date))) return false;
    if (participantCount(session) <= 0) return false;
    if (kind === "court") return Number(session.courtCount) > 0;
    return Number(session.shuttleCount) > 0;
  });
}

function errorMetrics(errors) {
  assert.ok(errors.length > 0, "没有可回测的历史场次");
  const sum = errors.reduce((total, error) => total + error, 0);
  const absolute = errors.reduce((total, error) => total + Math.abs(error), 0);
  const squared = errors.reduce((total, error) => total + error ** 2, 0);
  return {
    mae: absolute / errors.length,
    rmse: Math.sqrt(squared / errors.length),
    exactRate: errors.filter((error) => Math.abs(error) < 1e-9).length / errors.length,
    bias: sum / errors.length,
    underPredictionRate: errors.filter((error) => error < -1e-9).length / errors.length,
  };
}

await check("模型与快照使用同一份 v3 产物", () => {
  assert.equal(model.version, 3, `需要 booking estimator v3，当前是 v${model.version ?? "unknown"}`);
  assert.equal(snapshot?.data?.estimator?.version, 3, "bootstrap snapshot 仍未更新到 estimator v3");
  assert.deepEqual(snapshot.data.estimator, model, "快照内嵌模型与 data/booking-estimator.json 不一致");
});

await check("v3 使用人数容量公式且移除稀疏个人权重", () => {
  assert.equal(model.court?.formula, "ceil(participantCount / peoplePerCourt)");
  assert.equal(model.court?.minimum, 1);
  const capacity = finiteNumber(model.court?.peoplePerCourt, "court.peoplePerCourt");
  const search = model.court?.selection?.candidates;
  assert.equal(model.court?.selection?.strategy, "grid-search");
  assert.equal(model.court?.selection?.objective, "mae-then-rmse");
  assertNear(model.court?.selection?.defaultPeoplePerCourt, 7.5, 1e-9, "defaultPeoplePerCourt");
  assert.ok(search && finiteNumber(search.min, "court.selection.candidates.min") > 0);
  assert.ok(search.max >= search.min, "场地容量搜索上限不能小于下限");
  assert.ok(search.step > 0, "场地容量搜索步长必须大于 0");
  assert.ok(capacity >= search.min && capacity <= search.max, "场地容量必须来自声明的搜索范围");
  const gridIndex = (capacity - search.min) / search.step;
  assert.ok(Math.abs(gridIndex - Math.round(gridIndex)) < 1e-9, "场地容量必须落在声明的搜索网格上");
  assert.equal(model.court?.genderLevelWeights, undefined);
  assert.equal(model.court?.memberAdjustments, undefined);
  assert.equal(model.court?.intercept, undefined);
  assert.equal(model.shuttle?.genderLevelWeights, undefined);
  assert.equal(model.shuttle?.memberAdjustments, undefined);
  assert.equal(model.shuttle?.intercept, undefined);
});

await check("场地容量边界保持稳定", () => {
  const capacity = model.court.peoplePerCourt;
  const firstBoundary = Math.floor(capacity);
  const secondBoundary = Math.floor(capacity * 2);
  const cases = new Map([
    [0, 0],
    [1, 1],
    [firstBoundary, 1],
    [firstBoundary + 1, 2],
    [secondBoundary, 2],
    [secondBoundary + 1, 3],
  ]);
  for (const [people, expected] of cases) {
    assert.equal(estimateCourts(people), expected, `${people} 人的场地数应为 ${expected}`);
  }
});

await check("未知或缺失成员资料不会退化成一人一场", () => {
  const people = Math.max(1, Math.floor(model.court.peoplePerCourt));
  const unknownParticipants = Array.from({ length: people }, () => ({}));
  const profiledParticipants = Array.from({ length: people }, (_, index) => ({
    gender: index % 2 ? "女" : "男",
    level: `${2 + index * 0.5}级`,
  }));
  assert.equal(estimateCourts(unknownParticipants.length), 1);
  assert.equal(
    estimateCourts(unknownParticipants.length),
    estimateCourts(profiledParticipants.length),
    "v3 结果只应取决于有效参与人数",
  );
  assert.ok(estimateCourts(27) <= 5, "27 个未知成员不应接近一人一场");
});

await check("用球公式按登记型号的耐打系数换算", () => {
  assert.equal(
    model.shuttle?.formula,
    "ceil((participantCount * rsl3EquivalentPerParticipant + riskBuffer) / durability)",
  );
  assert.equal(model.shuttle?.baseType, "rsl3");
  assert.equal(model.shuttle?.minimum, 1);
  const rate = finiteNumber(
    model.shuttle?.rsl3EquivalentPerParticipant,
    "shuttle.rsl3EquivalentPerParticipant",
  );
  const quantile = finiteNumber(model.shuttle?.riskQuantile, "shuttle.riskQuantile");
  const buffer = finiteNumber(model.shuttle?.riskBuffer, "shuttle.riskBuffer");
  assert.ok(rate >= 0.5 && rate <= 1.25, `人均亚3等价量 ${rate} 已偏离合理区间`);
  assert.ok(quantile >= 0.5 && quantile <= 0.99, `风险分位数 ${quantile} 不合理`);
  assert.ok(buffer >= 0, `风险缓冲 ${buffer} 不合理`);

  const types = shuttleTypesById();
  assertNear(types.get("rsl3")?.durability, 1, 1e-9, "rsl3.durability");
  assertNear(types.get("as05")?.durability, 1.2, 1e-9, "as05.durability");
  const people = 27;
  const equivalent = people * rate + buffer;
  assert.equal(estimateShuttles(people, "rsl3"), Math.ceil(equivalent));
  assert.equal(estimateShuttles(people, "as05"), Math.ceil(equivalent / 1.2));
  assert.ok(estimateShuttles(people, "as05") < estimateShuttles(people, "rsl3"));
  assert.throws(() => estimateShuttles(people, ""), /未登记球型号/);
  assert.throws(
    () => resolveShuttleType({ type: "not-registered", price: 11.3 }),
    /未登记球型号/,
    "显式未知 type 不能按价格偷偷回退为亚3",
  );
  assert.equal(resolveShuttleType({ price: 11.3 }).id, "rsl3", "旧记录允许按已知价格识别");
});

await check("训练样本按场地和用球分别排除异常场次", () => {
  const courtDates = excludedDates(model.training?.court);
  const shuttleDates = excludedDates(model.training?.shuttle);
  assert.deepEqual([...courtDates].sort(), ["2026-08-10"]);
  assert.deepEqual([...shuttleDates].sort(), ["2026-08-04"]);

  const courtSessions = eligibleSessions("court");
  const shuttleSessions = eligibleSessions("shuttle");
  assert.equal(model.training.court.sampleCount, courtSessions.length);
  assert.equal(model.training.shuttle.sampleCount, shuttleSessions.length);
  assert.deepEqual(model.training.court.dateRange, dateRange(courtSessions));
  assert.deepEqual(model.training.shuttle.dateRange, dateRange(shuttleSessions));
  assert.deepEqual(model.training.dateRange, dateRange([...courtSessions, ...shuttleSessions]));
});

await check("发布的滚动回测指标完整且未退化", () => {
  validationContract(model.court?.validation, eligibleSessions("court"), "court");
  validationContract(model.shuttle?.validation, eligibleSessions("shuttle"), "shuttle");
  assert.ok(model.court.validation.mae <= 0.5, "场地 rolling MAE 不应高于 0.5 个场地");
  assert.ok(model.court.validation.rmse <= 0.75, "场地 rolling RMSE 不应高于 0.75");
  assert.ok(model.court.validation.exactRate >= 0.6, "场地 rolling 命中率不应低于 60%");
  assert.ok(
    model.court.validation.underPredictionRate <= 0.25,
    "场地 rolling 少订比例不应高于 25%",
  );
  assert.ok(model.shuttle.validation.mae <= 4, "用球 rolling MAE 不应高于 4 颗亚3等价量");
  assert.ok(model.shuttle.validation.rmse <= 5, "用球 rolling RMSE 不应高于 5");
  assert.ok(
    model.shuttle.validation.underPredictionRate <= 0.4,
    "风险缓冲后的 rolling 少带球比例不应高于 40%",
  );
});

await check("当前快照的全历史重放保持基线质量", () => {
  const courtRows = eligibleSessions("court");
  const courtMetrics = errorMetrics(courtRows.map((session) => (
    estimateCourts(participantCount(session)) - Number(session.courtCount)
  )));
  assert.ok(courtMetrics.mae <= 0.25, `场地全历史 MAE ${courtMetrics.mae.toFixed(3)} 超过 0.25`);
  assert.ok(courtMetrics.rmse <= 0.6, `场地全历史 RMSE ${courtMetrics.rmse.toFixed(3)} 超过 0.6`);
  assert.ok(courtMetrics.exactRate >= 0.8, "场地全历史命中率不应低于 80%");
  assert.ok(courtMetrics.underPredictionRate <= 0.2, "场地全历史少订比例不应高于 20%");

  const shuttleRows = eligibleSessions("shuttle");
  const shuttleMetrics = errorMetrics(shuttleRows.map((session) => (
    estimateShuttles(participantCount(session), model.shuttle.baseType)
      - shuttleEquivalent(session)
  )));
  assert.ok(shuttleMetrics.mae <= 3.5, `用球全历史 MAE ${shuttleMetrics.mae.toFixed(3)} 超过 3.5`);
  assert.ok(shuttleMetrics.rmse <= 4.5, `用球全历史 RMSE ${shuttleMetrics.rmse.toFixed(3)} 超过 4.5`);
  assert.ok(
    shuttleMetrics.underPredictionRate <= 0.35,
    `用球全历史少带比例 ${(shuttleMetrics.underPredictionRate * 100).toFixed(1)}% 超过 35%`,
  );

  console.log(
    `  replay: court MAE=${courtMetrics.mae.toFixed(3)}, exact=${(courtMetrics.exactRate * 100).toFixed(1)}%; `
      + `shuttle MAE=${shuttleMetrics.mae.toFixed(3)}, RMSE=${shuttleMetrics.rmse.toFixed(3)}, `
      + `under=${(shuttleMetrics.underPredictionRate * 100).toFixed(1)}%`,
  );
});

const failed = checks.filter((item) => !item.passed);
console.log(`\n${checks.length - failed.length}/${checks.length} estimator checks passed`);
if (failed.length) process.exitCode = 1;
