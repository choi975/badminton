import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import "../court-arrangement-core.js";
import { handleCourtArrangements } from "../src/court-arrangements.js";
const core = globalThis.BadmintonCourtArrangementCore;
const roster = Array.from({ length: 20 }, (_, i) => ({ key: "p-" + (i + 1), playerId: i + 1, name: i < 4 ? "ABCD"[i] : "球友" + (i + 1), level: i < 4 ? 2.5 : i < 12 ? 1 : 3.5 }));
const config = core.settings({ groups: [{ id: "social", name: "朋友", members: [1, 3] }] });
const courts = core.makeCourts(3).map((c, i) => ({ ...c, label: ["1", "2", "8"][i] }));
let activity = core.recommend(roster, config, { courts });
const allowed = courts.slice(0, 2).map((c) => c.id);
for (let i = 0; i < 4; i++) activity.assignments[roster[i].key] = { courtId: null, allowed: [...allowed], locked: true, roamingGroupId: i < 2 ? "flow-ab" : "flow-cd" };
activity.bundlePositions = { "flow-ab": { x: 32, y: 512 }, "flow-cd": { x: 528, y: 640 } };
activity.lineMode = "selected";
activity = core.validatePlan(activity);
const memberships = (value) => core.bundles(value).map((g) => [g.key, g.people.map((p) => p.name)]);
const expected = [["flow-ab", ["A", "B"]], ["flow-cd", ["C", "D"]]];
assert.deepEqual(memberships(activity), expected, "Equal destinations are not group identity");
assert.equal(activity.grouping, "independent-v1");
assert.equal(activity.lineMode, "bundled", "Legacy selected-only settings do not hide default connections");
assert.deepEqual(core.plan(activity), activity, "Normalization is stable, including group positions");
assert.deepEqual(core.settings(config).groups[0].members, [1, 3], "Roaming groups do not change long-term social groups");

// A batch destination edit retains both memberships and coordinates, even when it matches another group.
const updated = core.clone(activity);
for (const key of ["p-3", "p-4"]) updated.assignments[key].allowed = [courts[2].id];
assert.deepEqual(memberships(core.validatePlan(updated)), expected);
assert.deepEqual(updated.assignments["p-1"].allowed, allowed);
assert.deepEqual(core.validatePlan(updated).bundlePositions, activity.bundlePositions);
for (const key of ["p-3", "p-4"]) updated.assignments[key].allowed = [...allowed].reverse();
assert.deepEqual(memberships(core.validatePlan(updated)), expected, "Court order does not affect group identity");
assert.deepEqual(core.recommend(roster, config, updated).bundlePositions, activity.bundlePositions);
assert.deepEqual(memberships(core.recommend(roster, config, updated)), expected, "Manual groups survive a recommendation");
assert.deepEqual(memberships(core.reconcile(updated, roster, config)), expected, "Refresh does not regroup equal destinations");

const unlocked = core.clone(activity);
for (const person of roster.slice(0, 4)) unlocked.assignments[person.key].locked = false;
const suggested = core.recommend(roster, config, unlocked);
assert.deepEqual(memberships(suggested), expected, "Even automatic destination updates keep separate existing groups");
assert.deepEqual(suggested.bundlePositions, activity.bundlePositions);
assert.ok(core.bundles(suggested).every((g) => g.allowed.length === 3));
const added = core.reconcile(activity, [...roster, { key: "p-21", playerId: 21, name: "新报名", level: 2.5 }], config);
assert.equal(core.bundles(added).length, 3, "A new attendee is not silently joined to an existing group");
assert.deepEqual(memberships(added).slice(0, 2), expected);
const removed = core.reconcile(activity, roster.slice(2), config);
assert.deepEqual(memberships(removed), [expected[1]]);
assert.deepEqual(Object.keys(removed.bundlePositions), ["flow-cd"], "Empty groups and their positions are pruned");

// Individual edits and free cards split only the source group; they never merge with another group.
const split = core.clone(activity);
split.assignments["p-2"].allowed = [courts[2].id];
const normalizedSplit = core.validatePlan(split);
assert.equal(core.bundles(normalizedSplit).length, 3);
assert.notEqual(normalizedSplit.assignments["p-2"].roamingGroupId, "flow-ab");
assert.deepEqual(core.plan(normalizedSplit), normalizedSplit, "A split generates a stable ID once");
normalizedSplit.assignments["p-2"].allowed = [...allowed];
assert.equal(core.bundles(core.validatePlan(normalizedSplit)).length, 3, "Restoring destinations does not undo a split");
const free = core.clone(activity); free.assignments["p-2"].position = { x: 880, y: 720 };
const freePlan = core.validatePlan(free);
assert.notEqual(freePlan.assignments["p-2"].roamingGroupId, "flow-ab");
assert.deepEqual(core.recommend(roster, config, freePlan).assignments["p-2"].position, { x: 880, y: 720 });
delete freePlan.assignments["p-2"].position;
assert.equal(core.bundles(core.validatePlan(freePlan)).length, 3, "Returning a card to automatic layout does not merge memberships");
// Explicit joining is still allowed: membership changes only when the organizer chooses a target group.
freePlan.assignments["p-2"].roamingGroupId = "flow-cd";
assert.deepEqual(memberships(core.validatePlan(freePlan)), [["flow-ab", ["A"]], ["flow-cd", ["B", "C", "D"]]]);

// Upgrade older destination-keyed documents without moving visible groups or independent cards.
const legacy = core.clone(activity); delete legacy.grouping;
for (const person of legacy.roster) delete legacy.assignments[person.key].roamingGroupId;
for (const key of ["p-3", "p-4"]) legacy.assignments[key].allowed = [courts[1].id, courts[2].id];
legacy.bundlePositions = { [core.bundleKey(allowed)]: { x: 48, y: 512 }, [core.bundleKey([courts[1].id, courts[2].id])]: { x: 600, y: 688 } };
legacy.lineMode = "selected";
const migrated = core.validatePlan(legacy), migratedGroups = core.bundles(migrated);
assert.equal(migratedGroups.length, 2);
assert.deepEqual(migrated.bundlePositions[migratedGroups[0].key], { x: 48, y: 512 });
assert.deepEqual(migrated.bundlePositions[migratedGroups[1].key], { x: 600, y: 688 });
assert.equal(migrated.lineMode, "bundled");
assert.deepEqual(core.validatePlan(legacy), migrated, "Legacy upgrade is deterministic for idempotent retries");
for (const key of ["p-3", "p-4"]) migrated.assignments[key].allowed = [...allowed];
assert.equal(core.bundles(core.reconcile(migrated, roster, config)).length, 2);
legacy.assignments["p-2"].position = { x: 960, y: 800 };
const legacyFree = core.validatePlan(legacy);
assert.equal(core.bundles(legacyFree).length, 3);
assert.deepEqual(legacyFree.assignments["p-2"].position, { x: 960, y: 800 });

const invalidId = core.clone(activity); invalidId.assignments["p-1"].roamingGroupId = "__proto__";
assert.throws(() => core.validatePlan(invalidId), /分组标识/);
const invalidVersion = core.clone(activity); invalidVersion.grouping = "unknown";
assert.throws(() => core.validatePlan(invalidVersion), /分组版本/);
for (const bundlePositions of [{ "flow-unknown": { x: 32, y: 64 } }, { [core.bundleKey(allowed)]: { x: 32, y: 64 } }, { "flow-ab": { x: -1, y: 64 } }]) {
  assert.throws(() => core.validatePlan({ ...activity, bundlePositions }), /分组位置/);
}
const empty = core.clone(activity); empty.assignments["p-1"].allowed = [];
assert.throws(() => core.validatePlan(empty), /至少一个/);

// The production handler stores and returns independent memberships with its existing JSON document schema.
const sql = new DatabaseSync(":memory:");
sql.exec(readFileSync(new URL("../migrations/0031_court_arrangements.sql", import.meta.url), "utf8"));
const DB = { prepare(query) { return { args: [], bind(...args) { this.args = args; return this; }, async first() { return sql.prepare(query).get(...this.args) || null; } }; } };
const url = "https://badminton.choi975.workers.dev/api/court-arrangements";
const helpers = { json: (data, status = 200) => Response.json(data, { status }), rateLimit: async () => true, listPlayers: async () => roster };
const post = (body) => handleCourtArrangements(new Request(url, { method: "POST", headers: { origin: "https://choi975.github.io" }, body: JSON.stringify(body) }), { DB }, helpers);
const get = (date) => handleCourtArrangements(new Request(url + "?date=" + date), { DB }, helpers);
const body = { kind: "activity", date: "2026-11-18", revision: 0, mutationId: randomUUID(), content: activity };
let response = await post(body); assert.equal(response.status, 200);
let saved = (await response.json()).saved;
assert.deepEqual(memberships(saved.content), expected);
assert.deepEqual(saved.content.bundlePositions, activity.bundlePositions);
assert.equal((await (await post(body)).json()).saved.revision, 1, "Retries do not reassign IDs or increment versions");
response = await post({ ...body, revision: 1, mutationId: randomUUID(), content: updated }); assert.equal(response.status, 200);
saved = (await (await get(body.date)).json()).activity;
assert.equal(saved.revision, 2); assert.deepEqual(memberships(saved.content), expected);
assert.deepEqual(saved.content.bundlePositions, activity.bundlePositions);
assert.equal((await post({ ...body, mutationId: randomUUID() })).status, 409);
const legacyBody = { ...body, date: "2026-11-19", mutationId: randomUUID(), content: legacy };
assert.equal((await post(legacyBody)).status, 200);
assert.equal((await (await post(legacyBody)).json()).saved.revision, 1, "Legacy payload normalization is retry-safe");
assert.equal((await post({ ...body, date: "2026-11-20", mutationId: randomUUID(), content: invalidId })).status, 422);
sql.close();

const ui = readFileSync(new URL("../court-arrangement.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert.match(ui, /n\.addEventListener\("dblclick",.*openBundleEditor\(bundle.key\)/);
assert.match(ui, /function renderBundleInspector\(/);
assert.match(ui, /root\.lucide\.createElement\(glyph\)/, "Grips render stable SVG nodes for pointer/double-click interactions");
assert.match(ui, /captureTarget\.releasePointerCapture\(d.pointerId\)/);
assert.match(ui, /form\.addEventListener\("submit",/);
assert.match(ui, /for \(const person of group.people\).*allowed = \[\.\.\.allowed\]/);
assert.doesNotMatch(ui, /caFit|caLineMode|kind === "vertical"/);
assert.doesNotMatch(html, /id="(?:caFit|caLineMode)"|<option value="vertical">/);
assert.match(html, /id="caZoom"/); assert.match(html, /<option value="horizontal">横向排列/);
console.log("Independent roaming groups passed: batch destination edits, equal-destination pairs stay separate through normalize/refresh/recommend/save/retry, stable positions, individual splits and explicit joins, legacy upgrades, attendee changes, validation, D1 round-trips, and removed toolbar options.");