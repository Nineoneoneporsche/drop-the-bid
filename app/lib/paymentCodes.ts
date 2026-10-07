// Machine-readable `code`s /api/payment/confirm returns when it refuses a
// NEW Toss approval because this win already has an active payment
// attempt (see supabase/migrations/20261007100000_one_active_payment_per_win.sql).
// app/payment/success/page.tsx keys off these, not the message text.
export const ALREADY_PAID = "ALREADY_PAID";
export const PAYMENT_IN_PROGRESS = "PAYMENT_IN_PROGRESS";
export const PAYMENT_NEEDS_REVIEW = "PAYMENT_NEEDS_REVIEW";

// Statuses covered by the one-active-attempt-per-win unique index.
export const ACTIVE_ATTEMPT_STATUSES = ["pending", "paid", "reconciliation_required"] as const;
