// "Has this user already got an order for this win?" — the orders lookup
// shared by usePendingWin() (recovery CTA) and /payment (already-paid
// screen). UX only — the DB's one-active-payment-per-win and
// orders_one_per_win guards are what actually prevent a second payment.
// RLS (auth.uid() = user_id) limits both queries to the user's own orders.
import { supabase } from "./supabase";

// true = order found, false = none, null = lookup failed (unknown).

// Win recorded in auction_wins (every win since M1): exact match on
// orders.win_id.
export async function hasOrderForWinId(winId: string): Promise<boolean | null> {
  const { data, error } = await supabase
    .from("orders")
    .select("order_id")
    .eq("win_id", winId)
    .limit(1);
  if (error) return null;
  return (data?.length ?? 0) > 0;
}

// Legacy win (no auction_wins row): the old heuristic, same rule as the
// admin payment-status route's legacy fallback — an order of the user's
// with no win_id, amount = winner_price, created at or after
// winner_claimed_at.
export async function hasLegacyOrderForWin(userId: string, price: number, claimedAt: string | number): Promise<boolean | null> {
  const { data, error } = await supabase
    .from("orders")
    .select("order_id")
    .eq("user_id", userId)
    .is("win_id", null)
    .eq("amount", price)
    .gte("created_at", new Date(claimedAt).toISOString())
    .limit(1);
  if (error) return null;
  return (data?.length ?? 0) > 0;
}

// Order for an auction_wins win: by win_id, or — for a win claimed after
// M1 but paid through the pre-deploy code, whose order has no win_id — by
// the legacy heuristic on that win's own price and claimed_at.
export async function hasOrderForAuctionWin(
  userId: string,
  win: { id: string; winning_price: number; claimed_at: string },
): Promise<boolean | null> {
  const byWinId = await hasOrderForWinId(win.id);
  if (byWinId) return true;
  const legacy = await hasLegacyOrderForWin(userId, win.winning_price, win.claimed_at);
  if (legacy) return true;
  return byWinId === null || legacy === null ? null : false;
}
