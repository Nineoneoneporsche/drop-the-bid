// Route-level tests for POST /api/payment/confirm. Supabase and Toss are
// fully faked in memory — nothing here talks to a real database or to
// Toss's API.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  user: null as Row | null,
  gameState: null as Row | null,
  serverNow: null as string | null,
  serverNowError: null as Row | null,
  attempts: [] as Row[],
  orders: [] as Row[],
  rpcCalls: 0,
}));

vi.mock("@supabase/supabase-js", () => {
  class Query {
    private filters: [string, unknown][] = [];
    private patch: Row | null = null;
    constructor(private table: string) {}
    private rows(): Row[] {
      const all = this.table === "payment_attempts" ? db.attempts : this.table === "orders" ? db.orders : db.gameState ? [db.gameState] : [];
      return all.filter((r) => this.filters.every(([c, v]) => c === "id" || r[c] === v));
    }
    select() { return this; }
    eq(col: string, val: unknown) { this.filters.push([col, val]); return this; }
    async single() { const r = this.rows(); return { data: r[0] ?? null, error: r[0] ? null : { message: "no rows" } }; }
    async maybeSingle() { return { data: this.rows()[0] ?? null, error: null }; }
    async insert(row: Row) {
      if (this.table === "orders") {
        if (db.orders.some((o) => o.order_id === row.order_id)) return { error: { code: "23505", message: "duplicate" } };
        db.orders.push({ ...row });
      } else if (this.table === "payment_attempts") {
        db.attempts.push({ ...row });
      }
      return { error: null };
    }
    update(patch: Row) { this.patch = patch; return this; }
    then(resolve: (v: { error: null }) => unknown) {
      if (this.patch) for (const r of this.rows()) Object.assign(r, this.patch);
      return Promise.resolve({ error: null }).then(resolve);
    }
  }
  const client = {
    auth: {
      getUser: async (token: string) =>
        token === "good-token" && db.user
          ? { data: { user: db.user }, error: null }
          : { data: { user: null }, error: { message: "bad token" } },
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

const SHIPPING = {
  // Profile name — must NOT be used as the shipping recipient.
  name: "프로필이름",
  shippingRecipientName: "홍길동",
  phone: "010-1234-5678",
  postcode: "06236",
  address: "서울 강남구 테헤란로 152",
  addressDetail: "12층",
};

function confirmRequest(body: Row = { paymentKey: "pk_test_123456789", orderId: "DTB-1", amount: PRICE }, token = "good-token") {
  return new NextRequest("http://localhost/api/payment/confirm", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  db.user = { id: WINNER_ID, user_metadata: { ...SHIPPING } };
  db.gameState = { id: 1, phase: "ended", winner_id: WINNER_ID, winner_price: PRICE, winner_claimed_at: CLAIMED };
  db.serverNow = afterClaim(60);
  db.serverNowError = null;
  db.attempts = [];
  db.orders = [];
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

  it("refuses when winner_claimed_at is null", async () => {
    db.gameState!.winner_claimed_at = null;
    const res = await POST(confirmRequest());
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ ok: false, code: "PAYMENT_WINDOW_EXPIRED" });
    expect(tossFetch).not.toHaveBeenCalled();
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
      order_id: "DTB-1", user_id: WINNER_ID, winner_id: WINNER_ID, amount: PRICE,
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
      order_id: "DTB-1", user_id: WINNER_ID, winner_id: WINNER_ID, amount: PRICE,
      payment_key: "pk_test_123456789", status: "reconciliation_required", toss_response: { totalAmount: PRICE, method: "카드" },
    });
    db.serverNow = afterClaim(2 * 60 * 60);
    const res = await POST(confirmRequest());
    expect(await res.json()).toMatchObject({ ok: true });
    expect(tossFetch).not.toHaveBeenCalled();
  });

  it("treats a retry of a pending/failed attempt after the window as a new approval and refuses it", async () => {
    db.attempts.push({
      order_id: "DTB-1", user_id: WINNER_ID, winner_id: WINNER_ID, amount: PRICE,
      payment_key: "pk_test_123456789", status: "failed",
    });
    db.serverNow = afterClaim(1801);
    const res = await POST(confirmRequest());
    expect(await res.json()).toMatchObject({ ok: false, code: "PAYMENT_WINDOW_EXPIRED" });
    expect(tossFetch).not.toHaveBeenCalled();
  });
});

describe("existing checks are unchanged", () => {
  it("still refuses a user who is not the winner", async () => {
    db.user = { id: "someone-else", user_metadata: { ...SHIPPING } };
    const res = await POST(confirmRequest());
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ ok: false, error: "낙찰자 본인만 결제할 수 있습니다" });
    expect(tossFetch).not.toHaveBeenCalled();
  });

  it("still refuses an amount that does not match the winning price", async () => {
    const res = await POST(confirmRequest({ paymentKey: "pk_test_123456789", orderId: "DTB-1", amount: PRICE - 1 }));
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
      order_id: "DTB-1", user_id: WINNER_ID, winner_id: WINNER_ID, amount: PRICE,
      payment_key: "pk_other_payment", status: "paid",
    });
    const res = await POST(confirmRequest());
    expect(res.status).toBe(409);
    expect(tossFetch).not.toHaveBeenCalled();
  });

  it("still refuses when the game is not in the ended phase", async () => {
    db.gameState!.phase = "game";
    const res = await POST(confirmRequest());
    expect(res.status).toBe(400);
    expect(tossFetch).not.toHaveBeenCalled();
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
      order_id: "DTB-1", user_id: WINNER_ID, winner_id: WINNER_ID, amount: PRICE,
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
