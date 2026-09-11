import { NextRequest, NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE } from "../../../lib/adminCookie";
import {
  ADMIN_SESSION_TTL_SECONDS,
  constantTimeEqual,
  createAdminSession,
  getClientIp,
  loginGate,
  markLoginSuccess,
} from "../../../lib/adminAuth";

export async function POST(req: NextRequest) {
  const { password } = await req.json();
  const ip = getClientIp(req);

  // Atomic per-IP gate — see admin_login_gate() in
  // supabase/migrations/20260910140000_admin_security.sql. This runs
  // *before* the password check, so a request that's already over the
  // threshold never reaches constantTimeEqual() at all.
  const { allowed, attemptId } = await loginGate(ip);
  if (!allowed || !attemptId) {
    return NextResponse.json(
      { ok: false, error: "너무 많은 시도가 있었습니다. 잠시 후 다시 시도해주세요." },
      { status: 429 }
    );
  }

  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  if (!ADMIN_PASSWORD) {
    return NextResponse.json({ ok: false, error: "서버 설정 오류" }, { status: 500 });
  }

  const candidate = typeof password === "string" ? password : "";
  if (!constantTimeEqual(candidate, ADMIN_PASSWORD)) {
    return NextResponse.json({ ok: false, error: "비밀번호가 올바르지 않습니다" }, { status: 401 });
  }

  await markLoginSuccess(attemptId);
  const token = await createAdminSession();

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: ADMIN_SESSION_TTL_SECONDS,
    path: "/",
  });
  return res;
}
