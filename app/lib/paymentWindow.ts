// Single source of truth for how long a winner has to pay before the
// payment page's own countdown reaches zero. Shared by app/payment/page.tsx
// (the countdown display), app/api/admin/payment-status/route.ts (the
// "stale pending" threshold for payment_attempts) and
// app/api/payment/confirm/route.ts (the server-side enforcement below) so
// they can't drift apart the way independently hardcoded "600"s eventually
// would — same reasoning as ADMIN_SESSION_TTL_SECONDS in app/lib/adminAuth.ts.
export const WINNER_PAYMENT_WINDOW_SECONDS = 1800; // 30 minutes
export const WINNER_PAYMENT_WINDOW_MINUTES = WINNER_PAYMENT_WINDOW_SECONDS / 60;

// Machine-readable error code the confirm API returns when a new payment
// approval is refused because the window is over (or was never opened).
// app/payment/success/page.tsx keys off this, not the message text.
export const PAYMENT_WINDOW_EXPIRED = "PAYMENT_WINDOW_EXPIRED";

export type PaymentWindowCheck =
  | { ok: true; elapsedMs: number }
  | { ok: false; reason: "missing_claimed_at" | "invalid_time" | "expired"; elapsedMs?: number };

// Pure check, both timestamps from the DB: claimedAt is
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
