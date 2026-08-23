import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Executable business-rule baseline. The production UI remains an inline
// script, so the pure functions below define the contract rather than import it.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const indexHtml = readFileSync(join(root, "index.html"), "utf8");
const workerSource = readFileSync(join(root, "src", "worker.js"), "utf8");
const wranglerSource = readFileSync(join(root, "wrangler.toml"), "utf8");

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label}必须是正整数`);
  return number;
}

function validateDatabaseRows(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error("数据库成员记录不能为空");
  const byJoinNumber = new Map();
  for (const row of rows) {
    const joinNumber = positiveInteger(row?.joinNumber, "数据库序号");
    if (byJoinNumber.has(joinNumber)) throw new Error(`数据库序号${joinNumber}重复`);
    byJoinNumber.set(joinNumber, { ...row, joinNumber });
  }
  const maxJoinNumber = Math.max(...byJoinNumber.keys());
  const unrecordedPositions = Array.from({ length: maxJoinNumber }, (_, index) => index + 1)
    .filter((position) => !byJoinNumber.has(position));
  return { byJoinNumber, maxJoinNumber, unrecordedPositions };
}

function validateOcrResult({ expectedCount, detectedCount, columns, items, warnings = [] }) {
  const expected = positiveInteger(expectedCount, "预期群成员数");
  const detected = positiveInteger(detectedCount, "截图识别人数");
  if (detected !== expected) {
    throw new Error(`截图识别人数${detected}与预期人数${expected}不一致`);
  }
  const columnCount = positiveInteger(columns, "OCR网格列数");
  if (columnCount > 12) throw new Error("OCR网格列数超出范围");
  if (!Array.isArray(items) || !items.length) throw new Error("OCR成员项不能为空");
  if (!Array.isArray(warnings)) throw new Error("OCR warnings必须是数组");

  const byPosition = new Map();
  for (const item of items) {
    const position = positiveInteger(item?.position, "截图位置");
    if (position > detected) throw new Error(`截图位置${position}超出识别人数`);
    if (byPosition.has(position)) throw new Error(`截图位置${position}重复`);
    const confidence = Number(item?.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new Error(`截图位置${position}的置信度无效`);
    }
    byPosition.set(position, {
      position,
      visibleName: String(item?.visibleName || "").trim(),
      confidence,
    });
  }
  return { expectedCount: expected, detectedCount: detected, columns: columnCount, byPosition, warnings };
}

function normalizeName(value) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

function resolveAnchorByVisibleName({ screenshotPosition, visibleName }, databaseRows, ocrResult) {
  const database = validateDatabaseRows(databaseRows);
  const screenshot = validateOcrResult(ocrResult);
  const position = positiveInteger(screenshotPosition, "截图锚点位置");
  if (!screenshot.byPosition.has(position)) throw new Error(`截图锚点位置${position}不存在`);
  const normalized = normalizeName(visibleName || screenshot.byPosition.get(position).visibleName);
  const matches = [...database.byJoinNumber.values()].filter((row) => (
    normalizeName(row.visibleName || row.name) === normalized
  ));
  if (!matches.length) throw new Error(`锚点“${visibleName}”无法匹配数据库成员`);
  if (matches.length > 1) throw new Error(`锚点“${visibleName}”匹配到多个数据库成员`);
  return { oldJoinNumber: matches[0].joinNumber, screenshotPosition: position };
}

function analyzeMemberExitAnchors({ affiliation, databaseRows, ocrResult, anchors }) {
  if (!String(affiliation || "").trim()) throw new Error("所属不能为空");
  const database = validateDatabaseRows(databaseRows);
  const screenshot = validateOcrResult(ocrResult);
  if (!Array.isArray(anchors) || !anchors.length) throw new Error("至少需要一个人工锚点");

  const oldNumbers = new Set();
  const screenshotPositions = new Set();
  const normalizedAnchors = anchors.map((raw) => {
    const oldJoinNumber = positiveInteger(raw?.oldJoinNumber, "旧序号锚点");
    const screenshotPosition = positiveInteger(raw?.screenshotPosition, "截图位置锚点");
    if (!database.byJoinNumber.has(oldJoinNumber)) {
      throw new Error(`旧序号锚点${oldJoinNumber}是空位或不存在`);
    }
    if (!screenshot.byPosition.has(screenshotPosition)) {
      throw new Error(`截图位置锚点${screenshotPosition}不存在`);
    }
    if (oldNumbers.has(oldJoinNumber)) throw new Error(`旧序号锚点${oldJoinNumber}重复`);
    if (screenshotPositions.has(screenshotPosition)) throw new Error(`截图位置锚点${screenshotPosition}重复`);
    oldNumbers.add(oldJoinNumber);
    screenshotPositions.add(screenshotPosition);
    return {
      oldJoinNumber,
      screenshotPosition,
      delta: oldJoinNumber - screenshotPosition,
    };
  }).sort((left, right) => left.oldJoinNumber - right.oldJoinNumber);

  let previous = { oldJoinNumber: 0, screenshotPosition: 0, delta: 0 };
  const ranges = [];
  for (const anchor of normalizedAnchors) {
    if (anchor.screenshotPosition <= previous.screenshotPosition) {
      throw new Error("锚点顺序交叉，无法形成同一成员序列");
    }
    if (anchor.delta < 0) {
      throw new Error("锚点暗示旧成员向后插入；新成员只能出现在末尾");
    }
    if (anchor.delta < previous.delta) {
      throw new Error("锚点delta必须按旧序号单调不减");
    }

    const exitCount = anchor.delta - previous.delta;
    const possiblePositions = [];
    for (let position = previous.oldJoinNumber + 1; position < anchor.oldJoinNumber; position += 1) {
      possiblePositions.push(position);
    }
    if (exitCount > possiblePositions.length) {
      throw new Error("锚点之间的退出人数超过候选位置范围");
    }
    if (exitCount > 0) {
      const recordedCandidates = possiblePositions
        .filter((position) => database.byJoinNumber.has(position))
        .map((position) => database.byJoinNumber.get(position));
      const unrecordedPositions = possiblePositions
        .filter((position) => !database.byJoinNumber.has(position));
      const exact = exitCount === possiblePositions.length;
      ranges.push({
        fromOldExclusive: previous.oldJoinNumber,
        toOldExclusive: anchor.oldJoinNumber,
        exitCount,
        possiblePositions,
        recordedCandidates,
        unrecordedPositions,
        exact,
        confirmedRecorded: exact ? recordedCandidates : [],
        confirmedUnrecorded: exact ? unrecordedPositions : [],
        uniqueRecordedCandidate: exact && exitCount === 1 && recordedCandidates.length === 1
          ? recordedCandidates[0]
          : null,
      });
    }
    previous = anchor;
  }

  const lastAnchor = normalizedAnchors.at(-1);
  const anchorsDatabaseTail = lastAnchor.oldJoinNumber === database.maxJoinNumber;
  const newTailPositions = anchorsDatabaseTail
    ? Array.from(
      { length: Math.max(0, screenshot.detectedCount - lastAnchor.screenshotPosition) },
      (_, index) => lastAnchor.screenshotPosition + index + 1,
    )
    : null;

  return {
    affiliation: String(affiliation).trim(),
    maxOldJoinNumber: database.maxJoinNumber,
    sparsePositions: database.unrecordedPositions,
    anchors: normalizedAnchors,
    ranges,
    newTailPositions,
  };
}

function buildConfirmationOrder(analysis) {
  const databasePositions = new Map(analysis.ranges.flatMap((range) => (
    range.recordedCandidates.map((row) => [row.joinNumber, row])
  )));
  const positions = analysis.ranges.flatMap((range) => (
    range.exact ? range.possiblePositions : []
  ));
  return [...new Set(positions)].sort((left, right) => right - left).map((oldJoinNumber) => ({
    oldJoinNumber,
    kind: databasePositions.has(oldJoinNumber) ? "recorded" : "unrecorded",
    playerId: databasePositions.get(oldJoinNumber)?.playerId ?? null,
  }));
}

function makeOcrResult(count) {
  return {
    expectedCount: count,
    detectedCount: count,
    columns: 4,
    items: Array.from({ length: count }, (_, index) => ({
      position: index + 1,
      visibleName: `截图成员${index + 1}`,
      confidence: 0.99,
    })),
    warnings: [],
  };
}

const sparseDatabase = Array.from({ length: 61 }, (_, index) => index + 1)
  .filter((joinNumber) => ![4, 54].includes(joinNumber))
  .map((joinNumber) => ({
    playerId: 1000 + joinNumber,
    joinNumber,
    name: `数据库成员${joinNumber}`,
  }));
const sparseSummary = validateDatabaseRows(sparseDatabase);
assert.equal(sparseDatabase.length, 59, "样例数据库应有59条已录入记录");
assert.equal(sparseSummary.maxJoinNumber, 61, "样例数据库最大旧序号应为61");
assert.deepEqual(sparseSummary.unrecordedPositions, [4, 54], "稀疏序号4和54必须作为未录入空位保留");

const sampleAnalysis = analyzeMemberExitAnchors({
  affiliation: "球友",
  databaseRows: sparseDatabase,
  ocrResult: makeOcrResult(62),
  anchors: [
    { oldJoinNumber: 1, screenshotPosition: 1 },
    { oldJoinNumber: 30, screenshotPosition: 30 },
    { oldJoinNumber: 61, screenshotPosition: 61 },
  ],
});
assert.deepEqual(sampleAnalysis.anchors.map((anchor) => anchor.delta), [0, 0, 0]);
assert.deepEqual(sampleAnalysis.ranges, [], "没有delta变化时不得虚构退群成员");
assert.deepEqual(sampleAnalysis.newTailPositions, [62], "超过旧序号最大值的截图成员只能视为末尾新成员");

const singleExit = analyzeMemberExitAnchors({
  affiliation: "球友",
  databaseRows: sparseDatabase,
  ocrResult: makeOcrResult(62),
  anchors: [
    { oldJoinNumber: 5, screenshotPosition: 5 },
    { oldJoinNumber: 7, screenshotPosition: 6 },
  ],
});
assert.deepEqual(singleExit.anchors.map((anchor) => anchor.delta), [0, 1], "单人退群应使delta增加1");
assert.equal(singleExit.ranges[0].exitCount, 1);
assert.deepEqual(singleExit.ranges[0].possiblePositions, [6]);
assert.equal(singleExit.ranges[0].uniqueRecordedCandidate?.joinNumber, 6, "仅有一个已录入位置时可以形成唯一候选");

const sparseAmbiguity = analyzeMemberExitAnchors({
  affiliation: "球友",
  databaseRows: sparseDatabase,
  ocrResult: makeOcrResult(62),
  anchors: [
    { oldJoinNumber: 3, screenshotPosition: 3 },
    { oldJoinNumber: 6, screenshotPosition: 5 },
  ],
});
assert.deepEqual(sparseAmbiguity.ranges[0].possiblePositions, [4, 5]);
assert.deepEqual(sparseAmbiguity.ranges[0].recordedCandidates.map((row) => row.joinNumber), [5]);
assert.deepEqual(sparseAmbiguity.ranges[0].unrecordedPositions, [4]);
assert.equal(sparseAmbiguity.ranges[0].uniqueRecordedCandidate, null, "空位也可能是退群者时不得误报唯一成员");

const multipleExact = analyzeMemberExitAnchors({
  affiliation: "球友",
  databaseRows: sparseDatabase,
  ocrResult: makeOcrResult(62),
  anchors: [
    { oldJoinNumber: 10, screenshotPosition: 10 },
    { oldJoinNumber: 13, screenshotPosition: 11 },
  ],
});
assert.equal(multipleExact.ranges[0].exitCount, 2, "多人退群应保留delta增量");
assert.deepEqual(multipleExact.ranges[0].possiblePositions, [11, 12]);
assert.deepEqual(multipleExact.ranges[0].confirmedRecorded.map((row) => row.joinNumber), [11, 12]);

const multipleAmbiguous = analyzeMemberExitAnchors({
  affiliation: "球友",
  databaseRows: sparseDatabase,
  ocrResult: makeOcrResult(62),
  anchors: [
    { oldJoinNumber: 52, screenshotPosition: 52 },
    { oldJoinNumber: 56, screenshotPosition: 54 },
  ],
});
assert.deepEqual(multipleAmbiguous.ranges[0], {
  fromOldExclusive: 52,
  toOldExclusive: 56,
  exitCount: 2,
  possiblePositions: [53, 54, 55],
  recordedCandidates: sparseDatabase.filter((row) => [53, 55].includes(row.joinNumber)),
  unrecordedPositions: [54],
  exact: false,
  confirmedRecorded: [],
  confirmedUnrecorded: [],
  uniqueRecordedCandidate: null,
}, "候选范围必须同时呈现已录入成员与未录入空位");
assert.deepEqual(
  buildConfirmationOrder(multipleAmbiguous),
  [],
  "模糊候选范围必须继续补锚点，不允许复选猜测退群者",
);
assert.deepEqual(
  buildConfirmationOrder(multipleExact),
  [
    { oldJoinNumber: 12, kind: "recorded", playerId: 1012 },
    { oldJoinNumber: 11, kind: "recorded", playerId: 1011 },
  ],
  "多个确定退群成员必须按旧序号倒序处理，避免前一次重排改变后续目标",
);

const monotonic = analyzeMemberExitAnchors({
  affiliation: "球友",
  databaseRows: sparseDatabase,
  ocrResult: makeOcrResult(62),
  anchors: [
    { oldJoinNumber: 5, screenshotPosition: 5 },
    { oldJoinNumber: 7, screenshotPosition: 6 },
    { oldJoinNumber: 10, screenshotPosition: 8 },
  ],
});
assert.deepEqual(monotonic.anchors.map((anchor) => anchor.delta), [0, 1, 2], "有效锚点delta必须单调不减");

assert.throws(() => analyzeMemberExitAnchors({
  affiliation: "球友",
  databaseRows: sparseDatabase,
  ocrResult: makeOcrResult(62),
  anchors: [{ oldJoinNumber: 10, screenshotPosition: 11 }],
}), /新成员只能出现在末尾/, "旧成员向后移动意味着中间插入新成员，必须拒绝");
assert.throws(() => analyzeMemberExitAnchors({
  affiliation: "球友",
  databaseRows: sparseDatabase,
  ocrResult: makeOcrResult(62),
  anchors: [
    { oldJoinNumber: 10, screenshotPosition: 9 },
    { oldJoinNumber: 20, screenshotPosition: 20 },
  ],
}), /delta.*单调不减/, "delta下降说明锚点错误，必须拒绝");
assert.throws(() => analyzeMemberExitAnchors({
  affiliation: "球友",
  databaseRows: sparseDatabase,
  ocrResult: makeOcrResult(62),
  anchors: [{ oldJoinNumber: 4, screenshotPosition: 4 }],
}), /空位或不存在/, "数据库空位不能作为成员锚点");
assert.throws(() => analyzeMemberExitAnchors({
  affiliation: "球友",
  databaseRows: sparseDatabase,
  ocrResult: makeOcrResult(62),
  anchors: [
    { oldJoinNumber: 5, screenshotPosition: 5 },
    { oldJoinNumber: 6, screenshotPosition: 5 },
  ],
}), /截图位置锚点5重复/, "两个成员不能锚定到同一截图位置");
assert.throws(() => validateOcrResult({
  ...makeOcrResult(62),
  detectedCount: 61,
}), /不一致/, "OCR识别人数与用户填写人数不一致时必须拒绝分析");

const duplicateNameRows = [
  { playerId: 1, joinNumber: 1, name: "同名" },
  { playerId: 2, joinNumber: 2, name: "同名" },
];
const duplicateNameOcr = {
  ...makeOcrResult(2),
  items: [
    { position: 1, visibleName: "同名", confidence: 0.99 },
    { position: 2, visibleName: "其他", confidence: 0.99 },
  ],
};
assert.throws(() => resolveAnchorByVisibleName(
  { screenshotPosition: 1, visibleName: "同名" },
  duplicateNameRows,
  duplicateNameOcr,
), /多个数据库成员/, "同名锚点有歧义时必须要求人工选择");
assert.throws(() => resolveAnchorByVisibleName(
  { screenshotPosition: 2, visibleName: "不存在" },
  sparseDatabase,
  makeOcrResult(62),
), /无法匹配/, "错误锚点不得进入分析");

function functionSection(source, functionName) {
  const matcher = new RegExp(`(?:async\\s+)?function\\s+${functionName}\\s*\\(`);
  const match = matcher.exec(source);
  assert.ok(match, `应能定位生产函数 ${functionName}`);
  const rest = source.slice(match.index + match[0].length);
  const next = /\n\s*(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/.exec(rest);
  return source.slice(match.index, next ? match.index + match[0].length + next.index : source.length);
}

// Static integration checks keep the inline frontend and Worker contract wired
// to this baseline without claiming to execute their production functions.
for (const field of ["imageDataUrl", "affiliation", "expectedCount", "detectedCount", "columns", "items", "position", "visibleName", "confidence", "warnings"]) {
  assert.ok(new RegExp(`\\b${field}\\b`).test(indexHtml), `前端应贯穿OCR字段 ${field}`);
}
assert.ok(/\/api\/member-exit-ocr/.test(indexHtml), "前端应调用成员退群OCR接口");
assert.ok(/content-type["']?\s*:\s*["']application\/json/.test(indexHtml), "前端OCR请求应显式使用application/json");
for (const functionName of ["openMemberExitInvestigator", "analyzeMemberExitAnchors", "confirmMemberExitCandidate"]) {
  assert.ok(new RegExp(`function\\s+${functionName}\\s*\\(`).test(indexHtml), `前端应实现 ${functionName}`);
}
const frontendAnalysisSection = functionSection(indexHtml, "analyzeMemberExitAnchors");
assert.ok(/anchor/i.test(frontendAnalysisSection) && /delta/i.test(frontendAnalysisSection), "前端分析应使用人工锚点和delta");
assert.ok(/allSegmentsExact\s*&&\s*allStrongAnchors/.test(frontendAnalysisSection), "只有确定区间和强锚点同时成立时才能生成可处理候选");
assert.ok(!/method\s*:\s*["']DELETE["']|\/api\/players\//.test(frontendAnalysisSection), "分析锚点不得自动删除成员");
assert.ok(/confirmedCandidates/.test(frontendAnalysisSection), "exact候选区间应输出一个或多个 confirmedCandidates");
assert.ok(/candidatePositions\.length\s*===\s*(?:segment\.)?removedCount|removedCount\s*===\s*(?:segment\.)?candidatePositions\.length/.test(frontendAnalysisSection), "只有退出数覆盖整个候选区间时才能形成确认项");
const frontendConfirmSection = functionSection(indexHtml, "confirmMemberExitCandidate");
assert.ok(/window\.confirm\s*\(|openModal\s*\(|\.classList\.add\s*\(\s*["']open["']/.test(frontendConfirmSection), "删除前必须进入显式确认流程");
assert.ok(/confirmedCandidates/.test(frontendConfirmSection), "确认流程应处理全部exact候选，而非仅处理一个uniqueCandidate");
assert.ok(/\.sort\s*\(\s*\(\s*(?:left|a)\s*,\s*(?:right|b)\s*\)\s*=>\s*(?:right|b)\.(?:joinNumber|oldJoinNumber)\s*-\s*(?:left|a)\.(?:joinNumber|oldJoinNumber)/.test(`${frontendAnalysisSection}\n${frontendConfirmSection}`), "多个确认必须按旧序号倒序生成并处理");
assert.ok(/fetchCloudBootstrap\s*\(\s*\)/.test(frontendConfirmSection), "确认前必须重新获取云端bootstrap");
assert.ok(frontendConfirmSection.indexOf("fetchCloudBootstrap()") < frontendConfirmSection.indexOf("window.confirm"), "最新数据复核必须早于最终确认");
assert.ok(/getMemberExitCandidateSignature\s*\(confirmedCandidates\)/.test(frontendConfirmSection), "刷新后必须比较候选签名");
assert.ok(/\/api\/member-exits\/confirm/.test(frontendConfirmSection), "确定候选应交给专用退群确认接口处理");
assert.ok(/expectedGroupJoinNumbers/.test(frontendConfirmSection), "确认接口必须携带当前群序列前置条件");
assert.ok(/detectedCount\s*===\s*expectedCount/.test(indexHtml), "截图识别人数与填写人数不一致时前端必须拒绝分析");
assert.ok(/MAX_MEMBER_EXIT_COUNT\s*=\s*200/.test(indexHtml) && /max="200"/.test(indexHtml), "前端人数上限必须统一为200");
const frontendOpenSection = functionSection(indexHtml, "openMemberExitInvestigator");
assert.ok(/hasUnsavedPaymentSettingsChanges\s*\(\s*\)/.test(frontendOpenSection), "未保存群收款设置时必须阻止打开退群排查");
const frontendOcrApplySection = functionSection(indexHtml, "applyMemberExitOcrResponse");
assert.ok(/status\s*=\s*complete\s*\?\s*["']complete["']\s*:\s*["']manual["']/.test(frontendOcrApplySection), "位置不完整时必须保留部分OCR并进入人工模式");
assert.ok(/recognitionComplete\s*=\s*true/.test(frontendOcrApplySection), "人工模式必须允许用户补充锚点继续分析");

for (const field of ["imageDataUrl", "affiliation", "expectedCount", "detectedCount", "columns", "items", "position", "visibleName", "confidence", "warnings"]) {
  assert.ok(new RegExp(`\\b${field}\\b`).test(workerSource), `Worker应贯穿OCR字段 ${field}`);
}
assert.ok(/\/api\/member-exit-ocr/.test(workerSource), "Worker应提供 POST /api/member-exit-ocr");
assert.ok(/(?:request\.)?method(?:\.toUpperCase\(\))?\s*(?:===|!==)\s*["']POST["']/.test(workerSource), "OCR接口应限制为POST");
assert.ok(/env\.AI\b|env\[["']AI["']\]/.test(workerSource), "OCR处理应使用Cloudflare AI binding");
assert.ok(/\[ai\]/i.test(wranglerSource) && /binding\s*=\s*["']AI["']/i.test(wranglerSource), "wrangler.toml应声明AI binding");
assert.ok(/\[\[ratelimits\]\]/i.test(wranglerSource) && /name\s*=\s*["']MEMBER_EXIT_RATE_LIMITER["']/i.test(wranglerSource), "wrangler.toml应声明成员截图平台限流binding");
assert.ok(/limit\s*=\s*5/.test(wranglerSource) && /period\s*=\s*60/.test(wranglerSource), "平台限流应为每IP每分钟5次");
for (const mime of ["image/png", "image/jpeg", "image/webp"]) {
  assert.ok(workerSource.includes(mime), `OCR接口应允许 ${mime}`);
}
assert.ok(/6\s*\*\s*1024\s*\*\s*1024|6_?291_?456|6291456/.test(workerSource), "OCR原图大小上限应为6MiB");
assert.ok(/\.length\s*>\s*[A-Z_$][\w$]*|byteLength\s*>\s*[A-Z_$][\w$]*/.test(workerSource), "OCR接口应实际拒绝超过大小上限的图片");
assert.ok(/\b(?:400|413|415)\b/.test(workerSource), "无效大小或MIME应返回客户端错误");
const backendOcrSection = functionSection(workerSource, "handleMemberExitOcr");
assert.ok(!/env\.(?:DB|PHOTOS)\b|\.put\s*\(/.test(backendOcrSection), "OCR原图不得写入D1或R2");
assert.ok(/stream\s*:\s*false/.test(backendOcrSection), "Workers AI必须关闭流式响应后再按完整JSON解析");
assert.ok(/max_completion_tokens\s*:\s*6000/.test(backendOcrSection), "OCR输出预算必须覆盖200人JSON");
assert.ok(/@cf\/qwen\/qwen3\.8-27b/.test(workerSource), "成员截图OCR应使用已通过真实62人样图验证的Qwen视觉模型");
const backendRateLimitSection = functionSection(workerSource, "consumeMemberExitRateLimit");
assert.ok(/cf-connecting-ip/.test(backendRateLimitSection) && /MEMBER_EXIT_RATE_LIMITER\.limit/.test(backendRateLimitSection), "平台限流必须按客户端IP调用binding");
assert.ok(/unavailable\s*:\s*true/.test(backendRateLimitSection), "生产环境缺少限流binding时必须关闭OCR接口");
assert.ok(/\/api\/member-exits\/confirm/.test(workerSource), "Worker应提供专用退群确认接口");
const backendConfirmSection = functionSection(workerSource, "handleMemberExitConfirmation");
assert.ok(/memberExitGroupSequenceSignature/.test(backendConfirmSection) && /\b409\b/.test(backendConfirmSection), "陈旧群序列必须返回409且不执行写入");
assert.ok(backendConfirmSection.indexOf("memberExitGroupSequenceSignature") < backendConfirmSection.indexOf("env.DB.batch"), "序列前置条件必须在数据库batch前验证");
assert.ok(/candidates/.test(backendConfirmSection) && /env\.DB\.batch\s*\(/.test(backendConfirmSection), "专用接口必须一次处理全部确定候选");

console.log("Member-exit analysis contract and static integration verification passed.");
