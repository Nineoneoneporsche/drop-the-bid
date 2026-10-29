"use client";

// "Does the signed-in user have a won-but-unpaid auction they can still pay
// for?" — drives the "결제 계속하기" recovery CTA on home, My Page and /join.
// UX only: /api/payment/confirm re-checks everything server-side (auth
// user, and the win's winner_id / amount / payment_deadline from
// auction_wins, shipping) no matter what this says.
//
// Pending when ALL hold:
//   1. a non-anonymous Supabase Auth session whose user.id === winner id
//   2. game_state.phase === "ended"
//   3. the payment deadline hasn't passed (server-synced clock):
//      - win recorded in auction_wins (every win since M1): that row's
//        payment_deadline
//      - legacy win (no row): winner_claimed_at + WINNER_PAYMENT_WINDOW_SECONDS
//   4. no order of the user's for this win:
//      - auction_wins win: an order with orders.win_id = that win's id (or,
//        for a win paid through the pre-deploy code, the legacy match on
//        that win's own price / claimed_at)
//      - legacy win: the old heuristic (no win_id, amount = winner_price,
//        created_at >= winner_claimed_at)
//      RLS limits both queries to the user's own rows.
//
// The win + orders lookups run once per (user, win) and again only when
// the page regains focus/visibility; the countdown is a local 1s timer.

import { useCallback, useEffect, useState } from "react";
import { useGame } from "../context/GameContext";
import { supabase } from "./supabase";
import { getServerNow } from "./serverClock";
import { isMyEndedWin, isPendingWin, pendingSecondsLeft } from "./pendingWinRule";
import { hasLegacyOrderForWin, hasOrderForAuctionWin } from "./winOrder";
import { fetchMyCurrentWin, type WinLookupClient } from "./auctionWin";

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

  // This round's auction_wins row; undefined = not looked up yet, null =
  // none (or the lookup failed) => legacy rule.
  const [win, setWin] = useState<{ id: string; deadlineMs: number } | null | undefined>(undefined);

  const checkOrder = useCallback(async () => {
    if (claimedAt == null || price == null || !userId) return;
    const current = await fetchMyCurrentWin(supabase as unknown as WinLookupClient);
    const recorded = current.status === "ok" ? current.win : null;
    setWin(recorded ? { id: recorded.id, deadlineMs: new Date(recorded.payment_deadline).getTime() } : null);
    const found = recorded
      ? await hasOrderForAuctionWin(userId, recorded)
      : await hasLegacyOrderForWin(userId, price, claimedAt);
    // A failed lookup can't prove "already paid", so it leaves the CTA
    // available — the server/DB still refuses a duplicate payment.
    setHasOrder(found ?? false);
  }, [claimedAt, price, userId]);

  useEffect(() => {
    setHasOrder(null);
    setWin(undefined);
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
    if (claimedAt == null || win === undefined) { setRemaining(0); return; }
    const tick = () => setRemaining(pendingSecondsLeft({ winner: { id: "", claimedAt }, win, nowMs: getServerNow() }));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [claimedAt, win]);

  return {
    // remaining is the local 1s timer's value, so the CTA disappears on the
    // tick the window closes.
    pending: win !== undefined && isPendingWin({ userId, phase: state.phase, winner, win, hasOrder, nowMs: getServerNow() }) && remaining > 0,
    remainingSeconds: remaining,
  };
}
