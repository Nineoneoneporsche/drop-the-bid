// "Has this user already got an order for this win?" — the orders lookup
// shared by usePendingWin() (recovery CTA) and /payment (already-paid
// screen). Same rule as the admin payment-status route: the user's own
// order (RLS: auth.uid() = user_id) with amount = winner_price created at
// or after winner_claimed_at. UX only — the one-active-payment-per-win
// guard in the DB is what actually prevents a second payment.
import { supabase } from "./supabase";

// true = order found, false = none, null = lookup failed (unknown).
export async function hasOrderForWin(userId: string, price: number, claimedAt: string | number): Promise<boolean | null> {
  const { data, error } = await supabase
    .from("orders")
    .select("order_id")
    .eq("user_id", userId)
    .eq("amount", price)
    .gte("created_at", new Date(claimedAt).toISOString())
    .limit(1);
  if (error) return null;
  return (data?.length ?? 0) > 0;
}
