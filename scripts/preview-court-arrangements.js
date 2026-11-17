import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve, extname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { handleCourtArrangements } from "../src/court-arrangements.js";
import { handleSessionPlans } from "../src/session-plans.js";
const snapshot = JSON.parse(readFileSync(resolve("data/bootstrap-snapshot.json"), "utf8")).data;
const sql = new DatabaseSync(":memory:");
for (const file of ["0026_session_plans.sql", "0031_court_arrangements.sql"]) sql.exec(readFileSync(resolve("migrations", file), "utf8"));
const DB = { prepare(text) { return { args: [], bind(...args) { this.args = args; return this; }, async first() { return sql.prepare(text).get(...this.args) || null; }, async all() { return { results: sql.prepare(text).all(...this.args) }; } }; } };
const json = (value, status = 200) => Response.json(value, { status, headers: { "access-control-allow-origin": "*" } });
const helpers = { json, rateLimit: async () => true, listPlayers: async () => snapshot.players };
let failure = null;
const server = createServer(async (input, output) => {
  try {
    const url = new URL(input.url, "http://127.0.0.1:8787");
    const chunks = []; for await (const chunk of input) chunks.push(chunk);
    const request = new Request(url, { method: input.method, headers: input.headers, ...(input.method !== "GET" && input.method !== "HEAD" ? { body: Buffer.concat(chunks).toString() } : {}) });
    let response;
    if (url.pathname === "/__test/failure" && request.method === "POST") { failure = await request.json(); response = json({ ok: true }); }
    else if (url.pathname === "/api/court-arrangements") {
      if (failure?.read && request.method === "GET") { failure.read--; response = json({ error: "Injected read failure" }, 503); }
      else if (failure?.save && request.method === "POST") { failure.save--; response = json({ error: "Injected save failure" }, 503); }
      else if (failure?.lost && request.method === "POST") { failure.lost--; await handleCourtArrangements(request, { DB }, helpers); response = json({ error: "Injected lost response after commit" }, 503); }
      else { if (failure?.delayRead && request.method === "GET") await new Promise(resolve => setTimeout(resolve, failure.delayRead)); response = await handleCourtArrangements(request, { DB }, helpers); }
    } else if (url.pathname === "/api/session-plans") response = await handleSessionPlans(request, { DB }, helpers);
    else if (url.pathname === "/api/bootstrap") response = json(snapshot);
    else if (url.pathname === "/api/member-statistics") response = json({ memberStatistics: snapshot.memberStatistics, bestPartnerOverrides: snapshot.bestPartnerOverrides });
    else if (url.pathname === "/api/shake-state") response = json({ confirmed: { revision: snapshot.shakeRevision || 0, rules: snapshot.shortTermRules, bestPartnerOverrides: snapshot.bestPartnerOverrides } });
    else if (url.pathname.startsWith("/api/")) response = json({ attempt: null, outcomes: [], ok: true });
    else {
      const filename = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
      if (!/^[\w.-]+$/.test(filename)) { response = new Response("Not found", { status: 404 }); }
      else { const path = filename === "bootstrap-snapshot.json" ? resolve("data", filename) : existsSync(resolve(filename)) ? resolve(filename) : resolve("public", filename);
        const type = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" }[extname(filename)] || "application/octet-stream";
        response = existsSync(path) ? new Response(filename === "index.html" ? readFileSync(path, "utf8").replaceAll("https://badminton.choi975.workers.dev", "http://127.0.0.1:8787") : readFileSync(path), { headers: { "content-type": type + "; charset=utf-8", "cache-control": "no-store" } }) : new Response("Not found", { status: 404 }); }
    }
    output.writeHead(response.status, { ...Object.fromEntries(response.headers), "x-court-preview": "isolated-sqlite" }); output.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) { console.error(error); output.writeHead(500, { "content-type": "application/json" }); output.end(JSON.stringify({ error: error.message })); }
});
server.listen(8787, "127.0.0.1", () => console.log("Court arrangement preview: http://127.0.0.1:8787 (isolated in-memory SQLite; no production writes)"));
