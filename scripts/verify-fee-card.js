import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const defaultModel = JSON.parse(readFileSync(new URL("../data/booking-estimator.json", import.meta.url), "utf8"));
const feeStart = html.indexOf('<div class="fee-box">');
const feeCard = html.slice(feeStart, html.indexOf('<div id="trainingAnomalyModal"', feeStart));
const peopleCard = html.slice(html.indexOf('<section class="summary-panel">'), feeStart);
assert.match(feeCard, /id="feeAdvancedArea"[\s\S]*id="registeredShuttleTypes"[\s\S]*id="shuttleTypeRegistrationForm"/);
assert.match(feeCard, /label[^>]*for="newShuttleTypeName"/);
assert.match(feeCard, /label[^>]*for="newShuttleTypePrices"/);
assert.doesNotMatch(peopleCard, /registeredShuttleTypes|shuttleTypeRegistrationForm|登记球型号/);
assert.doesNotMatch(html, /paymentRuleSummary|1 场按 3 小时计 70 元|女生最低付 0 元|性别不详按男生计算|用球：型号 × 性别 × 等级 × 成员|排除混用/);
assert.match(feeCard, /id="paymentRuleHint"[^>]*hidden/);
assert.match(html, /shuttleTypeRegistrationForm\.addEventListener\("submit", registerShuttleType\)/);
assert.match(html, /function renderAllFeeAdvancedRows\(\) \{\s*renderRegisteredShuttleTypes\(\)/);
assert.match(html, /function renderChainStats\(entries, estimate\) \{\s*renderRegisteredShuttleTypes\(\)/);

function extract(name) {
  const marker = html.includes(`    async function ${name}(`) ? `    async function ${name}(` : `    function ${name}(`;
  const start = html.indexOf(marker), end = html.indexOf("\n    }", start);
  assert.ok(start >= 0 && end > start, name);
  return html.slice(start, end + 6);
}
class Element {
  constructor(tag = "div") { this.tagName = tag.toUpperCase(); this.children = []; this._text = ""; this.value = ""; this.hidden = false; this.disabled = false; this.dataset = {}; this.listeners = {}; this.attrs = {}; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(""); }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  setAttribute(name, value) { this.attrs[name] = value; }
  focus() { this.focused = true; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this._text = ""; this.children = children; }
  querySelector(selector) { return this.children.find(child => "." + child.className === selector) || null; }
}
const els = Object.fromEntries(["registeredShuttleTypes", "shuttleTypeRegistrationForm", "newShuttleTypeName", "newShuttleTypePrices", "registerShuttleTypeBtn", "estimatorAdvancedPanel", "newShuttleTypeNameLabel", "newShuttleTypePricesLabel", "cancelShuttleTypeEditBtn", "shuttleTypeFormError", "shuttlePriceInput"].map(name => [name, new Element()]));
const state = { readOnly: false, estimatorAdvancedOpen: true, shuttleTypeSaving: false, feeMode: "basic", selectedEstimateShuttleTypeId: "rsl3", advancedRows: { shuttle: [{ type: "rsl3", price: 11.3, count: 4 }] } };
els.shuttlePriceInput.value = "11.3";
const messages = [], requests = [];
let groupEditors = 0, chainUpdates = 0;
const context = vm.createContext({
  state, els, DEFAULT_ESTIMATOR: defaultModel, IS_WORKER_APP: true,
  document: { createElement: tag => new Element(tag) },
  createLevelGroupEditor() { groupEditors++; const editor = new Element(); editor.className = "level-group-editor"; return editor; },
  readCachedBootstrap: () => null, cacheBootstrap() {}, renderAllFeeAdvancedRows() {},
  processChain() { chainUpdates++; }, toast(message) { messages.push(message); },
  api: async () => { throw new Error("Unexpected remote request"); },
});
vm.runInContext(["formatMoney", "getShuttleDefaultPrice", "normalizeEstimator", "applyShuttleEstimator", "syncShuttleDefaultPrices", "editShuttleType", "cancelShuttleTypeEdit", "renderEstimatorAdvancedPanel", "renderRegisteredShuttleTypes", "registerShuttleType"].map(extract).join("\n"), context);
state.estimator = context.normalizeEstimator({ ...defaultModel, shuttleTypes: [
  { id: "rsl3", name: "亚3", prices: [11.3, "11.3", 12.5] },
  { id: "as05", name: "AS05", prices: [13.5] },
] });
const render = () => context.renderRegisteredShuttleTypes();
const rows = () => els.registeredShuttleTypes.children;
render();
assert.equal(rows().length, 2);
assert.equal(rows()[0].children[0].children[0].textContent, "亚3");
assert.ok(rows()[0].children[1].textContent.includes("11.30、12.50"));
assert.ok(rows()[0].children[1].textContent.includes("默认 11.30 元/颗"));
assert.ok(rows()[1].children[1].textContent.includes("13.50 元/颗"));
assert.equal(els.shuttleTypeRegistrationForm.hidden, false);
context.renderEstimatorAdvancedPanel();
const groupEditor = els.estimatorAdvancedPanel.children[0];
context.renderEstimatorAdvancedPanel();
assert.equal(groupEditors, 1);
assert.equal(els.estimatorAdvancedPanel.children.length, 1);
assert.equal(els.estimatorAdvancedPanel.children[0], groupEditor, "level-group drafts and focus retain the same editor");

els.newShuttleTypeName.value = "尚未提交的球型";
els.newShuttleTypePrices.value = "10.5, 11";
const form = els.shuttleTypeRegistrationForm;
render();
assert.equal(els.shuttleTypeRegistrationForm, form);
assert.equal(els.newShuttleTypeName.value, "尚未提交的球型");
assert.equal(els.newShuttleTypePrices.value, "10.5, 11", "recalculating costs must not erase registration drafts");
const event = { preventDefault() {} };
for (const [worker, readOnly] of [[false, false], [true, true]]) {
  context.IS_WORKER_APP = worker; state.readOnly = readOnly;
  render();
  assert.equal(rows().length, 2, "GitHub and offline viewers still see registered types and prices");
  assert.equal(els.shuttleTypeRegistrationForm.hidden, true);
  assert.equal(els.registerShuttleTypeBtn.disabled, true);
  await context.registerShuttleType(event);
}
context.IS_WORKER_APP = true; state.readOnly = false; render();
for (const [name, price] of [["", "12"], ["过长".repeat(21), "12"], ["新球", ""], ["新球", "0,-2"], ["新球", "1001"]]) {
  els.newShuttleTypeName.value = name; els.newShuttleTypePrices.value = price;
  await context.registerShuttleType(event);
  assert.equal(state.shuttleTypeSaving, false);
}
let resolveRequest;
context.api = (path, options) => { requests.push({ path, options }); return new Promise(resolve => { resolveRequest = resolve; }); };
els.newShuttleTypeName.value = "  新球型  ";
els.newShuttleTypePrices.value = "9.8，10.5 11";
const pending = context.registerShuttleType(event);
assert.equal(state.shuttleTypeSaving, true);
assert.equal(els.newShuttleTypeName.disabled, true);
assert.equal(els.newShuttleTypePrices.disabled, true);
assert.equal(els.registerShuttleTypeBtn.disabled, true);
render(); await context.registerShuttleType(event);
assert.equal(requests.length, 1, "duplicate submissions cannot register twice");
assert.equal(requests[0].path, "/api/estimator/shuttle-types");
assert.equal(requests[0].options.method, "POST");
assert.deepEqual(JSON.parse(requests[0].options.body), { name: "新球型", prices: [9.8, 10.5, 11] });
resolveRequest({ estimator: { ...state.estimator, shuttleTypes: [...state.estimator.shuttleTypes, { id: "new", name: "新球型", prices: [9.8, 10.5, 11] }] } });
await pending;
assert.equal(state.shuttleTypeSaving, false);
assert.equal(chainUpdates, 1, "successful registration refreshes fee options and estimates");
assert.ok(rows().at(-1).children[1].textContent.includes("9.80、10.50、11.00"));
assert.equal(els.newShuttleTypeName.value, "");
assert.equal(els.newShuttleTypePrices.value, "");
assert.equal(els.registerShuttleTypeBtn.disabled, false);
assert.ok(messages.includes("球型号已登记，预估公式已更新"));

els.newShuttleTypeName.value = "重试球型"; els.newShuttleTypePrices.value = "15";
context.api = async () => { throw new Error("网络中断"); };
await context.registerShuttleType(event);
assert.equal(state.shuttleTypeSaving, false);
assert.equal(els.registerShuttleTypeBtn.disabled, false);
assert.equal(els.newShuttleTypeName.value, "重试球型");
assert.equal(els.newShuttleTypePrices.value, "15");
assert.equal(rows().length, 3, "failed registration preserves the current registry");
assert.ok(messages.includes("登记失败：网络中断"));
// Editing reuses the form, persists an explicit default, and keeps unsent registration drafts.
context.editShuttleType("rsl3");
assert.equal(els.newShuttleTypeName.value, "亚3");
assert.equal(els.newShuttleTypePrices.value, "11.3");
assert.equal(els.registerShuttleTypeBtn.textContent, "保存修改");
assert.equal(els.cancelShuttleTypeEditBtn.hidden, false);
const oldPrices = [...state.estimator.shuttleTypes[0].prices];
els.newShuttleTypePrices.value = "12.8";
context.api = async (path, options) => {
  assert.equal(path, "/api/estimator/shuttle-types/rsl3");
  assert.equal(options.method, "PATCH");
  assert.deepEqual(JSON.parse(options.body), { name: "亚3", defaultPrice: 12.8, expectedName: "亚3", expectedDefaultPrice: 11.3 });
  return { estimator: { ...state.estimator, trainingRevision: Number(state.estimator.trainingRevision || 0) + 1, shuttleTypes: state.estimator.shuttleTypes.map(type => type.id === "rsl3" ? { ...type, defaultPrice: 12.8 } : type) } };
};
await context.registerShuttleType(event);
assert.equal(state.shuttleTypeEdit, null);
assert.equal(els.newShuttleTypeName.value, "重试球型");
assert.equal(els.newShuttleTypePrices.value, "15");
assert.equal(els.shuttlePriceInput.value, "12.8");
assert.equal(state.advancedRows.shuttle[0].price, 12.8);
assert.deepEqual([...state.estimator.shuttleTypes[0].prices], oldPrices, "editing the default does not rewrite historical aliases");
assert.ok(rows()[0].children[1].textContent.includes("默认 12.80 元/颗"));
assert.equal(els.cancelShuttleTypeEditBtn.hidden, true);
// Preserve deliberate quotes and existing historical session amounts.
state.shuttlePriceUserOwned = true;
state.advancedRows.shuttle[0].priceUserOwned = true;
const previous = state.estimator;
state.estimator = { ...previous, shuttleTypes: previous.shuttleTypes.map(type => type.id === "rsl3" ? { ...type, defaultPrice: 14.5 } : type) };
context.syncShuttleDefaultPrices(previous);
assert.equal(els.shuttlePriceInput.value, "12.8");
assert.equal(state.advancedRows.shuttle[0].price, 12.8);
state.pendingSessionEdit = { id: 42 }; state.shuttlePriceUserOwned = false; state.advancedRows.shuttle[0].priceUserOwned = false;
const historical = state.estimator;
state.estimator = { ...historical, shuttleTypes: historical.shuttleTypes.map(type => type.id === "rsl3" ? { ...type, defaultPrice: 16 } : type) };
context.syncShuttleDefaultPrices(historical);
assert.equal(els.shuttlePriceInput.value, "12.8");
assert.equal(state.advancedRows.shuttle[0].price, 12.8);
state.pendingSessionEdit = null;
context.editShuttleType("rsl3");
els.newShuttleTypePrices.value = "16.001";
await context.registerShuttleType(event);
assert.ok(els.shuttleTypeFormError.textContent.includes("两位小数"));
assert.equal(state.shuttleTypeSaving, false);
els.newShuttleTypePrices.value = "18";
context.api = async () => { throw new Error("断网"); };
await context.registerShuttleType(event);
assert.equal(els.newShuttleTypePrices.value, "18");
assert.ok(els.shuttleTypeFormError.textContent.includes("保存失败"));
context.cancelShuttleTypeEdit();
assert.equal(els.newShuttleTypeName.value, "重试球型");
assert.equal(els.newShuttleTypePrices.value, "15");
assert.equal(state.shuttleTypeEdit, null);
state.estimator.shuttleTypes = [{ id: "plain", name: "<img src=x onerror=alert(1)>", prices: [] }];
render();
assert.equal(rows()[0].children[0].tagName, "DT");
assert.equal(rows()[0].children[0].children[0].textContent, "<img src=x onerror=alert(1)>");
assert.ok(rows()[0].children[1].textContent.includes("暂未登记价格"));
state.estimator.shuttleTypes = []; render();
assert.equal(els.registeredShuttleTypes.textContent, "暂无已登记球型");
// Startup defaults must agree with the HTML input, so a saved market price survives reload.
const initialStart = html.indexOf("    const DEFAULT_ESTIMATOR ="), initialEnd = html.indexOf("\n    };", initialStart) + 7;
const initialContext = vm.createContext({});
vm.runInContext(html.slice(initialStart, initialEnd) + "\nglobalThis.initial = DEFAULT_ESTIMATOR;", initialContext);
assert.equal(initialContext.initial.shuttleTypes.find(type => type.id === "rsl3").defaultPrice, 11.3);
state.shuttlePriceUserOwned = false; state.pendingSessionEdit = null; state.advancedRows = { shuttle: [] };
els.shuttlePriceInput.value = "11.3";
state.estimator = { ...defaultModel, shuttleTypes: [{ id: "rsl3", name: "亚3", prices: [11,11.3,11.5], defaultPrice: 18.5 }] };
context.syncShuttleDefaultPrices(initialContext.initial);
assert.equal(els.shuttlePriceInput.value, "18.5", "the initial 11.30 HTML price must be replaced by the persisted default");
console.log("Fee card passed: removed copy, fee-only registration, all registered prices, safe text, draft preservation, retained level groups, read-only protection, validation, duplicate-submit guard, success refresh, and retry preservation. No production data changed.");
