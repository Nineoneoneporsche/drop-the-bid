import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_SESSION_COOKIE } from "../../lib/adminCookie";
import { verifyAdminSessionToken } from "../../lib/adminAuth";

// The real authorization boundary for /admin page access. Runs on the
// Node.js runtime (Next's default for Server Components/layouts, not
// Edge), so it's safe to hold SUPABASE_SERVICE_ROLE_KEY here — unlike
// middleware.ts, which only does a fast "cookie present?" redirect and
// never touches this key. A request that clears the cookie-presence check
// in middleware but carries a garbage/expired/revoked token is caught
// here, before any admin page content renders.
export default async function ProtectedAdminLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;

  if (!(await verifyAdminSessionToken(token))) {
    redirect("/admin/login");
  }

  return <>{children}</>;
}
