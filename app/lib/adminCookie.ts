// Zero dependencies (no crypto, no supabase-js) — safe to import from
// middleware.ts (Edge runtime) as well as Node-runtime server code, so the
// cookie name has exactly one definition instead of a string literal
// duplicated across files.
export const ADMIN_SESSION_COOKIE = "dtb-admin-session";
