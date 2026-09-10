import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../src/worker.js", import.meta.url), "utf8");
const start = source.indexOf("function normalizeIntegrationName");
const end = source.indexOf("async function syncTodoBadmintonCounter", start);
if (start < 0 || end < 0) throw new Error("Todo counter participant matcher was not found");

const context = vm.createContext({});
vm.runInContext(`${source.slice(start, end)}\nthis.sessionContainsExactChoi = sessionContainsExactChoi;`, context);

const containsChoi = context.sessionContainsExactChoi;
assert.equal(containsChoi({ players: [{ playerName: "choi", isCompanion: false, slots: 1, plusCount: 0 }] }), true);
assert.equal(containsChoi({ players: [{ playerName: " CHOI ", isCompanion: false, slots: 1, plusCount: 0 }] }), true);
assert.equal(containsChoi({ players: [{ playerName: "choi+1", isCompanion: true, slots: 1, plusCount: 0 }] }), false);
assert.equal(containsChoi({ players: [{ playerName: "choi代1", isCompanion: true, slots: 1, plusCount: 0 }] }), false);
assert.equal(containsChoi({ players: [{ playerName: "choi", isCompanion: false, slots: 1, plusCount: 1 }] }), false);
assert.equal(containsChoi({ players: [{ playerName: "choi朋友", isCompanion: false, slots: 1, plusCount: 0 }] }), false);

console.log("verify: todo badminton sync participant rules passed");
