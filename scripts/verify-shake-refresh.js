import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import "../member-statistics.js";
const core = BadmintonMemberStatistics;
const now = "2026-10-23T12:00:00+08:00", targetDate = "2026-10-23";
const players = [{ id: 1, name: "成员A", level: "3级" }];
let nextId = 1;
const session = (date) => ({ id: nextId++, date, players: [{ playerId: 1, slots: 1, plusCount: 0 }, { playerId: null, isCompanion: true, slots: 10, plusCount: 10 }] });
const history = [session("2026-10-12"), session("2026-10-19")];
const build = (sessions = history) => core.build({ players, sessions, now });
const tags = (statistics = build(), extras = {}) => core.recommendationTags({ statistics, playerId: 1, targetDate, currentCount: 5, ...extras });
const initial = build();
assert.ok(tags().reasons.includes("近期常打"));
assert.deepEqual(tags().risks, ["周五可能无法打球", "每周可能最多打1局", "可能不喜欢人少的局"]);
assert.ok(tags(initial, { currentCount: 10 }).risks.includes("可能不喜欢人少的局"), "ten is not more than ten");
assert.ok(!tags(initial, { currentCount: 11 }).risks.includes("可能不喜欢人少的局"));
assert.ok(!tags(initial, { currentCount: 100 }).risks.includes("可能不喜欢人少的局"));
assert.ok(tags(initial, { currentCount: 9 }).risks.includes("可能不喜欢人少的局"), "label returns after roster shrinks");
assert.ok(tags(initial, { targetDate: "2026-10-24" }).risks.includes("周六可能无法打球"));
assert.ok(!tags(initial, { targetDate: "2026-10-24" }).risks.includes("周五可能无法打球"));
assert.ok(!tags(initial, { targetDate: "2026-10-26" }).risks.some(t => t.startsWith("每周可能")), "new week has not reached the limit");
assert.ok(!tags(initial, { targetDate: "2026-10-19" }).risks.includes("周一可能无法打球"), "weekday with history has no absence label");
const holiday = { ...initial, calendar: { ...initial.calendar, excludedDates: [...initial.calendar.excludedDates, targetDate] } };
assert.ok(!tags(holiday).risks.some(t => /^周/.test(t)), "holiday target suppresses ordinary-weekday inference");
const two = build([...history, session("2026-10-20")]);
assert.ok(!two.lists.find(l => l.key === "weeklyMax1").memberIds.includes(1));
assert.ok(two.lists.find(l => l.key === "weeklyMax2").memberIds.includes(1));
assert.ok(tags(two).risks.includes("每周可能最多打2局"));
assert.ok(!tags(two).risks.includes("每周可能最多打1局"));
const threeHistory = [...history, session("2026-10-20"), session("2026-10-21")];
const three = build(threeHistory);
assert.ok(three.lists.filter(l => l.key.startsWith("weeklyMax")).every(l => !l.memberIds.includes(1)));
assert.ok(!tags(three).risks.some(t => t.startsWith("每周可能")));
const oldTwo = build([session("2026-10-12"), session("2026-10-13"), session("2026-10-19")]);
assert.ok(oldTwo.lists.find(l => l.key === "weeklyMax2").memberIds.includes(1));
assert.ok(!tags(oldTwo).risks.some(t => t.startsWith("每周可能")), "two-per-week member with only one this week has no cap label");
const oldThree = build([session("2026-10-12"), session("2026-10-13"), session("2026-10-14"), session("2026-10-19")]);
assert.ok(!tags(oldThree).risks.some(t => t.startsWith("每周可能")), "any observed week exceeding two removes both caps");
assert.ok(tags(build(threeHistory.slice(0, -1))).risks.includes("每周可能最多打2局"), "deleting/correcting a historical session recomputes membership");
const one = build([session("2026-10-19")]);
assert.deepEqual(tags(one), { reasons: [], risks: [] }, "one record meets recommendation activity but not any of these evidence gates");
const sameDay = build([session("2026-10-19"), session("2026-10-19")]);
assert.ok(!tags(sameDay).reasons.includes("近期常打"));
const small = session("2026-10-21"); small.players[1].slots = 9;
assert.ok(!tags(build([...history, small])).risks.includes("可能不喜欢人少的局"), "one <=10-person attendance removes the large-only label");
assert.deepEqual(core.recommendationTags({ statistics: initial, playerId: 999, targetDate }), { reasons: [], risks: [] });

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const helperContext = vm.createContext({ BadmintonMemberStatistics: core });
vm.runInContext(html.slice(html.indexOf("    function getShakeRecommendationBadges("), html.indexOf("    function shakeProbabilityValue(")), helperContext);
const obsolete = ["近期更常来", "历史参与较多", "常带随行人员", "近期常带随行人员", "近30天参与3天", "10人及以下时可能退出", "近30天未在普通同星期接龙", "已达到近30天观察到的每周局数上限"];
const item = { player: players[0], reasons: [...obsolete, "水平相近"], risks: ["每周可能最多打1局", "周一可能无法打球", "可能不喜欢人少的局"] };
const badges = (stats, count = 5) => Array.from(helperContext.getShakeRecommendationBadges(item, stats, targetDate, count), b => b.text);
for (const old of obsolete) assert.ok(!badges(initial).includes(old));
assert.ok(badges(two).includes("每周可能最多打2局"));
assert.ok(!badges(two).includes("每周可能最多打1局"));
assert.ok(!badges(three).some(t => t.startsWith("每周可能")));
assert.ok(!badges(initial, 11).includes("可能不喜欢人少的局"));
assert.ok(badges(initial).includes("水平相近"));
assert.ok(!badges(initial).includes("周一可能无法打球"));
assert.deepEqual(Array.from(helperContext.getShakeRecommendationBadges({ player: players[0] }, initial, targetDate, 11), b => b.text), ["近期常打", "周五可能无法打球", "每周可能最多打1局"], "fallback uses the same statistics labels");
const listSource = html.slice(html.indexOf("    function renderShakePeopleList("), html.indexOf("    function toggleShakePersonBottom("));
assert.match(listSource, /currentCount = state.chainEntries.length/, "all actual roster entries, including companions, count");
assert.match(listSource, /getShakeRecommendationBadges/);
assert.doesNotMatch(listSource, /reasons.slice\(0, 2\)|risks.slice\(0, 2\)/, "statistic labels cannot silently disappear behind two unrelated labels");
const keySource = html.slice(html.indexOf("    function groupForecastKey("), html.indexOf("    function renderGroupForecast("));
const keyContext = vm.createContext({ state: { chainEntries: [], shortTermRules: [], sessions: history, players, groupAttemptOutcomes: [], groupLearningSignals: {}, memberStatistics: initial }, Date: class extends Date { static now() { return 1000000; } } });
vm.runInContext(keySource, keyContext);
const beforeKey = keyContext.groupForecastKey(targetDate, true);
const originalRow = history[0].players[0];
history[0].players[0] = { ...originalRow, slots: 0 };
assert.notEqual(keyContext.groupForecastKey(targetDate, true), beforeKey, "changing a non-last booking invalidates cached tags without a timestamp change");
history[0].players[0] = originalRow;

class Button {
  setAttribute(key, value) { this[key] = value; }
}
let posts = 0, fetches = 0, renders = 0, cached = 0, toasts = [];
let mode = "success", release;
const latest = { players, sessions: history, memberStatistics: initial, groupLearningSignals: { version: "group-learning-v2", generatedAt: now } };
const state = { memberStatisticsRefreshing: false, readOnly: false, players: [], sessions: [], chainEntries: [{ clean: "正在编辑" }], shakeFilters: { gender: "女" }, shakeSortMode: "uplift", shakeBottomedPlayerIds: new Set([1]) };
const originalDraft = state.chainEntries;
const button = new Button(), status = { hidden: true, textContent: "" };
const context = vm.createContext({ state, els: { refreshMemberStatisticsBtn: button, memberStatisticsRefreshStatus: status }, Date, setTimeout,
  api: async (path, options) => {
    posts++; assert.equal(path, "/api/member-statistics/refresh"); assert.equal(options.method, "POST"); assert.ok(options.timeout >= 60000);
    if (mode === "deferred") await new Promise(resolve => { release = resolve; });
    if (mode === "train-failed") throw Error("training failed");
    if (mode === "incomplete") return { ok: true };
    return { ok: true, memberStatistics: initial, groupLearningSignals: latest.groupLearningSignals };
  },
  fetchCloudBootstrap: async () => { fetches++; if (mode === "fetch-failed") throw Error("offline"); return latest; },
  cacheBootstrap: () => { cached++; },
  applyBootstrapData: (data) => { state.players = data.players; state.sessions = data.sessions; },
  renderShakePeopleModal: () => { renders++; }, toast: (text) => toasts.push(text),
});
vm.runInContext('let groupForecastCacheKey="old";\n' + html.slice(html.indexOf("    function syncMemberStatisticsRefreshButton("), html.indexOf("    function getShakeRecommendationBadges(")), context);
mode = "deferred";
const firstRefresh = context.refreshShakeMemberStatistics();
assert.equal(state.memberStatisticsRefreshing, true); assert.equal(button.disabled, true); assert.equal(button["aria-busy"], "true");
await context.refreshShakeMemberStatistics();
await new Promise(resolve => setTimeout(resolve, 5));
assert.equal(posts, 1, "rapid repeat clicks do not launch concurrent training");
release(); await firstRefresh;
assert.equal(fetches, 1); assert.equal(renders, 1); assert.equal(cached, 1);
assert.equal(button.disabled, false); assert.equal(button["aria-busy"], "false");
assert.ok(status.textContent.includes("已重新训练并刷新"));
assert.equal(state.chainEntries, originalDraft); assert.equal(state.shakeFilters.gender, "女"); assert.equal(state.shakeSortMode, "uplift"); assert.ok(state.shakeBottomedPlayerIds.has(1));
state.readOnly = true; mode = "success"; await context.refreshShakeMemberStatistics();
assert.equal(posts, 1, "GitHub/read-only refresh never writes or retrains on the server");
assert.equal(fetches, 2); assert.ok(status.textContent.includes("只读版未重新训练"));
assert.ok(button.title.includes("只读"));
state.readOnly = false;
for (const failure of ["train-failed", "incomplete", "fetch-failed"]) {
  mode = failure; const before = renders, saved = state.sessions;
  await context.refreshShakeMemberStatistics();
  assert.equal(renders, before); assert.equal(state.sessions, saved);
  assert.equal(state.memberStatisticsRefreshing, false); assert.equal(button.disabled, false);
  assert.ok(status.textContent.includes("刷新未完成"));
}
mode = "success"; await context.refreshShakeMemberStatistics(); assert.ok(status.textContent.includes("已重新训练并刷新"), "failed refresh can be retried");

// Execute the real route body, not just string assertions, for auth/order/errors/privacy.
const worker = readFileSync(new URL("../src/worker.js", import.meta.url), "utf8");
const route = worker.slice(worker.indexOf('  if (pathname === "/api/member-statistics/refresh"'), worker.indexOf('  if (pathname === "/api/member-statistics/rebuild"'));
let authorized = true, limited = false, failedStage = "", calls = [];
const routeContext = vm.createContext({ Date,
  isAdminRequest: () => authorized, consumeGroupAttemptRateLimit: async () => !limited,
  settleDueGroupAttempts: async (db, date) => { calls.push("settle"); assert.ok(date instanceof Date); },
  rebuildGroupLearningSignals: async () => { calls.push("train"); if (failedStage === "train") throw Error("training failed"); return latest.groupLearningSignals; },
  rebuildMemberStatistics: async (db, date, refreshCalendar) => { calls.push("statistics"); assert.equal(refreshCalendar, true); if (failedStage === "statistics") throw Error("statistics failed"); return initial; },
  json: (data, status = 200) => ({ data, status }),
});
vm.runInContext('globalThis.route = async (request, env) => { const pathname="/api/member-statistics/refresh", method="POST";\n' + route + '\n}', routeContext);
const request = () => routeContext.route({}, { DB: {} });
let response = await request(); assert.equal(response.status, 200); assert.equal(response.data.ok, true); assert.deepEqual(calls, ["settle", "train", "statistics"]);
assert.ok(!JSON.stringify(response.data).includes("snapshots"), "only aggregate results are returned");
authorized = false; calls = []; response = await request(); assert.equal(response.status, 403); assert.deepEqual(calls, []);
authorized = true; limited = true; response = await request(); assert.equal(response.status, 429); assert.deepEqual(calls, []);
limited = false; failedStage = "train"; await assert.rejects(request(), /training failed/); assert.deepEqual(calls, ["settle", "train"]);
failedStage = "statistics"; calls = []; await assert.rejects(request(), /statistics failed/); assert.deepEqual(calls, ["settle", "train", "statistics"]);
assert.match(html, /id="refreshMemberStatisticsBtn"[^>]*type="button"[^>]*aria-label=/);
assert.match(html, /els.refreshMemberStatisticsBtn.addEventListener\("click", refreshShakeMemberStatistics\)/);
assert.match(html, /id="memberStatisticsRefreshStatus"[^>]*role="status"/);
assert.match(html, /if \(els.shakePeopleModal.classList.contains\("open"\)\) renderShakePeopleModal\(\)/);
console.log("Shake refresh/tags passed: weekly 1->2->none, current week threshold, current weekday/holidays, roster 10/11, shared statistics, removed/stale tags, cache invalidation, duplicate refresh, readonly safety, draft preservation, retry, endpoint auth/rate-limit/order/failure and aggregate privacy.");
