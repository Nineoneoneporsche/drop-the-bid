-- Drop Zone pricing: adds a 3-stage price-drop schedule (NORMAL / FAST DROP /
-- FINAL DROP) to game_state, and moves winning-price computation fully
-- server-side so claim_winner never trusts the client-reported price.
--
-- NOTE ON claim_winner: this environment has no Supabase CLI link and no
-- direct DB connection, and PostgREST doesn't expose function source, so the
-- previous claim_winner body could not be read directly. It's reconstructed
-- here from its observed external contract (call signature, atomic
-- single-winner guard, phase -> 'ended' on win, and the
-- "🎉 {nickname}님이 {price}에 낙찰받았습니다!" system chat message —
-- confirmed live against a real winning row before writing this). Please
-- review before running if claim_winner does anything beyond that.
--
-- Run this manually in the Supabase SQL Editor (Database > SQL Editor).

begin;

-- ── Schema: optional 3-stage drop schedule ──────────────────────────────────
-- All four columns NULL = legacy single-rate behavior (unchanged). Setting
-- fast_drop_price/fast_drop_amount enables FAST DROP ZONE; additionally
-- setting final_drop_price/final_drop_amount enables FINAL DROP ZONE on top
-- of that. minimum_price (existing column) remains the absolute floor for
-- every stage.
alter table public.game_state
  add column if not exists fast_drop_price   integer,
  add column if not exists fast_drop_amount  integer,
  add column if not exists final_drop_price  integer,
  add column if not exists final_drop_amount integer;

-- Enforced at the DB layer so an invalid 3-stage config can never be saved
-- in the first place — which is what actually keeps a badly configured
-- auction from starting, regardless of which code path saves the config.
--
-- NOTE: a plain `check (fast_drop_price is null or fast_drop_amount > 0)`
-- is NOT enough — Postgres CHECK passes when the expression evaluates to
-- NULL (not just TRUE), so a half-set row (fast_drop_price set,
-- fast_drop_amount left NULL) would make `fast_drop_amount > 0` evaluate to
-- NULL and the constraint would silently pass. Every clause below is
-- written to force an explicit TRUE/FALSE for every combination of
-- NULL/non-NULL inputs, never leaving a NULL-comparison path unguarded.
alter table public.game_state
  drop constraint if exists game_state_fast_zone_valid,
  drop constraint if exists game_state_final_zone_valid;

alter table public.game_state
  -- FAST: price and amount must both be NULL (zone disabled) or both set
  -- (zone enabled) — never one without the other. When enabled: amount > 0,
  -- and minimum_price < fast_drop_price < start_price.
  add constraint game_state_fast_zone_valid check (
    (fast_drop_price is null and fast_drop_amount is null)
    or (
      fast_drop_price is not null and fast_drop_amount is not null
      and fast_drop_amount > 0
      and fast_drop_price > minimum_price
      and fast_drop_price < start_price
    )
  ),
  -- FINAL: same both-or-neither pairing, and requires FAST to be fully
  -- configured (fast_drop_price/-amount already guaranteed non-NULL
  -- together by the constraint above once fast_drop_price is not null).
  -- When enabled: amount > 0, and minimum_price < final_drop_price <
  -- fast_drop_price — which, chained with the FAST clause above, gives the
  -- full minimum_price < final_drop_price < fast_drop_price < start_price
  -- ordering.
  add constraint game_state_final_zone_valid check (
    (final_drop_price is null and final_drop_amount is null)
    or (
      final_drop_price is not null and final_drop_amount is not null
      and fast_drop_price is not null
      and final_drop_amount > 0
      and final_drop_price > minimum_price
      and final_drop_price < fast_drop_price
    )
  );

-- ── Canonical price for elapsed seconds `t` into the game ──────────────────
-- Mirrors app/context/GameContext.tsx's calcPriceAndStage() exactly — keep
-- both in sync if either changes. NORMAL runs start_price -> fast_drop_price
-- at drop_amount/sec, FAST runs fast_drop_price -> final_drop_price at
-- fast_drop_amount/sec, FINAL runs final_drop_price -> minimum_price at
-- final_drop_amount/sec. Any undefined stage falls back to holding at
-- minimum_price using the last configured rate.
create or replace function public.calc_drop_price(
  p_elapsed_seconds numeric,
  p_start_price      integer,
  p_minimum_price    integer,
  p_drop_amount      integer,
  p_fast_price       integer,
  p_fast_amount      integer,
  p_final_price      integer,
  p_final_amount     integer
) returns integer
language plpgsql
immutable
as $$
declare
  t_fast  numeric; -- seconds spent in NORMAL zone before reaching fast_price
  t_final numeric; -- seconds spent in FAST zone before reaching final_price
begin
  if p_fast_price is null then
    return greatest(p_minimum_price, p_start_price - round(p_elapsed_seconds * p_drop_amount)::integer);
  end if;

  t_fast := (p_start_price - p_fast_price) / p_drop_amount::numeric;

  if p_elapsed_seconds <= t_fast then
    return p_start_price - round(p_elapsed_seconds * p_drop_amount)::integer;
  end if;

  if p_final_price is null then
    return greatest(p_minimum_price,
      p_fast_price - round((p_elapsed_seconds - t_fast) * p_fast_amount)::integer);
  end if;

  t_final := (p_fast_price - p_final_price) / p_fast_amount::numeric;

  if p_elapsed_seconds <= t_fast + t_final then
    return p_fast_price - round((p_elapsed_seconds - t_fast) * p_fast_amount)::integer;
  end if;

  return greatest(p_minimum_price,
    p_final_price - round((p_elapsed_seconds - t_fast - t_final) * p_final_amount)::integer);
end;
$$;

-- ── Winner claim: server computes the authoritative price ──────────────────
-- p_price and p_nickname are still accepted (so the existing client call
-- site in GameContext.raiseHand() doesn't need to change) but neither is
-- trusted: p_price is ignored in favor of the server's own elapsed-time +
-- drop-zone calculation, and p_nickname is ignored in favor of the
-- nickname on file for p_guest_id in `participants`.
--
-- guest_id/nickname hardening: elsewhere in this app guest_id is an
-- unauthenticated UUID minted client-side (crypto.randomUUID(), never bound
-- to a Supabase Auth session) and nothing validates it against a live
-- participant before this function runs. Without the participants lookup
-- below, any anon caller could hand claim_winner a guest_id that never
-- joined (or already left) and still be recorded as the winner. The lookup
-- requires an active `role = 'participant'` row for p_guest_id, which is
-- the same identity the rest of the app already treats as authoritative
-- (participant counts, chat attribution, etc.) — this doesn't raise the
-- app's overall trust model, it just makes claim_winner check the one
-- thing it previously didn't.
create or replace function public.claim_winner(
  p_guest_id uuid,
  p_nickname text,
  p_price    integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row      game_state%rowtype;
  v_price    integer;
  v_nickname text;
begin
  select nickname into v_nickname
  from participants
  where guest_id = p_guest_id and role = 'participant';

  if v_nickname is null then
    return false; -- not a live participant — spectator, unknown, or already left
  end if;

  select * into v_row from game_state where id = 1 for update;

  if v_row.phase <> 'game' or v_row.winner_id is not null or v_row.game_started_at is null then
    return false;
  end if;

  v_price := calc_drop_price(
    extract(epoch from (now() - v_row.game_started_at)),
    v_row.start_price, v_row.minimum_price, v_row.drop_amount,
    v_row.fast_drop_price, v_row.fast_drop_amount,
    v_row.final_drop_price, v_row.final_drop_amount
  );

  update game_state
  set winner_id = p_guest_id,
      winner_nickname = v_nickname,
      winner_price = v_price,
      phase = 'ended'
  where id = 1;

  insert into chat_messages (guest_id, nickname, message, kind)
  values (
    p_guest_id, 'system',
    '🎉 ' || v_nickname || '님이 ₩' || to_char(v_price, 'FM999,999,999') || '에 낙찰받았습니다!',
    'system'
  );

  return true;
end;
$$;

commit;
