import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/adminAuth";

export const dynamic = "force-dynamic";

// Public liveness probe — no admin session needed, this isn't a privileged
// action. Polled every few seconds by every connected client
// (GameContext.tsx) while a round is live. touch_health_lease() is what
// actually does the work: it renews a 10s lease, and if the lease had
// already expired (nobody reached Postgres for 10s+), it auto-pauses a
// live game before renewing — see
// supabase/migrations/20260917100000_fail_closed_pause.sql. This route
// just needs to reach that RPC; a failure here (including this route
// itself timing out or erroring) is exactly the signal the client's own
// consecutive-failure counter is watching for.
export async function GET() {
  const { data, error } = await getSupabaseAdmin().rpc("touch_health_lease");

  if (error) {
    return NextResponse.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json(
    { ok: true, ...(data as object) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
