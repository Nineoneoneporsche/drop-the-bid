-- Fix: admin_reset_game() also clears the pause state.
--
-- Production incident 2026-10-22: after a reset, the next round came up
-- already paused (phase='game', is_paused=true, paused_total_ms=0,
-- pause_reason='health_lease_expired', paused_at ~40 min BEFORE
-- game_started_at). The previous round had been auto-paused by the health
-- lease and the reset carried that pause straight over, because
-- admin_reset_game() never touches is_paused / paused_at / paused_total_ms /
-- pause_reason (columns from 20260917100000_fail_closed_pause.sql). A
-- carried-over paused_total_ms would likewise skew the next round's
-- claim_winner() price, and resuming a carried-over pause folds the whole
-- gap since the old paused_at into paused_total_ms.
--
-- BASE DEFINITION: this replaces the function that is actually live in
-- production, the 20261008100000_block_reset_of_payable_win.sql version
-- (normalized body md5 98d7f243bc610c9d071c638bab7b8116, enforced by the
-- pre-condition below — anything else aborts). It is NOT based on
-- 20260921130000_fix_reset_game_pause_fields.sql, which was never applied
-- and drops the payable-win guard, the device_round_guard delete and the
-- round_key rotation.
--
-- The ONLY change is four added assignments in the final UPDATE:
--   is_paused = false, paused_at = null, paused_total_ms = 0, pause_reason = null
-- The guard (pending / reconciliation_required / unpaid inside the 1800s
-- window), the chat / participants / device_round_guard deletes and the
-- round_key rotation are byte-for-byte unchanged. A refused reset raises
-- before the UPDATE, so it still changes nothing — pause state included.
-- service_health is deliberately not touched: start_game() and
-- admin_force_start_game() renew the lease when a round starts.
--
-- Like the 1008 version, the stored body carries no comments. New
-- normalized body md5, i.e. md5(regexp_replace(prosrc, '\s+', '', 'g')):
-- aa6bedbe02fd7b8563a87a0aca2f7a42 (tests/resetPauseFields.test.ts checks it).
--
-- This file changes no data. The row that is currently stuck paused is
-- cleared by running the the fixed version reset afterwards — not by resume, which
-- would add the ~40 min gap to paused_total_ms.
--
-- Rollback: supabase/rollbacks/20261022100000_reset_clears_pause_fields.rollback.sql
-- (runs only if this version is live; restores the 98d7f243… body).
--
-- Run this manually in the Supabase SQL Editor (Database > SQL Editor).

begin;

set local lock_timeout = '5s';

-- ── Pre-conditions (any failure aborts before anything changes) ────────────
do $$
declare
  v_n   int;
  v_md5 text;
begin
  -- 1. The four pause columns exist with the expected types / nullability.
  select count(*) into v_n
  from information_schema.columns
  where table_schema = 'public' and table_name = 'game_state'
    and ((column_name = 'is_paused'       and data_type = 'boolean'                  and is_nullable = 'NO')
      or (column_name = 'paused_at'       and data_type = 'timestamp with time zone')
      or (column_name = 'paused_total_ms' and data_type = 'bigint'                   and is_nullable = 'NO')
      or (column_name = 'pause_reason'    and data_type = 'text'));
  if v_n <> 4 then
    raise exception 'precondition failed: game_state pause columns differ from expected (found % of 4)', v_n;
  end if;

  -- 2. Exactly one admin_reset_game(), security definer, search_path=public,
  --    normalized body md5 = 98d7f243… (the production / 1008 version).
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'admin_reset_game';
  if v_n <> 1 then
    raise exception 'precondition failed: expected exactly 1 admin_reset_game, found %', v_n;
  end if;

  select md5(regexp_replace(p.prosrc, '\s+', '', 'g')) into v_md5
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'admin_reset_game'
    and p.prosecdef and p.proconfig @> array['search_path=public'];
  if v_md5 is distinct from '98d7f243bc610c9d071c638bab7b8116' then
    raise exception 'precondition failed: admin_reset_game body md5 is %, expected 98d7f243bc610c9d071c638bab7b8116', coalesce(v_md5, '<missing/not secdef>');
  end if;
end $$;

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
    is_paused = false,
    paused_at = null,
    paused_total_ms = 0,
    pause_reason = null,
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
  v_md5 text;
begin
  if has_function_privilege('anon', 'public.admin_reset_game()', 'execute')
     or has_function_privilege('authenticated', 'public.admin_reset_game()', 'execute') then
    raise exception 'post-condition failed: a client role can execute admin_reset_game()';
  end if;
  if not has_function_privilege('service_role', 'public.admin_reset_game()', 'execute') then
    raise exception 'post-condition failed: service_role cannot execute admin_reset_game()';
  end if;

  select pg_get_functiondef(p.oid), md5(regexp_replace(p.prosrc, '\s+', '', 'g')) into v_def, v_md5
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'admin_reset_game'
    and p.prosecdef and p.proconfig @> array['search_path=public'];

  if v_md5 is distinct from 'aa6bedbe02fd7b8563a87a0aca2f7a42' then
    raise exception 'post-condition failed: admin_reset_game body md5 is %, expected aa6bedbe02fd7b8563a87a0aca2f7a42', coalesce(v_md5, '<missing>');
  end if;
  if v_def not like '%reset_blocked:unpaid_win_in_payment_window%'
     or v_def not like '%reset_blocked:payment_in_progress%'
     or v_def not like '%reset_blocked:payment_needs_review%' then
    raise exception 'post-condition failed: payable-win / payment guard missing';
  end if;
  if v_def not like '%delete from device_round_guard where true;%'
     or v_def not like '%round_key = gen_random_uuid()%' then
    raise exception 'post-condition failed: device_round_guard / round_key handling not preserved';
  end if;
  if v_def not like '%is_paused = false,%' or v_def not like '%paused_at = null,%'
     or v_def not like '%paused_total_ms = 0,%' or v_def not like '%pause_reason = null,%' then
    raise exception 'post-condition failed: pause-field reset missing';
  end if;
end $$;

commit;

-- ── Postcheck (read-only; run separately after applying) ────────────────────
-- select md5(regexp_replace(p.prosrc, '\s+', '', 'g')) = 'aa6bedbe02fd7b8563a87a0aca2f7a42' as is_fixed_version,
--        p.prosecdef, p.proconfig,
--        has_function_privilege('anon', 'public.admin_reset_game()', 'execute') as anon_exec,
--        has_function_privilege('authenticated', 'public.admin_reset_game()', 'execute') as auth_exec,
--        has_function_privilege('service_role', 'public.admin_reset_game()', 'execute') as svc_exec
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname = 'admin_reset_game';
-- Expected: true, true, {search_path=public}, false, false, true.
