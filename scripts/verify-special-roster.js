import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const fixture = readFileSync(new URL("./fixtures/mini-program-roster.txt", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const names = [
  "parseMiniProgramChain", "parseSharedChainLevelPrefix", "cleanChainLine", "getChainInputLines", "hasUnparenthesizedLockMarker",
  "processChain", "extractMiniProgramRoster", "parseChainLine", "parsePlusEntryMetadata", "getMemberLineSuffix",
  "getChainEntryBaseName", "getChainEntryDisplayName", "getChainLevelDisplay", "canEditChainEntryLevel", "formatChainOutputLine",
  "buildAliasIndex", "findPlayerMatchForLine", "removeChainAnnotations", "normalizeAlias", "splitAliases", "firstName", "paymentDisplayName",
  "getPlayerById", "normalizePlayerId", "extractCompanionOwnerName", "normalizeRepeatedMemberEntries", "resolveChainEntryOwnership",
  "levelRank", "getLevelGroupLabel", "renderChainOutput", "renderChainOutputMode", "createInlinePlusControls",
  "getInlinePlusLevelOptions", "getInlinePlusLevelLabel", "setInlinePlusLevel", "setInlinePlusGender",
  "renderChainLevelModeButton", "handleChainOutputAction", "toggleChainLevelMode",
];
function load(dependencies) {
  const sources = names.map(name => {
    const start=html.indexOf(`    function ${name}(`);
    const end=html.indexOf("\n    }",start);
    assert.ok(start >= 0 && end > start, `Production function ${name} exists`);
    return html.slice(start,end+6);
  });
  return new Function(...Object.keys(dependencies), sources.join("\n") + `\nreturn {${names.join(",")}};`)(...Object.values(dependencies));
}
const noop = () => {};
const node = () => ({
  children: [], attrs: {}, className: "", value: "", textContent: "", hidden: false,
  classList: { toggle: noop, remove: noop },
  append(...items) { this.children.push(...items); },
  replaceChildren(...items) { this.children = items; },
  setAttribute(name,value) { this.attrs[name] = value; },
  removeAttribute(name) { delete this.attrs[name]; },
  addEventListener(name,handler) { this[name] = handler; },
  focus() { this.focused=true; },
});
const state={
  players: [
    { id: 1, name:"困", level:"4.5级", gender:"男" },
    { id: 2, name:"Ni 姐姐", level:"2级", gender:"女" },
    { id: 3, name:"柚子", level:"2级", gender:"男" },
    { id: 4, name:"choi", level:"2.5级", gender:"男" },
    { id: 5, name:"四叶草", level:"3.5级", gender:"女" },
  ],
  chainEntries:[], plusOverrides:{}, chainLevelMode:"group", specialChain:null, specialChainSource:"", attemptTrialRequested:true,
};
const els={ chainInput:node(), extractRosterBtn:node(), chainOutput:node(), chainSpecialOutput:node(), levelDisplayModeBtn:node() };
const scheduled=[];
const deps={
  state, els, document:{createElement:node}, IS_GITHUB_PAGES:true,
  CHAIN_NUMBER_PREFIX:/^\s*\d+\s*[\.、\):：-]\s*/,
  SHARED_CHAIN_METADATA_PREFIXES:["组织者","活动时间","活动地点","收费类型","AA预收费用","已报名"],
  PLUS_LEVEL_LABELS:[["比赛级高手","6级"],["新手","2级"],["中手","3级"],["高手","4级"]],
  PLUS_GROUP_LEVEL_OPTIONS:[{label:"不详",level:"不详",text:"等级不详"},{label:"高手",level:"4级",text:"高手（4级）"}],
  LEVELS:["不详","1级","1.5级","2级","2.5级","3级","3.5级","4级","4.5级","5级","6级","9级"],
  estimateBooking:()=>({}), updateFeeDefaults:noop, renderChainStats:noop, updatePaymentButton:noop, resizeChainDialog:noop, scheduleGroupForecastRender:noop,
  scheduleGroupAttemptSnapshot:(trigger)=>scheduled.push({trigger,trial:state.attemptTrialRequested}),
  setChainOutputActionIcon:noop, toast:noop, copySpecialChainOutput:noop,
};
const api=load(deps);
const find=(name)=>state.chainEntries.find(entry=>entry.clean===name);
const text=(el)=>el.textContent + el.children.map(text).join("");
const all=(el)=>[el,...el.children.flatMap(all)];
const rowFor=(name)=>els.chainOutput.children.find(row=>row.children[0].textContent.includes(name));

els.chainInput.value=fixture;
api.processChain();
assert.equal(els.extractRosterBtn.disabled,false);
assert.equal(state.specialChain.participantLines.length,33);
assert.equal(els.chainOutput.hidden,true,"Original trimmed-share output stays available before extraction");
assert.ok(els.chainSpecialOutput.value.includes("【场地："));
assert.ok(els.chainSpecialOutput.value.includes("报名链接"));
const exactRoster=state.specialChain.participantLines.join("\n");
assert.equal(state.chainEntries.filter(e=>e.gender==="女").length,10);
assert.equal(state.chainEntries.filter(e=>e.gender==="男").length,23);
api.extractMiniProgramRoster();
assert.equal(els.chainInput.value,exactRoster,"Keep every name, bracket, marker, annotation, duplicate and original order");
assert.equal(state.chainEntries.length,33);
assert.equal(state.specialChain,null);
assert.equal(els.chainOutput.hidden,false);
assert.equal(els.chainSpecialOutput.hidden,true);
assert.equal(els.extractRosterBtn.disabled,true);
assert.equal(state.chainLevelMode,"exact");
assert.equal(state.attemptTrialRequested,true,"Extraction must not switch trial mode off");
assert.deepEqual(scheduled,[{trigger:"input",trial:true}]);
assert.equal(els.chainInput.focused,true);
assert.equal(find("困").levelText,"4.5级");
assert.match(rowFor("困（").children[0].textContent,/困（4\.5级）/);
assert.equal(find("Ni 姐姐🌸").levelText,"2级");
assert.equal(find("柚子🍀🌸").gender,"女","Flower overrides an existing male database gender");
for (const name of ["S","南汐"]) {
  const entry=find(name);
  assert.equal(entry.player,null);
  assert.equal(entry.gender,"男");
  assert.equal(entry.levelText,"不详");
  const row=rowFor(name);
  assert.ok(row.children[0].textContent.endsWith(name),"Unknown levels are represented by the dropdown, not duplicated text");
  assert.equal(all(row).filter(el=>el.className==="inline-level-select").length,1);
  assert.equal(all(row).filter(el=>el.className==="inline-gender-choice").length,0,"No gender guessing controls on shared roster");
}
assert.equal(els.chainOutput.children.length,33);
assert.equal(els.levelDisplayModeBtn.hidden,false,"GitHub users can switch exact/group display for an extracted roster");
const ranks=els.chainOutput.children.map(row=>{
  const name=row.children[0].textContent.replace(/^\d+\. /, "");
  return state.chainEntries.find(entry=>name.startsWith(api.getChainEntryDisplayName(entry)))?.sortRank;
});
assert.equal(els.chainOutput.children[0].children[0].textContent,"1. 困（4.5级）");
const sEntry=find("S");
api.setInlinePlusLevel(sEntry.overrideKey,"5级");
assert.equal(find("S").levelText,"5级");
assert.equal(els.chainInput.value,exactRoster,"Editing the middle-card level never rewrites the source");
assert.equal(els.chainOutput.children[0].children[0].textContent,"1. S（5级）","Manual level immediately affects sorting");
api.processChain();
assert.equal(find("S").levelText,"5级","Manual level survives rerenders");
api.extractMiniProgramRoster();
assert.equal(els.chainInput.value,exactRoster,"Repeated extraction does not delete a roster");
assert.equal(find("四叶草🍀1🌸").gender,"女");
assert.equal(find("四叶草🍀1").gender,"男","Repeated companions keep their own flower marker");
assert.equal(find("choi（左手男高）").gender,"男","Repeated registered names do not revert to unknown gender");
for(const name of ["困1🌸","choi1（零点的朋友）","choi2（pony boy）","choi3（北新）"]) {
  assert.equal(find(name).levelText,"不详","Numbered companions must not inherit owner or bracket level");
  assert.equal(find(name).player,null);
  assert.ok(find(name).ownerPlayerId);
}
api.setInlinePlusLevel(find("困1🌸").overrideKey,"3级");
assert.equal(find("困1🌸").gender,"女");
assert.equal(find("困1🌸").levelText,"3级");
api.handleChainOutputAction();
assert.equal(state.chainLevelMode,"group","Grouped mode remains available on GitHub");
assert.equal(find("S").levelText,"5级");
api.handleChainOutputAction();
assert.equal(state.chainLevelMode,"exact");

const aliasIndex=api.buildAliasIndex();
const parse=line=>api.parseChainLine(line,0,aliasIndex);
assert.equal(parse("1、【9级】Ni 姐姐").gender,"男","No flower means male even if the database says female");
assert.equal(parse("1、【9级】困+1中手🌸").levelText,"不详","All external level hints are ignored for shared companions");
assert.equal(parse("1、【9级】困1🌸").levelText,"不详","Absent owners do not leak their level into a numbered guest");
assert.equal(parse("1、【9级】困1🌸").player,null);
assert.equal(parse("1. 陌生人").gender,"不详","Ordinary rosters retain existing gender detection");
assert.equal(parse("1. Ni 姐姐").gender,"女");
assert.equal(parse("1. 困+1中手").levelText,"3级");
assert.equal(parse("1. 困+1中手").gender,"不详");
const preserved=api.parseChainLine("1、【9级】困",0,aliasIndex,"saved",{preserveSnapshot:true,playerId:1,levelText:"3级",gender:"女"});
assert.equal(preserved.levelText,"3级","Historical snapshot overrides stay authoritative");
assert.equal(preserved.gender,"女");
const before=els.chainInput.value;
els.chainInput.value="普通名单\n陌生人";
api.processChain();
api.extractMiniProgramRoster();
assert.equal(els.chainInput.value,"普通名单\n陌生人","Unrecognized input must never be deleted");
assert.equal(els.extractRosterBtn.disabled,true);
els.chainInput.value="";
api.processChain();
assert.equal(els.chainOutput.children.length,0);
assert.equal(els.extractRosterBtn.disabled,true);
assert.ok(before);
assert.match(html,/id="attemptTrialModeBtn"[^\n]*\n\s*<button id="extractRosterBtn"/);
assert.match(html,/els\.extractRosterBtn\.addEventListener\("click", extractMiniProgramRoster\)/);
console.log("Special roster: 33/33 rows retained, 23 male/10 female, database levels, editable unknown levels, repeat/numbered companions, sorting, trial mode, GitHub controls and ordinary-roster regression passed.");
