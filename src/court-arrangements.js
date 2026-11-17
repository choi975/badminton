import "../court-arrangement-core.js";
const core = globalThis.BadmintonCourtArrangementCore;
export const COURT_PATH = "/api/court-arrangements";
const origins = new Set(["https://badminton.choi975.workers.dev", "https://choi975.github.io", "http://localhost:8787", "http://127.0.0.1:8787"]);
function allowed(request) {
  const origin = request.headers.get("origin");
  if (origin) return origins.has(origin);
  try { return origins.has(new URL(request.headers.get("referer")).origin); } catch { return false; }
}
export function isCourtArrangementWrite(request) {
  return new URL(request.url).pathname === COURT_PATH && request.method === "POST" && allowed(request);
}
function decode(row) {
  return row ? { revision: row.revision, content: JSON.parse(row.content_json), mutationId: row.mutation_id, updatedAt: row.updated_at } : null;
}
export async function handleCourtArrangements(request, env, { json, rateLimit, listPlayers, now = new Date() }) {
  const read = (key) => env.DB.prepare("SELECT * FROM court_arrangement_documents WHERE document_key = ?").bind(key).first();
  if (request.method === "GET") {
    const date = new URL(request.url).searchParams.get("date");
    if (!core.validDate(date)) return json({ error: "请指定有效的活动日期" }, 400);
    const [settings, activity] = await Promise.all([read("preferences"), read("activity:" + date)]);
    return json({ date, settings: decode(settings), activity: decode(activity) });
  }
  if (request.method !== "POST") return json({ error: "不支持的请求方式" }, 405);
  if (!allowed(request)) return json({ error: "只能从羽球助手页面保存场地安排" }, 403);
  if (!await rateLimit(request, env)) return json({ error: "保存频繁，请稍后重试" }, 429);
  let body;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 180000) return json({ error: "安排内容过长" }, 413);
    body = JSON.parse(text);
  } catch { return json({ error: "安排格式错误" }, 400); }
  if (!["settings", "activity"].includes(body?.kind) || !Number.isSafeInteger(body.revision) || body.revision < 0
    || !/^[\w-]{16,80}$/.test(body.mutationId || "") || (body.kind === "activity" && !core.validDate(body.date))) return json({ error: "保存类型、日期或版本无效" }, 400);
  let content;
  try {
    content = body.kind === "settings" ? core.validateSettings(body.content, new Set((await listPlayers(env.DB)).map((p) => Number(p.id)))) : core.validatePlan(body.content);
  } catch (error) { return json({ error: error.message }, 422); }
  const key = body.kind === "settings" ? "preferences" : "activity:" + body.date, serialized = JSON.stringify(content);
  const current = await read(key);
  if (current?.mutation_id === body.mutationId && current.content_json === serialized) return json({ saved: decode(current), kind: body.kind, date: body.date });
  // A reused mutation ID with a different payload is not a new edit.
  if (current?.mutation_id === body.mutationId) return json({ error: "重试编号对应的内容已变化，请重新提交", current: decode(current) }, 409);
  const saved = body.revision === 0
    ? await env.DB.prepare("INSERT OR IGNORE INTO court_arrangement_documents (document_key, revision, content_json, mutation_id, updated_at) VALUES (?, 1, ?, ?, ?) RETURNING *")
        .bind(key, serialized, body.mutationId, new Date(now).toISOString()).first()
    : await env.DB.prepare("UPDATE court_arrangement_documents SET revision = revision + 1, content_json = ?, mutation_id = ?, updated_at = ? WHERE document_key = ? AND revision = ? RETURNING *")
        .bind(serialized, body.mutationId, new Date(now).toISOString(), key, body.revision).first();
  if (!saved) return json({ error: "安排已在其他设备修改，本机草稿已保留，请选择如何处理", current: decode(await read(key)) }, 409);
  return json({ saved: decode(saved), kind: body.kind, date: body.date });
}
