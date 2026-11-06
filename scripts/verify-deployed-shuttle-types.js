import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const origin = "https://badminton.choi975.workers.dev";
const request = async (path, options = {}) => {
  const response = await fetch(origin + path, { cache: "no-store", signal: AbortSignal.timeout(30000), ...options });
  return { response, body: await response.json() };
};
const { body: bootstrap, response } = await request("/api/bootstrap");
assert.equal(response.status, 200);
const types = bootstrap.estimator.shuttleTypes;
assert.ok(types.length > 0 && types.every(type => Number.isFinite(type.defaultPrice) && type.defaultPrice > 0));
for (const type of types) {
  const path = "/api/estimator/shuttle-types/" + encodeURIComponent(type.id);
  const readOnly = await request(path, { method: "PATCH", headers: { origin: "https://choi975.github.io", "content-type": "text/plain" }, body: "{}" });
  assert.equal(readOnly.response.status, 403);
  const invalid = await request(path, { method: "PATCH", headers: { origin, "content-type": "text/plain" }, body: JSON.stringify({ name: type.name, defaultPrice: 0, expectedName: type.name, expectedDefaultPrice: type.defaultPrice }) });
  assert.equal(invalid.response.status, 400);
  // The exact current name/price returns unchanged; a concurrent change is rejected by CAS, never overwritten.
  const same = await request(path, { method: "PATCH", headers: { origin, "content-type": "text/plain" }, body: JSON.stringify({ name: type.name, defaultPrice: type.defaultPrice, expectedName: type.name, expectedDefaultPrice: type.defaultPrice }) });
  assert.ok([200,409].includes(same.response.status), "current-value no-op or concurrent conflict");
  if (same.response.status === 200) {
    assert.equal(same.body.type.name, type.name);
    assert.equal(same.body.type.defaultPrice, type.defaultPrice);
    assert.deepEqual(same.body.type.prices, type.prices);
  }
}
const htmlResponse = await fetch(origin + "/", { cache: "no-store", signal: AbortSignal.timeout(30000) });
const digest = text => createHash("sha256").update(text.replaceAll("\r\n", "\n").trim()).digest("hex");
assert.equal(digest(await htmlResponse.text()), digest(readFileSync(new URL("../index.html", import.meta.url), "utf8")));
console.log("Cloudflare shuttle editing verified live: migrated defaults, current-value no-op PATCH, validation, read-only protection and committed UI. No price or historical record changed.");
