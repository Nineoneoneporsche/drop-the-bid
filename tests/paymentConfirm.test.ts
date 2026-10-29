// Route-level tests for POST /api/payment/confirm. Supabase and Toss are
// fully faked in memory — nothing here talks to a real database or to
// Toss's API.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  user: null as Row | null,
  wins: [] as Row[],
  gameStateReads: 0,
  serverNow: null as string | null,
  serverNowError: null as Row | null,
  attempts: [] as Row[],
  orders: [] as Row[],
  ordersInsertError: null as Row | null,
  rpcCalls: 0,
}));

vi.mock("@supabase/supabase-js", () => {
  const ACTIVE = ["pending", "paid", "reconciliation_required"];
  // PostgREST's 23505 shape: the violated constraint/index is named in the
  // message — the route tells them apart by that name.
  const dup = (name: string) => ({ code: "23505", message: `duplicate key value violates unique constraint "${name}"` });

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
  // orders: orders_order_id_key UNIQUE (order_id), orders_one_per_win on
  // win_id WHERE win_id IS NOT NULL; win_id FK to auction_wins.
  function orderViolation(c: Row): string | null {
    if (db.orders.some((o) => o.order_id === c.order_id)) return "orders_order_id_key";
    if (c.win_id != null && db.orders.some((o) => o.win_id === c.win_id)) return "orders_one_per_win";
    return null;
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
    async insert(row: Row) {
      if (this.table === "orders") {
        if (db.ordersInsertError) return { error: db.ordersInsertError };
        const v = orderViolation(row);
        if (v) return { error: dup(v) };
        if (row.win_id != null && !db.wins.some((w) => w.id === row.win_id)) return { error: { code: "23503", message: "fk" } };
        db.orders.push({ ...row });
      } else if (this.table === "payment_attempts") {
        const v = attemptViolation(row, db.attempts);
        if (v) return { error: dup(v) };
        db.attempts.push({ ...row });
      } else {
        throw new Error(`unexpected insert into ${this.table}`);
      }
      return { error: null };
    }
    update(patch: Row) { this.patch = patch; return this; }
    then(resolve: (v: { data: Row[] | null; error: Row | null }) => unknown) {
      let result: { data: Row[] | null; error: Row | null } = { data: null, error: null };
      if (this.patch) {
        if (this.table !== "payment_attempts") throw new Error(`unexpected update of ${this.table}`);
        const targets = this.rows();
        const updated = targets.map((r) => ({ ...r, ...this.patch }));
        const blocked = updated.map((u, i) => attemptViolation(u, db.attempts.filter((o) => o !== targets[i]))).find((v) => v);
        if (blocked) {
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
    rpc: async (fn: string) => {
      db.rpcCalls++;
      if (fn !== "server_now") throw new Error(`unexpected rpc ${fn}`);
      return db.serverNowError ? { data: null, error: db.serverNowError } : { data: db.serverNow, error: null };
    },
  };
  return { createClient: () => client };
});

const tossFetch = vi.fn();
vi.stubGlobal("fetch", tossFetch);

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
  db.user = { id: WINNER_ID, user_metadata: { ...SHIPPING } };
  db.wins = [baseWin()];
  db.gameStateReads = 0;
  db.serverNow = afterClaim(60);
  db.serverNowError = null;
  db.attempts = [];
  db.orders = [];
  db.ordersInsertError = null;
  db.rpcCalls = 0;
  tossFetch.mockReset();
  tossFetch.mockImplementation(async () =>
    new Response(JSON.stringify({ orderName: "Apple iPad Air 11형 Wi-Fi 128GB", totalAmount: PRICE, method: "카드" }), { status: 200 }),
  );
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
    expect(await res.json()).toEqual({ ok: true, data: { totalAmount: PRICE, method: "카드" } });
    expect(tossFetch).not.toHaveBeenCalled();
  });

  it("keeps the replay of a reconciliation_required order reporting success after the window", async () => {
    db.attempts.push({
      order_id: "DTB-1", user_id: WINNER_ID, winner_id: WINNER_ID, win_id: WIN_ID, win_claimed_at: CLAIMED, amount: PRICE,
      payment_key: "pk_test_123456789", status: "reconciliation_required", toss_response: { totalAmount: PRICE, method: "카드" },
    });
    db.serverNow = afterClaim(2 * 60 * 60);
    const res = await POST(confirmRequest());
    expect(await res.json()).toMatchObject({ ok: true });
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
  const slowToss = (ms = 20) => tossFetch.mockImplementation(() => new Promise((resolve) => setTimeout(() =>
    resolve(new Response(JSON.stringify({ orderName: "Apple iPad Air 11형 Wi-Fi 128GB", totalAmount: PRICE, method: "카드" }), { status: 200 })), ms)));

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
    expect(await second.json()).toMatchObject({ ok: false, code: "ALREADY_PAID" });
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
    expect(["PAYMENT_IN_PROGRESS", "ALREADY_PAID"]).toContain(refused.code);
    expect(db.orders).toHaveLength(1);
    expect(db.attempts.filter((x) => x.status === "paid")).toHaveLength(1);
  });

  it("two concurrent confirms with the same orderId: Toss called at most once", async () => {
    slowToss();
    const [a, b] = await Promise.all([POST(req("DTB-1", "pk_test_123456789")), POST(req("DTB-1", "pk_test_123456789"))]);
    const bodies = [await a.json(), await b.json()];
    expect(tossFetch).toHaveBeenCalledTimes(1);
    expect(bodies.filter((x) => x.ok === true)).toHaveLength(1);
    expect(bodies.find((x) => x.ok === false)).toMatchObject({ code: "PAYMENT_IN_PROGRESS" });
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
    expect(await res.json()).toMatchObject({ ok: false, code: "ALREADY_PAID" });
    expect(tossFetch).not.toHaveBeenCalled();
  });

  it("an existing pending attempt blocks a new payment (PAYMENT_IN_PROGRESS)", async () => {
    db.attempts.push(activeAttempt("pending"));
    const res = await POST(req("DTB-NEW", "pk_test_new_payment"));
    expect(await res.json()).toMatchObject({ ok: false, code: "PAYMENT_IN_PROGRESS" });
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
    expect(await res.json()).toMatchObject({ ok: false, code: "PAYMENT_IN_PROGRESS" });
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
    expect(await res.json()).toMatchObject({ ok: false, code: "ALREADY_PAID" });
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
    tossFetch.mockImplementation(async () => new Response(JSON.stringify({ code: "REJECT_CARD_COMPANY", message: "카드사 거절" }), { status: 400 }));
    const res = await POST(req("DTB-1", "pk_test_123456789"));
    expect(res.status).toBe(400);
    expect(db.attempts[0].status).toBe("failed");
    tossFetch.mockImplementation(async () => new Response(JSON.stringify({ totalAmount: PRICE, method: "카드" }), { status: 200 }));
    expect((await POST(req("DTB-2", "pk_test_retry_payment"))).status).toBe(200);
  });

  it("Toss network exception -> reconciliation_required (NOT failed), and the win stays locked", async () => {
    tossFetch.mockImplementation(async () => { throw new Error("socket hang up"); });
    const res = await POST(req("DTB-1", "pk_test_123456789"));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ ok: false, code: "PAYMENT_NEEDS_REVIEW" });
    expect(db.attempts[0]).toMatchObject({ status: "reconciliation_required", error_detail: expect.stringContaining("socket hang up") });

    tossFetch.mockReset();
    const retry = await POST(req("DTB-2", "pk_test_second_payment"));
    expect(await retry.json()).toMatchObject({ ok: false, code: "PAYMENT_NEEDS_REVIEW" });
    expect(tossFetch).not.toHaveBeenCalled();
  });

  it("orders insert failure after Toss success -> reconciliation_required (success to the user), win stays locked", async () => {
    db.ordersInsertError = { code: "08006", message: "connection failure" };
    const res = await POST(req("DTB-1", "pk_test_123456789"));
    expect(res.status).toBe(200); // the charge succeeded — never tell the user it failed
    expect(db.attempts[0]).toMatchObject({ status: "reconciliation_required" });
    expect(db.attempts[0].toss_response).toBeTruthy();

    // Same order replay: still reported as success (Toss response is stored).
    expect(await (await POST(req("DTB-1", "pk_test_123456789"))).json()).toMatchObject({ ok: true });
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
    tossFetch.mockImplementation(() => new Promise((resolve) => setTimeout(() =>
      resolve(new Response(JSON.stringify({ totalAmount: PRICE, method: "카드" }), { status: 200 })), 20)));
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
    tossFetch.mockImplementation(async () =>
      new Response(JSON.stringify({ orderName: "클라이언트가 바꾼 상품명", totalAmount: PRICE, method: "카드" }), { status: 200 }));
    await POST(confirmRequest(body({ orderName: "클라이언트가 바꾼 상품명", product_name: "x" })));
    expect(db.orders[0]).toMatchObject({ product_name: WIN_PRODUCT, amount: PRICE });
  });

  it("sends Toss the win's price", async () => {
    await POST(confirmRequest(body()));
    expect(JSON.parse(tossFetch.mock.calls[0][1].body)).toEqual({ paymentKey: "pk_test_123456789", orderId: "DTB-1", amount: PRICE });
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
    expect(await res.json()).toMatchObject({ ok: false, code: "ALREADY_PAID" });
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

  it("concurrent same order_id insert (payment_attempts_pkey) is told apart: PAYMENT_IN_PROGRESS, not a win duplicate", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    tossFetch.mockImplementation(() => new Promise((resolve) => setTimeout(() =>
      resolve(new Response(JSON.stringify({ totalAmount: PRICE, method: "카드" }), { status: 200 })), 20)));
    const [a, b] = await Promise.all([POST(confirmRequest(body())), POST(confirmRequest(body()))]);
    const bodies = [await a.json(), await b.json()];
    expect(bodies.find((x) => x.ok === false)).toMatchObject({ code: "PAYMENT_IN_PROGRESS" });
    expect(JSON.stringify(warn.mock.calls)).toContain("same order_id");
    expect(tossFetch).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("orders_one_per_win after Toss success: reconciliation_required (fail-closed), never paid, no second order", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    db.orders.push({ order_id: "DTB-EARLIER", win_id: WIN_ID, winner_id: WINNER_ID, amount: PRICE });
    const res = await POST(confirmRequest(body()));
    expect(res.status).toBe(200); // charged at Toss — never told "failed"
    expect(db.attempts[0]).toMatchObject({ status: "reconciliation_required", win_id: WIN_ID });
    expect(db.attempts[0].toss_response).toBeTruthy();
    expect(db.orders).toHaveLength(1);
    expect(JSON.stringify(err.mock.calls)).toContain("orders_one_per_win");
    // The win stays locked for any further payment.
    const again = await POST(confirmRequest(body({ orderId: "DTB-2", paymentKey: "pk_test_second_payment" })));
    expect(await again.json()).toMatchObject({ ok: false, code: "PAYMENT_NEEDS_REVIEW" });
    expect(tossFetch).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });

  it("orders_order_id_key race after Toss success: the same order is already saved -> attempt paid", async () => {
    db.orders.push({ order_id: "DTB-1", win_id: null, winner_id: WINNER_ID, amount: PRICE });
    const res = await POST(confirmRequest(body()));
    expect(res.status).toBe(200);
    expect(db.attempts[0]).toMatchObject({ status: "paid" });
    expect(db.orders).toHaveLength(1);
  });

  it("after a reset: replay of a paid confirm still reports paid (no game_state, past the deadline)", async () => {
    expect((await POST(confirmRequest(body()))).status).toBe(200);
    // admin_reset_game() would now wipe game_state; the route never reads it.
    db.serverNow = afterClaim(3 * 60 * 60);
    const replay = await POST(confirmRequest(body()));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ ok: true, data: { totalAmount: PRICE } });
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
    expect(await res.json()).toEqual({ ok: true, data: { totalAmount: 300_000, method: "카드" } });
    expect(db.gameStateReads).toBe(0);
    expect(tossFetch).not.toHaveBeenCalled();
  });

  it("reconciliation_required legacy order keeps its answers", async () => {
    db.attempts.push(legacyRow("reconciliation_required"));
    expect(await (await POST(legacyReq())).json()).toMatchObject({ ok: false, code: "PAYMENT_NEEDS_REVIEW" });
    db.attempts[0].toss_response = { totalAmount: 300_000 };
    expect(await (await POST(legacyReq())).json()).toMatchObject({ ok: true });
  });

  it("pending legacy order: PAYMENT_IN_PROGRESS", async () => {
    db.attempts.push(legacyRow("pending"));
    expect(await (await POST(legacyReq())).json()).toMatchObject({ ok: false, code: "PAYMENT_IN_PROGRESS" });
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
