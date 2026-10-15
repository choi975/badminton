import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8").replaceAll("\r\n", "\n");
function source(name) {
  const start = html.search(new RegExp(`    (?:async )?function ${name}\\(`));
  assert.ok(start >= 0, `Missing production function: ${name}`);
  const end = html.indexOf("\n    }", start);
  assert.ok(end > start, `Missing function end: ${name}`);
  return html.slice(start, end + 6);
}
function load(names, dependencies) {
  return new Function(...Object.keys(dependencies), `${names.map(source).join("\n")}\nreturn { ${names.join(", ")} };`)(...Object.values(dependencies));
}
function declaration(name) {
  const match = html.match(new RegExp(`    const ${name} = [\\s\\S]*?;`));
  assert.ok(match, `Missing declaration: ${name}`);
  return match[0];
}
const config = new Function(`${["LEVELS", "GENDERS", "AFFILIATIONS", "COLUMNS", "DEFAULT_NEW_MEMBER"].map(declaration).join("\n")}\nreturn { LEVELS, GENDERS, AFFILIATIONS, COLUMNS, DEFAULT_NEW_MEMBER };`)();
const hiddenColumns = new Set(JSON.parse(html.match(/hiddenColumns: new Set\((\[[^\n]*\])\)/)[1]));
assert.deepEqual(config.COLUMNS.filter((column) => !hiddenColumns.has(column.key)).map((column) => column.label), [
  "名称", "性别", "中羽等级", "备注", "所属", "球友群序号", "Hytronik群序号",
]);
assert.ok(config.COLUMNS.some((column) => column.key === "description"), "Level descriptions remain available in the column menu");
assert.match(html, /id="columnVisibilityBtn"[^>]*aria-label="显示列"[^>]*>\s*<svg/);
assert.match(html, /id="newMemberBtn"[^>]*aria-keyshortcuts="Alt\+N"[^>]*>\s*<svg/);
assert.match(html, /\.table-tool-btn \{[^}]*width: 34px;[^}]*padding: 0;/);
assert.doesNotMatch(html, /createPlayerFromDraft|state\.draft|rowKey: "draft"|includeDraft|新建人物/);
const form = html.match(/<form id="memberCreateForm"[\s\S]*?<\/form>/)[0];
assert.deepEqual([...form.matchAll(/<(?:input|select|textarea)[^>]*\bname="([^"]+)"/g)].map((match) => match[1]), ["name", "gender", "level", "notes", "affiliation"]);
assert.match(form, /role="dialog" aria-modal="true" aria-labelledby="memberCreateTitle"/);
assert.match(form, /id="memberCreateError"[^>]*role="alert"/);
assert.match(html, /memberCreateForm\.addEventListener\("submit", submitNewMember\)/);
assert.match(source("focusSelectedCell"), /!isAnyModalOpen\(\)/, "Table updates must not steal modal focus");
assert.doesNotMatch(source("getDisplayRows"), /draft|rows\.push/);
assert.match(html, /#memberCreateModal \{ z-index: 100; \}/, "Member dialog must sit above the navigation sidebar on mobile");
assert.match(source("syncModalLayers"), /element\.inert = memberCreateOpen/, "Background navigation cannot receive focus while creating a member");
for (const script of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(script[1]);

function harness({ readOnly = false, dataSource = "cloud", visible = true } = {}) {
  const calls = { requests: [], toasts: [], sync: [], renders: 0, focus: null, scrolled: 0, orders: null };
  const state = { players: [], creatingPlayer: false, readOnly, dataSource, selected: { rowKey: "", col: 0 } };
  const control = (name) => ({
    name, value: "", disabled: false, hidden: false, textContent: "", attributes: {}, options: [],
    focus() { calls.focus = name; },
    setAttribute(key, value) { this.attributes[key] = value; },
    removeAttribute(key) { delete this.attributes[key]; },
    replaceChildren(...children) { this.options = children; },
  });
  const els = Object.fromEntries([
    "newMemberBtn", "memberNameInput", "memberGenderInput", "memberLevelInput", "memberNotesInput", "memberAffiliationInput", "memberCreateError", "saveMemberBtn",
  ].map((name) => [name, control(name)]));
  const controls = [els.memberNameInput, els.memberGenderInput, els.memberLevelInput, els.memberNotesInput, els.memberAffiliationInput, els.saveMemberBtn, control("cancel"), control("close")];
  const opened = new Set();
  els.memberCreateModal = { classList: { contains: (name) => opened.has(name) } };
  els.memberCreateForm = { ...control("form"), reset() { controls.forEach((item) => { item.value = ""; }); }, querySelectorAll: () => controls };
  els.databaseArea = { hidden: false };
  els.tableBody = { querySelector: () => ({ scrollIntoView() { calls.scrolled++; } }) };
  let response = async (member) => ({ player: { id: 71, ...member }, groupJoinNumbers: { "球友": [], Hytronik: [] } });
  const functions = load(["openMemberCreateModal", "setMemberCreateSaving", "submitNewMember"], {
    ...config, state, els,
    Option: class { constructor(text, value) { this.text = text; this.value = value; } },
    closeColumnVisibilityMenu() {}, closeMultiFilterMenus() {},
    openModal(id) { assert.equal(id, "memberCreateModal"); opened.add("open"); },
    closeModal(id) { assert.equal(id, "memberCreateModal"); opened.delete("open"); },
    toast(message) { calls.toasts.push(message); },
    setSync(message) { calls.sync.push(message); },
    async api(path, options) {
      calls.requests.push({ path, options });
      return response(JSON.parse(options.body));
    },
    applyPaymentOrderState(data) { calls.orders = data; },
    renderTable() { calls.renders++; },
    getDisplayRows: () => visible ? state.players.map((player) => ({ key: String(player.id), player })) : [],
    cssEscape: (value) => value,
    requestAnimationFrame: (callback) => callback(),
  });
  const event = { preventDefault() {} };
  return { ...functions, state, els, calls, controls, opened, event, setResponse: (fn) => { response = fn; } };
}

const h = harness();
h.openMemberCreateModal();
assert.ok(h.opened.has("open"));
assert.equal(h.calls.focus, "memberNameInput");
assert.equal(h.els.memberGenderInput.value, "男");
assert.equal(h.els.memberLevelInput.value, "不详");
assert.equal(h.els.memberAffiliationInput.value, "球友");
assert.deepEqual(h.els.memberLevelInput.options.map((option) => option.value), config.LEVELS);
assert.deepEqual(h.els.memberAffiliationInput.options.map((option) => option.value), config.AFFILIATIONS);
h.els.memberNameInput.value = "   ";
await h.submitNewMember(h.event);
assert.equal(h.calls.requests.length, 0);
assert.equal(h.els.memberNameInput.attributes["aria-invalid"], "true");
assert.match(h.els.memberCreateError.textContent, /名称/);
assert.ok(h.opened.has("open"));
h.els.memberNameInput.value = "  新成员  ";
h.els.memberGenderInput.value = "女";
h.els.memberLevelInput.value = "3.5级";
h.els.memberNotesInput.value = "  反手练习\n周末参与  ";
h.els.memberAffiliationInput.value = "球友+Hytronik";
h.openMemberCreateModal();
assert.equal(h.els.memberNameInput.value, "  新成员  ", "Opening twice must not reset an in-progress form");
assert.equal(h.calls.requests.length, 0, "Typing a name does not create or sort a table row");
let finish;
h.setResponse((member) => new Promise((resolve) => { finish = () => resolve({ player: { id: 72, ...member }, groupJoinNumbers: { "球友": [{ playerId: 72, joinNumber: 10 }], Hytronik: [{ playerId: 72, joinNumber: 8 }] } }); }));
const pending = h.submitNewMember(h.event);
assert.equal(h.state.creatingPlayer, true);
assert.ok(h.controls.every((control) => control.disabled));
assert.equal(h.els.memberCreateForm.attributes["aria-busy"], "true");
assert.equal(h.calls.renders, 0, "No table changes before all fields are saved");
await h.submitNewMember(h.event);
assert.equal(h.calls.requests.length, 1, "Double-submit sends only one request");
const guardedClose = load(["closeModal"], { state: h.state }).closeModal;
assert.doesNotThrow(() => guardedClose("memberCreateModal"), "Escape/backdrop cannot dismiss an in-flight save");
finish();
await pending;
assert.equal(h.state.creatingPlayer, false);
assert.ok(h.controls.every((control) => !control.disabled));
assert.equal(h.opened.size, 0);
assert.equal(h.state.players.length, 1);
assert.deepEqual(JSON.parse(h.calls.requests[0].options.body), { name: "新成员", gender: "女", level: "3.5级", notes: "反手练习\n周末参与", affiliation: "球友+Hytronik" });
assert.equal(h.calls.requests[0].path, "/api/players");
assert.equal(h.calls.requests[0].options.method, "POST");
assert.equal(h.calls.orders.groupJoinNumbers["球友"][0].joinNumber, 10);
assert.equal(h.state.selected.rowKey, "72");
assert.equal(h.calls.scrolled, 1);
h.openMemberCreateModal();
assert.equal(h.els.memberNameInput.value, "", "The next member starts with a clean form");
assert.equal(h.els.memberNotesInput.value, "");
assert.equal(h.els.memberGenderInput.value, "男");

const failed = harness();
failed.openMemberCreateModal();
failed.els.memberNameInput.value = "失败后保留姓名";
failed.els.memberNotesInput.value = "失败后保留备注";
failed.setResponse(async () => { throw new Error("服务暂不可用"); });
await failed.submitNewMember(failed.event);
assert.equal(failed.state.players.length, 0);
assert.ok(failed.opened.has("open"));
assert.equal(failed.els.memberNameInput.value, "失败后保留姓名");
assert.equal(failed.els.memberNotesInput.value, "失败后保留备注");
assert.match(failed.els.memberCreateError.textContent, /服务暂不可用.*已保留/);
assert.equal(failed.els.memberCreateError.hidden, false);
assert.equal(failed.state.creatingPlayer, false);
failed.setResponse(async (member) => ({ player: { id: 73, ...member } }));
await failed.submitNewMember(failed.event);
assert.equal(failed.state.players.length, 1, "A failed save can be retried without retyping");

for (const settings of [{ readOnly: true }, { dataSource: "loading" }, { dataSource: "cache" }, { dataSource: "snapshot" }]) {
  const blocked = harness(settings);
  blocked.openMemberCreateModal();
  assert.equal(blocked.opened.size, 0);
  await blocked.submitNewMember(blocked.event);
  assert.equal(blocked.calls.requests.length, 0, "Only cloud-connected management mode can create members");
}
const filtered = harness({ visible: false });
filtered.openMemberCreateModal();
filtered.els.memberNameInput.value = "不符合当前筛选";
await filtered.submitNewMember(filtered.event);
assert.equal(filtered.state.players.length, 1);
assert.match(filtered.calls.toasts.at(-1), /筛选条件/);
assert.equal(filtered.calls.scrolled, 0, "Do not scroll to an unrelated row when filters hide the created member");

let memberOpens = 0;
let ruleOpens = 0;
let modalOpen = false;
const shortcutEls = { databaseArea: { hidden: false }, shakePeopleModal: { classList: { contains: () => false } } };
const shortcut = load(["handleGlobalKeydown"], {
  els: shortcutEls, state: { editing: null, readOnly: false },
  isAnyModalOpen: () => modalOpen,
  isTextControl: () => true, document: { activeElement: {} },
  openMemberCreateModal() { memberOpens++; },
  openShortRuleModal() { ruleOpens++; },
}).handleGlobalKeydown;
const altN = (overrides = {}) => ({ key: "n", altKey: true, ctrlKey: false, metaKey: false, isComposing: false, preventDefault() {}, ...overrides });
shortcut(altN());
shortcut(altN({ key: "N" }));
assert.equal(memberOpens, 2, "Alt+N works while a database text field is focused, including uppercase N");
shortcut(altN({ ctrlKey: true }));
shortcut(altN({ isComposing: true }));
shortcutEls.databaseArea.hidden = true;
shortcut(altN());
assert.equal(memberOpens, 2, "Modified/IME shortcuts and other pages must not create members");
shortcutEls.databaseArea.hidden = false;
modalOpen = true;
shortcut(altN());
assert.equal(memberOpens, 2, "Alt+N does not reset or stack a member dialog");
shortcutEls.shakePeopleModal.classList.contains = () => true;
shortcut(altN());
assert.equal(ruleOpens, 1, "The shake-people Alt+N shortcut still creates a short-term rule");

console.log("Database UI passed: default columns, compact accessible tools, complete member form, stable editing, validation, atomic payload, duplicate-submit guard, failure/retry, focus, filtering, read-only protection, and context-aware Alt+N.");
