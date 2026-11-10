import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const origin = "https://badminton.choi975.workers.dev";
async function get(path) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(origin + path, { cache: "no-store", signal: AbortSignal.timeout(30000) });
      assert.equal(response.status, 200, "Live calendar asset must be available: " + path);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  throw lastError;
}
const [html, source] = await Promise.all([get("/"), get("/calendar-statistics.js")]);
const digest = text => createHash("sha256").update(text.replaceAll("\r\n", "\n").trim()).digest("hex");
assert.equal(digest(html), digest(readFileSync(new URL("../index.html", import.meta.url), "utf8")), "Cloudflare serves the current calendar HTML");
assert.equal(digest(source), digest(readFileSync(new URL("../calendar-statistics.js", import.meta.url), "utf8")), "Cloudflare serves the current date-selection core");
assert.match(html, /<button id="calendarMonthLabel"[^>]*aria-haspopup="dialog"/);
assert.equal((html.match(/<button type="button" data-weekday="[0-6]"/g) || []).length, 7);
assert.match(html, /id="calendarDetailPrevBtn"/);
assert.match(html, /id="calendarDetailNextBtn"/);
assert.match(html, /id="calendarDetailPeriodLabel"/);
assert.doesNotMatch(html, /查看订场记录与成员出勤|上下滚动连续查看日期|上下滑动连续查看 · 点按日期/);
const context = vm.createContext({});
vm.runInContext(source, context);
const core = context.BadmintonCalendarStatistics;
const json = value => JSON.parse(JSON.stringify(value));
assert.deepEqual(json(core.recentWeekdayDates(1, "2026-11-10")), ["2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09"]);
assert.deepEqual(json(core.recentWeekdayDates(2, "2026-11-10")), ["2026-10-06", "2026-10-13", "2026-10-20", "2026-10-27", "2026-11-03"]);
const selected = core.selectionScope(["2026-10-21", "2026-10-28", "2026-11-04"], 2026, 11);
assert.deepEqual(json(core.navigate(selected, 1).dates), ["2026-10-22", "2026-10-29", "2026-11-05"]);
assert.deepEqual(json(core.comparisonScope(selected).dates), ["2026-09-30", "2026-10-07", "2026-10-14"]);
console.log("Cloudflare calendar verified live: month/weekday shortcuts, latest five before today, manual-week navigation, same-weekday comparisons, and current HTML/core assets.");
