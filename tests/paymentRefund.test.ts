// M4-B1 refund engine (app/lib/paymentRefund.ts) + the Toss cancel client
// (app/lib/tossClient.ts). Supabase and Toss are faked in memory; the three
// refund RPCs are mirrored here (tests/paymentCancellationsM4B.test.ts runs
// the real SQL).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeRefund, recheckRefund, reserveRefund, STALE_PENDING_MS, type ReservedRefund } from "../app/lib/paymentRefund";
import { cancelPostOutcome, classifyCancelLookup, classifyCancelPost, verifyFullCancel, parseTossPayment, type TossPayment } from "../app/lib/tossClient";
import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;
const SECRET = ["test", "sk", "UNITTESTONLYsecret0003"].join("_");
const PKEY = "pk_test_refund_payment_0001";
const ORDER = "DTB-REFUND-1";
const PRICE = 412_000;
const KEY = "cancel-33333333-4444-4555-8666-777777777777";
const CID = "c0000000-0000-4000-8000-000000000001";
const CANCELED_AT = "2026-11-04T15:30:00+09:00";

// ── fake service-role client (mirrors the RPC semantics) ───────────────────
const db = { rows: new Map<string, Row>(), rpcLog: [] as string[], selects: [] as string[], finalizeError: null as Row | null, reserveError: null as Row | null, recordError: null as Row | null };
const admin = {
  rpc: async (fn: string, a: Row) => {
    db.rpcLog.push(fn);
    if (fn === "payment_cancel_reserve") {
      if (db.reserveError) return { data: null, error: db.reserveError };
      const row: Row = { id: CID, order_id: a.p_order_id, payment_key: PKEY, amount: PRICE, reason: String(a.p_reason).trim(),
        toss_idempotency_key: KEY, status: "pending", toss_status: null, error_detail: null, initial_post_outcome: null,
        initial_post_http_status: null, initial_post_error_code: null, requested_at: new Date().toISOString() };
      db.rows.set(CID, row);
      return { data: { cancellation_id: CID, order_id: row.order_id, payment_key: PKEY, amount: PRICE, reason: row.reason, toss_idempotency_key: KEY }, error: null };
    }
    const row = db.rows.get(a.p_id as string);
    if (fn === "payment_cancel_record_post") {
      if (db.recordError) return { data: null, error: db.recordError };
      if (!row || row.status !== "pending" || row.initial_post_outcome != null) return { data: false, error: null };
      Object.assign(row, { initial_post_outcome: a.p_outcome, initial_post_http_status: a.p_http_status, initial_post_error_code: a.p_error_code });
      return { data: true, error: null };
    }
    if (fn === "payment_cancel_mark") {
      if (!row || row.status !== a.p_from) return { data: false, error: null };
      if (a.p_status === "failed" && row.initial_post_outcome !== "definite_rejection") {
        return { data: null, error: { code: "P0001", message: "cancel_mark:failed_needs_definite_rejection" } };
      }
      if (a.p_status === "failed" && (a.p_toss_status !== "DONE" || row.toss_status === "CANCELED")) {
        return { data: null, error: { code: "P0001", message: "cancel_mark:failed_needs_uncanceled_payment" } };
      }
      Object.assign(row, { status: a.p_status, toss_status: a.p_toss_status ?? row.toss_status, toss_response: a.p_toss_response ?? row.toss_response,
        error_detail: a.p_error_detail, last_checked_at: "now" });
      return { data: true, error: null };
    }
    if (fn === "payment_cancel_finalize") {
      if (db.finalizeError) return { data: null, error: db.finalizeError };
      if (!row) return { data: null, error: { code: "P0001", message: "cancel_finalize:no_cancellation" } };
      if (row.status === "done") return { data: "already_done", error: null };
      if (row.status !== "pending" && row.status !== "reconciliation_required") return { data: null, error: { code: "P0001", message: `cancel_finalize:status_${row.status}` } };
      Object.assign(row, { status: "done", toss_status: a.p_toss_status, toss_transaction_key: a.p_transaction_key, canceled_at: a.p_canceled_at,
        toss_response: a.p_toss_response, error_detail: null, last_checked_at: "now" });
      return { data: "done", error: null };
    }
    throw new Error(`unexpected rpc ${fn}`);
  },
  from: (table: string) => {
    if (table !== "payment_cancellations") throw new Error(`unexpected table ${table}`);
    let id: unknown;
    const q = {
      select: (cols: string) => { db.selects.push(cols); return q; },
      eq: (_c: string, v: unknown) => { id = v; return q; },
      maybeSingle: async () => ({ data: db.rows.get(id as string) ? { ...db.rows.get(id as string) } : null, error: null }),
    };
    return q;
  },
} as unknown as SupabaseClient;

// ── fake Toss ───────────────────────────────────────────────────────────────
type Call = { method: string; url: string; headers: Record<string, string>; body: Row | null };
const calls: Call[] = [];
const toss = { cancel: null as null | (() => Response | Promise<Response>), lookup: null as null | (() => Response | Promise<Response>) };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const tossError = (status: number, code: string) => json({ code, message: `RAW ${code}` }, status);
const payment = (extra: Row = {}): Row => ({
  paymentKey: PKEY, orderId: ORDER, status: "DONE", method: "카드", totalAmount: PRICE, balanceAmount: PRICE, currency: "KRW",
  approvedAt: "2026-11-04T15:00:00+09:00", secret: "ps_SECRET_MUST_NOT_LEAK", card: { number: "4330****" }, cancels: null, ...extra,
});
const canceled = (extra: Row = {}, cancel: Row = {}): Row => payment({
  status: "CANCELED", balanceAmount: 0,
  cancels: [{ cancelAmount: PRICE, cancelReason: "고객 요청", canceledAt: CANCELED_AT, transactionKey: "tx_cancel_1", cancelStatus: "DONE", ...cancel }],
  ...extra,
});
const fetchStub = vi.fn(async (url: string, init: RequestInit) => {
  const body = typeof init.body === "string" ? (JSON.parse(init.body) as Row) : null;
  calls.push({ method: init.method ?? "GET", url, headers: { ...(init.headers as Record<string, string>) }, body });
  if (url === `https://api.tosspayments.com/v1/payments/${PKEY}/cancel` && init.method === "POST") return (toss.cancel ?? (() => json(canceled())))();
  if (url === `https://api.tosspayments.com/v1/payments/${PKEY}` && (init.method ?? "GET") === "GET") return (toss.lookup ?? (() => json(canceled())))();
  throw new Error(`unexpected fetch ${url}`);
});
vi.stubGlobal("fetch", fetchStub);
const posts = () => calls.filter((c) => c.method === "POST");
const gets = () => calls.filter((c) => c.method === "GET");

const reserved = (): ReservedRefund => ({ cancellation_id: CID, order_id: ORDER, payment_key: PKEY, amount: PRICE, reason: "고객 요청", toss_idempotency_key: KEY });
const row = () => db.rows.get(CID)!;
const seed = (extra: Row = {}) => db.rows.set(CID, {
  id: CID, order_id: ORDER, payment_key: PKEY, amount: PRICE, reason: "고객 요청", toss_idempotency_key: KEY, status: "pending",
  toss_status: null, error_detail: null, initial_post_outcome: null, initial_post_http_status: null, initial_post_error_code: null,
  requested_at: new Date(Date.now() - 60_000).toISOString(), ...extra,
});

beforeEach(() => {
  db.rows.clear();
  db.rpcLog = [];
  db.finalizeError = null;
  db.reserveError = null;
  db.recordError = null;
  db.selects = [];
  calls.length = 0;
  toss.cancel = null;
  toss.lookup = null;
  fetchStub.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("cancelTossPayment request", () => {
  it("POST /v1/payments/{paymentKey}/cancel with the DB key as Idempotency-Key; body = cancelReason only (full amount)", async () => {
    seed();
    await executeRefund(admin, SECRET, reserved());
    expect(posts()).toHaveLength(1);
    const c = posts()[0];
    expect(c.url).toBe(`https://api.tosspayments.com/v1/payments/${PKEY}/cancel`);
    expect(c.body).toEqual({ cancelReason: "고객 요청" });
    expect(c.headers["Idempotency-Key"]).toBe(KEY);
    expect(c.headers.Authorization).toBe(`Basic ${Buffer.from(`${SECRET}:`).toString("base64")}`);
    expect(c.headers["Content-Type"]).toBe("application/json");
  });
  it("a timeout is reported as unknown (then looked up), never as a failure", async () => {
    seed();
    toss.cancel = () => { throw new DOMException("The operation was aborted.", "AbortError"); };
    toss.lookup = () => json(canceled());
    expect(await executeRefund(admin, SECRET, reserved())).toMatchObject({ ok: true, status: "done" });
    expect(row().error_detail).toBeNull();
  });
});

describe("verifyFullCancel", () => {
  const p = (b: Row) => parseTossPayment(b) as TossPayment;
  const exp = { paymentKey: PKEY, orderId: ORDER, amount: PRICE };
  it("done only with CANCELED + balance 0 + all cancels DONE summing to the total + one full DONE cancel with transactionKey / canceledAt", () => {
    expect(verifyFullCancel(p(canceled()), exp)).toMatchObject({ ok: true, cancel: { transactionKey: "tx_cancel_1", canceledAt: CANCELED_AT } });
    for (const [why, body] of [
      ["status:DONE", payment()],
      ["status:PARTIAL_CANCELED", canceled({ status: "PARTIAL_CANCELED" })],
      ["balance_not_zero", canceled({ balanceAmount: 1 })],
      ["no_cancels", canceled({ cancels: [] })],
      ["cancels_unreadable", canceled({ cancels: "x" })],
      ["cancel_status:IN_PROGRESS", canceled({}, { cancelStatus: "IN_PROGRESS" })],
      ["cancel_status:null", canceled({}, { cancelStatus: null })],
      ["cancel_sum_mismatch", canceled({}, { cancelAmount: PRICE - 1 })],
      ["no_full_cancel", canceled({}, { transactionKey: null })],
      ["no_full_cancel", canceled({}, { canceledAt: "not a date" })],
      ["no_full_cancel", canceled({ cancels: [
        { cancelAmount: PRICE / 2, cancelStatus: "DONE", transactionKey: "a", canceledAt: CANCELED_AT },
        { cancelAmount: PRICE / 2, cancelStatus: "DONE", transactionKey: "b", canceledAt: CANCELED_AT }] })],
    ] as [string, Row][]) {
      expect(verifyFullCancel(p(body), exp), why).toEqual({ ok: false, mismatch: false, reason: why });
    }
  });
  it("identity: paymentKey / orderId / totalAmount / currency must match (mismatch flagged)", () => {
    for (const [field, extra] of [["paymentKey", { paymentKey: "pk_other" }], ["orderId", { orderId: "DTB-OTHER" }], ["totalAmount", { totalAmount: PRICE + 1, balanceAmount: 0 }], ["currency", { currency: "USD" }]] as const) {
      expect(verifyFullCancel(p(canceled(extra)), exp)).toEqual({ ok: false, mismatch: true, reason: expect.stringContaining(field) });
    }
  });
});

describe("executeRefund", () => {
  it("verified cancel -> payment_cancel_finalize with Toss's transactionKey / canceledAt; no lookup; sanitized response stored", async () => {
    seed();
    expect(await executeRefund(admin, SECRET, reserved())).toEqual({ ok: true, status: "done", cancellationId: CID, detail: "done" });
    expect(gets()).toHaveLength(0);
    expect(row()).toMatchObject({ status: "done", toss_status: "CANCELED", toss_transaction_key: "tx_cancel_1", canceled_at: CANCELED_AT });
    const stored = JSON.stringify(row().toss_response);
    expect(stored).toContain("tx_cancel_1");
    for (const leak of ["ps_SECRET_MUST_NOT_LEAK", "4330", "card"]) expect(stored).not.toContain(leak);
  });
  it("2xx but not fully canceled (cancel IN_PROGRESS) -> lookup; lookup verified -> done", async () => {
    seed();
    toss.cancel = () => json(canceled({}, { cancelStatus: "IN_PROGRESS" }));
    toss.lookup = () => json(canceled());
    expect(await executeRefund(admin, SECRET, reserved())).toMatchObject({ status: "done" });
    expect(gets()).toHaveLength(1);
  });
  for (const code of ["ALREADY_CANCELED_PAYMENT", "ALREADY_REFUND_PAYMENT", "ALREADY_REFUNDING_PAYMENT"]) {
    it(`${code} -> lookup; verified CANCELED -> done`, async () => {
      seed();
      toss.cancel = () => tossError(400, code);
      toss.lookup = () => json(canceled());
      expect(await executeRefund(admin, SECRET, reserved())).toMatchObject({ status: "done" });
    });
    it(`${code} -> lookup still DONE -> reconciliation_required (never failed)`, async () => {
      seed();
      toss.cancel = () => tossError(400, code);
      toss.lookup = () => json(payment());
      expect(await executeRefund(admin, SECRET, reserved())).toMatchObject({ status: "reconciliation_required" });
      expect(row()).toMatchObject({ status: "reconciliation_required", initial_post_outcome: "http_ambiguous", initial_post_http_status: 400,
        initial_post_error_code: code, error_detail: `cancel_http_ambiguous_http_400:${code}|lookup_status:DONE_not_canceled` });
    });
  }
  for (const code of ["NOT_CANCELABLE_PAYMENT", "INVALID_REQUEST", "API_KEY_ACCESS_DENIED", "FORBIDDEN_REQUEST"]) {
    it(`definitive rejection ${code} + lookup DONE untouched -> failed`, async () => {
      seed();
      toss.cancel = () => tossError(403, code);
      toss.lookup = () => json(payment());
      expect(await executeRefund(admin, SECRET, reserved())).toMatchObject({ status: "failed" });
      expect(row()).toMatchObject({ status: "failed", toss_status: "DONE", initial_post_outcome: "definite_rejection", initial_post_http_status: 403,
        initial_post_error_code: code, error_detail: `cancel_definite_rejection_http_403:${code}|lookup_status:DONE_not_canceled` });
    });
  }
  it("definitive rejection but the lookup shows it CANCELED -> done; lookup fails -> reconciliation_required; lookup partially canceled -> reconciliation_required", async () => {
    for (const [lookup, status] of [
      [() => json(canceled()), "done"],
      [() => tossError(500, "FAILED_INTERNAL_SYSTEM_PROCESSING"), "reconciliation_required"],
      [() => json(canceled({ status: "PARTIAL_CANCELED", balanceAmount: 1000 }, { cancelAmount: PRICE - 1000 })), "reconciliation_required"],
      [() => json(payment({ balanceAmount: PRICE - 1 })), "reconciliation_required"],
    ] as [() => Response, string][]) {
      db.rows.clear(); seed(); calls.length = 0;
      toss.cancel = () => tossError(400, "NOT_CANCELABLE_PAYMENT");
      toss.lookup = lookup;
      expect((await executeRefund(admin, SECRET, reserved())), status).toMatchObject({ status });
    }
  });
  it("a rejection with a non-definitive status (408 / 429 / 5xx) is not a rejection", async () => {
    for (const status of [408, 429, 500]) {
      db.rows.clear(); seed();
      toss.cancel = () => tossError(status, "NOT_CANCELABLE_PAYMENT");
      toss.lookup = () => json(payment());
      expect(await executeRefund(admin, SECRET, reserved()), String(status)).toMatchObject({ status: "reconciliation_required" });
    }
  });
  for (const [name, cancel] of [
    ["timeout", () => { throw new DOMException("The operation was aborted.", "AbortError"); }],
    ["network", () => { throw new TypeError("fetch failed"); }],
    ["5xx", () => tossError(502, "BAD_GATEWAY")],
    ["unknown code", () => tossError(400, "BRAND_NEW_CODE")],
    ["unreadable body", () => new Response("<html>", { status: 200 })],
  ] as [string, () => Response][]) {
    it(`${name} + lookup unknown (timeout / 404) -> reconciliation_required`, async () => {
      for (const lookup of [() => { throw new DOMException("aborted", "AbortError"); }, () => tossError(404, "NOT_FOUND_PAYMENT")] as (() => Response)[]) {
        db.rows.clear(); seed(); calls.length = 0;
        toss.cancel = cancel;
        toss.lookup = lookup;
        expect(await executeRefund(admin, SECRET, reserved())).toMatchObject({ status: "reconciliation_required" });
        expect(posts()).toHaveLength(1);
        expect(gets()).toHaveLength(1);
      }
    });
  }
  it("POST 2xx for another payment / order / amount -> reconciliation_required WITHOUT a lookup (never done / failed)", async () => {
    for (const extra of [{ paymentKey: "pk_other" }, { orderId: "DTB-OTHER" }, { totalAmount: PRICE + 1 }, { currency: "USD" }]) {
      db.rows.clear(); seed(); calls.length = 0;
      toss.cancel = () => json(canceled(extra));
      expect(await executeRefund(admin, SECRET, reserved())).toMatchObject({ status: "reconciliation_required" });
      expect(gets()).toHaveLength(0);
      expect(row().error_detail).toMatch(/^cancel_identity_mismatch:/);
    }
  });
  it("lookup identity mismatch (even CANCELED or DONE-after-rejection) -> reconciliation_required", async () => {
    for (const lookup of [canceled({ orderId: "DTB-OTHER" }), payment({ totalAmount: PRICE + 1, balanceAmount: PRICE + 1 })]) {
      db.rows.clear(); seed();
      toss.cancel = () => tossError(400, "NOT_CANCELABLE_PAYMENT");
      toss.lookup = () => json(lookup);
      expect(await executeRefund(admin, SECRET, reserved())).toMatchObject({ status: "reconciliation_required" });
      expect(row().error_detail).toMatch(/lookup_identity_mismatch/);
    }
  });
  it("the first POST's outcome is recorded machine-readably (outcome / HTTP status / Toss code)", async () => {
    for (const [cancel, outcome, http, code] of [
      [() => json(canceled()), "verified_cancel", 200, null],
      [() => tossError(403, "API_KEY_ACCESS_DENIED"), "definite_rejection", 403, "API_KEY_ACCESS_DENIED"],
      [() => tossError(400, "ALREADY_CANCELED_PAYMENT"), "http_ambiguous", 400, "ALREADY_CANCELED_PAYMENT"],
      [() => tossError(500, "FAILED_INTERNAL_SYSTEM_PROCESSING"), "http_ambiguous", 500, "FAILED_INTERNAL_SYSTEM_PROCESSING"],
      [() => tossError(429, "NOT_CANCELABLE_PAYMENT"), "http_ambiguous", 429, "NOT_CANCELABLE_PAYMENT"],
      [() => new Response("<html>", { status: 502 }), "http_ambiguous", 502, null],
      [() => json(payment()), "http_ambiguous", 200, null],
      [() => { throw new DOMException("The operation was aborted.", "AbortError"); }, "timeout_unknown", null, null],
      [() => { throw new TypeError("fetch failed"); }, "network_unknown", null, null],
    ] as [() => Response, string, number | null, string | null][]) {
      db.rows.clear(); seed(); calls.length = 0;
      toss.cancel = cancel;
      toss.lookup = () => json(payment());
      await executeRefund(admin, SECRET, reserved());
      expect(row(), outcome).toMatchObject({ initial_post_outcome: outcome, initial_post_http_status: http, initial_post_error_code: code });
      expect(posts()).toHaveLength(1);
    }
  });
  it("outcome not recorded (record RPC error) + definitive rejection + lookup DONE -> reconciliation_required, never failed", async () => {
    seed();
    db.recordError = { code: "23514", message: "check constraint" };
    toss.cancel = () => tossError(403, "API_KEY_ACCESS_DENIED");
    toss.lookup = () => json(payment());
    expect(await executeRefund(admin, SECRET, reserved())).toMatchObject({ status: "reconciliation_required" });
    expect(row()).toMatchObject({ status: "reconciliation_required", initial_post_outcome: null });
    expect(db.rpcLog).not.toContain("payment_cancel_finalize");
  });
  it("Toss canceled but finalize fails -> reconciliation_required, never failed", async () => {
    seed();
    db.finalizeError = { code: "40001", message: "could not serialize access" };
    expect(await executeRefund(admin, SECRET, reserved())).toMatchObject({ status: "reconciliation_required", detail: "finalize_error" });
    expect(row()).toMatchObject({ status: "reconciliation_required", toss_status: "CANCELED", error_detail: "finalize_error:could not serialize access" });
  });
});

describe("recheckRefund (lookup only)", () => {
  it("reconciliation_required: ONE GET, no POST, no new key; verified -> done", async () => {
    seed({ status: "reconciliation_required", initial_post_outcome: "timeout_unknown", error_detail: "cancel_timeout|lookup_timeout" });
    expect(await recheckRefund(admin, SECRET, CID)).toMatchObject({ ok: true, status: "done" });
    expect(posts()).toHaveLength(0);
    expect(gets()).toHaveLength(1);
    expect(gets()[0].headers["Idempotency-Key"]).toBeUndefined();
    expect(row().toss_idempotency_key).toBe(KEY);
  });
  it("still DONE after a timeout -> stays reconciliation_required (the original POST was no rejection)", async () => {
    for (const outcome of ["timeout_unknown", "network_unknown", "http_ambiguous", "verified_cancel", null]) {
      seed({ status: "reconciliation_required", initial_post_outcome: outcome, error_detail: "cancel_timeout|lookup_timeout" });
      toss.lookup = () => json(payment());
      expect(await recheckRefund(admin, SECRET, CID), String(outcome)).toMatchObject({ status: "reconciliation_required" });
      expect(row().error_detail).toBe(`recheck:${outcome ?? "no_post_outcome"}|lookup_status:DONE_not_canceled`);
    }
  });
  it("still DONE after a definitive rejection (e.g. API_KEY_ACCESS_DENIED) -> failed; the rejection survives repeated re-checks", async () => {
    seed({ status: "reconciliation_required", initial_post_outcome: "definite_rejection", initial_post_http_status: 403,
      initial_post_error_code: "API_KEY_ACCESS_DENIED", error_detail: "free text" });
    toss.lookup = () => tossError(403, "API_KEY_ACCESS_DENIED");
    expect(await recheckRefund(admin, SECRET, CID)).toMatchObject({ status: "reconciliation_required" });
    expect(row().error_detail).toBe("recheck:definite_rejection|lookup_http_403:API_KEY_ACCESS_DENIED");
    toss.lookup = () => json(payment());
    expect(await recheckRefund(admin, SECRET, CID)).toMatchObject({ status: "failed" });
    expect(posts()).toHaveLength(0);
  });
  it("error_detail is never parsed: rejection-looking text without the column stays reconciliation_required; the column alone decides", async () => {
    seed({ status: "reconciliation_required", initial_post_outcome: "timeout_unknown", error_detail: "cancel_rejected_http_403:API_KEY_ACCESS_DENIED|x" });
    toss.lookup = () => json(payment());
    expect(await recheckRefund(admin, SECRET, CID)).toMatchObject({ status: "reconciliation_required" });
    seed({ status: "reconciliation_required", initial_post_outcome: "definite_rejection", initial_post_http_status: 400,
      initial_post_error_code: "NOT_CANCELABLE_PAYMENT", error_detail: null });
    expect(await recheckRefund(admin, SECRET, CID)).toMatchObject({ status: "failed" });
    expect(db.selects.length).toBeGreaterThan(0);
    for (const cols of db.selects) {
      expect(cols).not.toContain("error_detail");
      expect(cols).toContain("initial_post_outcome");
    }
    expect(posts()).toHaveLength(0);
  });
  it("identity mismatch on re-check -> stays reconciliation_required", async () => {
    seed({ status: "reconciliation_required", initial_post_outcome: "definite_rejection", initial_post_http_status: 400, initial_post_error_code: "NOT_CANCELABLE_PAYMENT" });
    toss.lookup = () => json(payment({ orderId: "DTB-OTHER" }));
    expect(await recheckRefund(admin, SECRET, CID)).toMatchObject({ status: "reconciliation_required" });
  });
  it("done / failed rows: no Toss call; a fresh pending row is in flight (no call); a stale pending row is looked up", async () => {
    for (const status of ["done", "failed"]) {
      seed({ status });
      expect(await recheckRefund(admin, SECRET, CID)).toMatchObject({ ok: true, status, detail: "already_settled" });
    }
    seed({ status: "pending", requested_at: new Date().toISOString() });
    expect(await recheckRefund(admin, SECRET, CID)).toEqual({ ok: false, code: "refund_recheck:in_flight" });
    expect(fetchStub).not.toHaveBeenCalled();
    seed({ status: "pending", requested_at: new Date(Date.now() - STALE_PENDING_MS - 1000).toISOString() });
    expect(await recheckRefund(admin, SECRET, CID)).toMatchObject({ status: "done" });
    expect(posts()).toHaveLength(0);
    expect(await recheckRefund(admin, SECRET, "c0000000-0000-4000-8000-00000000dead")).toEqual({ ok: false, code: "refund_recheck:not_found" });
  });
});

describe("reserveRefund", () => {
  it("passes only order id / reason / session; returns the DB's row (key from the DB)", async () => {
    expect(await reserveRefund(admin, { orderId: ORDER, reason: " 고객 요청 ", sessionId: "s1" })).toEqual({ ok: true, reserved: reserved() });
  });
  it("stable refusals pass through; a 23505 from the one-active index is in_progress", async () => {
    db.reserveError = { code: "P0001", message: "cancel_reserve:already_refunded" };
    expect(await reserveRefund(admin, { orderId: ORDER, reason: "x", sessionId: "s1" })).toEqual({ ok: false, code: "cancel_reserve:already_refunded" });
    db.reserveError = { code: "23505", message: 'duplicate key value violates unique constraint "payment_cancellations_one_active_per_order"' };
    expect(await reserveRefund(admin, { orderId: ORDER, reason: "x", sessionId: "s1" })).toEqual({ ok: false, code: "cancel_reserve:in_progress" });
  });
});

describe("classifiers (pure)", () => {
  const exp = { paymentKey: PKEY, orderId: ORDER, amount: PRICE };
  it("classifyCancelPost / cancelPostOutcome: definite_rejection only for a definitive 4xx with a listed code; no answer = timeout / network", () => {
    expect(classifyCancelPost({ kind: "error", httpStatus: 400, code: "NOT_CANCELABLE_PAYMENT", message: null }, exp))
      .toMatchObject({ verdict: "lookup", post: { outcome: "definite_rejection", httpStatus: 400, errorCode: "NOT_CANCELABLE_PAYMENT" } });
    expect(classifyCancelPost({ kind: "error", httpStatus: 400, code: "ALREADY_CANCELED_PAYMENT", message: null }, exp))
      .toMatchObject({ verdict: "lookup", post: { outcome: "http_ambiguous", httpStatus: 400, errorCode: "ALREADY_CANCELED_PAYMENT" } });
    expect(classifyCancelPost({ kind: "unknown", reason: "timeout", httpStatus: null }, exp))
      .toMatchObject({ verdict: "lookup", detail: "cancel_timeout", post: { outcome: "timeout_unknown", httpStatus: null, errorCode: null } });
    expect(cancelPostOutcome({ kind: "unknown", reason: "network", httpStatus: null }, exp)).toEqual({ outcome: "network_unknown", httpStatus: null, errorCode: null });
    // A status line arrived but the body timed out: an HTTP answer, not "no answer".
    expect(cancelPostOutcome({ kind: "unknown", reason: "timeout", httpStatus: 200 }, exp)).toEqual({ outcome: "http_ambiguous", httpStatus: 200, errorCode: null });
    expect(cancelPostOutcome({ kind: "unknown", reason: "unexpected_body", httpStatus: 503 }, exp)).toEqual({ outcome: "http_ambiguous", httpStatus: 503, errorCode: null });
    for (const status of [408, 429, 500, 503]) {
      expect(cancelPostOutcome({ kind: "error", httpStatus: status, code: "NOT_CANCELABLE_PAYMENT", message: null }, exp).outcome, String(status)).toBe("http_ambiguous");
    }
    const p = parseTossPayment(canceled())!;
    expect(cancelPostOutcome({ kind: "payment", httpStatus: 200, payment: p }, exp)).toEqual({ outcome: "verified_cancel", httpStatus: 200, errorCode: null });
    expect(cancelPostOutcome({ kind: "payment", httpStatus: 200, payment: parseTossPayment(payment())! }, exp).outcome).toBe("http_ambiguous");
  });
  it("classifyCancelLookup: failed requires the rejection AND an untouched DONE payment", () => {
    const done = { kind: "payment", httpStatus: 200, payment: parseTossPayment(payment())! } as const;
    expect(classifyCancelLookup(done, exp, "definite_rejection")).toMatchObject({ verdict: "failed" });
    for (const o of ["timeout_unknown", "network_unknown", "http_ambiguous", "verified_cancel", null] as const) {
      expect(classifyCancelLookup(done, exp, o), String(o)).toMatchObject({ verdict: "review" });
    }
    const touched = { kind: "payment", httpStatus: 200, payment: parseTossPayment(payment({ cancels: [{ cancelAmount: 1, cancelStatus: "DONE" }] }))! } as const;
    expect(classifyCancelLookup(touched, exp, "definite_rejection")).toMatchObject({ verdict: "review" });
  });
});

describe("logs", () => {
  it("never carry the secret key, the full paymentKey, the Idempotency-Key or Toss's raw message", async () => {
    for (const [cancel, lookup] of [
      [() => tossError(403, "API_KEY_ACCESS_DENIED"), () => { throw new TypeError("fetch failed"); }],
      [() => { throw new TypeError("fetch failed"); }, () => json(payment())],
    ] as [() => Response, () => Response][]) {
      db.rows.clear(); seed();
      toss.cancel = cancel;
      toss.lookup = lookup;
      await executeRefund(admin, SECRET, reserved());
    }
    seed({ status: "reconciliation_required", initial_post_outcome: "timeout_unknown", error_detail: "cancel_timeout" });
    await recheckRefund(admin, SECRET, CID);
    const logged = JSON.stringify([...vi.mocked(console.warn).mock.calls, ...vi.mocked(console.error).mock.calls]);
    for (const leak of [SECRET, PKEY, KEY, "ps_SECRET_MUST_NOT_LEAK"]) expect(logged).not.toContain(leak);
  });
});
