import { NextRequest, NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE } from "../../../lib/adminCookie";
import { revokeAdminSessionByToken } from "../../../lib/adminAuth";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (token) {
    // Real server-side invalidation — a stolen cookie stops working the
    // instant logout is called, not just when it happens to expire.
    await revokeAdminSessionByToken(token);
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.delete(ADMIN_SESSION_COOKIE);
  return res;
}
