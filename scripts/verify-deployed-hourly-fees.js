import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const origin = process.env.BADMINTON_DEPLOY_ORIGIN || "https://badminton.choi975.workers.dev/";
const url = new URL("court-pricing.js", origin.endsWith("/") ? origin : origin + "/");
url.searchParams.set("verify", process.env.GITHUB_SHA || String(Date.now()));
const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(30000) });
assert.equal(response.status, 200, "Live court-pricing asset");
const source = await response.text();
const digest = text => createHash("sha256").update(text.replaceAll("\r\n", "\n").trim()).digest("hex");
assert.equal(digest(source), digest(readFileSync(new URL("../court-pricing.js", import.meta.url), "utf8")), "The live asset must exactly match the committed hourly-pricing module");
const context = vm.createContext({});
vm.runInContext(source, context, { timeout: 1000 });
const pricing = context.BadmintonCourtPricing;
for (const [hours, fee] of [[0.5, 12], [1.5, 35], [5, 117], [5.5, 129], [6.5, 152]]) {
  assert.equal(pricing.feeForHours(hours), fee);
  assert.equal(pricing.rowFee({ price: 70, count: pricing.fromHours(hours) }), fee);
}
for (const price of [0, 80, 100]) {
  assert.equal(pricing.rowFee({ price, count: 1.5 }), price * 1.5);
  assert.equal(pricing.totalHours([{ price, count: 1.5 }]), 4.5);
}
assert.equal(pricing.sumCounts([{ count: 0.333 }, { count: 0.666 }]), 1);
console.log("Live hourly-fee asset passed: committed module, half-hour rounding, legacy 0/80/100 prices and exact three-hour equivalents. Read-only checks; no bill changed.");
