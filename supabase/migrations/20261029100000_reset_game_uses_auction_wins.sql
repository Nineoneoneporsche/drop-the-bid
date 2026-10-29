-- M2: admin_reset_game() judges the current win from auction_wins.
--
-- Until now the reset guard identified "the current win" from game_state
-- (winner_id / winner_price / winner_claimed_at) and matched payments by
-- heuristics: payment_attempts on (winner_id, win_claimed_at) or (amount,
-- created_at), orders on (winner_id, amount, created_at). Since M1
-- (20261028150000_auction_wins.sql) every win has a durable auction_wins row
-- and, since code deploy 1, every payment row carries win_id. This version
-- uses them:
--
--   current win     the auction_wins row whose round_key = game_state.round_key
--                   (unique). phase 'ended' with a winner but no such row —
--                   or a row for another winner — is ledger corruption:
--                   reset_blocked:win_record_missing / win_record_mismatch.
--                   Resetting would erase the only game_state evidence of
--                   that win, so it is refused (fail-closed).
--   deadline        auction_wins.payment_deadline (was winner_claimed_at +
--                   interval '1800 seconds').
--   in progress /   a pending / reconciliation_required payment_attempts row
--   needs review    for the win, regardless of the deadline. "For the win" =
--                   win_id = the win's id, or a row with no win_id stamped
--                   with the win's exact (winner_id, win_claimed_at) — the
--                   only shape the pre-deploy code could have written for a
--                   post-M1 win (claim_winner() writes the same instant to
--                   game_state.winner_claimed_at and auction_wins.claimed_at).
--   paid            an order with win_id = the win's id, or a paid attempt
--                   for the win (same match as above). A paid attempt is only
--                   ever set together with / after its order, so either is
--                   proof the charge succeeded. No amount / created_at
--                   heuristics: an order or attempt of another win (same
--                   user, same price) can never count.
--   unpaid          blocked while now() < payment_deadline, allowed after.
--
-- No legacy (pre-M1) fallback is needed: M1's precondition only applied it
-- with no winner on game_state, and since then claim_winner() has written
-- the auction_wins row in the same transaction as the winner. A pre-M1 win
-- can therefore no longer be the current one; an ended winner without its
-- row can only come from corruption. No auction_wins backfill.
--
-- Everything else is the 20261022100000 version unchanged: game_state row
-- lock, no phase restriction outside 'ended' + winner, the chat_messages /
-- participants / device_round_guard deletes, the winner / pause field reset
-- and round_key rotation. auction_wins, payment_attempts and orders are never
-- touched by a reset.
--
-- Normalized body md5 (md5(regexp_replace(prosrc, '\s+', '', 'g'))): before
-- aa6bedbe02fd7b8563a87a0aca2f7a42 (enforced below), after
-- e74405580db4c4694302f25e9d9d1e37 (enforced by the post-condition).
--
-- Deploy only through the Supabase CLI migration workflow (pinned CLI
-- v2.122.0, `db push --linked`). Do NOT execute this migration manually in
-- the Production SQL Editor: that bypasses supabase_migrations history.
-- No explicit BEGIN/COMMIT here on purpose: the CLI migration runner wraps
-- this file and its history INSERT in one transaction, so any failure
-- leaves neither a replaced function nor a history row.
--
-- Rollback (manual, emergency only, NOT a migration):
-- supabase/rollbacks/20261029100000_reset_game_uses_auction_wins.rollback.sql

set local lock_timeout = '5s';

-- ── 0. Preconditions (any failure aborts before anything changes) ──────────
do $$
declare
  v_n   int;
  v_md5 text;
  v_gs  record;
begin
  -- 1. Exactly one admin_reset_game(): security definer, search_path=public,
  --    the 20261022100000 body (normalized md5 aa6bedbe…).
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'admin_reset_game';
  if v_n <> 1 then
    raise exception 'precondition failed: expected exactly 1 admin_reset_game, found %', v_n;
  end if;
  select md5(regexp_replace(p.prosrc, '\s+', '', 'g')) into v_md5
  from pg_proc p
  where p.oid = to_regprocedure('public.admin_reset_game()')
    and p.prosecdef and p.proconfig @> array['search_path=public'];
  if v_md5 is distinct from 'aa6bedbe02fd7b8563a87a0aca2f7a42' then
    raise exception 'precondition failed: admin_reset_game body md5 is %, expected aa6bedbe02fd7b8563a87a0aca2f7a42', coalesce(v_md5, '<missing/not secdef>');
  end if;

  -- 2. M1 is live: claim_winner() is the version that writes auction_wins.
  select md5(regexp_replace(p.prosrc, '\s+', '', 'g')) into v_md5
  from pg_proc p where p.oid = to_regprocedure('public.claim_winner()');
  if v_md5 is distinct from '3b84dfd5ca929a55d5c093209693d225' then
    raise exception 'precondition failed: claim_winner body md5 is %, expected the M1 version 3b84dfd5ca929a55d5c093209693d225', coalesce(v_md5, '<missing>');
  end if;

  -- 3. The columns the new body reads exist.
  select count(*) into v_n from information_schema.columns
  where table_schema = 'public'
    and ((table_name = 'auction_wins' and (column_name, data_type) in (
            ('id', 'uuid'), ('round_key', 'uuid'), ('winner_id', 'uuid'),
            ('claimed_at', 'timestamp with time zone'), ('payment_deadline', 'timestamp with time zone')))
      or (table_name = 'payment_attempts' and (column_name, data_type) in (
            ('win_id', 'uuid'), ('winner_id', 'uuid'), ('win_claimed_at', 'timestamp with time zone'), ('status', 'text')))
      or (table_name = 'orders' and (column_name, data_type) in (('win_id', 'uuid')))
      or (table_name = 'game_state' and (column_name, data_type) in (
            ('round_key', 'uuid'), ('phase', 'text'), ('winner_id', 'uuid'))));
  if v_n <> 13 then
    raise exception 'precondition failed: auction_wins / payment_attempts / orders / game_state columns differ from expected (found % of 13)', v_n;
  end if;
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.auction_wins'::regclass and contype = 'u'
                   and conname = 'auction_wins_round_key_key') then
    raise exception 'precondition failed: auction_wins.round_key is not UNIQUE';
  end if;

  -- 4. game_state is the singleton row id = 1. Locked until commit: no
  --    claim, start or reset runs while the function is swapped.
  select count(*) into v_n from game_state;
  if v_n <> 1 then
    raise exception 'precondition failed: expected exactly 1 game_state row, found %', v_n;
  end if;
  select phase, winner_id, round_key into v_gs from game_state where id = 1 for update;
  if not found then
    raise exception 'precondition failed: game_state row id = 1 missing';
  end if;

  -- 5. If a win is current, its ledger row is there — otherwise the new
  --    function would refuse every reset; stop and look instead.
  if v_gs.phase = 'ended' and v_gs.winner_id is not null
     and not exists (select 1 from auction_wins w
                     where w.round_key = v_gs.round_key and w.winner_id = v_gs.winner_id) then
    raise exception 'precondition failed: game_state has an ended winner with no matching auction_wins row';
  end if;
end $$;

-- Owner / EXECUTE grants / config before the swap, compared afterwards.
create temp table m2_reset_before on commit drop as
  select p.proowner, p.proacl::text acl, p.proconfig
  from pg_proc p where p.oid = 'public.admin_reset_game()'::regprocedure;

-- ── 1. admin_reset_game() ───────────────────────────────────────────────────
create or replace function public.admin_reset_game()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gs            record;
  v_win           record;
  v_deadline      timestamptz;
  v_live_status   text;
  v_paid          boolean;
begin
  select phase, winner_id, round_key
    into v_gs
  from game_state
  where id = 1
  for update;

  if v_gs.phase = 'ended' and v_gs.winner_id is not null then
    select w.id, w.winner_id, w.claimed_at, w.payment_deadline
      into v_win
    from auction_wins w
    where w.round_key = v_gs.round_key;

    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'reset_blocked:win_record_missing';
    end if;
    if v_win.winner_id is distinct from v_gs.winner_id then
      raise exception using
        errcode = 'P0001',
        message = 'reset_blocked:win_record_mismatch';
    end if;

    v_deadline := v_win.payment_deadline;

    select pa.status into v_live_status
    from payment_attempts pa
    where pa.status in ('pending', 'reconciliation_required')
      and (
        pa.win_id = v_win.id
        or (pa.win_id is null
            and pa.winner_id = v_win.winner_id
            and pa.win_claimed_at = v_win.claimed_at)
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
             select 1 from orders o
             where o.win_id = v_win.id
           )
        or exists (
             select 1 from payment_attempts pa
             where pa.status = 'paid'
               and (
                 pa.win_id = v_win.id
                 or (pa.win_id is null
                     and pa.winner_id = v_win.winner_id
                     and pa.win_claimed_at = v_win.claimed_at)
               )
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
  v_body   text;
begin
  select p.prosecdef, p.proconfig, p.proowner, p.proacl::text acl, p.prosrc,
         md5(regexp_replace(p.prosrc, '\s+', '', 'g')) h
    into v_fn
  from pg_proc p where p.oid = 'public.admin_reset_game()'::regprocedure;
  select * into v_before from m2_reset_before;

  if not v_fn.prosecdef or not (v_fn.proconfig @> array['search_path=public']) then
    raise exception 'post-condition failed: admin_reset_game() lost security definer / search_path=public';
  end if;
  if v_fn.proowner <> v_before.proowner or v_fn.acl is distinct from v_before.acl
     or v_fn.proconfig is distinct from v_before.proconfig then
    raise exception 'post-condition failed: admin_reset_game() owner / EXECUTE grants / config changed';
  end if;
  if has_function_privilege('anon', 'public.admin_reset_game()', 'execute')
     or has_function_privilege('authenticated', 'public.admin_reset_game()', 'execute')
     or not has_function_privilege('service_role', 'public.admin_reset_game()', 'execute') then
    raise exception 'post-condition failed: admin_reset_game() EXECUTE must be service_role only';
  end if;
  if v_fn.h is distinct from 'e74405580db4c4694302f25e9d9d1e37' then
    raise exception 'post-condition failed: admin_reset_game body md5 is %, expected e74405580db4c4694302f25e9d9d1e37', v_fn.h;
  end if;

  v_body := v_fn.prosrc;
  if v_body not like '%from auction_wins w%'
     or v_body not like '%v_deadline := v_win.payment_deadline;%'
     or v_body not like '%reset_blocked:win_record_missing%'
     or v_body not like '%reset_blocked:win_record_mismatch%'
     or v_body not like '%reset_blocked:unpaid_win_in_payment_window%'
     or v_body not like '%reset_blocked:payment_in_progress%'
     or v_body not like '%reset_blocked:payment_needs_review%'
     or v_body like '%1800 seconds%'
     or v_body like '%created_at >=%'
     or v_body like '%o.amount%' then
    raise exception 'post-condition failed: admin_reset_game() guard not as expected';
  end if;
  if v_body not like '%delete from chat_messages where true;%'
     or v_body not like '%delete from participants where true;%'
     or v_body not like '%delete from device_round_guard where true;%'
     or v_body not like '%round_key = gen_random_uuid()%'
     or v_body not like '%is_paused = false,%' or v_body not like '%paused_at = null,%'
     or v_body not like '%paused_total_ms = 0,%' or v_body not like '%pause_reason = null,%' then
    raise exception 'post-condition failed: admin_reset_game() reset statements not preserved';
  end if;
end $$;
