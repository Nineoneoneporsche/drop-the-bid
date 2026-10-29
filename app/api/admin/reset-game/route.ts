import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, isSameOrigin, getSupabaseAdmin } from "../../../lib/adminAuth";

// admin_reset_game() refuses (fail-closed, in the DB) to erase a win the
// winner can still pay for, or one whose durable auction_wins record is
// missing — see supabase/migrations/20261029100000_reset_game_uses_auction_wins.sql.
// It raises a fixed 'reset_blocked:<reason>' message, with the payment
// deadline (UTC ISO, auction_wins.payment_deadline) in DETAIL for the
// payment reasons; those are mapped to operator-facing text here.
const RESET_BLOCKED_MESSAGES: Record<string, string> = {
  "reset_blocked:unpaid_win_in_payment_window":
    "낙찰자가 아직 결제할 수 있는 낙찰이 있어 리셋할 수 없습니다. 결제가 완료되거나 결제 기한이 지난 뒤 다시 시도해주세요.",
  "reset_blocked:payment_in_progress":
    "현재 낙찰의 결제가 처리 중(pending)이라 리셋할 수 없습니다. 결제 상태를 먼저 확인·정리해주세요.",
  "reset_blocked:payment_needs_review":
    "현재 낙찰에 확인이 필요한 결제(reconciliation_required)가 있어 리셋할 수 없습니다. Toss 승인 여부를 확인해 결제 상태를 정리한 뒤 다시 시도해주세요.",
  "reset_blocked:win_record_missing":
    "현재 낙찰의 낙찰 원장(auction_wins) 기록이 없어 리셋할 수 없습니다. 원장 불일치를 먼저 확인해주세요.",
  "reset_blocked:win_record_mismatch":
    "현재 낙찰자와 낙찰 원장(auction_wins)의 낙찰자가 달라 리셋할 수 없습니다. 원장 불일치를 먼저 확인해주세요.",
};

function formatDeadlineKst(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

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
    const blocked = RESET_BLOCKED_MESSAGES[error.message];
    if (blocked) {
      const deadline = formatDeadlineKst(error.details ?? undefined);
      return NextResponse.json(
        {
          ok: false,
          code: error.message.replace("reset_blocked:", "RESET_BLOCKED_").toUpperCase(),
          error: deadline && error.message === "reset_blocked:unpaid_win_in_payment_window"
            ? `${blocked} (결제 기한: ${deadline})`
            : blocked,
          paymentDeadline: error.details ?? null,
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
