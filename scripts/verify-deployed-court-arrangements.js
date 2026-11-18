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
}
const context = vm.createContext({}); vm.runInContext(deployedCore, context, { timeout: 1000 });
assert.deepEqual([7, 20, 23].map((n) => context.BadmintonCourtArrangementCore.defaultCourtCount(n)), [1, 3, 4]);
const page = await fetch(new URL("?verify=" + deployment, origin), { cache: "no-store", signal: AbortSignal.timeout(30000) });
assert.equal(page.status, 200); const html = await page.text();
assert.match(html, /id="courtArrangementBtn"[^>]*aria-label="场地安排"/);
assert.match(html, /id="courtArrangementModal"/); assert.match(html, /id="shakeCourtGroupsBtn"/);
assert.doesNotMatch(html, /id="(?:caMeta|caBoardTab|caSettingsTab)"/);
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
