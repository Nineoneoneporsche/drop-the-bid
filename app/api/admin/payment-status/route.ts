import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, isSameOrigin, getSupabaseAdmin } from "../../../lib/adminAuth";
import { WINNER_PAYMENT_WINDOW_SECONDS } from "../../../lib/paymentWindow";

export async function GET(req: NextRequest) {
  if (!(await requireAdminSession(req))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!isSameOrigin(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const admin = getSupabaseAdmin();

  const { data: gameState, error: gameStateError } = await admin
    .from("game_state")
    .select("winner_id, winner_price, winner_claimed_at")
    .eq("id", 1)
    .single();

  if (gameStateError) {
    return NextResponse.json({ ok: false, error: gameStateError.message }, { status: 500 });
  }

  // orders has no auction/round identifier column, so "did the current
  // winner actually pay for THIS round" is determined by matching all
  // three of: same winner, same price, and an order created no earlier
  // than the moment this round's winner was decided. A stale order from a
  // previous round can't satisfy all three at once (a different round has
  // its own winner_claimed_at, so an old order's created_at will predate
  // the current one).
  //
  // Matches on orders.winner_id, not orders.user_id — user_id goes null if
  // the account is later deleted (ON DELETE SET NULL, so the order itself
  // survives), but winner_id is a plain immutable column with no FK to
  // auth.users, set once at insert and never touched again, so this stays
  // correct even after the winner deletes their account post-payment.
  let paymentComplete: boolean | null = null;
  if (gameState?.winner_id && gameState.winner_price != null && gameState.winner_claimed_at) {
    const { data: matchingOrder, error: orderError } = await admin
      .from("orders")
      .select("id")
      .eq("winner_id", gameState.winner_id)
      .eq("amount", gameState.winner_price)
      .gte("created_at", gameState.winner_claimed_at)
      .limit(1)
      .maybeSingle();

    if (orderError) {
      return NextResponse.json({ ok: false, error: orderError.message }, { status: 500 });
    }
    paymentComplete = !!matchingOrder;
  }

  const staleBefore = new Date(Date.now() - WINNER_PAYMENT_WINDOW_SECONDS * 1000).toISOString();

  const { count: stalePendingCount, error: pendingError } = await admin
    .from("payment_attempts")
    .select("order_id", { count: "exact", head: true })
    .eq("status", "pending")
    .lt("created_at", staleBefore);

  if (pendingError) {
    return NextResponse.json({ ok: false, error: pendingError.message }, { status: 500 });
  }

  const { count: reconciliationRequiredCount, error: reconError } = await admin
    .from("payment_attempts")
    .select("order_id", { count: "exact", head: true })
    .eq("status", "reconciliation_required");

  if (reconError) {
    return NextResponse.json({ ok: false, error: reconError.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    paymentComplete,
    stalePendingCount: stalePendingCount ?? 0,
    reconciliationRequiredCount: reconciliationRequiredCount ?? 0,
  });
}
