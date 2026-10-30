import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import "../member-statistics.js";

const origin = "https://badminton.choi975.workers.dev";
async function get(path) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(30000), cache: "no-store" });
      assert.equal(response.status, 200, `Live ${path} must be available`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
  throw lastError;
}
const [html, statisticsText, bootstrapText, statisticsSource, probabilitySource] = await Promise.all([
  get("/"), get("/api/member-statistics"), get("/api/bootstrap"), get("/member-statistics.js"), get("/group-probability.js"),
]);
assert.ok(html.includes("<summary>成员统计</summary>"));
assert.match(html, /id="refreshMemberStatisticsBtn"[^>]*type="button"/);
assert.match(html, /getShakeRecommendationBadges/);
assert.match(html, /api\("\/api\/member-statistics\/refresh"/);
assert.match(html, /id="shakeMemberStatisticsBlock"[^>]*\bopen[ >]/);
assert.match(html, /recentMemberIds\.has\(Number\(candidate.player.id\)\)/);
assert.match(html, /!recentMemberIds\.has\(playerId\)/);
assert.doesNotMatch(html, /长期规则|短期规则|成员统计名单|每周固定安排/);
assert.doesNotMatch(html, /<li>[^<]*只打 周/, "retired allowlists are not offered in the rule editor");
const digest = (text) => createHash("sha256").update(text.replaceAll("\r\n", "\n").trim()).digest("hex");
assert.equal(digest(statisticsSource), digest(readFileSync(new URL("../member-statistics.js", import.meta.url), "utf8")), "Cloudflare must serve the current shared statistics module");
assert.equal(digest(probabilitySource), digest(readFileSync(new URL("../group-probability.js", import.meta.url), "utf8")), "Cloudflare must serve the current probability module");
const statistics = JSON.parse(statisticsText).memberStatistics;
const bootstrap = JSON.parse(bootstrapText);
assert.equal(statistics.version, globalThis.BadmintonMemberStatistics.VERSION);
assert.equal(statistics.lists.length, 14);
assert.equal(bootstrap.groupLearningSignals.version, "group-learning-v2");
assert.ok(bootstrap.shortTermRules.every((rule) => rule.type !== "only_days"), "live bootstrap excludes retired allowlists");
const expected = globalThis.BadmintonMemberStatistics.build({
  players: bootstrap.players, sessions: bootstrap.sessions,
  bestPartnerOverrides: bootstrap.bestPartnerOverrides,
  now: bootstrap.memberStatistics.generatedAt, asOf: bootstrap.memberStatistics.asOf, calendar: bootstrap.memberStatistics.calendar,
});
assert.deepEqual(bootstrap.memberStatistics.lists, expected.lists, "Worker and browser statistics must agree for live records");
assert.deepEqual(bootstrap.memberStatistics.bestPartners, expected.bestPartners, "Worker and browser best-partner evidence must agree");
assert.match(html, /key: "bestPartners", label: "最佳拍档"/);
assert.ok(html.includes('function renderBestPartnerStatistics('));
assert.ok(statistics.lists.filter((list) => list.key === "onlyLargeSessions" || list.key.startsWith("noWeekday") || list.key.startsWith("weeklyMax")).every((list) => list.memberIds.every((id) => statistics.members.find((m) => m.playerId === id).attendance30 >= 2)));
const ranking = statistics.lists.find((list) => list.key === "attendance15");
const cutoff = Math.max(1, statistics.members[9]?.attendance15 || 0);
assert.deepEqual(ranking.memberIds, statistics.members.filter((m) => m.attendance15 >= cutoff).map((m) => m.playerId));
console.log(JSON.stringify({ result: "Cloudflare live verification passed", asOf: statistics.asOf,
  categories: statistics.lists.length, partnerPairs: statistics.bestPartners.pairs.length, rankingWithTies: ranking.memberIds.length, activeMembers: statistics.activeMemberCount, learningVersion: bootstrap.groupLearningSignals.version }));

const backgroundFiles = ["forecast-client.js", "forecast-worker.js", "optimistic-sync.js"];
for (const file of backgroundFiles) {
  assert.equal(digest(await get("/" + file)), digest(readFileSync(new URL("../" + file, import.meta.url), "utf8")), "Cloudflare must serve " + file);
}
const shakeState = JSON.parse(await get("/api/shake-state")).confirmed;
assert.ok(Number.isInteger(shakeState.revision) && Array.isArray(shakeState.rules));
assert.ok(shakeState.rules.every((rule) => rule.type !== "only_days"));
const [rulesText, snapshotText] = await Promise.all([get("/api/short-term-rules"), get("/bootstrap-snapshot.json")]);
assert.ok(JSON.parse(rulesText).rules.every((rule) => rule.type !== "only_days"));
assert.ok(JSON.parse(snapshotText).data.shortTermRules.every((rule) => rule.type !== "only_days"), "deployed fallback snapshot excludes retired allowlists");
assert.match(html, /forecast-client\.js/);
assert.ok(!html.includes("engine.estimate("));
console.log("Background forecast assets and durable shake state verified live.");
