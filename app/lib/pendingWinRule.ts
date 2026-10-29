// Pure rule behind usePendingWin() (app/lib/pendingWin.ts), kept free of
// React/Supabase so it can be unit-tested. See that file for context.
import { secondsUntilDeadline, WINNER_PAYMENT_WINDOW_SECONDS } from "./paymentWindow";

export type PendingWinInput = {
  userId: string | null;                 // non-anonymous Auth user id, else null
  phase: string;                         // game_state phase
  winner: { id: string; claimedAt: number | null } | null;
  // The user's auction_wins row for the current round (RLS: own rows
  // only), when there is one. Present => its stored payment_deadline
  // decides; absent => legacy win, claimedAt + WINNER_PAYMENT_WINDOW_SECONDS.
  win?: { id: string; deadlineMs: number } | null;
  hasOrder: boolean | null;              // null = orders lookup not finished yet
  nowMs: number;                         // server-synced clock
};

// Legacy (no auction_wins row) countdown.
export function paymentSecondsLeft(claimedAt: number, nowMs: number): number {
  return Math.max(0, WINNER_PAYMENT_WINDOW_SECONDS - Math.floor((nowMs - claimedAt) / 1000));
}

export function isMyEndedWin(i: Pick<PendingWinInput, "userId" | "phase" | "winner">): boolean {
  return !!(i.phase === "ended" && i.winner && i.userId && i.winner.id === i.userId && i.winner.claimedAt != null);
}

export function pendingSecondsLeft(i: Pick<PendingWinInput, "winner" | "win" | "nowMs">): number {
  if (i.win) return secondsUntilDeadline(i.win.deadlineMs, i.nowMs);
  if (i.winner?.claimedAt == null) return 0;
  return paymentSecondsLeft(i.winner.claimedAt, i.nowMs);
}

export function isPendingWin(i: PendingWinInput): boolean {
  if (!isMyEndedWin(i)) return false;
  if (i.hasOrder !== false) return false;
  return pendingSecondsLeft(i) > 0;
}
