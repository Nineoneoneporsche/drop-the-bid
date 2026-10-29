-- EMERGENCY ROLLBACK for supabase/migrations/20261028150000_auction_wins.sql.
--
-- NOT a migration: it lives outside supabase/migrations on purpose, so a
-- fresh replay never undoes M1. Run it by hand in the Supabase SQL Editor
-- only if M1 has to be taken back.
--
-- Restores claim_winner() to the pre-M1 production body (the
-- 20261014100000 definition, normalized md5
-- e3acb73770e04ed160902af75732ae93, copied verbatim below), then drops the
-- two win_id indexes, orders.win_id, payment_attempts.win_id and
-- auction_wins, in dependency order.
--
-- Refuses (nothing changes) unless:
--   - claim_winner() is exactly the M1 body (md5 3b84dfd5ca929a55d5c093209693d225)
--   - game_state is in 'waiting' / 'strategy' with no winner (row locked
--     FOR UPDATE until commit, so no claim runs while this does)
--   - auction_wins is EMPTY and no payment_attempts / orders row has a
--     win_id. Once a real win is recorded, dropping the table would destroy
--     the ledger — don't use this script then; restore only claim_winner()
--     from section 1 by hand if that is what is needed.
--
-- MIGRATION HISTORY WARNING:
--   - Once M1 has been applied with `db push` and recorded as applied in
--     supabase_migrations.schema_migrations, running this script by hand
--     only reverts the SCHEMA. Migration history is NOT changed: version
--     20261028150000 stays recorded as applied.
--   - After a successful rollback, do NOT run `db push` again until the
--     remote migration history has been verified and reconciled separately.
--   - If needed, `migration repair --status reverted 20261028150000` is run
--     as a separate, controlled step, only after the schema rollback has
--     been verified.
--   - This script must never modify supabase_migrations directly.

begin;

set local lock_timeout = '5s';

-- ── 0. Preconditions ────────────────────────────────────────────────────────
do $$
declare
  v_gs record;
  v_n  bigint;
begin
  if to_regclass('public.auction_wins') is null then
    raise exception 'rollback refused: public.auction_wins does not exist (M1 not applied?)';
  end if;

  if not exists (
    select 1 from pg_proc p
    where p.oid = to_regprocedure('public.claim_winner()')
      and p.prosecdef
      and p.proconfig @> array['search_path=public']
      and md5(regexp_replace(p.prosrc, '\s+', '', 'g')) = '3b84dfd5ca929a55d5c093209693d225'
  ) then
    raise exception 'rollback refused: claim_winner() is not the M1 definition (md5 3b84dfd5ca929a55d5c093209693d225)';
  end if;

  select phase, winner_id, winner_claimed_at into v_gs
  from public.game_state where id = 1 for update;
  if not found or v_gs.winner_id is not null or v_gs.winner_claimed_at is not null
     or v_gs.phase not in ('waiting', 'strategy') then
    raise exception 'rollback refused: a round is in progress or has a winner — run in waiting/strategy with no winner';
  end if;

  select count(*) into v_n from public.auction_wins;
  if v_n <> 0 then
    raise exception 'rollback refused: auction_wins has % row(s) — dropping it would destroy recorded wins', v_n;
  end if;

  select (select count(*) from public.payment_attempts where win_id is not null)
       + (select count(*) from public.orders where win_id is not null) into v_n;
  if v_n <> 0 then
    raise exception 'rollback refused: % payment_attempts/orders row(s) reference a win_id', v_n;
  end if;

  create temp table m1_rollback_claim_winner_before on commit drop as
  select p.proowner, p.proacl::text acl, p.proconfig
  from pg_proc p where p.oid = 'public.claim_winner()'::regprocedure;
end $$;

-- ── 1. claim_winner(): pre-M1 body (20261014100000, verbatim) ──────────────
create or replace function public.claim_winner()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid         uuid := auth.uid();
  v_row         game_state%rowtype;
  v_price       integer;
  v_nickname    text;
  v_lease_until timestamptz;
begin
  if v_uid is null then
    return false;
  end if;

  select nickname into v_nickname
  from participants
  where guest_id = v_uid and role = 'participant';

  if v_nickname is null then
    return false;
  end if;

  select * into v_row from game_state where id = 1 for update;

  if v_row.phase <> 'game' or v_row.winner_id is not null or v_row.game_started_at is null then
    return false;
  end if;

  if not exists (
    select 1
    from account_round_guard g
    where g.round_key = v_row.round_key
      and g.user_id = v_uid
      and g.session_id::text = coalesce(auth.jwt() ->> 'session_id', '')
  ) then
    return false;
  end if;

  if v_row.is_paused then
    return false;
  end if;

  -- Health-lease gate: catches the exact window right after an outage
  -- recovers, before the next heartbeat tick has had a chance to run
  -- touch_health_lease() and auto-pause on our behalf. If the lease is
  -- missing or stale, pause here directly instead of letting this claim
  -- go through against a price that may have silently drifted during
  -- the outage.
  select lease_until into v_lease_until
  from service_health
  where service_name = 'auction_api';

  if v_lease_until is null or v_lease_until < now() then
    update game_state
    set is_paused = true,
        paused_at = greatest(v_row.game_started_at, coalesce(v_lease_until, now())),
        pause_reason = 'health_lease_expired'
    where id = 1 and is_paused = false;
    return false;
  end if;

  v_price := calc_drop_price(
    extract(epoch from (now() - v_row.game_started_at)) - (v_row.paused_total_ms / 1000.0),
    v_row.start_price, v_row.minimum_price, v_row.drop_amount,
    v_row.fast_drop_price, v_row.fast_drop_amount,
    v_row.final_drop_price, v_row.final_drop_amount,
    v_row.drop_interval_seconds,
    v_row.fast_drop_interval_seconds,
    v_row.final_drop_interval_seconds
  );

  update game_state
  set winner_id = v_uid,
      winner_nickname = v_nickname,
      winner_price = v_price,
      winner_claimed_at = now(),
      phase = 'ended'
  where id = 1;

  insert into chat_messages (guest_id, nickname, message, kind)
  values (
    v_uid, 'system',
    '🎉 ' || v_nickname || '님이 ₩' || to_char(v_price, 'FM999,999,999') || '에 낙찰받았습니다!',
    'system'
  );

  return true;
end;
$$;

-- ── 2. Drop M1 structures (dependents first) ────────────────────────────────
drop index public.payment_attempts_one_active_per_win_id;
drop index public.orders_one_per_win;
alter table public.orders drop column win_id;
alter table public.payment_attempts drop column win_id;
drop table public.auction_wins;

-- ── Post-conditions (any failure rolls back) ────────────────────────────────
do $$
declare
  v_fn     record;
  v_before record;
begin
  select p.prosecdef, p.proconfig, p.proowner, p.proacl::text acl,
         md5(regexp_replace(p.prosrc, '\s+', '', 'g')) h into v_fn
  from pg_proc p where p.oid = 'public.claim_winner()'::regprocedure;
  select * into v_before from m1_rollback_claim_winner_before;

  if v_fn.h <> 'e3acb73770e04ed160902af75732ae93' then
    raise exception 'post-condition failed: claim_winner() md5 is %, expected e3acb73770e04ed160902af75732ae93', v_fn.h;
  end if;
  if not v_fn.prosecdef or v_fn.proowner <> v_before.proowner
     or v_fn.acl is distinct from v_before.acl or v_fn.proconfig is distinct from v_before.proconfig then
    raise exception 'post-condition failed: claim_winner() security definer / owner / grants / config changed';
  end if;
  if to_regclass('public.auction_wins') is not null
     or exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name in ('payment_attempts', 'orders') and column_name = 'win_id') then
    raise exception 'post-condition failed: M1 structures still present';
  end if;
  if to_regclass('public.payment_attempts_one_active_per_win') is null then
    raise exception 'post-condition failed: the (winner_id, win_claimed_at) index is missing';
  end if;
end $$;

commit;
