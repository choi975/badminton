import "../roster-review.js";
import "../level-groups.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { loadPaymentFunctions } from "./payment-test-helpers.js";

const Review = globalThis.BadmintonRosterReview;
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const players = [
  { id: 1, name: "oi", level: "3.5级", gender: "男", affiliation: "球友", updatedAt: "2026-11-02 00:00:00" },
  { id: 2, name: "choi", level: "2.5级", gender: "男", affiliation: "特殊", updatedAt: "2026-11-02 00:00:00" },
  { id: 3, name: "羊", level: "不详", gender: "男", affiliation: "球友", updatedAt: "2026-11-02 00:00:00" },
  { id: 4, name: "Hx7", level: "3级", gender: "男", affiliation: "球友", updatedAt: "2026-11-02 00:00:00" },
  { id: 5, name: "1fan", level: "3级", gender: "男", affiliation: "球友", updatedAt: "2026-11-02 00:00:00" },
  { id: 6, name: "Hx", level: "2级", gender: "男", affiliation: "球友", updatedAt: "2026-11-02 00:00:00" },
  { id: 7, name: "四叶草", level: "3级", gender: "女", affiliation: "球友", updatedAt: "2026-11-02 00:00:00" },
];
const state = { players, plusOverrides: {}, chainEntries: [], readOnly: false, levelGroups: globalThis.BadmintonLevelGroups.normalize(null) };
const names = ["parseChainLine", "parseSharedChainLevelPrefix", "parsePlusEntryMetadata", "cleanChainLine", "findPlayerMatchForLine", "getPlayerById", "normalizePlayerId",
  "getMemberLineSuffix", "getLevelGroupLabel", "extractCompanionOwnerName", "paymentDisplayName", "firstName", "splitAliases", "normalizeAlias", "removeChainAnnotations", "levelRank",
  "buildAliasIndex", "normalizeRepeatedMemberEntries", "resolveChainEntryOwnership", "getChainEntryBaseName", "getChainEntryDisplayName", "getSessionOwnerKey", "projectSessionParticipants", "isRosterGradeReviewNeeded", "buildRosterReviewItems", "buildRosterReviewPlan"];
const source = names.map(name => {
  const start = html.indexOf(`    function ${name}(`), end = html.indexOf("\n    }", start);
  assert.ok(start >= 0 && end > start, "Production function " + name);
  return html.slice(start, end + 6);
}).join("\n");
const api = new Function("state", "RosterReview", "LevelGroups", "CHAIN_NUMBER_PREFIX", source + `\nreturn { ${names.join(",")} };`)(state, Review, globalThis.BadmintonLevelGroups, /^\s*\d+\s*[\.、\):：-]\s*/);
function roster(lines, overrides = {}) {
  state.plusOverrides = overrides;
  state.chainEntries = lines.map((line, index) => api.parseChainLine(line, index, api.buildAliasIndex(), "row-" + index, overrides["row-" + index]));
  api.normalizeRepeatedMemberEntries(state.chainEntries);
  api.resolveChainEntryOwnership(state.chainEntries, api.buildAliasIndex());
  return state.chainEntries;
}
function member(item, id, mode = "member") {
  item.mode = mode; item.playerId = id; item.profile = { ...players.find(p => p.id === id) };
  item.level = item.hint || item.profile.level;
  return item;
}
for (const [input, expected] of [["2.2", "2级"], ["2.25", "2级"], ["2.29999", "2级"], ["2.3", "2.5级"], ["2.5", "2.5级"], ["2.7", "2.5级"], ["2.75", "2.5级"], ["2.79999", "2.5级"], ["2.8", "3级"], ["3.2", "3级"], ["3.3", "3.5级"], ["5.3", "5.5级"], ["8.8", "9级"], ["０２．８级", "3级"], ["不详", "不详"]]) assert.equal(Review.normalizeLevel(input), expected, input);
for (const value of ["0.2", "9.8", "-3", "Infinity", "3级x"]) assert.equal(Review.normalizeLevel(value), null, value);
assert.equal(Review.parseLevelPrefix("【3】choi").normalizedLevel, "3级");
assert.equal(Review.parseLevelPrefix("【2.8级】choi").normalizedLevel, "3级");
for (const raw of ["oi1", "oi+1", "oi➕1", "【2.5】oi1"]) {
  const entry = roster([raw])[0];
  assert.equal(entry.plusEntry, true, raw);
  assert.equal(entry.ownerPlayer.id, 1);
  assert.equal(entry.player, null);
  assert.ok(entry.clean.includes("oi+1") || entry.clean.includes("oi➕1"));
  assert.equal(api.buildRosterReviewItems()[0].category, "companion");
}
assert.equal(roster(["【2.5级】oi1"])[0].levelText, "2.5级", "Guest grade never comes from oi's profile");
for (const [name, id] of [["Hx7", 4], ["1fan", 5]]) assert.equal(roster([name])[0].player.id, id, "Exact complete name beats numeric suffix");
assert.equal(roster(["Hx71"])[0].clean, "Hx7+1");
assert.equal(roster(["四叶草🍀1🌸"])[0].clean, "四叶草🍀+1🌸");
assert.equal(roster(["choi陌生外号"])[0].player, null, "No substring identity guessing");
assert.equal(roster(["【3.1级】1fan"])[0].levelText, "3级");
assert.equal(api.buildRosterReviewItems().length, 0, "Same standardized database grade needs no review");
roster(["【2.8】choi"]);
let item = api.buildRosterReviewItems()[0];
assert.equal(item.category, "level");
assert.equal(item.level, "3级");
assert.equal(players[1].level, "2.5级", "Parsing must never write the database");
assert.equal(api.buildRosterReviewPlan([item]).errors.size, 1, "Explicit yes/no is required");
item.update = "update";
let plan = api.buildRosterReviewPlan([item]);
assert.equal(plan.updates[0].level, "3级");
item.update = "keep";
plan = api.buildRosterReviewPlan([item]);
assert.equal(plan.updates.length, 0);
assert.equal(plan.resolutions[0].levelText, "3级", "No update keeps the source grade for this event");
roster(["羊"]);
item = api.buildRosterReviewItems()[0];
assert.equal(item.category, "level");
assert.equal(api.buildRosterReviewPlan([item]).errors.size, 1);
item.update = "keep";
assert.equal(api.buildRosterReviewPlan([item]).errors.size, 0, "Explicitly retaining unknown is allowed");
roster(["【3.3级】羊"]);
item = api.buildRosterReviewItems()[0]; item.update = "update";
assert.equal(api.buildRosterReviewPlan([item]).updates[0].level, "3.5级");
roster(["【2.8】新外号"]);
item = member(api.buildRosterReviewItems()[0], 2, "alias"); item.update = "update";
plan = api.buildRosterReviewPlan([item]);
assert.equal(plan.errors.size, 0);
assert.deepEqual(plan.updates[0].aliases, ["新外号"]);
assert.equal(plan.updates[0].level, "3级", "Alias and grade update are reviewed in the same row");
roster(["【2.3】新球友🌸", "【3.2】新特殊"]);
const newItems = api.buildRosterReviewItems();
newItems.forEach((item, index) => { item.mode = "new"; item.affiliation = index ? "特殊" : "球友"; });
plan = api.buildRosterReviewPlan(newItems);
assert.equal(plan.errors.size, 0);
assert.deepEqual(plan.creates.map(p => [p.name, p.level, p.affiliation]), [["新球友", "2.5级", "球友"], ["新特殊", "3级", "特殊"]]);
assert.equal(plan.creates[0].gender, "女");
roster(["陌生成员"]);
item = api.buildRosterReviewItems()[0];
assert.equal(api.buildRosterReviewPlan([item]).errors.size, 1, "Unknown people cannot bypass registration");
item.mode = "companion"; item.ownerId = 1;
assert.equal(api.buildRosterReviewPlan([item]).creates.length, 0, "Only a confirmed registered member's guest may remain unregistered");
assert.equal(api.buildRosterReviewPlan([item]).errors.size, 0);
assert.equal(api.buildRosterReviewPlan([item]).resolutions[0].gender,"不详","Identity confirmation does not guess a guest gender");
roster(["choi", "choi"], {"row-1": {levelText:"3.5级",reviewResolution:{kind:"member",playerId:1,ownerPlayerId:1,sourceLevel:null,databaseLevel:"3.5级",levelText:"3.5级",gender:"男"}}});
assert.equal(state.chainEntries[1].clean,"oi","Resolved repeated-name registrations display the actual participant");
assert.equal(state.chainEntries[1].ownerPlayerId,1);
roster(["oi", "oi1"]);
item = member(api.buildRosterReviewItems()[0], 2);
plan = api.buildRosterReviewPlan([item]);
assert.equal(plan.errors.size, 0);
const selected = plan.resolutions[0];
const resolution = { kind: "member", playerId: selected.playerId, ownerPlayerId: selected.playerId, sourceLevel: selected.sourceLevel,
  levelText: selected.levelText, databaseLevel: players[1].level, gender: "男" };
const overrides = { "row-1": { levelText: selected.levelText, gender: "男", reviewResolution: resolution } };
const resolved = roster(["oi", "oi1"], overrides)[1];
assert.equal(resolved.clean, "choi");
assert.equal(resolved.player.id, 2);
assert.equal(resolved.ownerPlayerId, 2);
assert.equal(resolved.ownerName, "choi");
assert.equal(resolved.isCompanion, false);
assert.equal(api.buildRosterReviewItems().length, 0, "Unchanged accepted decisions are not asked again");
const grouped = api.projectSessionParticipants([{playerId:2,playerName:"choi",ownerPlayerId:2,ownerName:"choi",isCompanion:false,slots:1,plusCount:0,amount:25}]);
assert.equal(grouped[0].ownerPlayerId,2);
assert.equal(grouped[0].ownerPresent,true);
assert.equal(grouped[0].guestCount,0,"Actual participant projection is a self attendance, not a guest");
const paymentState = { ...state, paymentOrders: {}, paymentSortModes: {}, paymentGroupOverrides: {} };
const payments = loadPaymentFunctions(["calculatePayment", "calculatePaymentRates", "shouldCountForPayment", "getSharedPaymentGroup", "canEntryUsePaymentGroup", "hasPlayerAffiliation", "getPlayerAffiliations", "getPaymentGroup",
  "isSpecialPlayer", "addPaymentLine", "mapToPaymentRows", "normalizePlayerId", "paymentDisplayName", "firstName", "splitAliases", "getChainEntryBaseName", "ceilTwoDecimals"],
  { state: paymentState, PAYMENT_GROUPS: { friends: "球友", heineken: "Hytronik" }, collator: new Intl.Collator("zh-CN", { numeric: true }) });
const result = payments.calculatePayment(state.chainEntries, 70, 5, 2, { mode: "discount", amount: 3.5 });
assert.equal(result.groups.special[0].playerId, 2);
assert.equal(result.groups.special[0].guestCount, 0);
assert.equal(result.groups.friends[0].playerId, 1);
assert.equal(result.groups.friends[0].slots, 1, "oi is not charged for choi");
roster(["choi", "oi1"]);
item = member(api.buildRosterReviewItems()[0], 2);
assert.match(api.buildRosterReviewPlan([item]).errors.get(item.key), /不能重复收款/);
roster(["【3】choi"], { "row-0": { levelText: "3级", reviewResolution: { ...resolution, sourceLevel: "3级", levelText: "3级" } } });
assert.equal(state.chainEntries[0].levelText, "3级");
assert.equal(api.buildRosterReviewItems().length, 0);
players[1].level = "2级";
roster(["【3】choi"], { "row-0": { levelText: "3级", reviewResolution: { ...resolution, sourceLevel: "3级", levelText: "3级" } } });
assert.equal(api.buildRosterReviewItems().length, 1, "Later database changes invalidate the level decision");
players[1].level = "2.5级";
const historical = { "row-0": { preserveSnapshot: true, playerId: 2, ownerPlayerId: 2, playerName: "choi", ownerName: "choi", levelText: "2级", gender: "男" } };
roster(["【3】choi"], historical);
assert.equal(state.chainEntries[0].levelText, "2级");
assert.equal(api.buildRosterReviewItems().length, 0, "Historical activity snapshots never update current profiles");
state.readOnly = true;
roster(["陌生人"]); item = api.buildRosterReviewItems()[0]; item.mode = "new";
assert.equal(api.buildRosterReviewPlan([item]).errors.size, 1);
state.readOnly = false;
players.push({id:8,name:"同名",level:"3级",gender:"男",affiliation:"球友"},{id:9,name:"同名",level:"3级",gender:"男",affiliation:"特殊"});
roster(["同名"]); item = api.buildRosterReviewItems()[0];
assert.equal(item.category,"ambiguous");
member(item,8);
assert.equal(api.buildRosterReviewPlan([item]).errors.size,0,"Ambiguous registered names can be resolved without creating or stealing an alias");
players.splice(-2);
for (const [, script] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) if (script.trim()) new vm.Script(script);
assert.match(html, /processChain\(\);\s*if \(maybeOpenRosterReview\(\)\) return;/);
assert.match(html, /id="rosterReviewModal"/);
assert.match(html, /id === "rosterReviewModal" && state\.rosterReviewSaving/);
console.log("Roster review: standardized grades, exact numeric names, required registration, one-row identity/grade decisions, actual-member payment ownership, duplicate protection, accepted decision reuse, read-only mode and historical snapshots passed.");



assert.match(html, /#rosterReviewModal \{ z-index: 100; \}/);
assert.match(html, /openIds.includes\("memberCreateModal"\) \|\| openIds.includes\("rosterReviewModal"\)/);
