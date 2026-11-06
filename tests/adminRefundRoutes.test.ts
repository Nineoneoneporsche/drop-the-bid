// M4-B3 admin refund routes: GET /api/admin/payments, POST /api/admin/refund,
// POST /api/admin/refund/recheck — with the REAL refund engine
// (app/lib/paymentRefund.ts) and Toss client, a fake Toss (fetch stub) and
// an in-memory Supabase that mirrors the M4-B1 RPCs (the real SQL runs in
// tests/paymentCancellationsM4B.test.ts). The real isSameOrigin is kept.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type Row = Record<string, unknown>;
const SECRET = ["test", "sk", "UNITTESTONLYsecretB3"].join("_");
const CLIENT = ["test", "ck", "UNITTESTONLYclientB3"].join("_");
const SESSION = "5e550000-0000-4000-8000-0000000000b3";
const PKEY = "pk_test_admin_refund_0001";
const PKEY2 = "pk_test_admin_refund_0002";
const ORDER = "DTB-B3-ORDER-1";
const ORDER2 = "DTB-B3-ORDER-2";
const PRICE = 412_000;
const WIN = "11111111-0000-4000-8000-0000000000b3";
const CANCELED_AT = "2026-11-06T15:30:00+09:00";

const h = vi.hoisted(() => ({
  session: "5e550000-0000-4000-8000-0000000000b3" as string | null,
  orders: [] as Record<string, unknown>[],
  attempts: [] as Record<string, unknown>[],
  cancellations: [] as Record<string, unknown>[],
  rpcLog: [] as string[],
  reserveArgs: [] as Record<string, unknown>[],
  finalizeError: null as null | { code: string; message: string },
  seq: 0,
}));

vi.mock("../app/lib/adminAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../app/lib/adminAuth")>();
  type R = Record<string, unknown>;
  class Q {
    private f: ((r: R) => boolean)[] = [];
    private ord: { c: string; asc: boolean } | null = null;
    private lim = Infinity;
    constructor(private rows: R[]) {}
    select() { return this; }
    eq(c: string, v: unknown) { this.f.push((r) => r[c] === v); return this; }
    in(c: string, v: unknown[]) { this.f.push((r) => v.includes(r[c])); return this; }
    order(c: string, o?: { ascending?: boolean }) { this.ord = { c, asc: o?.ascending !== false }; return this; }
    limit(n: number) { this.lim = n; return this; }
    private hit() {
      let rows = this.rows.filter((r) => this.f.every((g) => g(r))).map((r) => ({ ...r }));
      if (this.ord) { const { c, asc } = this.ord; rows.sort((a, b) => (String(a[c]) < String(b[c]) ? -1 : 1) * (asc ? 1 : -1)); }
      return rows.slice(0, this.lim);
    }
    async maybeSingle() { return { data: this.hit()[0] ?? null, error: null }; }
    then(res: (v: unknown) => unknown) { return Promise.resolve({ data: this.hit(), error: null }).then(res); }
  }
  const tables: Record<string, () => R[]> = { orders: () => h.orders, payment_attempts: () => h.attempts, payment_cancellations: () => h.cancellations };
  const err = (message: string) => ({ data: null, error: { code: "P0001", message } });
  const rpc = async (fn: string, a: R) => {
    h.rpcLog.push(fn);
    if (fn === "payment_cancel_reserve") {
      h.reserveArgs.push({ ...a });
      if (!a.p_requested_by_session) return err("cancel_reserve:no_session");
      const o = h.orders.find((x) => x.order_id === a.p_order_id);
      if (!o) return err("cancel_reserve:no_order");
      const at = h.attempts.find((x) => x.order_id === a.p_order_id);
      if (!at) return err("cancel_reserve:no_attempt");
      if (at.status !== "paid") return err("cancel_reserve:not_paid");
      if (!o.win_id || !at.win_id) return err("cancel_reserve:legacy_order");
      if (o.refunded_at || h.cancellations.some((c) => c.order_id === a.p_order_id && c.status === "done")) return err("cancel_reserve:already_refunded");
      if (h.cancellations.some((c) => c.order_id === a.p_order_id && (c.status === "pending" || c.status === "reconciliation_required"))) return err("cancel_reserve:in_progress");
      const id = `c0000000-0000-4000-8000-${String(++h.seq).padStart(12, "0")}`;
      const row: R = {
        id, order_id: at.order_id, win_id: at.win_id, payment_key: at.payment_key, amount: at.amount, reason: String(a.p_reason).trim(),
        toss_idempotency_key: `cancel-key-${h.seq}`, status: "pending", toss_status: null, error_detail: null, initial_post_outcome: null,
        initial_post_http_status: null, initial_post_error_code: null, canceled_at: null, last_checked_at: null,
        requested_by_session: a.p_requested_by_session, requested_at: new Date().toISOString(),
      };
      h.cancellations.push(row);
      return { data: { cancellation_id: id, order_id: row.order_id, payment_key: row.payment_key, amount: row.amount, reason: row.reason, toss_idempotency_key: row.toss_idempotency_key }, error: null };
    }
    const row = h.cancellations.find((c) => c.id === a.p_id);
    if (fn === "payment_cancel_record_post") {
      if (!row || row.status !== "pending" || row.initial_post_outcome != null) return { data: false, error: null };
      Object.assign(row, { initial_post_outcome: a.p_outcome, initial_post_http_status: a.p_http_status, initial_post_error_code: a.p_error_code });
      return { data: true, error: null };
    }
    if (fn === "payment_cancel_mark") {
      if (!row || row.status !== a.p_from) return { data: false, error: null };
      if (a.p_status === "failed" && row.initial_post_outcome !== "definite_rejection") return err("cancel_mark:failed_needs_definite_rejection");
      if (a.p_status === "failed" && a.p_toss_status !== "DONE") return err("cancel_mark:failed_needs_uncanceled_payment");
      Object.assign(row, { status: a.p_status, toss_status: a.p_toss_status ?? row.toss_status, error_detail: a.p_error_detail, last_checked_at: new Date().toISOString() });
      return { data: true, error: null };
    }
    if (fn === "payment_cancel_finalize") {
      if (h.finalizeError) return { data: null, error: h.finalizeError };
      if (!row) return err("cancel_finalize:no_cancellation");
      if (row.status === "done") return { data: "already_done", error: null };
      Object.assign(row, { status: "done", toss_status: a.p_toss_status, toss_transaction_key: a.p_transaction_key, canceled_at: a.p_canceled_at, last_checked_at: new Date().toISOString() });
      const o = h.orders.find((x) => x.order_id === row.order_id)!;
      o.refunded_at = a.p_canceled_at;
      return { data: "done", error: null };
    }
    throw new Error(`unexpected rpc ${fn}`);
  };
  return {
    ...actual,
    requireAdminSession: async () => h.session !== null,
    requireAdminSessionId: async () => h.session,
    getSupabaseAdmin: () => ({ rpc, from: (t: string) => new Q(tables[t]()) }),
  };
});

// ── fake Toss ──────────────────────────────────────────────────────────────
type Call = { method: string; url: string; headers: Record<string, string>; body: Row | null };
const calls: Call[] = [];
const toss = { cancel: null as null | (() => Response), lookup: null as null | (() => Response) };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const tossError = (status: number, code: string) => json({ code, message: `RAW ${code}` }, status);
const payment = (extra: Row = {}): Row => ({
  paymentKey: PKEY, orderId: ORDER, status: "DONE", method: "카드", totalAmount: PRICE, balanceAmount: PRICE, currency: "KRW",
  approvedAt: "2026-11-06T15:00:00+09:00", secret: "ps_SECRET_MUST_NOT_LEAK", card: { number: "4330****" }, cancels: null, ...extra,
});
const canceled = (extra: Row = {}): Row => payment({
  status: "CANCELED", balanceAmount: 0,
  cancels: [{ cancelAmount: PRICE, cancelReason: "x", canceledAt: CANCELED_AT, transactionKey: "tx_b3_1", cancelStatus: "DONE" }], ...extra,
});
const fetchStub = vi.fn(async (url: string, init: RequestInit) => {
  calls.push({ method: init.method ?? "GET", url, headers: { ...(init.headers as Record<string, string>) }, body: typeof init.body === "string" ? JSON.parse(init.body) : null });
  if (url.endsWith("/cancel") && init.method === "POST") return (toss.cancel ?? (() => json(canceled())))();
  if ((init.method ?? "GET") === "GET") return (toss.lookup ?? (() => json(canceled())))();
  throw new Error(`unexpected fetch ${url}`);
});
vi.stubGlobal("fetch", fetchStub);
const posts = () => calls.filter((c) => c.method === "POST");
const gets = () => calls.filter((c) => c.method === "GET");

const { GET: listGET } = await import("../app/api/admin/payments/route");
const { POST: refundPOST } = await import("../app/api/admin/refund/route");
const { POST: recheckPOST } = await import("../app/api/admin/refund/recheck/route");

const req = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { host: "localhost", ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
const refund = async (body: unknown, headers?: Record<string, string>) => {
  const res = await refundPOST(req("/api/admin/refund", body, headers));
  return { status: res.status, body: await res.json() };
};
const recheck = async (body: unknown, headers?: Record<string, string>) => {
  const res = await recheckPOST(req("/api/admin/refund/recheck", body, headers));
  return { status: res.status, body: await res.json() };
};
const list = async (headers?: Record<string, string>) => {
  const res = await listGET(req("/api/admin/payments", undefined, headers));
  return { status: res.status, body: await res.json() };
};
const cancellation = (orderId = ORDER) => h.cancellations.filter((c) => c.order_id === orderId).at(-1)!;

beforeEach(() => {
  process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY = CLIENT;
  process.env.TOSS_SECRET_KEY = SECRET;
  delete process.env.VERCEL_ENV;
  h.session = SESSION;
  h.orders = [
    { order_id: ORDER, product_name: "아이패드", win_id: WIN, refunded_at: null, created_at: "2026-11-06T06:00:00Z", user_id: "user-uuid-1",
      winner_id: "user-uuid-1", amount: PRICE, payment_key: PKEY, shipping_recipient_name: "홍길동", shipping_phone: "010-1234-5678", shipping_address: "서울" },
    { order_id: ORDER2, product_name: "레거시 상품", win_id: null, refunded_at: null, created_at: "2026-11-05T06:00:00Z", user_id: "user-uuid-2",
      amount: 300_000, payment_key: PKEY2 },
  ];
  h.attempts = [
    { order_id: ORDER, status: "paid", amount: PRICE, payment_key: PKEY, win_id: WIN, user_id: "user-uuid-1", approved_at: "2026-11-06T06:00:05Z",
      created_at: "2026-11-06T05:59:00Z", toss_idempotency_key: "confirm-key-1", toss_response: { secret: "x" }, shipping_recipient_name: "홍길동" },
    { order_id: ORDER2, status: "paid", amount: 300_000, payment_key: PKEY2, win_id: null, user_id: "user-uuid-2", approved_at: null, created_at: "2026-11-05T05:59:00Z" },
    { order_id: "DTB-B3-PENDING", status: "pending", amount: 1000, payment_key: "pk_x", win_id: WIN, created_at: "2026-11-06T07:00:00Z" },
  ];
  h.cancellations = [];
  h.rpcLog = [];
  h.reserveArgs = [];
  h.seq = 0;
  h.finalizeError = null;
  calls.length = 0;
  toss.cancel = null;
  toss.lookup = null;
  fetchStub.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const LEAKS = [SECRET, PKEY, PKEY2, "cancel-key-", "confirm-key-1", "ps_SECRET_MUST_NOT_LEAK", "user-uuid-1", "홍길동", "010-1234-5678", "RAW "];
const noLeak = (v: unknown) => { const s = JSON.stringify(v); for (const l of LEAKS) expect(s, l).not.toContain(l); };

describe("auth / origin", () => {
  it("no admin session -> 401 on all three routes; nothing reserved, Toss not called", async () => {
    h.session = null;
    expect((await list()).status).toBe(401);
    expect(await refund({ orderId: ORDER, reason: "고객 요청" })).toMatchObject({ status: 401, body: { ok: false, error: "unauthorized" } });
    expect((await recheck({ cancellationId: "c0000000-0000-4000-8000-000000000001" })).status).toBe(401);
    expect(h.rpcLog).toEqual([]);
    expect(fetchStub).not.toHaveBeenCalled();
  });
  it("cross-origin -> 403 on all three routes; nothing reserved, Toss not called", async () => {
    const evil = { origin: "https://evil.example" };
    expect((await list(evil)).status).toBe(403);
    expect(await refund({ orderId: ORDER, reason: "고객 요청" }, evil)).toMatchObject({ status: 403, body: { error: "forbidden" } });
    expect((await recheck({ cancellationId: "c0000000-0000-4000-8000-000000000001" }, evil)).status).toBe(403);
    expect(h.rpcLog).toEqual([]);
    expect(fetchStub).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/payments", () => {
  it("paid orders only, minimal fields; no paymentKey / keys / Toss data / user id / shipping", async () => {
    const { status, body } = await list();
    expect(status).toBe(200);
    expect(body.items).toEqual([
      { orderId: ORDER, productName: "아이패드", amount: PRICE, paidAt: "2026-11-06T06:00:05Z", refundedAt: null, refundable: true, cancellation: null },
      { orderId: ORDER2, productName: "레거시 상품", amount: 300_000, paidAt: "2026-11-05T06:00:00Z", refundedAt: null, refundable: false, cancellation: null },
    ]);
    noLeak(body);
  });
  it("shows the order's cancellation: active one first, else the latest failed", async () => {
    h.cancellations.push(
      { id: "c-old", order_id: ORDER, status: "failed", reason: "첫 시도", canceled_at: null, last_checked_at: null, requested_at: "2026-11-06T07:00:00Z", payment_key: PKEY, toss_idempotency_key: "cancel-key-x" },
      { id: "c-new", order_id: ORDER, status: "reconciliation_required", reason: "둘째", canceled_at: null, last_checked_at: "2026-11-06T08:01:00Z", requested_at: "2026-11-06T08:00:00Z", payment_key: PKEY },
    );
    const { body } = await list();
    expect(body.items[0].cancellation).toEqual({ cancellationId: "c-new", cancellationStatus: "reconciliation_required", reason: "둘째", canceledAt: null, lastCheckedAt: "2026-11-06T08:01:00Z", canRecheck: true });
    noLeak(body);
  });
});

describe("stale pending (server-decided canRecheck)", () => {
  const ID = "c0000000-0000-4000-8000-0000000000cc";
  const seedPending = (ageMs: number) => h.cancellations.push({ id: ID, order_id: ORDER, payment_key: PKEY, amount: PRICE, status: "pending", reason: "r",
    canceled_at: null, last_checked_at: null, initial_post_outcome: null, toss_idempotency_key: "cancel-key-stale", requested_at: new Date(Date.now() - ageMs).toISOString() });
  it("pending < 5 min -> canRecheck false; >= 5 min -> true (requested_at itself is not returned)", async () => {
    seedPending(60_000);
    let { body } = await list();
    expect(body.items[0].cancellation).toMatchObject({ cancellationStatus: "pending", canRecheck: false });
    expect(JSON.stringify(body)).not.toContain("requested");
    h.cancellations[0].requested_at = new Date(Date.now() - 5 * 60_000 - 1000).toISOString();
    ({ body } = await list());
    expect(body.items[0].cancellation).toMatchObject({ cancellationStatus: "pending", canRecheck: true });
    for (const s of ["done", "failed"]) {
      h.cancellations[0].status = s;
      ({ body } = await list());
      expect(body.items[0].cancellation.canRecheck, s).toBe(false);
    }
  });
  it("stale pending re-checked through /api/admin/refund/recheck: GET only, 0 cancel POSTs, same key, no new cancellation", async () => {
    seedPending(6 * 60_000);
    toss.lookup = () => json(canceled());
    expect(await recheck({ cancellationId: ID })).toMatchObject({ status: 200, body: { ok: true, status: "done", cancellationId: ID } });
    expect(posts()).toHaveLength(0);
    expect(gets()).toHaveLength(1);
    expect(gets()[0].headers["Idempotency-Key"]).toBeUndefined();
    expect(h.cancellations).toHaveLength(1);
    expect(h.cancellations[0].toss_idempotency_key).toBe("cancel-key-stale");
    expect(h.rpcLog).not.toContain("payment_cancel_reserve");
    expect(h.rpcLog).not.toContain("payment_cancel_record_post");
  });
  it("stale pending still unknown -> reconciliation_required (never failed without a recorded rejection)", async () => {
    seedPending(6 * 60_000);
    toss.lookup = () => json(payment());
    expect(await recheck({ cancellationId: ID })).toMatchObject({ body: { status: "reconciliation_required" } });
    expect(posts()).toHaveLength(0);
  });
});

describe("POST /api/admin/refund", () => {
  it("paid order: reserve with order id / reason / the server's session only -> cancel POST (DB key, reason only) -> done; refunded_at = Toss canceledAt", async () => {
    const r = await refund({ orderId: ORDER, reason: "  고객 요청 환불  " });
    expect(r).toMatchObject({ status: 200, body: { ok: true, status: "done", message: "전액 환불이 완료되었습니다." } });
    expect(Object.keys(r.body).sort()).toEqual(["cancellationId", "message", "ok", "status"]);
    expect(h.reserveArgs).toEqual([{ p_order_id: ORDER, p_reason: "고객 요청 환불", p_requested_by_session: SESSION }]);
    expect(posts()).toHaveLength(1);
    expect(posts()[0].url).toBe(`https://api.tosspayments.com/v1/payments/${PKEY}/cancel`);
    expect(posts()[0].body).toEqual({ cancelReason: "고객 요청 환불" });
    expect(posts()[0].headers["Idempotency-Key"]).toBe("cancel-key-1");
    expect(gets()).toHaveLength(0);
    expect(cancellation()).toMatchObject({ status: "done", initial_post_outcome: "verified_cancel" });
    expect(h.orders[0].refunded_at).toBe(CANCELED_AT);
    expect(h.attempts[0].status).toBe("paid");
    noLeak(r.body);
  });
  it("reason: empty / whitespace / over 200 chars / missing -> 400, nothing reserved", async () => {
    for (const reason of ["", "   ", "가".repeat(201), undefined, 123]) {
      const r = await refund({ orderId: ORDER, reason });
      expect(r, String(reason)).toMatchObject({ status: 400, body: { ok: false, error: "cancel_reserve:invalid_reason" } });
    }
    expect((await refund({ orderId: ORDER, reason: "가".repeat(200) })).body.status).toBe("done");
    expect(h.reserveArgs).toHaveLength(1);
  });
  it("bad order id / bad JSON -> 400", async () => {
    for (const orderId of [undefined, "", "a b", "x".repeat(65), 12345]) {
      expect((await refund({ orderId, reason: "r" })).status, String(orderId)).toBe(400);
    }
    expect((await refund("{not json")).status).toBe(400);
    expect(h.rpcLog).toEqual([]);
  });
  it("amount / paymentKey / winId / idempotency key from the browser are ignored: the DB's values are used", async () => {
    const r = await refund({ orderId: ORDER, reason: "고객 요청", amount: 1, paymentKey: "pk_attacker", winId: "w", idempotencyKey: "attacker-key", cancelAmount: 1 });
    expect(r.body.status).toBe("done");
    expect(h.reserveArgs).toEqual([{ p_order_id: ORDER, p_reason: "고객 요청", p_requested_by_session: SESSION }]);
    expect(posts()[0].url).toContain(PKEY);
    expect(posts()[0].url).not.toContain("attacker");
    expect(posts()[0].body).toEqual({ cancelReason: "고객 요청" });
    expect(posts()[0].headers["Idempotency-Key"]).toBe("cancel-key-1");
  });
  it("already refunded -> 409 already_refunded; no Toss call", async () => {
    await refund({ orderId: ORDER, reason: "고객 요청" });
    calls.length = 0;
    expect(await refund({ orderId: ORDER, reason: "다시" })).toMatchObject({ status: 409, body: { ok: false, error: "cancel_reserve:already_refunded" } });
    expect(calls).toHaveLength(0);
  });
  it("two concurrent requests for one order: exactly one is reserved and sent", async () => {
    const [a, b] = await Promise.all([refund({ orderId: ORDER, reason: "A" }), refund({ orderId: ORDER, reason: "B" })]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect([a.body, b.body].find((x) => !x.ok)).toMatchObject({ error: "cancel_reserve:in_progress" });
    expect(h.cancellations).toHaveLength(1);
    expect(posts()).toHaveLength(1);
  });
  it("legacy order (no win_id) / not paid / unknown order -> refused, no Toss call", async () => {
    expect(await refund({ orderId: ORDER2, reason: "r" })).toMatchObject({ status: 409, body: { error: "cancel_reserve:legacy_order" } });
    expect(await refund({ orderId: "DTB-B3-PENDING", reason: "r" })).toMatchObject({ status: 404, body: { error: "cancel_reserve:no_order" } });
    expect(await refund({ orderId: "DTB-NOPE-1", reason: "r" })).toMatchObject({ status: 404, body: { error: "cancel_reserve:no_order" } });
    expect(fetchStub).not.toHaveBeenCalled();
  });
  it("POST 4xx definite rejection -> GET verified DONE, no cancel -> failed", async () => {
    toss.cancel = () => tossError(403, "NOT_CANCELABLE_PAYMENT");
    toss.lookup = () => json(payment());
    expect(await refund({ orderId: ORDER, reason: "r" })).toMatchObject({ status: 200, body: { status: "failed", message: "환불 요청이 승인되지 않았습니다." } });
    expect(posts()).toHaveLength(1);
    expect(gets()).toHaveLength(1);
    expect(cancellation()).toMatchObject({ status: "failed", initial_post_outcome: "definite_rejection", initial_post_http_status: 403 });
    expect(h.orders[0].refunded_at).toBeNull();
  });
  it("timeout / 5xx -> GET unknown -> reconciliation_required", async () => {
    for (const cancel of [() => { throw new DOMException("aborted", "AbortError"); }, () => tossError(502, "BAD_GATEWAY")] as (() => Response)[]) {
      h.cancellations = []; calls.length = 0;
      toss.cancel = cancel;
      toss.lookup = () => { throw new DOMException("aborted", "AbortError"); };
      expect(await refund({ orderId: ORDER, reason: "r" })).toMatchObject({ status: 200, body: { status: "reconciliation_required", message: "환불 처리 결과 확인이 필요합니다." } });
      expect(posts()).toHaveLength(1);
      expect(gets()).toHaveLength(1);
    }
    expect(cancellation().initial_post_outcome).toBe("http_ambiguous");
  });
  it("ALREADY_CANCELED_PAYMENT -> GET CANCELED -> done", async () => {
    toss.cancel = () => tossError(400, "ALREADY_CANCELED_PAYMENT");
    toss.lookup = () => json(canceled());
    expect(await refund({ orderId: ORDER, reason: "r" })).toMatchObject({ body: { status: "done" } });
    expect(h.orders[0].refunded_at).toBe(CANCELED_AT);
  });
  it("Toss key misconfigured -> 503 config, nothing reserved", async () => {
    process.env.TOSS_SECRET_KEY = "live_sk_" + "x".repeat(20);
    expect(await refund({ orderId: ORDER, reason: "r" })).toMatchObject({ status: 503, body: { error: "config" } });
    expect(h.rpcLog).toEqual([]);
    expect(fetchStub).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/refund/recheck", () => {
  const seedRecon = async (cancel: () => Response) => {
    toss.cancel = cancel;
    toss.lookup = () => { throw new DOMException("aborted", "AbortError"); };
    const r = await refund({ orderId: ORDER, reason: "r" });
    expect(r.body.status).toBe("reconciliation_required");
    calls.length = 0;
    return r.body.cancellationId as string;
  };
  it("GET only: verified cancel -> done; no cancel POST, no new key, no new cancellation", async () => {
    const id = await seedRecon(() => { throw new DOMException("aborted", "AbortError"); });
    const key = cancellation().toss_idempotency_key;
    toss.lookup = () => json(canceled());
    expect(await recheck({ cancellationId: id })).toMatchObject({ status: 200, body: { ok: true, status: "done", cancellationId: id } });
    expect(posts()).toHaveLength(0);
    expect(gets()).toHaveLength(1);
    expect(gets()[0].url).toBe(`https://api.tosspayments.com/v1/payments/${PKEY}`);
    expect(gets()[0].headers["Idempotency-Key"]).toBeUndefined();
    expect(h.cancellations).toHaveLength(1);
    expect(cancellation().toss_idempotency_key).toBe(key);
    expect(h.rpcLog.filter((f) => f === "payment_cancel_reserve")).toHaveLength(1);
  });
  it("timeout first, GET still DONE -> stays reconciliation_required (never failed)", async () => {
    const id = await seedRecon(() => { throw new DOMException("aborted", "AbortError"); });
    toss.lookup = () => json(payment());
    expect(await recheck({ cancellationId: id })).toMatchObject({ body: { status: "reconciliation_required" } });
    expect(posts()).toHaveLength(0);
  });
  it("definite rejection recorded + GET verified DONE / no cancel -> failed", async () => {
    const id = await seedRecon(() => tossError(403, "API_KEY_ACCESS_DENIED"));
    toss.lookup = () => json(payment());
    expect(await recheck({ cancellationId: id })).toMatchObject({ body: { status: "failed", message: "환불 요청이 승인되지 않았습니다." } });
    expect(posts()).toHaveLength(0);
  });
  it("pending younger than 5 minutes -> 409 in_flight, no Toss call; older -> looked up", async () => {
    h.cancellations.push({ id: "c0000000-0000-4000-8000-0000000000aa", order_id: ORDER, payment_key: PKEY, amount: PRICE, status: "pending",
      initial_post_outcome: null, requested_at: new Date().toISOString() });
    expect(await recheck({ cancellationId: "c0000000-0000-4000-8000-0000000000aa" })).toMatchObject({ status: 409, body: { error: "refund_recheck:in_flight" } });
    expect(fetchStub).not.toHaveBeenCalled();
    h.cancellations[0].requested_at = new Date(Date.now() - 6 * 60_000).toISOString();
    expect(await recheck({ cancellationId: "c0000000-0000-4000-8000-0000000000aa" })).toMatchObject({ status: 200, body: { status: "done" } });
    expect(posts()).toHaveLength(0);
  });
  it("unknown id -> 404; malformed id / body -> 400; done row -> answered without a Toss call", async () => {
    expect(await recheck({ cancellationId: "c0000000-0000-4000-8000-00000000dead" })).toMatchObject({ status: 404, body: { error: "refund_recheck:not_found" } });
    for (const cancellationId of [undefined, "", "not-a-uuid", 1, "c0000000-0000-4000-8000-000000000001'--"]) {
      expect((await recheck({ cancellationId })).status, String(cancellationId)).toBe(400);
    }
    expect((await recheck("{bad")).status).toBe(400);
    await refund({ orderId: ORDER, reason: "r" });
    calls.length = 0;
    expect(await recheck({ cancellationId: cancellation().id })).toMatchObject({ body: { status: "done" } });
    expect(calls).toHaveLength(0);
  });
});

describe("no secrets in responses or logs", () => {
  it("secret key / paymentKey / Idempotency-Key / raw Toss message never appear", async () => {
    const bodies: unknown[] = [];
    for (const [cancel, lookup] of [
      [() => json(canceled()), () => json(canceled())],
      [() => tossError(403, "API_KEY_ACCESS_DENIED"), () => json(payment())],
      [() => { throw new TypeError("fetch failed"); }, () => tossError(500, "X")],
    ] as [() => Response, () => Response][]) {
      h.cancellations = []; h.orders[0].refunded_at = null;
      toss.cancel = cancel; toss.lookup = lookup;
      bodies.push((await refund({ orderId: ORDER, reason: "r" })).body);
    }
    bodies.push((await recheck({ cancellationId: cancellation().id })).body);
    bodies.push((await list()).body);
    for (const b of bodies) noLeak(b);
    const logged = JSON.stringify([...vi.mocked(console.warn).mock.calls, ...vi.mocked(console.error).mock.calls]);
    for (const l of [SECRET, PKEY, "cancel-key-", "ps_SECRET_MUST_NOT_LEAK"]) expect(logged, l).not.toContain(l);
  });
});
