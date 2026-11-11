import assert from "node:assert/strict";
import { loadPaymentFunctions, paymentHtml } from "./payment-test-helpers.js";

class Element {
  constructor(tag = "div") { this.tagName = tag; this.value = ""; this.dataset = {}; this.attrs = {}; this.children = []; this.listeners = {}; this.hidden = false; this.disabled = false; this.classList = { toggle() {} }; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  focus() {}
}
const types = [
  { id: "rsl3", name: "亚3", defaultPrice: 11.3, prices: [11, 11.3, 11.5] },
  { id: "as05", name: "AS05", defaultPrice: 13, prices: [13, 13.5] },
];
const state = { feeMode: "basic", feeHoursUserOwned: false, feeHoursValid: true, chainEntries: [{}], estimator: { shuttleTypes: structuredClone(types) }, advancedRows: { court: [], shuttle: [] }, autoFeeDefaults: { fee: 70, shuttle: 4, courts: 1 }, paymentRule: { mode: "discount", amount: 3.5 } };
const els = Object.fromEntries(["courtHoursInput", "courtHoursIncreaseBtn", "courtHoursDecreaseBtn", "courtFeeInput", "feeHoursError", "shuttlePriceInput", "shuttleCountInput", "shuttlePriceRows", "shuttleTypeNotice", "feeBasicGrid", "feeAdvancedArea", "feeAdvancedBtn", "paymentBtn", "chainInput"].map(name => [name, new Element()]));
els.courtHoursInput.value = "3"; els.courtFeeInput.value = "999";
els.shuttlePriceInput.value = "11.3"; els.shuttleCountInput.value = "4"; els.chainInput.value = "1. 球友";
let estimate = { courts: 1, shuttleCounts: { rsl3: 4, as05: 3 } }, previews = 0, api;
api = loadPaymentFunctions([
  "ensureFeeRows", "syncFeeInputs", "onFeeHoursInput", "stepFeeHours", "getAdvancedTotals", "renderPriceRows", "createPriceRowElement", "renderFeeAdvancedRows", "enterAdvancedFeeMode", "exitAdvancedFeeMode", "updateFeeDefaults", "updatePaymentButton", "updateShuttleTypeNotice", "hasUnknownShuttleType", "findShuttleTypeByPrice", "getCurrentShuttleTypeForPrice", "getShuttleDefaultPrice", "formatCompactNumber", "deriveCourtRows", "courtPriceBreakdown", "getFeeDisplayEstimate", "openChainForSessionEdit",
], {
  state, els, DEFAULT_ESTIMATOR: { shuttleTypes: types }, document: { createElement: tag => new Element(tag) },
  getCourtUnitPriceForDate: () => 70, getChainActivityDate: () => "2026-11-11", estimateBooking: () => estimate,
  predictedShuttleCountForPrice: (value, price) => { const type = state.estimator.shuttleTypes.find(item => item.prices.includes(price) || item.defaultPrice === price); return type ? value.shuttleCounts[type.id] ?? 0 : null; },
  inferPreferredCourtCount: () => null,
  buildChainInputFromSession: () => ({ text: "1. 球友", plusOverrides: {} }),
  updateShakePeopleButtonVisibility() {}, resetPaymentRule() { state.paymentRule = { mode: "discount", amount: 3.5 }; },
  openModal() {}, closeModal() {}, setTimeout: fn => fn(), toast() {},
  calculatePayment: (entries, courtFee, price, count) => ({ total: courtFee + price * count }),
  renderChainStats() { previews++; },
  renderAllFeeAdvancedRows() { api.ensureFeeRows(); api.renderFeeAdvancedRows("court"); api.renderFeeAdvancedRows("shuttle"); },
  processChain() { api.updateFeeDefaults(state.chainEntries, estimate); api.updatePaymentButton(); },
});
const rows = () => els.shuttlePriceRows.children;
const priceInput = index => rows()[index].children[1];
const quantity = index => rows()[index].children[3].children[0];
const steps = index => rows()[index].children[3].children[1].children;
const add = () => rows().at(-1).children[4];
const remove = index => rows()[index].children[5];
const fillHours = value => { els.courtHoursInput.value = String(value); api.onFeeHoursInput(); };
const fillCount = (index, value) => { quantity(index).value = String(value); quantity(index).listeners.input(); };
api.updateFeeDefaults(state.chainEntries, estimate);
assert.equal(rows().length, 1);
assert.equal(state.advancedRows.shuttle[0].type, "rsl3");
assert.equal(els.courtFeeInput.value, "70");
assert.equal(els.feeBasicGrid.hidden, false);

for (const [hours, fee] of [[0.5, "12"], [1.5, "35"], [3, "70"], [5, "117"], [5.5, "129"], [6, "140"]]) {
  fillHours(hours); assert.equal(els.courtFeeInput.value, fee); assert.equal(api.getAdvancedTotals().courtHours, hours);
}
fillHours(5.5); api.stepFeeHours(1);
assert.equal(els.courtHoursInput.value, "6.5"); assert.equal(els.courtFeeInput.value, "152");
api.stepFeeHours(-1); assert.equal(els.courtHoursInput.value, "5.5"); assert.equal(els.courtFeeInput.value, "129");
fillHours(0); assert.equal(els.courtFeeInput.value, "0"); assert.equal(els.courtHoursDecreaseBtn.disabled, true); assert.equal(els.paymentBtn.disabled, true);
api.stepFeeHours(-1); assert.equal(els.courtHoursInput.value, "0");
fillHours(5.5);
for (const value of ["", "-1", "5.25", "5.2", "abc"]) {
  fillHours(value); assert.equal(els.courtHoursInput.attrs["aria-invalid"], "true"); assert.equal(els.feeHoursError.hidden, false); assert.equal(els.paymentBtn.disabled, true);
}
fillHours(5.5); assert.equal(els.feeHoursError.hidden, true); assert.equal(els.paymentBtn.disabled, false);

fillCount(0, 0); assert.equal(els.paymentBtn.disabled, false, "Zero balls is valid and must not require a purchase");
steps(0)[1].listeners.click(); assert.equal(quantity(0).value, "0");
steps(0)[0].listeners.click(); assert.equal(quantity(0).value, "1");
quantity(0).listeners.keydown({ key: "ArrowUp", preventDefault() {} }); assert.equal(quantity(0).value, "2");
quantity(0).listeners.keydown({ key: "ArrowDown", preventDefault() {} }); assert.equal(quantity(0).value, "1");
fillCount(0, "3.5"); assert.equal(els.paymentBtn.disabled, true, "Fractional balls cannot be collected");
quantity(0).listeners.change(); assert.equal(quantity(0).value, "3");
fillCount(0, 4);
priceInput(0).value = "13"; priceInput(0).listeners.input();
assert.equal(api.getFeeDisplayEstimate(state.chainEntries, estimate).type.id, "rsl3", "A manual price equal to AS05 must not relabel an explicitly selected 亚3 row");
priceInput(0).value = "11.3"; priceInput(0).listeners.input();
assert.equal(add().disabled, false); add().listeners.click();
assert.deepEqual(state.advancedRows.shuttle.map(row => row.type), ["rsl3", "as05"]);
assert.equal(state.advancedRows.shuttle[1].price, 13, "AS05 uses the registered default, not an outdated historical 13.5");
assert.equal(add().disabled, true); add().listeners.click(); assert.equal(rows().length, 2);
assert.equal(rows()[0].children[0].children.find(option => option.value === "as05").disabled, true);
rows()[0].children[0].value = "as05"; rows()[0].children[0].listeners.change();
assert.equal(state.advancedRows.shuttle[0].type, "rsl3", "A second row's model cannot be selected again");
assert.equal(api.getAdvancedTotals().shuttleCount, 5);
assert.ok(Math.abs(api.getAdvancedTotals().shuttleCost - 58.2) < 1e-9);
assert.equal(els.shuttleTypeNotice.hidden, true, "A valid mixed bill is not an unknown-price warning");
for (const mode of ["basic", "advanced"]) { state.feeMode = mode; const preview = api.getFeeDisplayEstimate(state.chainEntries, estimate); assert.equal(preview.type.id, "mixed"); assert.ok(Math.abs(preview.payment.total - 187.2) < 1e-9); }
fillCount(0, 17); fillCount(1, 2); priceInput(1).value = "13.25"; priceInput(1).listeners.input();
const beforeToggle = structuredClone(state.advancedRows);
for (let i = 0; i < 3; i++) { api.enterAdvancedFeeMode(); assert.equal(els.feeBasicGrid.hidden, false); api.exitAdvancedFeeMode(); }
assert.deepEqual(state.advancedRows, beforeToggle, "Toggling basic/advanced must not collapse a mixed bill or reset manual inputs");
assert.equal(els.courtHoursInput.value, "5.5"); assert.equal(els.feeAdvancedBtn.attrs["aria-expanded"], "false");
assert.ok(previews > 0, "Every quantity and price action refreshes the preview");
remove(1).listeners.click(); assert.equal(rows().length, 1); assert.equal(add().disabled, false);
rows()[0].children[0].value = "as05"; rows()[0].children[0].listeners.change(); add().listeners.click();
assert.deepEqual(state.advancedRows.shuttle.map(row => row.type), ["as05", "rsl3"], "Adding after AS05 selects the unused 亚3 model");
state.estimator.shuttleTypes.push({ id: "third", name: "第三款", defaultPrice: 15, prices: [15] }); api.renderFeeAdvancedRows("shuttle");
assert.equal(add().disabled, false); add().listeners.click(); assert.deepEqual(state.advancedRows.shuttle.map(row => row.type), ["as05", "rsl3", "third"]); assert.equal(add().disabled, true);

state.estimator.shuttleTypes = structuredClone(types); state.advancedRows = { court: [], shuttle: [] }; state.feeHoursUserOwned = false; state.advancedAutoDefaults = null; state.autoFeeDefaults = { fee: 70, shuttle: 4, courts: 1 };
els.courtHoursInput.value = "3"; els.courtFeeInput.value = "70"; els.shuttlePriceInput.value = "11.3"; els.shuttleCountInput.value = "4"; state.selectedEstimateShuttleTypeId = "rsl3";
estimate = { courts: 2, shuttleCounts: { rsl3: 10, as05: 8 } }; api.updateFeeDefaults(state.chainEntries, estimate);
assert.equal(els.courtHoursInput.value, "6"); assert.equal(quantity(0).value, "10");
fillHours(5.5); fillCount(0, 6); estimate = { courts: 3, shuttleCounts: { rsl3: 20, as05: 18 } }; api.updateFeeDefaults(state.chainEntries, estimate);
assert.equal(els.courtHoursInput.value, "5.5"); assert.equal(els.courtFeeInput.value, "129"); assert.equal(quantity(0).value, "6", "Automatic estimates cannot overwrite a manually entered count");

for (const price of [0, 70, 80, 100]) {
  const record = { id: 100 + price, date: "2026-07-01", venue: price === 80 ? "EDC" : "文体", courtCount: 1.5, courtFee: price * 1.5, courtPriceRows: [{ price, count: 1.5 }], shuttlePrice: 13.5, shuttleCount: 2, shuttlePriceRows: [{ type: "as05", price: 13.5, count: 2 }], players: [] };
  const before = structuredClone(record);
  api.openChainForSessionEdit(record);
  assert.equal(els.courtHoursInput.value, "4.5"); assert.equal(els.courtFeeInput.value, String(price * 1.5));
  assert.equal(state.advancedRows.shuttle[0].price, 13.5, "Editing uses the historical price, not the current 13-yuan default");
  assert.equal(state.advancedRows.shuttle[0].priceUserOwned, true);
  assert.deepEqual(record, before, "Opening/edit-preview cannot mutate the saved historical record");
}
api.openChainForSessionEdit({ id: 999, date: "2026-07-02", venue: "EDC", courtCount: 1, courtFee: 80, shuttlePrice: 16, shuttleCount: 2, players: [] });
assert.equal(state.advancedRows.shuttle[0].type, "unknown", "Unknown historical prices must never become invented training labels");
assert.equal(els.shuttleTypeNotice.hidden, false);

assert.match(paymentHtml, /id="courtFeeInput"[^>]*readonly/);
assert.ok(paymentHtml.indexOf('id="shuttlePriceRows"') < paymentHtml.indexOf('id="feeAdvancedArea"'), "Hours and shuttle rows remain shared outside advanced-only settings");
assert.doesNotMatch(paymentHtml, /id="courtPriceRows"/);
assert.match(paymentHtml, /court-pricing\.js\?v=hourly-20261111/);
assert.match(paymentHtml, /max-width: 360px/);
assert.match(paymentHtml, /side-stack \{ grid-template-columns: minmax\(0, 1fr\)/);
assert.match(paymentHtml, /fee-advanced-remove \{ grid-column: 6/);
assert.match(paymentHtml, /payment-rule-settings \{ grid-template-columns:/);
assert.match(paymentHtml, /shuttle-type-editor \{ display: grid; grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1\.05fr\) auto/);
console.log("Hourly fee UI passed: rounding, half-hours, steppers, validation, zero balls, mixed pricing, unused models, disabled add, future registration, mode/data preservation, manual defaults and compact layouts. No production data changed.");
