import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, isSameOrigin, getSupabaseAdmin } from "../../../lib/adminAuth";

export async function POST(req: NextRequest) {
  if (!(await requireAdminSession(req))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!isSameOrigin(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  // admin_force_start_game() — one atomic UPDATE, pre-game (waiting /
  // strategy) with at least one participant only, no time gate; it sets the
  // scheduled start AND game_started_at to the same now(), so a forced start
  // keeps T as the single time axis (supabase/migrations/20261030100000_
  // scheduled_start_join_window.sql). EXECUTE is service_role only, so only
  // this route can run it — never reachable as a public RPC.
  const { data, error } = await getSupabaseAdmin().rpc("admin_force_start_game");
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // data === false means no participant yet, or already started / ended —
  // not a server error, just nothing to do.
  return NextResponse.json({ ok: true, started: data === true });
}
