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
assert.doesNotMatch(html, /长期规则|短期规则|成员统计名单|每周固定安排/);
const digest = (text) => createHash("sha256").update(text.replaceAll("\r\n", "\n").trim()).digest("hex");
assert.equal(digest(statisticsSource), digest(readFileSync(new URL("../member-statistics.js", import.meta.url), "utf8")), "Cloudflare must serve the current shared statistics module");
assert.equal(digest(probabilitySource), digest(readFileSync(new URL("../group-probability.js", import.meta.url), "utf8")), "Cloudflare must serve the current probability module");
const statistics = JSON.parse(statisticsText).memberStatistics;
const bootstrap = JSON.parse(bootstrapText);
assert.equal(statistics.version, globalThis.BadmintonMemberStatistics.VERSION);
assert.equal(statistics.lists.length, 13);
assert.equal(bootstrap.groupLearningSignals.version, "group-learning-v2");
const expected = globalThis.BadmintonMemberStatistics.build({
  players: bootstrap.players, sessions: bootstrap.sessions,
  now: bootstrap.memberStatistics.generatedAt, asOf: bootstrap.memberStatistics.asOf, calendar: bootstrap.memberStatistics.calendar,
});
assert.deepEqual(bootstrap.memberStatistics.lists, expected.lists, "Worker and browser statistics must agree for live records");
console.log(JSON.stringify({ result: "Cloudflare live verification passed", asOf: statistics.asOf,
  categories: statistics.lists.length, activeMembers: statistics.activeMemberCount, learningVersion: bootstrap.groupLearningSignals.version }));
