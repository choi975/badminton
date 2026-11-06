export function normalizeShuttleDefaultPrice(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const price = Number(value);
  if (!Number.isFinite(price) || price <= 0 || price > 1000 || Math.abs(price * 100 - Math.round(price * 100)) > 1e-7) return null;
  return Math.round(price * 100) / 100;
}

export function defaultPriceForShuttleType(type) {
  const valid = value => Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) <= 1000;
  if (valid(type?.defaultPrice)) return Number(type.defaultPrice);
  return (type?.prices || []).map(Number).find(valid) ?? 0;
}

export function normalizeShuttleTypeRow(row) {
  let prices = [];
  try { const parsed = JSON.parse(row.prices_json || "[]"); if (Array.isArray(parsed)) prices = parsed.map(Number).filter(price => Number.isFinite(price) && price >= 0); } catch { /* Keep malformed historical aliases empty. */ }
  const type = { id: String(row.id), name: String(row.name), fullName: String(row.full_name || row.name), prices, defaultPrice: row.default_price };
  type.defaultPrice = defaultPriceForShuttleType(type);
  return type;
}

export async function editRegisteredShuttleType(db, id, body) {
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const price = normalizeShuttleDefaultPrice(body?.defaultPrice);
  const expectedPrice = Number(body?.expectedDefaultPrice);
  if (!name || name.length > 40 || price === null || !Number.isFinite(expectedPrice) || expectedPrice <= 0 || typeof body?.expectedName !== "string") {
    return { status: 400, error: "请填写40字以内的球型名称和大于0、不超过1000元的默认单价，最多两位小数" };
  }
  const row = await db.prepare("SELECT id, name, full_name, prices_json, default_price FROM shuttle_types WHERE id = ? AND enabled = 1").bind(id).first();
  if (!row) return { status: 404, error: "该球型不存在或已停用" };
  const current = normalizeShuttleTypeRow(row);
  if (current.name === name && current.defaultPrice === price) return { status: 200, type: current, unchanged: true };
  if (current.name !== body.expectedName || current.defaultPrice !== expectedPrice) return { status: 409, error: "球型资料已更新，请取消后重新编辑", type: current };
  const duplicate = await db.prepare("SELECT id FROM shuttle_types WHERE lower(name) = lower(?) AND id != ? LIMIT 1").bind(name, id).first();
  if (duplicate) return { status: 409, error: "该球型名称已经登记，请使用其他名称" };
  let result;
  try {
    result = await db.prepare(`UPDATE shuttle_types
      SET name = ?, full_name = CASE WHEN full_name = name THEN ? ELSE full_name END, default_price = ?
      WHERE id = ? AND enabled = 1 AND name = ? AND COALESCE(default_price, json_extract(prices_json, '$[0]')) = ?`)
      .bind(name, name, price, id, body.expectedName, expectedPrice).run();
  } catch (error) {
    if (/UNIQUE constraint failed.*shuttle_types/i.test(String(error.message))) return { status: 409, error: "该球型名称已经登记，请使用其他名称" };
    throw error;
  }
  if (!Number(result.meta?.changes)) {
    const latest = await db.prepare("SELECT id, name, full_name, prices_json, default_price FROM shuttle_types WHERE id = ? AND enabled = 1").bind(id).first();
    return { status: 409, error: "球型资料已更新，请取消后重新编辑", ...(latest ? { type: normalizeShuttleTypeRow(latest) } : {}) };
  }
  // Never rewrite historical price aliases or any saved booking rows.
  return { status: 200, type: { ...current, name, fullName: current.fullName === current.name ? name : current.fullName, defaultPrice: price } };
}
