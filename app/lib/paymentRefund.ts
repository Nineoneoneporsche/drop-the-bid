// Server-only: full refunds (Toss full cancellation) of a paid order, M4-B1.
// payment_cancellations is the source of truth; every write goes through
// the three service-role RPCs of
// supabase/migrations/20261104100000_payment_cancellations.sql:
//
//   reserveRefund()    payment_cancel_reserve: the DB checks the order and
//                      its paid attempt (identity, no refund yet, nothing in
//                      progress), copies paymentKey / amount and creates the
//                      Idempotency-Key. Nothing about the payment comes from
//                      the caller except the order id.
//   executeRefund()    one cancel POST with the row's key and reason
//                      (cancelReason only = full amount); its outcome is
//                      recorded machine-readably (payment_cancel_record_post:
//                      initial_post_outcome / http status / Toss code), then:
//                        verified full cancellation        -> finalize (done)
//                        2xx for another payment/order/amount -> reconciliation_required
//                        anything else                     -> ONE lookup decides
//                          verified full cancellation      -> done
//                          still DONE, untouched, and the RECORDED
//                          outcome is definite_rejection   -> failed
//                          otherwise                       -> reconciliation_required
//   recheckRefund()    a reconciliation_required (or stale pending) row:
//                      lookup ONLY — never a new cancel POST, never a new key
//                      (Toss answers a repeated key with its first response).
//                      failed is possible only from the row's recorded
//                      initial_post_outcome = definite_rejection.
//
// error_detail is operator / log text only: no decision ever parses it.
//
// Logs carry the order id, the cancellation id and a masked paymentKey —
// never the secret key, the full paymentKey or the Idempotency-Key.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cancelTossPayment, classifyCancelLookup, classifyCancelPost, getTossPayment, maskPaymentKey, storedTossCancelPayment,
  storedTossError, type CancelPostOutcome, type CancelPostOutcomeKind, type CancelVerdict, type ExpectedPayment,
} from "./tossClient";

export type RefundStatus = "done" | "failed" | "reconciliation_required";
export type RefundResult =
  | { ok: true; status: RefundStatus; cancellationId: string; detail: string }
  | { ok: false; code: string };

export type ReservedRefund = {
  cancellation_id: string;
  order_id: string;
  payment_key: string;
  amount: number;
  reason: string;
  toss_idempotency_key: string;
};

// A pending row older than this is a request that died between the
// reservation and its answer; a re-check may then look it up.
export const STALE_PENDING_MS = 5 * 60 * 1000;

const RESERVE_REFUSALS = new Set([
  "cancel_reserve:invalid", "cancel_reserve:invalid_reason", "cancel_reserve:no_session", "cancel_reserve:invalid_session",
  "cancel_reserve:no_order", "cancel_reserve:no_attempt", "cancel_reserve:not_paid", "cancel_reserve:legacy_order",
  "cancel_reserve:identity_mismatch", "cancel_reserve:already_refunded", "cancel_reserve:in_progress",
]);

function isReserved(v: unknown): v is ReservedRefund {
  const r = v as Record<string, unknown> | null;
  return !!r && typeof r.cancellation_id === "string" && typeof r.order_id === "string" && typeof r.payment_key === "string"
    && typeof r.amount === "number" && r.amount > 0 && typeof r.reason === "string" && typeof r.toss_idempotency_key === "string"
    && r.toss_idempotency_key.length > 0;
}

export async function reserveRefund(
  admin: SupabaseClient, p: { orderId: string; reason: string; sessionId: string },
): Promise<{ ok: true; reserved: ReservedRefund } | { ok: false; code: string }> {
  const { data, error } = await admin.rpc("payment_cancel_reserve", {
    p_order_id: p.orderId, p_reason: p.reason, p_requested_by_session: p.sessionId,
  });
  if (error) {
    if (RESERVE_REFUSALS.has(error.message ?? "")) return { ok: false, code: error.message };
    // The one-active index refused a concurrent second reservation.
    if (error.code === "23505") return { ok: false, code: "cancel_reserve:in_progress" };
    console.error("[refund] reservation failed", { orderId: p.orderId, error });
    return { ok: false, code: "cancel_reserve:unavailable" };
  }
  if (!isReserved(data)) {
    console.error("[refund] reservation returned an unexpected shape", { orderId: p.orderId });
    return { ok: false, code: "cancel_reserve:unavailable" };
  }
  return { ok: true, reserved: data };
}

type From = "pending" | "reconciliation_required";

// Records the first POST's outcome on the pending row. false = not recorded
// (the row then has no outcome, so it can never become 'failed').
async function recordPost(admin: SupabaseClient, id: string, post: CancelPostOutcome): Promise<boolean> {
  const { data, error } = await admin.rpc("payment_cancel_record_post", {
    p_id: id, p_outcome: post.outcome, p_http_status: post.httpStatus, p_error_code: post.errorCode,
  });
  if (error || data !== true) {
    console.error("[refund] could not record the cancel POST outcome", { cancellationId: id, outcome: post.outcome, error: error ?? null, result: data ?? null });
    return false;
  }
  return true;
}

async function mark(
  admin: SupabaseClient, id: string, from: From, status: "failed" | "reconciliation_required",
  f: { tossStatus: string | null; tossResponse: Record<string, unknown> | null; detail: string },
): Promise<boolean> {
  const { data, error } = await admin.rpc("payment_cancel_mark", {
    p_id: id, p_from: from, p_status: status, p_toss_status: f.tossStatus, p_toss_response: f.tossResponse, p_error_detail: f.detail,
  });
  if (error || data !== true) {
    console.error("[refund] could not record the cancellation outcome", { cancellationId: id, status, from, error: error ?? null, result: data ?? null });
    return false;
  }
  return true;
}

// Applies a settled verdict to the row (moving it only from `from`).
async function apply(
  admin: SupabaseClient, row: { id: string; order_id: string; payment_key: string }, from: From,
  verdict: CancelVerdict, tossError: Record<string, unknown> | null,
): Promise<RefundResult> {
  const masked = maskPaymentKey(row.payment_key);
  if (verdict.verdict === "done") {
    const { data, error } = await admin.rpc("payment_cancel_finalize", {
      p_id: row.id, p_toss_status: verdict.cancel.payment.status, p_transaction_key: verdict.cancel.transactionKey,
      p_canceled_at: verdict.cancel.canceledAt, p_toss_response: storedTossCancelPayment(verdict.cancel.payment),
    });
    if (!error && (data === "done" || data === "already_done")) {
      return { ok: true, status: "done", cancellationId: row.id, detail: data };
    }
    // Toss canceled it but DTB could not record it: never "failed".
    console.error("[refund] Toss canceled the payment but the refund could not be recorded — reconciliation_required", {
      orderId: row.order_id, cancellationId: row.id, paymentKey: masked, error: error ?? null, result: data ?? null,
    });
    await mark(admin, row.id, from, "reconciliation_required", {
      tossStatus: verdict.cancel.payment.status, tossResponse: storedTossCancelPayment(verdict.cancel.payment),
      detail: `finalize_error:${String(error?.message ?? data)}`.slice(0, 500),
    });
    return { ok: true, status: "reconciliation_required", cancellationId: row.id, detail: "finalize_error" };
  }

  const payment = verdict.payment;
  const tossResponse = payment ? storedTossCancelPayment(payment) : tossError;
  if (verdict.verdict === "failed") {
    console.warn("[refund] Toss refused the cancellation and the payment is not canceled — failed", {
      orderId: row.order_id, cancellationId: row.id, paymentKey: masked, detail: verdict.detail,
    });
    const marked = await mark(admin, row.id, from, "failed", { tossStatus: verdict.payment.status, tossResponse, detail: verdict.detail });
    return marked
      ? { ok: true, status: "failed", cancellationId: row.id, detail: verdict.detail }
      : { ok: true, status: "reconciliation_required", cancellationId: row.id, detail: "mark_failed_error" };
  }

  console.error("[refund] cancellation outcome needs review — reconciliation_required", {
    orderId: row.order_id, cancellationId: row.id, paymentKey: masked, detail: verdict.detail, toss: tossError,
  });
  await mark(admin, row.id, from, "reconciliation_required", { tossStatus: payment?.status ?? null, tossResponse, detail: verdict.detail });
  return { ok: true, status: "reconciliation_required", cancellationId: row.id, detail: verdict.detail };
}

// The cancel POST for a row just reserved (status 'pending').
export async function executeRefund(admin: SupabaseClient, secretKey: string, r: ReservedRefund): Promise<RefundResult> {
  const expected: ExpectedPayment = { paymentKey: r.payment_key, orderId: r.order_id, amount: r.amount };
  const row = { id: r.cancellation_id, order_id: r.order_id, payment_key: r.payment_key };
  const post = await cancelTossPayment({
    secretKey, paymentKey: r.payment_key, cancelReason: r.reason, idempotencyKey: r.toss_idempotency_key,
  });
  const pv = classifyCancelPost(post, expected);
  const recorded = await recordPost(admin, r.cancellation_id, pv.post);
  if (pv.verdict === "done") return apply(admin, row, "pending", pv, null);
  if (pv.verdict === "review") return apply(admin, row, "pending", pv, null);

  console.warn("[refund] cancel answer not settled — looking the payment up", {
    orderId: r.order_id, cancellationId: r.cancellation_id, paymentKey: maskPaymentKey(r.payment_key), detail: pv.detail,
  });
  const lookup = await getTossPayment({ secretKey, paymentKey: r.payment_key });
  // Only what the row now holds may lead to 'failed' (the DB enforces it too).
  const lv = classifyCancelLookup(lookup, expected, recorded ? pv.post.outcome : null);
  const settled: CancelVerdict = lv.verdict === "done" ? lv : { ...lv, detail: `${pv.detail}|${lv.detail}` };
  return apply(admin, row, "pending", settled, storedTossError(post) ?? storedTossError(lookup));
}

type CancellationRow = {
  id: string; order_id: string; payment_key: string; amount: number; status: string;
  initial_post_outcome: CancelPostOutcomeKind | null; requested_at: string;
};

// Re-check: the lookup only. Whether the original POST was a definitive
// rejection comes from the row's initial_post_outcome column.
export async function recheckRefund(
  admin: SupabaseClient, secretKey: string, cancellationId: string, nowMs: number = Date.now(),
): Promise<RefundResult> {
  const { data, error } = await admin.from("payment_cancellations")
    .select("id, order_id, payment_key, amount, status, initial_post_outcome, requested_at")
    .eq("id", cancellationId)
    .maybeSingle();
  if (error) {
    console.error("[refund] cancellation lookup failed", { cancellationId, error });
    return { ok: false, code: "refund_recheck:unavailable" };
  }
  const row = data as CancellationRow | null;
  if (!row) return { ok: false, code: "refund_recheck:not_found" };
  if (row.status === "done" || row.status === "failed") {
    return { ok: true, status: row.status, cancellationId: row.id, detail: "already_settled" };
  }
  if (row.status === "pending" && !(nowMs - Date.parse(row.requested_at) >= STALE_PENDING_MS)) {
    return { ok: false, code: "refund_recheck:in_flight" };
  }
  const from: From = row.status === "pending" ? "pending" : "reconciliation_required";

  console.warn("[refund] re-checking a cancellation with a Toss lookup", {
    orderId: row.order_id, cancellationId: row.id, paymentKey: maskPaymentKey(row.payment_key),
  });
  const lookup = await getTossPayment({ secretKey, paymentKey: row.payment_key });
  const lv = classifyCancelLookup(lookup, { paymentKey: row.payment_key, orderId: row.order_id, amount: row.amount }, row.initial_post_outcome);
  const settled: CancelVerdict = lv.verdict === "done" ? lv : { ...lv, detail: `recheck:${row.initial_post_outcome ?? "no_post_outcome"}|${lv.detail}` };
  return apply(admin, row, from, settled, storedTossError(lookup));
}
