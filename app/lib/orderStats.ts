// My Page order history + savings. Pure (no Supabase) so it can be
// unit-tested; app/mypage/page.tsx does the queries.
//
// An order with win_id (every order since code deploy 1) is shown with its
// auction_wins row: the product name and the start price of THAT round, so
// savings / "반응왕" / "버티기 고수" don't shift when a later round is
// configured differently. A legacy order (win_id null, or its win row not
// returned) keeps the old behaviour: its own product_name/amount against
// the current game_state.start_price.

export type OrderRow = { product_name: string; amount: number; created_at: string; win_id: string | null };
export type WinRow = { id: string; product_name: string; start_price: number; winning_price: number };
export type DisplayOrder = { product_name: string; amount: number; created_at: string; start_price: number };

export function buildOrderStats(
  orders: OrderRow[],
  wins: WinRow[],
  fallbackStartPrice: number,
): { orders: DisplayOrder[]; wins: number; savings: number } {
  const byId = new Map(wins.map((w) => [w.id, w]));
  const display = orders.map((o) => {
    const w = o.win_id ? byId.get(o.win_id) : undefined;
    return w
      ? { product_name: w.product_name, amount: w.winning_price, created_at: o.created_at, start_price: w.start_price }
      : { product_name: o.product_name, amount: o.amount, created_at: o.created_at, start_price: fallbackStartPrice };
  });
  const savings = display.reduce((sum, o) => sum + Math.max(0, o.start_price - o.amount), 0);
  return { orders: display, wins: display.length, savings };
}
