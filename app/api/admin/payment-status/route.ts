import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, isSameOrigin, getSupabaseAdmin } from "../../../lib/adminAuth";
import { WINNER_PAYMENT_WINDOW_SECONDS } from "../../../lib/paymentWindow";
import { ACTIVE_ATTEMPT_STATUSES } from "../../../lib/paymentCodes";

type AdminClient = ReturnType<typeof getSupabaseAdmin>;

// Legacy order match (orders.win_id is null): same winner, same price,
// created at or after the claim.
async function legacyOrderMatch(
  admin: AdminClient, winnerId: string, price: number, claimedAt: string,
): Promise<{ found: boolean; error: string | null }> {
  const { data, error } = await admin
    .from("orders")
    .select("id")
    .eq("winner_id", winnerId)
    .is("win_id", null)
    .eq("amount", price)
    .gte("created_at", claimedAt)
    .limit(1)
    .maybeSingle();
  return { found: !!data, error: error ? error.message : null };
}

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
    .select("round_key, winner_id, winner_price, winner_claimed_at")
    .eq("id", 1)
    .single();

  if (gameStateError) {
    return NextResponse.json({ ok: false, error: gameStateError.message }, { status: 500 });
  }

  // The current round's win is its auction_wins row (M1), found by
  // round_key. Its payment state is decided by win_id alone:
  //   paid                     an order with this win_id exists
  //   pending / reconciliation_required
  //                            the win's active payment_attempts row
  //   unpaid                   neither
  // plus the legacy match below, for a win claimed after M1 but paid
  // through the pre-deploy code (rows written without win_id).
  let paymentComplete: boolean | null = null;
  let paymentState: "paid" | "pending" | "reconciliation_required" | "unpaid" | null = null;
  let winId: string | null = null;

  if (gameState?.round_key) {
    const { data: win, error: winError } = await admin
      .from("auction_wins")
      .select("id, winner_id, winning_price, claimed_at")
      .eq("round_key", gameState.round_key)
      .maybeSingle();
    if (winError) {
      return NextResponse.json({ ok: false, error: winError.message }, { status: 500 });
    }
    if (win) {
      winId = win.id;
      const [{ data: order, error: orderError }, { data: attempt, error: attemptError }] = await Promise.all([
        admin.from("orders").select("id").eq("win_id", win.id).limit(1).maybeSingle(),
        admin.from("payment_attempts").select("status").eq("win_id", win.id)
          .in("status", [...ACTIVE_ATTEMPT_STATUSES]).limit(1).maybeSingle(),
      ]);
      if (orderError || attemptError) {
        return NextResponse.json({ ok: false, error: (orderError ?? attemptError)!.message }, { status: 500 });
      }
      let legacyPaid = false;
      if (!order && !attempt) {
        const legacy = await legacyOrderMatch(admin, win.winner_id, win.winning_price, win.claimed_at);
        if (legacy.error) return NextResponse.json({ ok: false, error: legacy.error }, { status: 500 });
        legacyPaid = legacy.found;
      }
      paymentComplete = !!order || legacyPaid;
      paymentState = paymentComplete
        ? "paid"
        : attempt?.status === "reconciliation_required" || attempt?.status === "pending"
          ? attempt.status
          : "unpaid";
    }
  }

  // Legacy fallback — a win with no auction_wins row (claimed before M1):
  // the old heuristic. orders had no round identifier, so "did the current
  // winner pay for THIS round" is: same winner, same price, an order
  // created no earlier than this round's winner_claimed_at. Matches on
  // orders.winner_id, not user_id — user_id goes null if the account is
  // later deleted (ON DELETE SET NULL), winner_id is immutable.
  if (!winId && gameState?.winner_id && gameState.winner_price != null && gameState.winner_claimed_at) {
    const legacy = await legacyOrderMatch(admin, gameState.winner_id, gameState.winner_price, gameState.winner_claimed_at);
    if (legacy.error) return NextResponse.json({ ok: false, error: legacy.error }, { status: 500 });
    paymentComplete = legacy.found;
    paymentState = legacy.found ? "paid" : "unpaid";
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
    paymentState,
    winId,
    stalePendingCount: stalePendingCount ?? 0,
    reconciliationRequiredCount: reconciliationRequiredCount ?? 0,
  });
}
