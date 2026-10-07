-- Atomic guard against paying twice for the same win.
--
-- Until now payment_attempts could only stop a duplicate order_id. Two
-- confirm requests for the SAME win with DIFFERENT order_ids (a second
-- payment started from /payment, or two near-simultaneous requests) both
-- inserted a 'pending' row and both reached Toss — a double charge. An
-- application-level "SELECT existing payment, then INSERT" check can't fix
-- that: two requests can pass the SELECT at the same time.
--
-- Win identity: (winner_id, win_claimed_at). claim_winner() writes
-- game_state.winner_claimed_at = now() together with phase = 'ended' under
-- FOR UPDATE, and reset_game() clears it, so every win gets its own
-- timestamp — the same user winning again later, even at the same price,
-- is a different key. amount is deliberately NOT part of the identity.
--
-- The guard is a partial UNIQUE index: at most one ACTIVE attempt
-- (pending / paid / reconciliation_required) per win. 'failed' — Toss
-- explicitly rejected it, nothing was charged — is excluded, so a clearly
-- failed payment can still be retried. app/api/payment/confirm/route.ts
-- reserves the win by INSERTing (or flipping its own failed row back to)
-- 'pending' BEFORE calling Toss; a concurrent second reservation gets
-- 23505 from this index and never reaches Toss. There is no timeout-based
-- release: a stuck pending / reconciliation_required attempt keeps the win
-- locked until an operator resolves it (fail-closed).
--
-- Legacy rows keep win_claimed_at = null and are outside the index (NULLs
-- never conflict), EXCEPT the current win's active attempt, if any, which is
-- backfilled below so the win in progress at deploy time is protected too.
--
-- Untouched: RLS (enabled, zero policies) and the REVOKE ALL from public/
-- anon/authenticated on this table — verified again at the end. No grants
-- are added; only the service-role confirm route touches this table.
--
-- Run this manually in the Supabase SQL Editor (Database > SQL Editor).

begin;

-- Brief locks only; give up rather than queue behind a long query.
-- On timeout nothing is applied — just re-run.
set local lock_timeout = '5s';

-- ── 1. Win identity column ──────────────────────────────────────────────────
alter table public.payment_attempts
  add column if not exists win_claimed_at timestamptz;

-- ── 2. Backfill ONLY the current win's active attempt ───────────────────────
-- Narrow on purpose: the current game_state must be 'ended', and an attempt
-- must match its winner_id, its winner_price, have been created at/after its
-- winner_claimed_at, and be active. 0 matches -> no-op. 1 -> stamp it.
-- 2+ -> a duplicate active payment for this win ALREADY exists: abort the
-- whole migration so a human looks at it, rather than picking one.
do $$
declare
  v_gs    record;
  v_count int;
begin
  select phase, winner_id, winner_price, winner_claimed_at
    into v_gs
  from public.game_state
  where id = 1;

  if v_gs.phase is distinct from 'ended'
     or v_gs.winner_id is null
     or v_gs.winner_price is null
     or v_gs.winner_claimed_at is null then
    raise notice 'backfill: no ended win in game_state — nothing to backfill';
    return;
  end if;

  select count(*) into v_count
  from public.payment_attempts pa
  where pa.winner_id  = v_gs.winner_id
    and pa.amount     = v_gs.winner_price
    and pa.created_at >= v_gs.winner_claimed_at
    and pa.status in ('pending', 'paid', 'reconciliation_required');

  if v_count > 1 then
    raise exception 'backfill aborted: % active payment_attempts already exist for the current win (winner_id %, winner_claimed_at %) — resolve manually before re-running',
      v_count, v_gs.winner_id, v_gs.winner_claimed_at;
  end if;

  if v_count = 1 then
    update public.payment_attempts pa
    set win_claimed_at = v_gs.winner_claimed_at
    where pa.winner_id  = v_gs.winner_id
      and pa.amount     = v_gs.winner_price
      and pa.created_at >= v_gs.winner_claimed_at
      and pa.status in ('pending', 'paid', 'reconciliation_required');
    raise notice 'backfill: stamped 1 active attempt for the current win';
  else
    raise notice 'backfill: no active attempt for the current win — nothing to backfill';
  end if;
end $$;

-- ── 3. One active attempt per win ───────────────────────────────────────────
create unique index if not exists payment_attempts_one_active_per_win
  on public.payment_attempts (winner_id, win_claimed_at)
  where win_claimed_at is not null
    and status in ('pending', 'paid', 'reconciliation_required');

-- ── Post-conditions — verified, not assumed (any failure rolls back) ────────
do $$
begin
  if not exists (
    select 1
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
    where c.relname = 'payment_attempts_one_active_per_win'
      and i.indrelid = 'public.payment_attempts'::regclass
      and i.indisunique
      and i.indisvalid
  ) then
    raise exception 'post-condition failed: unique index payment_attempts_one_active_per_win missing or invalid';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.payment_attempts'::regclass) then
    raise exception 'post-condition failed: RLS is not enabled on payment_attempts';
  end if;

  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'payment_attempts') then
    raise exception 'post-condition failed: payment_attempts has RLS policies (expected none)';
  end if;

  if has_table_privilege('anon',          'public.payment_attempts', 'select, insert, update, delete')
     or has_table_privilege('authenticated', 'public.payment_attempts', 'select, insert, update, delete')
     or has_any_column_privilege('anon',          'public.payment_attempts', 'select, insert, update')
     or has_any_column_privilege('authenticated', 'public.payment_attempts', 'select, insert, update') then
    raise exception 'post-condition failed: a client role has privileges on payment_attempts';
  end if;
end $$;

commit;
