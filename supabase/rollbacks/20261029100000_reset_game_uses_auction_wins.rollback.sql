-- EMERGENCY ROLLBACK for supabase/migrations/20261029100000_reset_game_uses_auction_wins.sql (M2).
--
-- NOT a migration: it lives outside supabase/migrations on purpose, so a
-- fresh replay never undoes M2. Run it by hand in the Supabase SQL Editor
-- only if M2 has to be taken back.
--
-- Restores admin_reset_game() to the pre-M2 body — the
-- 20261022100000_reset_clears_pause_fields.sql definition (normalized md5
-- aa6bedbe02fd7b8563a87a0aca2f7a42), copied verbatim below. That version
-- judges the current win from game_state + heuristics again; auction_wins,
-- payment_attempts.win_id and orders.win_id (M1) are left as they are. No
-- data is changed. Owner, EXECUTE grants and config are kept (CREATE OR
-- REPLACE) and checked afterwards.
--
-- Refuses (nothing changes) unless admin_reset_game() is exactly the M2 body
-- (md5 e74405580db4c4694302f25e9d9d1e37). game_state is locked FOR UPDATE
-- until commit so no reset runs while the function is swapped.
--
-- MIGRATION HISTORY WARNING:
--   - Once M2 has been applied with `db push` and recorded as applied in
--     supabase_migrations.schema_migrations, running this script by hand
--     only reverts the FUNCTION. Migration history is NOT changed: version
--     20261029100000 stays recorded as applied.
--   - After a successful rollback, do NOT run `db push` again until the
--     remote migration history has been verified and reconciled separately.
--   - If needed, `migration repair --status reverted 20261029100000` is run
--     as a separate, controlled step, only after the rollback has been
--     verified.
--   - This script must never modify supabase_migrations directly.

begin;

set local lock_timeout = '5s';

-- ── 0. Preconditions ────────────────────────────────────────────────────────
do $$
declare
  v_n int;
begin
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'admin_reset_game';
  if v_n <> 1 then
    raise exception 'rollback refused: expected exactly 1 admin_reset_game, found %', v_n;
  end if;
  if not exists (
    select 1 from pg_proc p
    where p.oid = to_regprocedure('public.admin_reset_game()')
      and p.prosecdef
      and p.proconfig @> array['search_path=public']
      and md5(regexp_replace(p.prosrc, '\s+', '', 'g')) = 'e74405580db4c4694302f25e9d9d1e37'
  ) then
    raise exception 'rollback refused: admin_reset_game() is not the M2 definition (md5 e74405580db4c4694302f25e9d9d1e37)';
  end if;
  perform 1 from game_state where id = 1 for update;
  if not found then
    raise exception 'rollback refused: game_state row id = 1 missing';
  end if;
end $$;

create temp table m2_rollback_before on commit drop as
  select p.proowner, p.proacl::text acl, p.proconfig
  from pg_proc p where p.oid = 'public.admin_reset_game()'::regprocedure;

-- ── 1. Pre-M2 admin_reset_game() (20261022100000, verbatim) ────────────────
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

-- ── Post-conditions (any failure rolls back) ────────────────────────────────
do $$
declare
  v_fn     record;
  v_before record;
begin
  select p.prosecdef, p.proconfig, p.proowner, p.proacl::text acl,
         md5(regexp_replace(p.prosrc, '\s+', '', 'g')) h
    into v_fn
  from pg_proc p where p.oid = 'public.admin_reset_game()'::regprocedure;
  select * into v_before from m2_rollback_before;

  if v_fn.h is distinct from 'aa6bedbe02fd7b8563a87a0aca2f7a42' then
    raise exception 'rollback post-condition failed: admin_reset_game body md5 is %, expected aa6bedbe02fd7b8563a87a0aca2f7a42', v_fn.h;
  end if;
  if not v_fn.prosecdef or not (v_fn.proconfig @> array['search_path=public']) then
    raise exception 'rollback post-condition failed: admin_reset_game() lost security definer / search_path=public';
  end if;
  if v_fn.proowner <> v_before.proowner or v_fn.acl is distinct from v_before.acl
     or v_fn.proconfig is distinct from v_before.proconfig then
    raise exception 'rollback post-condition failed: admin_reset_game() owner / EXECUTE grants / config changed';
  end if;
end $$;

commit;
