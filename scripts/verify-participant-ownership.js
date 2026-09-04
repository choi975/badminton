import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Executable business-rule baseline. The production UI is an inline script, so
// these projections intentionally do not pretend to import its implementation.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const indexHtml = readFileSync(join(root, "index.html"), "utf8");
const workerSource = readFileSync(join(root, "src", "worker.js"), "utf8");
const estimatorSource = readFileSync(join(root, "src", "estimator-core.js"), "utf8");

const COMPETITION_LEVEL = "6级";

function nonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : fallback;
}

function normalizeParticipation(row) {
  const slots = nonNegativeInteger(row.slots, 1);
  const amount = Math.max(0, Number(row.amount) || 0);
  const isCompanion = row.isCompanion === true;
  // Migrated legacy rows also have owner fields and isCompanion=false. Their
  // aggregate companion count must therefore continue to come from plusCount.
  const guestCount = isCompanion
    ? slots
    : Math.min(slots, nonNegativeInteger(row.plusCount));
  const ownerWasPresent = !isCompanion
    && row.playerId !== null
    && row.playerId !== undefined
    && slots > guestCount;
  return {
    ownerPlayerId: row.ownerPlayerId ?? row.playerId ?? null,
    ownerName: row.ownerName || row.playerName || "未知成员",
    participantCount: slots,
    guestCount,
    playCount: ownerWasPresent ? 1 : 0,
    amount,
    attendeePlayerId: ownerWasPresent ? Number(row.playerId) : null,
  };
}

function projectOwners(rows) {
  const owners = new Map();
  for (const row of rows) {
    const normalized = normalizeParticipation(row);
    const key = normalized.ownerPlayerId === null
      ? `name:${normalized.ownerName}`
      : `player:${normalized.ownerPlayerId}`;
    const current = owners.get(key) || {
      ownerPlayerId: normalized.ownerPlayerId,
      ownerName: normalized.ownerName,
      participantCount: 0,
      guestCount: 0,
      playCount: 0,
      amount: 0,
    };
    current.participantCount += normalized.participantCount;
    current.guestCount += normalized.guestCount;
    current.playCount += normalized.playCount;
    current.amount += normalized.amount;
    owners.set(key, current);
  }
  return [...owners.values()];
}

function calendarLabel(ownerProjection) {
  return `${ownerProjection.ownerName}（${ownerProjection.amount.toFixed(1)}元）`;
}

function parseCompanion(raw, owner, { gender = "不详", level = "不详" } = {}) {
  const source = String(raw || "").trim();
  const ownerIndex = source.indexOf(owner.name);
  assert.notEqual(ownerIndex, -1, "随行人员必须能唯一识别归属人后再保存");
  const suffix = source.slice(ownerIndex + owner.name.length);
  assert.match(
    suffix,
    /^\s*(?:[+＋➕]|代|加)\s*(?:\d+|[零〇一二两三四五六七八九十百千万]+)/,
    "随行人员应使用 + / ＋ / ➕ / 代 / 加及编号标记",
  );
  return {
    playerId: null,
    playerName: source.replace("比赛级高手", "").trim(),
    ownerPlayerId: owner.id,
    ownerName: owner.name,
    isCompanion: true,
    slots: 1,
    plusCount: 0,
    amount: 0,
    gender,
    level: source.includes("比赛级高手") ? COMPETITION_LEVEL : level,
  };
}

function participantSnapshots(row) {
  const normalized = normalizeParticipation(row);
  if (row.isCompanion === true || normalized.guestCount === 0) {
    return Array.from({ length: normalized.participantCount }, () => ({
      gender: row.gender || "不详",
      level: row.level || "不详",
      isCompanion: row.isCompanion === true,
    }));
  }

  const snapshots = [];
  if (normalized.playCount) {
    snapshots.push({
      gender: row.gender || "不详",
      level: row.level || "不详",
      isCompanion: false,
    });
  }
  while (snapshots.length < normalized.participantCount) {
    snapshots.push({ gender: "不详", level: "不详", isCompanion: true });
  }
  return snapshots;
}

function shouldPay(row) {
  return Boolean(row);
}

function getBestPartnerIdsMap(sessions) {
  const partnerCounts = new Map();
  for (const session of sessions) {
    const playerIds = [...new Set((session.players || [])
      .map(normalizeParticipation)
      .map((row) => row.attendeePlayerId)
      .filter((playerId) => Number.isFinite(playerId)))];
    for (const playerId of playerIds) {
      const counts = partnerCounts.get(playerId) || new Map();
      for (const partnerId of playerIds) {
        if (partnerId !== playerId) counts.set(partnerId, (counts.get(partnerId) || 0) + 1);
      }
      partnerCounts.set(playerId, counts);
    }
  }
  return new Map([...partnerCounts.entries()].map(([playerId, counts]) => {
    const highestCount = Math.max(0, ...counts.values());
    return [
      playerId,
      highestCount > 0
        ? [...counts.entries()].filter(([, count]) => count === highestCount).map(([partnerId]) => partnerId)
        : [],
    ];
  }));
}

function functionSection(source, functionName, nextFunctionName) {
  const start = source.indexOf(`function ${functionName}(`);
  const end = source.indexOf(`function ${nextFunctionName}(`, start + 1);
  assert.ok(start >= 0 && end > start, `应能定位 ${functionName} 的生产代码`);
  return source.slice(start, end);
}

const owner = { id: 1, name: "甲乙丙", affiliation: "球友", participatesPayment: true };
const teammate = { id: 2, name: "球友乙", affiliation: "球友", participatesPayment: true };
const thirdPlayer = { id: 3, name: "球友丙", affiliation: "球友", participatesPayment: true };
const specialOwner = { id: 4, name: "特殊成员", affiliation: "特殊", participatesPayment: false };
const ownersById = new Map([owner, teammate, thirdPlayer, specialOwner].map((player) => [player.id, player]));

const numberedGuest = parseCompanion("甲乙丙+3比赛级高手", owner, { gender: "女" });
assert.equal(numberedGuest.slots, 1, "+3 是编号为 3 的一位随行人员，不是三个人");
assert.equal(numberedGuest.isCompanion, true);
assert.equal(numberedGuest.ownerPlayerId, owner.id);
assert.equal(numberedGuest.gender, "女", "新随行人员应独立保留性别快照");
assert.equal(numberedGuest.level, "6级", "比赛级高手统一保存为 6级");
assert.equal(projectOwners([numberedGuest])[0].guestCount, 1);

for (const marker of ["＋2", "➕四", "代5", "加六"]) {
  assert.equal(parseCompanion(`甲乙丙${marker}`, owner).slots, 1, `${marker} 应表示一位随行人员`);
}

const ownerPresentRows = [
  {
    playerId: owner.id,
    playerName: owner.name,
    ownerPlayerId: owner.id,
    ownerName: owner.name,
    isCompanion: false,
    slots: 1,
    amount: 30,
    gender: "女",
    level: "3级",
  },
  { ...parseCompanion("甲乙丙+1", owner, { gender: "女", level: "2级" }), amount: 25 },
  { ...parseCompanion("甲乙丙+2", owner, { gender: "男", level: "4级" }), amount: 30 },
];
assert.deepEqual(projectOwners(ownerPresentRows), [{
  ownerPlayerId: owner.id,
  ownerName: owner.name,
  participantCount: 3,
  guestCount: 2,
  playCount: 1,
  amount: 85,
}], "归属人在场时：本人算一次出场，随行人员只增加带人数，金额汇总到归属人");

const ownerAbsentRows = Array.from({ length: 7 }, (_, index) => ({
  ...parseCompanion(`甲乙丙+${index + 1}`, owner, {
    gender: index % 2 ? "女" : "男",
    level: `${(index % 4) + 2}级`,
  }),
  amount: 22.3,
}));
const ownerAbsent = projectOwners(ownerAbsentRows)[0];
assert.equal(ownerAbsent.participantCount, 7);
assert.equal(ownerAbsent.guestCount, 7);
assert.equal(ownerAbsent.playCount, 0, "归属人缺席时不能增加其打球次数");
assert.equal(Number(ownerAbsent.amount.toFixed(1)), 156.1);
assert.equal(calendarLabel(ownerAbsent), "甲乙丙（156.1元）");
assert.doesNotMatch(calendarLabel(ownerAbsent), /带7人/, "日历不展示“带 N 人”文案");

const legacyRow = {
  playerId: owner.id,
  playerName: owner.name,
  ownerPlayerId: owner.id,
  ownerName: owner.name,
  isCompanion: false,
  slots: 4,
  plusCount: 3,
  amount: 100,
  gender: "女",
  level: "3级",
};
assert.deepEqual(projectOwners([legacyRow]), [{
  ownerPlayerId: owner.id,
  ownerName: owner.name,
  participantCount: 4,
  guestCount: 3,
  playCount: 1,
  amount: 100,
}], "旧 slots + plusCount 聚合行应继续按原人数和金额统计");
assert.deepEqual(participantSnapshots(legacyRow).slice(1), [
  { gender: "不详", level: "不详", isCompanion: true },
  { gender: "不详", level: "不详", isCompanion: true },
  { gender: "不详", level: "不详", isCompanion: true },
], "旧随行人员没有可靠属性时必须保持不详，不能从归属人复制或虚构");

const specialRows = [
  {
    playerId: specialOwner.id,
    playerName: specialOwner.name,
    ownerPlayerId: specialOwner.id,
    ownerName: specialOwner.name,
    isCompanion: false,
    slots: 1,
    amount: 30,
  },
  { ...parseCompanion("特殊成员+1", specialOwner), amount: 30 },
];
assert.equal(shouldPay(specialRows[0], ownersById), true, "特殊成员本人统一参与A钱");
assert.equal(shouldPay(specialRows[1], ownersById), true, "特殊成员带来的随行人员仍应付款");
assert.deepEqual(projectOwners(specialRows)[0], {
  ownerPlayerId: specialOwner.id,
  ownerName: specialOwner.name,
  participantCount: 2,
  guestCount: 1,
  playCount: 1,
  amount: 60,
});

const partnerSessions = [
  { players: [ownerPresentRows[0], { playerId: teammate.id, playerName: teammate.name, slots: 1 }, ownerPresentRows[1]] },
  { players: [ownerAbsentRows[0], { playerId: teammate.id, playerName: teammate.name, slots: 1 }, { playerId: thirdPlayer.id, playerName: thirdPlayer.name, slots: 1 }] },
];
const bestPartners = getBestPartnerIdsMap(partnerSessions);
assert.deepEqual(bestPartners.get(owner.id), [teammate.id], "在场归属人可以参与最佳拍档统计");
assert.deepEqual(bestPartners.get(thirdPlayer.id), [teammate.id], "归属人缺席时不能因其随行人员成为最佳拍档");
assert.ok(!bestPartners.get(thirdPlayer.id).includes(owner.id));

const totalParticipants = [...ownerPresentRows, legacyRow]
  .map(normalizeParticipation)
  .reduce((sum, row) => sum + row.participantCount, 0);
assert.equal(totalParticipants, 7, "训练输入继续使用包含随行人员在内的总人数");

// Static integration checks: field plumbing and deliberately unchanged model inputs.
for (const field of ["ownerPlayerId", "ownerName", "isCompanion"]) {
  assert.ok(new RegExp(`\\b${field}\\b`).test(indexHtml), `index.html 应贯穿 ${field}`);
}
for (const column of ["owner_player_id", "owner_name_snapshot", "is_companion"]) {
  assert.ok(new RegExp(`\\b${column}\\b`).test(workerSource), `Worker 应读写 ${column}`);
}
assert.ok(/\[\s*["']比赛级高手["']\s*,\s*["']6级["']\s*\]/.test(indexHtml), "生产映射应将比赛级高手保存为 6级");
assert.ok(!/\[\s*["']比赛级高手["']\s*,\s*["']5级["']\s*\]/.test(indexHtml), "生产代码不得继续将比赛级高手保存为 5级");
assert.ok(/sample\.participantCount/.test(estimatorSource), "预估核心应继续消费总人数");
assert.ok(!/genderLevelWeights/.test(estimatorSource), "当前预估公式不得悄悄启用性别/水平权重");
for (const label of ["球友名", "在球友群的序号", "Hytronik成员名", "在Hytronik群的序号", "特殊成员名"]) {
  assert.ok(indexHtml.includes(label), `群收款设置应展示“${label}”列`);
}
assert.doesNotMatch(indexHtml, /参与A钱|不A钱|不参与A钱/, "群收款设置不应再展示或计算特殊成员付款例外");
const shouldCountForPaymentSection = functionSection(indexHtml, "shouldCountForPayment", "getSharedPaymentGroup");
assert.ok(!/participatesPayment/.test(shouldCountForPaymentSection), "特殊成员应统一参与A钱");

const aggregateCalendarSection = functionSection(indexHtml, "createAggregateCalendarCard", "buildChainInputFromSession");
const recordCalendarSection = functionSection(indexHtml, "createCalendarRecordCard", "deleteSessionRecord");
const calendarSections = `${aggregateCalendarSection}\n${recordCalendarSection}`;
assert.ok(/projectSessionParticipants\s*\(/.test(aggregateCalendarSection), "月度/多日历应按归属人投影后汇总");
assert.ok(/projectSessionParticipants\s*\(/.test(recordCalendarSection), "单场日历应按归属人投影后展示");
assert.ok(!/带(?:\$\{[^}]+\}|\d+)人/.test(calendarSections), "日历成员标签不得拼接“带 N 人”");

const recordMemberSection = functionSection(indexHtml, "createRecordMemberRow", "saveRecordDialog");
const saveRecordSection = functionSection(indexHtml, "saveRecordDialog", "upsertSession");
const buildParticipantSection = functionSection(indexHtml, "buildSessionParticipants", "copyPaymentScreenshot");
for (const field of ["ownerPlayerId", "ownerName", "isCompanion"]) {
  assert.ok(new RegExp(`\\b${field}\\b`).test(buildParticipantSection), `新订场明细应写入 ${field}`);
  assert.ok(new RegExp(`\\b${field}\\b`).test(recordMemberSection), `订场确认页应暂存 ${field}`);
  assert.ok(new RegExp(`\\b${field}\\b`).test(saveRecordSection), `订场确认页保存时应回传 ${field}`);
}

const ownershipSection = functionSection(indexHtml, "resolveChainEntryOwnership", "normalizeRepeatedMemberEntries");
assert.ok(/if \(!match\.player\)/.test(ownershipSection), "未登记的显式归属人必须阻止进入收款");
assert.ok(!/lastOwner/.test(ownershipSection), "裸 +N 不能静默继承上一位成员");

const normalizedPlayerSection = functionSection(indexHtml, "normalizeSessionPlayer", "normalizeSessionPlayers");
assert.ok(/hasOwnerPlayerId/.test(normalizedPlayerSection), "必须区分旧快照缺字段和新 API 明确返回 null owner");
const normalizedSessionInputSection = functionSection(workerSource, "normalizeSessionInput", "normalizePriceRows");
assert.ok(/hasOwnProperty\.call\(raw \|\| \{\}, ["']ownerPlayerId["']\)/.test(normalizedSessionInputSection), "Worker 必须保留明确为 null 的历史 owner");
const ownerKeySection = functionSection(indexHtml, "getSessionOwnerKey", "projectSessionParticipants");
assert.ok(!/\?\?[^\n]*row\.playerId/.test(ownerKeySection), "明确删除的 owner 不能从历史 playerId 自动复活");

assert.ok(/slotsInput\.readOnly\s*=\s*true/.test(recordMemberSection), "聚合确认页人数必须返回接龙助手修改");
const calendarSummarySection = functionSection(indexHtml, "buildCalendarSummaryLine", "setCalendarRecordMetaText");
assert.ok(/totalAmount\s*\/\s*totalSlots/.test(calendarSummarySection), "多场平均费用必须按总金额除以总人次");
const paymentLineSection = functionSection(indexHtml, "addPaymentLine", "mapToPaymentRows");
assert.ok(/if \(slots > 0\)/.test(paymentLineSection), "零付款 owner 不能污染随行者的性别封顶标识");

console.log("Participant-ownership contract and static integration verification passed.");
