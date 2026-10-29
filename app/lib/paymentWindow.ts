// How long a winner has to pay. Since M1 the deadline of every new win is
// stored on the win itself — auction_wins.payment_deadline, written by
// claim_winner() as claimed_at + interval '1800 seconds' — and that stored
// value is what /api/payment/confirm enforces (checkPaymentDeadline below)
// and what the payment page / recovery CTA count down to. This constant
// must stay equal to that interval: it is the legacy fallback for wins
// with no auction_wins row, the admin "stale pending" threshold, and the
// "N분" in user-facing copy.
export const WINNER_PAYMENT_WINDOW_SECONDS = 1800; // 30 minutes
export const WINNER_PAYMENT_WINDOW_MINUTES = WINNER_PAYMENT_WINDOW_SECONDS / 60;

// Machine-readable error code the confirm API returns when a new payment
// approval is refused because the window is over (or was never opened).
// app/payment/success/page.tsx keys off this, not the message text.
export const PAYMENT_WINDOW_EXPIRED = "PAYMENT_WINDOW_EXPIRED";

export type PaymentWindowCheck =
  | { ok: true; elapsedMs: number }
  | { ok: false; reason: "missing_claimed_at" | "invalid_time" | "expired"; elapsedMs?: number };

// Legacy check (a win with no auction_wins row) — new approvals use
// checkPaymentDeadline() below. Pure, both timestamps from the DB: claimedAt is
// game_state.winner_claimed_at (set to now() by claim_winner()), serverNow
// is the server_now() RPC — never the client's or this Node process's
// clock. Expired as soon as the full window has elapsed, matching the
// payment page countdown, which flips to expired at remaining <= 0.
export function checkPaymentWindow(
  claimedAt: string | null | undefined,
  serverNow: string | null | undefined,
): PaymentWindowCheck {
  if (!claimedAt) return { ok: false, reason: "missing_claimed_at" };
  const claimedMs = new Date(claimedAt).getTime();
  const nowMs = serverNow ? new Date(serverNow).getTime() : NaN;
  if (Number.isNaN(claimedMs) || Number.isNaN(nowMs)) return { ok: false, reason: "invalid_time" };

  const elapsedMs = nowMs - claimedMs;
  if (elapsedMs >= WINNER_PAYMENT_WINDOW_SECONDS * 1000) return { ok: false, reason: "expired", elapsedMs };
  return { ok: true, elapsedMs };
}

// Deadline check for a win recorded in auction_wins: deadline is
// auction_wins.payment_deadline, serverNow is the server_now() RPC — both
// from the DB, never the client. Expired as soon as now reaches the
// deadline (same boundary as checkPaymentWindow above).
export function checkPaymentDeadline(
  deadline: string | null | undefined,
  serverNow: string | null | undefined,
): PaymentWindowCheck {
  if (!deadline) return { ok: false, reason: "missing_claimed_at" };
  const deadlineMs = new Date(deadline).getTime();
  const nowMs = serverNow ? new Date(serverNow).getTime() : NaN;
  if (Number.isNaN(deadlineMs) || Number.isNaN(nowMs)) return { ok: false, reason: "invalid_time" };

  const elapsedMs = nowMs - (deadlineMs - WINNER_PAYMENT_WINDOW_SECONDS * 1000);
  if (nowMs >= deadlineMs) return { ok: false, reason: "expired", elapsedMs };
  return { ok: true, elapsedMs };
}

// Whole seconds left until a deadline, rounded up, never negative — 0
// exactly when checkPaymentDeadline() starts refusing.
export function secondsUntilDeadline(deadlineMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
}
