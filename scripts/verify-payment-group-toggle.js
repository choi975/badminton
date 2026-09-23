import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
function extract(start, end) {
  return html.slice(html.indexOf(`    function ${start}(`), html.indexOf(`    function ${end}(`));
}
const state = { paymentGroupOverrides: {} };
let rendered = 0;
const toggle = new Function("state", "els", "openPaymentModal", `return ${extract("togglePaymentGroup", "renderPaymentSortButtons")}`)(
  state, { paymentModal: { classList: { contains: () => true } } }, () => { rendered += 1; },
);
for (const [kind, from, to, expected] of [
  ["friends", "friends", "special", "特殊"],
  ["friends", "special", "friends", "球友"],
  ["dual", "friends", "heineken", "Hytronik"],
  ["dual", "heineken", "friends", "球友"],
  ["hytronik", "heineken", "special", "特殊"],
  ["hytronik", "special", "heineken", "Hytronik"],
]) {
  toggle(1, from, kind);
  assert.equal(state.paymentGroupOverrides[1], expected, `${kind}: ${from} -> ${to}`);
}
toggle(1, "friends", "dual", "friends");
assert.equal(state.paymentGroupOverrides[1], "特殊", "dual members in a shared friends group move to special");
toggle(1, "heineken", "dual", "heineken");
assert.equal(state.paymentGroupOverrides[1], "特殊", "dual members in a shared Hytronik group move to special");
toggle(1, "special", "dual", "heineken");
assert.equal(state.paymentGroupOverrides[1], "Hytronik", "dual members return to the shared Hytronik group");
assert.equal(rendered, 9);
const node = () => ({ children: [], attrs: {}, classList: { toggle() {} },
  append(...items) { this.children.push(...items); },
  setAttribute(name, value) { this.attrs[name] = value; },
  addEventListener(name, fn) { this[name] = fn; },
});
const render = new Function("document", "getPaymentRowHighlights", "paymentRowDisplayName", "formatPaymentRowValue", "togglePaymentGroup", `return ${extract("renderPaymentGroup", "createPaymentBadge")}`)(
  { createElement: node }, () => ({ companion: false, femaleDiscount: false }), (row) => row.name,
  (row) => `${row.amount}元`, toggle,
);
for (const [flags, group, target] of [
  [{ friendsOnly: true }, "friends", "特殊"], [{ friendsOnly: true }, "special", "球友"],
  [{ dualGroup: true }, "friends", "Hytronik"], [{ dualGroup: true }, "heineken", "球友"],
  [{ dualGroup: true }, "friends", "特殊", "friends"], [{ dualGroup: true }, "heineken", "特殊", "heineken"],
  [{ hytronikOnly: true }, "heineken", "特殊"], [{ hytronikOnly: true }, "special", "Hytronik"],
  [{}, "special", null], [{ playerId: null }, "friends", null],
]) {
  const row = { playerId: 1, name: "测试成员", amount: 80, ...flags };
  const container = { replaceChildren(...items) { this.children = items; } };
  render(container, [row], { showTotal: false, femaleDiscountApplied: false, femaleDiscount: 0, group, sharedPaymentGroup: target === "特殊" ? group : null });
  const buttons = container.children[0].children.filter((item) => item.className === "payment-group-toggle");
  assert.equal(buttons.length, target ? 1 : 0);
  if (target) {
    assert.equal(buttons[0].attrs["aria-label"], `把测试成员切换到${target}`);
    assert.equal(buttons[0].attrs["data-html2canvas-ignore"], "true");
    buttons[0].click();
    assert.equal(state.paymentGroupOverrides[1], target);
  }
  assert.equal(row.amount, 80, "Moving a row must not change its payment amount");
}
assert.match(html, /row\.friendsOnly = Boolean\(player && player\.affiliation === "球友"\)/);
console.log("Payment group button visibility, targets and round-trip toggles passed.");
