import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, isSameOrigin, getSupabaseAdmin } from "../../../lib/adminAuth";

export async function POST(req: NextRequest) {
  if (!(await requireAdminSession(req))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!isSameOrigin(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  // admin_reset_game() does the chat/participants wipe + game_state reset
  // as one atomic transaction — see
  // supabase/migrations/20260910140000_admin_security.sql. EXECUTE is
  // revoked from anon/authenticated there, so only this service-role call
  // can ever run it.
  const { error } = await getSupabaseAdmin().rpc("admin_reset_game");
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
