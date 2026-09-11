import { NextRequest, NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE } from "./app/lib/adminCookie";

// Edge runtime — deliberately holds no secret (no ADMIN_PASSWORD, no
// SUPABASE_SERVICE_ROLE_KEY) and does no DB lookup. This is a fast UX
// redirect only ("is a session cookie even present"), not the security
// boundary: real DB-backed session verification happens in
// app/admin/(protected)/layout.tsx (Node runtime, requireAdminSession())
// for page access, and independently again inside every /api/admin/* route
// before it touches the DB. A request that has *some* cookie value but an
// invalid/expired/revoked session still passes this check and is caught by
// those Node-side checks instead — middleware is not trusted as the
// authorization boundary for any of this.
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/admin") && pathname !== "/admin/login") {
    const cookie = req.cookies.get(ADMIN_SESSION_COOKIE);
    if (!cookie?.value) {
      return NextResponse.redirect(new URL("/admin/login", req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/admin/:path*",
};
