import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

const probabilityIndex = html.indexOf('id="groupProbability"');
const trialIndex = html.indexOf('id="attemptTrialModeBtn"');
const shakeIndex = html.indexOf('id="shakePeopleBtn"');
const pasteIndex = html.indexOf('id="pasteInputBtn"');
assert.ok(trialIndex > 0 && trialIndex < probabilityIndex && probabilityIndex < shakeIndex && shakeIndex < pasteIndex);
assert.match(html, /id="attemptTrialModeBtn"[^>]*aria-label="试算模式"[^>]*aria-pressed="false"[^>]*>\s*<i data-lucide="flask-conical"/);
assert.match(html, /id="shakePeopleBtn"[^>]*aria-label="摇人"[^>]*title="摇人"[^>]*>\s*<i data-lucide="dices"/);
assert.match(html, /id="pasteInputBtn"[^>]*aria-label="一键粘贴"[^>]*title="一键粘贴"[^>]*>\s*<i data-lucide="clipboard-paste"/);
assert.doesNotMatch(html.slice(shakeIndex, pasteIndex), /🎲|摇人<\/button>/);
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
assert.match(html, /scheduleGroupForecastRender\(\)/);
assert.match(html, /scheduleGroupAttemptSnapshot\("input"\)/);
assert.match(html, /scheduleGroupAttemptSnapshot\("paste"\)/);
assert.match(html, /scheduleGroupAttemptSnapshot\("companion"\)/);
assert.match(html, /scheduleGroupAttemptSnapshot\("rule_change"\)/);
assert.match(html, /knownPlayerIds/);
assert.match(html, /companionsByOwner/);
assert.match(html, /currentParticipantCount/);
assert.doesNotMatch(html, /rawClipboard|chainInput\.value[^\n]*features/);

const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
assert.ok(inlineScripts.length > 0, "Expected an inline application script");
for (const script of inlineScripts) new vm.Script(script[1]);

console.log("Group probability controls, accessibility, tracking triggers, and inline syntax checks passed.");
