"use client";

// "Does the signed-in user have a won-but-unpaid auction they can still pay
// for?" — drives the "결제 계속하기" recovery CTA on home, My Page and /join.
// UX only: /api/payment/confirm re-checks everything server-side (auth
// user, winner_id, amount, phase, payment window, shipping) no matter what
// this says.
//
// Pending when ALL hold:
//   1. a non-anonymous Supabase Auth session whose user.id === winner id
//   2. game_state.phase === "ended"
//   3. winner_claimed_at is set and the payment window hasn't elapsed
//      (WINNER_PAYMENT_WINDOW_SECONDS, measured on the server-synced clock)
//   4. no order of the user's for this win (same rule as the admin
//      payment-status route: amount = winner_price, created_at >=
//      winner_claimed_at; RLS limits the query to the user's own rows)
//
// The orders lookup runs once per (user, win) and again only when the page
// regains focus/visibility; the countdown is a local 1s timer.

import { useCallback, useEffect, useState } from "react";
import { useGame } from "../context/GameContext";
import { supabase } from "./supabase";
import { getServerNow } from "./serverClock";
import { isMyEndedWin, isPendingWin, paymentSecondsLeft } from "./pendingWinRule";
import { hasOrderForWin } from "./winOrder";

export type PendingWin = {
  pending: boolean;
  remainingSeconds: number;
};

export function usePendingWin(): PendingWin {
  const { state } = useGame();
  const winner = state.winner;

  const [userId, setUserId] = useState<string | null>(null);
  // null = not checked yet; the CTA stays hidden until the orders lookup
  // has actually confirmed there is no order for this win.
  const [hasOrder, setHasOrder] = useState<boolean | null>(null);
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    const apply = (u: { id: string; is_anonymous?: boolean } | null | undefined) =>
      setUserId(u && !u.is_anonymous ? u.id : null);
    supabase.auth.getSession().then(({ data: { session } }) => apply(session?.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => apply(session?.user));
    return () => sub.subscription.unsubscribe();
  }, []);

  const myEndedWin = isMyEndedWin({ userId, phase: state.phase, winner });
  const claimedAt = myEndedWin ? winner!.claimedAt! : null;
  const price = myEndedWin ? winner!.price : null;

  const checkOrder = useCallback(async () => {
    if (claimedAt == null || price == null || !userId) return;
    const found = await hasOrderForWin(userId, price, claimedAt);
    // A failed lookup can't prove "already paid", so it leaves the CTA
    // available — the server/DB still refuses a duplicate payment.
    setHasOrder(found ?? false);
  }, [claimedAt, price, userId]);

  useEffect(() => {
    setHasOrder(null);
    if (claimedAt == null) return;
    void checkOrder();
    const onFocus = () => { void checkOrder(); };
    const onVisible = () => { if (document.visibilityState === "visible") void checkOrder(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [claimedAt, checkOrder]);

  useEffect(() => {
    if (claimedAt == null) { setRemaining(0); return; }
    const tick = () => setRemaining(paymentSecondsLeft(claimedAt, getServerNow()));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [claimedAt]);

  return {
    // remaining is the local 1s timer's value, so the CTA disappears on the
    // tick the window closes.
    pending: isPendingWin({ userId, phase: state.phase, winner, hasOrder, nowMs: getServerNow() }) && remaining > 0,
    remainingSeconds: remaining,
  };
}
