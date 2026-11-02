import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
const origin = "https://badminton.choi975.workers.dev";
async function request(path, options = {}) {
  let error;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await fetch(origin + path, { cache: "no-store", signal: AbortSignal.timeout(30000), ...options }); }
    catch (cause) { error = cause; if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 5000)); }
  }
  throw error;
}
const digest = text => createHash("sha256").update(text.replaceAll("\r\n", "\n").trim()).digest("hex");
for (const [path, file] of [["/", "../index.html"], ["/roster-review.js", "../roster-review.js"], ["/level-groups.js", "../level-groups.js"], ["/session-save.js", "../session-save.js"]]) {
  const response = await request(path);
  assert.equal(response.status, 200, path + " must be served");
  assert.equal(digest(await response.text()), digest(readFileSync(new URL(file, import.meta.url), "utf8")), "Cloudflare must serve the committed " + file);
}
const missingSaveReceipt = await request("/api/session-save-receipts/" + randomUUID(), { headers: { origin } });
assert.equal(missingSaveReceipt.status, 404, "Session save receipt migration and recovery route must be ready");
const get = await request("/api/roster-review");
assert.equal(get.status, 405, "Transactional review route must be deployed");
// Invalid updates exercise the receipt-table read but cannot modify any member or create a receipt.
const invalid = await request("/api/roster-review", { method: "POST", headers: { origin, "content-type": "text/plain" }, body: JSON.stringify({ requestId: randomUUID(), updates: [{}], creates: [] }) });
assert.equal(invalid.status, 400, "Review migration and validation must be ready");
const readOnly = await request("/api/roster-review", { method: "POST", headers: { origin: "https://choi975.github.io", "content-type": "text/plain" }, body: "{}" });
assert.equal(readOnly.status, 403, "GitHub must remain unable to update member profiles");
console.log("Cloudflare roster review verified live: committed HTML/grade assets, transactional API, receipt-table migration, validation and GitHub read-only protection. No member data changed.");
