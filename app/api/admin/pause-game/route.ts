import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, isSameOrigin, getSupabaseAdmin } from "../../../lib/adminAuth";

export async function POST(req: NextRequest) {
  if (!(await requireAdminSession(req))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!isSameOrigin(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  // pause_game() only takes effect while phase='game' and not already
  // paused — see supabase/migrations/20260917100000_fail_closed_pause.sql.
  // EXECUTE is revoked from anon/authenticated there, so only this
  // service-role call can ever run it.
  const { data, error } = await getSupabaseAdmin().rpc("pause_game", { p_reason: "manual" });
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, paused: data === true });
}
