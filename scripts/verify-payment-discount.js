import assert from "node:assert/strict";
import vm from "node:vm";
import { loadPaymentFunctions, paymentHtml } from "./payment-test-helpers.js";

// Compile the complete inline application, then execute its actual payment functions.
for (const [, source] of paymentHtml.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
  if (source.trim()) new vm.Script(source);
}
const node = () => ({
  children: [], textContent: "", className: "", attrs: {},
  classList: { toggle() {} },
  append(...items) { this.children.push(...items); },
  replaceChildren(...items) { this.children = items; },
  setAttribute(name, value) { this.attrs[name] = value; },
  addEventListener() {},
});
const text = (element) => element.textContent + element.children.map(text).join("");
const state = { players: [], paymentOrders: {}, paymentSortModes: {}, paymentGroupOverrides: {} };
const els = { paymentCostSummary: node() };
const api = loadPaymentFunctions([
  "calculatePaymentRates", "ceilTwoDecimals", "formatMoney", "formatCompactNumber",
  "calculatePayment", "shouldCountForPayment", "getSharedPaymentGroup", "canEntryUsePaymentGroup",
  "getPaymentGroup", "getPlayerAffiliations", "hasPlayerAffiliation", "isSpecialPlayer",
  "addPaymentLine", "mapToPaymentRows", "getChainEntryBaseName", "normalizePlayerId",
  "paymentDisplayName", "firstName", "splitAliases", "buildSessionParticipants",
  "formatPaymentGroup", "formatSpecialGroup", "formatPaymentRowValue", "paymentRowDisplayName",
  "getPaymentRowHighlights", "formatPaymentComposition", "renderPaymentGroup", "createPaymentBadge",
  "renderPaymentCostSummary", "createEstimateAverageLine",
], {
  state, els,
  document: { createElement: node, createTextNode: (value) => ({ ...node(), textContent: value }) },
  createEstimateValue: (value) => ({ ...node(), textContent: value }),
  PAYMENT_GROUPS: { friends: "球友", heineken: "Hytronik" },
  collator: new Intl.Collator("zh-Hans-CN", { numeric: true }),
});
const { calculatePaymentRates: rates, formatMoney } = api;
assert.deepEqual([rates(115, 4, 1).malePerPerson, rates(115, 4, 1).femalePerPerson], [29.63, 26.13]);
assert.deepEqual([rates(60, 4, 1).malePerPerson, rates(60, 4, 1).femalePerPerson], [15.88, 12.38], "Discount applies below the old 25 yuan threshold");
assert.deepEqual([rates(120, 6, 2).malePerPerson, rates(120, 6, 2).femalePerPerson], [21.17, 17.67]);
assert.equal(rates(300, 4, 1).femalePerPerson, 72.38, "Female payments are no longer capped at 25");
for (const femaleCount of [0, 3]) {
  const result = rates(100, 3, femaleCount);
  assert.equal(result.malePerPerson, 33.34);
  assert.equal(result.femalePerPerson, 33.34);
  assert.equal(result.femaleDiscountApplied, false);
}
assert.equal(rates(30, 3, 0).perPerson, 10, "Exact cents must not round up again");
assert.equal(rates(0.1 + 0.2, 3, 0).perPerson, 0.1, "Ignore binary floating-point noise");
assert.equal(rates(1.001, 1, 0).perPerson, 1.01, "Sub-cent cost rounds upwards");
assert.equal(rates(0, 0, 0).perPerson, 0);
assert.equal(rates(100, 0, 0).perPerson, 0);
assert.equal(rates(0, 2, 1).malePerPerson, 0);
assert.equal(rates(0, 2, 1).femalePerPerson, 0);
assert.deepEqual([rates(1, 2, 1).malePerPerson, rates(1, 2, 1).femalePerPerson], [1, 0], "Tiny bills never create negative payments");
assert.equal(formatMoney(25), "25.00");
assert.equal(formatMoney(29.63), "29.63");
assert.equal(formatMoney(0), "0.00");

let checked = 0;
for (let count = 1; count <= 24; count += 1) {
  for (let femaleCount = 0; femaleCount <= count; femaleCount += 1) {
    for (const cents of [0, 1, 99, 350, 999, 6000, 10000, 11500, 12650, 123456]) {
      const result = rates(cents / 100, count, femaleCount);
      const maleCents = Math.round(result.malePerPerson * 100);
      const femaleCents = Math.round(result.femalePerPerson * 100);
      const charged = maleCents * (count - femaleCount) + femaleCents * femaleCount;
      assert.ok(charged >= cents, "Charges cover the entire bill");
      assert.ok(charged - cents < count, "Rounding excess stays below one cent per participant");
      assert.ok(femaleCents >= 0 && maleCents >= 0);
      if (femaleCount > 0 && femaleCount < count && femaleCents > 0) {
        assert.equal(maleCents - femaleCents, 350, "Mixed-gender rates differ by exactly 3.50 yuan");
      }
      checked += 1;
    }
  }
}

const owner = { id: 1, name: "男甲", gender: "男", affiliation: "球友" };
const attendee = (name, gender, extra = {}) => ({ clean: name, gender, isFemale: gender === "女", ...extra });
const entries = [
  attendee("男甲", "男", { player: owner, ownerPlayerId: 1, ownerName: "男甲" }),
  attendee("男甲+1", "女", { ownerPlayer: owner, ownerPlayerId: 1, ownerName: "男甲", isCompanion: true }),
  attendee("男乙", "不详"),
  attendee("女丙", "女"),
  attendee("", "女"),
];
const payment = api.calculatePayment(entries, 70, 11.3, 5);
assert.equal(payment.payerCount, 4, "Blank entries do not count");
assert.equal(payment.femaleCount, 2, "Companions use their own gender, not their owner's");
assert.equal(payment.malePerPerson, 33.38);
assert.equal(payment.femalePerPerson, 29.88);
const ownerRow = payment.groups.friends.find((row) => row.playerId === 1);
assert.equal(formatMoney(ownerRow.amount), "63.26");
assert.equal(ownerRow.guestCount, 1);
assert.equal(api.getPaymentRowHighlights(ownerRow, true).femaleDiscount, false, "Mixed owner rows should not imply every participant receives the discount");
const participants = api.buildSessionParticipants(entries, payment);
assert.deepEqual(participants.map((row) => row.amount), [33.38, 29.88, 33.38, 29.88], "Session amounts retain cent precision");
assert.equal(participants[1].ownerPlayerId, 1);
assert.equal(participants[1].isCompanion, true);
const totalRows = payment.groups.friends.reduce((sum, row) => sum + row.amount, 0);
assert.equal(formatMoney(totalRows), "126.52");
assert.equal(formatMoney(participants.reduce((sum, row) => sum + row.amount, 0)), "126.52");
const copied = api.formatPaymentGroup(payment.groups.friends, true);
assert.match(copied, /男甲：63\.26元/);
assert.match(copied, /女丙🌸：29\.88元/);
assert.match(copied, /总计：126\.52/);
assert.equal(api.formatSpecialGroup([{ name: "特殊", amount: 20 }]), "特殊：20.00元");
const list = node();
api.renderPaymentGroup(list, payment.groups.friends, { showTotal: true, femaleDiscountApplied: true, femaleDiscount: 3.5 });
assert.match(text(list), /少3\.50元/);
assert.match(text(list), /总计：126\.52/);
api.renderPaymentCostSummary(70, [{ price: 70, count: 1 }], [{ price: 11.3, count: 5 }], 56.5, payment);
assert.match(text(els.paymentCostSummary), /33\.38 - 3\.50 = 29\.88元/);
assert.match(text(els.paymentCostSummary), /70\.00 \+ 56\.50 \+ 3\.50\*2/);
assert.match(text(api.createEstimateAverageLine(payment)), /男 33\.38 元 \/ 女 29\.88 元/);
assert.match(text(api.createEstimateAverageLine(rates(0, 0, 0))), /0\.00 元/);
api.renderPaymentCostSummary(100, [], [], 0, rates(100, 3, 3));
assert.match(text(els.paymentCostSummary), /33\.34元/);
api.renderPaymentCostSummary(1, [], [], 0, rates(1, 2, 1));
assert.match(text(els.paymentCostSummary), /1\.00 - 1\.00 = 0\.00元（最低0元）/);
assert.doesNotMatch(paymentHtml, /FEMALE_PAYMENT_CAP|femaleCapApplied|25封顶|ceilOneDecimal/);
console.log(`Payment discount and two-decimal rounding passed (${checked} rate combinations, production calculations, owner aggregation, session amounts, copy, summary and badges).`);
