import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

const probabilityIndex = html.indexOf('id="groupProbability"');
const trialIndex = html.indexOf('id="attemptTrialModeBtn"');
const shakeIndex = html.indexOf('id="shakePeopleBtn"');
const pasteIndex = html.indexOf('id="pasteInputBtn"');
const levelModeIndex = html.indexOf('id="levelDisplayModeBtn"');
assert.ok(trialIndex > 0 && trialIndex < probabilityIndex && probabilityIndex < shakeIndex && shakeIndex < pasteIndex);
assert.match(html, /id="attemptTrialModeBtn"[^>]*aria-label="试算模式"[^>]*aria-pressed="false"[^>]*>\s*<i data-lucide="flask-conical"/);
assert.match(html, /id="shakePeopleBtn"[^>]*aria-label="摇人"[^>]*title="摇人"[^>]*>\s*<i data-lucide="dices"/);
assert.match(html, /id="pasteInputBtn"[^>]*aria-label="一键粘贴"[^>]*title="一键粘贴"[^>]*>\s*<i data-lucide="clipboard-paste"/);
assert.match(html, /id="levelDisplayModeBtn"[^>]*class="chain-icon-btn"[^>]*aria-label="精确等级显示，切换为分组"[^>]*aria-pressed="false"[^>]*>\s*<i data-lucide="arrow-left-right"/);
assert.doesNotMatch(html.slice(shakeIndex, pasteIndex), /🎲|摇人<\/button>/);
assert.ok(levelModeIndex > pasteIndex);
assert.doesNotMatch(html, /levelDisplayModeBtn\.textContent/);
assert.match(html, /levelDisplayModeBtn\.setAttribute\(\s*"aria-label",\s*grouped \? "分组显示，切换为精确等级" : "精确等级显示，切换为分组"/);
assert.match(html, /今天组局成功的概率：--%<\/span>\s*<span[^>]*>明天组局成功的概率：--%/);
assert.match(html, /\.group-probability-wrap:hover \.group-probability-tooltip/);
assert.match(html, /\.group-probability-wrap:focus-within \.group-probability-tooltip/);
assert.match(html, /id="attemptTrialToggle" type="checkbox"/);
assert.match(html, /trainingState: observation\.trainingState/);
assert.match(html, /chainInputUserOwned/);
assert.match(html, /attemptTrackingObservation\.trainingState = state\.attemptTrialRequested/);
assert.match(html, /includeCandidates: true/);
assert.match(html, /location\.pathname\.includes\("\/badminton-navigation-homepage\/"\)/);
assert.match(html, /activeGroupDate !== date[\s\S]*els\.chainInput\.value = ""[\s\S]*processChain\(\)/);

assert.match(html, /BadmintonGroupProbability/);
assert.match(html, /groupLearningSignals: state\.groupLearningSignals/);
assert.match(html, /scheduleGroupForecastRender\(\)/);
assert.match(html, /scheduleGroupAttemptSnapshot\("input"\)/);
assert.match(html, /scheduleGroupAttemptSnapshot\("paste"\)/);
assert.match(html, /scheduleGroupAttemptSnapshot\("companion"\)/);
assert.match(html, /scheduleGroupAttemptSnapshot\("rule_change"\)/);
assert.match(html, /knownPlayerIds/);
assert.match(html, /companionsByOwner/);
assert.match(html, /currentParticipantCount/);
assert.match(html, /className = "shake-person-add"/);
assert.match(html, /addShakePersonToChain\(item\.player, \{ focusNext: event\.detail === 0 \}\)/);
assert.match(html, /scheduleGroupAttemptSnapshot\("input"\);[\s\S]*renderShakePeopleModal\(\);/);
assert.doesNotMatch(html, /rawClipboard|chainInput\.value[^\n]*features/);

const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
assert.ok(inlineScripts.length > 0, "Expected an inline application script");
for (const script of inlineScripts) new vm.Script(script[1]);

const appendMemberStart = html.indexOf("function appendMemberToChainInput(");
const appendMemberEnd = html.indexOf("\n    function addShakePersonToChain(", appendMemberStart);
assert.ok(appendMemberStart >= 0 && appendMemberEnd > appendMemberStart, "Expected chain append helper");
const appendMemberContext = vm.createContext({});
vm.runInContext(`
const CHAIN_NUMBER_PREFIX = /^\\s*\\d+\\s*[\\.、\\):：-]\\s*/;
${html.slice(appendMemberStart, appendMemberEnd)}
globalThis.appendMemberToChainInput = appendMemberToChainInput;
`, appendMemberContext);
assert.equal(appendMemberContext.appendMemberToChainInput("", "甲"), "1. 甲");
assert.equal(appendMemberContext.appendMemberToChainInput("1. 甲\n3. 乙\n", "丙"), "1. 甲\n3. 乙\n4. 丙");
assert.equal(appendMemberContext.appendMemberToChainInput("甲\n乙", "丙"), "甲\n乙\n丙");

console.log("Group probability controls, accessibility, tracking triggers, and inline syntax checks passed.");
