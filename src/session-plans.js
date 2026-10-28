import "../session-planner-core.js";
const core = globalThis.BadmintonSessionPlannerCore;
export const PLAN_PATH = "/api/session-plans";
const origins = new Set(["https://badminton.choi975.workers.dev", "https://choi975.github.io", "http://localhost:8787", "http://127.0.0.1:8787"]);
export function isPlannerWrite(request) {
  return new URL(request.url).pathname === PLAN_PATH && request.method === "POST" && allowed(request);
}
function allowed(request) {
  const origin = request.headers.get("origin");
  if (origin) return origins.has(origin);
  try { return origins.has(new URL(request.headers.get("referer")).origin); } catch { return false; }
}
function decode(row) {
  return row ? { date: row.activity_date, revision: row.revision, day: core.normalizeDay(JSON.parse(row.content_json)), updatedAt: row.updated_at } : null;
}
export async function handleSessionPlans(request, env, { json, rateLimit, now = new Date() }) {
  const today = core.date(now), start = core.addDays(today, -7), end = core.addDays(today, 6);
  if (request.method === "GET") {
    const rows = await env.DB.prepare("SELECT * FROM session_plans WHERE activity_date BETWEEN ? AND ? ORDER BY activity_date").bind(start, end).all();
    return json({ today, days: (rows.results || []).map(decode) });
  }
  if (request.method !== "POST") return json({ error: "不支持的请求方式" }, 405);
  if (!allowed(request)) return json({ error: "只能从羽球助手页面保存计划" }, 403);
  if (!await rateLimit(request, env)) return json({ error: "保存频繁，正在等待重试" }, 429);
  let body;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 60000) return json({ error: "名单过长" }, 413);
    body = JSON.parse(text);
  } catch { return json({ error: "名单格式错误" }, 400); }
  if (!core.validDate(body?.date) || body.date < start || body.date > end || !Number.isSafeInteger(body.revision) || body.revision < 0
    || !/^[a-zA-Z0-9-]{16,80}$/.test(body.mutationId || "") || !body.day || typeof body.day.text !== "string"
    || body.day.text.length > 20000 || !Array.isArray(body.day.slots) || body.day.slots.length !== 10
    || body.day.slots.some((s) => typeof s !== "string" || s.length > 100)) return json({ error: "名单内容或日期无效" }, 400);
  if (JSON.stringify(body.day.plusOverrides || {}).length > 30000) return json({ error: "名单附加信息过长" }, 413);
  const day = core.normalizeDay(body.day), content = JSON.stringify(day);
  const read = () => env.DB.prepare("SELECT * FROM session_plans WHERE activity_date = ?").bind(body.date).first();
  let current = await read();
  // An identical retry after a lost response must not increment the revision again.
  if (current?.mutation_id === body.mutationId && current.content_json === content) return json({ saved: decode(current) });
  const updatedAt = new Date(now).toISOString();
  const saved = body.revision === 0
    ? await env.DB.prepare("INSERT OR IGNORE INTO session_plans (activity_date, revision, content_json, mutation_id, updated_at) VALUES (?, 1, ?, ?, ?) RETURNING *")
        .bind(body.date, content, body.mutationId, updatedAt).first()
    : await env.DB.prepare("UPDATE session_plans SET revision = revision + 1, content_json = ?, mutation_id = ?, updated_at = ? WHERE activity_date = ? AND revision = ? RETURNING *")
        .bind(content, body.mutationId, updatedAt, body.date, body.revision).first();
  if (!saved) return json({ error: "这一天的名单已被其他设备修改，本机草稿仍然保留", current: decode(await read()) }, 409);
  current = saved;
  return json({ saved: decode(current) });
}
