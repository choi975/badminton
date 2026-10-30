import "../member-statistics.js";
const core = globalThis.BadmintonMemberStatistics;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const guarded = "EXISTS (SELECT 1 FROM shake_mutation_receipts WHERE id = ? AND attempt_token = ?)";
const revisionSql = "UPDATE app_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'shake_revision'";
function mappedRule(row) {
  return { id: Number(row.id), playerId: Number(row.player_id), type: row.rule_type, rule: JSON.parse(row.rule_json || "{}"),
    startsOn: row.starts_on, expiresOn: row.expires_on, rawText: row.raw_text, createdAt: row.created_at, updatedAt: row.updated_at };
}
export async function readShakeState(db) {
  // One read-only batch prevents interleaving different database revisions in a single response.
  const rows = await db.batch([
    db.prepare("SELECT value FROM app_settings WHERE key = 'shake_revision'"),
    db.prepare("SELECT * FROM short_term_rules WHERE rule_type != 'only_days' ORDER BY id ASC"),
    db.prepare("SELECT value FROM app_settings WHERE key = 'best_partner_overrides'"),
  ]);
  return { revision: Number(rows[0].results?.[0]?.value) || 0,
    rules: (rows[1].results || []).map(mappedRule), bestPartnerOverrides: core.normalizePartnerOverrides(rows[2].results?.[0]?.value) };
}
export async function handleShakeMutation(request, env, helpers) {
  const { json, normalizeShortTermRuleInput, findEarlyReturnSession, listPlayers, listSessions, readMemberStatisticsCalendar, readBestPartnerSettings } = helpers;
  const db = env.DB;
  let body;
  try { const text = await request.text(); if (text.length > 10000) return json({ error: "操作请求过大" }, 413); body = JSON.parse(text); }
  catch { return json({ error: "操作格式错误" }, 400); }
  if (!UUID.test(body?.id || "") || !["rule-create", "rule-delete", "partner"].includes(body?.kind)) return json({ error: "操作标识或类型无效" }, 400);
  const { id, kind } = body, payload = body.payload || {};
  const requestJson = JSON.stringify({ kind, payload });
  const receipt = () => db.prepare("SELECT * FROM shake_mutation_receipts WHERE id = ?").bind(id).first();
  const resultFor = async (row, replayed) => row.request_json !== requestJson
    ? json({ error: "操作标识已被另一项操作使用", code: "id_reused" }, 409)
    : json({ ok: true, operationId: id, replayed, result: JSON.parse(row.result_json || "{}"), confirmed: await readShakeState(db) });
  const existing = await receipt();
  if (existing) return resultFor(existing, true);
  const token = crypto.randomUUID(), now = new Date();
  const statements = [];
  if (kind === "partner") {
    if (!Number.isSafeInteger(payload.revision) || payload.revision < 0) return json({ error: "拍档版本无效" }, 400);
    const [settings, players, sessions, calendar] = await Promise.all([
      readBestPartnerSettings(db), listPlayers(db), listSessions(db), readMemberStatisticsCalendar(db),
    ]);
    if (payload.revision !== settings.overrides.revision) return json({ error: "拍档名单已在其他设备变化，请重试本次操作", code: "partner_conflict", confirmed: await readShakeState(db) }, 409);
    const statistics = core.build({ players, sessions, calendar, now, bestPartnerOverrides: settings.overrides });
    let overrides;
    try { overrides = core.editPartnerOverrides({ overrides: settings.overrides, pairs: statistics.bestPartners.pairs, players, ...payload, now }); }
    catch (error) { return json({ error: error.message, confirmed: await readShakeState(db) }, 422); }
    statements.push(db.prepare("INSERT INTO app_settings (key, value) VALUES ('best_partner_overrides', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE app_settings.value = ?")
      .bind(JSON.stringify(overrides), settings.raw));
    // Receipt insertion is conditional on successful CAS; duplicate ID failure rolls back the CAS too.
    statements.push(db.prepare("INSERT INTO shake_mutation_receipts (id, request_json, attempt_token, result_json) SELECT ?, ?, ?, ? WHERE changes() = 1")
      .bind(id, requestJson, token, JSON.stringify({ kind, revision: overrides.revision })));
    statements.push(db.prepare(revisionSql + " AND " + guarded).bind(id, token));
  } else {
    let input, targetId = 0;
    if (kind === "rule-create") {
      input = normalizeShortTermRuleInput(payload);
      if (!input) return json({ error: "规则格式无效" }, 400);
      if (!await db.prepare("SELECT id FROM players WHERE id = ?").bind(input.playerId).first()) return json({ error: "该成员已不存在" }, 422);
      if (input.expiresOn) {
        if (input.expiresOn < core.beijingDate(now)) return json({ error: "这条日期规则已过期，未再次保存" }, 422);
        const early = await findEarlyReturnSession(db, input);
        if (early) return json({ error: "该成员已在" + early.date + "的订场记录中，这条规则未保存" }, 422);
      }
    } else {
      targetId = Number(payload.ruleId);
      if (payload.createOperationId && UUID.test(payload.createOperationId)) {
        const parent = await db.prepare("SELECT result_json FROM shake_mutation_receipts WHERE id = ?").bind(payload.createOperationId).first();
        targetId = Number(parent ? JSON.parse(parent.result_json).ruleId : 0);
      } else if (!Number.isSafeInteger(targetId) || targetId <= 0) return json({ error: "规则编号无效" }, 400);
    }
    statements.push(db.prepare("INSERT OR IGNORE INTO shake_mutation_receipts (id, request_json, attempt_token) VALUES (?, ?, ?)").bind(id, requestJson, token));
    if (input) {
      const serializedRule = JSON.stringify(input.rule);
      if (input.expiresOn) statements.push(db.prepare("DELETE FROM short_term_rules WHERE player_id = ? AND expires_on IS NOT NULL AND " + guarded).bind(input.playerId, id, token));
      statements.push(db.prepare(
        "INSERT INTO short_term_rules (player_id, rule_type, rule_json, starts_on, expires_on, raw_text) SELECT ?, ?, ?, ?, ?, ? WHERE " + guarded
        + " AND NOT EXISTS (SELECT 1 FROM short_term_rules WHERE player_id = ? AND rule_type = ? AND rule_json = ? AND expires_on IS ?)"
      ).bind(input.playerId, input.type, serializedRule, input.startsOn, input.expiresOn, input.rawText, id, token, input.playerId, input.type, serializedRule, input.expiresOn));
      statements.push(db.prepare("UPDATE shake_mutation_receipts SET result_json = json_object('kind', ?, 'ruleId', (SELECT id FROM short_term_rules WHERE player_id = ? AND rule_type = ? AND rule_json = ? AND expires_on IS ? ORDER BY id DESC LIMIT 1)) WHERE id = ? AND attempt_token = ?")
        .bind(kind, input.playerId, input.type, serializedRule, input.expiresOn, id, token));
    } else {
      if (targetId) statements.push(db.prepare("DELETE FROM short_term_rules WHERE id = ? AND " + guarded).bind(targetId, id, token));
      statements.push(db.prepare("UPDATE shake_mutation_receipts SET result_json = ? WHERE id = ? AND attempt_token = ?").bind(JSON.stringify({ kind, ruleId: targetId }), id, token));
    }
    statements.push(db.prepare(revisionSql + " AND " + guarded).bind(id, token));
  }
  try { await db.batch(statements); }
  catch (error) {
    const saved = await receipt();
    if (saved) return resultFor(saved, true);
    throw error; // Failed transaction => no receipt; same operation ID can be retried safely.
  }
  const saved = await receipt();
  if (!saved) return json({ error: "拍档名单已在其他设备变化，请重试本次操作", code: "partner_conflict", confirmed: await readShakeState(db) }, 409);
  return resultFor(saved, saved.attempt_token !== token);
}
