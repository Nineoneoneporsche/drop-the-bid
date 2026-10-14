// Remembers a payment confirmation that stopped because the user had to sign
// in again, so they can resume THE SAME confirmation (same paymentKey /
// orderId / amount) by pressing "결제 확인 계속하기" on My Page after logging
// in. Nothing resumes automatically and nothing redirects on its own.
//
// Stored in sessionStorage (this tab only). Read values are validated; a
// malformed or expired entry is deleted and ignored; the entry is deleted as
// soon as it's used. The resume target is always /payment/success, built
// here from the three stored values — never a stored or arbitrary URL. The
// server still runs every check (auth, winner, amount, phase, payment
// window, shipping, one-active-payment-per-win) on the resumed request.
//
// RESUME_TTL_MS is only a conservative cap for showing the resume button:
// it is the win's payment window (WINNER_PAYMENT_WINDOW_SECONDS), past which
// the server refuses anyway. It is NOT a claim about how long Toss keeps a
// paymentKey confirmable — Toss's own response decides that.
import { WINNER_PAYMENT_WINDOW_SECONDS } from "./paymentWindow";

export const PENDING_CONFIRM_KEY = "dtb_pending_confirm";
export const RESUME_TTL_MS = WINNER_PAYMENT_WINDOW_SECONDS * 1000;

export type PendingConfirm = { paymentKey: string; orderId: string; amount: number; savedAt: number };

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

const PAYMENT_KEY_RE = /^[A-Za-z0-9_-]{1,200}$/;
const ORDER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function isValid(p: unknown, now: number): p is PendingConfirm {
  if (!p || typeof p !== "object") return false;
  const v = p as Record<string, unknown>;
  return (
    typeof v.paymentKey === "string" && PAYMENT_KEY_RE.test(v.paymentKey) &&
    typeof v.orderId === "string" && ORDER_ID_RE.test(v.orderId) &&
    typeof v.amount === "number" && Number.isInteger(v.amount) && v.amount > 0 && v.amount < 1_000_000_000 &&
    typeof v.savedAt === "number" && Number.isFinite(v.savedAt) &&
    v.savedAt <= now && now - v.savedAt <= RESUME_TTL_MS
  );
}

export function savePendingConfirm(
  body: { paymentKey: string; orderId: string; amount: number },
  now: number = Date.now(),
  storage: StorageLike | null = defaultStorage(),
): boolean {
  const entry: PendingConfirm = { paymentKey: body.paymentKey, orderId: body.orderId, amount: body.amount, savedAt: now };
  if (!storage || !isValid(entry, now)) return false;
  try {
    storage.setItem(PENDING_CONFIRM_KEY, JSON.stringify(entry));
    return true;
  } catch {
    return false;
  }
}

// Valid entry or null. Malformed/expired entries are removed.
export function readPendingConfirm(now: number = Date.now(), storage: StorageLike | null = defaultStorage()): PendingConfirm | null {
  if (!storage) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(PENDING_CONFIRM_KEY);
  } catch {
    return null;
  }
  if (raw == null) return null;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (isValid(parsed, now)) return parsed;
  clearPendingConfirm(storage);
  return null;
}

export function clearPendingConfirm(storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.removeItem(PENDING_CONFIRM_KEY);
  } catch {
    /* ignore */
  }
}

// Fixed internal path + the three values, URL-encoded.
export function resumeConfirmUrl(p: Pick<PendingConfirm, "paymentKey" | "orderId" | "amount">): string {
  const q = new URLSearchParams({ paymentKey: p.paymentKey, orderId: p.orderId, amount: String(p.amount) });
  return `/payment/success?${q.toString()}`;
}
