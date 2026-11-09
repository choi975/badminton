import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const origin = "https://choi975.github.io/badminton/";
const deployment = process.env.GITHUB_SHA || Date.now().toString();
const digest = text => createHash("sha256").update(text.replaceAll("\r\n", "\n").trim()).digest("hex");
let error;
for (let attempt = 0; attempt < 8; attempt++) {
  try {
    for (const file of ["index.html", "roster-review.js", "level-groups.js", "session-save.js", "member-statistics.js", "group-probability.js", "forecast-worker.js"]) {
      const response = await fetch(`${origin}${file === "index.html" ? "" : file}?deploy=${deployment}`, { cache: "no-store", signal: AbortSignal.timeout(30000) });
      assert.equal(response.status, 200, "GitHub Pages " + file);
      assert.equal(digest(await response.text()), digest(readFileSync(new URL("../" + file, import.meta.url), "utf8")), "GitHub Pages must serve the committed " + file);
    }
    console.log("GitHub Pages verified live: committed HTML, unified roster review, normalized level assets, weekday statistics, probability model and read-only backup entry.");
    error = null; break;
  } catch (cause) {
    error = cause;
    if (attempt < 7) await new Promise(resolve => setTimeout(resolve, 15000));
  }
}
if (error) throw error;
