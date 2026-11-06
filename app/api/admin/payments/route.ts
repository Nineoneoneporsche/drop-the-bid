import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, isSameOrigin, getSupabaseAdmin } from "../../../lib/adminAuth";
import { buildAdminPaymentItems } from "../../../lib/adminRefund";
import { STALE_PENDING_MS } from "../../../lib/paymentRefund";

// GET /api/admin/payments — recent paid orders with their refund state
// (M4-B3). Reads payment_attempts (status paid), their orders and their
// payment_cancellations with the service-role client and answers only what
// the admin list shows (app/lib/adminRefund.ts AdminPaymentItem): never a
// paymentKey, an Idempotency-Key, a Toss response, a user id or shipping data.

const LIMIT = 50;

export async function GET(req: NextRequest) {
  if (!(await requireAdminSession(req))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!isSameOrigin(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const admin = getSupabaseAdmin();
  const { data: attempts, error: attemptsError } = await admin
    .from("payment_attempts")
    .select("order_id, amount, approved_at, created_at")
    .eq("status", "paid")
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  if (attemptsError) {
    console.error("[admin/payments] payment_attempts lookup failed", { error: attemptsError });
    return NextResponse.json({ ok: false, error: "unavailable" }, { status: 500 });
  }
  const rows = (attempts ?? []) as { order_id: string; amount: number; approved_at: string | null; created_at: string | null }[];
  const orderIds = rows.map((r) => r.order_id);
  if (orderIds.length === 0) return NextResponse.json({ ok: true, items: [] });

  const [{ data: orders, error: ordersError }, { data: cancellations, error: cancellationsError }] = await Promise.all([
    admin.from("orders").select("order_id, product_name, win_id, refunded_at, created_at").in("order_id", orderIds),
    admin.from("payment_cancellations")
      .select("id, order_id, status, reason, canceled_at, last_checked_at, requested_at")
      .in("order_id", orderIds),
  ]);
  if (ordersError || cancellationsError) {
    console.error("[admin/payments] orders / payment_cancellations lookup failed", { error: ordersError ?? cancellationsError });
    return NextResponse.json({ ok: false, error: "unavailable" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    items: buildAdminPaymentItems(rows, (orders ?? []) as never[], (cancellations ?? []) as never[], { nowMs: Date.now(), stalePendingMs: STALE_PENDING_MS }),
  });
}
