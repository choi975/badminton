import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../src/worker.js", import.meta.url), "utf8");
const start = source.indexOf("function normalizeIntegrationName");
const end = source.indexOf("function buildSessionPlayerStatements", start);
if (start < 0 || end < 0) throw new Error("Todo counter participant matcher was not found");

const context = vm.createContext({
  AbortController,
  Date,
  setTimeout,
  clearTimeout,
  console: { error() {} },
  TODO_COUNTER_INTEGRATION_URL: "https://todo.choi975.workers.dev/api/integrations/badminton/counter",
  TODO_COUNTER_INTEGRATION_TIMEOUT_MS: 50,
  TODO_COUNTER_INTEGRATION_TOKEN_HEADER: "X-Badminton-Integration-Token",
  fetch() { throw new Error("Worker calls must not use global fetch"); },
});
vm.runInContext(`${source.slice(start, end)}\nthis.sessionContainsExactChoi = sessionContainsExactChoi; this.sync = syncTodoBadmintonCounter; this.requestIntegration = requestTodoCounterIntegration;`, context);

const containsChoi = context.sessionContainsExactChoi;
assert.equal(containsChoi({ players: [{ playerName: "choi", isCompanion: false, slots: 1, plusCount: 0 }] }), true);
assert.equal(containsChoi({ players: [{ playerName: " CHOI ", isCompanion: false, slots: 1, plusCount: 0 }] }), true);
assert.equal(containsChoi({ players: [{ playerName: "choi+1", isCompanion: true, slots: 1, plusCount: 0 }] }), false);
assert.equal(containsChoi({ players: [{ playerName: "choi代1", isCompanion: true, slots: 1, plusCount: 0 }] }), false);
assert.equal(containsChoi({ players: [{ playerName: "choi", isCompanion: false, slots: 1, plusCount: 1 }] }), false);
assert.equal(containsChoi({ players: [{ playerName: "choi朋友", isCompanion: false, slots: 1, plusCount: 0 }] }), false);

const session = { id: 123, date: "2026-09-14", players: [{ playerName: "choi", slots: 1, plusCount: 0, isCompanion: false }] };
const requests = [];
const env = {
  TODO_COUNTER_INTEGRATION_SECRET: "test-secret",
  TODO_WORKER: {
    async fetch(url, options) {
      requests.push({ url, options });
      return Response.json(options.method === "GET" ? { ok: true, counterItemName: "羽毛球" } : { recorded: true });
    },
  },
};
assert.equal((await context.sync(env, session)).status, "recorded");
assert.equal(requests.length, 1);
assert.equal(requests[0].options.headers["X-Badminton-Integration-Token"], "test-secret");
assert.equal(requests[0].options.headers.origin, undefined);
const payload = JSON.parse(requests[0].options.body);
assert.equal(payload.sessionId, 123);
assert.equal(payload.recordedDate, "2026-09-14");
assert.equal((await context.requestIntegration(env, "GET")).ok, true);
assert.equal(requests[1].options.body, undefined);

assert.equal((await context.sync(env, { ...session, players: [{ playerName: "choi代1", slots: 1, isCompanion: true }] })).status, "skipped");
assert.equal(requests.length, 2);
assert.equal((await context.sync({ TODO_COUNTER_INTEGRATION_SECRET: "test-secret" }, session)).status, "unconfigured");
assert.equal((await context.sync({ TODO_WORKER: env.TODO_WORKER }, session)).status, "unconfigured");

for (const [response, status] of [
  [Response.json({ recorded: false, alreadyRecorded: true }), "already_recorded"],
  [Response.json({ error: "unauthorized" }, { status: 401 }), "failed"],
  [Response.json({ error: "counter_item_not_found" }, { status: 409 }), "failed"],
  [Response.json({}), "failed"],
  [new Response("not JSON"), "failed"],
]) {
  assert.equal((await context.sync({ ...env, TODO_WORKER: { fetch: async () => response } }, session)).status, status);
}
const timeoutEnv = { ...env, TODO_WORKER: { fetch: (_url, options) => new Promise((_resolve, reject) => {
  options.signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true });
}) } };
assert.equal((await context.sync(timeoutEnv, session)).status, "failed");

const config = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
assert.match(config, /\[\[services\]\]\s+binding = "TODO_WORKER"\s+service = "todo"/);

console.log("verify: todo sync participant rules, service binding, authentication, health, duplicate responses and failures passed");
