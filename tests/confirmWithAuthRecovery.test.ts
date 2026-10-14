import { describe, expect, it, vi } from "vitest";
import {
  AUTH_REQUIRED, AUTH_SESSION_INVALID, confirmWithAuthRecovery,
  type AuthRecoveryDeps, type ConfirmBody, type SessionCheck,
} from "../app/lib/confirmWithAuthRecovery";

const BODY: ConfirmBody = Object.freeze({ paymentKey: "pk_test_abc", orderId: "DTB-1", amount: 412000 });
const OK = { status: 200, json: { ok: true, data: { method: "카드" } } };
const AUTH_INVALID = { status: 401, json: { ok: false, code: AUTH_SESSION_INVALID, error: "유효하지 않은 인증 정보입니다" } };

type Reply = { status: number; json: unknown } | Error;

function deps(opts: {
  token?: string | null;
  check?: SessionCheck;
  refreshes?: (string | null)[];
  replies: Reply[];
}) {
  const refreshes = [...(opts.refreshes ?? [])];
  const replies = [...opts.replies];
  const d = {
    getAccessToken: vi.fn(async () => (opts.token === undefined ? "tok-1" : opts.token)),
    verifySession: vi.fn(async () => opts.check ?? "ok"),
    refreshSession: vi.fn(async () => (refreshes.length ? refreshes.shift()! : null)),
    postConfirm: vi.fn(async (_body: ConfirmBody, _token: string | null) => {
      const r = replies.shift();
      if (!r) throw new Error("unexpected extra confirm call");
      if (r instanceof Error) throw r;
      return r;
    }),
  } satisfies AuthRecoveryDeps;
  return d;
}

describe("confirmWithAuthRecovery", () => {
  it("valid session -> exactly one confirm, no refresh", async () => {
    const d = deps({ replies: [OK] });
    const out = await confirmWithAuthRecovery(BODY, d);
    expect(out).toEqual({ kind: "response", status: 200, json: OK.json, requests: 1 });
    expect(d.refreshSession).not.toHaveBeenCalled();
    expect(d.postConfirm).toHaveBeenCalledWith(BODY, "tok-1");
  });

  it("pre-flight says invalid -> refresh first, then one confirm with the NEW token", async () => {
    const d = deps({ check: "invalid", refreshes: ["tok-2"], replies: [OK] });
    const out = await confirmWithAuthRecovery(BODY, d);
    expect(out).toMatchObject({ kind: "response", status: 200, requests: 1 });
    expect(d.postConfirm).toHaveBeenCalledTimes(1);
    expect(d.postConfirm).toHaveBeenCalledWith(BODY, "tok-2");
  });

  it("pre-flight invalid and refresh fails -> relogin, confirm never sent", async () => {
    const d = deps({ check: "invalid", refreshes: [null], replies: [] });
    expect(await confirmWithAuthRecovery(BODY, d)).toEqual({ kind: "relogin", requests: 0 });
    expect(d.postConfirm).not.toHaveBeenCalled();
  });

  it("no session at all -> try refresh; failing that, relogin without a confirm call", async () => {
    const d = deps({ token: null, refreshes: [null], replies: [] });
    expect(await confirmWithAuthRecovery(BODY, d)).toEqual({ kind: "relogin", requests: 0 });
    expect(d.verifySession).not.toHaveBeenCalled();
    expect(d.postConfirm).not.toHaveBeenCalled();
  });

  it("pre-flight 'unknown' (Auth unreachable) -> no refresh, just send with the current token", async () => {
    const d = deps({ check: "unknown", replies: [OK] });
    expect(await confirmWithAuthRecovery(BODY, d)).toMatchObject({ kind: "response", status: 200, requests: 1 });
    expect(d.refreshSession).not.toHaveBeenCalled();
  });

  it("401 AUTH_SESSION_INVALID -> refresh and retry ONCE with the same body object", async () => {
    const d = deps({ refreshes: ["tok-2"], replies: [AUTH_INVALID, OK] });
    const out = await confirmWithAuthRecovery(BODY, d);
    expect(out).toMatchObject({ kind: "response", status: 200, requests: 2 });
    expect(d.postConfirm).toHaveBeenCalledTimes(2);
    expect(d.postConfirm.mock.calls[0][0]).toBe(BODY);
    expect(d.postConfirm.mock.calls[1][0]).toBe(BODY);
    expect(d.postConfirm.mock.calls[1][1]).toBe("tok-2");
  });

  it("401 AUTH_SESSION_INVALID twice -> relogin, never a third request", async () => {
    const d = deps({ refreshes: ["tok-2", "tok-3"], replies: [AUTH_INVALID, AUTH_INVALID] });
    expect(await confirmWithAuthRecovery(BODY, d)).toEqual({ kind: "relogin", requests: 2 });
    expect(d.postConfirm).toHaveBeenCalledTimes(2);
    expect(d.refreshSession).toHaveBeenCalledTimes(1);
  });

  it("401 AUTH_SESSION_INVALID and refresh fails -> relogin after one request", async () => {
    const d = deps({ refreshes: [null], replies: [AUTH_INVALID] });
    expect(await confirmWithAuthRecovery(BODY, d)).toEqual({ kind: "relogin", requests: 1 });
  });

  it("401 AUTH_REQUIRED -> relogin, no retry", async () => {
    const d = deps({ refreshes: ["tok-2"], replies: [{ status: 401, json: { ok: false, code: AUTH_REQUIRED } }] });
    expect(await confirmWithAuthRecovery(BODY, d)).toEqual({ kind: "relogin", requests: 1 });
    expect(d.refreshSession).not.toHaveBeenCalled();
  });

  it("network exception on the first send -> network_error, NO retry", async () => {
    const d = deps({ refreshes: ["tok-2"], replies: [new TypeError("Failed to fetch")] });
    expect(await confirmWithAuthRecovery(BODY, d)).toEqual({ kind: "network_error", requests: 1 });
    expect(d.postConfirm).toHaveBeenCalledTimes(1);
    expect(d.refreshSession).not.toHaveBeenCalled();
  });

  it("network exception on the auth retry -> network_error, no further attempt", async () => {
    const d = deps({ refreshes: ["tok-2"], replies: [AUTH_INVALID, new TypeError("Failed to fetch")] });
    expect(await confirmWithAuthRecovery(BODY, d)).toEqual({ kind: "network_error", requests: 2 });
  });

  const noRetryCases: [string, { status: number; json: unknown }][] = [
    ["400 bad request", { status: 400, json: { ok: false, error: "결제 금액이 낙찰가와 일치하지 않습니다" } }],
    ["403 not the winner", { status: 403, json: { ok: false, error: "낙찰자 본인만 결제할 수 있습니다" } }],
    ["403 PAYMENT_WINDOW_EXPIRED", { status: 403, json: { ok: false, code: "PAYMENT_WINDOW_EXPIRED" } }],
    ["409 ALREADY_PAID", { status: 409, json: { ok: false, code: "ALREADY_PAID" } }],
    ["409 PAYMENT_IN_PROGRESS", { status: 409, json: { ok: false, code: "PAYMENT_IN_PROGRESS" } }],
    ["409 PAYMENT_NEEDS_REVIEW", { status: 409, json: { ok: false, code: "PAYMENT_NEEDS_REVIEW" } }],
    ["422 SHIPPING_INFO_REQUIRED", { status: 422, json: { ok: false, code: "SHIPPING_INFO_REQUIRED" } }],
    ["500 server error", { status: 500, json: { ok: false, error: "결제 확인 중 오류가 발생했습니다" } }],
    ["502 PAYMENT_NEEDS_REVIEW (Toss outcome unknown)", { status: 502, json: { ok: false, code: "PAYMENT_NEEDS_REVIEW" } }],
    ["503 server_now failure", { status: 503, json: { ok: false } }],
    ["401 without a code", { status: 401, json: { ok: false, error: "x" } }],
    ["Toss rejection (4xx from Toss passed through)", { status: 400, json: { ok: false, error: "카드사 거절" } }],
  ];
  for (const [name, reply] of noRetryCases) {
    it(`${name} -> returned as-is, no automatic retry, no refresh`, async () => {
      const d = deps({ refreshes: ["tok-2"], replies: [reply] });
      expect(await confirmWithAuthRecovery(BODY, d)).toEqual({ kind: "response", status: reply.status, json: reply.json, requests: 1 });
      expect(d.postConfirm).toHaveBeenCalledTimes(1);
      expect(d.refreshSession).not.toHaveBeenCalled();
    });
  }

  it("a coded refusal on the auth retry is returned as-is (no further retry)", async () => {
    const inProgress = { status: 409, json: { ok: false, code: "PAYMENT_IN_PROGRESS" } };
    const d = deps({ refreshes: ["tok-2"], replies: [AUTH_INVALID, inProgress] });
    expect(await confirmWithAuthRecovery(BODY, d)).toEqual({ kind: "response", ...inProgress, requests: 2 });
  });
});
