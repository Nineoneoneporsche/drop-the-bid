// Server-only: recording what Toss says about a payment_attempts row —
// shared by /api/payment/confirm (first approval, and the re-check of a
// reconciliation_required attempt it meets) and /api/payment/recheck (the
// "결제 상태 확인" button on /mypage). Uses the service-role client it is
// given; never logs a key, a secret or a full paymentKey.
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PAYMENT_CONFIG_ERROR, PAYMENT_MESSAGES, PAYMENT_NEEDS_REVIEW, PAYMENT_SYSTEM_UNAVAILABLE } from "./paymentCodes";
import {
  classifyConfirm, classifyLookup, confirmTossPayment, getTossPayment, maskPaymentKey, paymentSummary,
  storedTossError, storedTossPayment, type ExpectedPayment, type PaymentVerdict, type TossPayment,
} from "./tossClient";

// Every refusal the user sees is one of our codes with our own text (see
// app/lib/paymentCodes.ts) — Toss's code / message only reach the log and
// payment_attempts.
export const refuse = (code: string, status: number, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ ok: false, code, error: PAYMENT_MESSAGES[code], ...extra }, { status });
export const RESPONSE_NEEDS_REVIEW = (status = 409) => refuse(PAYMENT_NEEDS_REVIEW, status);
export const RESPONSE_UNAVAILABLE = (status = 500) => refuse(PAYMENT_SYSTEM_UNAVAILABLE, status);

export type AuctionWin = {
  id: string;
  winner_id: string;
  product_name: string;
  winning_price: number;
  claimed_at: string;
  payment_deadline: string;
};

type Settled = { verdict: Exclude<PaymentVerdict, { verdict: "ambiguous" }>; tossError: Record<string, unknown> | null };

// Toss confirm (with the attempt's Idempotency-Key) and, when its answer
// doesn't settle it, one lookup. Outcomes (app/lib/tossClient.ts
// classifyConfirm / classifyLookup):
//   done          DONE, paymentKey / orderId / amount / KRW / method match -> order + paid
//   not_approved  provably not approved (decline allowlist, lookup
//                 ABORTED / EXPIRED) -> 'failed', the win is free again
//   review        anything else that is known but not "paid" (other
//                 statuses, identity mismatch, lookup failure / 404)
//                 -> 'reconciliation_required', the win stays locked
//   ambiguous     (confirm only: network / timeout / unreadable body /
//                 5xx / 408 / 429 / ALREADY_PROCESSED_PAYMENT / any
//                 unlisted code) -> one lookup decides between the above
export async function settleWithToss(
  secretKey: string,
  p: { paymentKey: string; orderId: string; amount: number; idempotencyKey: string },
): Promise<Settled> {
  const expected: ExpectedPayment = { paymentKey: p.paymentKey, orderId: p.orderId, amount: p.amount };
  const confirmResult = await confirmTossPayment({
    secretKey, paymentKey: p.paymentKey, orderId: p.orderId, amount: p.amount, idempotencyKey: p.idempotencyKey,
  });
  const confirmVerdict = classifyConfirm(confirmResult, expected);
  let tossError = storedTossError(confirmResult);
  if (confirmVerdict.verdict !== "ambiguous") return { verdict: confirmVerdict, tossError };
  console.warn("[payment/confirm] Toss confirm outcome not settled — looking the payment up", {
    orderId: p.orderId, paymentKey: maskPaymentKey(p.paymentKey), detail: confirmVerdict.detail,
  });
  const lookup = await getTossPayment({ secretKey, paymentKey: p.paymentKey });
  const settled = classifyLookup(lookup, expected);
  tossError = storedTossError(lookup) ?? tossError;
  return { verdict: settled.verdict === "done" ? settled : { ...settled, detail: `${confirmVerdict.detail}|${settled.detail}` }, tossError };
}

export type AttemptStatus = "pending" | "reconciliation_required";

// Records what Toss said on the attempt, moving it only from `from` (its
// status when this request read it). `keepTossResponse`: a re-check that
// did not get a Payment back leaves an earlier stored Payment in place.
export async function applyVerdict(
  admin: AdminClient,
  verdict: Settled["verdict"],
  tossError: Record<string, unknown> | null,
  ctx: { orderId: string; paymentKey: string; amount: number; productName: string | null; from: AttemptStatus; keepTossResponse?: boolean },
): Promise<NextResponse> {
  const { orderId, paymentKey, from } = ctx;
  if (verdict.verdict === "done") {
    return finalize(admin, { orderId, paymentKey, payment: verdict.payment, productName: ctx.productName, amount: ctx.amount, from });
  }

  if (verdict.verdict === "not_approved") {
    console.warn("[payment/confirm] Toss did not approve the payment — attempt failed", {
      orderId, paymentKey: maskPaymentKey(paymentKey), detail: verdict.detail, toss: tossError,
    });
    const marked = await markAttempt(admin, orderId, "failed", {
      toss_response: verdict.payment ? storedTossPayment(verdict.payment) : tossError,
      toss_status: verdict.payment?.status ?? null,
      error_detail: verdict.detail,
      last_checked_at: new Date().toISOString(),
    }, from);
    // Not recorded as failed -> the attempt keeps its status (the win stays
    // locked); tell the user it is under review, not "declined".
    if (!marked) return RESPONSE_NEEDS_REVIEW(503);
    return refuse(verdict.userCode, verdict.userCode === PAYMENT_CONFIG_ERROR ? 503 : 400);
  }

  // review (the ambiguous case always ended in done / not_approved / review)
  console.error("[payment/confirm] Toss outcome needs review — reconciliation_required", {
    orderId, paymentKey: maskPaymentKey(paymentKey), detail: verdict.detail, toss: tossError,
  });
  const reviewPayment = verdict.payment;
  const keep = ctx.keepTossResponse && !reviewPayment;
  await markAttempt(admin, orderId, "reconciliation_required", {
    ...(keep ? {} : { toss_response: reviewPayment ? storedTossPayment(reviewPayment) : tossError, toss_status: reviewPayment?.status ?? null }),
    error_detail: verdict.detail,
    last_checked_at: new Date().toISOString(),
  }, from);
  return RESPONSE_NEEDS_REVIEW(502);
}

// An M4-A reconciliation_required attempt Toss can be asked about again:
// it has its paymentKey, the Idempotency-Key it was confirmed with (the
// M4-A marker), and a win. (Legacy / pre-M4-A rows have no key: an operator settles those.)
export function isRecheckable(a: Record<string, unknown>): boolean {
  return a.status === "reconciliation_required"
    && typeof a.payment_key === "string" && a.payment_key.length > 0
    && typeof a.toss_idempotency_key === "string" && a.toss_idempotency_key.length > 0
    && typeof a.win_id === "string";
}

// Re-check of a reconciliation_required attempt: a Toss lookup (GET
// /v1/payments/{paymentKey}) of the attempt's own paymentKey, judged
// against its orderId / amount — never a confirm: Toss answers a repeated
// Idempotency-Key with the FIRST response (errors included) for 15 days,
// so re-sending the confirmation could not retry it, and no new key is
// ever issued (no new attempt either). Applied as for a first
// confirmation's lookup: DONE + identity match -> payment_finalize_paid;
// EXPIRED / ABORTED -> failed; anything else (READY / IN_PROGRESS /
// unknown status, 404, timeout, network, identity mismatch) stays
// reconciliation_required; last_checked_at updated either way. Only for
// the attempt's own user, and only while the attempt still matches its win
// (winner, price). Once Toss has reported this payment DONE (toss_status /
// approved_at / a stored DONE response), a re-check never frees the win
// as failed.
export async function recheckReconciliation(
  admin: AdminClient,
  secretKey: string,
  att: Record<string, unknown>,
  win: AuctionWin | null,
  userId: string,
): Promise<NextResponse> {
  const orderId = att.order_id as string;
  if (!isRecheckable(att)) return RESPONSE_NEEDS_REVIEW();
  const mismatch: string[] = [];
  if (att.user_id !== userId) mismatch.push("user_id");
  if (att.winner_id !== userId) mismatch.push("winner_id");
  if (!win) mismatch.push("win");
  else {
    if (win.id !== att.win_id) mismatch.push("win_id");
    if (win.winner_id !== userId) mismatch.push("win_winner");
    if (win.winning_price !== att.amount) mismatch.push("amount");
  }
  if (typeof att.amount !== "number" || !(att.amount > 0)) mismatch.push("amount_value");
  if (mismatch.length > 0) {
    console.error("[payment/confirm] reconciliation_required attempt does not match its win — not re-checked", { orderId, mismatch });
    return RESPONSE_NEEDS_REVIEW();
  }
  const paymentKey = att.payment_key as string;
  const amount = att.amount as number;
  console.warn("[payment/confirm] re-checking a reconciliation_required attempt with a Toss lookup", {
    orderId, paymentKey: maskPaymentKey(paymentKey),
  });
  const lookup = await getTossPayment({ secretKey, paymentKey });
  const tossError = storedTossError(lookup);
  const looked = classifyLookup(lookup, { paymentKey, orderId, amount });
  let verdict: Settled["verdict"] = looked.verdict === "done" ? looked : { ...looked, detail: `recheck|${looked.detail}` };
  const storedStatus = (att.toss_response as { status?: unknown } | null)?.status;
  const sawDone = att.toss_status === "DONE" || att.approved_at != null || storedStatus === "DONE";
  if (verdict.verdict === "not_approved" && sawDone) {
    verdict = { verdict: "review", detail: `recheck_not_approved_after_done:${verdict.detail}`, payment: verdict.payment };
  }
  return applyVerdict(admin, verdict, tossError, {
    orderId, paymentKey, amount, productName: win!.product_name, from: "reconciliation_required",
    keepTossResponse: att.toss_status != null,
  });
}

export type AdminClient = SupabaseClient;

// pending / reconciliation_required -> failed / reconciliation_required,
// only from `from` (the guard trigger on payment_attempts enforces the
// allowed transitions too). true only when exactly this attempt was
// updated; an error or 0 rows is logged and reported, never ignored.
export async function markAttempt(
  admin: AdminClient, orderId: string, status: "failed" | "reconciliation_required", fields: Record<string, unknown>,
  from: AttemptStatus = "pending",
): Promise<boolean> {
  const { data, error } = await admin.from("payment_attempts")
    .update({ status, ...fields, updated_at: new Date().toISOString() })
    .eq("order_id", orderId)
    .eq("status", from)
    .select("order_id");
  if (error || !data || data.length !== 1) {
    console.error(`[payment/confirm] could not record the attempt outcome — it stays ${from} for an operator`, {
      orderId, status, rows: data?.length ?? null, error,
    });
    return false;
  }
  return true;
}

// Toss DONE (verified) -> payment_finalize_paid(): order INSERT + attempt
// 'paid' in ONE transaction (attempt row locked; order built from the
// attempt's own amount / paymentKey / shipping snapshot and the win's
// product name). Its non-paid answers (this win already has another order,
// order mismatch, no snapshot, paymentKey already on another order) leave
// the attempt reconciliation_required inside that same transaction. Never
// reported as success unless the order and 'paid' are both committed.
async function finalize(
  admin: AdminClient,
  p: { orderId: string; paymentKey: string; payment: TossPayment; productName: string | null; amount: number; from: AttemptStatus },
): Promise<NextResponse> {
  const stored = storedTossPayment(p.payment);
  const { data, error } = await admin.rpc("payment_finalize_paid", {
    p_order_id: p.orderId,
    p_toss_response: stored,
    p_toss_status: p.payment.status,
    p_approved_at: p.payment.approvedAt,
  });
  if (error) {
    // The transaction rolled back: no order, attempt unchanged. Keep
    // what Toss said on the attempt so it can be completed by hand.
    console.error("[payment/confirm] payment finalization failed after Toss DONE — reconciliation_required", {
      orderId: p.orderId, paymentKey: maskPaymentKey(p.paymentKey), amount: p.amount, error,
    });
    await markAttempt(admin, p.orderId, "reconciliation_required", {
      toss_response: stored, toss_status: p.payment.status, approved_at: p.payment.approvedAt,
      error_detail: `finalize_error:${String(error.message ?? error)}`.slice(0, 500),
      last_checked_at: new Date().toISOString(),
    }, p.from);
    return RESPONSE_NEEDS_REVIEW(503);
  }
  if (data === "paid" || data === "already_paid") {
    return NextResponse.json({ ok: true, data: paymentSummary(stored, { orderId: p.orderId, amount: p.amount, orderName: p.productName }) });
  }
  console.error("[payment/confirm] Toss DONE but the order could not be recorded as paid — reconciliation_required", {
    orderId: p.orderId, paymentKey: maskPaymentKey(p.paymentKey), amount: p.amount, result: data,
  });
  return RESPONSE_NEEDS_REVIEW();
}
