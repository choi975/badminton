import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { loadPaymentFunctions } from "./payment-test-helpers.js";

const api = loadPaymentFunctions([
  "buildCalendarSummaryLine", "getCalendarGenderStats", "courtPriceBreakdown", "formatCompactNumber", "formatMoney",
]);
const pricing = globalThis.BadmintonCourtPricing;
const person = (gender, amount, extra = {}) => ({ slots: 1, plusCount: 0, gender, amount, ...extra });
const session = (courtPriceRows, players = [], extra = {}) => ({
  courtPriceRows, courtCount: pricing.sumCounts(courtPriceRows),
  courtFee: courtPriceRows.reduce((total, row) => total + pricing.rowFee(row), 0), players, ...extra,
});
const summary = (sessions) => api.buildCalendarSummaryLine(sessions);
const short = (count) => session([{ price: 70, count }]);
assert.match(summary([short(0.333)]), /^场地 70元×0\.333个；/);
assert.match(summary([short(0.666)]), /^场地 70元×0\.666个；/);
assert.match(summary([short(1.666)]), /^场地 70元×1\.666个；/);
assert.match(summary([short(0.333), short(0.333), short(0.333)]), /^场地 70元×1个；/, "Sum exact hours before formatting thirds; never show 0.999");
assert.match(summary([short(0.333), short(0.666)]), /^场地 70元×1个；/);
assert.match(summary([short(0.666), short(0.666)]), /^场地 70元×1\.333个；/);
assert.match(summary([short(1.5)]), /^场地 70元×1\.5个；/, "Legacy half courts still work");
assert.match(summary([session([{price:70,count:8},{price:47,count:1,hours:2}])]), /^场地 70元×8\.666个；/, "Explicit hourly rows fold into the three-hour standard");
assert.match(summary([session([{price:24,count:3,hours:1}])]), /^场地 70元×1个；/);
assert.match(summary([session([{price:80,count:2},{price:70,count:1.333}])]), /^场地 70元×1\.333个、80元×2个；/, "Do not relabel historical/custom 80-yuan rates as 70");
assert.match(summary([{courtCount:0.666,courtFee:47,players:[]}]), /^场地 70元×0\.666个；/, "Historical rows without a stored price breakdown are normalized");
assert.match(summary([{courtCount:1,courtFee:55,players:[]}]), /^场地 55元×1个；/, "Unrecognized historical prices are not fabricated");
assert.match(summary([{courtCount:1,courtFee:0,players:[]}]), /^场地 0元×1个；/);

const legacyRates = [
  { courtCount: 2, courtFee: 160, venue: "EDC", players: [] },
  { courtCount: 1.5, courtFee: 150, venue: "文体", players: [] },
  { courtCount: 1, courtFee: 0, venue: "文体", players: [] },
];
const legacyBefore = structuredClone(legacyRates);
assert.match(summary(legacyRates), /^场地 0元×1个、80元×2个、100元×1\.5个；/);
assert.deepEqual(legacyRates, legacyBefore, "80 / 100 / free historical bookings retain their saved amounts and three-hour equivalents");
assert.match(summary([short(0.166)]), /^场地 70元×0\.166个；/, "A half-hour still displays a three-hour equivalent in the total");
assert.match(summary([short(1.833)]), /^场地 70元×1\.833个；/);
assert.match(summary([short(0.166), short(0.166)]), /^场地 70元×0\.333个；/, "Aggregate exact half-hours before formatting the equivalent count");

const samplePlayers = [
  ...Array.from({length:35}, () => person("男",24.42)),
  ...Array.from({length:17}, () => person("女",20.9)), person("女",20.93),
];
const october = session([{price:70,count:8.666}], samplePlayers, {
  shuttlePriceRows: [{price:11.3,count:46},{price:13,count:8}],
});
const original = structuredClone(october);
assert.equal(summary([october]), "场地 70元×8.666个；球 11.3元×46个、13元×8个；共1230.93元，男性平均24.42元/人次，女性平均20.90元/人次。");
assert.deepEqual(october, original, "Rendering must not change the saved bill");
assert.equal(october.courtFee, 607, "8 full courts + 2 hours stays 560+47, not 70*8.666");
const hourly = [short(0.333), short(0.333), short(0.333)];
summary(hourly);
assert.equal(hourly.reduce((total,s)=>total+s.courtFee,0),72, "Three separate short bookings cost 72 even when displayed as 1 equivalent court");

const weighted = [
  session([], [person("男",10), person("女",6.5)]),
  session([], [person("男",30),person("男",30),person("男",30),person("女",26.5)]),
];
assert.match(summary(weighted), /男性平均25\.00元\/人次，女性平均16\.50元\/人次/, "Weight by each gender's attendance, not by session count");
const companions = session([], [
  person("男",30,{ownerPlayerId:1}),
  person("女",26.5,{ownerPlayerId:1,isCompanion:true}),
  person("男",35,{ownerPlayerId:2,isCompanion:true}),
  person("女",0,{ownerPlayerId:2,slots:0}),
]);
assert.match(summary([companions]), /男性平均32\.50元\/人次，女性平均26\.50元\/人次/, "Guests use their own gender and fee; absent owner is not another attendance");
const incomplete = session([], [
  person("男",30), person("女",26.5), person("不详",40),
  person("男",90,{slots:3,plusCount:2}), person("女",20,{slots:0}),
]);
const incompleteBefore = structuredClone(incomplete);
assert.deepEqual(api.getCalendarGenderStats([incomplete]), {
  male: { totalAmount: 160, totalSlots: 5 },
  female: { totalAmount: 26.5, totalSlots: 1 },
}, "Unknown and unitemized attendances and their fees are included in the male average");
assert.match(summary([incomplete]), /共206\.50元，男性平均32\.00元\/人次，女性平均26\.50元\/人次。/);
assert.doesNotMatch(summary([incomplete]), /另有|未纳入性别均值|性别或费用拆分不详/);
assert.deepEqual(incomplete, incompleteBefore, "The calendar fallback must not rewrite saved genders, slots or bills");

const unknownGenders = session([], [
  person("不详",40), person(undefined,25), person("",10), person("未登记",20,{isFemale:true}),
]);
assert.deepEqual(api.getCalendarGenderStats([unknownGenders]), {
  male: { totalAmount: 95, totalSlots: 4 },
  female: { totalAmount: 0, totalSlots: 0 },
}, "Unknown, missing, blank and invalid genders default to male; an explicit unknown overrides legacy flags");
assert.match(summary([unknownGenders]), /男性平均23\.75元\/人次，女性平均暂无数据。/);

const combinedLegacy = session([], [
  person("女",70,{slots:3,plusCount:2}), person("女",26.5), person("男",30),
]);
assert.deepEqual(api.getCalendarGenderStats([combinedLegacy]), {
  male: { totalAmount: 100, totalSlots: 4 },
  female: { totalAmount: 26.5, totalSlots: 1 },
}, "Previously unitemized bills use the male fallback without changing itemized female records");
assert.match(summary([combinedLegacy]), /男性平均25\.00元\/人次，女性平均26\.50元\/人次。/);
assert.match(summary([session([], [person("不详",0)])]), /男性平均0\.00元\/人次，女性平均暂无数据。/);
assert.match(summary([session([], [person("女",0)])]), /男性平均暂无数据，女性平均0\.00元\/人次/);
assert.match(summary([session([], [person("男",20)])]), /男性平均20\.00元\/人次，女性平均暂无数据/);
assert.match(summary([]), /共0\.00元，男性平均暂无数据，女性平均暂无数据/);
assert.doesNotMatch(summary([]), /NaN|Infinity/);
assert.match(summary([session([], [{slots:1,amount:25,isFemale:true}])]), /女性平均25\.00元\/人次/, "Legacy explicit female flag can still be used if a gender field was never saved");
const historicalSessions = JSON.parse(readFileSync(new URL("../data/bootstrap-snapshot.json", import.meta.url), "utf8")).data.sessions;
for (const month of ["2026-07", "2026-08", "2026-09"]) {
  const monthSessions = historicalSessions.filter((row) => row.date.startsWith(month));
  const monthBefore = structuredClone(monthSessions);
  const participants = monthSessions.flatMap((row) => row.players || [])
    .filter((row) => Math.max(0, Math.floor(Number(row.slots) || 0)) > 0);
  const stats = api.getCalendarGenderStats(monthSessions);
  assert.equal(stats.male.totalSlots + stats.female.totalSlots,
    participants.reduce((sum, row) => sum + Math.max(0, Math.floor(Number(row.slots) || 0)), 0),
    month + " must include every attendance in a gender average");
  assert.ok(Math.abs(stats.male.totalAmount + stats.female.totalAmount
    - participants.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)) < 1e-8,
    month + " must retain every participant fee without duplication");
  assert.doesNotMatch(summary(monthSessions), /另有|未纳入性别均值|NaN|Infinity/);
  assert.deepEqual(monthSessions, monthBefore, month + " calendar totals must not mutate history");
}

function element() {
  let text = "";
  return {
    children: [], className: "", events: {},
    get textContent() { return text + this.children.map((child) => child.textContent).join(""); },
    set textContent(value) { text = value; this.children = []; },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { text = ""; this.children = children; },
    addEventListener(event, handler) { this.events[event] = handler; },
  };
}
const descendants = (el) => [el, ...el.children.flatMap(descendants)];
const byClass = (el, className) => descendants(el).find((child) => child.className === className);
const detailCalls = [];
const cards = loadPaymentFunctions([
  "createAggregateCalendarCard", "setCalendarRecordMetaText",
  "buildCalendarSummaryLine", "getCalendarGenderStats", "courtPriceBreakdown", "formatCompactNumber", "formatMoney",
], {
  document: {
    createElement: element,
    createTextNode: (text) => { const node = element(); node.textContent = text; return node; },
  },
  projectSessionParticipants: (rows) => rows.map((row) => ({ key: row.playerId, ownerName: row.playerName, amount: row.amount })),
  collator: new Intl.Collator("zh-CN"),
  openCalendarDetailModal: (...args) => detailCalls.push(args),
});
const cardSessions = [session([{ price: 70, count: 1 }], [person("男", 70, { playerId: 1, playerName: "球友" })])];
const originalCardSessions = structuredClone(cardSessions);
for (const title of ["11月合计", "选中 2 天", "选中 10 天"]) {
  const card = cards.createAggregateCalendarCard(cardSessions, title);
  const meta = byClass(card, "calendar-record-meta");
  assert.equal(meta.textContent, summary(cardSessions), "Aggregate rows must start with the statistics, without repeating the heading");
  assert.equal(byClass(meta, "calendar-record-meta-title"), undefined, "Month and multi-day summary prefixes must be omitted");
  assert.equal(byClass(card, "calendar-record-player").textContent, "球友（70.00元）", "Removing the prefix must preserve member totals");
  byClass(card, "primary-btn").events.click();
  const [openedSessions, openedTitle] = detailCalls.at(-1);
  assert.equal(openedSessions, cardSessions);
  assert.equal(openedTitle, title, "The detail dialog must retain its month or selected-days context");
}
assert.deepEqual(cardSessions, originalCardSessions, "Aggregate rendering must not mutate booking or payment records");
const dailyMeta = element();
cards.setCalendarRecordMetaText(dailyMeta, "第1场 · 广羽", summary(cardSessions));
assert.equal(dailyMeta.textContent, "第1场 · 广羽：" + summary(cardSessions), "Individual session labels must remain intact");
assert.ok(byClass(dailyMeta, "calendar-record-meta-title"));

console.log("Calendar summary passed: exact three-hour equivalents, actual-price preservation, sample total, gender-weighted averages, companions, male fallback for unknown/unitemized rows, July-September history, zero/empty cases.");
