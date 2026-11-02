import "../session-save.js";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { commitSessionSave, readSessionSaveReceipt, sessionSaveFollowups } from "../src/session-save-receipts.js";

const worker = readFileSync(new URL("../src/worker.js", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8").replaceAll("\r\n", "\n");
function source(text, name, indent="") {
  const start=text.search(new RegExp(`^${indent}(?:async )?function ${name}\\(`,"m")), end=text.indexOf(`\n${indent}}`,start);
  assert.ok(start>=0 && end>start, name);
  return text.slice(start,end+indent.length+2);
}
const sqlite=new DatabaseSync(":memory:");
for (const file of readdirSync(new URL("../migrations/",import.meta.url)).filter(f=>f.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL("../migrations/"+file,import.meta.url),"utf8"));
let failPlayer="";
const queries=[];
const db={ prepare(sql) { queries.push(sql); let values=[]; return {
  bind(...args) {values=args;return this;}, async first() {return sqlite.prepare(sql).get(...values)||null;}, async all() {return {results:sqlite.prepare(sql).all(...values)};},
  async run() {if(sql.startsWith("INSERT INTO booking_session_players") && values.includes(failPlayer) && failPlayer) throw new Error("Injected participant failure"); const r=sqlite.prepare(sql).run(...values);return {success:true,meta:{last_row_id:Number(r.lastInsertRowid),changes:Number(r.changes)}};}
};}, async batch(statements) {sqlite.exec("BEGIN");try {const results=[]; for(const statement of statements) results.push(await statement.run());sqlite.exec("COMMIT");return results;}catch(cause){sqlite.exec("ROLLBACK");throw cause;}}};
const getSessionById=async (_db,id)=>{const row=sqlite.prepare("SELECT * FROM booking_sessions WHERE id=?").get(id);if(!row)throw new Error("not found");return {id:row.id,date:row.date,venue:row.venue,courtCount:row.court_count,courtFee:row.court_fee,players:sqlite.prepare("SELECT * FROM booking_session_players WHERE session_id=?").all(id)};};
const ops=new Function("getSessionById",["createSession","updateSession","serializePriceRows","buildSessionPlayerStatements"].map(name=>source(worker,name)).join("\n")+"\nreturn {createSession,updateSession,getSessionById};")(getSessionById);
const participant={playerId:null,playerName:"保存测试",ownerPlayerId:null,ownerName:"保存测试",isCompanion:false,slots:1,plusCount:0,amount:80,isFemale:false,gender:"男",level:"2级",profileSnapshotReliable:true};
const body={date:"2026-11-02",venue:"EDC",courtCount:1,courtFee:80,shuttlePrice:11.3,shuttleCount:0,players:[participant],trainCourt:false,trainShuttle:false,actualShuttleConfirmed:true,courtPriceRows:[],shuttlePriceRows:[]};
const balance=()=>Number(sqlite.prepare("SELECT value FROM app_settings WHERE key='edc_balance'").get().value);
const count=table=>Number(sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
const revision=()=>sqlite.prepare("SELECT revision FROM booking_estimator_training_state WHERE id='current'").get().revision;
const beforeBalance=balance();
const id=randomUUID();
const saved=await commitSessionSave(db,body,{requestId:id},ops);
assert.equal(saved.replayed,false); assert.equal(saved.edcCharge,80); assert.equal(count("booking_sessions"),1); assert.equal(balance(),beforeBalance-80);
const afterRevision=revision();
assert.equal((await commitSessionSave(db,body,{requestId:id},ops)).session.id,saved.session.id);
assert.equal(count("booking_sessions"),1); assert.equal(count("booking_session_players"),1); assert.equal(balance(),beforeBalance-80); assert.equal(revision(),afterRevision,"Replay never reruns SQL triggers");
await assert.rejects(commitSessionSave(db,{...body,courtFee:81},{requestId:id},ops),cause=>cause.status===409);
await assert.rejects(commitSessionSave(db,body,{requestId:"bad"},ops),cause=>cause.status===400);
const concurrentId=randomUUID();
const concurrent=await Promise.all([commitSessionSave(db,body,{requestId:concurrentId},ops),commitSessionSave(db,body,{requestId:concurrentId},ops)]);
assert.equal(concurrent[0].session.id,concurrent[1].session.id); assert.equal(count("booking_sessions"),2); assert.equal(balance(),beforeBalance-160);
assert.equal((await readSessionSaveReceipt(db,id,getSessionById)).receipt.edc_charge,80,"Receipt retains the original debit for truthful recovery messages");
const updateId=randomUUID(), updated={...body,courtFee:160,players:[{...participant,amount:160}]};
await commitSessionSave(db,updated,{requestId:updateId,sessionId:saved.session.id},ops);
const beforeUpdateReplay=revision();
await commitSessionSave(db,updated,{requestId:updateId,sessionId:saved.session.id},ops);
assert.equal(balance(),beforeBalance-160); assert.equal(revision(),beforeUpdateReplay);
await commitSessionSave(db,{...updated,courtFee:200},{requestId:randomUUID(),sessionId:saved.session.id},ops);
assert.equal((await commitSessionSave(db,updated,{requestId:updateId,sessionId:saved.session.id},ops)).session.courtFee,200,"Old update receipts never revert newer edits");
failPlayer="故障人员";
const failId=randomUUID(), failureBody={...body,players:[{...participant,playerName:failPlayer}]};
await assert.rejects(commitSessionSave(db,failureBody,{requestId:failId},ops),/Injected/);
assert.equal(count("booking_sessions"),2); assert.equal(count("session_save_receipts"),4); assert.equal(balance(),beforeBalance-160);
assert.equal(await readSessionSaveReceipt(db,failId,getSessionById),null,"Rollback includes the receipt and EDC trigger");
failPlayer=""; await commitSessionSave(db,failureBody,{requestId:failId},ops);
assert.equal(count("booking_sessions"),3);assert.equal(balance(),beforeBalance-240);
const deletedId=concurrent[0].session.id;
sqlite.prepare("DELETE FROM booking_session_players WHERE session_id=?").run(deletedId);sqlite.prepare("DELETE FROM booking_sessions WHERE id=?").run(deletedId);
await assert.rejects(commitSessionSave(db,body,{requestId:concurrentId},ops),cause=>cause.status===410);assert.equal(count("booking_sessions"),2,"A deleted receipt cannot recreate a bill");
assert.equal((await readSessionSaveReceipt(db,id,getSessionById)).session.id,saved.session.id);
const targeted=new Function("listShuttleTypes","parseStoredPriceRows","normalizeSessionVenue","VALID_PARTICIPANT_GENDERS","VALID_LEVELS", source(worker,"listSessions")+"\n"+source(worker,"getSessionById")+"\nreturn getSessionById;")
  (async()=>[],()=>[],value=>value,new Set(["男","女","不详"]),new Set(["2级","不详"]));
queries.length=0;assert.equal((await targeted(db,saved.session.id)).id,saved.session.id);assert.ok(queries.some(sql=>sql.includes("WHERE s.id = ?")),"Saved-record reads never join the entire history");

let releaseTraining;
const training=new Promise(resolve=>{releaseTraining=resolve;}); const waits=[]; const started=[];
const followups=await sessionSaveFollowups({DB:db},saved.session,null,{waitUntil:promise=>waits.push(promise)}, {
  retrainEstimator:async()=>{started.push("training");await training;},syncTodoBadmintonCounter:async()=>{started.push("todo");return {eligible:true,status:"recorded"};},
  deleteShortTermRulesForEarlyReturn:async()=>{started.push("rules");throw new Error("Injected follow-up failure");},safelyReconcileGroupAttemptOutcome:async()=>null,getEdcBalance:async()=>balance(),
});
assert.equal(waits.length,1); assert.ok(started.includes("training")&&started.includes("todo")&&started.includes("rules"));assert.equal(followups.todoCounter.status,"recorded");assert.equal(followups.estimatorPending,true);assert.deepEqual(followups.followupWarnings,["组局及返场规则"]);releaseTraining();await Promise.all(waits);

const dates=[], patchWaits=[];
const patchExtras=await sessionSaveFollowups({DB:db},{...saved.session,date:"2026-11-03"},"2026-11-02",{waitUntil:promise=>patchWaits.push(promise)}, {
  retrainEstimator:async()=>{},syncTodoBadmintonCounter:async()=>{throw new Error("PATCH must not increment todo");},
  deleteShortTermRulesForEarlyReturn:async()=>0,safelyReconcileGroupAttemptOutcome:async(_db,date)=>{dates.push(date);return {activityDate:date};},getEdcBalance:async()=>balance(),
});
assert.deepEqual(dates,["2026-11-02","2026-11-03"]);assert.equal(patchExtras.todoCounter.eligible,false);await Promise.all(patchWaits);

const Client=globalThis.BadmintonSessionSave;
const map=new Map(),storage={getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value)};
let apiCalls=[],mode="timeout",serverResult={session:{id:99,date:body.date,venue:"广羽"}};
const mock=async(path,options={})=>{apiCalls.push({path,...options});if(path.includes("receipts")){if(mode==="lost") return serverResult;throw Object.assign(new Error("pending"),{status:404});}
  assert.equal(options.timeout,60000);if(mode==="timeout")throw Object.assign(new Error("signal is aborted without reason"),{code:"REQUEST_TIMEOUT"});return serverResult;};
let client=Client.createClient({api:mock,storage});
await assert.rejects(client.save("/api/sessions",body),cause=>cause.code==="SAVE_UNCONFIRMED"&&/不会重复/.test(cause.message));
const firstRequest=JSON.parse(apiCalls[0].body);assert.ok(JSON.parse(map.get(Client.STORAGE_KEY))[0].requestId);
client=Client.createClient({api:mock,storage});mode="success";await client.save("/api/sessions",body);
assert.equal(JSON.parse(apiCalls.findLast(call=>call.body).body).requestId,firstRequest.requestId,"Reloaded clients reuse the exact persisted request ID");assert.equal(JSON.parse(map.get(Client.STORAGE_KEY)).length,0);
mode="lost";apiCalls=[];mock.failed=false;
const lostApi=async(path,options={})=>{apiCalls.push({path,...options});if(options.method)throw new TypeError("Failed to fetch");return serverResult;};
client=Client.createClient({api:lostApi,storage});assert.equal((await client.save("/api/sessions",body)).recovered,true);assert.equal(apiCalls.filter(call=>call.method).length,1,"Receipt lookup recovers a lost response without another insert");
mode="timeout";apiCalls=[];client=Client.createClient({api:mock,storage});await assert.rejects(client.save("/api/sessions",body));mode="success";
await assert.rejects(client.save("/api/sessions",{...body,courtFee:300}),cause=>cause.code==="PREVIOUS_SESSION_SAVED"&&cause.data.session.id===99);
assert.equal(JSON.parse(apiCalls.findLast(call=>call.body).body).courtFee,body.courtFee,"Changed fields first resolve the original save instead of creating a second bill");
let resolveSave,posts=0;client=Client.createClient({api:async()=>{posts++;await new Promise(resolve=>{resolveSave=resolve;});return serverResult;},storage});
const one=client.save("/api/sessions",body),two=client.save("/api/sessions",body);await Promise.resolve();resolveSave();await Promise.all([one,two]);assert.equal(posts,1,"Double submissions share one in-flight request");
client=Client.createClient({api:mock,storage:{getItem:()=>null,setItem:()=>{throw new Error("quota");}}});apiCalls=[];await assert.rejects(client.save("/api/sessions",body),/未提交本次保存/);assert.equal(apiCalls.length,0);
client=Client.createClient({api:mock,storage:{getItem:()=>"{",setItem:()=>{}}});await assert.rejects(client.save("/api/sessions",body),/无法读取/);

// Run the actual API wrapper, with controlled timers and aborted header/body stages.
async function timeoutCase(external=false,bodyStage=false) {
  let timer, cleared=false;const ext=new AbortController();
  const fetch=async(_path,options)=>{if(bodyStage)return {status:200,ok:true,json:()=>new Promise((_resolve,reject)=>options.signal.addEventListener("abort",()=>reject(new DOMException("signal is aborted without reason","AbortError")),{once:true}))};
    return new Promise((_resolve,reject)=>options.signal.addEventListener("abort",()=>reject(new DOMException("signal is aborted without reason","AbortError")),{once:true}));};
  const api=new Function("state","fetch","getApiUrl","setTimeout","clearTimeout",source(html,"api","    ")+"\nreturn api;")({readOnly:false},fetch,path=>path,callback=>{timer=callback;return 1;},()=>{cleared=true;});
  const pending=api("/api/test",external?{signal:ext.signal}:{});await Promise.resolve();timer();await assert.rejects(pending,cause=>cause.code==="REQUEST_TIMEOUT"&&cause.message==="请求超时，请稍后重试");assert.equal(cleared,true);
}
await timeoutCase();await timeoutCase(true);await timeoutCase(false,true);
const recoveredCalls=[], recoveredState={}, recoveredEls={recordModal:{dataset:{}},recordTitle:{textContent:""}};
const recover=new Function("state","els","upsertSession","applyEdcBalanceResponse","applyGroupAttemptResponse","finishSessionSaveFollowups","setSync","toast",source(html,"recoverPreviousSessionSave","    ")+"\nreturn recoverPreviousSessionSave;")
  (recoveredState,recoveredEls,session=>recoveredCalls.push(["session",session.id]),data=>recoveredCalls.push(["balance",data.edcBalance]),()=>{},()=>{},()=>{},()=>{});
const recoveredError={code:"PREVIOUS_SESSION_SAVED",message:"confirmed",data:{session:{id:99,date:"2026-11-02",venue:"EDC",trainCourt:false,trainShuttle:false,actualShuttleConfirmed:false},edcBalance:780}};
assert.equal(recover(recoveredError,true),true);assert.equal(recoveredEls.recordModal.dataset.sessionId,"99");assert.equal(recoveredEls.recordModal.dataset.editing,"1");assert.deepEqual(recoveredCalls.slice(0,2),[["session",99],["balance",780]]);
assert.equal(recover(recoveredError,false),true);assert.equal(recoveredState.pendingSessionEdit.id,99,"Modified direct-save flow must edit the recovered record, not issue another POST");
assert.equal(recoveredState.pendingSessionEdit.actualShuttleConfirmed,false);assert.equal(recoveredEls.recordModal.dataset.actualShuttleConfirmed,"0");assert.equal(recoveredEls.recordModal.dataset.trainCourt,"0");

assert.match(html,/saveSessionRequest\(editing \?/);assert.match(html,/state\.sessionSaving = true/);assert.match(worker,/async fetch\(request, env, context\)/);
sqlite.close();
console.log("Session save passed: atomic create/update receipts, EDC exactly-once debit, concurrent/lost-response replay, rollback, deleted/newer-edit guards, single-session reads, nonblocking training, safe follow-ups, persisted client recovery, changed-form isolation, duplicate-submit/storage guards, and Chinese header/body/external-signal timeouts.");
