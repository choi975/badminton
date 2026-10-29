(function (root) {
  "use strict";
  const core = root.BadmintonSessionPlannerCore, KEY = "badminton.session-plans.v1";
  const clone = (v) => JSON.parse(JSON.stringify(v));
  function create(adapter) {
    const { state, input, process, apiUrl, toast } = adapter;
    let store;
    try { store = JSON.parse(localStorage.getItem(KEY) || "null"); } catch {}
    if (!store || store.version !== 1) store = { version: 1, days: {}, pending: {} };
    let activeDate = core.date(), applying = false, syncing = false, ready = false, timer, selectedSlot = null, selectedMember = null, activeTooltip = null;
    let sendingDate, focusBefore, conflict = null, saveError = "", localError = false;
    const status = document.getElementById("planSaveStatus"), dialog = document.getElementById("sessionPlanDialog");
    const grid = document.getElementById("planGrid"), cards = document.getElementById("planMembers");
    const closeBtn = document.getElementById("closeSessionPlan"), retry = document.getElementById("retryPlanSave"), remote = document.getElementById("useCloudPlan");
    const getRow = (date) => store.pending[date] || store.days[date];
    const getDay = (date) => core.normalizeDay(getRow(date)?.day);
    function persist() {
      try { localStorage.setItem(KEY, JSON.stringify(store)); localError = false; }
      catch { localError = true; }
      renderStatus();
    }
    function renderStatus() {
      const n = Object.keys(store.pending).length;
      status.textContent = localError ? "本机备份失败，请勿关闭页面" : conflict ? "云端有更新，本机草稿已保留" : saveError ? "已存本机，云端待重试" : n ? "已存本机，正在同步…" : ready ? "已自动保存到云端" : "正在读取云端名单…";
      status.dataset.error = String(Boolean(localError || conflict || saveError));
      retry.hidden = !(conflict || saveError); retry.textContent = conflict ? "保留本机修改" : "重试同步";
      remote.hidden = !conflict;
      document.getElementById("chainPlanSaveStatus").textContent = status.textContent;
    }
    function queue(date, day) {
      day = core.normalizeDay(day);
      if (core.equal(getDay(date), day) && getRow(date)) return;
      const base = store.pending[date] || store.days[date];
      store.pending[date] = { revision: base?.revision || 0, day, mutationId: crypto.randomUUID() };
      persist(); clearTimeout(timer); timer = setTimeout(sync, 550);
    }
    function capture() {
      if (applying || state.pendingSessionEdit || !state.chainInputUserOwned) return;
      queue(activeDate, { text: input.value, plusOverrides: state.plusOverrides, slots: adapter.names().slice(0, 10) });
      if (dialog.open) render();
    }
    function applyToday() {
      if (state.pendingSessionEdit) return;
      const row = getRow(activeDate);
      if (input.value === (row ? getDay(activeDate).text : "") && JSON.stringify(state.plusOverrides) === JSON.stringify(row ? getDay(activeDate).plusOverrides : {})) return;
      applying = true;
      input.value = row ? getDay(activeDate).text : "";
      state.plusOverrides = row ? clone(getDay(activeDate).plusOverrides) : {};
      // Loading a plan is not a real sign-up observation for model training.
      state.chainInputUserOwned = false;
      process(); applying = false;
    }
    async function request(options) {
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch(apiUrl("/api/session-plans"), { cache: "no-store", ...options, signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw Object.assign(new Error(data.error || "同步失败"), { status: response.status, data });
        return data;
      } finally { clearTimeout(timeout); }
    }
    async function sync() {
      if (syncing || !ready || conflict || !navigator.onLine) return;
      syncing = true; saveError = ""; renderStatus();
      try {
        for (const date of Object.keys(store.pending).sort()) {
          if (date < core.addDays(core.date(), -7) || date > core.addDays(core.date(), 6)) continue;
          sendingDate = date;
          const pending = clone(store.pending[date]);
          const data = await request({ method: "POST", headers: { "content-type": "text/plain;charset=UTF-8" }, body: JSON.stringify({ date, ...pending }) });
          store.days[date] = data.saved;
          if (store.pending[date]?.mutationId === pending.mutationId) delete store.pending[date];
          else if (store.pending[date]) store.pending[date].revision = data.saved.revision;
          persist();
        }
      } catch (error) {
        if (error.status === 409) conflict = { date: sendingDate, current: error.data.current };
        saveError = error.message;
      } finally {
        syncing = false; persist();
        if (Object.keys(store.pending).length && !conflict) { clearTimeout(timer); timer = setTimeout(sync, 15000); }
      }
    }
    async function refresh() {
      if (syncing) return;
      try {
        const data = await request({ method: "GET" });
        for (const row of data.days || []) if (!store.days[row.date] || row.revision >= store.days[row.date].revision) store.days[row.date] = row;
        ready = true; saveError = ""; persist();
        if (!state.pendingSessionEdit && !store.pending[activeDate]) applyToday();
        adapter.forecastChanged(); if (dialog.open) render(); void sync();
      } catch (error) {
        saveError = error.message; renderStatus();
        // A failed initial read must never allow an offline draft to overwrite an unknown remote revision.
      }
    }
    function rollover() {
      const next = core.date(); if (next === activeDate) return;
      activeDate = next; selectedSlot = selectedMember = null; applyToday(); if (dialog.open) render();
      void refresh();
    }
    function plannedEntries() {
      const days = {};
      for (const d of [...new Set([...core.dates(activeDate), ...Object.keys(store.days), ...Object.keys(store.pending)])].filter((d) => d >= core.addDays(activeDate, -7) && d <= core.addDays(activeDate, 6))) days[d] = core.entries(getDay(d).slots, state.players);
      // Today's full roster, not merely its first ten slots, participates in the model.
      days[activeDate] = adapter.forecastEntries();
      return days;
    }
    function edit(date, index, name) {
      const day = getDay(date); day.slots[index] = name.trim().slice(0, 100);
      if (date === activeDate) {
        const tail = adapter.names().slice(10);
        const names = [...day.slots.filter(Boolean), ...tail];
        day.slots = names.slice(0, 10);
        day.text = names.map((n, i) => `${i + 1}. ${n}`).join("\n");
        day.plusOverrides = {};
      } else day.text = day.slots.filter(Boolean).map((n, i) => `${i + 1}. ${n}`).join("\n");
      queue(date, day);
      if (date === activeDate) { applyToday(); state.chainInputUserOwned = true; }
      adapter.forecastChanged(); render();
      grid.querySelector(`[data-date="${date}"][data-slot="${index}"]`)?.focus();
    }
    function add(date, name) {
      const index = getDay(date).slots.findIndex((s) => !s);
      if (index < 0) { toast("当天十个计划格已满，请先清空或替换"); return; }
      edit(date, index, name);
    }
    function startEditor(date, index) {
      selectedMember = null; selectedSlot = { date, index }; renderCards();
      const button = grid.querySelector(`[data-date="${date}"][data-slot="${index}"]`);
      if (!button) return;
      const editor = document.createElement("input"); editor.className = "plan-slot-editor"; editor.maxLength = 100;
      editor.value = getDay(date).slots[index]; editor.setAttribute("aria-label", `${core.label(date)}第${index + 1}格成员名`);
      button.replaceWith(editor); editor.focus(); editor.select(); let done = false;
      function finish(save) { if (done) return; done = true; if (save) edit(date, index, editor.value); else render(); }
      editor.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); finish(true); } if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); } });
      editor.addEventListener("blur", () => finish(true));
    }
    function positionMemberTooltip(button, tooltip) {
      if (tooltip.dataset.open !== "true") return;
      const rect = button.getBoundingClientRect();
      const width = tooltip.offsetWidth || 240;
      const height = tooltip.offsetHeight || 32;
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      const above = rect.top >= height + 12;
      const top = above ? rect.top - height - 8 : Math.min(window.innerHeight - height - 8, rect.bottom + 8);
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${Math.max(8, top)}px`;
    }

    function renderCards() {
      activeTooltip = null;
      cards.replaceChildren();
      const members = core.recentMembers(state.players, state.sessions, activeDate), target = selectedSlot?.date;
      const planned = target ? plannedEntries() : {}, slots = target ? getDay(target).slots : [];
      // Use the full roster for today, including members beyond its ten visible slots.
      const joinedIds = new Set((planned[target] || []).filter((entry) => !entry.isCompanion)
        .map((entry) => Number(entry.playerId)).filter(Boolean));
      if (!members.length) { const empty = document.createElement("p"); empty.textContent = "近15天暂无实际出勤成员，双击上方格子可自定义填写。"; cards.append(empty); }
      for (const member of members) {
        const button = document.createElement("button"); button.type = "button"; button.className = "plan-member";
        const name = String(member.name).split(/[、,，;；/|\n]+/)[0].trim(); button.dataset.name = name;
        const joined = joinedIds.has(Number(member.id));
        const signal = target ? adapter.signals(member.id, target, slots, planned) : { reasons: [], risks: [] };
        if (joined || signal.risks.length) button.classList.add("is-dim"); else if (signal.reasons.length) button.classList.add("is-highlight");
        button.classList.toggle("is-selected", selectedMember === name); button.setAttribute("aria-pressed", String(selectedMember === name));
        const tags = [`近15天实际出勤：${member.attendance15}次`, ...(joined ? ["已在当天名单中"] : []), ...signal.risks, ...signal.reasons];
        const tooltipId = `plan-member-tooltip-${member.id}`;
        button.setAttribute("aria-label", name);
        button.setAttribute("aria-describedby", tooltipId);
        const title = document.createElement("span"); title.className = "plan-member-name"; title.textContent = name;
        const tooltip = document.createElement("span"); tooltip.id = tooltipId; tooltip.className = "plan-member-tooltip"; tooltip.setAttribute("role", "tooltip"); tooltip.textContent = tags.join(" · ");
        button.append(title, tooltip);
        const showTooltip = () => {
          if (activeTooltip && activeTooltip.tooltip !== tooltip) delete activeTooltip.tooltip.dataset.open;
          activeTooltip = { button, tooltip };
          tooltip.dataset.open = "true";
          requestAnimationFrame(() => positionMemberTooltip(button, tooltip));
        };
        const hideTooltip = () => {
          if (activeTooltip?.tooltip === tooltip) activeTooltip = null;
          delete tooltip.dataset.open;
        };
        button.addEventListener("mouseenter", showTooltip);
        button.addEventListener("mouseleave", hideTooltip);
        button.addEventListener("focus", showTooltip);
        button.addEventListener("blur", hideTooltip);
        button.addEventListener("click", () => {
          if (selectedSlot) { const { date, index } = selectedSlot; selectedSlot = null; selectedMember = null; edit(date, index, name); }
          else { selectedMember = selectedMember === name ? null : name; renderCards(); }
        });
        cards.append(button);
      }
    }
    function render() {
      grid.replaceChildren();
      for (const date of core.dates(activeDate)) {
        const row = document.createElement("div"); row.className = "plan-day";
        const dateBtn = document.createElement("button"); dateBtn.type = "button"; dateBtn.className = "plan-date"; dateBtn.dataset.planDate = date;
        const dayName = document.createElement("strong"); dayName.textContent = core.label(date, activeDate);
        const dateText = document.createElement("small"); dateText.textContent = date.slice(5).replace("-", "/"); dateBtn.append(dayName, dateText);
        dateBtn.setAttribute("aria-label", `${date} ${core.label(date)}${selectedMember ? "添加" + selectedMember : "选择日期"}`);
        dateBtn.addEventListener("click", () => { if (selectedMember) add(date, selectedMember); else { selectedSlot = { date, index: getDay(date).slots.findIndex((s) => !s) }; if (selectedSlot.index < 0) selectedSlot.index = 0; render(); } });
        row.append(dateBtn);
        getDay(date).slots.forEach((name, index) => {
          const slot = document.createElement("button"); slot.type = "button"; slot.className = "plan-slot"; slot.dataset.date = date; slot.dataset.slot = index;
          slot.textContent = name || String(index + 1); slot.classList.toggle("is-empty", !name);
          const selected = selectedSlot?.date === date && selectedSlot.index === index;
          slot.classList.toggle("is-selected", selected); slot.setAttribute("aria-pressed", String(selected));
          slot.setAttribute("aria-label", `${date}第${index + 1}格：${name || "空，双击自定义"}`);
          slot.addEventListener("click", () => { selectedMember = null; selectedSlot = { date, index }; grid.querySelectorAll(".plan-slot").forEach((s) => { const on = s === slot; s.classList.toggle("is-selected", on); s.setAttribute("aria-pressed", String(on)); }); renderCards(); });
          slot.setAttribute("aria-keyshortcuts", "Enter F2 Backspace");
          slot.addEventListener("dblclick", () => startEditor(date, index));
          slot.addEventListener("keydown", (e) => { if (["Enter", "F2"].includes(e.key)) { e.preventDefault(); startEditor(date, index); } else if (e.key === "Backspace") { e.preventDefault(); edit(date, index, ""); } });
          row.append(slot);
        });
        grid.append(row);
      }
      renderCards(); renderStatus();
    }
    function open() { rollover(); selectedSlot = selectedMember = null; focusBefore = document.activeElement; render(); if (!dialog.open) dialog.showModal(); void refresh(); }
    closeBtn.addEventListener("click", () => dialog.close());
    document.getElementById("clearPlanSlot").addEventListener("click", () => { if (selectedSlot) edit(selectedSlot.date, selectedSlot.index, ""); else toast("请先选择要清空的格子"); });
    document.getElementById("editPlanSlot").addEventListener("click", () => { if (selectedSlot) startEditor(selectedSlot.date, selectedSlot.index); else toast("请先选择要自定义的格子"); });
    dialog.addEventListener("close", () => { selectedMember = selectedSlot = null; focusBefore?.focus(); });
    dialog.addEventListener("click", (event) => { if (selectedMember && !event.target.closest(".plan-member, .plan-date")) { selectedMember = null; renderCards(); } if (event.target === dialog) dialog.close(); });
    retry.addEventListener("click", () => {
      if (conflict) {
        if (!confirm("云端名单已被其他设备修改。确定用本机草稿替换这一天的云端名单吗？")) return;
        const pending = store.pending[conflict.date]; if (pending) { pending.revision = conflict.current?.revision || 0; pending.mutationId = crypto.randomUUID(); }
        conflict = null; saveError = ""; persist();
      }
      if (!ready) void refresh(); else void sync();
    });
    remote.addEventListener("click", () => { if (!conflict) return; const date = conflict.date; delete store.pending[date]; if (conflict.current) store.days[date] = conflict.current; conflict = null; saveError = ""; persist(); if (date === activeDate) applyToday(); adapter.forecastChanged(); render(); void sync(); });
    window.addEventListener("online", () => void refresh());
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { rollover(); void refresh(); } });
    window.addEventListener("storage", (e) => { if (e.key === KEY && !Object.keys(store.pending).length) { try { const next = JSON.parse(e.newValue); if (next?.version === 1) { store = next; applyToday(); if (dialog.open) render(); } } catch {} } });
    window.addEventListener("resize", () => { if (activeTooltip) positionMemberTooltip(activeTooltip.button, activeTooltip.tooltip); });
    window.addEventListener("scroll", () => { if (activeTooltip) positionMemberTooltip(activeTooltip.button, activeTooltip.tooltip); }, true);
    setInterval(() => { rollover(); if (document.visibilityState === "visible") void refresh(); }, 30000);
    applyToday(); void refresh();
    return { capture, open, rollover, plannedEntries, refresh, restoreToday: applyToday, key: () => JSON.stringify(plannedEntries()), renderIfOpen: () => { if (dialog.open) renderCards(); } };
  }
  root.BadmintonSessionPlanner = Object.freeze({ create });
})(globalThis);
