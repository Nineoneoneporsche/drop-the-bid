// PG merchant review mode (Kakao Pay 독립몰 심사, 2026-11). TEMPORARY:
// turn off (false) after the review / once a payment provider is wired —
// see the restore list in DTB_CURRENT_STATE.md.
//
// While on and a round is live:
//   - home shows "상시 참여 가능" and the time until the price reaches the
//     floor, with a 드랍 참여하기 button instead of 관전하기;
//   - /join asks am_i_review_account() and offers the participant role to a
//     listed reviewer account (supabase/ops/review_accounts.sql). Everyone
//     else still only spectates — the DB enforces that either way
//     (supabase/migrations/20261119100000_review_account_live_join.sql).
import type { GameConfig } from "../context/GameContext";
import { priceAndStageAtElapsed } from "./dropPrice";

export const REVIEW_DROP_MODE = true;

// Earliest moment (epoch ms) the price is at the floor, or null if it never
// gets there within MAX_SEARCH_SECONDS. Paused time pushes it later.
const MAX_SEARCH_SECONDS = 60 * 60 * 24 * 60;

export function floorReachedAtMs(gameStartedAtMs: number, config: GameConfig, pausedTotalMs: number): number | null {
  const atFloor = (t: number) => priceAndStageAtElapsed(t, config).price <= config.floorPrice;
  if (!atFloor(MAX_SEARCH_SECONDS)) return null;
  let lo = 0;
  let hi = MAX_SEARCH_SECONDS;
  // Price only ever steps down, so bisect to 1 ms.
  while (hi - lo > 0.001) {
    const mid = (lo + hi) / 2;
    if (atFloor(mid)) hi = mid;
    else lo = mid;
  }
  // hi is within 1 ms above the exact step; settle on the first whole ms.
  let ms = Math.floor(hi * 1000);
  if (!atFloor(ms / 1000)) ms += 1;
  return gameStartedAtMs + pausedTotalMs + ms;
}
