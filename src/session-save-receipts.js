const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const error = (message, status) => Object.assign(new Error(message), { status });

export async function readSessionSaveReceipt(db, requestId, getSessionById) {
  if (!REQUEST_ID.test(requestId || "")) throw error("订场保存请求编号无效", 400);
  const receipt = await db.prepare("SELECT * FROM session_save_receipts WHERE request_id = ?").bind(requestId).first();
  if (!receipt) return null;
  const exists = await db.prepare("SELECT id FROM booking_sessions WHERE id = ?").bind(receipt.session_id).first();
  if (!exists) throw error("这条订场记录已被删除，不能重新提交原保存请求", 410);
  return { receipt, session: await getSessionById(db, receipt.session_id) };
}

export async function commitSessionSave(db, input, { requestId, sessionId = null }, { createSession, updateSession, getSessionById }) {
  const operation = sessionId ? "update" : "create";
  const edcCharge = !sessionId && input.venue === "EDC" ? input.courtCount * 80 : 0;
  // Old deployed clients remain compatible, but updated clients always use durable request IDs.
  if (!requestId) return { session: sessionId ? await updateSession(db, sessionId, input) : await createSession(db, input), replayed: false, edcCharge };
  if (!REQUEST_ID.test(requestId)) throw error("订场保存请求编号无效", 400);
  const payload = JSON.stringify({ operation, sessionId, input });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  const payloadHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  const reuse = async saved => {
    if (saved.receipt.payload_hash !== payloadHash || saved.receipt.operation !== operation) {
      throw error("这次保存的内容与原请求不同，请先确认上一条订场记录后再修改", 409);
    }
    return { session: saved.session, replayed: true, requestId, edcCharge: Number(saved.receipt.edc_charge) || 0 };
  };
  const previous = await readSessionSaveReceipt(db, requestId, getSessionById);
  if (previous) return reuse(previous);
  const receipt = { requestId, payloadHash, operation, sessionId, edcCharge };
  try {
    const session = sessionId ? await updateSession(db, sessionId, input, receipt) : await createSession(db, input, receipt);
    return { session, requestId, replayed: false, edcCharge };
  } catch (cause) {
    // The concurrent winner, or a commit whose response was lost, is safe to reuse.
    const committed = await readSessionSaveReceipt(db, requestId, getSessionById);
    if (committed) return reuse(committed);
    throw cause;
  }
}

export async function sessionSaveFollowups(env, session, previousDate, context, deps) {
  const warnings = [];
  const safe = async (label, task, fallback) => {
    try { return await task(); }
    catch (cause) { console.error("Session saved; follow-up failed", label, cause?.message || cause); warnings.push(label); return fallback; }
  };
  // Training is derived data, not part of the durable money/attendance commit.
  // A revision check on the estimator endpoint also self-heals an interrupted background run.
  const training = Promise.resolve().then(() => deps.retrainEstimator(env.DB)).catch(cause => {
    console.error("Session saved; deferred estimator training failed", cause?.message || cause);
  });
  if (context?.waitUntil) context.waitUntil(training);
  else await training;
  const [todoCounter, outcome, edcBalance] = await Promise.all([
    previousDate ? { eligible: false, status: "skipped" } : safe("累计同步", () => deps.syncTodoBadmintonCounter(env, session), { eligible: true, status: "failed" }),
    safe("组局及返场规则", async () => {
      const removedShortRuleCount = await deps.deleteShortTermRulesForEarlyReturn(env.DB, session.date, session.players);
      if (previousDate && previousDate !== session.date) await deps.safelyReconcileGroupAttemptOutcome(env.DB, previousDate);
      const groupAttempt = await deps.safelyReconcileGroupAttemptOutcome(env.DB, session.date);
      return { removedShortRuleCount, groupAttempt };
    }, { removedShortRuleCount: 0, groupAttempt: null }),
    safe("余额读取", () => deps.getEdcBalance(env.DB), null),
  ]);
  return { todoCounter, ...outcome, edcBalance, estimatorPending: true, followupWarnings: warnings };
}
