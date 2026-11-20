import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const origin = process.env.BADMINTON_DEPLOY_ORIGIN || "https://badminton.choi975.workers.dev/";
const deployment = process.env.GITHUB_SHA || String(Date.now());
const digest = (text) => createHash("sha256").update(text.replaceAll("\r\n", "\n").trim()).digest("hex");
let deployedCore;
for (const file of ["court-arrangement-core.js", "court-arrangement.js", "court-arrangement.css"]) {
  const url = new URL(file, origin.endsWith("/") ? origin : origin + "/"); url.searchParams.set("verify", deployment);
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200, "Live " + file);
  const text = await response.text();
  assert.equal(digest(text), digest(readFileSync(new URL("../" + file, import.meta.url), "utf8")), "Live asset must match committed " + file);
  if (file.endsWith(".css")) assert.match(response.headers.get("content-type"), /text\/css/);
  else assert.match(response.headers.get("content-type"), /(?:java|ecma)script/);
  if (file === "court-arrangement-core.js") deployedCore = text;
  if (file === "court-arrangement.js") {
    assert.doesNotMatch(text, /ca-court-grip/);
    assert.match(text, /title\.append\(input, el\("span", "ca-court-label", "号场"\), level, remove\)/);
    assert.match(text, /COURT_HOLD_MS = 350/);
  }
}
const context = vm.createContext({}); vm.runInContext(deployedCore, context, { timeout: 1000 });
assert.deepEqual([7, 20, 23].map((n) => context.BadmintonCourtArrangementCore.defaultCourtCount(n)), [1, 3, 4]);
const core = context.BadmintonCourtArrangementCore;
const sample = Array.from({ length: 12 }, (_, i) => ({ key: "p-" + (i + 1), playerId: i + 1, name: "校验" + i, level: i < 6 ? 1 : 4 }));
const fixed = { preferences: Object.fromEntries(sample.map((p) => [p.playerId, { mode: "fixed", coach: "none", targets: [] }])), groups: [] };
const samplePlan = core.recommend(sample, fixed, { courts: core.makeCourts(2).map((c, i) => ({ ...c, label: i ? "2" : "8" })) });
const ordered = core.numberedCourts(core.courtInfo(samplePlan, fixed));
assert.equal(ordered[0].label, "2"); assert.equal(ordered[0].min, 4); assert.equal(ordered[1].min, 1);
const roamPlan = core.recommend(sample, { preferences: { 1: { mode: "roam", coach: "none", targets: [] }, 2: { mode: "roam", coach: "none", targets: [] } }, groups: [] });
const key = core.bundles(roamPlan)[0].key; roamPlan.bundlePositions = { [key]: { x: 320, y: 480 } };
assert.equal(core.validatePlan(roamPlan).bundlePositions[key].y, 480);

const independent = core.recommend(sample, { preferences: Object.fromEntries(sample.slice(0, 4).map((p) => [p.playerId, { mode: "roam", coach: "none", targets: [] }])), groups: [] }, { courts: core.makeCourts(2) });
for (let i = 0; i < 4; i++) independent.assignments[sample[i].key].roamingGroupId = i < 2 ? "flow-ab" : "flow-cd";
independent.bundlePositions = { "flow-ab": { x: 32, y: 320 }, "flow-cd": { x: 400, y: 400 } };
independent.lineMode = "selected";
const checked = core.validatePlan(independent);
assert.equal(core.bundles(checked).length, 2, "Equal-destination groups remain independent in the live core");
assert.equal(checked.lineMode, "bundled");
assert.equal(core.reconcile(checked, sample, {}).bundlePositions["flow-cd"].x, 400);

const page = await fetch(new URL("?verify=" + deployment, origin), { cache: "no-store", signal: AbortSignal.timeout(30000) });
assert.equal(page.status, 200); const html = await page.text();
assert.match(html, /id="courtArrangementBtn"[^>]*aria-label="场地安排"/);
assert.match(html, /id="courtArrangementModal"/); assert.match(html, /id="shakeCourtGroupsBtn"/);
assert.doesNotMatch(html, /id="(?:caMeta|caBoardTab|caSettingsTab|caFit|caLineMode)"|<option value="vertical">/);
assert.match(html, /id="caZoom"/);
assert.match(html, /id="caSettingsToggle"[^>]*aria-label="偏好与小团体"/);
assert.match(html, /id="caClose"[^>]*aria-label="关闭场地安排"/);
if (!new URL(origin).hostname.endsWith("github.io")) {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const api = new URL("api/court-arrangements", origin); api.searchParams.set("date", date);
  const response = await fetch(api, { cache: "no-store", signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200, "Migrated court arrangement endpoint");
  const data = await response.json(); assert.equal(data.date, date);
  for (const key of ["settings", "activity"]) assert.ok(data[key] === null || Number.isSafeInteger(data[key].revision) && data[key].revision > 0);
}
console.log("Live court arrangements verified: matching HTML/core/UI/CSS, 7/20/23 defaults, both entry points and migrated date-scoped API. Read-only checks; no production data changed.");
