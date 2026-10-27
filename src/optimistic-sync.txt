(function (root) {
  "use strict";
  const PREFIX = "badminton-outbox-v1:";
  const clone = (value) => JSON.parse(JSON.stringify(value));
  function operations(storage) {
    const rows = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      try { const row = JSON.parse(storage.getItem(key)); if (row?.id && ["rule-create", "rule-delete", "partner"].includes(row.kind)) rows.push(row); }
      catch { /* Other tabs may be completing an operation. */ }
    }
    return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.sequence - b.sequence || a.id.localeCompare(b.id));
  }
  function projectRules(confirmed, pending) {
    let rules = [...confirmed];
    for (const operation of pending) {
      if (operation.kind === "rule-create") {
        const rule = { ...operation.payload, id: "pending:" + operation.id, pendingOperationId: operation.id };
        if (rule.expiresOn) rules = rules.filter((row) => Number(row.playerId) !== Number(rule.playerId) || !row.expiresOn);
        else rules = rules.filter((row) => !(Number(row.playerId) === Number(rule.playerId) && row.type === rule.type && JSON.stringify(row.rule) === JSON.stringify(rule.rule)));
        rules.push(rule);
      } else if (operation.kind === "rule-delete") {
        rules = rules.filter((row) => operation.payload.createOperationId
          ? row.pendingOperationId !== operation.payload.createOperationId
          : String(row.id) !== String(operation.payload.ruleId));
      }
    }
    return rules;
  }
  function projectPartners(statistics, overrides, pending, players) {
    const core = root.BadmintonMemberStatistics;
    let value = core.normalizePartnerOverrides(overrides);
    const byId = new Map(players.map((player) => [Number(player.id), player]));
    const evidence = new Map((statistics?.bestPartners?.pairs || []).map((pair) => [core.partnerKey(pair.playerIds), pair]));
    const automatic = statistics?.automaticBestPartners || { ...(statistics?.bestPartners || {}), pairs: (statistics?.bestPartners?.pairs || []).filter((pair) => pair.source !== "manual") };
    const resolve = () => {
      const excluded = new Set(value.excludedPairs.map((row) => core.partnerKey(row.playerIds)));
      const pairs = new Map((automatic.pairs || []).map((pair) => [core.partnerKey(pair.playerIds), { ...pair, source: "automatic" }]));
      for (const manual of value.manualPairs) {
        if (!manual.playerIds.every((id) => byId.has(id))) continue;
        const key = core.partnerKey(manual.playerIds), known = evidence.get(key) || pairs.get(key);
        pairs.set(key, { ...(known || { playerIds: manual.playerIds, names: manual.playerIds.map((id) => String(byId.get(id).name).split(/[,，]/)[0]),
          togetherDays: 0, togetherSessions: 0, opportunityDays: 0, directions: [], score: 0, reliability: 0, pendingEvidence: true }),
          source: "manual", createdAt: manual.createdAt });
      }
      for (const key of excluded) pairs.delete(key);
      const order = new Map(value.order.map((key, index) => [key, index]));
      return [...pairs.entries()].sort(([a, left], [b, right]) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity)
        || right.score - left.score || right.togetherDays - left.togetherDays || left.playerIds[0] - right.playerIds[0] || left.playerIds[1] - right.playerIds[1]).map(([, pair]) => pair);
    };
    let pairs = resolve();
    for (const operation of pending.filter((row) => row.kind === "partner")) {
      try {
        value = core.editPartnerOverrides({ overrides: value, pairs, players, ...operation.payload, now: operation.createdAt });
        pairs = resolve();
      } catch { /* A newer authoritative response can already satisfy an optimistic intent. */ }
    }
    return { overrides: value, bestPartners: { ...automatic, version: "best-partners-v2", pairs, revision: value.revision } };
  }

  class Outbox {
    constructor({ storage, send, prepare = (row) => row, onChange = () => {}, onCommit = () => {}, onReject = () => {}, canSend = () => true,
      locks = null, now = () => Date.now(), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id), randomId = () => root.crypto.randomUUID() }) {
      Object.assign(this, { storage, send, prepare, onChange, onCommit, onReject, canSend, locks, now, setTimer, clearTimer, randomId });
      this.running = false; this.sequence = 0; this.retryAt = 0; this.timer = null; this.destroyed = false;
    }
    list() { return operations(this.storage); }
    enqueue(kind, payload, label) { return this.enqueueMany([{ kind, payload, label }])[0]; }
    enqueueMany(items) {
      const rows = items.map(({ kind, payload, label }) => ({ id: this.randomId(), kind, payload: clone(payload), label,
        createdAt: new Date(this.now()).toISOString(), sequence: ++this.sequence, attempts: 0 }));
      const written = [];
      try { for (const row of rows) { this.storage.setItem(PREFIX + row.id, JSON.stringify(row)); written.push(row.id); } }
      catch (error) { written.forEach((id) => this.storage.removeItem(PREFIX + id)); throw error; }
      this.onChange(this.list()); this.kick(); return rows;
    }
    kick(delay = 0) {
      if (this.destroyed) return;
      this.clearTimer(this.timer);
      this.timer = this.setTimer(() => { this.timer = null; void this.flush(); }, delay);
    }
    async flush() {
      if (this.destroyed || this.running || !this.canSend()) return;
      this.running = true;
      const drain = async () => {
        while (!this.destroyed && this.canSend()) {
          let row = this.list()[0]; if (!row) break;
          if (row.nextAttemptAt > this.now()) { this.kick(row.nextAttemptAt - this.now()); break; }
          try {
            // Freeze an exact request for retries, especially relative partner moves.
            if (!row.request) {
              row = { ...row, request: await this.prepare(row) };
              this.storage.setItem(PREFIX + row.id, JSON.stringify(row));
            }
            const response = await this.send(row.request);
            await this.onCommit(response, row);
            this.storage.removeItem(PREFIX + row.id);
            this.onChange(this.list());
          } catch (error) {
            if (error.status >= 400 && error.status < 500 && ![408, 425, 429].includes(error.status)) {
              await this.onReject(error, row);
              this.storage.removeItem(PREFIX + row.id);
              this.onChange(this.list());
              continue;
            }
            row.attempts = (row.attempts || 0) + 1;
            row.nextAttemptAt = this.now() + Math.min(30000, 1000 * 2 ** Math.min(row.attempts, 5));
            row.lastError = String(error.message || "网络不可用");
            try { this.storage.setItem(PREFIX + row.id, JSON.stringify(row)); }
            catch { /* The already-persisted operation remains recoverable. */ }
            this.onChange(this.list()); this.kick(row.nextAttemptAt - this.now()); break;
          }
        }
      };
      try {
        // One dispatcher across tabs; receipt IDs also protect duplicate dispatch on older browsers.
        if (this.locks?.request) await this.locks.request("badminton-outbox-dispatch-v1", drain);
        else await drain();
      } finally { this.running = false; }
    }
    resume() {
      for (const row of this.list()) { row.nextAttemptAt = 0; this.storage.setItem(PREFIX + row.id, JSON.stringify(row)); }
      this.kick();
    }
    destroy() { this.destroyed = true; this.clearTimer(this.timer); }
  }
  root.BadmintonOptimisticSync = Object.freeze({ PREFIX, Outbox, operations, projectRules, projectPartners });
})(globalThis);
