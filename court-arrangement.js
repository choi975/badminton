(function attachCourtArrangement(root) {
  "use strict";
  const core = root.BadmintonCourtArrangementCore;
  const KEY = "badminton.court-arrangements.v1";
  const modes = { auto: "按等级默认", fixed: "固定场地，不串场", roam: "流动串场", competitive: "只打高手局" };
  const coaches = { none: "未设置带人偏好", friends: "愿意带小团体／最佳拍档", selected: "愿意带指定球友", any: "愿意陪低等级球友打" };
  const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; };
  const option = (value, text) => { const n = el("option", "", text); n.value = value; return n; };
  const button = (text, action, className = "") => { const n = el("button", className, text); n.type = "button"; n.addEventListener("click", action); return n; };
  const field = (label, control) => { const n = el("label", "ca-field"); n.append(el("span", "", label), control); return n; };
  const check = (text, checked, action) => { const n = el("label", "ca-check"), input = el("input"); input.type = "checkbox"; input.checked = checked; input.addEventListener("change", () => action(input.checked)); n.append(input, el("span", "", text)); return n; };
  const icon = (name) => { const n = el("i"); n.dataset.lucide = name; n.setAttribute("aria-hidden", "true"); return n; };
  const uuid = () => crypto.randomUUID();
  function create(adapter) {
    const $ = (id) => document.getElementById(id), dialog = $("courtArrangementModal"), board = $("caBoard"), inspector = $("caInspector"), scroll = $("caScroll");
    let store; try { store = JSON.parse(localStorage.getItem(KEY) || "null"); } catch {}
    if (!store || store.version !== 1 || !store.documents || (typeof store.documents !== "object" || Array.isArray(store.documents))) store = { version: 1, documents: {} };
    const ready = new Set(), busy = new Set(), errors = new Map(), conflicts = new Map(), preferenceDrafts = new Map();
    let activeDate = "", config = core.settings(), current = null, selection = null, selectedGroup = "", selectedManagerId = "", tab = "board", zoom = 1;
    let timer, localError = false, openVersion = 0, drag = null, lineFrame = 0, groupDraft = null, editorKey = null, suppressClickUntil = 0;
    const documentKey = () => "activity:" + activeDate;
    const activityAllowed = () => adapter.date() === activeDate && (!adapter.canOpen || adapter.canOpen());
    const doc = (key) => store.documents[key] || (store.documents[key] = { revision: 0, content: null });
    const value = (key) => doc(key).pending?.content || doc(key).content;
    const people = () => [...adapter.players()].sort((a, b) => String(a.name).localeCompare(String(b.name), "zh-CN"));
    const name = (id) => String(adapter.players().find((p) => Number(p.id) === Number(id))?.name || "已移除成员").split(/[,，]/)[0];
    const grade = (person) => { const r = core.effective(person, config, current).level; return r === null ? "等级不详" : r + "级"; };
    const groups = () => core.relationshipGroups(config, adapter.partners());
    const recommendationConfig = () => ({ ...config, groups: groups() });
    function persist() {
      try { localStorage.setItem(KEY, JSON.stringify(store)); localError = false; } catch { localError = true; }
      renderStatus();
    }
    function renderStatus() {
      const pending = Object.entries(store.documents).filter(([, row]) => row.pending), conflict = [...conflicts.keys()][0], error = [...errors.values()][0];
      const state = $("caSave"), text = $("caSaveText");
      text.textContent = localError ? "本机备份失败，请勿关闭；可复制安排保留" : conflict ? "云端有更新，本机草稿已保留，请选择处理方式"
        : error ? "已存本机，云端待重试：" + error : pending.length ? "已存本机，正在同步…" : ready.has(documentKey()) ? (activityAllowed() ? "已自动保存到云端 · 偏好长期保留，安排按活动日期保存" : "长期设置已同步 · 活动日期待确认，未保存本次排场") : "正在读取云端；可以先调整，本机草稿会保留";
      state.dataset.tone = localError || conflict || error ? "error" : pending.length || !ready.has(documentKey()) ? "pending" : "saved";
      $("caRetry").hidden = !error && !localError; $("caUseCloud").hidden = !conflict; $("caKeepLocal").hidden = !conflict;
    }
    function queue(key, content) {
      const row = doc(key);
      row.pending = { revision: row.pending?.revision ?? row.revision, mutationId: uuid(), content: core.clone(content) };
      errors.delete(key); persist(); clearTimeout(timer); timer = setTimeout(() => void flushAll(), 650);
    }
    function saveActivity() { if (!activityAllowed()) return; queue(documentKey(), core.validatePlan(current)); }
    function saveSettings() { config = core.validateSettings(config); queue("preferences", config); }
    async function request(options, date = activeDate) {
      const response = await fetch(adapter.apiUrl("/api/court-arrangements" + (options.method === "GET" ? "?date=" + date : "")), {
        ...options, headers: { "content-type": "application/json", ...(options.headers || {}) }, cache: "no-store", signal: AbortSignal.timeout(12000),
      });
      let data; try { data = await response.json(); } catch { throw new Error("服务器响应不完整，请重试"); }
      if (!response.ok) throw Object.assign(new Error(data.error || "HTTP " + response.status), { status: response.status, data });
      return data;
    }
    async function flush(key) {
      if (busy.has(key) || !ready.has(key) || conflicts.has(key) || localError) return;
      busy.add(key);
      try {
        while (doc(key).pending && !conflicts.has(key)) {
          const row = doc(key), sent = core.clone(row.pending), kind = key === "preferences" ? "settings" : "activity";
          try {
            const data = await request({ method: "POST", body: JSON.stringify({ ...sent, kind, date: kind === "activity" ? key.slice(9) : undefined }) });
            row.revision = data.saved.revision; row.content = data.saved.content; row.mutationId = data.saved.mutationId; row.updatedAt = data.saved.updatedAt;
            if (row.pending?.mutationId === sent.mutationId) delete row.pending;
            else if (row.pending) row.pending.revision = data.saved.revision;
            errors.delete(key); persist();
          } catch (error) {
            if (error.status === 409) conflicts.set(key, error.data.current || null);
            else errors.set(key, error.name === "TimeoutError" ? "请求超时" : error.message);
            persist(); break;
          }
        }
      } finally { busy.delete(key); renderStatus(); }
    }
    async function flushAll() {
      const keys = Object.keys(store.documents).filter((key) => doc(key).pending);
      const dates = [...new Set(keys.filter((key) => key.startsWith("activity:") && !ready.has(key)).map((key) => key.slice(9)))];
      for (const date of dates) {
        try { const data = await request({ method: "GET" }, date); receive("preferences", data.settings); receive("activity:" + date, data.activity); }
        catch (error) { errors.set("read:" + date, error.message); }
      }
      await Promise.all(keys.map(flush)); renderStatus();
    }
    function receive(key, remote) {
      if (busy.has(key)) return;
      const row = doc(key), pending = row.pending, revision = remote?.revision || 0;
      if (revision < row.revision) { ready.add(key); errors.delete(key); return; }
      if (pending && remote?.mutationId === pending.mutationId && JSON.stringify(remote.content) === JSON.stringify(pending.content)) delete row.pending;
      else if (pending && pending.revision !== revision) conflicts.set(key, remote);
      else conflicts.delete(key);
      row.revision = revision; row.content = remote?.content || null; row.mutationId = remote?.mutationId; row.updatedAt = remote?.updatedAt;
      ready.add(key); errors.delete(key);
    }
    async function refresh(version = openVersion, date = activeDate) {
      try {
        const data = await request({ method: "GET" }, date);
        receive("preferences", data.settings); receive("activity:" + date, data.activity); errors.delete("read:" + date); persist();
        if (version === openVersion && date === activeDate && adapter.date() === date && dialog.classList.contains("open")) {
          config = core.settings(value("preferences"));
          const previous = value(documentKey());
          current = previous ? core.reconcile(previous, adapter.roster(), recommendationConfig()) : core.recommend(adapter.roster(), recommendationConfig(), current);
          render();
          if (activityAllowed() && !doc(documentKey()).pending && current.roster.length && JSON.stringify(current) !== JSON.stringify(doc(documentKey()).content)) saveActivity();
        }
        await flushAll();
      } catch (error) { errors.set("read:" + date, error.name === "TimeoutError" ? "读取超时" : error.message); renderStatus(); }
    }
    async function resolveConflict(useRemote) {
      const [key, remote] = [...conflicts.entries()][0] || [];
      if (!key || busy.has(key)) return;
      if (!useRemote && !confirm("保留本机草稿将替换这个文档的云端版本，确认继续？")) return;
      const row = doc(key);
      row.revision = remote?.revision || 0; row.content = remote?.content || null;
      if (useRemote) delete row.pending; else if (row.pending) { row.pending.revision = row.revision; row.pending.mutationId = uuid(); }
      conflicts.delete(key); persist();
      if (key === "preferences") config = core.settings(value(key));
      if (key === documentKey()) current = value(key) ? core.reconcile(value(key), adapter.roster(), recommendationConfig()) : core.recommend(adapter.roster(), recommendationConfig());
      render(); if (!useRemote) await flush(key);
    }
    function showView(next) {
      if (next === "board" && !activityAllowed()) { adapter.toast("请先确认活动日期，再打开本次排场；长期偏好仍可编辑"); return; }
      tab = next; $("caBoardPanel").hidden = next !== "board"; $("caSettingsPanel").hidden = next !== "settings";
      editorKey = null; renderInspector(); updateViewButton();
      if (next === "settings") renderManager(); else { sizeBoard(); scheduleLines(); }
    }
    function updateViewButton() {
      const toggle = $("caSettingsToggle"), settingsOpen = tab === "settings";
      toggle.setAttribute("aria-pressed", String(settingsOpen));
      const label = settingsOpen ? "返回场地安排" : "偏好与小团体";
      toggle.setAttribute("aria-label", label); toggle.title = label;
      toggle.replaceChildren(icon(settingsOpen ? "layout-dashboard" : "sliders-horizontal"));
      root.lucide?.createIcons({ root: toggle });
    }
    function open(next = "board") {
      if (next !== "settings" && adapter.canOpen && !adapter.canOpen()) { adapter.toast("请先整理名单并确认活动日期，再安排场地"); return; }
      const date = adapter.date(); if (!core.validDate(date)) { adapter.toast("活动日期无效，请先确认日期"); return; }
      activeDate = date; openVersion++; selection = null; selectedGroup = ""; groupDraft = null; editorKey = null; tab = next;
      config = core.settings(value("preferences"));
      const previous = value(documentKey());
      current = previous ? core.reconcile(previous, adapter.roster(), recommendationConfig()) : core.recommend(adapter.roster(), recommendationConfig());
      adapter.openModal("courtArrangementModal"); render(); inspector.scrollTop = 0; scroll.scrollLeft = scroll.scrollTop = 0; showView(next);
      requestAnimationFrame(() => { if (next === "board") { if (scroll.clientWidth < 600) { zoom = 1; $("caZoom").value = "1"; sizeBoard(); } else fit(); } });
      void refresh();
    }
    function courtLabel(id) { return current.courts.find((c) => c.id === id)?.label || "?"; }
    function updateGroupOptions() {
      const select = $("caGroupFilter"); select.replaceChildren(option("", "查看小团体"));
      for (const group of groups()) {
        const present = current.roster.filter((p) => group.members.includes(p.playerId)); if (present.length < 2) continue;
        select.append(option(group.id, (group.source === "partner" ? present.map((p) => p.name).join("／") : group.name) + " · " + present.length + "人在场"));
      }
      if (![...select.options].some((o) => o.value === selectedGroup)) selectedGroup = "";
      select.value = selectedGroup;
    }
    function personButton(person, floating = false, position = null) {
      const assignment = current.assignments[person.key], n = el("button", "ca-person" + (floating ? " ca-floating" : "")); n.type = "button"; n.dataset.person = person.key;
      n.title = `${person.name} · ${grade(person)}；${assignment.courtId ? "固定在" + courtLabel(assignment.courtId) + "号场" : "可去" + assignment.allowed.map(courtLabel).join("、") + "号场"}；拖动修改本次安排，双击或按F2编辑`;
      n.setAttribute("aria-label", n.title); n.append(el("strong", "", person.name), el("small", "", grade(person) + (floating ? " · " + assignment.allowed.map(courtLabel).join("/") + "号场" : "")));
      n.addEventListener("click", () => select({ type: "person", key: person.key })); n.addEventListener("pointerdown", (e) => beginDrag(e, "person", person.key));
      n.addEventListener("dblclick", () => openEditor(person.key)); n.setAttribute("aria-keyshortcuts", "F2");
      n.addEventListener("keydown", (e) => { if (e.key === "F2") { e.preventDefault(); openEditor(person.key); } });
      if (floating) { const point = position || assignment.position; n.style.left = point.x + "px"; n.style.top = point.y + "px"; }
      return n;
    }
    function renderBoard() {
      board.replaceChildren(); const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.classList.add("ca-lines"); svg.setAttribute("aria-hidden", "true"); board.append(svg);
      const info = core.courtInfo(current, config);
      for (const court of info) {
        const n = el("section", "ca-court" + (court.protected ? " ca-protected" : "")); n.dataset.court = court.id; n.style.left = court.x + "px"; n.style.top = court.y + "px"; n.style.height = court.height + "px";
        n.setAttribute("aria-label", `${court.label}号场，固定${court.fixed.length}人，另有${court.moving.length}人可串入`);
        const head = el("div", "ca-court-head"), title = el("div", "ca-court-title"), grip = button("", () => select({ type: "court", key: court.id }), "ca-court-grip");
        grip.append(icon("grip")); grip.title = "拖动场地布局；也可用方向键移动"; grip.setAttribute("aria-label", "拖动" + court.label + "号场，方向键调整位置");
        grip.addEventListener("pointerdown", (e) => beginDrag(e, "court", court.id));
        grip.addEventListener("keydown", (e) => { const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]; if (!delta) return; e.preventDefault(); const c = current.courts.find((r) => r.id === court.id); c.x = Math.max(0, Math.min(20000, c.x + delta[0] * (e.shiftKey ? 64 : 16))); c.y = Math.max(0, Math.min(20000, c.y + delta[1] * (e.shiftKey ? 64 : 16))); n.style.left = c.x + "px"; n.style.top = c.y + "px"; saveActivity(); sizeBoard(); scheduleLines(); });
        const input = el("input"); input.value = court.label; input.maxLength = 16; input.setAttribute("aria-label", "场地编号：" + court.label);
        input.addEventListener("change", () => { const label = input.value.trim(); if (!label || current.courts.some((c) => c.id !== court.id && c.label === label)) { input.value = court.label; adapter.toast("场地编号不能为空或重复"); return; } current.courts.find((c) => c.id === court.id).label = label; current = core.recommend(adapter.roster(), recommendationConfig(), current); saveActivity(); render(); });
        const remove = button("", () => removeCourt(court.id), "ca-court-remove"); remove.append(icon("x")); remove.setAttribute("aria-label", "删除" + court.label + "号场"); remove.disabled = current.courts.length === 1;
        const range = court.min !== null ? (court.min === court.max ? court.min : court.min + "～" + court.max) + "级" : "流动场";
        const level = el("span", "ca-court-level", range); level.title = range + (court.protected ? " · 高手专场" : "");
        if (court.protected) level.classList.add("ca-protection-label");
        title.append(grip, el("span", "ca-court-label", "场地"), input, level, remove); head.append(title);
        head.addEventListener("click", (e) => { if (!e.target.closest("input, button")) select({ type: "court", key: court.id }); }); n.append(head);
        if (court.fixed.length) { const list = el("div", "ca-court-people"); court.fixed.forEach((p) => list.append(personButton(p))); n.append(list); }
        else n.append(el("div", "ca-court-empty", "流动场\n由流动人员现场补位\n点击场地查看可来人员"));
        n.addEventListener("click", (e) => { if (e.target === n || e.target.classList.contains("ca-court-empty")) select({ type: "court", key: court.id }); }); board.append(n);
      }
      for (const display of flowLayout()) {
        const { bundle, grouped, position, width } = display;
        if (grouped.length === 1) {
          const card = personButton(grouped[0], true, position); card.classList.add("ca-flow-single"); card.dataset.flowBundle = bundle.key; board.append(card); continue;
        }
        const n = el("section", "ca-bundle"); n.dataset.bundle = bundle.key; n.tabIndex = 0;
        n.style.left = position.x + "px"; n.style.top = position.y + "px"; n.style.width = width + "px";
        const label = "流动分组，可去" + bundle.allowed.map(courtLabel).join("、") + "号场";
        n.setAttribute("aria-label", label); n.title = "拖动边框或把手移动整组；可去" + bundle.allowed.map(courtLabel).join("、") + "号场；拖入人名采用本组可去场地"; n.setAttribute("aria-keyshortcuts", "ArrowUp ArrowDown ArrowLeft ArrowRight");
        const grip = el("button", "ca-bundle-grip"); grip.type = "button"; grip.append(icon("grip")); grip.setAttribute("aria-label", "拖动" + label); grip.title = "拖动整组；方向键调整位置"; n.append(grip);
        const cards = el("div", "ca-bundle-people"); cards.style.gridTemplateColumns = `repeat(${display.columns}, minmax(0, 1fr))`;
        grouped.forEach((person) => cards.append(personButton(person))); n.append(cards);
        n.addEventListener("pointerdown", (e) => { if (!e.target.closest(".ca-person")) beginDrag(e, "bundle", bundle.key); });
        n.addEventListener("click", (e) => { if (!e.target.closest(".ca-person")) select({ type: "bundle", key: bundle.key }); });
        n.addEventListener("keydown", (e) => {
          if (e.target !== n && !e.target.closest(".ca-bundle-grip")) return;
          const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
          if (delta) {
            e.preventDefault(); const point = current.bundlePositions?.[bundle.key] || position;
            setBundlePosition(bundle.key, { x: point.x + delta[0] * (e.shiftKey ? 64 : 16), y: point.y + delta[1] * (e.shiftKey ? 64 : 16) });
            n.style.left = current.bundlePositions[bundle.key].x + "px"; n.style.top = current.bundlePositions[bundle.key].y + "px"; saveActivity(); sizeBoard(); scheduleLines();
          } else if (["Enter", " "].includes(e.key)) { e.preventDefault(); select({ type: "bundle", key: bundle.key }); }
        });
        board.append(n);
      }
      current.roster.filter((person) => !current.assignments[person.key].courtId && current.assignments[person.key].position).forEach((person) => board.append(personButton(person, true)));
      if (!current.roster.length) { const empty = el("div", "ca-empty"); empty.append(el("strong", "", "先添加本次接龙人员"), el("p", "", "返回接龙助手填写名单，再打开这里。你也可以先在“偏好与小团体”中设置长期偏好。")); board.append(empty); }
      root.lucide?.createIcons({ root: board }); sizeBoard(); highlight(); scheduleLines();
    }
    function setBundlePosition(key, point) {
      current.bundlePositions ||= {};
      current.bundlePositions[key] = { x: Math.min(20000, Math.max(0, Math.round(point.x / 8) * 8)), y: Math.min(20000, Math.max(0, Math.round(point.y / 8) * 8)) };
    }
    function flowLayout() {
      const info = core.courtInfo(current, config), right = Math.max(324, ...info.map((c) => c.x + 250)), result = [];
      let x = 24, y = Math.max(24, ...info.map((c) => c.y + c.height)) + 64, rowHeight = 0;
      for (const bundle of core.bundles(current)) {
        const grouped = bundle.people.filter((person) => !current.assignments[person.key].position);
        if (!grouped.length) continue;
        const columns = Math.min(4, grouped.length), width = grouped.length === 1 ? 124 : columns * 124 + (columns - 1) * 8 + 24;
        const height = grouped.length === 1 ? 44 : 24 + Math.ceil(grouped.length / columns) * 52;
        if (x > 24 && x + width > right) { x = 24; y += rowHeight + 32; rowHeight = 0; }
        const position = current.bundlePositions?.[bundle.key] || { x, y };
        result.push({ bundle, grouped, columns, width, position }); x += width + 24; rowHeight = Math.max(rowHeight, height);
      }
      return result;
    }
    function bundleSource(key) { return findData(".ca-bundle", "bundle", key) || findData(".ca-flow-single", "flowBundle", key); }
    function sizeBoard() {
      if (!current) return;
      const info = core.courtInfo(current, config), moving = [...board.querySelectorAll(".ca-bundle, .ca-floating")];
      const width = Math.max(330, ...info.map((c) => c.x + 274), ...moving.map((n) => n.offsetLeft + n.offsetWidth + 24));
      const height = Math.max(280, ...info.map((c) => c.y + c.height + 30), ...moving.map((n) => n.offsetTop + n.offsetHeight + 24));
      board.style.width = width + "px"; board.style.height = height + "px"; board.style.transform = `scale(${zoom})`;
      $("caStage").style.width = width * zoom + "px"; $("caStage").style.height = height * zoom + "px";
      const svg = board.querySelector("svg.ca-lines"); if (svg) { svg.setAttribute("width", width); svg.setAttribute("height", height); }
    }
    function fit() {
      sizeBoard(); const width = parseFloat(board.style.width); zoom = Math.min(1.25, Math.max(.35, Math.min((scroll.clientWidth - 8) / width, (scroll.clientHeight - 8) / parseFloat(board.style.height))));
      $("caZoom").querySelector('option[value="fit"]').textContent = "适应 " + Math.round(zoom * 100) + "%"; $("caZoom").value = "fit"; sizeBoard(); scheduleLines();
    }
    function findData(selector, name, key) { return [...board.querySelectorAll(selector)].find((n) => n.dataset[name] === key); }
    function scheduleLines() { cancelAnimationFrame(lineFrame); lineFrame = requestAnimationFrame(drawLines); }
    function drawLines() {
      const svg = board.querySelector("svg.ca-lines"); if (!svg || !dialog.classList.contains("open")) return; svg.replaceChildren();
      const rect = (n) => { const a = n.getBoundingClientRect(), b = board.getBoundingClientRect(); return { x: (a.left - b.left) / zoom, y: (a.top - b.top) / zoom, width: a.width / zoom, height: a.height / zoom }; };
      const line = (source, courtId, active) => {
        const target = findData(".ca-court", "court", courtId); if (!source || !target) return;
        const a = rect(source), b = rect(target);
        const edge = (r, destination) => {
          const x = r.x + r.width / 2, y = r.y + r.height / 2, dx = destination.x - x, dy = destination.y - y;
          const t = Math.min(dx ? r.width / (2 * Math.abs(dx)) : Infinity, dy ? r.height / (2 * Math.abs(dy)) : Infinity);
          return Number.isFinite(t) ? { x: x + dx * t, y: y + dy * t } : { x, y };
        };
        const from = edge(a, { x: b.x + b.width / 2, y: b.y + b.height / 2 }), to = edge(b, { x: a.x + a.width / 2, y: a.y + a.height / 2 });
        // With flow groups below a row of courts, use the facing edges so links stay below the court contents.
        if (a.y >= b.y + b.height) { Object.assign(from, { x: a.x + a.width / 2, y: a.y }); Object.assign(to, { x: b.x + b.width / 2, y: b.y + b.height }); }
        else if (a.y + a.height <= b.y) { Object.assign(from, { x: a.x + a.width / 2, y: a.y + a.height }); Object.assign(to, { x: b.x + b.width / 2, y: b.y }); }
        else if (a.x + a.width <= b.x) { Object.assign(from, { x: a.x + a.width, y: a.y + a.height / 2 }); Object.assign(to, { x: b.x, y: b.y + b.height / 2 }); }
        else if (a.x >= b.x + b.width) { Object.assign(from, { x: a.x, y: a.y + a.height / 2 }); Object.assign(to, { x: b.x + b.width, y: b.y + b.height / 2 }); }
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path"); path.setAttribute("d", `M ${from.x} ${from.y} L ${to.x} ${to.y}`); path.dataset.courtLine = courtId;
        if (active) path.classList.add("ca-line-active"); svg.append(path);
      };
      const bundleLines = (bundle, courtId = null, active = false) => {
        const source = bundleSource(bundle.key);
        const ids = courtId ? [courtId] : bundle.allowed;
        if (source) for (const id of ids) line(source, id, active);
        for (const person of bundle.people.filter((p) => current.assignments[p.key].position)) for (const id of ids) line(findData(".ca-person", "person", person.key), id, active);
      };
      if (selection?.type === "person") {
        const assignment = current.assignments[selection.key]; if (assignment && !assignment.courtId) for (const id of assignment.allowed) line(findData(".ca-person", "person", selection.key), id, true);
      } else if (selection?.type === "court") {
        for (const bundle of core.bundles(current)) if (bundle.allowed.includes(selection.key)) bundleLines(bundle, selection.key, true);
      } else if (selection?.type === "bundle") {
        const bundle = core.bundles(current).find((g) => g.key === selection.key); if (bundle) for (const id of bundle.allowed) line(bundleSource(bundle.key), id, true);
      } else if (current.lineMode === "bundled") {
        for (const bundle of core.bundles(current)) bundleLines(bundle);
      }
    }
    function select(next) { selection = selection?.type === next.type && selection?.key === next.key ? null : next; editorKey = null; highlight(); renderInspector(); scheduleLines(); }
    function openEditor(key) {
      if (!activityAllowed() || !current.roster.some((p) => p.key === key)) return;
      selection = { type: "person", key }; editorKey = key; highlight(); renderInspector(); inspector.scrollTop = 0; scheduleLines();
      requestAnimationFrame(() => inspector.querySelector("select, input")?.focus({ preventScroll: true }));
    }
    function closeEditor() { const key = editorKey; editorKey = null; renderInspector(); findData(".ca-person", "person", key)?.focus({ preventScroll: true }); }
    function highlight() {
      const relation = groups().find((g) => g.id === selectedGroup), related = new Set(relation?.members || []);
      for (const n of board.querySelectorAll(".ca-person")) {
        const key = n.dataset.person, assignment = current.assignments[key];
        const active = selection?.type === "person" ? selection.key === key : selection?.type === "court" ? assignment?.allowed.includes(selection.key)
          : selection?.type === "bundle" ? core.bundles(current).find((g) => g.key === selection.key)?.people.some((p) => p.key === key) : false;
        n.classList.toggle("ca-active", Boolean(active)); n.classList.toggle("ca-related", related.has(current.roster.find((p) => p.key === key)?.playerId));
      }
      for (const n of board.querySelectorAll(".ca-bundle")) n.classList.toggle("ca-active", selection?.type === "bundle" && selection.key === n.dataset.bundle);
      for (const n of board.querySelectorAll(".ca-court")) n.classList.toggle("ca-active", selection?.type === "court" ? selection.key === n.dataset.court : selection?.type === "person" ? current.assignments[selection.key]?.allowed.includes(n.dataset.court) : false);
    }
    function render() {
      $("caCourtCount").value = current.courts.length; $("caRemoveCourt").disabled = current.courts.length === 1; $("caAddCourt").disabled = current.courts.length >= 32;
      $("caCopy").disabled = !activityAllowed(); updateViewButton();
      $("caRecommend").disabled = !current.roster.length || !activityAllowed(); $("caLineMode").value = current.lineMode;
      updateGroupOptions(); renderBoard(); renderInspector(); if (tab === "settings") renderManager(); renderStatus();
    }
    function renderInspector() {
      $("caEditPerson").hidden = tab !== "board" || selection?.type !== "person" || !activityAllowed();
      inspector.hidden = tab !== "board" || !editorKey || editorKey !== selection?.key || !activityAllowed(); inspector.replaceChildren();
      if (inspector.hidden) return;
      const person = current.roster.find((p) => p.key === editorKey); if (!person) { editorKey = null; renderInspector(); return; }
      const head = el("header", "ca-editor-head"), close = button("", closeEditor, "ca-icon-btn"); close.append(icon("x")); close.title = "关闭个人编辑"; close.setAttribute("aria-label", close.title);
      head.append(el("h3", "", person.name + " · " + grade(person)), close); inspector.append(head);
      const assignment = current.assignments[person.key], place = el("select"); place.append(option("", "框外流动")); current.courts.forEach((c) => place.append(option(c.id, "固定在 " + c.label + "号场"))); place.value = assignment.courtId || "";
      place.addEventListener("change", () => setPlacement(person.key, place.value || null)); inspector.append(field("本次安排", place));
      if (!assignment.courtId) {
        inspector.append(el("h4", "", "可去场地")); const checks = el("div", "ca-checks");
        for (const court of core.courtInfo(current, config)) checks.append(check(court.label + "号场" + (court.protected ? " · 高手专场" : ""), assignment.allowed.includes(court.id), (checked) => {
          if (!checked && assignment.allowed.length === 1) { adapter.toast("请至少保留一个可去场地"); renderInspector(); return; }
          assignment.allowed = checked ? [...assignment.allowed, court.id] : assignment.allowed.filter((id) => id !== court.id); assignment.locked = true; saveActivity(); render();
        })); inspector.append(checks);
        if (assignment.position) inspector.append(button("放回流动分组", () => { delete assignment.position; saveActivity(); render(); }));
      }
      inspector.append(check("锁定本次安排，重新建议时保留", assignment.locked, (locked) => { assignment.locked = locked; saveActivity(); }));
      const personGroups = groups().filter((g) => g.members.includes(person.playerId));
      if (personGroups.length) { inspector.append(el("h4", "", "小团体／最佳拍档")); const list = el("div", "ca-related-list"); personGroups.forEach((g) => list.append(button(g.source === "partner" ? g.members.map(name).join("／") : g.name, () => { selectedGroup = g.id; $("caGroupFilter").value = g.id; highlight(); }))); inspector.append(list); }
      renderPreferenceForm(person, inspector, false); root.lucide?.createIcons({ root: inspector });
    }
    function renderPreferenceForm(person, host, manager) {
      const present = current.roster.find((p) => p.playerId && p.playerId === person.playerId) || current.roster.find((p) => p.key === person.key);
      const draftKey = (manager ? "manager:" : activeDate + ":") + person.key, draft = preferenceDrafts.get(draftKey);
      const pref = draft?.pref || core.preference(!manager && current.overrides[person.key] || config.preferences[person.playerId] || {});
      const form = el("form", "ca-preference-form"), scope = el("select"), mode = el("select"), coach = el("select"), levelSelect = el("select");
      scope.append(option("current", "仅本次活动")); if (person.playerId) scope.prepend(option("long", "长期默认")); scope.value = draft?.scope || (manager || !current.overrides[person.key] && person.playerId ? "long" : "current");
      if (!person.playerId) form.append(el("p", "ca-hint", "随行或未入库人员只设置本次偏好，不会套用报名人的个人偏好。"));
      mode.setAttribute("aria-label", "打球偏好"); Object.entries(modes).forEach(([v, text]) => mode.append(option(v, text))); mode.value = pref.mode;
      coach.setAttribute("aria-label", "带人偏好"); Object.entries(coaches).forEach(([v, text]) => coach.append(option(v, text))); coach.value = pref.coach;
      if (!manager) form.append(el("h4", "", "个人偏好"), field("保存范围", scope));
      form.append(field("打球偏好", mode), field("带人偏好（不是带人义务）", coach));
      const targets = new Set(pref.targets), targetBox = el("div"), targetSearch = el("input"), list = el("div", "ca-targets"); targetSearch.placeholder = "搜索愿意带的球友"; targetSearch.setAttribute("aria-label", "搜索指定球友");
      const renderTargets = () => { list.replaceChildren(); people().filter((p) => Number(p.id) !== person.playerId && String(p.name).includes(targetSearch.value.trim())).forEach((p) => list.append(check(name(p.id), targets.has(Number(p.id)), (on) => on ? targets.add(Number(p.id)) : targets.delete(Number(p.id))))); };
      targetSearch.addEventListener("input", renderTargets); targetBox.append(targetSearch, list); form.append(targetBox); targetBox.hidden = coach.value !== "selected"; coach.addEventListener("change", () => { targetBox.hidden = coach.value !== "selected"; }); renderTargets();
      if (!manager) {
        levelSelect.append(option("", "不详")); for (let r = .5; r <= 9; r += .5) levelSelect.append(option(String(r), r + "级")); levelSelect.value = String(draft?.rank !== undefined ? draft.rank ?? "" : core.effective(person, config, current).level ?? "");
        form.append(field("本次等级（不修改成员数据库）", levelSelect));
      }
      const hint = el("p", "ca-hint", "默认：0.5～1.5级固定，2～2.5级流动；3级及以上暂按固定，可设置流动或只打高手局。带指定球友／朋友的高等级人员，优先连接相近水平及朋友所在场地。"), error = el("p", "ca-error"); error.setAttribute("role", "alert"); error.hidden = true;
      const submit = el("button", "primary-btn", manager ? "保存长期偏好" : "应用偏好并更新建议"); submit.type = "submit"; form.append(hint, error, submit);
      if (!manager && current.overrides[person.key]) form.append(button("恢复长期默认", () => { delete current.overrides[person.key]; current.assignments[person.key].locked = false; current = core.recommend(adapter.roster(), recommendationConfig(), current); saveActivity(); render(); }));
      const rememberDraft = () => preferenceDrafts.set(draftKey, { pref: { mode: mode.value, coach: coach.value, targets: [...targets] }, scope: scope.value, rank: levelSelect.value ? Number(levelSelect.value) : null });
      form.addEventListener("input", rememberDraft); form.addEventListener("change", rememberDraft);
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        if (coach.value === "selected" && !targets.size) { error.textContent = "请选择至少一位愿意带的球友。"; error.hidden = false; return; }
        preferenceDrafts.delete(draftKey);
        const next = { mode: mode.value, coach: coach.value, targets: coach.value === "selected" ? [...targets] : [] };
        if (manager || scope.value === "long") { config.preferences[person.playerId] = next; saveSettings(); if (present && !manager) delete current.overrides[present.key]; }
        else current.overrides[person.key] = next;
        if (!manager) {
          const rank = levelSelect.value ? Number(levelSelect.value) : null;
          if (rank !== person.level) current.overrides[person.key] = { ...next, level: rank };
        }
        if (present) { if (!manager) current.assignments[present.key].locked = false; current = core.recommend(adapter.roster(), recommendationConfig(), current); saveActivity(); }
        adapter.toast(manager ? "长期偏好已保存" : "偏好已应用，手动锁定的其他人员保持不变"); render();
      }); host.append(form);
    }
    function setPlacement(key, courtId, position, bundleAllowed) {
      const person = current.roster.find((p) => p.key === key), old = current.assignments[key], pref = core.preference(current.overrides[key] || config.preferences[person.playerId]);
      if (courtId) { current.assignments[key] = { courtId, allowed: [courtId], locked: true }; pref.mode = pref.mode === "competitive" ? "competitive" : "fixed"; }
      else {
        const allowed = bundleAllowed ? [...bundleAllowed] : !old.courtId && old.allowed.length ? [...old.allowed] : core.courtInfo(current, config).filter((c) => !c.protected).map((c) => c.id);
        current.assignments[key] = { courtId: null, allowed: allowed.length ? allowed : current.courts.map((c) => c.id), locked: true };
        if (position) current.assignments[key].position = position; pref.mode = "roam";
      }
      const rank = current.overrides[key]?.level; current.overrides[key] = pref; if (rank !== undefined) current.overrides[key].level = rank;
      saveActivity(); render();
    }
    function arrangeLayout(kind) {
      let x = 24, y = 24, rowHeight = 0;
      const info = core.courtInfo(current, config);
      current.courts.forEach((c, index) => {
        if (kind === "vertical") { c.x = 24; c.y = y; y += info[index].height + 58; }
        else if (kind === "horizontal") { c.x = 24 + index * 278; c.y = 24; }
        else { if (index && index % 3 === 0) { x = 24; y += rowHeight + 58; rowHeight = 0; } c.x = x; c.y = y; x += 278; rowHeight = Math.max(rowHeight, info[index].height); }
      });
      for (const a of Object.values(current.assignments)) delete a.position;
      delete current.bundlePositions; saveActivity(); render(); fit();
    }
    function addCourt() {
      if (current.courts.length >= 32) return;
      const labels = new Set(current.courts.map((c) => c.label)); let label = 1; while (labels.has(String(label))) label++;
      const info = core.courtInfo(current, config), c = { id: "court-" + uuid(), label: String(label), x: 24, y: Math.max(...info.map((r) => r.y + r.height)) + 58 };
      current.courts.push(c);
      current = core.recommend(adapter.roster(), recommendationConfig(), current); saveActivity(); render(); fit();
    }
    function removeCourt(id = current.courts.at(-1).id) {
      if (current.courts.length === 1) return;
      if (!confirm("删除" + courtLabel(id) + "号场？该场固定人员会重新安排，其他手动锁定的安排保留。")) return;
      current.courts = current.courts.filter((c) => c.id !== id);
      for (const a of Object.values(current.assignments)) {
        a.allowed = a.allowed.filter((c) => c !== id);
        if (a.courtId === id) { a.courtId = null; a.locked = false; }
        if (!a.allowed.length) a.locked = false;
      }
      current = core.recommend(adapter.roster(), recommendationConfig(), current); selection = null; saveActivity(); render(); fit();
    }
    function renderManager() {
      const host = $("caSettingsPanel"); host.replaceChildren();
      const prefSection = el("section", "ca-manager-section"), groupSection = el("section", "ca-manager-section");
      prefSection.append(el("h3", "", "个人长期偏好"), el("p", "ca-hint", "长期偏好跨活动保留。本次临时调整在场地画布中完成，不修改长期默认。"));
      const search = el("input", "ca-manager-search"), selectMember = el("select", "ca-manager-search"), prefHost = el("div"); search.placeholder = "搜索成员"; search.setAttribute("aria-label", "搜索长期偏好成员"); selectMember.setAttribute("aria-label", "选择长期偏好成员");
      function memberOptions() { selectMember.replaceChildren(option("", "选择成员编辑偏好")); people().filter((p) => String(p.name).includes(search.value.trim())).forEach((p) => selectMember.append(option(p.id, name(p.id) + " · " + (p.level || "等级不详")))); selectMember.value = selectedManagerId; }
      function memberForm() { prefHost.replaceChildren(); const p = adapter.players().find((r) => Number(r.id) === Number(selectedManagerId)); if (p) renderPreferenceForm({ key: "p-" + p.id, playerId: Number(p.id), name: name(p.id), level: core.level(p.level) }, prefHost, true); }
      search.addEventListener("input", memberOptions); selectMember.addEventListener("change", () => { selectedManagerId = selectMember.value; memberForm(); }); memberOptions(); memberForm();
      const known = new Set(adapter.players().map((p) => Number(p.id)));
      const stale = [...new Set([...Object.keys(config.preferences).map(Number), ...Object.values(config.preferences).flatMap((p) => p.targets), ...config.groups.flatMap((g) => g.members)].filter((id) => !known.has(id)))];
      if (stale.length) {
        prefSection.append(el("p", "ca-notice ca-warning", "配置中有" + stale.length + "位已从成员数据库删除的球友，请清理后再保存。"), button("清理已删除成员", () => {
          if (!confirm("清理已删除成员的排场偏好和小团体关联？不足2人的小团体会移除，空的指定带人名单改为未设置。历史订场与现有成员不变。")) return;
          config.preferences = Object.fromEntries(Object.entries(config.preferences).filter(([id]) => known.has(Number(id))).map(([id, p]) => { const targets = p.targets.filter((target) => known.has(target)); return [id, { ...p, targets, coach: p.coach === "selected" && !targets.length ? "none" : p.coach }]; }));
          config.groups = config.groups.map((g) => ({ ...g, members: g.members.filter((id) => known.has(id)) })).filter((g) => g.members.length >= 2);
          saveSettings(); render();
        }));
      }
      prefSection.append(search, field("成员", selectMember), prefHost);
      groupSection.append(el("h3", "", "小团体 · 2～8人"), el("p", "ca-hint", "一个人可以属于多个小团体。小团体不强制同场，也不自动代表愿意带人。原“最佳拍档”继续用于摇人，不改变现有到场概率模型。"), button("新建小团体", () => { groupDraft = { id: uuid(), name: "", members: [] }; renderManager(); }, "primary-btn"));
      if (groupDraft) renderGroupForm(groupSection);
      const list = el("div", "ca-group-list");
      for (const g of groups()) {
        const row = el("div", "ca-group-row"), copy = el("div"), actions = el("div", "ca-actions"); copy.append(el("strong", "", g.source === "partner" ? g.members.map(name).join("／") : g.name), el("p", "", g.members.map(name).join("、")), el("small", "", g.source === "partner" ? "来自摇人中的最佳拍档 · 2人" : "手动确认 · " + g.members.length + "人"));
        actions.append(button(g.source === "partner" ? "扩展为小团体" : "编辑", () => { groupDraft = { id: g.source === "partner" ? uuid() : g.id, name: g.source === "partner" ? "" : g.name, members: [...g.members] }; renderManager(); }));
        if (g.source === "manual") actions.append(button("删除", () => { if (!confirm("删除小团体“" + g.name + "”？不会删除成员或原最佳拍档关系。")) return; config.groups = config.groups.filter((r) => r.id !== g.id); if (selectedGroup === g.id) selectedGroup = ""; saveSettings(); render(); }));
        row.append(copy, actions); list.append(row);
      }
      if (!list.childElementCount) list.append(el("p", "ca-hint", "暂无小团体，可手动选择2～8位成员创建。")); groupSection.append(list);
      const candidates = core.groupCandidates(config, adapter.partners());
      if (candidates.length) {
        groupSection.append(el("h3", "", "待确认的小团体候选"), el("p", "ca-hint", "根据相互存在的最佳拍档关系提出候选，仅供你确认；共同出勤不能证明是真实小团体，也不能判断带人意愿。"));
        for (const c of candidates) { const row = el("div", "ca-group-row"), actions = el("div", "ca-actions"); row.append(el("p", "", c.members.map(name).join("、"))); actions.append(button("确认／编辑", () => { groupDraft = { id: uuid(), name: "", members: [...c.members] }; renderManager(); }), button("忽略", () => { config.excludedCandidates.push(c.key); saveSettings(); renderManager(); })); row.append(actions); groupSection.append(row); }
      }
      host.append(prefSection, groupSection);
    }
    function renderGroupForm(host) {
      const form = el("form", "ca-group-form"), groupName = el("input"), search = el("input", "ca-manager-search"), choices = el("div", "ca-group-members"), count = el("p", "ca-hint"), error = el("p", "ca-error"), actions = el("div", "ca-actions");
      groupName.value = groupDraft.name; groupName.maxLength = 60; groupName.required = true; groupName.setAttribute("aria-label", "小团体名称"); groupName.addEventListener("input", () => { groupDraft.name = groupName.value; });
      search.placeholder = "搜索并选择2～8位成员"; search.setAttribute("aria-label", "搜索小团体成员");
      const renderChoices = () => { choices.replaceChildren(); const ids = new Set(groupDraft.members);
        people().filter((p) => String(p.name).includes(search.value.trim())).forEach((p) => choices.append(check(name(p.id) + " · " + (p.level || "不详"), ids.has(Number(p.id)), (on) => {
          if (on && groupDraft.members.length >= 8) { adapter.toast("小团体最多8人"); renderChoices(); return; }
          groupDraft.members = on ? [...groupDraft.members, Number(p.id)] : groupDraft.members.filter((id) => id !== Number(p.id)); renderChoices();
        }))); count.textContent = "已选" + groupDraft.members.length + "人：" + groupDraft.members.map(name).join("、"); };
      search.addEventListener("input", renderChoices); renderChoices(); error.setAttribute("role", "alert"); error.hidden = true;
      const submit = el("button", "primary-btn", "保存小团体"); submit.type = "submit"; actions.append(submit, button("取消", () => { groupDraft = null; renderManager(); }));
      form.append(field("小团体名称", groupName), search, choices, count, error, actions);
      form.addEventListener("submit", (e) => { e.preventDefault(); if (groupDraft.members.length < 2) { error.textContent = "请至少选择2位成员。"; error.hidden = false; return; }
        if (!groupDraft.name.trim()) { error.textContent = "请填写小团体名称。"; error.hidden = false; return; }
        const group = { ...groupDraft, name: groupDraft.name.trim() }; config.groups = [...config.groups.filter((g) => g.id !== group.id), group]; saveSettings(); groupDraft = null; render(); adapter.toast("小团体已保存"); }); host.append(form);
    }
    function beginDrag(event, type, key) {
      if (event.button !== 0 || drag) return;
      editorKey = null; renderInspector();
      const target = event.currentTarget; target.setPointerCapture(event.pointerId);
      drag = { type, key, target, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false };
      if (type === "court") { const c = current.courts.find((r) => r.id === key); drag.startCourt = { x: c.x, y: c.y }; }
      if (type === "bundle") { drag.startBundle = { x: parseFloat(target.style.left), y: parseFloat(target.style.top) }; drag.previousBundle = current.bundlePositions?.[key] ? { ...current.bundlePositions[key] } : null; }
      target.addEventListener("pointermove", moveDrag); target.addEventListener("pointerup", endDrag); target.addEventListener("pointercancel", cancelDrag);
    }
    function moveDrag(event) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
      event.preventDefault(); drag.moved = true;
      if (drag.type === "court") {
        const c = current.courts.find((r) => r.id === drag.key); c.x = Math.min(20000, Math.max(0, Math.round((drag.startCourt.x + (event.clientX - drag.startX) / zoom) / 8) * 8)); c.y = Math.min(20000, Math.max(0, Math.round((drag.startCourt.y + (event.clientY - drag.startY) / zoom) / 8) * 8));
        const n = findData(".ca-court", "court", c.id); n.style.left = c.x + "px"; n.style.top = c.y + "px"; scheduleLines();
      } else if (drag.type === "bundle") {
        setBundlePosition(drag.key, { x: drag.startBundle.x + (event.clientX - drag.startX) / zoom, y: drag.startBundle.y + (event.clientY - drag.startY) / zoom });
        drag.target.style.left = current.bundlePositions[drag.key].x + "px"; drag.target.style.top = current.bundlePositions[drag.key].y + "px"; scheduleLines();
      } else {
        if (!drag.ghost) { drag.ghost = drag.target.cloneNode(true); drag.ghost.classList.remove("ca-floating"); drag.ghost.classList.add("ca-ghost"); document.body.append(drag.ghost); drag.target.classList.add("ca-dragging"); }
        drag.ghost.style.left = event.clientX - 45 + "px"; drag.ghost.style.top = event.clientY - 18 + "px";
        const point = boardPoint(event), court = hitCourt(point), bundle = court ? null : hitBundle(point, drag.key);
        board.querySelectorAll(".ca-court, .ca-bundle, .ca-floating").forEach((n) => n.classList.toggle("ca-drop-target", n.classList.contains("ca-court") ? n.dataset.court === court?.id : n.classList.contains("ca-bundle") ? n.dataset.bundle === bundle?.key : n.dataset.person === bundle?.partnerKey));
      }
      const bounds = scroll.getBoundingClientRect(); if (event.clientX > bounds.right - 24) scroll.scrollLeft += 12; if (event.clientX < bounds.left + 24) scroll.scrollLeft -= 12; if (event.clientY > bounds.bottom - 24) scroll.scrollTop += 12; if (event.clientY < bounds.top + 24) scroll.scrollTop -= 12;
    }
    function boardPoint(event) { const r = board.getBoundingClientRect(); return { x: Math.round((event.clientX - r.left) / zoom), y: Math.round((event.clientY - r.top) / zoom) }; }
    function containsPoint(node, point) {
      if (!node) return false;
      const bounds = node.getBoundingClientRect(), origin = board.getBoundingClientRect();
      const x = (bounds.left - origin.left) / zoom, y = (bounds.top - origin.top) / zoom;
      return point.x >= x && point.x <= x + bounds.width / zoom && point.y >= y && point.y <= y + bounds.height / zoom;
    }
    function hitCourt(point) { return [...core.courtInfo(current, config)].reverse().find((c) => containsPoint(findData(".ca-court", "court", c.id), point)); }
    function nodePosition(node) { const bounds = node.getBoundingClientRect(), origin = board.getBoundingClientRect(); return { x: Math.max(0, (bounds.left - origin.left) / zoom), y: Math.max(0, (bounds.top - origin.top) / zoom) }; }
    function hitBundle(point, excludedPerson = null) {
      for (const display of flowLayout()) {
        const node = bundleSource(display.bundle.key);
        if (display.grouped.length === 1 && display.grouped[0].key === excludedPerson) continue;
        if (containsPoint(node, point)) return { ...display.bundle, position: display.position, partnerKey: display.grouped.length === 1 ? display.grouped[0].key : null };
      }
      for (const person of current.roster) {
        const assignment = current.assignments[person.key];
        if (person.key === excludedPerson || assignment.courtId || !assignment.position) continue;
        const node = findData(".ca-person", "person", person.key); if (!containsPoint(node, point)) continue;
        const key = core.bundleKey(assignment.allowed), existing = bundleSource(key);
        return { key, allowed: [...assignment.allowed], partnerKey: person.key, position: existing ? nodePosition(existing) : nodePosition(node) };
      }
      return null;
    }
    function cleanDrag() {
      if (!drag) return; const d = drag; d.ghost?.remove(); d.target.classList.remove("ca-dragging"); d.target.removeEventListener("pointermove", moveDrag); d.target.removeEventListener("pointerup", endDrag); d.target.removeEventListener("pointercancel", cancelDrag);
      try { d.target.releasePointerCapture(d.pointerId); } catch {} drag = null; board.querySelectorAll(".ca-drop-target").forEach((n) => n.classList.remove("ca-drop-target")); return d;
    }
    function endDrag(event) {
      if (!drag) return; const d = cleanDrag(); if (!d.moved) return;
      event.preventDefault(); event.stopPropagation(); suppressClickUntil = performance.now() + 350;
      if (d.type === "court" || d.type === "bundle") { saveActivity(); sizeBoard(); scheduleLines(); }
      else { const bounds = scroll.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) return;
        const point = boardPoint(event), target = hitCourt(point), bundle = target ? null : hitBundle(point, d.key); selection = { type: "person", key: d.key };
        if (bundle) { if (bundle.partnerKey) delete current.assignments[bundle.partnerKey].position; setBundlePosition(bundle.key, bundle.position); }
        setPlacement(d.key, target?.id || null, target || bundle ? undefined : { x: Math.max(0, Math.min(20000, point.x - 50)), y: Math.max(0, Math.min(20000, point.y - 20)) }, bundle?.allowed); }
    }
    function cancelDrag() {
      if (drag?.type === "court") Object.assign(current.courts.find((c) => c.id === drag.key), drag.startCourt);
      if (drag?.type === "bundle") { if (drag.previousBundle) current.bundlePositions[drag.key] = drag.previousBundle; else if (current.bundlePositions) delete current.bundlePositions[drag.key]; }
      cleanDrag(); renderBoard();
    }
    async function copy() {
      const lines = [`${activeDate} 场地安排（${current.roster.length}人／${current.courts.length}片场地）`];
      for (const c of core.courtInfo(current, config)) lines.push(`\n${c.label}号场${c.protected ? "（高手专场）" : ""}\n固定：${c.fixed.length ? c.fixed.map((p) => p.name + "（" + grade(p) + "）").join("、") : "无，流动人员补位"}`);
      const moving = current.roster.filter((p) => !current.assignments[p.key].courtId); if (moving.length) lines.push("\n流动人员：");
      moving.forEach((p) => lines.push(`${p.name}（${grade(p)}）→ ${current.assignments[p.key].allowed.map(courtLabel).join("、")}号场`));
      lines.push("\n固定人员原则上留在各自场地；流动人员按连线范围串场，现场凑齐四人。小团体偶尔一起打时，请确认双方配置与参与意愿。");
      const text = lines.join("\n");
      try { await navigator.clipboard.writeText(text); adapter.toast("场地安排已复制"); }
      catch { const input = el("textarea"); input.value = text; dialog.append(input); input.select(); const ok = document.execCommand("copy"); input.remove(); adapter.toast(ok ? "场地安排已复制" : "复制失败，请检查剪贴板权限"); }
    }
    $("caAddCourt").addEventListener("click", addCourt); $("caRemoveCourt").addEventListener("click", () => removeCourt());
    $("caRecommend").addEventListener("click", () => { if (!confirm("重新建议会更新未锁定的人员安排，场地编号、布局和手动锁定的安排保留。继续？")) return; current = core.recommend(adapter.roster(), recommendationConfig(), current); saveActivity(); render(); });
    $("caLayout").addEventListener("change", () => { const kind = $("caLayout").value; if (kind) arrangeLayout(kind); $("caLayout").value = ""; });
    $("caLineMode").addEventListener("change", () => { current.lineMode = $("caLineMode").value; saveActivity(); scheduleLines(); });
    $("caFit").addEventListener("click", fit); $("caZoom").addEventListener("change", () => { if ($("caZoom").value === "fit") fit(); else { zoom = Number($("caZoom").value); sizeBoard(); scheduleLines(); } });
    $("caGroupFilter").addEventListener("change", () => { selectedGroup = $("caGroupFilter").value; highlight(); renderInspector(); });
    $("caSettingsToggle").addEventListener("click", () => showView(tab === "board" ? "settings" : "board"));
    $("caEditPerson").addEventListener("click", () => { if (selection?.type === "person") openEditor(selection.key); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && dialog.classList.contains("open") && !dialog.inert && !inspector.hidden) { e.preventDefault(); e.stopPropagation(); closeEditor(); } }, true);
    board.addEventListener("click", (e) => { if (performance.now() < suppressClickUntil) { e.preventDefault(); e.stopPropagation(); } }, true);
    $("caRetry").addEventListener("click", async () => { errors.clear(); persist(); await refresh(); }); $("caUseCloud").addEventListener("click", () => void resolveConflict(true)); $("caKeepLocal").addEventListener("click", () => void resolveConflict(false));
    $("caCopy").addEventListener("click", () => void copy());
    board.addEventListener("click", (e) => { if (!e.target.closest(".ca-person, .ca-court, .ca-bundle")) { selection = null; editorKey = null; highlight(); renderInspector(); scheduleLines(); } });
    const resize = new ResizeObserver(() => { if (dialog.classList.contains("open") && tab === "board") { sizeBoard(); scheduleLines(); } }); resize.observe(scroll);
    new MutationObserver(() => { if (!dialog.classList.contains("open") && drag) cancelDrag(); }).observe(dialog, { attributes: true, attributeFilter: ["class"] });
    window.addEventListener("online", () => { if (activeDate) void refresh(); });
    window.addEventListener("beforeunload", (e) => { if (localError) { e.preventDefault(); e.returnValue = ""; } });
    return Object.freeze({ open, refresh: () => refresh(), getPlan: () => core.clone(current), getSettings: () => core.clone(config) });
  }
  root.BadmintonCourtArrangement = Object.freeze({ create });
})(globalThis);
