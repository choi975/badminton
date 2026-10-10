import assert from "node:assert/strict";
import vm from "node:vm";
import { loadPaymentFunctions, paymentHtml } from "./payment-test-helpers.js";

// Compile the complete inline application, then execute its actual payment functions.
for (const [, source] of paymentHtml.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
  if (source.trim()) new vm.Script(source);
}
const node = () => ({
  children: [], textContent: "", className: "", attrs: {},
  classList: { values: new Set(), toggle(name, enabled) { if (enabled) this.values.add(name); else this.values.delete(name); } },
  append(...items) { this.children.push(...items); },
  replaceChildren(...items) { this.children = items; },
  setAttribute(name, value) { this.attrs[name] = value; },
  addEventListener() {},
});
const text = (element) => element.textContent + element.children.map(text).join("");
const state = { players: [], paymentOrders: {}, paymentSortModes: {}, paymentGroupOverrides: {} };
const els = Object.fromEntries([
  "paymentCostSummary", "paymentRuleSelect", "paymentRuleAmountField", "paymentRuleAmountLabel",
  "paymentRuleAmountInput", "paymentRuleHint", "paymentRuleSummary", "paymentBtn", "chainInput",
  "courtFeeInput", "shuttlePriceInput", "shuttleCountInput",
].map((name) => [name, { ...node(), value: "" }]));
const api = loadPaymentFunctions([
  "calculatePaymentRates", "ceilTwoDecimals", "formatMoney", "formatCompactNumber",
  "calculatePayment", "shouldCountForPayment", "getSharedPaymentGroup", "canEntryUsePaymentGroup",
  "getPaymentGroup", "getPlayerAffiliations", "hasPlayerAffiliation", "isSpecialPlayer",
  "addPaymentLine", "mapToPaymentRows", "getChainEntryBaseName", "normalizePlayerId",
  "paymentDisplayName", "firstName", "splitAliases", "buildSessionParticipants",
  "formatPaymentGroup", "formatSpecialGroup", "formatPaymentRowValue", "paymentRowDisplayName",
  "getPaymentRowHighlights", "formatPaymentComposition", "renderPaymentGroup", "createPaymentBadge",
  "renderPaymentCostSummary", "createEstimateAverageLine",
  "renderPaymentRuleSettings", "resetPaymentRule", "updatePaymentButton",
], {
  state, els, getAdvancedTotals: () => ({ courtCount: 1 }),
  document: { createElement: node, createTextNode: (value) => ({ ...node(), textContent: value }) },
  createEstimateValue: (value) => ({ ...node(), textContent: value }),
  PAYMENT_GROUPS: { friends: "球友", heineken: "Hytronik" },
  collator: new Intl.Collator("zh-Hans-CN", { numeric: true }),
});
const { calculatePaymentRates: calculateRates, formatMoney } = api;
const discountRule = { mode: "discount", amount: 3.5 };
const rates = (total, count, females) => calculateRates(total, count, females, discountRule);
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
const payment = api.calculatePayment(entries, 70, 11.3, 5, discountRule);
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
// Default equal split, custom discounts, caps, and single-gender exceptions.
const share = (result) => [result.malePerPerson, result.femalePerPerson];
assert.deepEqual(share(calculateRates(115, 4, 1)), [28.75, 28.75]);
assert.deepEqual(share(calculateRates(115, 4, 1, { mode: "discount", amount: 5 })), [30, 25]);
assert.deepEqual(share(calculateRates(115, 4, 1, { mode: "cap", amount: 25 })), [30, 25]);
assert.deepEqual(share(calculateRates(60, 4, 1, { mode: "cap", amount: 25 })), [15, 15]);
assert.deepEqual(share(calculateRates(100, 4, 1, { mode: "cap", amount: 25 })), [25, 25]);
assert.deepEqual(share(calculateRates(300, 4, 1, { mode: "cap", amount: 25 })), [91.67, 25]);
assert.deepEqual(share(calculateRates(115, 4, 1, { mode: "cap", amount: 0 })), [38.34, 0]);
assert.deepEqual(share(calculateRates(115, 4, 1, { mode: "discount", amount: 0 })), [28.75, 28.75]);
for (const mode of ["equal", "discount", "cap"]) {
  for (const amount of [0, 0.01, 2.75, 3.5, 25, 50, 999]) {
    for (let count = 1; count <= 24; count += 1) {
      for (let females = 0; females <= count; females += 1) {
        for (const cents of [0, 1, 99, 350, 999, 6000, 10000, 11500, 12650, 123456]) {
          const result = calculateRates(cents / 100, count, females, { mode, amount });
          const [maleCents, femaleCents] = share(result).map((value) => Math.round(value * 100));
          const charged = maleCents * (count - females) + femaleCents * females;
          assert.ok(charged >= cents, "Every rule covers the entire bill");
          assert.ok(charged - cents < count, "Rounding excess stays below one cent per participant");
          assert.ok(femaleCents >= 0 && maleCents >= femaleCents);
          if (mode === "equal" || females === 0 || females === count) {
            assert.equal(maleCents, femaleCents, "Default and single-gender bills split equally");
          } else if (mode === "cap") {
            assert.ok(femaleCents <= Math.round(amount * 100), "Female payment never exceeds the cap");
          } else if (femaleCents > 0) {
            assert.equal(maleCents - femaleCents, Math.round(amount * 100));
          }
          checked += 1;
        }
      }
    }
  }
}
for (const amount of ["", " ", "-1", "abc", "NaN", Infinity, NaN, "1.001", "1e3", "0x10", null, undefined, "999999999999999999"]) {
  for (const mode of ["discount", "cap"]) {
    assert.equal(api.isPaymentRuleValid({ mode, amount }), false, String(amount));
    assert.deepEqual(share(calculateRates(115, 4, 1, { mode, amount })), [28.75, 28.75]);
  }
}
for (const amount of [0, 3.5, "25.00", ".50", "3.", " 25 "]) {
  assert.equal(api.isPaymentRuleValid({ mode: "cap", amount }), true);
}
assert.equal(api.isPaymentRuleValid({ mode: "unknown", amount: 5 }), false);
assert.deepEqual(share(api.calculatePayment(entries, 70, 11.3, 5)), [31.63, 31.63]);
state.paymentRule = { mode: "cap", amount: 25 };
const cappedPayment = api.calculatePayment(entries, 70, 11.3, 5);
assert.deepEqual(share(cappedPayment), [38.25, 25], "Current UI rule reaches the production calculation");
assert.deepEqual(api.buildSessionParticipants(entries, cappedPayment).map((row) => row.amount), [38.25, 25, 38.25, 25]);
assert.match(api.formatPaymentGroup(cappedPayment.groups.friends, true), /女丙🌸：25\.00元/);
api.renderPaymentGroup(list, cappedPayment.groups.friends, { showTotal: true, ...cappedPayment, femaleCap: 25 });
assert.match(text(list), /25\.00元封顶/);
api.renderPaymentCostSummary(70, [], [], 56.5, cappedPayment);
assert.match(text(els.paymentCostSummary), /女生每人 25\.00 元封顶/);
assert.match(text(els.paymentCostSummary), /70\.00 \+ 56\.50 - 25\.00\*2/);
assert.match(text(api.createEstimateAverageLine(cappedPayment)), /男 38\.25 元 \/ 女 25\.00 元/);
state.paymentRule = { mode: "equal", amount: 0 };
const equalPayment = api.calculatePayment(entries, 70, 11.3, 5);
api.renderPaymentCostSummary(70, [], [], 56.5, equalPayment);
assert.match(text(els.paymentCostSummary), /男女平 A/);
assert.doesNotMatch(text(els.paymentCostSummary), /封顶|少 A/);
assert.match(text(api.createEstimateAverageLine(equalPayment)), /预计人均 31\.63 元/);
api.renderPaymentCostSummary(100, [], [], 0, calculateRates(100, 3, 3, { mode: "cap", amount: 25 }));
assert.match(text(els.paymentCostSummary), /只有一种性别/);
api.renderPaymentCostSummary(60, [], [], 0, calculateRates(60, 4, 1, { mode: "cap", amount: 25 }));
assert.match(text(els.paymentCostSummary), /均摊金额未超过封顶金额/);
assert.doesNotMatch(paymentHtml, /FEMALE_PAYMENT_DISCOUNT|ceilOneDecimal/);
// The production UI must match the calculation, including invalid input and resetting.
state.feeMode = "basic";
state.advancedRows = { court: [{ price: 70, count: 1 }], shuttle: [{ price: 11.3, count: 5 }] };
for (const name of ["chainInput", "courtFeeInput", "shuttlePriceInput", "shuttleCountInput"]) els[name].value = "1";
api.resetPaymentRule();
api.updatePaymentButton();
assert.deepEqual(state.paymentRule, { mode: "equal", amount: 0 });
assert.equal(els.paymentRuleSelect.value, "equal");
assert.equal(els.paymentRuleAmountField.hidden, true);
assert.equal(els.paymentRuleAmountInput.disabled, true);
assert.equal(els.paymentRuleAmountInput.required, false);
assert.equal(els.paymentBtn.disabled, false);
assert.match(els.paymentRuleSummary.textContent, /男女平 A/);
for (const mode of ["discount", "cap"]) {
  state.paymentRule = { mode, amount: "12.5" };
  api.renderPaymentRuleSettings(true);
  assert.equal(els.paymentRuleAmountField.hidden, false);
  assert.equal(els.paymentRuleAmountInput.disabled, false);
  assert.equal(els.paymentRuleAmountInput.required, true);
  assert.equal(els.paymentRuleAmountInput.value, "12.5");
  assert.match(els.paymentRuleAmountLabel.textContent, mode === "cap" ? /封顶/ : /少 A/);
  assert.match(els.paymentRuleSummary.textContent, /12\.50/);
  els.paymentRuleAmountInput.value = "12.";
  state.paymentRule.amount = "12.";
  api.renderPaymentRuleSettings();
  assert.equal(els.paymentRuleAmountInput.value, "12.", "Typing a decimal must not reset the input/caret");
  for (const amount of ["", "-1", "abc", "1.001"]) {
    state.paymentRule.amount = amount;
    api.renderPaymentRuleSettings();
    assert.equal(els.paymentRuleAmountInput.attrs["aria-invalid"], "true");
    assert.equal(els.paymentRuleHint.classList.values.has("is-error"), true);
    assert.match(els.paymentRuleSummary.textContent, /金额无效/);
    for (const feeMode of ["basic", "advanced"]) {
      state.feeMode = feeMode;
      api.updatePaymentButton();
      assert.equal(els.paymentBtn.disabled, true, "Invalid rule blocks collection in either fee view");
    }
  }
  state.paymentRule.amount = "0";
  api.renderPaymentRuleSettings();
  api.updatePaymentButton();
  assert.equal(els.paymentBtn.disabled, false);
  assert.equal(els.paymentRuleAmountInput.attrs["aria-invalid"], "false");
  assert.equal(els.paymentRuleHint.classList.values.has("is-error"), false);
  api.renderPaymentCostSummary(0, [], [], 0, calculateRates(0, 4, 1, { mode, amount: 5 }));
  assert.match(text(els.paymentCostSummary), /无需收款/);
}
api.resetPaymentRule();
assert.deepEqual(state.paymentRule, { mode: "equal", amount: 0 });
assert.equal(els.paymentRuleAmountInput.value, "");
assert.equal(els.paymentRuleAmountInput.attrs["aria-invalid"], "false");
assert.match(els.paymentRuleSummary.textContent, /男女平 A/);
assert.match(paymentHtml, /function openChainForNewDate[\s\S]*?resetPaymentRule\(\)/);
assert.match(paymentHtml, /paymentRuleSelect\.addEventListener\("change"/);
assert.match(paymentHtml, /paymentRuleAmountInput\.addEventListener\("input"/);
// Advanced fee previews and collection must agree without replacing manually entered fees.
const shuttleType = { id: "rsl3", name: "亚3", prices: [11.3] };
const feeEstimate = { courts: 1, shuttleCounts: { rsl3: 4 } };
const feeState = { chainEntries: entries, estimator: { shuttleTypes: [shuttleType] }, feeMode: "basic" };
const feeEls = {
  courtFeeInput: { value: "115" }, shuttlePriceInput: { value: "11.3" }, shuttleCountInput: { value: "0" },
  feeBasicGrid: {}, feeAdvancedArea: {}, feeAdvancedBtn: {},
};
const feeApi = loadPaymentFunctions([
  "enterAdvancedFeeMode", "getAdvancedTotals", "getFeeDisplayEstimate", "updateFeeDefaults",
], {
  state: feeState, els: feeEls,
  estimateBooking: () => feeEstimate, courtPriceBreakdown: () => [],
  getCourtUnitPriceForDate: () => 70, getChainActivityDate: () => "2026-10-08",
  predictedShuttleCountForPrice: () => 4, renderAllFeeAdvancedRows() {}, updatePaymentButton() {},
  updateShuttleTypeNotice() {}, findShuttleTypeByPrice: () => shuttleType, inferPreferredCourtCount: () => null,
  calculatePayment: (...args) => api.calculatePayment(...args),
});
feeApi.enterAdvancedFeeMode();
assert.equal(feeState.advancedRows.shuttle[0].count, 0);
assert.equal(feeState.advancedAutoDefaults.shuttleCount, 4);
feeApi.updateFeeDefaults(entries, feeEstimate);
assert.equal(feeState.advancedRows.shuttle[0].count, 0, "Manual zero shuttle count survives recalculation after opening advanced settings");
assert.equal(feeState.advancedRows.court[0].price, 115);
state.paymentRule = { mode: "cap", amount: 25 };
feeState.advancedRows.court[0].price = 130;
const preview = feeApi.getFeeDisplayEstimate(entries, feeEstimate);
assert.equal(preview.courts, 1);
assert.equal(preview.shuttle, 0);
assert.equal(preview.payment.malePerPerson, 40, "Preview uses advanced fees, not the stale basic 115 yuan input");
assert.equal(preview.payment.femalePerPerson, 25);
assert.match(paymentHtml, /renderPriceRows\(container, state\.advancedRows\[kind\], \(\) => \{[\s\S]*?renderChainStats/);
api.renderPaymentCostSummary(94, [{ price: 70, count: 1.333 }], [], 0, calculateRates(94, 4, 0, { mode: "equal", amount: 0 }));
assert.match(text(els.paymentCostSummary), /70\.00元\*1个\+24\.00元（1小时）\*1个=94\.00元/);
api.renderPaymentCostSummary(117, [{ price: 70, count: 1.666 }], [], 0, calculateRates(117, 4, 0, { mode: "equal", amount: 0 }));
assert.match(text(els.paymentCostSummary), /47\.00元（2小时）\*1个=117\.00元/);
console.log(`Payment rules passed (${checked} rate combinations, production calculations, ownership, session amounts, copy, summary, badges, settings UI and validation).`);
