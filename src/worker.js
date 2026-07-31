import INDEX_HTML from "./index.html";
import HTML2CANVAS_JS from "./html2canvas.txt";
import BOOTSTRAP_SNAPSHOT from "./bootstrap-snapshot.txt";

const DEFAULT_LEVEL_GUIDE_RAW = `中羽等级表格
0.5级
•  刚开始打球，连握拍都不会
1级
•  会正手和反手握拍，但不会灵活切换
•  会正手发球和反手发球，但发球经常下网或者出界
•  不会侧身和架拍
•  打球基本原地不动
•  挥拍经常挥空
1.5级
•  反手发球基本及格，但是失误较多
•  偶尔会记得侧身和架拍
•  开始会移动了，但移动较慢，动作僵硬
•  正手高远球经常只能打到中半场
•  不会处理网前球
2级
•  正手高远球基本能到底线
•  接发球经常是回球只能回到中场
•  不会接对面偷后场的发球
•  挥拍经常打杆
•  对网前球会下压和放网，但失误率高
2.5级
•  接发球开始会挑后场了
•  能接对面偷后场的发球，但回球经常是只能回到网前。
•  大多是平抽，还不太会杀球、吊球等技术
•  回球质量不高，常被对手连续进攻
3级
•  接发球不再只是挑后场，偶尔会平推或放网
•  面对对面偷后场的发球，回球能够回高远球甚至杀球。
•  移动开始变得灵活
•  掌握吊球，杀球，搓球，放网等常用的技术
•  回球开始会找空档，但还不会主动规划线路，转守为攻。
•  正手回球能回到底线，正反手也能完成一些过渡
•  能接一些威胁不大的杀球。
3.5级
•  掌握踮步、并步、弓箭步、交叉步等常见步伐，启动和移动速度达到中等水平
•  反手高远球也能够打到后场，正反手过渡直线斜线相对稳定
•  进攻有威胁，防守会做出一些球路变化，不让对手连续进攻
4级
•  发接发质量高，失误少，网前放网、搓球等质量高
•  前场封网速度快，后场能够连续进攻
•  掌握各种杀球(重杀，劈杀，点杀)和吊球(滑吊，劈吊)技术
•  能够较好的完成对抗练习，有控制对手的意识，发现其弱点
•  场上失误较少，回球质量较高
4.5级
•  步伐标准，没有多余的动作
•  后场能够连续进攻，甚至会双脚起跳杀球
•  防守能做出球路变化，转守为攻
•  会一些假动作且动作一致性较强
5级
•  各项技术运用自如，并且有一两项突出的技术(比如杀球快)
•  每一拍衔接的较快，几乎没有失误
•  会反手杀球、鱼跃接球、身后接球之类的高难度动作
•  力量和速度达到高等水平，进攻威胁较强，防守也较牢固
6级
•  能看到专业选手的技术特点，有意识和战术分析能力
•  参加业余比赛并取得过较好成绩
7级
•  在省市级业余比赛获得较好名次
8级
•  在全国性比赛获得较好名次
9级
•  在全国性比赛获得冠军`;

const VALID_GENDERS = new Set(["男", "女"]);
const VALID_LEVELS = new Set(["不详", "0.5级", "1级", "1.5级", "2级", "2.5级", "3级", "3.5级", "4级", "4.5级", "5级", "6级", "7级", "8级", "9级"]);
const VALID_BOOKING_TIMES = new Set(["19:00~22:00", "19:00~21:00", "20:00~22:00"]);
const VALID_AFFILIATIONS = new Set(["球友", "Hytronik", "球友+Hytronik", "特殊"]);
const PAYMENT_ORDER_AFFILIATIONS = ["球友", "Hytronik"];
const ORDERABLE_AFFILIATIONS = new Set(PAYMENT_ORDER_AFFILIATIONS);

const LEVEL_PATTERN = /^(\d+(?:\.5)?级)$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname.startsWith("/api/")) {
        if (request.method.toUpperCase() === "OPTIONS") return preflight();
        if (isBlockedGitHubWrite(request)) {
          return json({ error: "GitHub 备用版为只读，请使用 Cloudflare 管理版修改数据" }, 403);
        }
        await ensureSeeded(env.DB);
        return await handleApi(request, env, url);
      }

      if (url.pathname === "/" || url.pathname === "/index.html") {
        return new Response(INDEX_HTML, {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-cache",
          },
        });
      }

      if (url.pathname === "/html2canvas.min.js") {
        return new Response(HTML2CANVAS_JS, {
          headers: {
            "content-type": "text/javascript; charset=utf-8",
            "cache-control": "public, max-age=31536000, immutable",
          },
        });
      }

      if (url.pathname === "/bootstrap-snapshot.json") {
        return new Response(BOOTSTRAP_SNAPSHOT, {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "public, max-age=300",
          },
        });
      }

      return new Response("Not found", { status: 404 });
    } catch (error) {
      return json({ error: error.message || "服务器错误" }, 500);
    }
  },
};

function isBlockedGitHubWrite(request) {
  const method = request.method.toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return false;
  return request.headers.get("origin") === "https://choi975.github.io";
}

async function handleApi(request, env, url) {
  const { pathname } = url;
  const method = request.method.toUpperCase();

  if (pathname === "/api/bootstrap" && method === "GET") {
    const [players, guide, paymentState] = await Promise.all([listPlayers(env.DB), getLevelGuide(env.DB), getPaymentOrderState(env.DB)]);
    return json({ players, ...guide, ...paymentState });
  }

  if (pathname === "/api/players" && method === "GET") {
    return json({ players: await listPlayers(env.DB) });
  }

  if (pathname === "/api/players" && method === "POST") {
    const input = sanitizePlayer(await readJson(request));
    if (!input.name) return json({ error: "名称不能为空" }, 400);
    const result = await env.DB.prepare(
      `INSERT INTO players (name, gender, level, booking_time, affiliation, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    ).bind(input.name, input.gender, input.level, input.booking_time, input.affiliation).run();
    const playerId = Number(result.meta.last_row_id);
    const joinStatements = groupsForAffiliation(input.affiliation).map((affiliation) => buildJoinAtEndStatement(env.DB, affiliation, playerId));
    if (joinStatements.length) await env.DB.batch(joinStatements);
    const [player, paymentState] = await Promise.all([getPlayerById(env.DB, playerId), getPaymentOrderState(env.DB)]);
    return json({ player, ...paymentState }, 201);
  }

  const playerMatch = pathname.match(/^\/api\/players\/(\d+)$/);
  const playerJoinNumberMatch = pathname.match(/^\/api\/players\/(\d+)\/join-numbers$/);
  if (playerJoinNumberMatch && method === "PATCH") {
    const id = Number(playerJoinNumberMatch[1]);
    const body = await readJson(request);
    const affiliation = String(body.affiliation || "").trim();
    const joinNumber = Number(body.joinNumber);
    if (!ORDERABLE_AFFILIATIONS.has(affiliation) || !Number.isInteger(joinNumber) || joinNumber <= 0) {
      return json({ error: "入群序号需要填写大于0的整数" }, 400);
    }

    const player = await env.DB.prepare("SELECT id, affiliation FROM players WHERE id = ?").bind(id).first();
    if (!player) return json({ error: "找不到这个人物档案" }, 404);
    if (!groupsForAffiliation(player.affiliation).includes(affiliation)) {
      return json({ error: "该成员不属于此群，无法设置入群序号" }, 400);
    }

    const statements = await buildJoinNumberChangeStatements(env.DB, id, affiliation, joinNumber);
    if (statements.length) await env.DB.batch(statements);
    return json(await getPaymentOrderState(env.DB));
  }

  if (playerMatch && method === "PATCH") {
    const id = Number(playerMatch[1]);
    const existing = await env.DB.prepare("SELECT * FROM players WHERE id = ?").bind(id).first();
    if (!existing) return json({ error: "找不到这个人物档案" }, 404);

    const input = sanitizePlayer({ ...existing, ...(await readJson(request)) });
    if (!input.name) return json({ error: "名称不能为空" }, 400);
    const updates = [env.DB.prepare(
      `UPDATE players
       SET name = ?, gender = ?, level = ?, booking_time = ?, affiliation = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(input.name, input.gender, input.level, input.booking_time, input.affiliation, id)];
    if (existing.affiliation !== input.affiliation) {
      updates.push(...await buildAffiliationChangeStatements(env.DB, id, existing.affiliation, input.affiliation));
    }
    await env.DB.batch(updates);
    const [player, paymentState] = await Promise.all([getPlayerById(env.DB, id), getPaymentOrderState(env.DB)]);
    return json({ player, ...paymentState });
  }

  if (playerMatch && method === "DELETE") {
    const id = Number(playerMatch[1]);
    const existing = await env.DB.prepare("SELECT id FROM players WHERE id = ?").bind(id).first();
    if (!existing) return json({ error: "找不到这个人物档案" }, 404);
    const statements = await buildPlayerDeletionStatements(env.DB, id);
    await env.DB.batch(statements);
    return json({ ok: true, ...await getPaymentOrderState(env.DB) });
  }

  if (pathname === "/api/payment-orders" && method === "GET") {
    return json(await getPaymentOrderState(env.DB));
  }

  if (pathname === "/api/payment-settings" && method === "PUT") {
    const body = await readJson(request);
    const joinNumbers = normalizeGroupJoinNumberSettings(body.joinNumbers);
    if (!joinNumbers) return json({ error: "入群序号数据无效" }, 400);
    if (!Array.isArray(body.specialSettings)) return json({ error: "特殊成员设置无效" }, 400);

    const specialSettings = normalizeSpecialPaymentSettings(body.specialSettings);
    if (!specialSettings) return json({ error: "特殊成员设置无效" }, 400);
    const unrecordedExit = normalizeUnrecordedExit(body.unrecordedExit);
    if (body.unrecordedExit && !unrecordedExit) return json({ error: "退群序号无效" }, 400);

    if (unrecordedExit) {
      const entries = joinNumbers[unrecordedExit.affiliation];
      if (entries.some((entry) => entry.joinNumber === unrecordedExit.joinNumber)) {
        const owner = entries.find((entry) => entry.joinNumber === unrecordedExit.joinNumber);
        const player = await env.DB.prepare("SELECT name FROM players WHERE id = ?").bind(owner.playerId).first();
        return json({ error: `第${unrecordedExit.joinNumber}位属于“${firstPlayerName(player?.name)}”，请在主表修改所属或删除成员` }, 409);
      }
      entries.forEach((entry) => {
        if (entry.joinNumber > unrecordedExit.joinNumber) entry.joinNumber -= 1;
      });
    }

    const statements = await buildGroupJoinNumberSaveStatements(env.DB, joinNumbers);
    statements.push(...await buildSpecialPaymentSettingStatements(env.DB, specialSettings));
    await env.DB.batch(statements);

    const [players, paymentState] = await Promise.all([listPlayers(env.DB), getPaymentOrderState(env.DB)]);
    return json({ players, ...paymentState });
  }

  if (pathname === "/api/payment-orders" && method === "PUT") {
    const body = await readJson(request);
    const affiliation = String(body.affiliation || "").trim();
    if (!ORDERABLE_AFFILIATIONS.has(affiliation)) return json({ error: "该分组不支持付款排序" }, 400);
    if (!Array.isArray(body.playerIds)) return json({ error: "排序数据无效" }, 400);
    await saveLegacyPaymentOrder(env.DB, affiliation, body.playerIds);
    return json(await getPaymentOrderState(env.DB));
  }

  if (pathname === "/api/special-payment-settings" && method === "PUT") {
    const body = await readJson(request);
    if (!Array.isArray(body.settings)) return json({ error: "特殊成员设置无效" }, 400);
    const settings = normalizeSpecialPaymentSettings(body.settings);
    if (!settings) return json({ error: "特殊成员设置无效" }, 400);
    await saveSpecialPaymentSettings(env.DB, settings);
    return json({ players: await listPlayers(env.DB) });
  }

  if (pathname === "/api/level-guide" && method === "GET") {
    return json(await getLevelGuide(env.DB));
  }

  if (pathname === "/api/level-guide" && method === "PUT") {
    const body = await readJson(request);
    const raw = String(body.raw || "").trim();
    if (!raw) return json({ error: "等级介绍不能为空" }, 400);
    await saveLevelGuide(env.DB, raw);
    return json(await getLevelGuide(env.DB));
  }

  return json({ error: "接口不存在" }, 404);
}

async function ensureSeeded(db) {
  const row = await db.prepare("SELECT value FROM app_settings WHERE key = 'level_guide_raw'").first();
  if (!row) {
    await saveLevelGuide(db, DEFAULT_LEVEL_GUIDE_RAW);
  }
}

async function listPlayers(db) {
  const { results } = await db.prepare("SELECT * FROM players ORDER BY id ASC").all();
  return results.map(normalizePlayer);
}

async function getPaymentOrderState(db) {
  const groupJoinNumbers = Object.fromEntries(PAYMENT_ORDER_AFFILIATIONS.map((affiliation) => [affiliation, []]));
  const { results } = await db.prepare(
    `SELECT affiliation, player_id, join_number
     FROM group_join_numbers
     ORDER BY affiliation ASC, join_number ASC, player_id ASC`
  ).all();

  for (const row of results) {
    if (!groupJoinNumbers[row.affiliation]) continue;
    groupJoinNumbers[row.affiliation].push({
      playerId: Number(row.player_id),
      joinNumber: Number(row.join_number),
    });
  }

  const paymentOrders = Object.fromEntries(PAYMENT_ORDER_AFFILIATIONS.map((affiliation) => [
    affiliation,
    groupJoinNumbers[affiliation].map((entry) => entry.playerId),
  ]));
  return { groupJoinNumbers, paymentOrders };
}

function normalizeGroupJoinNumberSettings(rawSettings) {
  if (!rawSettings || typeof rawSettings !== "object") return null;
  const normalized = {};

  for (const affiliation of PAYMENT_ORDER_AFFILIATIONS) {
    const rawEntries = rawSettings[affiliation];
    if (!Array.isArray(rawEntries)) return null;
    const playerIds = new Set();
    const joinNumbers = new Set();
    const entries = [];

    for (const rawEntry of rawEntries) {
      const playerId = Number(rawEntry?.playerId);
      const joinNumber = Number(rawEntry?.joinNumber);
      if (!Number.isInteger(playerId) || playerId <= 0 || !Number.isInteger(joinNumber) || joinNumber <= 0) return null;
      if (playerIds.has(playerId) || joinNumbers.has(joinNumber)) return null;
      playerIds.add(playerId);
      joinNumbers.add(joinNumber);
      entries.push({ playerId, joinNumber });
    }

    normalized[affiliation] = entries;
  }

  return normalized;
}

function normalizeUnrecordedExit(rawExit) {
  if (!rawExit) return null;
  const affiliation = String(rawExit.affiliation || "").trim();
  const joinNumber = Number(rawExit.joinNumber);
  if (!ORDERABLE_AFFILIATIONS.has(affiliation) || !Number.isInteger(joinNumber) || joinNumber <= 0) return null;
  return { affiliation, joinNumber };
}

async function buildGroupJoinNumberSaveStatements(db, settings) {
  const statements = [];

  for (const affiliation of PAYMENT_ORDER_AFFILIATIONS) {
    const affiliations = affiliation === "球友"
      ? ["球友", "球友+Hytronik"]
      : ["Hytronik", "球友+Hytronik"];
    const { results } = await db.prepare("SELECT id FROM players WHERE affiliation IN (?, ?)").bind(...affiliations).all();
    const allowedIds = new Set(results.map((row) => Number(row.id)));
    const entries = settings[affiliation];
    const submittedIds = new Set(entries.map((entry) => entry.playerId));
    if (allowedIds.size !== submittedIds.size || [...allowedIds].some((id) => !submittedIds.has(id))) {
      throw new Error(`${affiliation}成员已发生变化，请关闭设置窗口后重试`);
    }

    statements.push(db.prepare("DELETE FROM group_join_numbers WHERE affiliation = ?").bind(affiliation));
    for (const entry of entries) {
      statements.push(db.prepare(
        `INSERT INTO group_join_numbers (affiliation, player_id, join_number, updated_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)`
      ).bind(affiliation, entry.playerId, entry.joinNumber));
    }
  }

  return statements;
}

async function saveLegacyPaymentOrder(db, affiliation, rawPlayerIds) {
  const state = await getPaymentOrderState(db);
  const playerIds = [...new Set(rawPlayerIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  state.groupJoinNumbers[affiliation] = playerIds.map((playerId, index) => ({ playerId, joinNumber: index + 1 }));
  await db.batch(await buildGroupJoinNumberSaveStatements(db, state.groupJoinNumbers));
}

function groupsForAffiliation(affiliation) {
  if (affiliation === "球友") return ["球友"];
  if (affiliation === "Hytronik") return ["Hytronik"];
  if (affiliation === "球友+Hytronik") return ["球友", "Hytronik"];
  return [];
}

function buildJoinAtEndStatement(db, affiliation, playerId) {
  return db.prepare(
    `INSERT INTO group_join_numbers (affiliation, player_id, join_number, updated_at)
     VALUES (?, ?, (SELECT COALESCE(MAX(join_number), 0) + 1 FROM group_join_numbers WHERE affiliation = ?), CURRENT_TIMESTAMP)
     ON CONFLICT(affiliation, player_id) DO UPDATE SET
       join_number = excluded.join_number,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(affiliation, playerId, affiliation);
}

async function buildJoinNumberChangeStatements(db, playerId, affiliation, joinNumber) {
  const { results } = await db.prepare(
    "SELECT player_id, join_number FROM group_join_numbers WHERE affiliation = ? ORDER BY join_number ASC, player_id ASC"
  ).bind(affiliation).all();
  const current = results.find((row) => Number(row.player_id) === playerId);
  if (!current) throw new Error("该成员缺少入群序号，请先在群收款设置中保存后重试");

  const currentNumber = Number(current.join_number);
  if (currentNumber === joinNumber) return [];

  const occupied = new Set(results
    .filter((row) => Number(row.player_id) !== playerId)
    .map((row) => Number(row.join_number)));
  let firstVacancy = joinNumber;
  while (occupied.has(firstVacancy)) firstVacancy += 1;

  const statements = results
    .filter((row) => Number(row.player_id) !== playerId)
    .filter((row) => Number(row.join_number) >= joinNumber && Number(row.join_number) < firstVacancy)
    .map((row) => db.prepare(
      "UPDATE group_join_numbers SET join_number = join_number + 1, updated_at = CURRENT_TIMESTAMP WHERE affiliation = ? AND player_id = ?"
    ).bind(affiliation, row.player_id));
  statements.push(db.prepare(
    "UPDATE group_join_numbers SET join_number = ?, updated_at = CURRENT_TIMESTAMP WHERE affiliation = ? AND player_id = ?"
  ).bind(joinNumber, affiliation, playerId));
  return statements;
}

async function buildAffiliationChangeStatements(db, playerId, previousAffiliation, nextAffiliation) {
  const previousGroups = new Set(groupsForAffiliation(previousAffiliation));
  const nextGroups = new Set(groupsForAffiliation(nextAffiliation));
  const removedGroups = [...previousGroups].filter((affiliation) => !nextGroups.has(affiliation));
  const addedGroups = [...nextGroups].filter((affiliation) => !previousGroups.has(affiliation));
  const { results } = await db.prepare(
    "SELECT affiliation, join_number FROM group_join_numbers WHERE player_id = ?"
  ).bind(playerId).all();
  const numbers = new Map(results.map((row) => [row.affiliation, Number(row.join_number)]));
  const statements = [];

  for (const affiliation of removedGroups) {
    const joinNumber = numbers.get(affiliation);
    statements.push(db.prepare(
      "DELETE FROM group_join_numbers WHERE affiliation = ? AND player_id = ?"
    ).bind(affiliation, playerId));
    if (Number.isInteger(joinNumber)) {
      statements.push(db.prepare(
        `UPDATE group_join_numbers
         SET join_number = join_number - 1, updated_at = CURRENT_TIMESTAMP
         WHERE affiliation = ? AND join_number > ?`
      ).bind(affiliation, joinNumber));
    }
  }

  for (const affiliation of addedGroups) {
    statements.push(buildJoinAtEndStatement(db, affiliation, playerId));
  }

  return statements;
}

async function buildPlayerDeletionStatements(db, playerId) {
  const { results } = await db.prepare(
    "SELECT affiliation, join_number FROM group_join_numbers WHERE player_id = ?"
  ).bind(playerId).all();
  const statements = [];

  for (const row of results) {
    const affiliation = row.affiliation;
    const joinNumber = Number(row.join_number);
    statements.push(db.prepare(
      "DELETE FROM group_join_numbers WHERE affiliation = ? AND player_id = ?"
    ).bind(affiliation, playerId));
    statements.push(db.prepare(
      `UPDATE group_join_numbers
       SET join_number = join_number - 1, updated_at = CURRENT_TIMESTAMP
       WHERE affiliation = ? AND join_number > ?`
    ).bind(affiliation, joinNumber));
  }

  statements.push(db.prepare("DELETE FROM payment_orders WHERE player_id = ?").bind(playerId));
  statements.push(db.prepare("DELETE FROM players WHERE id = ?").bind(playerId));
  return statements;
}

function firstPlayerName(name) {
  return String(name || "").split(/[,，]/)[0].trim() || "该成员";
}

function normalizeSpecialPaymentSettings(rawSettings) {
  const settingsById = new Map();
  for (const setting of rawSettings) {
    const playerId = Number(setting?.playerId);
    if (!Number.isInteger(playerId) || playerId <= 0 || typeof setting?.participatesPayment !== "boolean") {
      return null;
    }
    settingsById.set(playerId, setting.participatesPayment);
  }
  return [...settingsById].map(([playerId, participatesPayment]) => ({ playerId, participatesPayment }));
}

async function saveSpecialPaymentSettings(db, settings) {
  const statements = await buildSpecialPaymentSettingStatements(db, settings);
  if (statements.length) await db.batch(statements);
}

async function buildSpecialPaymentSettingStatements(db, settings) {
  if (!settings.length) return [];
  const { results } = await db.prepare("SELECT id FROM players WHERE affiliation = '特殊'").all();
  const allowedIds = new Set(results.map((row) => Number(row.id)));
  if (settings.some((setting) => !allowedIds.has(setting.playerId))) {
    throw new Error("只能设置所属为“特殊”的成员");
  }

  return settings.map((setting) => db.prepare(
    `UPDATE players
     SET participates_payment = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND affiliation = '特殊'`
  ).bind(setting.participatesPayment ? 1 : 0, setting.playerId));
}

async function getPlayerById(db, id) {
  const row = await db.prepare("SELECT * FROM players WHERE id = ?").bind(id).first();
  if (!row) throw new Error("保存后读取人物档案失败");
  return normalizePlayer(row);
}

async function getLevelGuide(db) {
  const [rawRow, guideRows] = await Promise.all([
    db.prepare("SELECT value FROM app_settings WHERE key = 'level_guide_raw'").first(),
    db.prepare("SELECT level, description, sort_order FROM level_guides ORDER BY sort_order ASC").all(),
  ]);
  const raw = rawRow?.value || DEFAULT_LEVEL_GUIDE_RAW;
  const levels = Object.fromEntries(guideRows.results.map((row) => [row.level, row.description]));
  return { levelGuideRaw: raw, levelDescriptions: levels };
}

async function saveLevelGuide(db, raw) {
  const entries = parseLevelGuide(raw);
  const batch = [
    db.prepare("INSERT INTO app_settings (key, value) VALUES ('level_guide_raw', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(raw),
    db.prepare("DELETE FROM level_guides"),
  ];

  for (const entry of entries) {
    batch.push(
      db.prepare("INSERT INTO level_guides (level, description, sort_order) VALUES (?, ?, ?)").bind(
        entry.level,
        entry.description,
        entry.sortOrder
      )
    );
  }

  await db.batch(batch);
}

function parseLevelGuide(raw) {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const entries = [];
  let current = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const levelMatch = trimmed.match(LEVEL_PATTERN);
    if (levelMatch) {
      if (current) entries.push(current);
      current = { level: levelMatch[1], descriptionLines: [] };
    } else if (current) {
      current.descriptionLines.push(line.trimEnd());
    }
  }

  if (current) entries.push(current);

  return entries
    .filter((entry) => VALID_LEVELS.has(entry.level))
    .map((entry) => ({
      level: entry.level,
      description: entry.descriptionLines.join("\n").trim(),
      sortOrder: Number(entry.level.replace("级", "")),
    }));
}

function sanitizePlayer(input) {
  const name = String(input.name || "").trim();
  const gender = VALID_GENDERS.has(input.gender) ? input.gender : "男";
  const level = VALID_LEVELS.has(input.level) ? input.level : "不详";
  const bookingCandidate = input.bookingTime ?? input.booking_time;
  const bookingTime = VALID_BOOKING_TIMES.has(bookingCandidate) ? bookingCandidate : "19:00~22:00";
  const affiliation = VALID_AFFILIATIONS.has(input.affiliation) ? input.affiliation : "球友";

  return { name, gender, level, booking_time: bookingTime, affiliation };
}

function normalizePlayer(row) {
  return {
    id: row.id,
    name: row.name || "",
    gender: row.gender || "男",
    level: row.level || "不详",
    bookingTime: row.booking_time || "19:00~22:00",
    affiliation: row.affiliation || "球友",
    participatesPayment: Number(row.participates_payment) !== 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function readJson(request) {
  const text = await request.text();
  if (!text.trim()) return {};
  return JSON.parse(text);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...corsHeaders(),
    },
  });
}

function preflight() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
  };
}
