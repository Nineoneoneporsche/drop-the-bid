// app/lib/adminAuth.ts (M4-B3): requireAdminSessionId() returns the id of a
// valid admin_sessions row (existing, not revoked, not expired) and nothing
// else; requireAdminSession() / verifyAdminSessionToken() keep their boolean
// behaviour on top of it. isSameOrigin() is the real CSRF check.
import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], error: null as null | { message: string } }));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (t: string) => {
      if (t !== "admin_sessions") throw new Error(t);
      let hash: unknown;
      const q = {
        select: () => q,
        eq: (_c: string, v: unknown) => { hash = v; return q; },
        maybeSingle: async () => ({ data: h.error ? null : h.rows.find((r) => r.token_hash === hash) ?? null, error: h.error }),
      };
      return q;
    },
  }),
}));

const { adminSessionIdForToken, isSameOrigin, requireAdminSession, requireAdminSessionId, verifyAdminSessionToken } = await import("../app/lib/adminAuth");
const { ADMIN_SESSION_COOKIE } = await import("../app/lib/adminCookie");

const sha = (t: string) => crypto.createHash("sha256").update(t).digest("hex");
const ID = "5e550000-0000-4000-8000-000000000001";
const future = () => new Date(Date.now() + 3600_000).toISOString();
const withCookie = (token?: string, headers: Record<string, string> = {}) =>
  new NextRequest("http://localhost/api/admin/refund", { headers: { ...(token ? { cookie: `${ADMIN_SESSION_COOKIE}=${token}` } : {}), ...headers } });

beforeEach(() => {
  h.rows = [{ id: ID, token_hash: sha("good-token"), expires_at: future(), revoked_at: null }];
  h.error = null;
});

describe("admin session identity", () => {
  it("a valid session -> its id; boolean helpers stay true", async () => {
    expect(await adminSessionIdForToken("good-token")).toBe(ID);
    expect(await requireAdminSessionId(withCookie("good-token"))).toBe(ID);
    expect(await requireAdminSession(withCookie("good-token"))).toBe(true);
    expect(await verifyAdminSessionToken("good-token")).toBe(true);
  });
  it("no cookie / unknown token / revoked / expired / DB error -> null and false", async () => {
    h.rows.push(
      { id: "revoked-id", token_hash: sha("revoked"), expires_at: future(), revoked_at: new Date().toISOString() },
      { id: "expired-id", token_hash: sha("expired"), expires_at: new Date(Date.now() - 1000).toISOString(), revoked_at: null },
    );
    for (const t of [undefined, "", "unknown", "revoked", "expired"]) {
      expect(await requireAdminSessionId(withCookie(t)), String(t)).toBeNull();
      expect(await requireAdminSession(withCookie(t)), String(t)).toBe(false);
      expect(await verifyAdminSessionToken(t), String(t)).toBe(false);
    }
    h.error = { message: "db down" };
    expect(await requireAdminSessionId(withCookie("good-token"))).toBeNull();
    expect(await requireAdminSession(withCookie("good-token"))).toBe(false);
  });
});

describe("isSameOrigin", () => {
  it("same host or no Origin -> true; another host / garbage -> false", () => {
    expect(isSameOrigin(withCookie(undefined, { host: "localhost" }))).toBe(true);
    expect(isSameOrigin(withCookie(undefined, { host: "localhost", origin: "http://localhost" }))).toBe(true);
    expect(isSameOrigin(withCookie(undefined, { host: "localhost", origin: "https://evil.example" }))).toBe(false);
    expect(isSameOrigin(withCookie(undefined, { host: "localhost", origin: "null" }))).toBe(false);
  });
});
