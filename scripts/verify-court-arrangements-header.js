import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const ui = readFileSync(new URL("../court-arrangement.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../court-arrangement.css", import.meta.url), "utf8");
assert.doesNotMatch(ui, /ca-court-grip/); assert.doesNotMatch(css, /ca-court-grip/);
assert.match(ui, /title\.append\(input, el\("span", "ca-court-label", "号场"\), level, remove\)/);
assert.match(ui, /head\.addEventListener\("pointerdown",.*!e.target.closest\("input, button"\).*beginDrag/);
assert.match(ui, /head\.addEventListener\("keydown",[\s\S]*?if \(e.target !== head\) return/);
assert.match(ui, /window.addEventListener\("blur", cancelDrag\)/);
assert.match(ui, /function renderBoard\(\) \{\s*if \(drag\) cancelDrag\(null, false\)/);
assert.match(css, /\.ca-court-head\s*\{[^}]*touch-action: none;[^}]*user-select: none/);
assert.match(css, /\.ca-court-head input\s*\{[^}]*user-select: text/);
assert.match(css, /\.ca-court-head:focus-visible/);
const functions = ["beginDrag", "moveDrag", "cleanDrag", "endDrag", "cancelDrag"].map((name) => {
  const start = ui.indexOf("    function " + name + "("); assert.ok(start >= 0, name);
  const rest = ui.slice(start + 1), next = /\n    (?:async )?function \w+\(/.exec(rest);
  assert.ok(next, "End of " + name); return ui.slice(start, start + 1 + next.index);
}).join("\n");
function fixture() {
  let now = 0, nextId = 0; const timers = new Map(), handlers = new Map(), classes = new Set();
  const calls = { saves: 0, render: 0, lines: 0, inspector: 0 };
  const node = { style: {}, isConnected: true, capture: null,
    classList: { add: (...values) => values.forEach((v) => classes.add(v)), remove: (...values) => values.forEach((v) => classes.delete(v)), contains: (v) => classes.has(v) },
    setPointerCapture(id) { this.capture = id; }, releasePointerCapture() { this.capture = null; },
    addEventListener: (type, handler) => handlers.set(type, handler), removeEventListener: (type) => handlers.delete(type),
  };
  const context = vm.createContext({ drag: null, editorKey: "p-1", bundleDraft: null, tab: "board", zoom: 1, suppressClickUntil: 0, COURT_HOLD_MS: 350,
    current: { courts: [{ id: "court-1", label: "7", x: 24, y: 24 }], assignments: { "p-1": { courtId: "court-1", allowed: ["court-1"], locked: true } } },
    dialog: { classList: { contains: () => context.open } }, open: true,
    board: { querySelectorAll: () => [] }, scroll: { getBoundingClientRect: () => ({ left: 0, top: 0, right: 1000, bottom: 1000 }), scrollLeft: 0, scrollTop: 0 },
    performance: { now: () => now },
    setTimeout(fn, delay) { const id = ++nextId; timers.set(id, { time: now + delay, fn }); return id; }, clearTimeout: (id) => timers.delete(id),
    renderInspector: () => calls.inspector++, renderBoard: () => calls.render++, scheduleLines: () => calls.lines++,
    saveActivity: () => calls.saves++, sizeBoard: () => {}, findData: () => node,
  });
  vm.runInContext(functions, context);
  const event = (x = 100, y = 100, extra = {}) => ({ button: 0, isPrimary: true, pointerId: 1, clientX: x, clientY: y, currentTarget: node, target: { closest: () => null },
    prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...extra });
  const advance = (ms) => { now += ms; for (const [id, timer] of [...timers]) if (timer.time <= now) { timers.delete(id); timer.fn(); } };
  return { context, node, classes, calls, timers, handlers, event, advance, start: () => context.beginDrag(event(), "court", "court-1") };
}
let f = fixture();
f.context.beginDrag(f.event(100, 100, { button: 2 }), "court", "court-1");
f.context.beginDrag(f.event(100, 100, { isPrimary: false }), "court", "court-1");
assert.equal(f.context.drag, null); assert.equal(f.timers.size, 0, "Right-click/secondary touches cannot arm a drag");
f.start(); assert.equal(f.node.capture, 1); assert.equal(f.context.drag.armed, false); assert.equal(f.timers.size, 1);
f.advance(200); f.context.endDrag(f.event()); f.advance(500);
assert.equal(f.calls.saves, 0); assert.equal(f.context.current.courts[0].x, 24); assert.equal(f.context.drag, null);
assert.equal(f.classes.has("ca-court-drag-ready"), false); assert.equal(f.handlers.size, 0); assert.equal(f.node.capture, null);

f = fixture(); f.start(); f.context.moveDrag(f.event(112, 100)); f.advance(500);
assert.equal(f.context.drag.cancelled, true); assert.equal(f.context.drag.armed, false);
const swipeEnd = f.event(112, 100); f.context.endDrag(swipeEnd);
assert.equal(swipeEnd.prevented, true); assert.ok(f.context.suppressClickUntil > 500);
assert.equal(f.calls.saves, 0); assert.equal(f.context.current.courts[0].x, 24, "Quick swipes do not relocate a court");

f = fixture(); f.start(); f.advance(349);
assert.equal(f.context.drag.armed, false); f.context.moveDrag(f.event(102, 102)); f.advance(1);
assert.equal(f.context.drag.armed, true); assert.equal(f.classes.has("ca-court-drag-ready"), true);
f.context.moveDrag(f.event(180, 148));
assert.equal(f.context.current.courts[0].x, 104); assert.equal(f.context.current.courts[0].y, 72); assert.ok(f.calls.lines);
f.context.endDrag(f.event(180, 148));
assert.equal(f.calls.saves, 1); assert.equal(f.context.drag, null); assert.equal(f.classes.has("ca-court-drag-ready"), false);
assert.deepEqual(f.context.current.assignments, { "p-1": { courtId: "court-1", allowed: ["court-1"], locked: true } });
assert.equal(f.handlers.size, 0); assert.equal(f.timers.size, 0);

f = fixture(); f.start(); f.advance(350); f.context.endDrag(f.event());
assert.equal(f.calls.saves, 0, "Stationary long presses do not create cloud writes");
f = fixture(); f.context.zoom = 0.5; f.start(); f.advance(350); f.context.moveDrag(f.event(140, 124)); f.context.endDrag(f.event(140, 124));
assert.equal(f.context.current.courts[0].x, 104); assert.equal(f.context.current.courts[0].y, 72, "Movement accounts for zoom");

for (const event of [null, { pointerId: 1 }, { type: "blur" }, { type: "lostpointercapture", pointerId: 1 }]) {
  f = fixture(); f.start(); f.advance(350); f.context.moveDrag(f.event(180, 148)); f.context.cancelDrag(event);
  assert.equal(f.context.current.courts[0].x, 24); assert.equal(f.context.current.courts[0].y, 24);
  assert.equal(f.calls.saves, 0); assert.equal(f.calls.render, 1); assert.equal(f.context.drag, null); assert.equal(f.handlers.size, 0);
}
f = fixture(); f.start(); f.context.cancelDrag(null, false); f.advance(500);
assert.equal(f.calls.render, 0); assert.equal(f.context.drag, null); assert.equal(f.timers.size, 0, "Rerenders clear pending timers without recursion");
f = fixture(); f.start(); f.context.endDrag(f.event(100, 100, { pointerId: 2 })); f.context.cancelDrag({ pointerId: 2 });
assert.notEqual(f.context.drag, null, "Another touch cannot end this pointer's gesture");
f.context.cancelDrag();
for (const change of [(f) => f.node.isConnected = false, (f) => f.context.open = false, (f) => f.context.tab = "settings"]) {
  f = fixture(); f.start(); change(f); f.advance(350); assert.equal(f.context.drag, null); assert.equal(f.calls.saves, 0);
}
f = fixture(); f.start(); f.advance(350); f.context.moveDrag(f.event(180, 148));
f.context.current = { courts: [{ id: "court-1", label: "7", x: 600, y: 720 }], assignments: {} };
f.context.cancelDrag(null, false);
assert.equal(f.context.current.courts[0].x, 600); assert.equal(f.context.current.courts[0].y, 720, "Cancelling an old gesture never overwrites a newly refreshed cloud layout");
assert.equal(f.context.drag, null); assert.equal(f.calls.saves, 0);
f = fixture(); f.context.beginDrag(f.event(), "person", "p-1");
assert.equal(f.context.drag.armed, true); assert.equal(f.timers.size, 0, "Person dragging remains immediate"); f.context.cleanDrag();
f = fixture(); f.node.style = { left: "24px", top: "480px" }; f.context.beginDrag(f.event(), "bundle", "flow-ab");
assert.equal(f.context.drag.armed, true); assert.equal(f.timers.size, 0, "Roaming-group dragging remains immediate"); f.context.cleanDrag();
console.log("Court headers passed: no grip button, editable X号场 labels, actual 350ms gesture recognition, short-click/swipe protection, primary-pointer isolation, zoom-aware movement, live lines, save-on-release, cancellation/blur/rerender cleanup, keyboard/input separation, and unchanged immediate person/group dragging.");