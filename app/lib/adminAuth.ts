// Server-only. Imported by Node-runtime API routes (app/api/admin/*) and
// the Node-runtime admin layout (app/admin/(protected)/layout.tsx) — never
// by middleware.ts, which is Edge and must not hold SUPABASE_SERVICE_ROLE_KEY
// or ADMIN_PASSWORD (see that file's comment for why).
import crypto from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "./adminCookie";

export const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 24; // 24h — single source
// of truth for both admin_sessions.expires_at and the cookie's maxAge, so
// the two can never drift apart.

let _supabaseAdmin: SupabaseClient | null = null;
export function getSupabaseAdmin() {
  if (!_supabaseAdmin) {
    _supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );
  }
  return _supabaseAdmin;
}

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

// Constant-time compare, used for the ADMIN_PASSWORD check so response
// timing can't leak how many leading characters matched.
export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // timingSafeEqual throws on length mismatch, so equalize length first —
  // this comparison-length branch is on public info (whether lengths
  // match), not on the secret's content, so it leaks nothing sensitive.
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return "unknown";
}

// ── session issuance / revocation / verification ───────────────────────────

export async function createAdminSession(): Promise<string> {
  const token = generateSessionToken();
  const tokenHash = sha256Hex(token);
  const expiresAt = new Date(Date.now() + ADMIN_SESSION_TTL_SECONDS * 1000).toISOString();

  const { error } = await getSupabaseAdmin()
    .from("admin_sessions")
    .insert({ token_hash: tokenHash, expires_at: expiresAt });
  if (error) throw new Error(error.message);

  return token;
}

export async function revokeAdminSessionByToken(token: string): Promise<void> {
  const tokenHash = sha256Hex(token);
  await getSupabaseAdmin()
    .from("admin_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("token_hash", tokenHash)
    .is("revoked_at", null);
}

export async function verifyAdminSessionToken(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  const tokenHash = sha256Hex(token);

  const { data, error } = await getSupabaseAdmin()
    .from("admin_sessions")
    .select("id, expires_at, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error || !data) return false;
  if (data.revoked_at) return false;
  if (new Date(data.expires_at as string).getTime() <= Date.now()) return false;
  return true;
}

// Route-handler convenience: read the session cookie off a NextRequest and
// verify it in one call.
export async function requireAdminSession(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  return verifyAdminSessionToken(token);
}

// ── brute-force gate ─────────────────────────────────────────────────────

export async function loginGate(ip: string): Promise<{ allowed: boolean; attemptId: string | null }> {
  const { data, error } = await getSupabaseAdmin().rpc("admin_login_gate", { p_ip: ip });
  if (error || !data || !Array.isArray(data) || data.length === 0) {
    // Fail closed — if the gate itself can't be evaluated, don't let the
    // password check proceed.
    return { allowed: false, attemptId: null };
  }
  const row = data[0] as { allowed: boolean; attempt_id: string | null };
  return { allowed: row.allowed, attemptId: row.attempt_id };
}

export async function markLoginSuccess(attemptId: string): Promise<void> {
  await getSupabaseAdmin().rpc("admin_login_mark_success", { p_attempt_id: attemptId });
}

// ── same-origin check (CSRF hardening for the two admin write routes) ──────

export function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // same-site navigations/fetches often omit Origin; SameSite=lax cookie remains the primary defense
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}
