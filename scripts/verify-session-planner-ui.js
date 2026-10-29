import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import vm from "node:vm";
import "../session-planner-core.js";

const core = globalThis.BadmintonSessionPlannerCore;
const source = readFileSync(new URL("../session-planner.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const today = "2026-10-29", tomorrow = "2026-10-30", nextDay = "2026-10-31";
const key = "badminton.session-plans.v1";

// Exercise the real controller without browser dependencies, timers, or live API writes.
function createHarness({ listedName = "大白", companionOnly = false } = {}) {
  let document;
  class Element {
    constructor(tag = "div") {
      this.tagName = tag.toUpperCase(); this.className = ""; this.dataset = {};
      this.children = []; this.attributes = {}; this.listeners = {}; this.textContent = "";
    }
    get classList() {
      const element = this;
      return {
        contains(name) { return element.className.split(/\s+/).includes(name); },
        add(...names) { element.className = [...new Set([...element.className.split(/\s+/).filter(Boolean), ...names])].join(" "); },
        toggle(name, force) {
          const names = new Set(element.className.split(/\s+/).filter(Boolean));
          const on = force ?? !names.has(name);
          if (on) names.add(name); else names.delete(name);
          element.className = [...names].join(" "); return on;
        },
      };
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name]; }
    append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
    replaceChildren(...children) { this.children = []; this.append(...children); }
    replaceWith(element) {
      const parent = this.parentElement;
      parent.children[parent.children.indexOf(this)] = element; element.parentElement = parent;
    }
    querySelectorAll(selector) {
      const matches = (element) => selector.startsWith(".") ? element.classList.contains(selector.slice(1))
        : element.dataset.date === selector.match(/data-date="([^"]+)"/)?.[1]
          && String(element.dataset.slot) === selector.match(/data-slot="([^"]+)"/)?.[1];
      return this.children.flatMap((child) => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
    dispatch(type, props = {}) {
      const event = { target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...props };
      for (const callback of this.listeners[type] || []) callback(event);
      return event;
    }
    focus() { document.activeElement = this; this.dispatch("focus"); }
    select() {}
    showModal() { this.open = true; }
    close() { this.open = false; this.dispatch("close"); }
  }
  const ids = ["planSaveStatus", "sessionPlanDialog", "planGrid", "planMembers", "closeSessionPlan",
    "retryPlanSave", "useCloudPlan", "chainPlanSaveStatus", "clearPlanSlot", "editPlanSlot"];
  const elements = Object.fromEntries(ids.map((id) => [id, new Element()]));
  document = { getElementById: (id) => elements[id] || null, createElement: (tag) => new Element(tag), addEventListener() {} };
  const players = [{ id: 1, name: "Baymax/大白" }, { id: 2, name: "choi" }, { id: 3, name: "NotJoined" }, { id: 4, name: "Risky" }];
  const names = ["choi", ...Array.from({ length: 9 }, (_, i) => `Guest${i + 1}`), "Baymax"];
  const makeDay = (date, slots, fullNames = slots.filter(Boolean)) => ({ date, revision: 1,
    day: core.normalizeDay({ slots, text: fullNames.map((name, i) => `${i + 1}. ${name}`).join("\n") }) });
  const days = Object.fromEntries([makeDay(today, names.slice(0, 10), names),
    makeDay(tomorrow, ["choi", "", "", "", listedName]), makeDay(nextDay, ["choi"])].map((row) => [row.date, row]));
  const storage = new Map([[key, JSON.stringify({ version: 1, days, pending: {} })]]);
  const input = { value: days[today].day.text };
  const readNames = () => input.value.split("\n").filter(Boolean).map((line) => line.replace(/^\d+\.\s*/, ""));
  const state = { players, plusOverrides: {}, sessions: [{ date: "2026-10-28", players: players.map((p) => ({ playerId: p.id, slots: 1 })) }] };
  const context = vm.createContext({
    BadmintonSessionPlannerCore: { ...core, date: () => today }, document, window: { addEventListener() {} },
    localStorage: { getItem: (name) => storage.get(name) ?? null, setItem: (name, value) => storage.set(name, value) },
    navigator: { onLine: false }, crypto: { randomUUID }, AbortController,
    fetch: () => new Promise(() => {}), setTimeout: () => 1, clearTimeout() {}, setInterval() {}, requestAnimationFrame() {},
  });
  vm.runInContext(source, context);
  const controller = context.BadmintonSessionPlanner.create({
    state, input, process() {}, apiUrl: (path) => path, toast() {}, names: readNames, forecastChanged() {},
    forecastEntries: () => core.entries(readNames(), players).map((entry) => companionOnly && entry.playerId === 1
      ? { ...entry, playerId: null, isCompanion: true } : entry),
    signals: (playerId, date, slots) => ({ risks: playerId === 4 ? ["已请假或当天不可参加"] : [],
      reasons: playerId !== 2 && core.entries(slots, players).some((entry) => entry.playerId === 2) ? ["有最佳拍档参加"] : [] }),
  });
  controller.open();
  return { elements, state, input,
    card: (name) => elements.planMembers.children.find((element) => element.dataset.name === name),
    slot: (date, index) => elements.planGrid.querySelector(`[data-date="${date}"][data-slot="${index}"]`),
    day: (date) => { const store = JSON.parse(storage.get(key)); return (store.pending[date] || store.days[date]).day; },
  };
}

const ui = createHarness();
const select = (date, index) => ui.slot(date, index).dispatch("click");
const hasClass = (name, className) => ui.card(name).classList.contains(className);
assert.equal(hasClass("Baymax", "is-highlight"), false, "no recommendation before selecting a day");
select(tomorrow, 7);
assert.equal(hasClass("Baymax", "is-highlight"), false, "already joined via an alias must not be recommended again");
assert.equal(hasClass("Baymax", "is-dim"), true);
assert.match(ui.card("Baymax").children[1].textContent, /已在当天名单中/);
assert.equal(Boolean(ui.card("Baymax").disabled), false, "joined cards remain available for companions");
assert.equal(hasClass("NotJoined", "is-highlight"), true, "unjoined direct partners stay highlighted");
assert.equal(hasClass("Risky", "is-highlight"), false, "risk still overrides partner highlights");
assert.equal(hasClass("Risky", "is-dim"), true);
select(nextDay, 1);
assert.equal(hasClass("Baymax", "is-highlight"), true, "membership on a different date must not suppress recommendations");
select(today, 9);
assert.equal(hasClass("Baymax", "is-highlight"), false, "today's eleventh attendee is already joined too");
assert.equal(hasClass("Baymax", "is-dim"), true);

select(tomorrow, 7);
ui.card("Baymax").dispatch("click");
assert.equal(ui.day(tomorrow).slots[7], "Baymax");
assert.deepEqual(core.entries(ui.day(tomorrow).slots, ui.state.players).filter((entry) => entry.ownerPlayerId === 1)
  .map((entry) => entry.isCompanion), [false, true], "clicking a joined member still adds a companion");
select(tomorrow, 4);
assert.equal(ui.slot(tomorrow, 4).dispatch("keydown", { key: "Delete" }).defaultPrevented, false);
assert.equal(ui.day(tomorrow).slots[4], "大白", "Delete must no longer clear a slot");
assert.equal(ui.slot(tomorrow, 4).dispatch("keydown", { key: "Backspace" }).defaultPrevented, true);
assert.equal(ui.day(tomorrow).slots[4], "");
assert.equal(hasClass("Baymax", "is-highlight"), false, "another occurrence still represents attendance");
select(tomorrow, 7);
ui.slot(tomorrow, 7).dispatch("keydown", { key: "Backspace" });
assert.equal(ui.day(tomorrow).slots[7], "");
assert.equal(hasClass("Baymax", "is-highlight"), true, "clearing the final occurrence restores partner recommendations");
assert.equal(ui.slot(tomorrow, 7).getAttribute("aria-keyshortcuts"), "Enter F2 Backspace");

ui.slot(tomorrow, 7).dispatch("dblclick");
let editor = ui.elements.planGrid.querySelector(".plan-slot-editor");
editor.value = "Custom member";
assert.equal(editor.dispatch("keydown", { key: "Backspace" }).defaultPrevented, false, "text editing retains native Backspace behavior");
assert.equal(ui.day(tomorrow).slots[7], "", "typing does not clear or save the entire slot");
editor.dispatch("keydown", { key: "Enter" });
assert.equal(ui.day(tomorrow).slots[7], "Custom member");
ui.slot(tomorrow, 7).dispatch("keydown", { key: "Enter" });
editor = ui.elements.planGrid.querySelector(".plan-slot-editor"); editor.value = "Cancelled";
editor.dispatch("keydown", { key: "Escape" });
assert.equal(ui.day(tomorrow).slots[7], "Custom member", "Escape still cancels custom edits");
ui.elements.clearPlanSlot.dispatch("click");
assert.equal(ui.day(tomorrow).slots[7], "", "the clear button still works");
assert.equal(ui.input.value.split("\n").at(-1), "11. Baymax", "UI changes must preserve the full roster");

const mixedCase = createHarness({ listedName: " bAyMaX " });
mixedCase.slot(tomorrow, 7).dispatch("click");
assert.equal(mixedCase.card("Baymax").classList.contains("is-highlight"), false, "case and surrounding whitespace must resolve to the same member");
const guestOnly = createHarness({ companionOnly: true });
guestOnly.slot(today, 9).dispatch("click");
assert.equal(guestOnly.card("Baymax").classList.contains("is-highlight"), true, "a companion owner is not automatically an attendee");
assert.doesNotMatch(html, /id="planHint"|class="plan-footnote"|暗淡仅为提醒，仍可选择/);
assert.doesNotMatch(source, /planHint|点击成员填入，双击格子或按 Enter 自定义|Delete 清空/);
assert.match(html, /id="clearPlanSlot"[^>]*title="清空格子（Backspace）"/);
console.log("Session planner UI passed: joined-member highlights, aliases/case, day isolation, full roster, companions, Backspace-only clearing, custom editing, and removed hints.");
