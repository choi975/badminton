import "../roster-review.js";
import "../level-groups.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { loadPaymentFunctions } from "./payment-test-helpers.js";

const Review = globalThis.BadmintonRosterReview;
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const initialPlayers = [
  { id: 1, name: "oi", level: "3.5级", gender: "男", affiliation: "球友", updatedAt: "2026-11-02 00:00:00" },
  { id: 2, name: "choi", level: "2.5级", gender: "男", affiliation: "特殊", updatedAt: "2026-11-02 00:00:00" },
  { id: 3, name: "Hx7", level: "3级", gender: "男", affiliation: "球友", updatedAt: "2026-11-02 00:00:00" },
];
const state = { players: structuredClone(initialPlayers), plusOverrides: {}, chainEntries: [], readOnly: false,
  levelGroups: globalThis.BadmintonLevelGroups.normalize(null), rosterReview: null };
const names = ["parseChainLine", "parseSharedChainLevelPrefix", "parsePlusEntryMetadata", "cleanChainLine", "findPlayerMatchForLine", "getPlayerById", "normalizePlayerId",
  "getMemberLineSuffix", "getLevelGroupLabel", "extractCompanionOwnerName", "paymentDisplayName", "firstName", "splitAliases", "normalizeAlias", "removeChainAnnotations", "levelRank",
  "buildAliasIndex", "normalizeRepeatedMemberEntries", "resolveChainEntryOwnership", "getChainEntryBaseName", "getChainEntryDisplayName", "getSessionOwnerKey", "projectSessionParticipants",
  "isRosterGradeReviewNeeded", "buildRosterReviewItems", "buildRosterReviewPlan", "rosterReviewPendingMembers", "autoSelectRosterReviewPendingOwners", "rosterReviewMemberOptions",
  "renderRosterReviewRow", "rosterReviewSelect", "rosterReviewField", "rosterReviewOptions", "materializeRosterReviewResolutions", "escapeHtml"];
function production(name, async = false) {
  const start = html.indexOf(`    ${async ? "async " : ""}function ${name}(`), end = html.indexOf("\n    }", start);
  assert.ok(start >= 0 && end > start, "Production function " + name);
  return html.slice(start, end + 6);
}
const api = new Function("state", "RosterReview", "LevelGroups", "CHAIN_NUMBER_PREFIX", names.map(name => production(name)).join("\n") + `\nreturn { ${names.join(",")} };`)
  (state, Review, globalThis.BadmintonLevelGroups, /^\s*\d+\s*[\.、\):：-]\s*/);
function parse(lines, overrides = {}) {
  state.plusOverrides = overrides;
  state.chainEntries = lines.map((line, index) => api.parseChainLine(line, index, api.buildAliasIndex(), "row-" + index, overrides["row-" + index]));
  api.normalizeRepeatedMemberEntries(state.chainEntries);
  api.resolveChainEntryOwnership(state.chainEntries, api.buildAliasIndex());
}
function roster(lines) {
  state.players = structuredClone(initialPlayers); state.readOnly = false;
  parse(lines);
  const items = api.buildRosterReviewItems();
  state.rosterReview = { items, input: lines.join("\n"), overrides: "{}", requestId: "", payload: "" };
  return items;
}
function create(item, name = item.name, affiliation = "球友") {
  item.mode = "new"; item.name = name; item.affiliation = affiliation;
  return item;
}
function markup(item) {
  const row = { innerHTML: "", querySelectorAll: () => [] };
  api.renderRosterReviewRow(row, item);
  return row.innerHTML;
}
const pending = [{ key: "li", name: "刘", aliases: [] }];
for (const text of ["刘1", "刘+1", "刘＋１🌸", "刘➕1", "刘+一", "刘代1", "刘加1", "刘 1（新手）"]) {
  assert.equal(Review.findPendingCompanion(text, pending)?.key, "li", text);
}
for (const text of ["刘", "刘+0", "刘0", "刘嘉欣1", "Jack刘1", "刘1朋友", "Hx7", "1刘", "刘+1+1"]) {
  assert.equal(Review.findPendingCompanion(text, pending), null, "Never guess " + text);
}
assert.equal(Review.findPendingCompanion("刘1", [...pending, { key: "literal", name: "刘1" }]), null, "Complete draft numeric name wins");
assert.equal(Review.findPendingCompanion("刘1", [...pending, { key: "other", name: "刘" }]), null, "Duplicate draft names need manual confirmation");
assert.deepEqual(Review.findPendingCompanion("Hx71", [{ key: "hx", name: "Hx" }, { key: "hx7", name: "Hx7" }]), { key: "hx7", suffix: "1" }, "Longest name wins");

let items = roster(["【2.5级】刘🌸", "【3级】刘1🌸"]);
assert.equal(items[1].category, "unknown");
assert.equal(api.autoSelectRosterReviewPendingOwners(items).size, 0, "Do not guess until a new member is explicitly chosen");
create(items[0], "刘", "特殊");
assert.equal(api.autoSelectRosterReviewPendingOwners(items).size, 1);
assert.equal(items[1].mode, "companion");
assert.equal(items[1].ownerId, "new:entry-0");
assert.equal(items[1].level, "3级", "Guest level does not inherit the new owner's grade");
assert.equal(items[1].companionGender, "女");
assert.match(markup(items[1]), /本次待新增/);
assert.match(markup(items[1]), /已根据报名预选，可更改/);
assert.ok(api.rosterReviewMemberOptions(items[1], "ownerId").some(([value,label]) => value === "new:entry-0" && label.includes("刘") && label.includes("特殊")));
items[0].name = "小刘"; items[0].affiliation = "球友"; items[0].level = "2级";
api.autoSelectRosterReviewPendingOwners(items);
assert.equal(items[1].ownerId, "new:entry-0", "Renames never break a stable draft reference");
items[1].memberSearch = "刘";
assert.ok(api.rosterReviewMemberOptions(items[1], "ownerId").some(([value,label]) => value === "new:entry-0" && label.includes("小刘 · 2级 · 球友")));
let plan = api.buildRosterReviewPlan(items);
assert.equal(plan.errors.size, 0);
assert.equal(plan.creates.length, 1, "Only the actual new owner is added to the database");
assert.deepEqual(plan.creates[0].aliases, ["刘"]);
assert.equal(plan.resolutions[1].ownerCreateKey, "entry-0");
assert.equal(plan.resolutions[1].companionSuffix, "1");
const profiles = [...initialPlayers, { id: 81, name: "小刘，刘", level: "2级", gender: "女", affiliation: "球友" }];
const saved = api.materializeRosterReviewResolutions(plan.resolutions, [{ key: "entry-0", playerId: 81 }], profiles);
assert.equal(saved[0].playerId, 81);
assert.equal(saved[1].playerId, null);
assert.equal(saved[1].ownerPlayerId, 81);
assert.equal(saved[1].companionName, "小刘+1");
assert.equal(saved[1].levelText, "3级");
assert.equal(saved[1].gender, "女");
assert.throws(() => api.materializeRosterReviewResolutions(plan.resolutions, [], profiles), /保存结果缺少/, "A missing owner receipt can never create an unowned guest");
state.players = profiles;
const overrides = Object.fromEntries(saved.map(({ overrideKey, ...resolution }) => [overrideKey, { levelText: resolution.levelText, gender: resolution.gender, reviewResolution: resolution }]));
parse(["【2.5级】刘🌸", "【3级】刘1🌸"], overrides);
assert.equal(state.chainEntries[1].raw, "【3级】刘1🌸");
assert.equal(state.chainEntries[1].clean, "小刘+1");
assert.equal(state.chainEntries[1].ownerPlayerId, 81);
assert.equal(state.chainEntries[1].player, null);
assert.equal(state.chainEntries[1].isCompanion, true);
assert.equal(api.buildRosterReviewItems().length, 0, "Saved new owner and guest are not asked again in the same activity");
const payments = loadPaymentFunctions(["calculatePayment", "calculatePaymentRates", "shouldCountForPayment", "getSharedPaymentGroup", "canEntryUsePaymentGroup", "hasPlayerAffiliation", "getPlayerAffiliations", "getPaymentGroup",
  "isSpecialPlayer", "addPaymentLine", "mapToPaymentRows", "normalizePlayerId", "paymentDisplayName", "firstName", "splitAliases", "getChainEntryBaseName", "ceilTwoDecimals"],
  { state: { ...state, paymentOrders: {}, paymentSortModes: {}, paymentGroupOverrides: {} }, PAYMENT_GROUPS: { friends: "球友", heineken: "Hytronik" }, collator: new Intl.Collator("zh-CN", { numeric: true }) });
const payment = payments.calculatePayment(state.chainEntries, 70, 5, 2, { mode: "discount", amount: 3.5 });
assert.equal(payment.groups.friends[0].playerId, 81);
assert.equal(payment.groups.friends[0].slots, 2);
assert.equal(payment.groups.friends[0].guestCount, 1);
const attendance = api.projectSessionParticipants([{ playerId: 81, playerName: "小刘", ownerPlayerId: 81, ownerName: "小刘", isCompanion: false, slots: 1, plusCount: 0, amount: 40 },
  { playerId: null, playerName: "小刘+1", ownerPlayerId: 81, ownerName: "小刘", isCompanion: true, slots: 1, plusCount: 0, amount: 40 }]);
assert.equal(attendance[0].ownerPresent, true);
assert.equal(attendance[0].guestCount, 1);
assert.equal(attendance[0].participantCount, 2);

items = roster(["刘1", "刘", "【2级】赵+1", "赵", "刘+2"]);
create(items[1], "刘", "特殊"); create(items[3], "赵");
api.autoSelectRosterReviewPendingOwners(items);
assert.equal(items[0].ownerId, "new:entry-1", "A guest may appear before its new owner");
assert.equal(items[2].ownerId, "new:entry-3");
assert.equal(items[4].ownerId, "new:entry-1");
assert.equal(items[0].companionGender, "不详", "No guest gender is guessed from the owner's default");
plan = api.buildRosterReviewPlan(items);
assert.equal(plan.errors.size, 0);
const multipleProfiles = [...initialPlayers, { id: 92, name: "赵", level: "不详", gender: "男", affiliation: "球友" }, { id: 88, name: "刘", level: "不详", gender: "男", affiliation: "特殊" }];
const multiple = api.materializeRosterReviewResolutions(plan.resolutions, [{ key: "entry-3", playerId: 92 }, { key: "entry-1", playerId: 88 }], multipleProfiles);
assert.deepEqual(multiple.map(item => item.ownerPlayerId), [88, 88, 92, 92, 88], "Use receipt keys, never row order or insert order");
assert.equal(multiple[4].companionName, "刘+2");
items[0].ownerId = 1; items[0].ownerTouched = true; items[0].autoOwnerKey = "";
api.autoSelectRosterReviewPendingOwners(items);
assert.equal(items[0].ownerId, 1, "Automatic suggestions never overwrite a manual existing owner");
items[2].companionGender = "女";
assert.equal(api.buildRosterReviewPlan(items).resolutions.find(item => item.overrideKey === "row-2").gender, "女", "Guest gender is explicitly editable");
items[3].mode = "member"; items[3].playerId = 2; items[3].profile = structuredClone(initialPlayers[1]); items[3].level = "2.5级";
api.autoSelectRosterReviewPendingOwners(items);
assert.equal(items[2].ownerId, "new:entry-3", "A cancelled draft must not silently switch ownership");
assert.match(api.buildRosterReviewPlan(items).errors.get(items[2].key), /已取消新增/);
assert.ok(api.rosterReviewMemberOptions(items[2], "ownerId").some(([value,label,disabled]) => value === "new:entry-3" && disabled && label.includes("已取消")));

items = roster(["刘", "刘1"]);
create(items[0]); items[0].level = "not-a-level";
items[1].mode = "companion"; items[1].ownerId = "new:entry-0";
plan = api.buildRosterReviewPlan(items);
assert.match(plan.errors.get(items[1].key), /请先完成第 1 行的新成员资料/);
items[0].level = "2级"; state.readOnly = true;
assert.match(api.buildRosterReviewPlan(items).errors.get(items[1].key), /管理版/);
assert.ok(api.rosterReviewMemberOptions(items[1], "ownerId").some(([value,,disabled]) => value === "new:entry-0" && disabled));
state.readOnly = false;
items[0].name = "";
assert.match(api.buildRosterReviewPlan(items).errors.get(items[1].key), /资料未填写/);
items[0].name = "choi";
assert.ok(api.buildRosterReviewPlan(items).errors.size >= 2, "Duplicate new member names also invalidate dependent guests");
items[1].ownerId = "new:" + items[1].key;
assert.match(api.buildRosterReviewPlan(items).errors.get(items[1].key), /重新选择带来者/, "A guest can never be its own new owner");

items = roster(["Hx", "【2.8级】Hx7", "Hx71"]);
create(items[0]);
api.autoSelectRosterReviewPendingOwners(items);
assert.equal(state.chainEntries[1].player.id, 3, "Complete registered numeric names retain their actual identity");
assert.ok(!items.some(item => item.entry.index === 1), "A complete registered numeric name at the same grade needs no identity question");
assert.equal(items.find(item => item.entry.index === 2).ownerId, 3, "Registered complete names beat a shorter draft prefix");
items = roster(["刘", "刘1"]); create(items[0]); create(items[1], "刘1");
assert.equal(api.autoSelectRosterReviewPendingOwners(items).size, 0, "An explicitly chosen numeric new member is not converted into a guest");
items[1].mode = "member"; items[1].playerId = 2;
assert.equal(api.autoSelectRosterReviewPendingOwners(items).size, 0, "An explicit actual-member decision wins over inferred plus-one ownership");
items = roster(["刘", "【2级】刘🌸", "刘1"]); create(items[0]); create(items[1], "刘");
assert.equal(api.autoSelectRosterReviewPendingOwners(items).size, 0, "Ambiguous pending names are not automatically selected");

items = roster(["刘", "【2级】刘🌸", "刘1"]); create(items[0]); api.autoSelectRosterReviewPendingOwners(items);
assert.equal(items[2].ownerId, "new:entry-0"); create(items[1], "刘"); api.autoSelectRosterReviewPendingOwners(items);
assert.equal(items[2].ownerId, null, "A formerly unique automatic match is withdrawn if another draft makes it ambiguous");
items = roster(["阿", "阿7", "阿71"]); create(items[0]); api.autoSelectRosterReviewPendingOwners(items);
assert.equal(items[2].ownerId, "new:entry-0"); create(items[1], "阿7"); api.autoSelectRosterReviewPendingOwners(items);
assert.equal(items[2].ownerId, "new:entry-1", "Unconfirmed automatic matches follow the newly available complete numeric owner name");

// Exercise the real confirmation and retry control flow with keyed IDs returned by the profile API.
items = roster(["【3级】刘1🌸", "【2.5级】刘🌸"]); create(items[1], "刘", "特殊"); api.autoSelectRosterReviewPendingOwners(items);
items[1].notes = "喜欢双打 🌸\n周末参加";
const requestBodies = [], controls = [{ disabled: false }];
const elements = { chainInput: { value: state.rosterReview.input }, rosterReviewConfirmBtn: { disabled: false }, rosterReviewMessage: {}, rosterReviewList: { querySelector: () => ({}) } };
const fakeDocument = { getElementById: () => ({ querySelectorAll: () => controls }) };
let opened = 0, fail = true;
const confirmSource = production("confirmRosterReview", true);
const confirm = new Function("state", "els", "document", "buildRosterReviewPlan", "materializeRosterReviewResolutions", "api", "applyPaymentOrderState", "renderTable", "setSync", "closeModal", "processChain", "scheduleGroupAttemptSnapshot", "openPaymentModal", "renderRosterReviewRow",
  confirmSource + "\nreturn confirmRosterReview;")(state, elements, fakeDocument, api.buildRosterReviewPlan, api.materializeRosterReviewResolutions,
  async (_, options) => { requestBodies.push(JSON.parse(options.body)); if (fail) throw new Error("Injected lost response");
    return { players: [...initialPlayers, { id: 105, name: "刘", level: "2.5级", gender: "女", affiliation: "特殊", notes: items[1].notes }], createdPlayers: [{ key: "entry-1", playerId: 105 }] }; },
  () => {}, () => {}, () => {}, () => {}, () => parse(elements.chainInput.value.split("\n"), state.plusOverrides), () => {}, () => { opened++; }, () => {});
await confirm();
assert.equal(opened, 0);
assert.equal(state.players.length, initialPlayers.length);
assert.deepEqual(state.plusOverrides, {});
assert.equal(state.rosterReview.items[0].ownerId, "new:entry-1");
assert.match(elements.rosterReviewMessage.textContent, /核对选择已保留/);
assert.equal(state.rosterReview.items[1].notes, "喜欢双打 🌸\n周末参加", "Failed saves retain the new member note in its draft");
assert.equal(controls[0].disabled, false);
fail = false;
await confirm();
assert.equal(requestBodies[0].requestId, requestBodies[1].requestId, "Lost-response retries reuse the durable request id");
assert.equal(requestBodies[1].creates.length, 1);
assert.equal(requestBodies[1].creates[0].name, "刘");
assert.equal(requestBodies[1].creates[0].notes, "喜欢双打 🌸\n周末参加");
assert.equal(requestBodies[0].creates[0].notes, requestBodies[1].creates[0].notes, "Lost-response retries send identical member notes");
assert.equal(state.players.find(player => player.id === 105).notes, requestBodies[1].creates[0].notes);
assert.equal(opened, 1);
assert.equal(state.chainEntries[0].ownerPlayerId, 105);
assert.equal(state.chainEntries[0].isCompanion, true);
assert.equal(state.chainEntries[0].player, null);
assert.equal(state.chainEntries[1].player.id, 105);
assert.equal(api.buildRosterReviewItems().length, 0);
for (const [, script] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) if (script.trim()) new vm.Script(script);
console.log("Pending roster review passed: live new-owner choices, conservative suffix matching, exact numeric names, stable renamed drafts, multiple/preceding guests, independent profiles, keyed receipt binding, payment/attendance ownership, missing receipt safety, validation/read-only guards and idempotent retry.");
