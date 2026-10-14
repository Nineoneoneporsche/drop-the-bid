-- Hotfix: admin_reset_game() must not erase a win the winner can still pay
-- for.
--
-- The current win lives only in game_state (winner_id / winner_price /
-- winner_claimed_at), and admin_reset_game() nulls all of it. Reset during
-- the payment window used to silently destroy an unpaid win: /payment and
-- /api/payment/confirm both read the win from game_state, so the winner
-- could no longer pay and nothing else recorded the win. Until wins get a
-- durable record of their own, the reset itself refuses — in the DB, so no
-- caller (admin UI, API route, raw RPC) can bypass it.
--
-- BASE DEFINITION: this replaces the function that is actually live in
-- production, which is the 20260921100000_anti_multi_account.sql version
-- (clears device_round_guard, rolls round_key). It is NOT based on
-- 20260921130000_fix_reset_game_pause_fields.sql — that file was never
-- applied to production (its reset drops the device_round_guard / round_key
-- handling and adds pause-field resets production doesn't have). The four
-- reset statements below are copied verbatim from the production
-- definition; only the guard in front of them is new.
--
-- Refused (fail-closed) when game_state.phase = 'ended' with winner_id and
-- winner_claimed_at set, and EITHER
--   a. an attempt for this win is 'pending' or 'reconciliation_required'
--      (payment in flight / outcome unknown — an operator resolves it
--      first, whatever the time), OR
--   b. the win isn't paid and winner_claimed_at + 1800s hasn't passed.
-- Allowed when the win is paid, when the window expired with no live
-- attempt, or when there is no ended win at all (unchanged behaviour).
--
-- 1800 seconds = WINNER_PAYMENT_WINDOW_SECONDS in app/lib/paymentWindow.ts
-- (tests/resetGuard.test.ts fails if the two drift apart).
--
-- "Attempt for this win": payment_attempts with this winner_id and
-- win_claimed_at = winner_claimed_at (what the confirm route stamps), plus —
-- for rows written before win_claimed_at existed — win_claimed_at null,
-- same amount, created at/after winner_claimed_at. "Paid": such an attempt
-- is 'paid', or a matching order exists (same winner_id and amount,
-- created at/after winner_claimed_at).
--
-- Concurrency: game_state is locked FOR UPDATE first (claim_winner() and
-- join_game_participant() take the same lock), so the check and the reset
-- are atomic with respect to a new claim. A confirm request racing the
-- reset can't open a new payment the reset didn't account for: if the
-- window has expired its own window check refuses it, and if the win is
-- paid the one-active-payment-per-win index refuses it.
--
-- Errors use SQLSTATE P0001 with a fixed 'reset_blocked:<reason>' message
-- (mapped to Korean text by app/api/admin/reset-game/route.ts) and the
-- payment deadline (UTC ISO) in DETAIL.
--
-- CREATE OR REPLACE keeps the function's owner and privileges; they are
-- re-asserted below anyway and verified.
--
-- Run this manually in the Supabase SQL Editor (Database > SQL Editor).
--
-- APPLIED TO PRODUCTION 2026-10-14. The function as stored in production
-- carries no comments inside its body, so the body below has none either:
-- the guard is the block before "delete from chat_messages" (a = pending /
-- reconciliation_required check, b = unpaid-inside-window check) and the
-- four statements from "delete from chat_messages" on are the production
-- reset, verbatim. Normalized body hash, i.e.
-- md5(regexp_replace(prosrc, '\s+', '', 'g')), matches production:
-- 98d7f243bc610c9d071c638bab7b8116 (tests/resetGuard.test.ts checks it).
-- Don't edit the function here — write a new migration instead, so this
-- file keeps matching production.

begin;

set local lock_timeout = '5s';

create or replace function public.admin_reset_game()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gs            record;
  v_deadline      timestamptz;
  v_live_status   text;
  v_paid          boolean;
begin
  select phase, winner_id, winner_price, winner_claimed_at
    into v_gs
  from game_state
  where id = 1
  for update;

  if v_gs.phase = 'ended' and v_gs.winner_id is not null and v_gs.winner_claimed_at is not null then
    v_deadline := v_gs.winner_claimed_at + interval '1800 seconds';

    select pa.status into v_live_status
    from payment_attempts pa
    where pa.winner_id = v_gs.winner_id
      and pa.status in ('pending', 'reconciliation_required')
      and (
        pa.win_claimed_at = v_gs.winner_claimed_at
        or (pa.win_claimed_at is null
            and pa.amount = v_gs.winner_price
            and pa.created_at >= v_gs.winner_claimed_at)
      )
    order by (pa.status = 'reconciliation_required') desc
    limit 1;

    if v_live_status is not null then
      raise exception using
        errcode = 'P0001',
        message = case when v_live_status = 'reconciliation_required'
                       then 'reset_blocked:payment_needs_review'
                       else 'reset_blocked:payment_in_progress' end,
        detail  = to_char(v_deadline at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
    end if;

    select exists (
             select 1 from payment_attempts pa
             where pa.winner_id = v_gs.winner_id
               and pa.status = 'paid'
               and (
                 pa.win_claimed_at = v_gs.winner_claimed_at
                 or (pa.win_claimed_at is null
                     and pa.amount = v_gs.winner_price
                     and pa.created_at >= v_gs.winner_claimed_at)
               )
           )
        or exists (
             select 1 from orders o
             where o.winner_id = v_gs.winner_id
               and o.amount = v_gs.winner_price
               and o.created_at >= v_gs.winner_claimed_at
           )
      into v_paid;

    if not v_paid and now() < v_deadline then
      raise exception using
        errcode = 'P0001',
        message = 'reset_blocked:unpaid_win_in_payment_window',
        detail  = to_char(v_deadline at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
    end if;
  end if;

  delete from chat_messages where true;
  delete from participants where true;
  delete from device_round_guard where true;
  update game_state set
    phase = 'waiting',
    strategy_started_at = null,
    game_started_at = null,
    winner_id = null,
    winner_nickname = null,
    winner_price = null,
    winner_claimed_at = null,
    round_key = gen_random_uuid()
  where id = 1;
end;
$$;

revoke all on function public.admin_reset_game() from public, anon, authenticated;
grant execute on function public.admin_reset_game() to service_role;

-- ── Post-conditions (any failure rolls back) ────────────────────────────────
do $$
declare
  v_def text;
begin
  if has_function_privilege('anon', 'public.admin_reset_game()', 'execute')
     or has_function_privilege('authenticated', 'public.admin_reset_game()', 'execute') then
    raise exception 'post-condition failed: a client role can execute admin_reset_game()';
  end if;
  if not has_function_privilege('service_role', 'public.admin_reset_game()', 'execute') then
    raise exception 'post-condition failed: service_role cannot execute admin_reset_game()';
  end if;

  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'admin_reset_game' and p.prosecdef;

  if v_def is null then
    raise exception 'post-condition failed: admin_reset_game() missing or not security definer';
  end if;
  if v_def not like '%reset_blocked:unpaid_win_in_payment_window%' then
    raise exception 'post-condition failed: payable-win guard missing';
  end if;
  if v_def not like '%delete from device_round_guard where true;%'
     or v_def not like '%round_key = gen_random_uuid()%' then
    raise exception 'post-condition failed: production reset body (device_round_guard / round_key) not preserved';
  end if;
  if v_def like '%paused_total_ms%' then
    raise exception 'post-condition failed: unexpected pause-field reset added';
  end if;
end $$;

commit;
