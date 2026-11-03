import "../roster-review.js";

const Review = globalThis.BadmintonRosterReview;
const MAX_ITEMS = 200;
const MAX_NAME_LENGTH = 200;

export async function handleRosterReview(request, env, { json, listPlayers, getPaymentOrderState, isAdminRequest }) {
  if (request.method !== "POST") return json({ error: "不支持此操作" }, 405);
  if (!isAdminRequest(request)) return json({ error: "请在 Cloudflare 管理版保存人员核对结果" }, 403);
  const raw = await request.text();
  if (raw.length > 150_000) return json({ error: "核对内容过长，请减少名单人数" }, 400);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: "核对内容格式无效" }, 400); }
  if (!body || !/^[0-9a-f-]{36}$/i.test(body.requestId || "") || !Array.isArray(body.updates) || !Array.isArray(body.creates)
    || body.updates.length > MAX_ITEMS || body.creates.length > MAX_ITEMS) return json({ error: "核对内容格式无效" }, 400);

  const payloadHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw))), byte => byte.toString(16).padStart(2, "0")).join("");
  const readReceipt = () => env.DB.prepare("SELECT * FROM roster_review_commits WHERE request_id = ?").bind(body.requestId).first();
  const finish = async receipt => {
    const [players, paymentState] = await Promise.all([listPlayers(env.DB), getPaymentOrderState(env.DB)]);
    return json({ ok: true, players, createdPlayers: JSON.parse(receipt.created_players_json), ...paymentState });
  };
  const receipt = await readReceipt();
  if (receipt) return receipt.payload_hash === payloadHash ? finish(receipt) : json({ error: "核对请求已变更，请重新确认" }, 409);

  const players = await listPlayers(env.DB);
  const byId = new Map(players.map(player => [Number(player.id), player]));
  const names = new Map();
  players.forEach(player => Review.splitAliases(player.name).forEach(alias => {
    const key = Review.normalizeName(alias);
    const ids = names.get(key) || new Set();
    ids.add(Number(player.id));
    names.set(key, ids);
  }));
  const seenUpdates = new Set(), seenCreates = new Set();
  const updates = [], creates = [];
  function claimNames(value, owner) {
    const aliases = Review.splitAliases(value);
    if (!aliases.length || value.length > MAX_NAME_LENGTH || /[\r\n\t]/.test(value)) return "名字或外号需填写 1～200 个字符，且不能换行";
    for (const alias of aliases) {
      const key = Review.normalizeName(alias), owners = names.get(key);
      if (owners && [...owners].some(id => id !== owner)) return `“${alias}”已属于其他成员，请重新选择成员或修改名字`;
      names.set(key, new Set([owner]));
    }
    return null;
  }
  for (const update of body.updates) {
    const id = Number(update?.playerId), player = byId.get(id);
    if (!player || !Number.isSafeInteger(id) || seenUpdates.has(id)) return json({ error: "成员不存在或核对结果重复，请重新核对" }, 400);
    if (!Review.sameProfile(update.expected, player)) return json({ error: `“${Review.splitAliases(player.name)[0]}”的档案已变化，请核对最新资料后重试`, conflict: true }, 409);
    seenUpdates.add(id);
    if (update.level !== undefined && !Review.levels.includes(update.level)) return json({ error: "请选择 0.5～9 级之间的标准等级" }, 400);
    if (update.aliases !== undefined && (!Array.isArray(update.aliases) || update.aliases.length > MAX_ITEMS)) return json({ error: "外号格式无效" }, 400);
    const aliases = Review.splitAliases(player.name);
    for (const value of update.aliases || []) {
      if (typeof value !== "string") return json({ error: "外号格式无效" }, 400);
      const error = claimNames(value.trim(), id);
      if (error) return json({ error }, 400);
      for (const alias of Review.splitAliases(value)) if (!aliases.some(existing => Review.normalizeName(existing) === Review.normalizeName(alias))) aliases.push(alias);
    }
    const name = update.aliases?.length ? aliases.join("，") : player.name;
    if (name.length > 2000) return json({ error: "该成员的外号过多，请先整理成员档案" }, 400);
    updates.push({ id, name, level: update.level ?? player.level });
  }
  for (const create of body.creates) {
    if (!create || typeof create.key !== "string" || !create.key || create.key.length > 1000 || seenCreates.has(create.key)
      || typeof create.name !== "string" || !["男", "女"].includes(create.gender)
      || !["球友", "特殊"].includes(create.affiliation) || !Review.levels.includes(create.level)) return json({ error: "请填写新成员的名字、性别、标准等级和分组" }, 400);
    if (create.notes !== undefined && typeof create.notes !== "string") return json({ error: "新成员备注需填写文字" }, 400);
    seenCreates.add(create.key);
    const owner = "new:" + create.key;
    const aliases = Review.splitAliases(create.name);
    const error = claimNames(create.name.trim(), owner);
    if (error) return json({ error }, 400);
    if (create.aliases !== undefined && (!Array.isArray(create.aliases) || create.aliases.length > MAX_ITEMS)) return json({ error: "新成员外号格式无效" }, 400);
    for (const alias of create.aliases || []) {
      if (typeof alias !== "string") return json({ error: "新成员外号格式无效" }, 400);
      const error = claimNames(alias.trim(), owner);
      if (error) return json({ error }, 400);
      for (const name of Review.splitAliases(alias)) if (!aliases.some(existing => Review.normalizeName(existing) === Review.normalizeName(name))) aliases.push(name);
    }
    const name = aliases.join("，");
    if (name.length > 2000) return json({ error: "新成员名字或外号过长" }, 400);
    creates.push({ ...create, name, notes: (create.notes || "").trim() });
  }

  const snapshot = JSON.stringify(players.map(player => [Number(player.id), player.name, player.level, player.updatedAt]));
  const statements = [env.DB.prepare("INSERT INTO roster_review_commits (request_id, payload_hash) VALUES (?, ?)").bind(body.requestId, payloadHash),
    // This CHECK guard runs inside the same transaction as every update and insert.
    // It also catches concurrent alias registration, rather than only stale levels.
    env.DB.prepare(`UPDATE roster_review_commits SET validation_ok = CASE WHEN
      (SELECT json_group_array(json_array(id, name, level, updated_at)) FROM (SELECT id, name, level, updated_at FROM players ORDER BY id)) = ?
      THEN 1 ELSE 0 END WHERE request_id = ?`).bind(snapshot, body.requestId)];
  updates.forEach(update => statements.push(env.DB.prepare("UPDATE players SET name = ?, level = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(update.name, update.level, update.id)));
  creates.forEach(create => {
    statements.push(env.DB.prepare("INSERT INTO players (name, gender, level, affiliation, notes, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)")
      .bind(create.name, create.gender, create.level, create.affiliation, create.notes));
    // UPDATE does not change last_insert_rowid(): capture the member id before inserting its join number.
    statements.push(env.DB.prepare(`UPDATE roster_review_commits SET created_players_json = json_insert(created_players_json, '$[#]',
      json_object('key', ?, 'playerId', last_insert_rowid())) WHERE request_id = ?`).bind(create.key, body.requestId));
    if (create.affiliation === "球友") statements.push(env.DB.prepare(`INSERT INTO group_join_numbers (affiliation, player_id, join_number, updated_at)
      VALUES ('球友', last_insert_rowid(), (SELECT COALESCE(MAX(join_number), 0) + 1 FROM group_join_numbers WHERE affiliation = '球友'), CURRENT_TIMESTAMP)`));
  });
  try {
    await env.DB.batch(statements);
  } catch (error) {
    const committed = await readReceipt();
    if (committed?.payload_hash === payloadHash) return finish(committed);
    if (committed || /validation_ok|CHECK constraint/i.test(String(error?.message))) return json({ error: "成员资料在保存时发生变化，未保存本次修改；请核对最新资料后重试", conflict: true }, 409);
    console.error("Roster review transaction failed", error?.message || error);
    return json({ error: "人员核对保存失败，本次修改未写入；请重试" }, 500);
  }
  return finish(await readReceipt());
}
