// app/lib/tossClient.ts and app/lib/tossEnv.ts in isolation: the HTTP
// shape of confirm / lookup (with a REAL abort on timeout), how every Toss
// answer is classified, what is stored / returned, and the key-environment
// matrix. No network: fetch is stubbed.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AMBIGUOUS_CONFIRM_CODES, CONFIG_ERROR_CODES, DECLINE_CODES, classifyConfirm, classifyLookup, confirmTossPayment,
  getTossPayment, maskPaymentKey, paymentSummary, storedTossPayment, TOSS_CONFIRM_TIMEOUT_MS, TOSS_LOOKUP_TIMEOUT_MS,
  type TossCallResult, type TossPayment,
} from "../app/lib/tossClient";
import { checkTossClientKey, resolveTossServerConfig, tossKeyMode } from "../app/lib/tossEnv";

const K = {
  testClient: ["test", "ck", "UNITTESTONLYclient0001"].join("_"),
  testSecret: ["test", "sk", "UNITTESTONLYsecret0001"].join("_"),
  liveClient: ["live", "ck", "UNITTESTONLYclient0002"].join("_"),
  liveSecret: ["live", "sk", "UNITTESTONLYsecret0002"].join("_"),
  widgetClient: ["test", "gck", "UNITTESTONLYwidget0003"].join("_"),
  widgetSecret: ["test", "gsk", "UNITTESTONLYwidget0003"].join("_"),
};
const EXP = { paymentKey: "pk_1234567890", orderId: "DTB-1", amount: 412000 };
const payment = (extra: Record<string, unknown> = {}): TossPayment => {
  const raw = { paymentKey: EXP.paymentKey, orderId: EXP.orderId, status: "DONE", totalAmount: EXP.amount, currency: "KRW", method: "카드", approvedAt: "t", orderName: "n", ...extra };
  return { ...(raw as unknown as TossPayment), raw };
};
const ok = (extra: Record<string, unknown> = {}): TossCallResult => ({ kind: "payment", httpStatus: 200, payment: payment(extra) });
const err = (httpStatus: number, code: string): TossCallResult => ({ kind: "error", httpStatus, code, message: "m" });

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("HTTP shape", () => {
  it("confirm: POST /v1/payments/confirm, Basic auth, JSON body, Idempotency-Key", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(payment().raw), { status: 200 }));
    vi.stubGlobal("fetch", f);
    const r = await confirmTossPayment({ secretKey: K.testSecret, ...EXP, idempotencyKey: "confirm-abc" });
    expect(r).toMatchObject({ kind: "payment", httpStatus: 200 });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.tosspayments.com/v1/payments/confirm");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      Authorization: `Basic ${Buffer.from(`${K.testSecret}:`).toString("base64")}`,
      "Content-Type": "application/json",
      "Idempotency-Key": "confirm-abc",
    });
    expect(JSON.parse(init.body as string)).toEqual(EXP);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("lookup: GET /v1/payments/{encoded key}, no body, no Idempotency-Key", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(payment().raw), { status: 200 }));
    vi.stubGlobal("fetch", f);
    await getTossPayment({ secretKey: K.testSecret, paymentKey: "a/b c" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.tosspayments.com/v1/payments/a%2Fb%20c");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(Object.keys(init.headers as object)).toEqual(["Authorization"]);
  });

  it("7. a real timeout aborts the request -> unknown/timeout (not an error, not failed)", async () => {
    const f = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_res, rej) => {
      init.signal!.addEventListener("abort", () => rej(new DOMException("This operation was aborted", "AbortError")));
    }));
    vi.stubGlobal("fetch", f);
    const started = Date.now();
    expect(await confirmTossPayment({ secretKey: K.testSecret, ...EXP, idempotencyKey: "k", timeoutMs: 30 })).toEqual({ kind: "unknown", reason: "timeout", httpStatus: null });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(await getTossPayment({ secretKey: K.testSecret, paymentKey: "k", timeoutMs: 30 })).toEqual({ kind: "unknown", reason: "timeout", httpStatus: null });
  });

  it("a body that stalls past the timeout is a timeout too", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => ({
      ok: true, status: 200,
      text: () => new Promise<string>((_r, rej) => init.signal!.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))),
    }) as unknown as Response));
    expect(await confirmTossPayment({ secretKey: K.testSecret, ...EXP, idempotencyKey: "k", timeoutMs: 30 })).toMatchObject({ kind: "unknown", reason: "timeout" });
  });

  it("network failure / unreadable body / non-Payment 2xx / error body without code", async () => {
    const cases: [() => Promise<Response>, unknown][] = [
      [async () => { throw new TypeError("fetch failed"); }, { kind: "unknown", reason: "network", httpStatus: null }],
      [async () => new Response("<html>", { status: 200 }), { kind: "unknown", reason: "unreadable_body", httpStatus: 200 }],
      [async () => new Response("", { status: 502 }), { kind: "unknown", reason: "unreadable_body", httpStatus: 502 }],
      [async () => new Response(JSON.stringify({ hello: 1 }), { status: 200 }), { kind: "unknown", reason: "unexpected_body", httpStatus: 200 }],
      [async () => new Response(JSON.stringify({ message: "x" }), { status: 500 }), { kind: "unknown", reason: "unexpected_body", httpStatus: 500 }],
      [async () => new Response(JSON.stringify({ code: "X", message: "m" }), { status: 400 }), { kind: "error", httpStatus: 400, code: "X", message: "m" }],
    ];
    for (const [impl, expected] of cases) {
      vi.stubGlobal("fetch", vi.fn(impl));
      expect(await confirmTossPayment({ secretKey: K.testSecret, ...EXP, idempotencyKey: "k" })).toEqual(expected);
    }
  });

  it("timeouts: confirm 30 s, lookup 10 s, together well under the route's maxDuration (60 s)", async () => {
    expect(TOSS_CONFIRM_TIMEOUT_MS).toBe(30_000);
    expect(TOSS_LOOKUP_TIMEOUT_MS).toBe(10_000);
    const src = readFileSync(join(__dirname, "..", "app", "api", "payment", "confirm", "route.ts"), "utf8");
    const max = Number(/export const maxDuration = (\d+);/.exec(src)?.[1]);
    expect(max).toBe(60);
    expect(TOSS_CONFIRM_TIMEOUT_MS + TOSS_LOOKUP_TIMEOUT_MS).toBeLessThanOrEqual((max - 15) * 1000);
  });
});

describe("classifyConfirm", () => {
  it("A. only DONE + full identity match + an allowed method is done", () => {
    expect(classifyConfirm(ok(), EXP).verdict).toBe("done");
    expect(classifyConfirm(ok({ method: "간편결제" }), EXP).verdict).toBe("done");
    for (const extra of [{ totalAmount: 1 }, { orderId: "x" }, { paymentKey: "y" }, { currency: "USD" }, { method: "가상계좌" }, { method: null }]) {
      expect(classifyConfirm(ok(extra), EXP).verdict).toBe("review");
    }
    for (const status of ["READY", "IN_PROGRESS", "WAITING_FOR_DEPOSIT", "ABORTED", "EXPIRED", "CANCELED", "X"]) {
      expect(classifyConfirm(ok({ status }), EXP)).toMatchObject({ verdict: "review", detail: `confirm_status:${status}` });
    }
  });
  it("B. ambiguous: every unknown outcome, 5xx / 408 / 429 whatever the code, the ambiguous list, any unlisted code", () => {
    for (const reason of ["network", "timeout", "unreadable_body", "unexpected_body"] as const) {
      expect(classifyConfirm({ kind: "unknown", reason, httpStatus: null }, EXP).verdict).toBe("ambiguous");
    }
    for (const s of [500, 502, 503, 504, 408, 429]) expect(classifyConfirm(err(s, "REJECT_CARD_PAYMENT"), EXP).verdict).toBe("ambiguous");
    for (const code of AMBIGUOUS_CONFIRM_CODES) expect(classifyConfirm(err(400, code), EXP).verdict).toBe("ambiguous");
    expect(classifyConfirm(err(400, "NEVER_SEEN_BEFORE"), EXP).verdict).toBe("ambiguous");
    expect(classifyConfirm(err(404, "NOT_FOUND_PAYMENT_SESSION"), EXP).verdict).toBe("ambiguous");
  });
  it("C. definitive failure: the decline / config allowlists with a 4xx only", () => {
    for (const code of DECLINE_CODES) expect(classifyConfirm(err(403, code), EXP)).toMatchObject({ verdict: "not_approved", userCode: "PAYMENT_DECLINED" });
    for (const code of CONFIG_ERROR_CODES) expect(classifyConfirm(err(401, code), EXP)).toMatchObject({ verdict: "not_approved", userCode: "PAYMENT_CONFIG_ERROR" });
  });
  it("the allowlists and the ambiguous list don't overlap", () => {
    for (const c of AMBIGUOUS_CONFIRM_CODES) {
      expect(DECLINE_CODES.has(c)).toBe(false);
      expect(CONFIG_ERROR_CODES.has(c)).toBe(false);
    }
    for (const c of DECLINE_CODES) expect(CONFIG_ERROR_CODES.has(c)).toBe(false);
  });
});

describe("classifyLookup (D)", () => {
  it("DONE -> done; ABORTED -> declined; EXPIRED -> auth expired; all only with a matching identity", () => {
    expect(classifyLookup(ok(), EXP).verdict).toBe("done");
    expect(classifyLookup(ok({ status: "ABORTED" }), EXP)).toMatchObject({ verdict: "not_approved", userCode: "PAYMENT_DECLINED" });
    expect(classifyLookup(ok({ status: "EXPIRED" }), EXP)).toMatchObject({ verdict: "not_approved", userCode: "PAYMENT_AUTH_EXPIRED" });
    expect(classifyLookup(ok({ status: "ABORTED", orderId: "other" }), EXP).verdict).toBe("review");
    expect(classifyLookup(ok({ status: "EXPIRED", totalAmount: 2 }), EXP).verdict).toBe("review");
  });
  it("everything else is review: READY / IN_PROGRESS / CANCELED / unknown status, 404, any error, any unknown", () => {
    for (const status of ["READY", "IN_PROGRESS", "CANCELED", "PARTIAL_CANCELED", "WAITING_FOR_DEPOSIT", "NEW"]) {
      expect(classifyLookup(ok({ status }), EXP).verdict).toBe("review");
    }
    for (const r of [err(404, "NOT_FOUND_PAYMENT"), err(404, "NOT_FOUND"), err(403, "FORBIDDEN_CONSECUTIVE_REQUEST"), err(500, "X"),
                     { kind: "unknown", reason: "timeout", httpStatus: null } as TossCallResult]) {
      expect(classifyLookup(r, EXP).verdict).toBe("review");
    }
  });
});

describe("stored / returned shapes", () => {
  const full = payment({
    secret: "ps_SECRET", card: { number: "4330****", approveNo: "1" }, checkout: { url: "c" }, receipt: { url: "r" },
    easyPay: { provider: "토스페이" }, balanceAmount: 412000, lastTransactionKey: "tx", type: "NORMAL", requestedAt: "q",
    customerEmail: "a@b.c", customerMobilePhone: "010", virtualAccount: { accountNumber: "1" },
  });
  it("storedTossPayment keeps only operational fields", () => {
    const s = storedTossPayment(full);
    expect(Object.keys(s).sort()).toEqual(["approvedAt", "balanceAmount", "currency", "easyPayProvider", "lastTransactionKey", "method", "orderId", "orderName", "requestedAt", "status", "totalAmount", "type"]);
    expect(JSON.stringify(s)).not.toMatch(/SECRET|4330|approveNo|checkout|receipt|a@b\.c|accountNumber/);
  });
  it("paymentSummary is the 5-field whitelist, from either stored shape", () => {
    for (const src of [full.raw, storedTossPayment(full)]) {
      expect(paymentSummary(src, { orderId: "DTB-1", amount: 1 })).toEqual({ orderId: "DTB-1", totalAmount: 412000, method: "카드", approvedAt: "t", orderName: "n" });
    }
    expect(paymentSummary(null, { orderId: "DTB-1", amount: 5, orderName: "상품" })).toEqual({ orderId: "DTB-1", totalAmount: 5, method: null, approvedAt: null, orderName: "상품" });
  });
  it("maskPaymentKey", () => {
    expect(maskPaymentKey("pk_test_123456789")).toBe("pk_tes...6789");
    expect(maskPaymentKey("short")).toBe("***");
  });
});

describe("key environment (tossEnv)", () => {
  const env = (vercel: string | undefined, client?: string, secret?: string) =>
    resolveTossServerConfig({ VERCEL_ENV: vercel, NEXT_PUBLIC_TOSS_CLIENT_KEY: client, TOSS_SECRET_KEY: secret });
  it("36-41. the VERCEL_ENV x key matrix", () => {
    expect(env("production", K.liveClient, K.liveSecret)).toEqual({ ok: true, secretKey: K.liveSecret, mode: "live" });
    expect(env("production", K.testClient, K.testSecret)).toMatchObject({ ok: false, reason: "wrong_mode_for_environment" });
    expect(env("production", K.liveClient, K.testSecret)).toMatchObject({ ok: false, reason: "key_mode_mismatch" });
    expect(env("production", K.testClient, K.liveSecret)).toMatchObject({ ok: false, reason: "key_mode_mismatch" });
    expect(env("preview", K.testClient, K.testSecret)).toEqual({ ok: true, secretKey: K.testSecret, mode: "test" });
    expect(env("preview", K.liveClient, K.liveSecret)).toMatchObject({ ok: false, reason: "wrong_mode_for_environment" });
    expect(env("preview", K.testClient, K.liveSecret)).toMatchObject({ ok: false, reason: "key_mode_mismatch" });
    expect(env("development", K.liveClient, K.liveSecret)).toMatchObject({ ok: false, reason: "wrong_mode_for_environment" });
    expect(env(undefined, K.testClient, K.testSecret)).toMatchObject({ ok: true, mode: "test" });
    expect(env(undefined, K.liveClient, K.liveSecret)).toMatchObject({ ok: false, reason: "wrong_mode_for_environment" });
  });
  it("42. missing / malformed / swapped-role / widget keys fail closed", () => {
    expect(env(undefined)).toMatchObject({ ok: false, reason: "missing_client_key" });
    expect(env(undefined, K.testClient)).toMatchObject({ ok: false, reason: "missing_secret_key" });
    expect(env(undefined, K.testSecret, K.testClient)).toMatchObject({ ok: false, reason: "malformed_client_key" });
    expect(env(undefined, K.widgetClient, K.testSecret)).toMatchObject({ ok: false, reason: "malformed_client_key" });
    expect(env(undefined, K.testClient, K.widgetSecret)).toMatchObject({ ok: false, reason: "malformed_secret_key" });
    expect(env(undefined, "test_ck_", K.testSecret)).toMatchObject({ ok: false, reason: "malformed_client_key" });
    expect(env("production", K.liveClient, `${K.liveSecret} `)).toMatchObject({ ok: false, reason: "malformed_secret_key" });
  });
  it("a refusal never carries a key", () => {
    const r = env("production", K.testClient, K.testSecret);
    expect(JSON.stringify(r)).not.toContain("UNITTESTONLY");
  });
  it("client key check (payment page)", () => {
    expect(checkTossClientKey(undefined, undefined)).toEqual({ ok: false, reason: "missing_client_key" });
    expect(checkTossClientKey(K.testSecret, undefined)).toEqual({ ok: false, reason: "malformed_client_key" });
    expect(checkTossClientKey(K.testClient, undefined)).toMatchObject({ ok: true, mode: "test" });
    expect(checkTossClientKey(K.liveClient, undefined)).toMatchObject({ ok: true, mode: "live" }); // env unknown: the server decides
    expect(checkTossClientKey(K.liveClient, "preview")).toEqual({ ok: false, reason: "wrong_mode_for_environment" });
    expect(checkTossClientKey(K.testClient, "production")).toEqual({ ok: false, reason: "wrong_mode_for_environment" });
    expect(checkTossClientKey(K.liveClient, "production")).toMatchObject({ ok: true });
  });
  it("tossKeyMode", () => {
    expect(tossKeyMode(K.liveSecret, "secret")).toBe("live");
    expect(tossKeyMode(K.liveSecret, "client")).toBeNull();
    expect(tossKeyMode(null, "client")).toBeNull();
  });
});

describe("43. no hardcoded Toss key anywhere in app/", () => {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|mjs)$/.test(f)) files.push(p);
    }
  };
  walk(join(__dirname, "..", "app"));
  it("no (test|live)_(ck|sk|gck|gsk)_<body> literal, and no fallback (`?? \"test_`)", () => {
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/\b(test|live)_(g?ck|g?sk)_[A-Za-z0-9]{6,}/);
      expect(src, f).not.toMatch(/\?\?\s*["'`](test|live)_/);
    }
  });
  it("the payment page and the confirm route take keys only through tossEnv", () => {
    const page = readFileSync(join(__dirname, "..", "app", "payment", "page.tsx"), "utf8");
    const route = readFileSync(join(__dirname, "..", "app", "api", "payment", "confirm", "route.ts"), "utf8");
    expect(page).toMatch(/checkTossClientKey\(process\.env\.NEXT_PUBLIC_TOSS_CLIENT_KEY, process\.env\.NEXT_PUBLIC_VERCEL_ENV\)/);
    expect(route).toMatch(/resolveTossServerConfig\(\)/);
    expect(route).not.toMatch(/process\.env\.TOSS_SECRET_KEY/);
  });
});
