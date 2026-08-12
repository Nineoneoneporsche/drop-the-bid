import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { password } = await req.json();
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

  if (!ADMIN_PASSWORD) {
    return NextResponse.json({ ok: false, error: "서버 설정 오류" }, { status: 500 });
  }
  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ ok: false, error: "비밀번호가 올바르지 않습니다" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set("dtb-admin-session", ADMIN_PASSWORD, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24,
    path: "/",
  });
  return res;
}
