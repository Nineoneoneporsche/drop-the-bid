import { NextRequest, NextResponse } from "next/server";
import { requireAdminSessionId, isSameOrigin, getSupabaseAdmin } from "../../../lib/adminAuth";
import { normalizeRefundReason, REFUND_MESSAGES } from "../../../lib/adminRefund";
import { executeRefund, reserveRefund } from "../../../lib/paymentRefund";
import { resolveTossServerConfig } from "../../../lib/tossEnv";

// POST /api/admin/refund { orderId, reason } — full refund of one paid
// order (M4-B3). Only the order id and the reason are read from the
// request; everything about the payment (paymentKey, amount, win, the
// Idempotency-Key) comes from the DB through payment_cancel_reserve, which
// also refuses a refunded order, a refund in progress and a non-paid order,
// and lets only one of two concurrent requests through. Then one Toss
// cancel POST, its outcome recorded, at most one lookup, and the row
// settled (app/lib/paymentRefund.ts executeRefund):
//   done | failed | reconciliation_required.
//
// Answers { ok, status, cancellationId, message } — never a paymentKey, a
// key or a Toss response.

// The cancel POST has a 30 s timeout and the lookup 10 s (tossClient.ts).
export const maxDuration = 60;

const ORDER_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

const REFUSAL_STATUS: Record<string, number> = {
  "cancel_reserve:already_refunded": 409,
  "cancel_reserve:in_progress": 409,
  "cancel_reserve:not_paid": 409,
  "cancel_reserve:legacy_order": 409,
  "cancel_reserve:identity_mismatch": 409,
  "cancel_reserve:no_order": 404,
  "cancel_reserve:no_attempt": 404,
  "cancel_reserve:invalid": 400,
  "cancel_reserve:invalid_reason": 400,
  "cancel_reserve:no_session": 401,
  "cancel_reserve:invalid_session": 401,
};

export async function POST(req: NextRequest) {
  const sessionId = await requireAdminSessionId(req);
  if (!sessionId) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!isSameOrigin(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_request" }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const orderId = typeof b.orderId === "string" && ORDER_ID_RE.test(b.orderId) ? b.orderId : null;
  if (!orderId) return NextResponse.json({ ok: false, error: "invalid_request" }, { status: 400 });
  const reason = normalizeRefundReason(b.reason);
  if (!reason) return NextResponse.json({ ok: false, error: "cancel_reserve:invalid_reason" }, { status: 400 });

  // Checked before anything is reserved: a misconfigured key must not leave
  // a pending row behind.
  const toss = resolveTossServerConfig();
  if (!toss.ok) {
    console.error("[admin/refund] Toss key configuration refused — no refund", { reason: toss.reason, vercelEnv: toss.vercelEnv });
    return NextResponse.json({ ok: false, error: "config" }, { status: 503 });
  }

  const admin = getSupabaseAdmin();
  const reserved = await reserveRefund(admin, { orderId, reason, sessionId });
  if (!reserved.ok) {
    return NextResponse.json({ ok: false, error: reserved.code }, { status: REFUSAL_STATUS[reserved.code] ?? 503 });
  }

  const result = await executeRefund(admin, toss.secretKey, reserved.reserved);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.code }, { status: 503 });
  }
  return NextResponse.json({
    ok: true, status: result.status, cancellationId: result.cancellationId, message: REFUND_MESSAGES[result.status],
  });
}
