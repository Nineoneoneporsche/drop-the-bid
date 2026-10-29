// POST /api/join/participant: the participant slot is bound to the session
// id of the access token Supabase Auth verified — never to anything in the
// request body — and the new DB refusals map to 409 codes. Supabase is faked.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { sessionIdFromVerifiedToken } from "../app/lib/jwtSession";

const UID = "aaaaaaaa-0000-4000-8000-000000000001";
const SESSION = "a1a1a1a1-1111-4111-8111-111111111111";

const state = vi.hoisted(() => ({
  user: null as null | { id: string },
  rpcError: null as null | { message: string },
  rpcCalls: [] as Array<Record<string, unknown>>,
}));

vi.mock("../app/lib/adminAuth", () => ({
  getSupabaseAdmin: () => ({
    auth: { getUser: async () => (state.user ? { data: { user: state.user }, error: null } : { data: { user: null }, error: { status: 401 } }) },
    from: () => ({ upsert: async () => ({ error: null }) }),
    rpc: async (_fn: string, args: Record<string, unknown>) => { state.rpcCalls.push(args); return { error: state.rpcError }; },
  }),
}));

process.env.SUPABASE_SERVICE_ROLE_KEY = "test-hmac-key";
delete process.env.TURNSTILE_SECRET_KEY;

const { POST } = await import("../app/api/join/participant/route");

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const token = (payload: object) => `${b64({ alg: "ES256" })}.${b64(payload)}.sig`;

const req = (tok: string | null, body: object = { nickname: "alice" }) =>
  new NextRequest("http://localhost/api/join/participant", {
    method: "POST",
    headers: { "content-type": "application/json", ...(tok ? { authorization: `Bearer ${tok}` } : {}) },
    body: JSON.stringify(body),
  });

beforeEach(() => { state.user = { id: UID }; state.rpcError = null; state.rpcCalls = []; });

describe("join participant route", () => {
  it("passes the verified token's session_id, ignoring any session id in the body", async () => {
    const res = await POST(req(token({ sub: UID, session_id: SESSION }), {
      nickname: "alice", sessionId: "ffffffff-ffff-4fff-8fff-ffffffffffff", p_session_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    }));
    expect(res.status).toBe(200);
    expect(state.rpcCalls).toHaveLength(1);
    expect(state.rpcCalls[0]).toMatchObject({ p_uid: UID, p_nickname: "alice", p_session_id: SESSION });
    expect(typeof state.rpcCalls[0].p_device_hash).toBe("string");
  });

  it("a token without a usable session_id -> 401 AUTH_SESSION_INVALID, no RPC", async () => {
    for (const payload of [{ sub: UID }, { sub: UID, session_id: "not-a-uuid" }, { sub: "someone-else", session_id: SESSION }]) {
      const res = await POST(req(token(payload)));
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ ok: false, code: "AUTH_SESSION_INVALID" });
    }
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("a token Supabase Auth rejects -> 401 before anything else", async () => {
    state.user = null;
    const res = await POST(req(token({ sub: UID, session_id: SESSION })));
    expect(res.status).toBe(401);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("another live session -> 409 ACCOUNT_ACTIVE_ELSEWHERE", async () => {
    state.rpcError = { message: "account active on another session" };
    const res = await POST(req(token({ sub: UID, session_id: SESSION })));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      ok: false, code: "ACCOUNT_ACTIVE_ELSEWHERE", error: "이 계정은 다른 기기에서 현재 경매에 참여 중입니다.",
    });
  });

  it("before the join window (T - N) or with no T -> 409 PARTICIPANT_JOIN_NOT_OPEN", async () => {
    state.rpcError = { message: "participant_join_not_open" };
    const res = await POST(req(token({ sub: UID, session_id: SESSION })));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      ok: false, code: "PARTICIPANT_JOIN_NOT_OPEN", error: "아직 참가 가능 시간이 아닙니다. 참가 오픈 시각 이후에 다시 시도해주세요.",
    });
  });

  it("join outside waiting/strategy -> 409 PARTICIPANT_JOIN_CLOSED", async () => {
    state.rpcError = { message: "participant join closed" };
    const res = await POST(req(token({ sub: UID, session_id: SESSION })));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, code: "PARTICIPANT_JOIN_CLOSED" });
  });

  it("the existing device-guard refusal is unchanged", async () => {
    state.rpcError = { message: "this device already joined as a participant this round" };
    const res = await POST(req(token({ sub: UID, session_id: SESSION })));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "이미 이 기기에서 다른 계정으로 참여했습니다." });
  });
});

describe("sessionIdFromVerifiedToken", () => {
  it("returns the lower-cased session id for the verified subject", () => {
    expect(sessionIdFromVerifiedToken(token({ sub: UID, session_id: SESSION.toUpperCase() }), UID)).toBe(SESSION);
  });

  it("rejects malformed tokens and mismatched subjects", () => {
    expect(sessionIdFromVerifiedToken("garbage", UID)).toBeNull();
    expect(sessionIdFromVerifiedToken("a.%%%.c", UID)).toBeNull();
    expect(sessionIdFromVerifiedToken(token({ sub: UID, session_id: 42 }), UID)).toBeNull();
    expect(sessionIdFromVerifiedToken(token({ sub: "x", session_id: SESSION }), UID)).toBeNull();
  });
});
