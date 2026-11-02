(function attachSessionSave(root) {
  "use strict";
  const STORAGE_KEY = "badminton-session-save-pending-v1";
  const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    return value;
  }
  const fingerprint = body => JSON.stringify(canonical(body));
  function createClient({ api, storage, requestId = () => crypto.randomUUID() }) {
    const inFlight = new Map();
    let entries;
    function load() {
      if (entries) return;
      try {
        const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || "[]");
        if (!Array.isArray(parsed) || parsed.some(item => !ID.test(item.requestId) || typeof item.path !== "string" || !item.body)) throw new Error("invalid_pending_save");
        entries = parsed;
      } catch { throw new Error("无法读取订场重试记录，请检查浏览器存储；未提交本次保存"); }
    }
    function persist() {
      try { storage.setItem(STORAGE_KEY, JSON.stringify(entries)); }
      catch { throw new Error("无法保存订场重试记录，请检查浏览器存储；未提交本次保存"); }
    }
    function acknowledge(entry) {
      entries = entries.filter(item => item.requestId !== entry.requestId);
      // Never turn a confirmed server commit into a displayed save failure.
      try { persist(); } catch (cause) { console.warn("Session saved; local receipt cleanup pending", cause.message); }
    }
    async function dispatch(entry) {
      try {
        const data = await api(entry.path, { method: entry.path === "/api/sessions" ? "POST" : "PATCH", timeout: 60000,
          body: JSON.stringify({ ...entry.body, requestId: entry.requestId }) });
        if (!data?.session?.id) throw Object.assign(new Error("订场保存响应不完整"), { code: "INVALID_RESPONSE" });
        acknowledge(entry); return data;
      } catch (cause) {
        if (!cause.status || cause.status >= 500 || cause.status === 408) {
          try {
            const saved = await api("/api/session-save-receipts/" + entry.requestId, { timeout: 12000 });
            if (saved?.session?.id) { acknowledge(entry); return { ...saved, recovered: true }; }
          } catch { /* Still unknown, so retain the exact original request for the next attempt. */ }
          throw Object.assign(new Error("订场保存结果暂未确认，记录可能已保存。请保持原内容重试；重试不会重复记录或扣款。"), { code: "SAVE_UNCONFIRMED", cause });
        }
        if ([400, 401, 403, 404, 422].includes(cause.status)) acknowledge(entry);
        throw cause;
      }
    }
    async function save(path, body) {
      if (inFlight.has(path)) return inFlight.get(path);
      const operation = (async () => {
        load();
        let entry = entries.find(item => item.path === path);
        if (entry && fingerprint(entry.body) !== fingerprint(body)) {
          const data = await dispatch(entry);
          throw Object.assign(new Error("上次订场记录已保存；当前修改尚未提交。现在可以编辑这条已保存的记录，不会另建重复记录。"), { code: "PREVIOUS_SESSION_SAVED", data });
        }
        if (!entry) {
          entry = { path, body: JSON.parse(JSON.stringify(body)), requestId: requestId() };
          if (!ID.test(entry.requestId)) throw new Error("无法生成订场保存编号，未提交保存");
          entries.push(entry);
          try { persist(); } catch (cause) { entries = entries.filter(item => item !== entry); throw cause; }
        }
        return dispatch(entry);
      })();
      inFlight.set(path, operation);
      try { return await operation; } finally { inFlight.delete(path); }
    }
    return { save };
  }
  root.BadmintonSessionSave = Object.freeze({ createClient, fingerprint, STORAGE_KEY });
})(globalThis);
