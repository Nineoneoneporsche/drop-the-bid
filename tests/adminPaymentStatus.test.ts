// GET /api/admin/payment-status: the current round's win is found in
// auction_wins by round_key and judged by win_id; only a win without an
// auction_wins row uses the legacy (winner_id, price, created_at) match.
// Admin auth and Supabase are faked in memory.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({
  gameState: {} as Row,
  wins: [] as Row[],
  orders: [] as Row[],
  attempts: [] as Row[],
}));

vi.mock("../app/lib/adminAuth", () => {
  class Q {
    private f: ((r: Row) => boolean)[] = [];
    private head = false;
    constructor(private rows: Row[]) {}
    select(_c: string, opts?: { head?: boolean }) { this.head = !!opts?.head; return this; }
    eq(c: string, v: unknown) { this.f.push((r) => r[c] === v); return this; }
    is(c: string, v: unknown) { this.f.push((r) => (r[c] ?? null) === v); return this; }
    in(c: string, v: unknown[]) { this.f.push((r) => v.includes(r[c])); return this; }
    gte(c: string, v: string) { this.f.push((r) => String(r[c]) >= v); return this; }
    lt(c: string, v: string) { this.f.push((r) => String(r[c]) < v); return this; }
    limit() { return this; }
    private hit() { return this.rows.filter((r) => this.f.every((g) => g(r))); }
    async single() { return { data: this.hit()[0] ?? null, error: null }; }
    async maybeSingle() { return { data: this.hit()[0] ?? null, error: null }; }
    then(res: (v: unknown) => unknown) { return Promise.resolve({ count: this.hit().length, data: this.head ? null : this.hit(), error: null }).then(res); }
  }
  const tables: Record<string, () => Row[]> = {
    game_state: () => [db.gameState], auction_wins: () => db.wins, orders: () => db.orders, payment_attempts: () => db.attempts,
  };
  return {
    requireAdminSession: async () => true,
    isSameOrigin: () => true,
    getSupabaseAdmin: () => ({ from: (t: string) => new Q(tables[t]()) }),
  };
});

const { GET } = await import("../app/api/admin/payment-status/route");
const get = async () => (await GET(new NextRequest("http://localhost/api/admin/payment-status"))).json();

const ROUND = "11111111-2222-4333-8444-555555555555";
const WIN_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const W = "user-winner";
const CLAIMED = "2026-10-29T03:00:00.000Z";

beforeEach(() => {
  db.gameState = { id: 1, round_key: ROUND, winner_id: W, winner_price: 500_000, winner_claimed_at: CLAIMED };
  db.wins = [{ id: WIN_ID, round_key: ROUND, winner_id: W, winning_price: 500_000, claimed_at: CLAIMED }];
  db.orders = [];
  db.attempts = [];
});

describe("admin payment-status by win_id", () => {
  it("unpaid", async () => {
    expect(await get()).toMatchObject({ ok: true, paymentComplete: false, paymentState: "unpaid", winId: WIN_ID });
  });

  it("paid = an order with this win_id", async () => {
    db.orders.push({ id: 1, win_id: WIN_ID, winner_id: W, amount: 500_000, created_at: "2026-10-29T03:05:00Z" });
    expect(await get()).toMatchObject({ paymentComplete: true, paymentState: "paid" });
  });

  it("pending / reconciliation_required from the win's active attempt", async () => {
    db.attempts.push({ order_id: "A", win_id: WIN_ID, status: "pending", created_at: "2026-10-29T03:01:00Z" });
    expect(await get()).toMatchObject({ paymentComplete: false, paymentState: "pending" });
    db.attempts[0].status = "reconciliation_required";
    expect(await get()).toMatchObject({ paymentComplete: false, paymentState: "reconciliation_required", reconciliationRequiredCount: 1 });
  });

  it("an order for ANOTHER win at the same price after the claim does not count (no heuristic for win rows)", async () => {
    db.orders.push({ id: 1, win_id: "9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f", winner_id: W, amount: 500_000, created_at: "2026-10-29T03:05:00Z" });
    expect(await get()).toMatchObject({ paymentComplete: false, paymentState: "unpaid" });
  });

  it("deploy-gap order (win row exists, order written without win_id) is matched by the legacy rule", async () => {
    db.orders.push({ id: 1, win_id: null, winner_id: W, amount: 500_000, created_at: "2026-10-29T03:05:00Z" });
    expect(await get()).toMatchObject({ paymentComplete: true, paymentState: "paid" });
  });

  it("legacy win (no auction_wins row): old heuristic fallback", async () => {
    db.wins = [];
    expect(await get()).toMatchObject({ paymentComplete: false, paymentState: "unpaid", winId: null });
    db.orders.push({ id: 1, win_id: null, winner_id: W, amount: 500_000, created_at: "2026-10-29T03:05:00Z" });
    expect(await get()).toMatchObject({ paymentComplete: true, paymentState: "paid", winId: null });
    db.orders[0].created_at = "2026-10-29T02:00:00Z"; // before this claim -> an older round's order
    expect(await get()).toMatchObject({ paymentComplete: false });
  });

  it("no winner, no win: null", async () => {
    db.gameState = { id: 1, round_key: ROUND, winner_id: null, winner_price: null, winner_claimed_at: null };
    db.wins = [];
    expect(await get()).toMatchObject({ paymentComplete: null, paymentState: null, winId: null });
  });
});
