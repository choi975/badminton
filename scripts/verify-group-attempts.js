import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import vm from "node:vm";
import {
  buildGroupLearningSignals,
  GROUP_LEARNING_VERSION,
} from "../src/group-learning-core.js";

const workerSource = readFileSync(new URL("../src/worker.js", import.meta.url), "utf8");
const snapshotSource = readFileSync(new URL("./generate-snapshot.js", import.meta.url), "utf8");
const migrationSource = readFileSync(new URL("../migrations/0017_group_attempt_tracking.sql", import.meta.url), "utf8");
const cacheMigrationSource = readFileSync(new URL("../migrations/0021_group_learning_model_cache.sql", import.meta.url), "utf8");
const capturedErrors = [];

const pureHelpersStart = workerSource.indexOf("function getBeijingDateString(");
const pureHelpersEnd = workerSource.indexOf("async function sha256Hex(", pureHelpersStart);
assert.ok(pureHelpersStart >= 0 && pureHelpersEnd > pureHelpersStart, "应能定位接龙追踪纯函数");

const context = vm.createContext({
  Date,
  Intl,
  Number,
  String,
  Set,
  Map,
  Object,
  Array,
  RegExp,
  JSON,
  TextEncoder,
  Uint8Array,
  crypto: webcrypto,
  buildGroupLearningSignals,
  GROUP_LEARNING_VERSION,
  listPlayers: async () => [],
  listSessions: async () => [],
  console: { ...console, error: (...args) => capturedErrors.push(args) },
});
vm.runInContext(`
const SESSION_DATE_PATTERN = /^\\d{4}-\\d{2}-\\d{2}$/;
const GROUP_ATTEMPT_KEY = "main";
const GROUP_ATTEMPT_SUCCESS_COUNT = 6;
const GROUP_ATTEMPT_DEDUPE_SECONDS = 5 * 60;
const GROUP_ATTEMPT_MAX_PARTICIPANTS = 100;
const GROUP_ATTEMPT_MAX_CONSTRAINTS = 500;
const GROUP_ATTEMPT_MAX_JSON_BYTES = 16 * 1024;
const GROUP_ATTEMPT_MAX_SNAPSHOTS = 200;
const GROUP_ATTEMPT_CLOCK_SKEW_MS = 10 * 60 * 1000;
const GROUP_LEARNING_LOOKBACK_DAYS = 365;
const GROUP_LEARNING_MAX_ATTEMPTS = 50;
const GROUP_LEARNING_MAX_ROWS = 10_000;
const GROUP_LEARNING_HALF_LIFE_DAYS = 30;
const GROUP_LEARNING_CACHE_ID = "current";
const GROUP_LEARNING_RAW_DATA_KEYS = new Set([
  "snapshots", "knownPlayerIds", "known_player_ids", "known_player_ids_json",
  "companionsByOwner", "companions_by_owner", "companions_by_owner_json",
]);
const GROUP_ATTEMPT_TRIGGERS = new Set(["paste", "input", "companion", "rule_change"]);
const GROUP_ATTEMPT_RANKING_MODES = new Set(["attendanceProbability", "attendanceProbabilityTimesUplift"]);
const GROUP_ATTEMPT_CONSTRAINT_TYPES = new Set([
  "not_before_days", "not_within_days", "not_before_next_week", "not_before_date",
  "only_days", "not_days", "threeDayStreak", "twoDayStreak", "onlyLargeSessions",
]);
const CLIENT_EVENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function addDaysToDateString(dateString, days) {
  const [year, month, day] = String(dateString || "").split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function isValidDateString(dateString) {
  if (!SESSION_DATE_PATTERN.test(String(dateString || ""))) return false;
  const [year, month, day] = dateString.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}
function safeJsonArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}
${workerSource.slice(pureHelpersStart, pureHelpersEnd)}
globalThis.tracking = {
  getBeijingDateString,
  getGroupAttemptSettlementCutoffDate,
  isGroupAttemptDue,
  stableJsonStringify,
  normalizeGroupAttemptSnapshotInput,
};
`, context);

const {
  getBeijingDateString,
  getGroupAttemptSettlementCutoffDate,
  isGroupAttemptDue,
  stableJsonStringify,
  normalizeGroupAttemptSnapshotInput,
} = context.tracking;

const databaseHelpersStart = workerSource.indexOf("async function sha256Hex(");
const databaseHelpersEnd = workerSource.indexOf("function buildShortTermRuleInsert(", databaseHelpersStart);
assert.ok(databaseHelpersStart >= 0 && databaseHelpersEnd > databaseHelpersStart, "应能定位接龙追踪数据库函数");
vm.runInContext(`
${workerSource.slice(databaseHelpersStart, databaseHelpersEnd)}
globalThis.trackingDatabase = {
  saveGroupAttemptSnapshot,
  listGroupAttemptOutcomes,
  listGroupLearningAttempts,
  parseGroupLearningAttemptRows,
  parseCachedGroupLearningSignals,
  getCachedGroupLearningSignals,
  buildGroupLearningColdStart,
  rebuildGroupLearningSignals,
  safelyRebuildGroupLearningSignals,
  reconcileGroupAttemptOutcome,
  safelyReconcileGroupAttemptOutcome,
  settleDueGroupAttempts,
  runScheduledGroupLearningMaintenance,
};
`, context);
const {
  saveGroupAttemptSnapshot,
  listGroupAttemptOutcomes,
  listGroupLearningAttempts,
  parseGroupLearningAttemptRows,
  parseCachedGroupLearningSignals,
  getCachedGroupLearningSignals,
  buildGroupLearningColdStart,
  rebuildGroupLearningSignals,
  safelyRebuildGroupLearningSignals,
  safelyReconcileGroupAttemptOutcome,
  settleDueGroupAttempts,
  runScheduledGroupLearningMaintenance,
} = context.trackingDatabase;

const robustRows = [
  {
    attempt_id: 9,
    activity_date: "2026-09-04",
    attempt_outcome: "failure",
    attempt_training_state: "eligible",
    attempt_source: "tracked",
    snapshot_id: 2,
    snapshot_observed_at: "2026-09-04T08:02:00.000Z",
    snapshot_training_state: "eligible",
    snapshot_participant_count: "Infinity",
    known_player_ids_json: "not-json",
    companions_by_owner_json: "{\"1\":2}",
  },
  {
    attempt_id: 9,
    activity_date: "2026-09-04",
    attempt_outcome: "failure",
    attempt_training_state: "eligible",
    attempt_source: "tracked",
    snapshot_id: 1,
    snapshot_observed_at: "2026-09-04T08:01:00.000Z",
    snapshot_training_state: "eligible",
    snapshot_participant_count: 2,
    known_player_ids_json: "[1,2]",
    companions_by_owner_json: "[]",
  },
  {
    attempt_id: 9,
    activity_date: "2026-09-04",
    snapshot_id: 1,
    snapshot_observed_at: "2026-09-04T09:00:00.000Z",
    known_player_ids_json: "[99]",
    companions_by_owner_json: "[]",
  },
  {
    attempt_id: 10,
    activity_date: "2026-09-03",
    attempt_outcome: "success",
    attempt_training_state: "eligible",
    attempt_source: "tracked",
    snapshot_id: null,
  },
  { attempt_id: 11, activity_date: "2026-02-30", snapshot_id: 4 },
  { attempt_id: "invalid", activity_date: "2026-09-04", snapshot_id: 5 },
];
const robustAttempts = JSON.parse(JSON.stringify(parseGroupLearningAttemptRows(robustRows)));
assert.equal(robustAttempts.length, 2, "坏attempt行应跳过，无快照attempt仍可安全分组");
assert.deepEqual(robustAttempts.map((attempt) => attempt.id), [10, 9]);
assert.deepEqual(robustAttempts[0].snapshots, []);
assert.deepEqual(robustAttempts[1].snapshots.map((snapshot) => snapshot.id), [1, 2], "快照应排序并按ID去重");
assert.deepEqual(robustAttempts[1].snapshots[0].knownPlayerIds, [1, 2]);
assert.deepEqual(robustAttempts[1].snapshots[1].knownPlayerIds, [], "坏名单JSON应降级为空数组");
assert.deepEqual(robustAttempts[1].snapshots[1].companionsByOwner, { 1: 2 }, "对象形式随行数据应被保留给核心归一化");
assert.equal(robustAttempts[1].snapshots[1].participantCount, 0, "非有限人数不能污染学习信号");
assert.deepEqual(JSON.parse(JSON.stringify(parseGroupLearningAttemptRows(null))), []);

let learningQuery = "";
let learningBindings = [];
let learningQueryCount = 0;
const boundedLearningDb = {
  prepare(sql) {
    learningQueryCount += 1;
    learningQuery = sql;
    return {
      bind(...bindings) {
        learningBindings = bindings;
        return { all: async () => ({ results: robustRows }) };
      },
    };
  },
};
const boundedAttempts = await listGroupLearningAttempts(
  boundedLearningDb,
  new Date("2026-09-04T04:00:00.000Z"),
);
assert.equal(learningQueryCount, 1, "学习数据必须由单个受限查询读取");
assert.deepEqual(learningBindings, ["main", "2025-09-05", "2026-09-04", 50]);
const learningAttemptSelectionEnd = learningQuery.indexOf("SELECT\n       attempt.attempt_id");
const learningAttemptSelection = learningQuery.slice(0, learningAttemptSelectionEnd);
assert.match(learningAttemptSelection, /attempt\.training_state = 'eligible'/);
assert.match(learningAttemptSelection, /EXISTS \([\s\S]*eligible_snapshot\.training_state = 'eligible'/);
assert.match(learningAttemptSelection, /ORDER BY attempt\.activity_date DESC, attempt\.id DESC[\s\S]*LIMIT \?/);
assert.ok(
  learningQuery.indexOf("LIMIT ?") < learningQuery.indexOf("INNER JOIN group_attempt_snapshots"),
  "必须先限制50个完整attempt，再关联其快照",
);
assert.match(learningQuery, /INNER JOIN group_attempt_snapshots/);
assert.doesNotMatch(learningQuery, /LEFT JOIN/, "完整attempt查询不能用LEFT JOIN制造空行或截断残片");
assert.match(learningQuery, /snapshot\.training_state = 'eligible'/, "试算快照不得占用训练预算");
assert.doesNotMatch(learningQuery, /SELECT\s+\*/i, "学习查询只能读取核心所需列");
assert.equal(boundedAttempts.length, 2);

const completeAttemptDatabase = new DatabaseSync(":memory:");
completeAttemptDatabase.exec(`
  CREATE TABLE group_attempts (
    id INTEGER PRIMARY KEY,
    activity_date TEXT NOT NULL,
    group_key TEXT NOT NULL,
    outcome TEXT NOT NULL,
    training_state TEXT NOT NULL,
    source TEXT NOT NULL
  );
  CREATE TABLE group_attempt_snapshots (
    id INTEGER PRIMARY KEY,
    attempt_id INTEGER NOT NULL,
    observed_at TEXT NOT NULL,
    training_state TEXT NOT NULL,
    participant_count INTEGER NOT NULL,
    known_player_ids_json TEXT NOT NULL,
    companions_by_owner_json TEXT NOT NULL
  );
`);
const insertCompleteAttempt = completeAttemptDatabase.prepare(
  "INSERT INTO group_attempts (id, activity_date, group_key, outcome, training_state, source) VALUES (?, ?, 'main', 'failure', ?, 'tracked')"
);
const insertCompleteSnapshot = completeAttemptDatabase.prepare(
  "INSERT INTO group_attempt_snapshots (id, attempt_id, observed_at, training_state, participant_count, known_player_ids_json, companions_by_owner_json) VALUES (?, ?, ?, ?, ?, ?, '[]')"
);
for (let index = 0; index < 51; index += 1) {
  const attemptId = index + 1;
  const activityDate = new Date(Date.UTC(2026, 6, 1 + index)).toISOString().slice(0, 10);
  insertCompleteAttempt.run(attemptId, activityDate, "eligible");
  insertCompleteSnapshot.run(attemptId * 10 + 1, attemptId, `${activityDate}T08:00:00.000Z`, "eligible", 1, `[${attemptId}]`);
  insertCompleteSnapshot.run(attemptId * 10 + 2, attemptId, `${activityDate}T08:01:00.000Z`, "excluded", 2, `[${attemptId},999]`);
  insertCompleteSnapshot.run(attemptId * 10 + 3, attemptId, `${activityDate}T08:02:00.000Z`, "eligible", 2, `[${attemptId},1]`);
}
insertCompleteAttempt.run(100, "2026-09-01", "excluded");
insertCompleteSnapshot.run(1001, 100, "2026-09-01T08:00:00.000Z", "eligible", 1, "[100]");
const completeAttemptD1 = {
  prepare(sql) {
    return {
      bind(...bindings) {
        return { all: async () => ({ results: completeAttemptDatabase.prepare(sql).all(...bindings) }) };
      },
    };
  },
};
const completeAttempts = await listGroupLearningAttempts(
  completeAttemptD1,
  new Date("2026-09-04T04:00:00.000Z"),
);
assert.equal(completeAttempts.length, 50, "最近50个eligible attempt必须完整进入训练");
assert.equal(completeAttempts[0].id, 2, "第51个较老attempt应在JOIN前被整体排除");
assert.equal(completeAttempts.at(-1).id, 51);
assert.ok(completeAttempts.every((attempt) => attempt.snapshots.length === 2), "不能返回被行级LIMIT截断的残片attempt");
assert.ok(completeAttempts.every((attempt) => (
  attempt.snapshots.every((snapshot) => snapshot.trainingState === "eligible")
)), "excluded试算快照不能进入训练或占用行预算");
assert.equal(completeAttempts.some((attempt) => attempt.id === 100), false, "excluded试算attempt不能占用50个名额");
completeAttemptDatabase.close();

const coldStartSignals = buildGroupLearningColdStart(
  [{ id: 1, createdAt: "2026-09-01T00:00:00.000Z" }],
  [],
  new Date("2026-09-04T04:00:00.000Z"),
);
assert.equal(coldStartSignals.version, GROUP_LEARNING_VERSION);
assert.equal(coldStartSignals.training.eligibleAttemptCount, 0, "冷启动严禁把快照作为训练输入");
assert.equal(parseCachedGroupLearningSignals("not-json"), null);
assert.equal(parseCachedGroupLearningSignals(JSON.stringify({ ...coldStartSignals, snapshots: [] })), null);
assert.equal(
  parseCachedGroupLearningSignals(JSON.stringify({ ...coldStartSignals, version: "group-learning-v0" })),
  null,
  "旧版缓存必须拒绝并触发冷启动，等待定时重建",
);

let cacheReadCount = 0;
let cacheReadSql = "";
const badCacheDb = {
  prepare(sql) {
    cacheReadCount += 1;
    cacheReadSql = sql;
    return {
      bind(...bindings) {
        assert.deepEqual(bindings, ["current"]);
        return { first: async () => ({ model_json: "not-json" }) };
      },
    };
  },
};
const badCachedSignals = await getCachedGroupLearningSignals(badCacheDb);
const safeFallbackSignals = badCachedSignals || buildGroupLearningColdStart([], [], new Date("2026-09-04T04:00:00.000Z"));
assert.equal(cacheReadCount, 1);
assert.match(cacheReadSql, /SELECT model_json FROM group_learning_model_cache/);
assert.doesNotMatch(cacheReadSql, /group_attempt_snapshots/, "bootstrap缓存读取不能扫描历史快照");
assert.equal(safeFallbackSignals.training.eligibleAttemptCount, 0, "坏缓存必须退回安全冷启动");

assert.equal(getBeijingDateString(new Date("2026-09-03T16:00:00.000Z")), "2026-09-04");
assert.equal(
  getGroupAttemptSettlementCutoffDate(new Date("2026-09-05T04:04:59.000Z")),
  "2026-09-03",
  "北京时间次日 12:05 前不能把昨天自动判为流局",
);
assert.equal(
  getGroupAttemptSettlementCutoffDate(new Date("2026-09-05T04:05:00.000Z")),
  "2026-09-04",
  "北京时间次日 12:05 起可以结算昨天",
);
assert.equal(isGroupAttemptDue("2026-09-04", new Date("2026-09-05T04:05:00.000Z")), true);

const validSnapshot = {
  activityDate: "2026-09-04",
  clientEventId: "8b3b04c0-f7e8-4e18-b73e-0cba9416af88",
  observedAt: "2026-09-04T08:00:00.000Z",
  trigger: "paste",
  trainingState: "eligible",
  participantCount: 5,
  knownPlayerIds: [2, 1],
  companionsByOwner: [{ ownerPlayerId: 1, count: 2 }],
  unresolvedCount: 1,
  activeConstraints: [
    { playerId: 2, type: "onlyLargeSessions" },
    { playerId: 1, type: "not_within_days" },
  ],
  probabilityToday: 0.64,
  probabilityTomorrow: 0.42,
  modelVersion: "group-success-v0",
  features: {
    currentParticipantCount: 5,
    expectedFinalCount: 7.25,
    weekdayBaselineToday: 0.56,
    weekdayBaselineTomorrow: 0.39,
    rankingMode: "attendanceProbabilityTimesUplift",
  },
};
const requestNow = new Date("2026-09-04T08:05:00.000Z");
const normalizeSnapshot = (payload, now = requestNow) => normalizeGroupAttemptSnapshotInput(payload, now);
const normalized = normalizeSnapshot(validSnapshot);
assert.ok(normalized);
assert.deepEqual([...normalized.knownPlayerIds], [1, 2]);
assert.equal(normalized.observedAt, "2026-09-04T08:00:00.000Z");
assert.equal(
  stableJsonStringify({ b: 2, a: { d: 4, c: 3 } }),
  stableJsonStringify({ a: { c: 3, d: 4 }, b: 2 }),
  "对象键顺序不应改变服务端状态哈希",
);

assert.equal(normalizeSnapshot({ ...validSnapshot, participantCount: 6 }), null, "人数恒等式必须成立");
assert.equal(normalizeSnapshot({ ...validSnapshot, probabilityToday: 64 }), null, "概率必须使用 0..1");
assert.equal(normalizeSnapshot({ ...validSnapshot, probabilityToday: "0.64" }), null, "概率字符串不能通过严格校验");
assert.equal(normalizeSnapshot({ ...validSnapshot, unresolvedCount: null }), null, "人数不能用 null 冒充零");
assert.equal(normalizeSnapshot({ ...validSnapshot, knownPlayerIds: ["1", 2] }), null, "成员 ID 必须是数字");
assert.equal(normalizeSnapshot({ ...validSnapshot, activityDate: "2026-09-03" }), null, "观察时间必须属于活动北京时间日期");
assert.equal(normalizeSnapshot({ ...validSnapshot, clientEventId: "retry-1" }), null, "事件 ID 必须是 UUID");
assert.equal(normalizeSnapshot({ ...validSnapshot, trigger: "fee_change" }), null, "费用变化不能进入名单追踪");
assert.equal(normalizeSnapshot({ ...validSnapshot, trainingState: "unknown" }), null, "快照训练状态必须明确");
assert.equal(
  normalizeSnapshot((({ trainingState: _ignored, ...rest }) => rest)(validSnapshot)),
  null,
  "快照训练状态不能为空",
);
assert.equal(normalizeSnapshot({ ...validSnapshot, extra: true }), null, "未知顶层字段必须拒绝");
assert.equal(normalizeSnapshot({
  ...validSnapshot,
  features: { ...validSnapshot.features, arbitrary: 1 },
}), null, "特征只能使用固定五字段");
assert.equal(normalizeSnapshot({
  ...validSnapshot,
  features: { ...validSnapshot.features, expectedFinalCount: "7.25" },
}), null, "数值特征不能使用字符串");
assert.equal(normalizeSnapshot({
  ...validSnapshot,
  features: { ...validSnapshot.features, rankingMode: "custom" },
}), null, "排序模式字符串必须来自固定枚举");
assert.equal(normalizeSnapshot({
  ...validSnapshot,
  features: { ...validSnapshot.features, weekdayBaselineToday: 1.01 },
}), null, "星期基线必须在0..1内");
assert.ok(normalizeSnapshot(validSnapshot, new Date("2026-09-04T08:10:00.000Z")), "十分钟时钟偏差允许写入");
assert.equal(
  normalizeSnapshot(validSnapshot, new Date("2026-09-04T08:10:00.001Z")),
  null,
  "超过十分钟的客户端时间必须拒绝",
);
assert.ok(normalizeSnapshot({
  ...validSnapshot,
  participantCount: 0,
  knownPlayerIds: [],
  companionsByOwner: [],
  unresolvedCount: 0,
  features: { ...validSnapshot.features, currentParticipantCount: 0 },
}), "已有尝试清空名单时应允许保存零人快照");
assert.equal(normalizeSnapshot({
  ...validSnapshot,
  activeConstraints: [{ playerId: 1, type: "invented_rule" }],
}), null, "约束类型必须来自已知规则");

class D1StatementAdapter {
  constructor(database, sql, bindings = []) {
    this.database = database;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new D1StatementAdapter(this.database, this.sql, bindings);
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.bindings) || null;
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.bindings) };
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.bindings);
    return {
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
      },
    };
  }
}

class D1DatabaseAdapter {
  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    return new D1StatementAdapter(this.database, sql);
  }
}

const database = new DatabaseSync(":memory:");
database.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE booking_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE booking_session_players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    slots INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE short_term_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    rule_type TEXT NOT NULL,
    rule_json TEXT NOT NULL DEFAULT '{}',
    starts_on TEXT,
    expires_on TEXT,
    raw_text TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  INSERT INTO booking_sessions (id, date) VALUES (1, '2026-09-01'), (2, '2026-09-02');
  INSERT INTO booking_session_players (session_id, slots)
  VALUES (1, 1), (1, 1), (1, 1), (1, 1), (1, 1), (1, 1),
         (2, 1), (2, 1), (2, 1), (2, 1), (2, 1);
  INSERT INTO short_term_rules
    (id, player_id, rule_type, rule_json, starts_on, expires_on, raw_text)
  VALUES (1, 7, 'not_within_days', '{"days":2}', '2026-09-01', '2026-09-02', '成员甲 两天内不打');
`);
database.exec(migrationSource);
database.exec(cacheMigrationSource);

assert.deepEqual(
  database.prepare("PRAGMA table_info(group_learning_model_cache)").all().map((row) => row.name),
  ["id", "model_json", "generated_at", "updated_at"],
  "学习模型缓存迁移必须建立固定单行结构",
);
assert.throws(
  () => database.prepare(
    "INSERT INTO group_learning_model_cache (id, model_json, generated_at) VALUES ('other', '{}', CURRENT_TIMESTAMP)"
  ).run(),
  /constraint/i,
  "缓存表只能接受current主键",
);

const migratedAttempts = database.prepare(
  "SELECT activity_date, outcome, training_state, source, actual_participant_count FROM group_attempts ORDER BY activity_date"
).all().map((row) => ({ ...row }));
assert.deepEqual(migratedAttempts, [
  {
    activity_date: "2026-09-01",
    outcome: "success",
    training_state: "excluded",
    source: "booking_backfill",
    actual_participant_count: 6,
  },
  {
    activity_date: "2026-09-02",
    outcome: "failure",
    training_state: "excluded",
    source: "booking_backfill",
    actual_participant_count: 5,
  },
]);
assert.equal(
  database.prepare("SELECT event_type FROM short_term_rule_history WHERE source_rule_id = 1").get().event_type,
  "migration_snapshot",
);

database.exec(`
  INSERT INTO short_term_rules
    (id, player_id, rule_type, rule_json, starts_on, expires_on, raw_text)
  VALUES (2, 8, 'not_before_date', '{}', '2026-09-04', '2026-09-05', '成员乙 9.6再打');
  UPDATE short_term_rules SET raw_text = '成员乙 9.6 再打' WHERE id = 2;
  DELETE FROM short_term_rules WHERE id = 2;
`);
assert.deepEqual(
  database.prepare("SELECT event_type FROM short_term_rule_history WHERE source_rule_id = 2 ORDER BY id").all().map((row) => ({ ...row })),
  [{ event_type: "created" }, { event_type: "updated" }, { event_type: "deleted" }],
  "规则被替换或删除后仍应有可回放历史",
);

const d1 = new D1DatabaseAdapter(database);
const snapshotFor = (overrides = {}) => ({
  ...normalized,
  knownPlayerIds: [...normalized.knownPlayerIds],
  companionsByOwner: normalized.companionsByOwner.map((item) => ({ ...item })),
  activeConstraints: normalized.activeConstraints.map((item) => ({ ...item })),
  features: { ...normalized.features },
  ...overrides,
});

const bookingBackfillSnapshot = await saveGroupAttemptSnapshot(d1, snapshotFor({
  activityDate: "2026-09-01",
  observedAt: "2026-09-01T08:00:00.000Z",
  clientEventId: "00000000-0000-4000-8000-000000000001",
  trainingState: "excluded",
}));
assert.equal(bookingBackfillSnapshot.created, true);
assert.equal(bookingBackfillSnapshot.attempt.source, "tracked", "真实快照应把 booking_backfill 升级为 tracked");
assert.equal(bookingBackfillSnapshot.attempt.trainingState, "excluded");
assert.equal(bookingBackfillSnapshot.snapshot.trainingState, "excluded");

const firstExcluded = await saveGroupAttemptSnapshot(d1, snapshotFor({
  activityDate: "2026-09-03",
  observedAt: "2026-09-03T08:00:00.000Z",
  clientEventId: "00000000-0000-4000-8000-000000000002",
  trainingState: "excluded",
}));
assert.equal(firstExcluded.attempt.trainingState, "excluded", "首次attempt应继承首张快照状态");

const thenEligible = await saveGroupAttemptSnapshot(d1, snapshotFor({
  activityDate: "2026-09-03",
  observedAt: "2026-09-03T08:01:00.000Z",
  clientEventId: "00000000-0000-4000-8000-000000000003",
  trainingState: "eligible",
}));
assert.equal(thenEligible.created, true, "训练状态变化不能被同名单短时去重");
assert.equal(thenEligible.attempt.trainingState, "eligible", "eligible快照应升级attempt");

const laterExcluded = await saveGroupAttemptSnapshot(d1, snapshotFor({
  activityDate: "2026-09-03",
  observedAt: "2026-09-03T08:06:01.000Z",
  clientEventId: "00000000-0000-4000-8000-000000000004",
  trainingState: "excluded",
}));
assert.equal(laterExcluded.attempt.trainingState, "eligible", "excluded快照不能把已有eligible attempt降级");

database.prepare(`
  INSERT INTO group_attempts
    (activity_date, group_key, outcome, training_state, source, first_observed_at, last_observed_at)
  VALUES ('2026-09-04', 'main', 'pending', 'eligible', 'tracked', '2026-09-04T08:00:00.000Z', '2026-09-04T08:00:00.000Z')
`).run();
const cappedAttemptId = Number(database.prepare(
  "SELECT id FROM group_attempts WHERE activity_date = '2026-09-04' AND group_key = 'main'"
).get().id);
const seedSnapshot = database.prepare(`
  INSERT INTO group_attempt_snapshots
    (attempt_id, client_event_id, observed_at, trigger_type, training_state, roster_hash, context_hash,
     participant_count, known_player_ids_json, companions_by_owner_json, unresolved_count,
     active_constraints_json, probability_today, probability_tomorrow, model_version, features_json)
  VALUES (?, ?, ?, 'input', 'eligible', ?, ?, 0, '[]', '[]', 0, '[]', 0.5, 0.4, 'group-probability-v0', ?)
`);
for (let index = 0; index < 199; index += 1) {
  seedSnapshot.run(
    cappedAttemptId,
    `seed-${index}`,
    `2026-09-04T07:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`,
    `roster-${index}`,
    `context-${index}`,
    JSON.stringify({
      currentParticipantCount: 0,
      expectedFinalCount: 0,
      weekdayBaselineToday: 0.56,
      weekdayBaselineTomorrow: 0.39,
      rankingMode: "attendanceProbability",
    }),
  );
}
const twoHundredthPayload = snapshotFor({
  activityDate: "2026-09-04",
  observedAt: "2026-09-04T08:00:00.000Z",
  clientEventId: "00000000-0000-4000-8000-000000000005",
});
const twoHundredth = await saveGroupAttemptSnapshot(d1, twoHundredthPayload);
assert.equal(twoHundredth.created, true);
assert.equal(database.prepare(
  "SELECT COUNT(*) AS count FROM group_attempt_snapshots WHERE attempt_id = ?"
).get(cappedAttemptId).count, 200);

const idempotentAtLimit = await saveGroupAttemptSnapshot(d1, twoHundredthPayload);
assert.equal(idempotentAtLimit.deduplicated, true, "上限后相同UUID重试仍应幂等成功");
const duplicateAtLimit = await saveGroupAttemptSnapshot(d1, snapshotFor({
  ...twoHundredthPayload,
  clientEventId: "00000000-0000-4000-8000-000000000006",
}));
assert.equal(duplicateAtLimit.deduplicated, true, "上限后短时间相同状态仍应正常去重");
const rejectedAtLimit = await saveGroupAttemptSnapshot(d1, snapshotFor({
  ...twoHundredthPayload,
  clientEventId: "00000000-0000-4000-8000-000000000007",
  features: { ...twoHundredthPayload.features, expectedFinalCount: twoHundredthPayload.features.expectedFinalCount + 0.1 },
}));
assert.equal(rejectedAtLimit.limitExceeded, true, "第201个不同状态必须被上限拒绝");

const outcomes = await listGroupAttemptOutcomes(d1);
const upgradedOutcome = outcomes.find((item) => item.activityDate === "2026-09-03");
assert.deepEqual(Object.keys(upgradedOutcome).sort(), [
  "activityDate", "hasEligibleSnapshots", "outcome", "source", "trainingState",
].sort(), "bootstrap聚合不得泄露roster");
assert.equal(upgradedOutcome.hasEligibleSnapshots, true);
const sqlLearningAttempts = await listGroupLearningAttempts(d1, requestNow);
const sqlLearnedSeptemberThird = sqlLearningAttempts.find((attempt) => attempt.activityDate === "2026-09-03");
assert.ok(sqlLearnedSeptemberThird, "真实SQLite查询应能读取窗口内attempt");
assert.equal(sqlLearnedSeptemberThird.snapshots.length, 1, "真实SQLite查询只能返回完整attempt中的eligible快照");
assert.deepEqual(
  [...sqlLearnedSeptemberThird.snapshots[0].knownPlayerIds],
  [1, 2],
  "真实SQLite查询应把名单JSON留在服务端学习输入中解析",
);
const rebuiltSignals = await rebuildGroupLearningSignals(d1, requestNow);
const rebuiltCacheRow = database.prepare(
  "SELECT id, model_json, generated_at FROM group_learning_model_cache WHERE id = 'current'"
).get();
assert.equal(rebuiltCacheRow.id, "current");
assert.equal(rebuiltCacheRow.generated_at, rebuiltSignals.generatedAt);
assert.deepEqual(
  JSON.parse(rebuiltCacheRow.model_json),
  rebuiltSignals,
  "显式重建必须把完整聚合信号原子写入缓存",
);
assert.doesNotMatch(
  rebuiltCacheRow.model_json,
  /knownPlayerIds|known_player_ids_json|companionsByOwner|companions_by_owner_json|"snapshots"/,
  "缓存不得保存原始名单或快照",
);
assert.equal((await getCachedGroupLearningSignals(d1)).version, "group-learning-v1");

database.prepare("UPDATE group_attempts SET outcome = 'pending' WHERE activity_date = '2026-09-01'").run();
database.prepare("UPDATE group_attempts SET outcome = 'success' WHERE activity_date = '2026-09-02'").run();
database.prepare("UPDATE group_attempts SET outcome = 'success' WHERE activity_date = '2026-09-03'").run();
await settleDueGroupAttempts(d1, new Date("2026-09-04T04:05:00.000Z"));
assert.equal(database.prepare("SELECT outcome FROM group_attempts WHERE activity_date = '2026-09-01'").get().outcome, "success");
assert.equal(database.prepare("SELECT outcome FROM group_attempts WHERE activity_date = '2026-09-02'").get().outcome, "failure");
assert.deepEqual(
  { ...database.prepare("SELECT outcome, outcome_source FROM group_attempts WHERE activity_date = '2026-09-03'").get() },
  { outcome: "failure", outcome_source: "auto_no_qualifying_booking" },
  "无订场的错误success终态也必须被批量重算",
);
database.prepare("DELETE FROM group_attempts WHERE activity_date = '2026-09-02'").run();
await settleDueGroupAttempts(d1, new Date("2026-09-04T04:05:00.000Z"));
assert.deepEqual(
  { ...database.prepare("SELECT outcome, source FROM group_attempts WHERE activity_date = '2026-09-02'").get() },
  { outcome: "failure", source: "booking_backfill" },
  "定时任务应从订场记录修复首次安全对账漏建的attempt",
);
database.prepare(
  "UPDATE group_learning_model_cache SET model_json = 'broken', generated_at = 'broken' WHERE id = 'current'"
).run();
const maintenanceResult = await runScheduledGroupLearningMaintenance(
  d1,
  new Date("2026-09-05T04:05:00.000Z"),
);
assert.equal(maintenanceResult.settlement.cutoffDate, "2026-09-04");
assert.equal(maintenanceResult.groupLearningSignals.version, "group-learning-v1");
assert.equal(
  parseCachedGroupLearningSignals(database.prepare(
    "SELECT model_json FROM group_learning_model_cache WHERE id = 'current'"
  ).get().model_json).version,
  "group-learning-v1",
  "定时结算后必须重建并覆盖坏缓存",
);

const safeResult = await safelyReconcileGroupAttemptOutcome({
  prepare() {
    throw new Error("simulated tracking outage");
  },
}, "2026-09-04");
assert.equal(safeResult, null, "安全对账失败不能向订场主流程抛错");
const safeLearningResult = await safelyRebuildGroupLearningSignals({
  prepare() {
    throw new Error("simulated learning outage");
  },
}, requestNow);
assert.equal(safeLearningResult, null, "学习重建失败必须独立降级，不能反向影响结算");
assert.ok(capturedErrors.length > 0, "安全对账失败应留下服务端错误日志");

assert.match(workerSource, /pathname === "\/api\/group-attempts\/snapshots" && method === "POST"/);
assert.match(workerSource, /CLIENT_EVENT_ID_PATTERN/);
assert.match(workerSource, /julianday\(observed_at\).*GROUP_ATTEMPT_DEDUPE_SECONDS/s);
assert.match(workerSource, /async scheduled\(controller, env, context\)/);
assert.match(workerSource, /GROUP_ATTEMPT_SUCCESS_COUNT = 6/);
assert.match(workerSource, /GROUP_ATTEMPT_MAX_SNAPSHOTS = 200/);
assert.match(workerSource, /GROUP_ATTEMPT_RATE_LIMITER\.limit\(\{ key \}\)/);
assert.match(workerSource, /listGroupAttemptOutcomes\(env\.DB\)/);
assert.match(workerSource, /import \{[\s\S]*buildGroupLearningSignals,[\s\S]*GROUP_LEARNING_VERSION,[\s\S]*\} from "\.\/group-learning-core\.js"/);
assert.match(migrationSource, /trigger_type TEXT NOT NULL,\s+training_state TEXT NOT NULL DEFAULT 'eligible'/);
assert.match(cacheMigrationSource, /CREATE TABLE IF NOT EXISTS group_learning_model_cache/);
assert.match(cacheMigrationSource, /CHECK \(id = 'current'\)/);
assert.match(workerSource, /context\.waitUntil\(runScheduledGroupLearningMaintenance\(env\.DB, now\)\)/);

const bootstrapStart = workerSource.indexOf('if (pathname === "/api/bootstrap" && method === "GET")');
const bootstrapEnd = workerSource.indexOf('if (pathname === "/api/estimator"', bootstrapStart);
const bootstrapRoute = workerSource.slice(bootstrapStart, bootstrapEnd);
assert.match(bootstrapRoute, /getCachedGroupLearningSignals\(env\.DB\)/);
assert.match(bootstrapRoute, /cachedGroupLearningSignals \|\| buildGroupLearningColdStart/);
assert.doesNotMatch(
  bootstrapRoute,
  /listGroupLearningAttempts|group_attempt_snapshots/,
  "公开bootstrap不得扫描历史接龙快照",
);
assert.match(bootstrapRoute, /groupLearningSignals/);
const bootstrapResponseStart = bootstrapRoute.indexOf("return json({");
const bootstrapResponse = bootstrapRoute.slice(bootstrapResponseStart);
assert.doesNotMatch(
  bootstrapResponse,
  /groupLearningAttempts|known_player_ids_json|companions_by_owner_json|snapshots\s*:/,
  "bootstrap只能返回聚合学习信号，不能泄露原始名单或快照",
);

const rebuildRouteStart = workerSource.indexOf('if (pathname === "/api/group-learning/rebuild" && method === "POST")');
const rebuildRouteEnd = workerSource.indexOf('if (pathname === "/api/group-attempts/current"', rebuildRouteStart);
const rebuildRoute = workerSource.slice(rebuildRouteStart, rebuildRouteEnd);
assert.match(rebuildRoute, /isAdminRequest\(request\)/, "手动重建必须限制为管理端来源");
assert.match(rebuildRoute, /consumeGroupAttemptRateLimit\(request, env\)/, "手动重建必须沿用现有限流");
assert.match(rebuildRoute, /rebuildGroupLearningSignals\(env\.DB\)/);
assert.doesNotMatch(rebuildRoute, /snapshots\s*:|knownPlayerIds|companionsByOwner/);

assert.match(snapshotSource, /import \{ buildGroupLearningSignals \} from "\.\.\/src\/group-learning-core\.js"/);
assert.match(snapshotSource, /GROUP_LEARNING_LOOKBACK_DAYS = 365/);
assert.match(snapshotSource, /GROUP_LEARNING_MAX_ATTEMPTS = 50/);
assert.match(snapshotSource, /GROUP_LEARNING_MAX_ROWS = 10_000/);
assert.match(snapshotSource, /resultSets\.length < 10/);
const snapshotLearningQueryStart = snapshotSource.indexOf("WITH selected_group_learning_attempts AS (");
const snapshotLearningQueryEnd = snapshotSource.indexOf("`;", snapshotLearningQueryStart);
const snapshotLearningQuery = snapshotSource.slice(snapshotLearningQueryStart, snapshotLearningQueryEnd);
assert.ok(
  snapshotLearningQuery.indexOf("LIMIT ${GROUP_LEARNING_MAX_ATTEMPTS}")
    < snapshotLearningQuery.indexOf("INNER JOIN group_attempt_snapshots"),
  "静态快照也必须先选50个完整attempt再JOIN",
);
assert.match(snapshotLearningQuery, /attempts\.training_state = 'eligible'/);
assert.match(snapshotLearningQuery, /eligible_snapshots\.training_state = 'eligible'/);
assert.match(snapshotLearningQuery, /snapshots\.training_state = 'eligible'/);
assert.doesNotMatch(snapshotLearningQuery, /LEFT JOIN/);
const snapshotOutputStart = snapshotSource.indexOf("const snapshot = {");
const snapshotOutputEnd = snapshotSource.indexOf("await mkdir", snapshotOutputStart);
const snapshotOutput = snapshotSource.slice(snapshotOutputStart, snapshotOutputEnd);
assert.match(snapshotOutput, /groupLearningSignals/);
assert.doesNotMatch(
  snapshotOutput,
  /groupLearningRows|groupLearningAttempts|known_player_ids_json|companions_by_owner_json|snapshots\s*:/,
  "GitHub快照只能写入聚合学习信号，不能写入原始名单或快照",
);

const shortRuleGetStart = workerSource.indexOf('if (pathname === "/api/short-term-rules" && method === "GET")');
const shortRulePostStart = workerSource.indexOf('if (pathname === "/api/short-term-rules" && method === "POST")', shortRuleGetStart);
const shortRuleGet = workerSource.slice(shortRuleGetStart, shortRulePostStart);
assert.doesNotMatch(shortRuleGet, /deleteExpiredShortTermRules/, "GET 不得再物理删除过期规则");

const sessionRoutesStart = workerSource.indexOf('if (pathname === "/api/sessions" && method === "POST")');
const sessionRoutesEnd = workerSource.indexOf('if (pathname === "/api/payment-settings"', sessionRoutesStart);
const sessionRoutes = workerSource.slice(sessionRoutesStart, sessionRoutesEnd);
assert.equal(
  (sessionRoutes.match(/safelyReconcileGroupAttemptOutcome/g) || []).length,
  4,
  "订场新增、改期前后和删除都必须安全地重新结算接龙结果",
);
assert.doesNotMatch(sessionRoutes, /await reconcileGroupAttemptOutcome/, "追踪对账失败不能让已写入的订场返回500");
const scheduledSectionStart = workerSource.indexOf("async function settleDueGroupAttempts(");
const scheduledSectionEnd = workerSource.indexOf("function buildShortTermRuleInsert(", scheduledSectionStart);
const scheduledSection = workerSource.slice(scheduledSectionStart, scheduledSectionEnd);
assert.doesNotMatch(scheduledSection, /outcome = 'pending'/, "定时任务必须重扫所有终态以修复漂移");
assert.match(scheduledSection, /INSERT OR IGNORE INTO group_attempts/, "定时任务应批量修复漏建的booking_backfill");
assert.match(scheduledSection, /UPDATE group_attempts AS attempt/, "定时任务应批量重算截止日终态");
assert.equal((scheduledSection.match(/\.run\(\)/g) || []).length, 2, "定时结算的D1语句数必须固定");
assert.doesNotMatch(scheduledSection, /\.all\(\)|for\s*\(/, "定时结算不能把历史日期读回后逐日查询");
assert.doesNotMatch(scheduledSection, /reconcileGroupAttemptOutcome\(/, "定时结算不能逐日调用单次对账");
assert.match(workerSource, /training_state = \?, updated_at = CURRENT_TIMESTAMP/);
assert.match(workerSource, /\["eligible", "excluded"\]/);

database.close();
console.log("Group-attempt migration, validation, deduplication, rule history, and settlement contracts passed.");
