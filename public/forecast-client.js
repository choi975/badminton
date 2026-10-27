(function (root) {
  "use strict";
  // A single in-flight job and a replaceable latest request. Never queue every keystroke.
  class LatestForecast {
    constructor({ createWorker, onResult, onError, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id) }) {
      Object.assign(this, { createWorker, onResult, onError, setTimer, clearTimer });
      this.sequence = 0; this.worker = null; this.running = null; this.latest = null; this.completedKey = "";
    }
    request(key, input, { force = false } = {}) {
      if (!force && (this.latest?.key === key || (!this.running && this.completedKey === key))) return;
      this.latest = { id: ++this.sequence, key, input };
      this.start();
    }
    start() {
      if (this.running || !this.latest) return;
      const job = this.latest;
      try {
        if (!this.worker) {
          this.worker = this.createWorker();
          this.worker.onmessage = (event) => this.receive(event.data);
          this.worker.onerror = (event) => { event.preventDefault?.(); this.fail(event.message || "后台计算不可用"); };
        }
        this.running = job;
        this.watchdog = this.setTimer(() => this.fail("后台计算超时，请稍后重试"), 60000);
        this.worker.postMessage(job);
      } catch (error) { this.fail(error.message); }
    }
    receive(data) {
      if (!this.running || data?.id !== this.running.id) return;
      this.clearTimer(this.watchdog); this.running = null;
      if (data.id === this.latest?.id) {
        this.latest = null;
        if (data.error) this.onError(data.error, data.key);
        else { this.completedKey = data.key; this.onResult(data.forecast, data.key, data.durationMs); }
      }
      this.start();
    }
    fail(message) {
      this.clearTimer(this.watchdog); this.worker?.terminate(); this.worker = null; this.running = null;
      const key = this.latest?.key; this.latest = null;
      this.onError(message, key);
    }
    cancel() {
      this.clearTimer(this.watchdog); this.worker?.terminate(); this.worker = null;
      this.running = this.latest = null; this.completedKey = ""; this.sequence++;
    }
  }
  root.BadmintonForecastClient = Object.freeze({ LatestForecast });
})(globalThis);
