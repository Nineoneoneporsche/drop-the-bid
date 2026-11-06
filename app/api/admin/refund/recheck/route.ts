import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, isSameOrigin, getSupabaseAdmin } from "../../../../lib/adminAuth";
import { REFUND_MESSAGES } from "../../../../lib/adminRefund";
import { recheckRefund } from "../../../../lib/paymentRefund";
import { resolveTossServerConfig } from "../../../../lib/tossEnv";

// POST /api/admin/refund/recheck { cancellationId } — re-check one refund
// whose outcome is unknown (M4-B3). The row is loaded from the DB by id
// and its own paymentKey / order / amount are used; then ONE Toss lookup
// (GET) — never a cancel POST, never a new Idempotency-Key, never a new
// cancellation (app/lib/paymentRefund.ts recheckRefund). A pending row
// younger than 5 minutes is left alone (in_flight); done / failed rows are
// answered as they are, without calling Toss.
//
// Answers { ok, status, cancellationId, message }.

// The Toss lookup has a 10 s timeout.
export const maxDuration = 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const REFUSAL_STATUS: Record<string, number> = {
  "refund_recheck:not_found": 404,
  "refund_recheck:in_flight": 409,
};

export async function POST(req: NextRequest) {
  if (!(await requireAdminSession(req))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!isSameOrigin(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_request" }, { status: 400 });
  }
  const id = (body as Record<string, unknown> | null)?.cancellationId;
  if (typeof id !== "string" || !UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, error: "invalid_request" }, { status: 400 });
  }

  const toss = resolveTossServerConfig();
  if (!toss.ok) {
    console.error("[admin/refund/recheck] Toss key configuration refused — no lookup", { reason: toss.reason, vercelEnv: toss.vercelEnv });
    return NextResponse.json({ ok: false, error: "config" }, { status: 503 });
  }

  const result = await recheckRefund(getSupabaseAdmin(), toss.secretKey, id.toLowerCase());
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.code }, { status: REFUSAL_STATUS[result.code] ?? 503 });
  }
  return NextResponse.json({
    ok: true, status: result.status, cancellationId: result.cancellationId, message: REFUND_MESSAGES[result.status],
  });
}
