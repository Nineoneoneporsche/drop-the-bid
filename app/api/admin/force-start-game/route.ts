import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, isSameOrigin, getSupabaseAdmin } from "../../../lib/adminAuth";

export async function POST(req: NextRequest) {
  if (!(await requireAdminSession(req))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!isSameOrigin(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  // admin_force_start_game() — same atomic `where phase='strategy'` guard
  // as start_game(), but no time gate. EXECUTE is revoked from
  // anon/authenticated (see supabase/migrations/20260910150000_
  // game_transition_security.sql), so only this service-role call can run
  // it — never reachable as a public RPC.
  const { data, error } = await getSupabaseAdmin().rpc("admin_force_start_game");
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // data === false means phase wasn't 'strategy' (already started, or
  // still waiting) — not a server error, just nothing to do.
  return NextResponse.json({ ok: true, started: data === true });
}
