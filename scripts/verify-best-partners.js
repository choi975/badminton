import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import "../member-statistics.js";
const core = globalThis.BadmintonMemberStatistics;
const fixture = JSON.parse(readFileSync(new URL("./fixtures/best-partners-2026-10-22.json", import.meta.url), "utf8"));
const real = core.buildBestPartners({ ...fixture, includeDiagnostics: true });
for (const expected of fixture.expected) {
  const pair = real.diagnostics.find((p) => expected.ids.every((id) => p.playerIds.includes(id)));
  assert.ok(pair, `Missing regression evidence for ${expected.ids}`);
  assert.equal(pair.qualified, expected.qualified, pair.names.join(" / "));
  assert.equal(pair.togetherSessions, expected.together);
  console.log(`${pair.names.join(" ↔ ")}: ${pair.qualified ? "qualified" : "excluded"}, ${pair.togetherDays} shared days, score ${pair.score}`);
}
assert.deepEqual(core.buildBestPartners({ ...fixture, sessions: [...fixture.sessions].reverse(), players: [...fixture.players].reverse() }).pairs, real.pairs, "input ordering must not change ranking");
assert.deepEqual(core.buildBestPartners({ ...fixture, sessions: [...fixture.sessions, ...fixture.sessions] }).pairs, real.pairs, "duplicate API rows must not inflate evidence");
assert.ok(real.pairs.every((p) => p.playerIds[0] < p.playerIds[1] && Number.isFinite(p.score)));
assert.ok(real.pairs.every((p, i) => !i || p.score <= real.pairs[i - 1].score));
const productionSource = readFileSync(new URL("../member-statistics.js", import.meta.url), "utf8");
for (const name of ["阿恒", "柚子", "甲乙丙", "翠萍", "Rocket"]) assert.ok(!productionSource.includes(name), "no name-specific overrides in production");

const asOf = "2026-09-24", calendar = { knownYears: [2026], excludedDates: [] };
const start = core.addDays(asOf, -89);
const players = [{ id: 1, name: "A", createdAt: "2026-06-01" }, { id: 2, name: "B", createdAt: "2026-06-01" }];
const self = (id) => ({ playerId: id, slots: 1, plusCount: 0 });
const booking = (id, date, ids) => ({ id, date, players: [...ids.map(self), { playerId: null, isCompanion: true, slots: 1, plusCount: 1 }] });
const makeSessions = (choose) => Array.from({ length: 90 }, (_, i) => {
  const date = core.addDays(start, i); return booking(i + 1, date, choose(i, date));
});
const build = (sessions, overrides = {}) => core.buildBestPartners({ players, sessions, asOf, calendar, includeDiagnostics: true, ...overrides });
const strong = makeSessions((i) => i % 5 < 2 ? [1, 2] : i % 5 === 2 ? [1] : []);
assert.equal(build(strong).pairs.length, 1, "repeat coattendance across variable weekdays is eligible");
const dailyStar = makeSessions((i) => i % 5 < 2 ? [1, 2] : [1]);
assert.equal(build(dailyStar).pairs.length, 0, "a daily player cannot become everyone's partner");
const independent = makeSessions((i) => [...(i % 2 ? [1] : []), ...(Math.floor(i / 2) % 2 ? [2] : [])]);
assert.equal(build(independent).pairs.length, 0, "independent attendance is not a relationship");
const saturdayOnly = makeSessions((i, date) => new Date(date).getUTCDay() === 6 ? [1, 2] : []);
const saturdayResult = build(saturdayOnly);
assert.equal(saturdayResult.pairs.length, 0, "identical fixed-weekday availability is not enough");
assert.equal(saturdayResult.diagnostics[0].weekdayAdjusted.aLift, 0);
const commonBurst = makeSessions((i) => i >= 60 ? [1, 2] : []);
assert.equal(build(commonBurst).pairs.length, 0, "a common 30-day activity burst is not enough");
assert.equal(build(makeSessions((i) => i < 20 ? [1, 2] : [])).pairs.length, 0, "both members must still be active in the last 30 days");
assert.equal(build(makeSessions((i) => i >= 87 ? [1, 2] : [])).pairs.length, 0, "three coincidental games cannot become 100%-confidence friendship");
const oneDay = Array.from({ length: 25 }, (_, i) => booking(i + 1, asOf, [1, 2]));
assert.equal(build(oneDay).pairs.length, 0, "25 bookings on one date are still one evidence day");
const separate = Array.from({ length: 30 }, (_, i) => core.addDays(asOf, -i)).flatMap((date, i) => [booking(i * 2 + 1, date, [1]), booking(i * 2 + 2, date, [2])]);
assert.equal(build(separate).pairs.length, 0, "playing different sessions on the same day is not playing together");
const duplicatedDays = strong.flatMap((s) => [s, { ...s, id: s.id + 1000 }]);
const originalPair = build(strong).pairs[0], doublePair = build(duplicatedDays).pairs[0];
assert.equal(doublePair.score, originalPair.score, "same-day sessions have at most one day of statistical weight");
assert.equal(doublePair.togetherDays, originalPair.togetherDays);
assert.equal(doublePair.togetherSessions, originalPair.togetherSessions * 2, "raw explanatory counts still refer to real sessions");
for (const absentRow of [
  { playerId: 1, slots: 2, plusCount: 2 },
  { playerId: 1, slots: 1, plusCount: 0, isCompanion: true },
  { player_id: 1, slots: 1, plus_count: 0, is_companion: "1" },
]) {
  const guestOnly = strong.map((s) => ({ ...s, players: s.players.map((p) => p.playerId === 1 ? absentRow : p) }));
  assert.equal(build(guestOnly).pairs.length, 0, "a companion cannot stand in for an absent owner");
}
const laterRegistration = players.map((p) => ({ ...p, createdAt: "2026-09-10" }));
assert.equal(build(strong, { players: laterRegistration }).pairs[0].raw.total, originalPair.raw.total, "earlier real attendance overrides a late profile registration date");
const newStart = "2026-09-01";
const afterJoin = strong.filter((s) => s.date >= newStart);
const newPlayers = players.map((p) => ({ ...p, createdAt: newStart }));
const withBeforeJoin = [...strong.filter((s) => s.date < newStart).map((s) => ({ ...s, players: [self(1)] })), ...afterJoin];
assert.deepEqual(build(withBeforeJoin, { players: newPlayers }).pairs, build(afterJoin, { players: newPlayers }).pairs, "pre-membership absence must not create false association");
const outside = [booking(1001, core.addDays(start, -1), [1, 2]), booking(1002, core.addDays(asOf, 1), [1, 2]), booking(1003, core.addDays(asOf, 2), [1, 2])];
assert.deepEqual(build([...strong, ...outside]).pairs, build(strong).pairs, "90-day endpoints exclude old and future sessions");
assert.equal(build(strong).pairs[0].start, start);
assert.deepEqual(build([]).pairs, []);

// Execute the actual calendar helper: it keeps its historical coattendance meaning.
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const calendarCode = html.slice(html.indexOf("    function getBestPartnerIdsMap("), html.indexOf("    function subtractCalendarMonth("));
const calendarContext = vm.createContext({}); vm.runInContext(calendarCode, calendarContext);
const counts = calendarContext.getBestPartnerIdsMap([
  booking(1, asOf, [1, 2]), booking(2, asOf, [1, 2, 3]), booking(3, asOf, [1, 3, 3]), booking(4, asOf, [4]),
]);
assert.deepEqual(Array.from(counts.get(1)), [2, 3]);
assert.deepEqual(Array.from(counts.get(4)), []);
assert.match(html, /key: "bestPartners", label: "最佳拍档"/);

// Render real UI functions with a minimal DOM; all member names must remain plain text.
class Element {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this._text = ""; this.dataset = {}; this.open = false; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); }
  setAttribute(key, value) { this[key] = value; }
  addEventListener() {}
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; this._text = ""; }
  querySelectorAll(selector) { const name = selector.slice(1).replace("[open]", ""); return this.children.flatMap((c) => [c, ...c.querySelectorAll("*")]).filter((c) => selector === "*" || ((c.className || "").split(" ").includes(name) && (!selector.includes("[open]") || c.open))); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
const rendered = new Element("div");
const statistics = core.build({ ...fixture, now: "2026-10-23T00:00:00+08:00", asOf: fixture.asOf });
const context = vm.createContext({ state: { readOnly: true, partnerSaving: false, partnerDraft: null, partnerStatus: "" }, window: {}, document: { createElement: (tag) => new Element(tag) }, els: { shakeMemberStatisticsList: rendered }, getMemberStatistics: () => statistics });
vm.runInContext(html.slice(html.indexOf("    function makePartnerAction("), html.indexOf("    function shortRuleSchedule(")), context);
context.renderShakeMemberStatistics();
const elements = (root) => [root, ...root.children.flatMap(elements)];
const nodes = elements(rendered);
assert.ok(nodes.some((n) => n.tagName === "UL" && n.className === "member-statistics-ranking"));
assert.ok(nodes.every((n) => n.tagName !== "OL" && n.value === undefined), "rank numbers are not rendered");
assert.equal(nodes.filter((n) => n.tagName === "DT").at(-1).textContent, "最佳拍档：");
assert.ok(rendered.textContent.includes("阿恒 ↔ 柚子🍀"));
assert.ok(rendered.textContent.includes("11/16（68.8%）"));
assert.ok(rendered.textContent.includes("2/32（6.3%）"));
const firstDetails = nodes.find((n) => n.className === "member-partner-pair");
firstDetails.open = true;
context.renderShakeMemberStatistics();
assert.ok(elements(rendered).includes(firstDetails), "unchanged refreshes preserve DOM, focus and expansion");
statistics.bestPartners.pairs[0].score += 0.000001;
context.renderShakeMemberStatistics();
assert.ok(elements(rendered).find((n) => n.className === "member-partner-pair" && n.dataset?.partnerKey === firstDetails.dataset.partnerKey).open, "data refreshes retain expanded pair evidence by member ID");
const malicious = { ...real.pairs[0], names: ["<img src=x onerror=alert(1)>", "B"] };
assert.ok(context.renderBestPartnerPair(malicious).textContent.includes(malicious.names[0]));
const more = new Element("div");
context.renderBestPartnerStatistics(more, { pairs: Array.from({ length: 12 }, () => real.pairs[0]) });
assert.equal(more.children.filter((n) => n.className === "member-partner-row").length, 12);
assert.ok(!more.textContent.includes("查看其余"));
assert.equal(elements(more).filter((n) => n.className === "member-partner-pair").length, 12);
const empty = new Element("div"); context.renderBestPartnerStatistics(empty, { pairs: [] });
assert.ok(empty.textContent.includes("暂无最佳拍档"));
console.log("Best-partner verification passed: four labeled regressions, popularity, weekday/period confounding, sample gates, membership, activity, ownership, daily weighting, boundaries, deterministic output, real calendar helper, UI evidence and safe text rendering.");
