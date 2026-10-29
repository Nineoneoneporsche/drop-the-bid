// auction_wins (M1, supabase/migrations/20261028150000_auction_wins.sql) is
// the durable record of a win: one row per round, written only by
// claim_winner(). New payments are tied to it by win_id.
//
// Browser access: authenticated has column-level SELECT on exactly the
// columns below, own rows only (RLS winner_id = auth.uid()). select("*"),
// winner_id and price_inputs are refused — so the client always selects
// AUCTION_WIN_CLIENT_COLUMNS explicitly. Anything needing winner_id goes
// through a service_role route (/api/payment/confirm,
// /api/admin/payment-status).
//
// Pure module (no Supabase client import): the server route uses isWinId()
// too, and the lookups take their client as a parameter so they can be
// unit-tested.

export const AUCTION_WIN_CLIENT_COLUMNS =
  "id, round_key, winner_nickname, product_name, start_price, winning_price, claimed_at, payment_deadline";

export type ClientAuctionWin = {
  id: string;
  round_key: string;
  winner_nickname: string;
  product_name: string;
  start_price: number;
  winning_price: number;
  claimed_at: string;
  payment_deadline: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isWinId(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

type QueryResult<T> = PromiseLike<{ data: T | null; error: unknown }>;
// The slice of a Supabase client the lookups below use.
export type WinLookupClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: unknown) => {
        single: () => QueryResult<Record<string, unknown>>;
        maybeSingle: () => QueryResult<Record<string, unknown>>;
      };
    };
  };
};

export type MyCurrentWin =
  | { status: "ok"; win: ClientAuctionWin }
  | { status: "none" }       // no win of this user's for the current round
  | { status: "error" };     // lookup failed — unknown, not "no win"

// The signed-in user's win for the CURRENT round: game_state.round_key ->
// auction_wins row with that round_key. RLS returns the row only to its
// winner, so a row coming back is itself the "this user won" check.
export async function fetchMyCurrentWin(client: WinLookupClient): Promise<MyCurrentWin> {
  const gs = await client.from("game_state").select("round_key").eq("id", 1).single();
  if (gs.error || !gs.data) return { status: "error" };
  const roundKey = gs.data.round_key;
  if (typeof roundKey !== "string" || !roundKey) return { status: "none" };

  const w = await client.from("auction_wins").select(AUCTION_WIN_CLIENT_COLUMNS).eq("round_key", roundKey).maybeSingle();
  if (w.error) return { status: "error" };
  if (!w.data || !isWinId(w.data.id)) return { status: "none" };
  return { status: "ok", win: w.data as unknown as ClientAuctionWin };
}
