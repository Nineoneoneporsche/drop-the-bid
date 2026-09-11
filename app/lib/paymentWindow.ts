// Single source of truth for how long a winner has to pay before the
// payment page's own countdown reaches zero. Shared by app/payment/page.tsx
// (the countdown display) and app/api/admin/payment-status/route.ts (the
// "stale pending" threshold for payment_attempts) so the two can't drift
// apart the way two independently hardcoded "600"s eventually would —
// same reasoning as ADMIN_SESSION_TTL_SECONDS in app/lib/adminAuth.ts.
export const WINNER_PAYMENT_WINDOW_SECONDS = 600; // 10 minutes
