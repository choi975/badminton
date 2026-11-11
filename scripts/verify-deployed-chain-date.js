import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const origin = "https://badminton.choi975.workers.dev";
const digest = text => createHash("sha256").update(text.replaceAll("\r\n", "\n").trim()).digest("hex");
async function get(path, status = 200) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(origin + path, { cache: "no-store", signal: AbortSignal.timeout(30000) });
      assert.equal(response.status, status, "Live activity-date endpoint: " + path);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  throw lastError;
}
const assets = ["index.html", "session-planner-core.js", "chain-activity-date.js", "session-planner.js"];
const texts = await Promise.all(assets.map(file => get(file === "index.html" ? "/" : "/" + file)));
assets.forEach((file, index) => assert.equal(digest(texts[index]), digest(readFileSync(new URL("../" + file, import.meta.url), "utf8")), "Cloudflare serves committed " + file));
const context = vm.createContext({});
vm.runInContext(texts[1] + "\n" + texts[2], context);
assert.equal(context.BadmintonChainActivityDate.parse("活动时间：11-09 (周一) 19:00 ~ 22:00", { today: "2026-11-11" }).date, "2026-11-09");
assert.match(texts[0], /id="chainActivityDateInput" type="date"/);
assert.match(texts[0], /id="chainActivityDateBar" class="chain-date-bar" hidden/);
assert.ok(texts[0].includes("els.chainActivityDateBar.hidden = date === getBeijingDateString();"), "Today’s activity date is hidden using Beijing time");
assert.match(texts[3], /async function selectDate/);
const historical = JSON.parse(await get("/api/session-plans?date=2026-09-09"));
assert.ok(Array.isArray(historical.days), "Historical date lookup must be available");
await get("/api/session-plans?date=2026-02-30", 400);
console.log("Cloudflare activity dates verified live: committed assets, November 9 recognition, manual date field, dated draft controller and historical/invalid date reads. No live writes performed.");