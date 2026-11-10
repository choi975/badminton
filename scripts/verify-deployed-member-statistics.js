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
assert.equal(statistics.lists.length, 21);
assert.equal(globalThis.BadmintonMemberStatistics.WEEKDAY_POLICY.minAvoidedOpportunities, 1);
assert.equal(globalThis.BadmintonMemberStatistics.WEEKDAY_POLICY.minOtherAttendanceDays, 1);
assert.equal(globalThis.BadmintonMemberStatistics.WEEKDAY_POLICY.minPreferredDays, 1);
assert.ok(html.includes("且其他星期至少一个本人出勤日"));
assert.ok(html.includes("至少一个周X本人出勤日，不要求其他星期出勤"));
assert.doesNotMatch(html, /其他星期至少两个|喜欢打周X：至少两个/);
assert.ok(html.includes("入群后至少一个周X有成局机会却均未出勤"));
assert.equal(bootstrap.groupLearningSignals.version, "group-learning-v3");
const preferred = statistics.lists.filter(list => list.key.startsWith("preferredWeekday"));
assert.deepEqual(preferred.map(list => list.key), [1, 2, 3, 4, 5, 6, 0].map(day => "preferredWeekday" + day));
assert.equal(statistics.lists.indexOf(preferred[0]), statistics.lists.findIndex(list => list.key === "noWeekday0") + 1);
assert.ok(html.includes("周[日一二三四五六](?:可能无法打球|喜欢打球)"));
assert.ok(html.includes("名单按对应星期出勤场次降序"));
for (const list of preferred) {
  const day = Number(list.key.slice(16));
  const members = list.memberIds.map(id => statistics.members.find(member => member.playerId === id));
  assert.ok(members.every(member => member.weekdayEvidence30[day].attendanceDays >= 1));
  assert.ok(members.every((member, i) => !i || members[i - 1].weekdayCounts30[day] >= member.weekdayCounts30[day]));
}
assert.ok(statistics.lists.filter(list => list.key.startsWith("noWeekday")).every(list => {
  const day = Number(list.key.slice(9));
  return list.memberIds.every(id => {
    const row = statistics.members.find(member => member.playerId === id).weekdayEvidence30[day];
    return row.attendanceDays === 0 && row.opportunityDays >= 1 && row.otherAttendanceDays >= 1;
  });
}));
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
assert.ok(statistics.lists.filter((list) => list.key === "onlyLargeSessions" || list.key.startsWith("weeklyMax")).every((list) => list.memberIds.every((id) => statistics.members.find((m) => m.playerId === id).attendance30 >= 2)));
const ranking = statistics.lists.find((list) => list.key === "attendance15");
const cutoff = Math.max(1, statistics.members[9]?.attendance15 || 0);
assert.deepEqual(ranking.memberIds, statistics.members.filter((m) => m.attendance15 >= cutoff).map((m) => m.playerId));
console.log(JSON.stringify({ result: "Cloudflare live verification passed", asOf: statistics.asOf,
  categories: statistics.lists.length, weekdayAvoidedCounts: Object.fromEntries([2,4].map(day => [day, statistics.lists.find(list => list.key === "noWeekday" + day).memberIds.length])), partnerPairs: statistics.bestPartners.pairs.length, rankingWithTies: ranking.memberIds.length, activeMembers: statistics.activeMemberCount, learningVersion: bootstrap.groupLearningSignals.version }));

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
