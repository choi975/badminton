import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import vm from "node:vm";
import "../member-statistics.js";
import "../group-probability.js";
const core = globalThis.BadmintonMemberStatistics;
const now = "2026-10-27T12:00:00+08:00";
const players = Array.from({ length: 8 }, (_, index) => ({ id: index + 1, name: "成员" + (index + 1), createdAt: "2026-07-01", level: "3级" }));
const sessions = Array.from({ length: 24 }, (_, index) => ({ id: index + 1, date: core.addDays("2026-09-01", index * 2),
  players: [1, 2, 3, 4, 5, 6, 7 + index % 2].map((playerId) => ({ playerId, slots: 1, plusCount: 0 })) }));
const build = (bestPartnerOverrides, extra = {}) => core.build({ players, sessions, now, bestPartnerOverrides, ...extra });
assert.equal(core.partnerKey([2, 1]), "1:2");
for (const ids of [[1, 1], [1, 0], [1, -2], [1, Infinity], [1], [1, 2, 3]]) assert.equal(core.partnerKey(ids), "");
assert.deepEqual(core.normalizePartnerOverrides("bad json"), core.normalizePartnerOverrides(null));
let overrides = core.normalizePartnerOverrides(null);
const edit = (operation) => {
  overrides = core.editPartnerOverrides({ overrides, pairs: build(overrides).bestPartners.pairs, players, now, ...operation });
  return build(overrides);
};
edit({ action: "create", playerIds: [2, 1] });
edit({ action: "create", playerIds: [2, 3] });
assert.deepEqual(build(overrides).bestPartners.pairs.map((p) => p.playerIds), [[2, 3], [1, 2]]);
assert.deepEqual(core.partnerIdsMap(build(overrides)).get(2), [3, 1], "a member can have several direct partners in display order");
assert.deepEqual(core.partnerIdsMap(build(overrides)).get(1), [2], "A-B and B-C do not create A-C");
assert.throws(() => edit({ action: "create", playerIds: [1, 2] }), /已在名单/);
edit({ action: "move", playerIds: [1, 2], direction: "up" });
assert.deepEqual(build(overrides).bestPartners.pairs[0].playerIds, [1, 2]);
const persisted = core.normalizePartnerOverrides(JSON.stringify(overrides));
assert.deepEqual(build(persisted).bestPartners, build(overrides).bestPartners, "reload retains manual ordering");
assert.equal(build(overrides, { now: "2027-04-01T12:00:00+08:00" }).bestPartners.pairs.length, 2, "manual relationships survive inactivity and rolling windows");
assert.equal(build(overrides, { now: "2026-10-26T12:00:00+08:00" }).bestPartners.pairs.length, 0, "future manual knowledge cannot leak into a historical forecast");
edit({ action: "delete", playerIds: [1, 2] });
assert.equal(build(overrides).bestPartners.pairs.length, 1);
assert.ok(overrides.excludedPairs.some((row) => core.partnerKey(row.playerIds) === "1:2"));
edit({ action: "create", playerIds: [1, 2] });
assert.ok(!overrides.excludedPairs.some((row) => core.partnerKey(row.playerIds) === "1:2"));
const noHistory = core.build({ players: [{ id: 1, name: "<img src=x>", createdAt: now }, { id: 2, name: "新人", createdAt: now }],
  sessions: [], now, bestPartnerOverrides: { manualPairs: [{ playerIds: [1, 2], createdAt: now }] } });
assert.equal(noHistory.bestPartners.pairs[0].togetherDays, 0);
assert.equal(noHistory.bestPartners.pairs[0].score, 0);
assert.deepEqual(noHistory.lists.find((row) => row.key === "bestPartners").memberIds, [1, 2]);
assert.ok(JSON.stringify(noHistory).includes("手工") === false, "names and evidence, not generated markup, remain data");
const fixture = JSON.parse(readFileSync(new URL("./fixtures/best-partners-2026-10-22.json", import.meta.url), "utf8"));
const automatic = core.build({ ...fixture, now: "2026-10-23T12:00:00+08:00" });
const removed = core.editPartnerOverrides({ overrides: null, pairs: automatic.bestPartners.pairs, players: fixture.players,
  action: "delete", playerIds: automatic.bestPartners.pairs[0].playerIds, now: "2026-10-23T12:00:00+08:00" });
assert.ok(!core.build({ ...fixture, now, bestPartnerOverrides: removed }).bestPartners.pairs
  .some((pair) => core.partnerKey(pair.playerIds) === core.partnerKey(automatic.bestPartners.pairs[0].playerIds)), "automatic refresh cannot resurrect a deleted pair");

// Execute production API handlers against real SQLite; never touch the remote database.
const worker = readFileSync(new URL("../src/worker.js", import.meta.url), "utf8");
function backend(name, async = false) {
  const start = worker.indexOf((async ? "async " : "") + "function " + name + "(");
  assert.ok(start >= 0, name);
  return worker.slice(start, worker.indexOf("\n}", start) + 2);
}
const sql = new DatabaseSync(":memory:");
sql.exec("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
let failWrite = false;
const db = { prepare(text) { let values = []; return {
  bind(...args) { values = args; return this; },
  async first() { return sql.prepare(text).get(...values) || null; },
  async run() { if (failWrite) throw new Error("D1 unavailable"); const result = sql.prepare(text).run(...values); return { meta: { changes: Number(result.changes) } }; },
}; } };
const server = vm.createContext({ BadmintonMemberStatistics: core, Response, Request, URL,
  Date: class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } },
  json: (data, status = 200) => Response.json(data, { status }),
  listPlayers: async () => players, listSessions: async () => sessions,
  consumeGroupAttemptRateLimit: async () => true, readMemberStatisticsCalendar: async () => core.normalizeCalendar(null),
});
vm.runInContext([backend("isAdminRequest"), backend("readBestPartnerSettings", true), backend("handleApi", true)].join("\n"), server);
const request = (body, origin = "https://badminton.choi975.workers.dev", route = "/api/best-partners") => {
  const req = new Request("https://badminton.choi975.workers.dev" + route, { method: body ? "POST" : "GET",
    headers: { origin, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return server.handleApi(req, { DB: db }, new URL(req.url));
};
const mutate = async (body) => { const response = await request(body); assert.equal(response.status, 200); return response.json(); };
assert.equal((await request({ action: "create", playerIds: [1, 2], revision: 0 }, "https://choi975.github.io")).status, 403);
assert.equal((await request({ action: "create", playerIds: [1, 1], revision: 0 })).status, 400);
assert.equal((await request({ action: "create", playerIds: [1, 999], revision: 0 })).status, 400);
assert.equal((await request({ action: "create", playerIds: [1, 2], revision: 99 })).status, 409);
const saved1 = await mutate({ action: "create", playerIds: [1, 2], revision: 0 });
assert.equal(saved1.bestPartnerOverrides.revision, 1);
assert.deepEqual(saved1.memberStatistics.bestPartners.pairs[0].playerIds, [1, 2]);
const races = await Promise.all([
  request({ action: "create", playerIds: [2, 3], revision: 1 }),
  request({ action: "create", playerIds: [4, 5], revision: 1 }),
]);
assert.deepEqual(races.map((response) => response.status).sort(), [200, 409], "CAS prevents lost updates from simultaneous devices");
const loaded = await (await request(null, undefined, "/api/member-statistics")).json();
assert.equal(loaded.bestPartnerOverrides.revision, 2);
assert.deepEqual(loaded.memberStatistics.bestPartners, build(loaded.bestPartnerOverrides).bestPartners);
const deleted = await mutate({ action: "delete", playerIds: [1, 2], revision: 2 });
assert.equal(deleted.bestPartnerOverrides.revision, 3);
failWrite = true;
await assert.rejects(request({ action: "create", playerIds: [1, 2], revision: 3 }), /D1 unavailable/);
assert.equal((await (await request(null, undefined, "/api/member-statistics")).json()).bestPartnerOverrides.revision, 3);
sql.close();

// Full-model contracts: same data, different display order => identical probabilities.
const input = { players, sessions, now, targetDate: "2026-10-27", entries: [{ playerId: 1 }],
  bestPartnerOverrides: overrides, simulations: 600, calibrationSimulations: 200, includeCounterfactuals: false, seed: 8422 };
const forecast = (extra = {}) => BadmintonGroupProbability.estimate({ ...input, ...extra });
const baseline = forecast();
const reordered = forecast({ bestPartnerOverrides: { ...overrides, order: [...overrides.order].reverse() } });
assert.equal(baseline.todayProbability, reordered.todayProbability);
assert.equal(baseline.tomorrowProbability, reordered.tomorrowProbability);
assert.deepEqual(baseline.candidates, reordered.candidates);
const second = baseline.candidates.find((row) => row.playerId === 2);
const third = baseline.candidates.find((row) => row.playerId === 3);
assert.deepEqual(second.friendPlayerIds, [1]);
assert.ok(second.reasons.includes("与已接龙成员是朋友"));
assert.deepEqual(third.friendPlayerIds, []);
assert.ok(!third.reasons.includes("与已接龙成员是朋友"));
assert.ok(baseline.candidates.every((row) => !row.reasons.includes("常与已接龙成员同场")));
assert.equal(baseline.rankingMode, "attendanceProbability");
assert.equal(baseline.counterfactualSimulationCount, 0);
const noFriends = forecast({ bestPartnerOverrides: null });
assert.ok(second.attendanceProbability > noFriends.candidates.find((row) => row.playerId === 2).attendanceProbability);
const guestsOnly = forecast({ entries: [{ isCompanion: true, ownerPlayerId: 1, count: 1 }] });
assert.ok(guestsOnly.candidates.every((row) => !row.reasons.includes("与已接龙成员是朋友")), "a guest does not claim the owner is personally attending");
const futureSignal = forecast({ groupLearningSignals: { generatedAt: "2026-11-01T12:00:00Z", influence: { 1: { 2: { lift: 0.15, evidence: 60, reliability: 1 } } } } });
assert.equal(futureSignal.candidates.find((row) => row.playerId === 2).attendanceProbability, second.attendanceProbability);
const unlistedLearning = forecast({ bestPartnerOverrides: null, groupLearningSignals: { influence: { 1: { 3: { lift: 0.15, evidence: 60, reliability: 1 } } } } });
assert.equal(unlistedLearning.candidates.find((row) => row.playerId === 3).attendanceProbability,
  noFriends.candidates.find((row) => row.playerId === 3).attendanceProbability, "old influence cannot silently resurrect an unlisted relationship");
console.log("Partner management: canonical pairs, manual persistence, deletion suppression, restore, ordering, cold starts, direct-only friendship, real SQLite API/CAS, read-only protection and probability invariance passed.");
