import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, isSameOrigin, getSupabaseAdmin } from "../../../lib/adminAuth";

export async function POST(req: NextRequest) {
  if (!(await requireAdminSession(req))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!isSameOrigin(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  // resume_game() folds the elapsed pause duration into paused_total_ms so
  // the price calc never counts paused time as elapsed — see
  // supabase/migrations/20260917100000_fail_closed_pause.sql. EXECUTE is
  // revoked from anon/authenticated there, so only this service-role call
  // can ever run it.
  const { data, error } = await getSupabaseAdmin().rpc("resume_game");
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, resumed: data === true });
}
