// Route-level tests for POST /api/payment/confirm. Supabase and Toss are
// fully faked in memory — nothing here talks to a real database or to
// Toss's API. The two M4-A RPCs (payment_reserve_attempt /
// payment_finalize_paid) and the payment_attempts transition guard are
// mirrored here; tests/paymentConfirmSafetyM4.test.ts runs the real SQL.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  user: null as Row | null,
  wins: [] as Row[],
  gameStateReads: 0,
  serverNow: null as string | null,
  serverNowError: null as Row | null,
  // DB now() inside payment_reserve_attempt (defaults to serverNow).
  reserveNow: null as string | null,
  attempts: [] as Row[],
  orders: [] as Row[],
  ordersInsertError: null as Row | null,
  finalizeError: null as Row | null,
  updateError: null as Row | null,
  rpcCalls: 0,
  rpcLog: [] as string[],
  keySeq: 0,
}));

vi.mock("@supabase/supabase-js", () => {
  const ACTIVE = ["pending", "paid", "reconciliation_required"];
  // PostgREST's 23505 shape: the violated constraint/index is named in the
  // message — the route tells them apart by that name.
  const dup = (name: string) => ({ code: "23505", message: `duplicate key value violates unique constraint "${name}"` });
  const raise = (message: string) => ({ data: null, error: { code: "P0001", message } });

  // Mirrors the real payment_attempts constraints, checked synchronously
  // (i.e. atomically w.r.t. other in-flight requests): order_id PRIMARY KEY,
  // the pre-M1 partial UNIQUE index payment_attempts_one_active_per_win on
  // (winner_id, win_claimed_at) WHERE win_claimed_at IS NOT NULL AND status
  // IN (active), and M1's payment_attempts_one_active_per_win_id on win_id
  // WHERE win_id IS NOT NULL AND status IN (active).
  function attemptViolation(c: Row, others: Row[]): string | null {
    if (others.some((o) => o.order_id === c.order_id)) return "payment_attempts_pkey";
    if (!ACTIVE.includes(c.status as string)) return null;
    const active = others.filter((o) => ACTIVE.includes(o.status as string));
    if (c.win_claimed_at != null && active.some((o) => o.winner_id === c.winner_id && o.win_claimed_at === c.win_claimed_at)) {
      return "payment_attempts_one_active_per_win";
    }
    if (c.win_id != null && active.some((o) => o.win_id === c.win_id)) return "payment_attempts_one_active_per_win_id";
    return null;
  }
  // payment_attempts_guard_transition (M4-A trigger).
  function transitionForbidden(o: Row, n: Row): string | null {
    for (const k of ["order_id", "user_id", "winner_id", "amount", "payment_key"]) if (o[k] !== n[k]) return "identity";
    if (o.toss_idempotency_key != null && n.toss_idempotency_key !== o.toss_idempotency_key) return "idempotency_key";
    if ((o.win_id ?? null) !== (n.win_id ?? null) && !(o.status === "failed" && n.status === "pending")) return "win_id";
    const ok: Record<string, string[]> = {
      pending: ["pending", "paid", "failed", "reconciliation_required"], failed: ["failed", "pending"],
      reconciliation_required: ["reconciliation_required", "paid", "failed"], paid: ["paid"],
    };
    return ok[o.status as string]?.includes(n.status as string) ? null : `${o.status}_to_${n.status}`;
  }
  // orders: orders_order_id_key UNIQUE (order_id), orders_one_per_win on
  // win_id WHERE win_id IS NOT NULL, orders_payment_key_key UNIQUE.
  function orderViolation(c: Row): string | null {
    if (db.orders.some((o) => o.order_id === c.order_id)) return "orders_order_id_key";
    if (c.win_id != null && db.orders.some((o) => o.win_id === c.win_id)) return "orders_one_per_win";
    if (c.payment_key != null && db.orders.some((o) => o.payment_key === c.payment_key)) return "orders_payment_key_key";
    return null;
  }
  const nowMs = (v: string | null) => (v ? Date.parse(v) : NaN);

  function reserve(a: Row) {
    const t = (v: unknown) => (typeof v === "string" ? v.trim() || null : null);
    if (!a.p_order_id || !a.p_user_id || !a.p_win_id || !(Number(a.p_amount) > 0) || !a.p_payment_key) return raise("reserve:invalid");
    const shipping = {
      shipping_recipient_name: t(a.p_recipient_name), shipping_phone: t(a.p_phone), shipping_postcode: t(a.p_postcode),
      shipping_address: t(a.p_address), shipping_address_detail: t(a.p_address_detail),
    };
    if (!shipping.shipping_recipient_name || !shipping.shipping_phone || !shipping.shipping_postcode || !shipping.shipping_address) {
      return raise("reserve:shipping_required");
    }
    const win = db.wins.find((w) => w.id === a.p_win_id);
    if (!win) return raise("reserve:no_win");
    if (win.winner_id !== a.p_user_id) return raise("reserve:not_winner");
    if (win.winning_price !== a.p_amount) return raise("reserve:amount_mismatch");
    if (!(nowMs(db.reserveNow ?? db.serverNow) < Date.parse(win.payment_deadline as string))) return raise("reserve:window_expired");
    const existing = db.attempts.find((r) => r.order_id === a.p_order_id);
    if (existing) {
      if (existing.user_id !== a.p_user_id || existing.winner_id !== a.p_user_id || existing.amount !== a.p_amount
          || existing.payment_key !== a.p_payment_key || (existing.win_id != null && existing.win_id !== a.p_win_id)) {
        return raise("reserve:order_in_use");
      }
      if (existing.status !== "failed") return raise("reserve:busy");
      const updated = {
        ...existing, ...shipping, status: "pending", win_id: a.p_win_id, win_claimed_at: win.claimed_at, error_detail: null,
        toss_status: null, toss_idempotency_key: existing.toss_idempotency_key ?? `confirm-key-${++db.keySeq}`,
      };
      const v = attemptViolation(updated, db.attempts.filter((o) => o !== existing));
      if (v) return { data: null, error: dup(v) };
      Object.assign(existing, updated);
      return { data: existing.toss_idempotency_key, error: null };
    }
    const row: Row = {
      order_id: a.p_order_id, user_id: a.p_user_id, winner_id: win.winner_id, win_id: a.p_win_id, win_claimed_at: win.claimed_at,
      amount: a.p_amount, payment_key: a.p_payment_key, status: "pending", toss_response: null, error_detail: null,
      toss_idempotency_key: `confirm-key-${++db.keySeq}`, toss_status: null, approved_at: null, last_checked_at: null, ...shipping,
    };
    const v = attemptViolation(row, db.attempts);
    if (v) return { data: null, error: dup(v) };
    db.attempts.push(row);
    return { data: row.toss_idempotency_key, error: null };
  }

  function finalize(a: Row) {
    if (db.finalizeError) return { data: null, error: db.finalizeError };
    if (a.p_toss_status !== "DONE") return raise("finalize:not_done");
    const att = db.attempts.find((r) => r.order_id === a.p_order_id);
    if (!att) return raise("finalize:no_attempt");
    if (att.win_id == null) return raise("finalize:legacy_attempt");
    const order = db.orders.find((o) => o.order_id === a.p_order_id);
    if (att.status === "paid") return order ? { data: "already_paid", error: null } : raise("finalize:paid_without_order");
    if (att.status !== "pending" && att.status !== "reconciliation_required") return raise(`finalize:status_${att.status}`);
    let why: string | null = null;
    if (order) {
      if (order.win_id !== att.win_id || order.amount !== att.amount || order.payment_key !== att.payment_key) why = "order_mismatch";
    } else if (db.orders.some((o) => o.win_id === att.win_id)) why = "duplicate_win";
    else if (db.orders.some((o) => o.payment_key === att.payment_key)) why = "duplicate_payment_key";
    else if (att.shipping_recipient_name == null) why = "no_shipping_snapshot";
    const outcome = { toss_response: a.p_toss_response, toss_status: a.p_toss_status, approved_at: a.p_approved_at, last_checked_at: "now" };
    if (why) {
      Object.assign(att, outcome, { status: "reconciliation_required", error_detail: `finalize:${why}` });
      return { data: why, error: null };
    }
    if (!order) {
      if (db.ordersInsertError) return { data: null, error: db.ordersInsertError }; // whole transaction rolls back
      const win = db.wins.find((w) => w.id === att.win_id)!;
      const row: Row = {
        user_id: att.user_id, winner_id: att.winner_id, win_id: att.win_id, product_name: win.product_name, amount: att.amount,
        order_id: att.order_id, payment_key: att.payment_key, shipping_recipient_name: att.shipping_recipient_name,
        shipping_phone: att.shipping_phone, shipping_postcode: att.shipping_postcode, shipping_address: att.shipping_address,
        shipping_address_detail: att.shipping_address_detail,
      };
      const v = orderViolation(row);
      if (v) return { data: null, error: dup(v) };
      db.orders.push(row);
    }
    Object.assign(att, outcome, { status: "paid", error_detail: null });
    return { data: "paid", error: null };
  }

  class Query {
    private filters: ((r: Row) => boolean)[] = [];
    private patch: Row | null = null;
    private returning = false;
    constructor(private table: string) {}
    private all(): Row[] {
      switch (this.table) {
        case "payment_attempts": return db.attempts;
        case "orders": return db.orders;
        case "auction_wins": return db.wins;
        case "game_state": db.gameStateReads++; return [];
        default: throw new Error(`unexpected table ${this.table}`);
      }
    }
    private rows(): Row[] {
      return this.all().filter((r) => this.filters.every((f) => f(r)));
    }
    select() { if (this.patch) this.returning = true; return this; }
    eq(col: string, val: unknown) { this.filters.push((r) => r[col] === val); return this; }
    in(col: string, vals: unknown[]) { this.filters.push((r) => vals.includes(r[col])); return this; }
    is(col: string, val: unknown) { this.filters.push((r) => (r[col] ?? null) === val); return this; }
    limit() { return this; }
    async single() { const r = this.rows(); return { data: r[0] ?? null, error: r[0] ? null : { message: "no rows" } }; }
    async maybeSingle() { return { data: this.rows()[0] ?? null, error: null }; }
    async insert() {
      // Since M4-A the route never INSERTs directly: payment_attempts via
      // payment_reserve_attempt(), orders via payment_finalize_paid().
      throw new Error(`unexpected direct insert into ${this.table}`);
    }
    update(patch: Row) { this.patch = patch; return this; }
    then(resolve: (v: { data: Row[] | null; error: Row | null }) => unknown) {
      let result: { data: Row[] | null; error: Row | null } = { data: null, error: null };
      if (this.patch) {
        if (this.table !== "payment_attempts") throw new Error(`unexpected update of ${this.table}`);
        if (db.updateError) return Promise.resolve({ data: null, error: db.updateError }).then(resolve);
        const targets = this.rows();
        const updated = targets.map((r) => ({ ...r, ...this.patch }));
        const forbidden = targets.map((r, i) => transitionForbidden(r, updated[i])).find((v) => v);
        const blocked = updated.map((u, i) => attemptViolation(u, db.attempts.filter((o) => o !== targets[i]))).find((v) => v);
        if (forbidden) {
          result = { data: null, error: { code: "P0001", message: `payment_attempt_transition_forbidden:${forbidden}` } };
        } else if (blocked) {
          result = { data: null, error: dup(blocked) };
        } else {
          targets.forEach((r, i) => Object.assign(r, updated[i]));
          result = { data: this.returning ? targets.map((r) => ({ ...r })) : null, error: null };
        }
      } else {
        result = { data: this.rows().map((r) => ({ ...r })), error: null };
      }
      return Promise.resolve(result).then(resolve);
    }
  }
  const client = {
    auth: {
      getUser: async (token: string) =>
        token === "good-token" && db.user
          ? { data: { user: db.user }, error: null }
          : { data: { user: null }, error: { message: "Session from session_id claim in JWT does not exist", status: 403, code: "session_not_found", name: "AuthApiError" } },
    },
    from: (table: string) => new Query(table),
    rpc: async (fn: string, args: Row) => {
      db.rpcCalls++;
      db.rpcLog.push(fn);
      if (fn === "server_now") return db.serverNowError ? { data: null, error: db.serverNowError } : { data: db.serverNow, error: null };
      if (fn === "payment_reserve_attempt") return reserve(args);
      if (fn === "payment_finalize_paid") return finalize(args);
      throw new Error(`unexpected rpc ${fn}`);
    },
  };
  return { createClient: () => client };
});

// ── Toss (fetch) ────────────────────────────────────────────────────────────
// Test-only key bodies, assembled at runtime (never a real key).
const KEYS = {
  testClient: ["test", "ck", "UNITTESTONLYclient0001"].join("_"),
  testSecret: ["test", "sk", "UNITTESTONLYsecret0001"].join("_"),
  liveClient: ["live", "ck", "UNITTESTONLYclient0002"].join("_"),
  liveSecret: ["live", "sk", "UNITTESTONLYsecret0002"].join("_"),
};
type TossCall = { url: string; method: string; headers: Record<string, string>; body: Row | null };
const tossCalls: TossCall[] = [];
// A full Toss Payment object, including the fields DTB must never pass on.
const tossPayment = (b: { paymentKey: string; orderId: string; amount: number }, extra: Row = {}): Row => ({
  mId: "tvivarepublica", version: "2022-11-16", type: "NORMAL",
  paymentKey: b.paymentKey, orderId: b.orderId, orderName: "Apple iPad Air 11형 Wi-Fi 128GB",
  status: "DONE", method: "카드", totalAmount: b.amount, balanceAmount: b.amount, currency: "KRW",
  requestedAt: "2026-10-06T21:00:30+09:00", approvedAt: "2026-10-06T21:01:00+09:00", lastTransactionKey: "txkey_1",
  secret: "ps_SECRET_FIELD_MUST_NOT_LEAK",
  card: { number: "43301234****123*", approveNo: "00000000", issuerCode: "71", cardType: "신용" },
  checkout: { url: "https://checkout.example/CHECKOUT_URL" }, receipt: { url: "https://receipt.example/RECEIPT_URL" },
  easyPay: null, ...extra,
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const tossError = (status: number, code: string, message = `RAW_TOSS_MESSAGE ${code}`) => json({ code, message }, status);
// Simulated Toss side: what a lookup of a paymentKey returns.
const tossState = new Map<string, Row>();
type Handler = (b: Row) => Response | Promise<Response>;
const toss = { confirm: null as Handler | null, lookup: null as ((paymentKey: string) => Response | Promise<Response>) | null };
const confirmOk = (extra: Row = {}, delayMs = 0): Handler => async (b) => {
  if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  const p = tossPayment(b as { paymentKey: string; orderId: string; amount: number }, extra);
  tossState.set(b.paymentKey as string, p);
  return json(p);
};

const tossFetch = vi.fn(async (url: string, init: RequestInit) => {
  const headers = { ...(init.headers as Record<string, string>) };
  const body = typeof init.body === "string" ? (JSON.parse(init.body) as Row) : null;
  tossCalls.push({ url, method: init.method ?? "GET", headers, body });
  if (url === "https://api.tosspayments.com/v1/payments/confirm") return (toss.confirm ?? confirmOk())(body!);
  const m = /^https:\/\/api\.tosspayments\.com\/v1\/payments\/([^/]+)$/.exec(url);
  if (m && (init.method ?? "GET") === "GET") {
    const key = decodeURIComponent(m[1]);
    if (toss.lookup) return toss.lookup(key);
    const p = tossState.get(key);
    return p ? json(p) : tossError(404, "NOT_FOUND_PAYMENT");
  }
  throw new Error(`unexpected fetch ${url}`);
});
vi.stubGlobal("fetch", tossFetch);
const confirmCalls = () => tossCalls.filter((c) => c.url.endsWith("/v1/payments/confirm"));
const lookupCalls = () => tossCalls.filter((c) => c.method === "GET");

const { POST } = await import("../app/api/payment/confirm/route");

const WINNER_ID = "user-winner";
const PRICE = 412_000;
const CLAIMED = "2026-10-06T12:00:00.000Z";
const afterClaim = (seconds: number) => new Date(Date.parse(CLAIMED) + seconds * 1000).toISOString();
const WIN_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER_WIN_ID = "9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f";
// Deliberately different from what the browser sends as orderName / what
// Toss echoes back: the order must take auction_wins.product_name.
const WIN_PRODUCT = "Apple iPad Air 11형 Wi-Fi 128GB (라운드 스냅샷)";
const baseWin = (extra: Row = {}): Row => ({
  id: WIN_ID, round_key: "11111111-2222-4333-8444-555555555555", winner_id: WINNER_ID,
  product_name: WIN_PRODUCT, start_price: 899_000, winning_price: PRICE,
  claimed_at: CLAIMED, payment_deadline: afterClaim(1800), ...extra,
});

const SHIPPING = {
  // Profile name — must NOT be used as the shipping recipient.
  name: "프로필이름",
  shippingRecipientName: "홍길동",
  phone: "010-1234-5678",
  postcode: "06236",
  address: "서울 강남구 테헤란로 152",
  addressDetail: "12층",
};

function confirmRequest(body: Row = { paymentKey: "pk_test_123456789", orderId: "DTB-1", amount: PRICE, winId: WIN_ID }, token = "good-token") {
  return new NextRequest("http://localhost/api/payment/confirm", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("NEXT_PUBLIC_TOSS_CLIENT_KEY", KEYS.testClient);
  vi.stubEnv("TOSS_SECRET_KEY", KEYS.testSecret);
  vi.stubEnv("VERCEL_ENV", "");
  db.user = { id: WINNER_ID, user_metadata: { ...SHIPPING } };
  db.wins = [baseWin()];
  db.gameStateReads = 0;
  db.serverNow = afterClaim(60);
  db.serverNowError = null;
  db.reserveNow = null;
  db.attempts = [];
  db.orders = [];
  db.ordersInsertError = null;
  db.finalizeError = null;
  db.updateError = null;
  db.rpcCalls = 0;
  db.rpcLog = [];
  tossCalls.length = 0;
  tossState.clear();
  toss.confirm = null;
  toss.lookup = null;
  tossFetch.mockClear();
});

describe("payment window (server-enforced)", () => {
  it("approves a new payment at 29:59 after the claim", async () => {
    db.serverNow = afterClaim(1799);
    const res = await POST(confirmRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
    expect(tossFetch).toHaveBeenCalledTimes(1);
    expect(db.orders).toHaveLength(1);
    expect(db.attempts[0]).toMatchObject({ order_id: "DTB-1", status: "paid" });
  });

  it("refuses a new payment after 30 minutes, before Toss or payment_attempts are touched", async () => {
    db.serverNow = afterClaim(1801);
    const res = await POST(confirmRequest());
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ ok: false, code: "PAYMENT_WINDOW_EXPIRED" });
    expect(tossFetch).not.toHaveBeenCalled();
    expect(db.attempts).toHaveLength(0);
    expect(db.orders).toHaveLength(0);
  });

  it("refuses at exactly 30:00", async () => {
    db.serverNow = afterClaim(1800);
    const res30 = await POST(confirmRequest());
    expect(await res30.json()).toMatchObject({ ok: false, code: "PAYMENT_WINDOW_EXPIRED" });
    expect(tossFetch).not.toHaveBeenCalled();
  });

  it("now allows 15 minutes after the claim (was refused under the old 10 minute window)", async () => {
    db.serverNow = afterClaim(15 * 60);
    const res15 = await POST(confirmRequest());
    expect(res15.status).toBe(200);
  });

  it("refuses well after the window", async () => {
    db.serverNow = afterClaim(1801);
    const res = await POST(confirmRequest());
    expect(await res.json()).toMatchObject({ ok: false, code: "PAYMENT_WINDOW_EXPIRED" });
    expect(tossFetch).not.toHaveBeenCalled();
  });

  it("enforces the stored auction_wins.payment_deadline, not claimed_at + 30 minutes", async () => {
    db.wins[0].payment_deadline = afterClaim(120);
    db.serverNow = afterClaim(120);
    const res = await POST(confirmRequest());
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ ok: false, code: "PAYMENT_WINDOW_EXPIRED" });
    expect(tossFetch).not.toHaveBeenCalled();
    expect(db.attempts).toHaveLength(0);
  });

  it("fails closed (no Toss call) when server_now() errors", async () => {
    db.serverNowError = { message: "db down" };
    const res = await POST(confirmRequest());
    expect(res.status).toBe(503);
    expect(tossFetch).not.toHaveBeenCalled();
    expect(db.attempts).toHaveLength(0);
  });

  it("keeps the idempotent replay of an already-paid order working after the window", async () => {
    db.attempts.push({
      order_id: "DTB-1", user_id: WINNER_ID, winner_id: WINNER_ID, win_id: WIN_ID, win_claimed_at: CLAIMED, amount: PRICE,
      payment_key: "pk_test_123456789", status: "paid", toss_response: { totalAmount: PRICE, method: "카드" },
    });
    db.serverNow = afterClaim(2 * 60 * 60);
    const res = await POST(confirmRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, data: { orderId: "DTB-1", totalAmount: PRICE, method: "카드", approvedAt: null, orderName: null } });
    expect(tossFetch).not.toHaveBeenCalled();
  });

  it("M4-A: the replay of a reconciliation_required order (even one holding a Toss response) is NEEDS_REVIEW, never success", async () => {
    db.attempts.push({
      order_id: "DTB-1", user_id: WINNER_ID, winner_id: WINNER_ID, win_id: WIN_ID, win_claimed_at: CLAIMED, amount: PRICE,
      payment_key: "pk_test_123456789", status: "reconciliation_required", toss_response: { totalAmount: PRICE, method: "카드" },
    });
    db.serverNow = afterClaim(2 * 60 * 60);
    const res = await POST(confirmRequest());
    expect(await res.json()).toMatchObject({ ok: false, code: "PAYMENT_NEEDS_REVIEW" });
    expect(tossFetch).not.toHaveBeenCalled();
  });

  it("treats a retry of a pending/failed attempt after the window as a new approval and refuses it", async () => {
    db.attempts.push({
      order_id: "DTB-1", user_id: WINNER_ID, winner_id: WINNER_ID, win_id: WIN_ID, amount: PRICE,
      payment_key: "pk_test_123456789", status: "failed",
    });
    db.serverNow = afterClaim(1801);
    const res = await POST(confirmRequest());
    expect(await res.json()).toMatchObject({ ok: false, code: "PAYMENT_WINDOW_EXPIRED" });
    expect(tossFetch).not.toHaveBeenCalled();
  });
});

describe("existing checks are unchanged", () => {
  it("still refuses a user who is not the winner (auction_wins.winner_id)", async () => {
    db.user = { id: "someone-else", user_metadata: { ...SHIPPING } };
    const res = await POST(confirmRequest());
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ ok: false, error: "낙찰자 본인만 결제할 수 있습니다" });
    expect(tossFetch).not.toHaveBeenCalled();
  });

  it("still refuses an amount that does not match the winning price", async () => {
    const res = await POST(confirmRequest({ paymentKey: "pk_test_123456789", orderId: "DTB-1", amount: PRICE - 1, winId: WIN_ID }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: "결제 금액이 낙찰가와 일치하지 않습니다" });
    expect(tossFetch).not.toHaveBeenCalled();
  });

  it("still refuses a missing/invalid auth token", async () => {
    const res = await POST(confirmRequest(undefined, "bad-token"));
    expect(res.status).toBe(401);
    expect(tossFetch).not.toHaveBeenCalled();
  });

  it("still refuses reuse of an order_id for a different paymentKey", async () => {
    db.attempts.push({
      order_id: "DTB-1", user_id: WINNER_ID, winner_id: WINNER_ID, win_id: WIN_ID, amount: PRICE,
      payment_key: "pk_other_payment", status: "paid",
    });
    const res = await POST(confirmRequest());
    expect(res.status).toBe(409);
    expect(tossFetch).not.toHaveBeenCalled();
  });

  it("never reads game_state: the win comes from auction_wins only", async () => {
    const res = await POST(confirmRequest());
    expect(res.status).toBe(200);
    expect(db.gameStateReads).toBe(0);
  });
});

describe("shipping info (server-enforced) + order snapshot", () => {
  it("snapshots the shipping info onto the order at approval time", async () => {
    const res = await POST(confirmRequest());
    expect(res.status).toBe(200);
    expect(db.orders[0]).toMatchObject({
      winner_id: WINNER_ID,
      user_id: WINNER_ID,
      shipping_recipient_name: "홍길동",
      shipping_phone: "010-1234-5678",
      shipping_postcode: "06236",
      shipping_address: "서울 강남구 테헤란로 152",
      shipping_address_detail: "12층",
    });
  });

  it("uses shippingRecipientName, never the profile name", async () => {
    await POST(confirmRequest());
    expect(db.orders[0].shipping_recipient_name).toBe("홍길동");
    expect(Object.values(db.orders[0])).not.toContain("프로필이름");
  });

  it("allows an empty addressDetail and stores it as null", async () => {
    db.user!.user_metadata = { ...SHIPPING, addressDetail: "" };
    const res = await POST(confirmRequest());
    expect(res.status).toBe(200);
    expect(db.orders[0].shipping_address_detail).toBeNull();
  });

  for (const [key, field] of [
    ["shippingRecipientName", "recipientName"],
    ["phone", "phone"],
    ["postcode", "postcode"],
    ["address", "address"],
  ] as const) {
    it(`refuses before Toss when ${key} is missing`, async () => {
      db.user!.user_metadata = { ...SHIPPING, [key]: "" };
      const res = await POST(confirmRequest());
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ ok: false, code: "SHIPPING_INFO_REQUIRED", missing: [field] });
      expect(tossFetch).not.toHaveBeenCalled();
      expect(db.attempts).toHaveLength(0);
      expect(db.orders).toHaveLength(0);
    });
  }

  it("refuses when the profile name exists but shippingRecipientName does not (OAuth-style account)", async () => {
    db.user!.user_metadata = { name: "Kakao Nickname", phone: SHIPPING.phone, postcode: SHIPPING.postcode, address: SHIPPING.address };
    const res = await POST(confirmRequest());
    expect(await res.json()).toMatchObject({ ok: false, code: "SHIPPING_INFO_REQUIRED", missing: ["recipientName"] });
    expect(tossFetch).not.toHaveBeenCalled();
  });

  it("refuses a too-short phone number", async () => {
    db.user!.user_metadata = { ...SHIPPING, phone: "010-12" };
    const res = await POST(confirmRequest());
    expect(await res.json()).toMatchObject({ code: "SHIPPING_INFO_REQUIRED", missing: ["phone"] });
  });

  it("does not break the idempotent replay of an already-paid order if the address was later removed", async () => {
    db.attempts.push({
      order_id: "DTB-1", user_id: WINNER_ID, winner_id: WINNER_ID, win_id: WIN_ID, win_claimed_at: CLAIMED, amount: PRICE,
      payment_key: "pk_test_123456789", status: "paid", toss_response: { totalAmount: PRICE, method: "카드" },
    });
    db.user!.user_metadata = {};
    const res = await POST(confirmRequest());
    expect(await res.json()).toMatchObject({ ok: true });
    expect(tossFetch).not.toHaveBeenCalled();
  });

  it("checks the payment window before shipping (expired + no address => PAYMENT_WINDOW_EXPIRED)", async () => {
    db.user!.user_metadata = {};
    db.serverNow = afterClaim(1801);
    const res = await POST(confirmRequest());
    expect(await res.json()).toMatchObject({ code: "PAYMENT_WINDOW_EXPIRED" });
  });
});

describe("one active payment per win (atomic, DB-enforced)", () => {
  const req = (orderId: string, paymentKey: string) => confirmRequest({ paymentKey, orderId, amount: PRICE, winId: WIN_ID });
  const activeAttempt = (status: string, extra: Row = {}) => ({
    order_id: "DTB-OLD", user_id: WINNER_ID, winner_id: WINNER_ID, win_id: WIN_ID, win_claimed_at: CLAIMED,
    amount: PRICE, payment_key: "pk_old_payment_1", status, ...extra,
  });
  // Toss responds after a delay so concurrent requests genuinely overlap.
  const slowToss = (ms = 20) => { toss.confirm = confirmOk({}, ms); };

  it("stamps the reservation with the win identity (win_id, winner_id, win_claimed_at = auction_wins.claimed_at)", async () => {
    await POST(req("DTB-1", "pk_test_123456789"));
    expect(db.attempts[0]).toMatchObject({ win_id: WIN_ID, winner_id: WINNER_ID, win_claimed_at: CLAIMED, amount: PRICE, status: "paid" });
  });

  it("same win + same orderId replay after payment: existing idempotency, no second Toss call", async () => {
    expect((await POST(req("DTB-1", "pk_test_123456789"))).status).toBe(200);
    const again = await POST(req("DTB-1", "pk_test_123456789"));
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ ok: true });
    expect(tossFetch).toHaveBeenCalledTimes(1);
  });

  it("same win + different orderId after payment: ALREADY_PAID, Toss not called again", async () => {
    await POST(req("DTB-1", "pk_test_123456789"));
    const second = await POST(req("DTB-2", "pk_test_second_payment"));
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ ok: false, code: "PAYMENT_ALREADY_PAID" });
    expect(tossFetch).toHaveBeenCalledTimes(1);
    expect(db.orders).toHaveLength(1);
    expect(db.attempts.find((a) => a.order_id === "DTB-2")).toBeUndefined();
  });

  it("two concurrent confirms for the same win with different orderIds: Toss called at most once", async () => {
    slowToss();
    const [a, b] = await Promise.all([POST(req("DTB-A", "pk_test_concurrent_a")), POST(req("DTB-B", "pk_test_concurrent_b"))]);
    const bodies = [await a.json(), await b.json()];
    expect(tossFetch).toHaveBeenCalledTimes(1);
    expect(bodies.filter((x) => x.ok === true)).toHaveLength(1);
    const refused = bodies.find((x) => x.ok === false);
    expect(["PAYMENT_PROCESSING", "PAYMENT_ALREADY_PAID"]).toContain(refused.code);
    expect(db.orders).toHaveLength(1);
    expect(db.attempts.filter((x) => x.status === "paid")).toHaveLength(1);
  });

  it("two concurrent confirms with the same orderId: Toss called at most once", async () => {
    slowToss();
    const [a, b] = await Promise.all([POST(req("DTB-1", "pk_test_123456789")), POST(req("DTB-1", "pk_test_123456789"))]);
    const bodies = [await a.json(), await b.json()];
    expect(tossFetch).toHaveBeenCalledTimes(1);
    expect(bodies.filter((x) => x.ok === true)).toHaveLength(1);
    expect(bodies.find((x) => x.ok === false)).toMatchObject({ code: "PAYMENT_PROCESSING" });
  });

  it("five concurrent confirms for one win: exactly one Toss call, one order", async () => {
    slowToss();
    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => POST(req(`DTB-${n}`, `pk_test_parallel_${n}`))));
    const bodies = await Promise.all(results.map((r) => r.json()));
    expect(tossFetch).toHaveBeenCalledTimes(1);
    expect(bodies.filter((x) => x.ok === true)).toHaveLength(1);
    expect(db.orders).toHaveLength(1);
  });

  it("an existing paid attempt blocks a new payment (ALREADY_PAID)", async () => {
    db.attempts.push(activeAttempt("paid", { toss_response: { totalAmount: PRICE } }));
    const res = await POST(req("DTB-NEW", "pk_test_new_payment"));
    expect(await res.json()).toMatchObject({ ok: false, code: "PAYMENT_ALREADY_PAID" });
    expect(tossFetch).not.toHaveBeenCalled();
  });

  it("an existing pending attempt blocks a new payment (PAYMENT_IN_PROGRESS)", async () => {
    db.attempts.push(activeAttempt("pending"));
    const res = await POST(req("DTB-NEW", "pk_test_new_payment"));
    expect(await res.json()).toMatchObject({ ok: false, code: "PAYMENT_PROCESSING" });
    expect(tossFetch).not.toHaveBeenCalled();
  });

  it("an existing reconciliation_required attempt blocks a new payment (PAYMENT_NEEDS_REVIEW)", async () => {
    db.attempts.push(activeAttempt("reconciliation_required"));
    const res = await POST(req("DTB-NEW", "pk_test_new_payment"));
    expect(await res.json()).toMatchObject({ ok: false, code: "PAYMENT_NEEDS_REVIEW" });
    expect(tossFetch).not.toHaveBeenCalled();
  });

  it("same orderId still pending: PAYMENT_IN_PROGRESS, Toss not called again", async () => {
    db.attempts.push(activeAttempt("pending", { order_id: "DTB-1", payment_key: "pk_test_123456789" }));
    const res = await POST(req("DTB-1", "pk_test_123456789"));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, code: "PAYMENT_PROCESSING" });
    expect(tossFetch).not.toHaveBeenCalled();
  });

  it("same orderId reconciliation_required WITHOUT a Toss response (outcome unknown): PAYMENT_NEEDS_REVIEW, not success", async () => {
    db.attempts.push(activeAttempt("reconciliation_required", { order_id: "DTB-1", payment_key: "pk_test_123456789", error_detail: "timeout" }));
    const res = await POST(req("DTB-1", "pk_test_123456789"));
    expect(await res.json()).toMatchObject({ ok: false, code: "PAYMENT_NEEDS_REVIEW" });
    expect(tossFetch).not.toHaveBeenCalled();
  });

  it("failed attempt: a new orderId can pay for the same win", async () => {
    db.attempts.push(activeAttempt("failed"));
    const res = await POST(req("DTB-NEW", "pk_test_new_payment"));
    expect(res.status).toBe(200);
    expect(tossFetch).toHaveBeenCalledTimes(1);
  });

  it("failed attempt: the same orderId can be retried (re-reserved as pending, then paid)", async () => {
    db.attempts.push(activeAttempt("failed", { order_id: "DTB-1", payment_key: "pk_test_123456789", win_claimed_at: null }));
    const res = await POST(req("DTB-1", "pk_test_123456789"));
    expect(res.status).toBe(200);
    expect(db.attempts[0]).toMatchObject({ status: "paid", win_claimed_at: CLAIMED });
    expect(tossFetch).toHaveBeenCalledTimes(1);
  });

  it("failed-retry of an old order is refused if another attempt already holds the win", async () => {
    db.attempts.push(activeAttempt("failed", { order_id: "DTB-1", payment_key: "pk_test_123456789" }));
    db.attempts.push(activeAttempt("paid", { order_id: "DTB-2", payment_key: "pk_test_other_paid" }));
    const res = await POST(req("DTB-1", "pk_test_123456789"));
    expect(await res.json()).toMatchObject({ ok: false, code: "PAYMENT_ALREADY_PAID" });
    expect(tossFetch).not.toHaveBeenCalled();
    expect(db.attempts[0].status).toBe("failed");
  });

  it("a different win (different win_id) is not blocked by an earlier paid win at the same price", async () => {
    db.attempts.push(activeAttempt("paid", { win_id: OTHER_WIN_ID, win_claimed_at: "2026-10-01T09:00:00.000Z" }));
    const res = await POST(req("DTB-NEW", "pk_test_new_payment"));
    expect(res.status).toBe(200);
    expect(tossFetch).toHaveBeenCalledTimes(1);
  });

  it("legacy attempts without win_claimed_at don't block (outside the index)", async () => {
    db.attempts.push(activeAttempt("paid", { win_id: null, win_claimed_at: null }));
    const res = await POST(req("DTB-NEW", "pk_test_new_payment"));
    expect(res.status).toBe(200);
  });

  it("explicit Toss rejection -> failed (win released for retry)", async () => {
    toss.confirm = () => tossError(403, "REJECT_CARD_COMPANY", "카드사 거절");
    const res = await POST(req("DTB-1", "pk_test_123456789"));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, code: "PAYMENT_DECLINED" });
    expect(db.attempts[0].status).toBe("failed");
    expect(lookupCalls()).toHaveLength(0); // a decline on the allowlist needs no lookup
    toss.confirm = null;
    expect((await POST(req("DTB-2", "pk_test_retry_payment"))).status).toBe(200);
  });

  it("Toss network exception (and the lookup unreachable too) -> reconciliation_required (NOT failed), and the win stays locked", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    toss.confirm = () => { throw new TypeError("socket hang up"); };
    toss.lookup = () => { throw new TypeError("socket hang up"); };
    const res = await POST(req("DTB-1", "pk_test_123456789"));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ ok: false, code: "PAYMENT_NEEDS_REVIEW" });
    expect(db.attempts[0]).toMatchObject({ status: "reconciliation_required", error_detail: "confirm_network|lookup_network" });

    tossFetch.mockClear();
    const retry = await POST(req("DTB-2", "pk_test_second_payment"));
    expect(await retry.json()).toMatchObject({ ok: false, code: "PAYMENT_NEEDS_REVIEW" });
    expect(tossFetch).not.toHaveBeenCalled();
  });

  it("27. order write failure after Toss DONE -> reconciliation_required, NOT reported as success (nor as failed), win stays locked", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.ordersInsertError = { code: "08006", message: "connection failure" };
    const res = await POST(req("DTB-1", "pk_test_123456789"));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, code: "PAYMENT_NEEDS_REVIEW" });
    expect(db.orders).toHaveLength(0);
    expect(db.attempts[0]).toMatchObject({ status: "reconciliation_required", toss_status: "DONE" });
    expect(db.attempts[0].error_detail).toMatch(/^finalize_error:/);
    expect(db.attempts[0].toss_response).toMatchObject({ status: "DONE", totalAmount: PRICE });

    // Same order replay: still under review, Toss not called again.
    expect(await (await POST(req("DTB-1", "pk_test_123456789"))).json()).toMatchObject({ ok: false, code: "PAYMENT_NEEDS_REVIEW" });
    // A new payment for the same win: refused, no Toss call.
    db.ordersInsertError = null;
    const second = await POST(req("DTB-2", "pk_test_second_payment"));
    expect(await second.json()).toMatchObject({ ok: false, code: "PAYMENT_NEEDS_REVIEW" });
    expect(tossFetch).toHaveBeenCalledTimes(1);
  });
});

describe("auth failure codes, safe logging, and retry safety", () => {
  it("no token -> 401 AUTH_REQUIRED, nothing touched", async () => {
    const res = await POST(new NextRequest("http://localhost/api/payment/confirm", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ paymentKey: "pk_test_123456789", orderId: "DTB-1", amount: PRICE }),
    }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ ok: false, code: "AUTH_REQUIRED" });
    expect(db.attempts).toHaveLength(0);
    expect(tossFetch).not.toHaveBeenCalled();
  });

  it("rejected token -> 401 AUTH_SESSION_INVALID; logs only status/code/name; nothing touched", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await POST(confirmRequest({ paymentKey: "pk_secret_payment_key", orderId: "DTB-SECRET-ORDER", amount: PRICE }, "stale-access-token-xyz"));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ ok: false, code: "AUTH_SESSION_INVALID", error: "유효하지 않은 인증 정보입니다" });
    expect(db.attempts).toHaveLength(0);
    expect(db.orders).toHaveLength(0);
    expect(db.rpcCalls).toBe(0);
    expect(tossFetch).not.toHaveBeenCalled();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1]).toEqual({ status: 403, code: "session_not_found", name: "AuthApiError" });
    const logged = JSON.stringify(warn.mock.calls);
    for (const secret of ["stale-access-token-xyz", "pk_secret_payment_key", "DTB-SECRET-ORDER"]) {
      expect(logged).not.toContain(secret);
    }
    warn.mockRestore();
  });

  it("retry after AUTH_SESSION_INVALID with a fresh token -> exactly one attempt, one order, one Toss call", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const body = { paymentKey: "pk_test_123456789", orderId: "DTB-1", amount: PRICE, winId: WIN_ID };
    expect((await POST(confirmRequest(body, "stale-token"))).status).toBe(401);
    const ok = await POST(confirmRequest(body, "good-token"));
    expect(ok.status).toBe(200);
    expect(db.attempts).toHaveLength(1);
    expect(db.attempts[0]).toMatchObject({ order_id: "DTB-1", status: "paid" });
    expect(db.orders).toHaveLength(1);
    expect(tossFetch).toHaveBeenCalledTimes(1);
    vi.mocked(console.warn).mockRestore();
  });

  it("retry racing a second tab's payment for the same win -> still at most one Toss call", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    toss.confirm = confirmOk({}, 20);
    const retried = { paymentKey: "pk_test_123456789", orderId: "DTB-1", amount: PRICE, winId: WIN_ID };
    expect((await POST(confirmRequest(retried, "stale-token"))).status).toBe(401);
    const [a, b] = await Promise.all([
      POST(confirmRequest(retried, "good-token")),
      POST(confirmRequest({ paymentKey: "pk_test_other_tab", orderId: "DTB-2", amount: PRICE, winId: WIN_ID }, "good-token")),
    ]);
    const bodies = [await a.json(), await b.json()];
    expect(tossFetch).toHaveBeenCalledTimes(1);
    expect(bodies.filter((x) => x.ok === true)).toHaveLength(1);
    expect(db.orders).toHaveLength(1);
    vi.mocked(console.warn).mockRestore();
  });
});

describe("auction_wins as the source of truth (code deploy 1)", () => {
  const body = (extra: Row = {}) => ({ paymentKey: "pk_test_123456789", orderId: "DTB-1", amount: PRICE, winId: WIN_ID, ...extra });
  const nothingTouched = () => {
    expect(tossFetch).not.toHaveBeenCalled();
    expect(db.attempts).toHaveLength(0);
    expect(db.orders).toHaveLength(0);
  };

  it("records win_id on the attempt and on the order", async () => {
    const res = await POST(confirmRequest(body()));
    expect(res.status).toBe(200);
    expect(db.attempts[0]).toMatchObject({ win_id: WIN_ID, winner_id: WINNER_ID, win_claimed_at: CLAIMED, amount: PRICE, status: "paid" });
    expect(db.orders[0]).toMatchObject({ win_id: WIN_ID, winner_id: WINNER_ID, user_id: WINNER_ID, amount: PRICE });
  });

  it("order product_name / amount come from auction_wins, not from the client or Toss's orderName echo", async () => {
    toss.confirm = confirmOk({ orderName: "클라이언트가 바꾼 상품명" });
    await POST(confirmRequest(body({ orderName: "클라이언트가 바꾼 상품명", product_name: "x" })));
    expect(db.orders[0]).toMatchObject({ product_name: WIN_PRODUCT, amount: PRICE });
  });

  it("sends Toss the win's price", async () => {
    await POST(confirmRequest(body()));
    expect(confirmCalls()[0].body).toEqual({ paymentKey: "pk_test_123456789", orderId: "DTB-1", amount: PRICE });
  });

  it("tampered amount: refused before Toss", async () => {
    const res = await POST(confirmRequest(body({ amount: 1000 })));
    expect(res.status).toBe(400);
    nothingTouched();
  });

  it("another user's winId: refused before Toss", async () => {
    db.wins.push(baseWin({ id: OTHER_WIN_ID, winner_id: "someone-else", round_key: "66666666-7777-4888-8999-000000000000" }));
    const res = await POST(confirmRequest(body({ winId: OTHER_WIN_ID })));
    expect(res.status).toBe(403);
    nothingTouched();
  });

  it("winId that does not exist: refused before Toss", async () => {
    const res = await POST(confirmRequest(body({ winId: OTHER_WIN_ID })));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: "낙찰 정보를 찾을 수 없습니다" });
    nothingTouched();
  });

  it("malformed winId: refused before auth/DB/Toss", async () => {
    for (const bad of ["not-a-uuid", "0a1b2c3d4e5f4a6b8c7d9e0f1a2b3c4d", `${WIN_ID}' or 1=1`, 42]) {
      const res = await POST(confirmRequest(body({ winId: bad })));
      expect(res.status).toBe(400);
    }
    expect(db.rpcCalls).toBe(0);
    nothingTouched();
  });

  it("new approval without a winId: refused before Toss", async () => {
    const res = await POST(confirmRequest({ paymentKey: "pk_test_123456789", orderId: "DTB-1", amount: PRICE }));
    expect(res.status).toBe(400);
    nothingTouched();
  });

  it("deadline passed (auction_wins.payment_deadline): refused before Toss", async () => {
    db.serverNow = db.wins[0].payment_deadline as string;
    const res = await POST(confirmRequest(body()));
    expect(await res.json()).toMatchObject({ ok: false, code: "PAYMENT_WINDOW_EXPIRED" });
    nothingTouched();
  });

  it("one active attempt per win_id: blocked by payment_attempts_one_active_per_win_id even when win_claimed_at differs", async () => {
    db.attempts.push({ order_id: "DTB-OLD", user_id: WINNER_ID, winner_id: WINNER_ID, win_id: WIN_ID, win_claimed_at: null,
      amount: PRICE, payment_key: "pk_old_payment_1", status: "paid" });
    const res = await POST(confirmRequest(body({ orderId: "DTB-NEW", paymentKey: "pk_test_new_payment" })));
    expect(await res.json()).toMatchObject({ ok: false, code: "PAYMENT_ALREADY_PAID" });
    expect(tossFetch).not.toHaveBeenCalled();
    expect(db.attempts.filter((a) => a.win_id === WIN_ID)).toHaveLength(1);
  });

  it("deploy-gap attempt (written without win_id by the old code) still blocks via the (winner_id, win_claimed_at) index", async () => {
    db.attempts.push({ order_id: "DTB-GAP", user_id: WINNER_ID, winner_id: WINNER_ID, win_id: null, win_claimed_at: CLAIMED,
      amount: PRICE, payment_key: "pk_gap_payment", status: "reconciliation_required" });
    const res = await POST(confirmRequest(body({ orderId: "DTB-NEW", paymentKey: "pk_test_new_payment" })));
    expect(await res.json()).toMatchObject({ ok: false, code: "PAYMENT_NEEDS_REVIEW" });
    expect(tossFetch).not.toHaveBeenCalled();
  });

  it("concurrent same order_id: the second reservation finds the first one's pending attempt (reserve:busy) -> PAYMENT_PROCESSING", async () => {
    toss.confirm = confirmOk({}, 20);
    const [a, b] = await Promise.all([POST(confirmRequest(body())), POST(confirmRequest(body()))]);
    const bodies = [await a.json(), await b.json()];
    expect(bodies.find((x) => x.ok === false)).toMatchObject({ code: "PAYMENT_PROCESSING" });
    expect(bodies.filter((x) => x.ok === true)).toHaveLength(1);
    expect(tossFetch).toHaveBeenCalledTimes(1);
  });

  it("an order_id already used by another user's attempt -> 409 before the reservation, no Toss call", async () => {
    db.attempts.push({ order_id: "DTB-1", user_id: "x", winner_id: "x", win_id: null, win_claimed_at: null, amount: 1, payment_key: "pk_x", status: "failed" });
    const res = await POST(confirmRequest(body({ orderId: "DTB-1" })));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, error: "이미 사용된 주문번호입니다" });
    expect(db.rpcLog).not.toContain("payment_reserve_attempt");
    expect(tossFetch).not.toHaveBeenCalled();
  });

  it("29. the win already has another order after Toss DONE: reconciliation_required (fail-closed), never paid, no second order", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    db.orders.push({ order_id: "DTB-EARLIER", win_id: WIN_ID, winner_id: WINNER_ID, amount: PRICE, payment_key: "pk_earlier" });
    const res = await POST(confirmRequest(body()));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, code: "PAYMENT_NEEDS_REVIEW" }); // charged at Toss — never told "failed"
    expect(db.attempts[0]).toMatchObject({ status: "reconciliation_required", win_id: WIN_ID, error_detail: "finalize:duplicate_win" });
    expect(db.attempts[0].toss_response).toBeTruthy();
    expect(db.orders).toHaveLength(1);
    expect(JSON.stringify(err.mock.calls)).toContain("duplicate_win");
    // The win stays locked for any further payment.
    const again = await POST(confirmRequest(body({ orderId: "DTB-2", paymentKey: "pk_test_second_payment" })));
    expect(await again.json()).toMatchObject({ ok: false, code: "PAYMENT_NEEDS_REVIEW" });
    expect(tossFetch).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });

  it("28. the same order already saved (same win / amount / paymentKey) -> attempt paid, no second order", async () => {
    db.orders.push({ order_id: "DTB-1", win_id: WIN_ID, winner_id: WINNER_ID, amount: PRICE, payment_key: "pk_test_123456789" });
    const res = await POST(confirmRequest(body()));
    expect(res.status).toBe(200);
    expect(db.attempts[0]).toMatchObject({ status: "paid" });
    expect(db.orders).toHaveLength(1);
  });

  it("an order under this order_id that does not match the attempt -> reconciliation_required, not paid", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.orders.push({ order_id: "DTB-1", win_id: null, winner_id: WINNER_ID, amount: PRICE, payment_key: "pk_someone_else" });
    const res = await POST(confirmRequest(body()));
    expect(await res.json()).toMatchObject({ ok: false, code: "PAYMENT_NEEDS_REVIEW" });
    expect(db.attempts[0]).toMatchObject({ status: "reconciliation_required", error_detail: "finalize:order_mismatch" });
  });

  it("after a reset: replay of a paid confirm still reports paid (no game_state, past the deadline)", async () => {
    expect((await POST(confirmRequest(body()))).status).toBe(200);
    // admin_reset_game() would now wipe game_state; the route never reads it.
    db.serverNow = afterClaim(3 * 60 * 60);
    const replay = await POST(confirmRequest(body()));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ ok: true, data: { orderId: "DTB-1", totalAmount: PRICE, method: "카드" } });
    expect(tossFetch).toHaveBeenCalledTimes(1);
    expect(db.gameStateReads).toBe(0);
  });

  it("after a reset: pending-confirm recovery (re-login, same winId) approves from the win, without game_state", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // First send died on AUTH_SESSION_INVALID -> nothing was recorded.
    expect((await POST(confirmRequest(body(), "stale-token"))).status).toBe(401);
    db.serverNow = afterClaim(25 * 60); // still before the stored deadline
    const resumed = await POST(confirmRequest(body()));
    expect(resumed.status).toBe(200);
    expect(db.orders[0]).toMatchObject({ win_id: WIN_ID, product_name: WIN_PRODUCT });
    expect(db.gameStateReads).toBe(0);
    vi.mocked(console.warn).mockRestore();
  });

  it("reconciliation_required with win_id: replay without Toss response stays NEEDS_REVIEW; new payment blocked", async () => {
    db.attempts.push({ order_id: "DTB-1", user_id: WINNER_ID, winner_id: WINNER_ID, win_id: WIN_ID, win_claimed_at: CLAIMED,
      amount: PRICE, payment_key: "pk_test_123456789", status: "reconciliation_required", error_detail: "timeout" });
    expect(await (await POST(confirmRequest(body()))).json()).toMatchObject({ ok: false, code: "PAYMENT_NEEDS_REVIEW" });
    expect(await (await POST(confirmRequest(body({ orderId: "DTB-2", paymentKey: "pk_test_other" })))).json())
      .toMatchObject({ ok: false, code: "PAYMENT_NEEDS_REVIEW" });
    expect(db.attempts[0].status).toBe("reconciliation_required");
    expect(tossFetch).not.toHaveBeenCalled();
  });

  it("a new-style attempt is identified by win_id: same order without / with another winId is refused", async () => {
    db.attempts.push({ order_id: "DTB-1", user_id: WINNER_ID, winner_id: WINNER_ID, win_id: WIN_ID, win_claimed_at: CLAIMED,
      amount: PRICE, payment_key: "pk_test_123456789", status: "paid", toss_response: { totalAmount: PRICE } });
    expect((await POST(confirmRequest({ paymentKey: "pk_test_123456789", orderId: "DTB-1", amount: PRICE }))).status).toBe(409);
    expect((await POST(confirmRequest(body({ winId: OTHER_WIN_ID })))).status).toBe(409);
    expect(tossFetch).not.toHaveBeenCalled();
  });
});

describe("legacy rows (win_id null) keep the old identification", () => {
  const legacyRow = (status: string, extra: Row = {}) => ({
    order_id: "DTB-L", user_id: WINNER_ID, winner_id: WINNER_ID, win_id: null, win_claimed_at: "2026-09-01T00:00:00.000Z",
    amount: 300_000, payment_key: "pk_legacy_payment", status, ...extra,
  });
  const legacyReq = (extra: Row = {}) => confirmRequest({ paymentKey: "pk_legacy_payment", orderId: "DTB-L", amount: 300_000, ...extra });

  it("paid legacy order replays as success without a winId, with no auction_wins row and no game_state", async () => {
    db.wins = [];
    db.attempts.push(legacyRow("paid", { toss_response: { totalAmount: 300_000, method: "카드" } }));
    const res = await POST(legacyReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, data: { orderId: "DTB-L", totalAmount: 300_000, method: "카드", approvedAt: null, orderName: null } });
    expect(db.gameStateReads).toBe(0);
    expect(tossFetch).not.toHaveBeenCalled();
  });

  it("reconciliation_required legacy order: NEEDS_REVIEW, with or without a stored Toss response (M4-A)", async () => {
    db.attempts.push(legacyRow("reconciliation_required"));
    expect(await (await POST(legacyReq())).json()).toMatchObject({ ok: false, code: "PAYMENT_NEEDS_REVIEW" });
    db.attempts[0].toss_response = { totalAmount: 300_000 };
    expect(await (await POST(legacyReq())).json()).toMatchObject({ ok: false, code: "PAYMENT_NEEDS_REVIEW" });
  });

  it("pending legacy order: PAYMENT_IN_PROGRESS", async () => {
    db.attempts.push(legacyRow("pending"));
    expect(await (await POST(legacyReq())).json()).toMatchObject({ ok: false, code: "PAYMENT_PROCESSING" });
  });

  it("legacy row + a winId in the request: not the same request (409)", async () => {
    db.attempts.push(legacyRow("paid", { toss_response: { totalAmount: 300_000 } }));
    expect((await POST(legacyReq({ winId: WIN_ID }))).status).toBe(409);
  });

  it("legacy row of another user: 409", async () => {
    db.attempts.push(legacyRow("paid", { user_id: "someone-else", winner_id: "someone-else" }));
    expect((await POST(legacyReq())).status).toBe(409);
  });

  it("failed legacy order: a retry is a new approval and needs a winId — refused, no Toss call", async () => {
    db.attempts.push(legacyRow("failed"));
    const res = await POST(legacyReq());
    expect(res.status).toBe(400);
    expect(tossFetch).not.toHaveBeenCalled();
    expect(db.attempts[0].status).toBe("failed");
  });
});

// ── M4-A: approval safety ───────────────────────────────────────────────────
describe("M4-A approval safety", () => {
  const body = (extra: Row = {}) => ({ paymentKey: "pk_test_123456789", orderId: "DTB-1", amount: PRICE, winId: WIN_ID, ...extra });
  const quiet = () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  };
  const attempt = () => db.attempts.find((a) => a.order_id === "DTB-1")!;
  beforeEach(() => vi.restoreAllMocks());

  describe("confirm success", () => {
    it("1. confirm DONE -> order + paid in one finalize RPC; response is the whitelist only", async () => {
      const res = await POST(confirmRequest(body()));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        ok: true,
        data: { orderId: "DTB-1", totalAmount: PRICE, method: "카드", approvedAt: "2026-10-06T21:01:00+09:00", orderName: WIN_PRODUCT },
      });
      expect(db.rpcLog).toEqual(["server_now", "payment_reserve_attempt", "payment_finalize_paid"]);
      expect(attempt()).toMatchObject({ status: "paid", toss_status: "DONE", approved_at: "2026-10-06T21:01:00+09:00" });
      expect(db.orders).toHaveLength(1);
      expect(lookupCalls()).toHaveLength(0);
    });

    it("2. the confirm POST carries Basic auth and the attempt's stored Idempotency-Key (server-generated, <= 300 chars)", async () => {
      await POST(confirmRequest(body()));
      const [c] = confirmCalls();
      expect(c.method).toBe("POST");
      expect(c.headers.Authorization).toBe(`Basic ${Buffer.from(`${KEYS.testSecret}:`).toString("base64")}`);
      expect(c.headers["Content-Type"]).toBe("application/json");
      expect(c.headers["Idempotency-Key"]).toBe(attempt().toss_idempotency_key);
      expect(c.headers["Idempotency-Key"]).toMatch(/^confirm-/);
      expect(c.headers["Idempotency-Key"].length).toBeLessThanOrEqual(300);
    });

    it("3. a retry of the same attempt (same orderId) sends the same Idempotency-Key; another orderId gets another key", async () => {
      quiet();
      toss.confirm = () => tossError(403, "REJECT_CARD_PAYMENT");
      await POST(confirmRequest(body()));
      expect(attempt().status).toBe("failed");
      toss.confirm = null;
      await POST(confirmRequest(body())); // same orderId: failed -> pending -> DONE
      const keys = confirmCalls().map((c) => c.headers["Idempotency-Key"]);
      expect(keys).toHaveLength(2);
      expect(keys[0]).toBe(keys[1]);
      expect(attempt()).toMatchObject({ status: "paid", toss_idempotency_key: keys[0] });

      db.attempts = []; db.orders = []; tossCalls.length = 0;
      await POST(confirmRequest(body({ orderId: "DTB-OTHER", paymentKey: "pk_test_other_key" })));
      expect(confirmCalls()[0].headers["Idempotency-Key"]).not.toBe(keys[0]);
    });

    it("the client cannot choose the Idempotency-Key", async () => {
      await POST(confirmRequest(body({ idempotencyKey: "confirm-attacker", toss_idempotency_key: "x" })));
      expect(confirmCalls()[0].headers["Idempotency-Key"]).toBe(attempt().toss_idempotency_key);
      expect(attempt().toss_idempotency_key).not.toBe("confirm-attacker");
    });

    for (const [name, extra] of [
      ["amount", { totalAmount: PRICE - 1 }], ["orderId", { orderId: "DTB-SOMETHING-ELSE" }],
      ["paymentKey", { paymentKey: "pk_other_key_xyz" }], ["currency", { currency: "USD" }],
    ] as const) {
      it(`4. confirm DONE with a different ${name} -> reconciliation_required, no order, never paid`, async () => {
        quiet();
        toss.confirm = confirmOk(extra);
        const res = await POST(confirmRequest(body()));
        expect(await res.json()).toMatchObject({ ok: false, code: "PAYMENT_NEEDS_REVIEW" });
        expect(attempt()).toMatchObject({ status: "reconciliation_required", error_detail: expect.stringContaining("confirm_identity_mismatch") });
        expect(db.orders).toHaveLength(0);
        expect(db.rpcLog).not.toContain("payment_finalize_paid");
      });
    }

    for (const status of ["READY", "IN_PROGRESS", "WAITING_FOR_DEPOSIT", "CANCELED", "SOMETHING_NEW"]) {
      it(`5. 2xx with status ${status} -> not paid (reconciliation_required)`, async () => {
        quiet();
        toss.confirm = confirmOk({ status });
        const res = await POST(confirmRequest(body()));
        expect(await res.json()).toMatchObject({ ok: false, code: "PAYMENT_NEEDS_REVIEW" });
        expect(attempt()).toMatchObject({ status: "reconciliation_required", toss_status: status, error_detail: `confirm_status:${status}` });
        expect(db.orders).toHaveLength(0);
      });
    }

    it("2xx DONE paid with a method outside the CARD window (e.g. 가상계좌) -> reconciliation_required", async () => {
      quiet();
      toss.confirm = confirmOk({ method: "가상계좌" });
      await POST(confirmRequest(body()));
      expect(attempt()).toMatchObject({ status: "reconciliation_required", error_detail: "confirm_unexpected_method" });
      expect(db.orders).toHaveLength(0);
    });

    it("간편결제 through the CARD window is a normal success", async () => {
      toss.confirm = confirmOk({ method: "간편결제", easyPay: { provider: "토스페이", amount: PRICE } });
      expect((await POST(confirmRequest(body()))).status).toBe(200);
      expect(attempt().toss_response).toMatchObject({ method: "간편결제", easyPayProvider: "토스페이" });
    });
  });

  describe("ambiguous confirm -> one lookup, never failed on its own", () => {
    const AMBIGUOUS: [string, Handler][] = [
      ["6. network failure", () => { throw new TypeError("fetch failed"); }],
      ["7. timeout (aborted)", () => { throw new DOMException("The operation was aborted.", "AbortError"); }],
      ["8. unreadable JSON body", () => new Response("<html>bad gateway</html>", { status: 200 })],
      ["9. Toss 500", () => tossError(500, "FAILED_INTERNAL_SYSTEM_PROCESSING")],
      ["10a. 502", () => new Response("bad gateway", { status: 502 })],
      ["10b. 503", () => tossError(503, "SERVICE_UNAVAILABLE")],
      ["11. 408", () => tossError(408, "REQUEST_TIMEOUT")],
      ["12. 429", () => tossError(429, "TOO_MANY_REQUESTS")],
      ["13. ALREADY_PROCESSED_PAYMENT", () => tossError(400, "ALREADY_PROCESSED_PAYMENT")],
      ["14. IDEMPOTENT_REQUEST_PROCESSING", () => tossError(409, "IDEMPOTENT_REQUEST_PROCESSING")],
      ["unlisted 4xx code", () => tossError(400, "BRAND_NEW_CODE_NOBODY_KNOWS")],
      ["NOT_FOUND_PAYMENT_SESSION", () => tossError(404, "NOT_FOUND_PAYMENT_SESSION")],
      ["PROVIDER_ERROR", () => tossError(400, "PROVIDER_ERROR")],
      ["2xx that isn't a Payment", () => json({ ok: true })],
    ];
    for (const [name, confirm] of AMBIGUOUS) {
      it(`${name}: looked up; lookup DONE -> paid`, async () => {
        quiet();
        toss.confirm = confirm;
        toss.lookup = (key) => json(tossPayment({ paymentKey: key, orderId: "DTB-1", amount: PRICE }));
        const res = await POST(confirmRequest(body()));
        expect(res.status).toBe(200);
        expect(lookupCalls().map((c) => c.url)).toEqual(["https://api.tosspayments.com/v1/payments/pk_test_123456789"]);
        expect(attempt()).toMatchObject({ status: "paid", toss_status: "DONE" });
        expect(db.orders).toHaveLength(1);
      });
      it(`${name}: lookup not settling it -> reconciliation_required (never failed)`, async () => {
        quiet();
        toss.confirm = confirm;
        toss.lookup = () => tossError(404, "NOT_FOUND_PAYMENT");
        const res = await POST(confirmRequest(body()));
        expect(await res.json()).toMatchObject({ ok: false, code: "PAYMENT_NEEDS_REVIEW" });
        expect(attempt().status).toBe("reconciliation_required");
        // A new payment for the same win stays blocked.
        const again = await POST(confirmRequest(body({ orderId: "DTB-2", paymentKey: "pk_test_second" })));
        expect(await again.json()).toMatchObject({ ok: false, code: "PAYMENT_NEEDS_REVIEW" });
        expect(confirmCalls()).toHaveLength(1);
      });
    }

    it("definitive declines (allowlist) are failed without a lookup; config errors too", async () => {
      quiet();
      for (const [status, code, userCode] of [
        [403, "REJECT_CARD_PAYMENT", "PAYMENT_DECLINED"], [400, "INVALID_CARD_NUMBER", "PAYMENT_DECLINED"],
        [403, "FDS_ERROR", "PAYMENT_DECLINED"], [401, "UNAUTHORIZED_KEY", "PAYMENT_CONFIG_ERROR"],
      ] as const) {
        db.attempts = []; tossCalls.length = 0;
        toss.confirm = () => tossError(status, code);
        const res = await POST(confirmRequest(body()));
        expect(await res.json()).toMatchObject({ ok: false, code: userCode });
        expect(attempt()).toMatchObject({ status: "failed", error_detail: `confirm_http_${status}:${code}` });
        expect(attempt().toss_response).toEqual({ httpStatus: status, code, message: `RAW_TOSS_MESSAGE ${code}` });
        expect(lookupCalls()).toHaveLength(0);
      }
    });

    it("an allowlisted code with a 5xx status is still ambiguous", async () => {
      quiet();
      toss.confirm = () => tossError(500, "REJECT_CARD_PAYMENT");
      toss.lookup = () => tossError(500, "FAILED_PAYMENT_INTERNAL_SYSTEM_PROCESSING");
      await POST(confirmRequest(body()));
      expect(lookupCalls()).toHaveLength(1);
      expect(attempt().status).toBe("reconciliation_required");
    });
  });

  describe("lookup recovery (after an ambiguous confirm)", () => {
    const afterAmbiguous = (lookup: (key: string) => Response | Promise<Response>) => {
      quiet();
      toss.confirm = () => tossError(500, "FAILED_INTERNAL_SYSTEM_PROCESSING");
      toss.lookup = lookup;
    };
    const lookupPayment = (extra: Row) => (key: string) => json(tossPayment({ paymentKey: key, orderId: "DTB-1", amount: PRICE }, extra));

    it("15. lookup DONE + identity match -> paid recovery", async () => {
      afterAmbiguous(lookupPayment({}));
      expect((await POST(confirmRequest(body()))).status).toBe(200);
      expect(attempt()).toMatchObject({ status: "paid" });
      expect(db.orders[0]).toMatchObject({ order_id: "DTB-1", win_id: WIN_ID, amount: PRICE, payment_key: "pk_test_123456789" });
    });
    it("16. lookup DONE + amount mismatch -> reconciliation_required", async () => {
      afterAmbiguous(lookupPayment({ totalAmount: 1 }));
      await POST(confirmRequest(body()));
      expect(attempt()).toMatchObject({ status: "reconciliation_required", error_detail: expect.stringContaining("lookup_identity_mismatch:totalAmount") });
      expect(db.orders).toHaveLength(0);
    });
    it("17. lookup DONE + orderId mismatch -> reconciliation_required", async () => {
      afterAmbiguous(lookupPayment({ orderId: "DTB-ELSEWHERE" }));
      await POST(confirmRequest(body()));
      expect(attempt()).toMatchObject({ status: "reconciliation_required", error_detail: expect.stringContaining("lookup_identity_mismatch:orderId") });
    });
    it("18. lookup ABORTED -> failed (PAYMENT_DECLINED); the win can be paid again", async () => {
      afterAmbiguous(lookupPayment({ status: "ABORTED" }));
      expect(await (await POST(confirmRequest(body()))).json()).toMatchObject({ ok: false, code: "PAYMENT_DECLINED" });
      expect(attempt()).toMatchObject({ status: "failed", toss_status: "ABORTED" });
      toss.confirm = null; toss.lookup = null;
      expect((await POST(confirmRequest(body({ orderId: "DTB-2", paymentKey: "pk_test_second" })))).status).toBe(200);
    });
    it("19. lookup EXPIRED -> failed (PAYMENT_AUTH_EXPIRED)", async () => {
      afterAmbiguous(lookupPayment({ status: "EXPIRED" }));
      expect(await (await POST(confirmRequest(body()))).json()).toMatchObject({ ok: false, code: "PAYMENT_AUTH_EXPIRED" });
      expect(attempt()).toMatchObject({ status: "failed", toss_status: "EXPIRED" });
    });
    it("lookup ABORTED but for another amount -> reconciliation_required, not failed", async () => {
      afterAmbiguous(lookupPayment({ status: "ABORTED", totalAmount: 5 }));
      await POST(confirmRequest(body()));
      expect(attempt().status).toBe("reconciliation_required");
    });
    for (const [n, status] of [["20", "READY"], ["21", "IN_PROGRESS"], ["22", "CANCELED"], ["", "PARTIAL_CANCELED"], ["", "WAITING_FOR_DEPOSIT"]]) {
      it(`${n ? `${n}. ` : ""}lookup ${status} -> reconciliation_required`, async () => {
        afterAmbiguous(lookupPayment({ status }));
        expect(await (await POST(confirmRequest(body()))).json()).toMatchObject({ ok: false, code: "PAYMENT_NEEDS_REVIEW" });
        expect(attempt()).toMatchObject({ status: "reconciliation_required", toss_status: status });
        expect(db.orders).toHaveLength(0);
      });
    }
    it("23. lookup 404 NOT_FOUND_PAYMENT -> reconciliation_required (could be a key-mode mix-up), not failed", async () => {
      afterAmbiguous(() => tossError(404, "NOT_FOUND_PAYMENT"));
      await POST(confirmRequest(body()));
      expect(attempt()).toMatchObject({ status: "reconciliation_required", error_detail: "confirm_http_500:FAILED_INTERNAL_SYSTEM_PROCESSING|lookup_http_404:NOT_FOUND_PAYMENT" });
    });
    it("24. lookup timeout -> reconciliation_required", async () => {
      afterAmbiguous(() => { throw new DOMException("The operation timed out.", "TimeoutError"); });
      await POST(confirmRequest(body()));
      expect(attempt()).toMatchObject({ status: "reconciliation_required", error_detail: expect.stringContaining("lookup_timeout") });
    });
    it("25. lookup malformed -> reconciliation_required", async () => {
      afterAmbiguous(() => json({ paymentKey: 7 }));
      await POST(confirmRequest(body()));
      expect(attempt()).toMatchObject({ status: "reconciliation_required", error_detail: expect.stringContaining("lookup_unexpected_body") });
    });
    it("the lookup uses the attempt's paymentKey (URL-encoded), the secret key, no Idempotency-Key, no body", async () => {
      afterAmbiguous(lookupPayment({}));
      await POST(confirmRequest(body({ paymentKey: "pk_test_a/b?c" })));
      const [l] = lookupCalls();
      expect(l.url).toBe("https://api.tosspayments.com/v1/payments/pk_test_a%2Fb%3Fc");
      expect(l.headers.Authorization).toBe(`Basic ${Buffer.from(`${KEYS.testSecret}:`).toString("base64")}`);
      expect(l.headers["Idempotency-Key"]).toBeUndefined();
      expect(l.body).toBeNull();
    });
  });

  describe("DB consistency", () => {
    it("26. order + paid come from one finalize call; the order is built from the attempt and the win", async () => {
      await POST(confirmRequest(body()));
      expect(db.rpcLog.filter((f) => f === "payment_finalize_paid")).toHaveLength(1);
      expect(db.orders[0]).toMatchObject({
        order_id: "DTB-1", win_id: WIN_ID, winner_id: WINNER_ID, user_id: WINNER_ID, amount: PRICE, payment_key: "pk_test_123456789",
        product_name: WIN_PRODUCT, shipping_recipient_name: "홍길동", shipping_address_detail: "12층",
      });
    });

    it("27b. finalize RPC itself errors -> reconciliation_required with the sanitized Toss response, 503 NEEDS_REVIEW", async () => {
      quiet();
      db.finalizeError = { code: "40001", message: "could not serialize access" };
      const res = await POST(confirmRequest(body()));
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ ok: false, code: "PAYMENT_NEEDS_REVIEW" });
      expect(attempt()).toMatchObject({ status: "reconciliation_required", toss_status: "DONE", error_detail: "finalize_error:could not serialize access" });
      expect(JSON.stringify(attempt().toss_response)).not.toMatch(/SECRET_FIELD|card|checkout|receipt/i);
      expect(db.orders).toHaveLength(0);
    });

    it("30. the order uses the reservation's shipping snapshot even if the profile changes during the Toss call", async () => {
      toss.confirm = async (b) => {
        db.user!.user_metadata = { ...SHIPPING, address: "바뀐 주소", shippingRecipientName: "다른 사람" };
        return confirmOk()(b);
      };
      await POST(confirmRequest(body()));
      expect(attempt()).toMatchObject({ shipping_recipient_name: "홍길동", shipping_address: "서울 강남구 테헤란로 152" });
      expect(db.orders[0]).toMatchObject({ shipping_recipient_name: "홍길동", shipping_address: "서울 강남구 테헤란로 152" });
    });

    it("the reservation stores the normalized server-side shipping snapshot (not client input)", async () => {
      db.user!.user_metadata = { ...SHIPPING, address: "  서울 강남구 테헤란로 152  ", addressDetail: "" };
      await POST(confirmRequest(body({ shipping_address: "CLIENT_SUPPLIED", shippingRecipientName: "CLIENT" })));
      expect(attempt()).toMatchObject({
        shipping_recipient_name: "홍길동", shipping_phone: "010-1234-5678", shipping_postcode: "06236",
        shipping_address: "서울 강남구 테헤란로 152", shipping_address_detail: null,
      });
    });

    it("31a. recording 'failed' fails -> NOT reported as declined: 503 NEEDS_REVIEW, attempt stays pending (win locked)", async () => {
      quiet();
      toss.confirm = () => tossError(403, "REJECT_CARD_PAYMENT");
      db.updateError = { code: "08006", message: "connection failure" };
      const res = await POST(confirmRequest(body()));
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ ok: false, code: "PAYMENT_NEEDS_REVIEW" });
      expect(attempt().status).toBe("pending");
      expect(JSON.stringify(vi.mocked(console.error).mock.calls)).toContain("could not record the attempt outcome");
    });

    it("31b. recording reconciliation_required fails -> still NEEDS_REVIEW (never success / failed), attempt stays pending", async () => {
      quiet();
      toss.confirm = confirmOk({ status: "IN_PROGRESS" });
      db.updateError = { code: "08006", message: "connection failure" };
      const res = await POST(confirmRequest(body()));
      expect(await res.json()).toMatchObject({ ok: false, code: "PAYMENT_NEEDS_REVIEW" });
      expect(attempt().status).toBe("pending");
    });

    it("31c. an outcome update only applies to a still-pending attempt (0 rows is reported, not ignored)", async () => {
      quiet();
      toss.confirm = async () => {
        attempt().status = "paid"; // e.g. an operator resolved it meanwhile
        return tossError(403, "REJECT_CARD_PAYMENT");
      };
      const res = await POST(confirmRequest(body()));
      expect(await res.json()).toMatchObject({ ok: false, code: "PAYMENT_NEEDS_REVIEW" });
      expect(attempt().status).toBe("paid");
      expect(lookupCalls()).toHaveLength(0);
      expect(JSON.stringify(vi.mocked(console.error).mock.calls)).toContain("could not record the attempt outcome");
    });
  });

  describe("deadline: the right to call Toss is secured in the DB before payment_deadline", () => {
    it("32. reservation just before the deadline succeeds", async () => {
      db.serverNow = afterClaim(1799.999);
      expect((await POST(confirmRequest(body()))).status).toBe(200);
    });
    it("33. after the deadline: refused before the reservation and before Toss", async () => {
      db.serverNow = afterClaim(1800);
      expect(await (await POST(confirmRequest(body()))).json()).toMatchObject({ ok: false, code: "PAYMENT_WINDOW_EXPIRED" });
      expect(db.rpcLog).not.toContain("payment_reserve_attempt");
      expect(tossFetch).not.toHaveBeenCalled();
    });
    it("34. reserved at 29:59, Toss answers after the deadline -> recorded normally (paid)", async () => {
      db.serverNow = afterClaim(1799);
      toss.confirm = async (b) => {
        db.serverNow = afterClaim(1830);
        db.reserveNow = afterClaim(1830);
        return confirmOk()(b);
      };
      expect((await POST(confirmRequest(body()))).status).toBe(200);
      expect(attempt().status).toBe("paid");
    });
    it("35. boundary race: the early check passes, the deadline passes before the reservation -> the RPC refuses, no Toss", async () => {
      db.serverNow = afterClaim(1799);
      db.reserveNow = afterClaim(1800);
      expect(await (await POST(confirmRequest(body()))).json()).toMatchObject({ ok: false, code: "PAYMENT_WINDOW_EXPIRED" });
      expect(db.attempts).toHaveLength(0);
      expect(tossFetch).not.toHaveBeenCalled();
    });
  });

  describe("key environment (fail closed)", () => {
    for (const [env, client, secret, ok] of [
      ["production", "liveClient", "liveSecret", true],
      ["production", "testClient", "testSecret", false],
      ["production", "liveClient", "testSecret", false],
      ["preview", "testClient", "testSecret", true],
      ["preview", "liveClient", "liveSecret", false],
      ["preview", "testClient", "liveSecret", false],
      ["", "liveClient", "liveSecret", false],
    ] as const) {
      it(`VERCEL_ENV=${env || "(unset)"} + ${client}/${secret} -> ${ok ? "approves" : "PAYMENT_CONFIG_ERROR before anything"}`, async () => {
        quiet();
        vi.stubEnv("VERCEL_ENV", env);
        vi.stubEnv("NEXT_PUBLIC_TOSS_CLIENT_KEY", KEYS[client]);
        vi.stubEnv("TOSS_SECRET_KEY", KEYS[secret]);
        const res = await POST(confirmRequest(body()));
        if (ok) {
          expect(res.status).toBe(200);
          expect(confirmCalls()[0].headers.Authorization).toBe(`Basic ${Buffer.from(`${KEYS[secret]}:`).toString("base64")}`);
        } else {
          expect(res.status).toBe(503);
          expect(await res.json()).toMatchObject({ ok: false, code: "PAYMENT_CONFIG_ERROR" });
          expect(tossFetch).not.toHaveBeenCalled();
          expect(db.attempts).toHaveLength(0);
          expect(db.rpcCalls).toBe(0);
        }
        const logged = JSON.stringify([vi.mocked(console.error).mock.calls, vi.mocked(console.warn).mock.calls]);
        for (const k of Object.values(KEYS)) expect(logged).not.toContain(k);
      });
    }
    it("42. no keys at all (local) -> PAYMENT_CONFIG_ERROR, nothing touched", async () => {
      quiet();
      vi.stubEnv("NEXT_PUBLIC_TOSS_CLIENT_KEY", "");
      vi.stubEnv("TOSS_SECRET_KEY", "");
      const res = await POST(confirmRequest(body()));
      expect(await res.json()).toMatchObject({ ok: false, code: "PAYMENT_CONFIG_ERROR" });
      expect(tossFetch).not.toHaveBeenCalled();
      expect(JSON.stringify(vi.mocked(console.error).mock.calls)).toContain("missing_client_key");
    });
  });

  describe("response / privacy", () => {
    const LEAKS = ["SECRET_FIELD", "pk_test_123456789", "43301234", "CHECKOUT_URL", "RECEIPT_URL", "approveNo", "card"];
    it("44-47. the success body is the whitelist: no Payment.secret, no paymentKey, no card / checkout / receipt", async () => {
      const text = JSON.stringify(await (await POST(confirmRequest(body()))).json());
      for (const leak of LEAKS) expect(text).not.toContain(leak);
      expect(Object.keys(JSON.parse(text).data).sort()).toEqual(["approvedAt", "method", "orderId", "orderName", "totalAmount"]);
    });
    it("the paid replay returns the same whitelist, also for a full Toss object stored before M4-A", async () => {
      db.attempts.push({
        order_id: "DTB-1", user_id: WINNER_ID, winner_id: WINNER_ID, win_id: WIN_ID, win_claimed_at: CLAIMED, amount: PRICE,
        payment_key: "pk_test_123456789", status: "paid", toss_response: tossPayment({ paymentKey: "pk_test_123456789", orderId: "DTB-1", amount: PRICE }),
      });
      const text = JSON.stringify(await (await POST(confirmRequest(body()))).json());
      for (const leak of LEAKS) expect(text).not.toContain(leak);
    });
    it("the stored toss_response of a new attempt drops secret / card / checkout / receipt", async () => {
      await POST(confirmRequest(body()));
      expect(attempt().toss_response).toEqual({
        orderId: "DTB-1", orderName: "Apple iPad Air 11형 Wi-Fi 128GB", status: "DONE", method: "카드", totalAmount: PRICE,
        balanceAmount: PRICE, currency: "KRW", type: "NORMAL", requestedAt: "2026-10-06T21:00:30+09:00",
        approvedAt: "2026-10-06T21:01:00+09:00", lastTransactionKey: "txkey_1", easyPayProvider: null,
      });
    });
    it("48. Toss's raw error message / code never reach the user (decline, ambiguous, config)", async () => {
      quiet();
      for (const [confirm, lookup] of [
        [() => tossError(403, "REJECT_CARD_COMPANY"), null],
        [() => tossError(500, "FAILED_INTERNAL_SYSTEM_PROCESSING"), () => tossError(404, "NOT_FOUND_PAYMENT")],
        [() => tossError(401, "UNAUTHORIZED_KEY"), null],
        [() => tossError(400, "ALREADY_PROCESSED_PAYMENT"), () => tossError(500, "FAILED_PAYMENT_INTERNAL_SYSTEM_PROCESSING")],
      ] as const) {
        db.attempts = [];
        toss.confirm = confirm as Handler;
        toss.lookup = lookup as never;
        const text = JSON.stringify(await (await POST(confirmRequest(body()))).json());
        expect(text).not.toContain("RAW_TOSS_MESSAGE");
        expect(text).not.toMatch(/REJECT_CARD_COMPANY|FAILED_INTERNAL|UNAUTHORIZED_KEY|ALREADY_PROCESSED|NOT_FOUND_PAYMENT/);
      }
    });
    it("logs never carry the secret key, the Authorization header or a full paymentKey", async () => {
      quiet();
      toss.confirm = () => tossError(500, "FAILED_INTERNAL_SYSTEM_PROCESSING");
      await POST(confirmRequest(body()));
      const logged = JSON.stringify([vi.mocked(console.error).mock.calls, vi.mocked(console.warn).mock.calls]);
      expect(logged).not.toContain(KEYS.testSecret);
      expect(logged).not.toContain("Basic ");
      expect(logged).not.toContain("pk_test_123456789");
      expect(logged).toContain("pk_tes...6789");
    });
  });
});
