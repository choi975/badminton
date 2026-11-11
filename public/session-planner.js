(function (root) {
  "use strict";
  const core = root.BadmintonSessionPlannerCore, KEY = "badminton.session-plans.v1";
  const clone = (v) => JSON.parse(JSON.stringify(v));
  function create(adapter) {
    const { state, input, process, apiUrl, toast } = adapter;
    let store;
    try { store = JSON.parse(localStorage.getItem(KEY) || "null"); } catch {}
    if (!store || store.version !== 1) store = { version: 1, days: {}, pending: {} };
    let calendarToday = core.date();
    let activeDate = core.validDate(store.selectedDate) ? store.selectedDate : calendarToday;
    state.chainActivityDate = activeDate;
    let applying = false, syncing = false, ready = false, timer, selectedSlot = null, selectedMember = null, activeTooltip = null;
    let sendingDate, focusBefore, conflict = null, saveError = "", localError = false;
    let selectionVersion = 0, selecting = 0;
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
      status.textContent = localError ? "本机备份失败，请勿关闭页面" : conflict ? conflict.date + " 的云端有更新，本机草稿已保留" : saveError ? "已存本机，云端待重试" : n ? "已存本机，正在同步…" : ready ? "已自动保存到云端" : "正在读取云端名单…";
      status.dataset.error = String(Boolean(localError || conflict || saveError));
      retry.hidden = !(conflict || saveError); retry.textContent = conflict ? "保留本机修改" : "重试同步";
      remote.hidden = !conflict;
      const chainStatus = document.getElementById("chainPlanSaveStatus");
      const chainDate = state.pendingSessionEdit?.date || activeDate;
      chainStatus.textContent = state.pendingSessionEdit?.id ? "正在编辑订场记录，确认后保存"
        : localError ? "本机备份失败，请勿关闭页面"
        : store.unassigned?.date === chainDate ? "已存本机，整理名单后确认活动日期"
        : status.textContent;
      chainStatus.dataset.error = status.dataset.error;
      const chainRetry = document.getElementById("chainPlanRetryBtn");
      if (chainRetry) chainRetry.hidden = Boolean(state.pendingSessionEdit?.id) || !(conflict || saveError);
    }
    function queue(date, day) {
      day = core.normalizeDay(day);
      if (core.equal(getDay(date), day) && getRow(date)) return;
      const base = store.pending[date] || store.days[date];
      store.pending[date] = { revision: base?.revision || 0, day, mutationId: crypto.randomUUID() };
      persist(); clearTimeout(timer); timer = setTimeout(sync, 550);
    }
    function capture() {
      if (applying || state.pendingSessionEdit?.id || !state.chainInputUserOwned) return;
      const date = state.pendingSessionEdit?.date || activeDate;
      const day = core.normalizeDay({ text: input.value, plusOverrides: state.plusOverrides, slots: adapter.names().slice(0, 10) });
      if (adapter.deferActivityDate?.()) {
        // Keep a pasted historical activity locally until its date is explicitly accepted.
        // The previous day's cloud draft and revision are deliberately left untouched.
        store.unassigned = { date, day };
        persist();
        return;
      }
      if (store.unassigned?.date === date) delete store.unassigned;
      queue(date, day);
      if (dialog.open) render();
    }
    function applyToday() {
      if (state.pendingSessionEdit) return;
      const staged = store.unassigned?.date === activeDate;
      const day = staged ? core.normalizeDay(store.unassigned.day) : getDay(activeDate);
      const confirmed = !staged && Boolean(getRow(activeDate));
      if (input.value === day.text && JSON.stringify(state.plusOverrides) === JSON.stringify(day.plusOverrides)) {
        adapter.dateChanged?.(activeDate, { confirmed });
        return;
      }
      applying = true;
      try {
        input.value = day.text;
        state.plusOverrides = clone(day.plusOverrides);
        adapter.dateChanged?.(activeDate, { confirmed });
        // Loading a plan is not a real sign-up observation for model training.
        state.chainInputUserOwned = false;
        process();
      } finally { applying = false; }
    }
    async function request(options, date = null) {
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const path = "/api/session-plans" + (date ? "?date=" + encodeURIComponent(date) : "");
        const response = await fetch(apiUrl(path), { cache: "no-store", ...options, signal: controller.signal });
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
          if (!core.validDate(date)) continue;
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
        const requestedDate = state.pendingSessionEdit?.date || activeDate;
        const data = await request({ method: "GET" }, requestedDate);
        for (const row of data.days || []) if (!store.days[row.date] || row.revision >= store.days[row.date].revision) store.days[row.date] = row;
        ready = true; saveError = ""; persist();
        if (!selecting && requestedDate === activeDate && !state.pendingSessionEdit && !store.pending[activeDate] && !store.unassigned) applyToday();
        adapter.forecastChanged(); if (dialog.open) render(); void sync();
      } catch (error) {
        saveError = error.message; renderStatus();
        // A failed initial read must never allow an offline draft to overwrite an unknown remote revision.
      }
    }
    async function selectDate(date, { day, expectedInput = input.value, canApply = () => true } = {}) {
      if (!core.validDate(date)) return false;
      const version = ++selectionVersion, previous = activeDate;
      selecting++;
      try {
        if (date !== activeDate) {
          try {
            const data = await request({ method: "GET" }, date);
            for (const row of data.days || []) if (!store.days[row.date] || row.revision >= store.days[row.date].revision) store.days[row.date] = row;
            ready = true; saveError = "";
          } catch (error) {
            // Offline selection is safe: unknown remote rows still use revision zero and cannot be overwritten.
            saveError = error.message;
          }
        }
        if (version !== selectionVersion || previous !== activeDate || !canApply()) { persist(); return false; }
        if (input.value !== expectedInput) { persist(); toast("名单已发生变化，请重新选择活动日期"); return false; }
        if (date !== activeDate) {
          const current = getDay(date);
          const replacement = day || core.normalizeDay({ text: input.value, plusOverrides: state.plusOverrides, slots: adapter.names().slice(0, 10) });
          if ((current.text.trim() || current.slots.some(Boolean)) && !core.equal(current, replacement)
            && !confirm(date + " 已有报名草稿。是否用当前名单替换这一天的草稿？已有订场记录不会改动。")) {
            persist(); return false;
          }
        }
        activeDate = date;
        store.selectedDate = date === core.date() ? null : date;
        state.chainActivityDate = date;
        delete store.unassigned;
        persist(); adapter.dateChanged?.(date, { confirmed: true }); adapter.forecastChanged();
        return true;
      } finally { selecting--; }
    }
    function restoreToday() {
      selectionVersion++;
      activeDate = core.date(); store.selectedDate = null; state.chainActivityDate = activeDate;
      applyToday(); persist(); adapter.forecastChanged();
    }
    function rollover() {
      const next = core.date(); if (next === calendarToday) return;
      calendarToday = next;
      if (store.unassigned && !store.selectedDate) { store.selectedDate = activeDate; persist(); }
      if (!store.selectedDate && !store.unassigned && !state.pendingSessionEdit) {
        selectionVersion++; activeDate = next; state.chainActivityDate = next; applyToday();
      }
      selectedSlot = selectedMember = null; if (dialog.open) render();
      void refresh();
    }
    function plannedEntries() {
      const days = {};
      const start = core.addDays(calendarToday, -7), end = core.addDays(calendarToday, 6);
      for (const d of [...new Set([...core.dates(calendarToday), ...Object.keys(store.days), ...Object.keys(store.pending)])].filter((d) => d >= start && d <= end)) days[d] = core.entries(getDay(d).slots, state.players);
      // Only the selected day's full roster belongs to that date; historical imports never become today's sign-ups.
      if (!state.pendingSessionEdit && !adapter.deferActivityDate?.() && activeDate >= start && activeDate <= end) days[activeDate] = adapter.forecastEntries();
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
      const members = core.recentMembers(state.players, state.sessions, calendarToday), target = selectedSlot?.date;
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
      for (const date of core.dates(calendarToday)) {
        const row = document.createElement("div"); row.className = "plan-day";
        const dateBtn = document.createElement("button"); dateBtn.type = "button"; dateBtn.className = "plan-date"; dateBtn.dataset.planDate = date;
        const dayName = document.createElement("strong"); dayName.textContent = core.label(date, calendarToday);
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
    document.getElementById("chainPlanRetryBtn")?.addEventListener("click", open);
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
    return { capture, open, rollover, plannedEntries, refresh, selectDate, restoreToday, key: () => JSON.stringify(plannedEntries()), renderIfOpen: () => { if (dialog.open) renderCards(); } };
  }
  root.BadmintonSessionPlanner = Object.freeze({ create });
})(globalThis);
