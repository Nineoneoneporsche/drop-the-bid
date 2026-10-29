// POST /api/admin/reset-game: maps admin_reset_game()'s reset_blocked errors
// to a 409 with operator-facing text. Admin auth and Supabase are faked.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  admin: true,
  rpcError: null as null | { message: string; details?: string | null; code?: string },
  rpcCalls: 0,
}));

vi.mock("../app/lib/adminAuth", () => ({
  requireAdminSession: async () => state.admin,
  isSameOrigin: () => true,
  getSupabaseAdmin: () => ({
    rpc: async () => { state.rpcCalls++; return { error: state.rpcError }; },
  }),
}));

const { POST } = await import("../app/api/admin/reset-game/route");
const req = () => new NextRequest("http://localhost/api/admin/reset-game", { method: "POST" });

beforeEach(() => { state.admin = true; state.rpcError = null; state.rpcCalls = 0; });

describe("reset-game route", () => {
  it("success passes through", async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("unpaid win in window -> 409 with deadline (KST) in the message", async () => {
    state.rpcError = { code: "P0001", message: "reset_blocked:unpaid_win_in_payment_window", details: "2026-10-08T00:45:41Z" };
    const res = await POST(req());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, code: "RESET_BLOCKED_UNPAID_WIN_IN_PAYMENT_WINDOW", paymentDeadline: "2026-10-08T00:45:41Z" });
    expect(body.error).toContain("결제할 수 있는 낙찰");
    expect(body.error).toContain("결제 기한");
    expect(body.error).toMatch(/09:45:41/); // 00:45:41Z = 09:45:41 KST
  });

  it("pending -> 409 PAYMENT_IN_PROGRESS text", async () => {
    state.rpcError = { code: "P0001", message: "reset_blocked:payment_in_progress", details: "2026-10-08T00:45:41Z" };
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "RESET_BLOCKED_PAYMENT_IN_PROGRESS", error: expect.stringContaining("처리 중") });
  });

  it("reconciliation_required -> 409 needs-review text", async () => {
    state.rpcError = { code: "P0001", message: "reset_blocked:payment_needs_review", details: null };
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "RESET_BLOCKED_PAYMENT_NEEDS_REVIEW", error: expect.stringContaining("reconciliation_required") });
  });

  it("win_record_missing (M2) -> 409 ledger text, no deadline", async () => {
    state.rpcError = { code: "P0001", message: "reset_blocked:win_record_missing", details: null };
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      ok: false, code: "RESET_BLOCKED_WIN_RECORD_MISSING", paymentDeadline: null, error: expect.stringContaining("낙찰 원장"),
    });
  });

  it("win_record_mismatch (M2) -> 409 ledger text", async () => {
    state.rpcError = { code: "P0001", message: "reset_blocked:win_record_mismatch", details: null };
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "RESET_BLOCKED_WIN_RECORD_MISMATCH", error: expect.stringContaining("원장 불일치") });
  });

  it("other DB errors stay 500", async () => {
    state.rpcError = { message: "connection lost" };
    const res = await POST(req());
    expect(res.status).toBe(500);
  });

  it("non-admin is rejected before the RPC", async () => {
    state.admin = false;
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(state.rpcCalls).toBe(0);
  });
});
