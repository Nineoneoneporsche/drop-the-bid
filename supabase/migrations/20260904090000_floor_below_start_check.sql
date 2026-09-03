-- Guards against saving a config where minimum_price (floor) is at or above
-- start_price. Without this, calc_drop_price's greatest(minimum_price, ...)
-- clamps the price to the floor from t=0, so the auction fails on its very
-- first tick before anyone can bid. Mirrors the same check now added to
-- validateDropZones() in app/context/GameContext.tsx — keep both in sync.
--
-- Run this manually in the Supabase SQL Editor (Database > SQL Editor).

begin;

alter table public.game_state
  drop constraint if exists game_state_floor_below_start;

alter table public.game_state
  add constraint game_state_floor_below_start check (minimum_price < start_price);

commit;
