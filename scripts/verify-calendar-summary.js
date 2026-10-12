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
assert.equal(api.getCalendarGenderStats([incomplete]).unknownSlots,4);
assert.match(summary([incomplete]), /共206\.50元，男性平均30\.00元\/人次，女性平均26\.50元\/人次（另有4人次因性别或费用拆分不详，未纳入性别均值）/, "Unknown/combined amounts stay in the total but are not attributed to an invented gender");
assert.match(summary([session([], [person("女",0)])]), /男性平均暂无数据，女性平均0\.00元\/人次/);
assert.match(summary([session([], [person("男",20)])]), /男性平均20\.00元\/人次，女性平均暂无数据/);
assert.match(summary([]), /共0\.00元，男性平均暂无数据，女性平均暂无数据/);
assert.doesNotMatch(summary([]), /NaN|Infinity/);
assert.match(summary([session([], [{slots:1,amount:25,isFemale:true}])]), /女性平均25\.00元\/人次/, "Legacy explicit female flag can still be used if a gender field was never saved");
console.log("Calendar summary passed: exact three-hour equivalents, actual-price preservation, sample total, gender-weighted averages, companions, legacy/unknown/zero/empty cases.");
