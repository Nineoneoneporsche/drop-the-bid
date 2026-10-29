-- auction_wins: a durable, append-only record of every confirmed win (M1).
--
-- Until now a win lived only in game_state (winner_id / winner_nickname /
-- winner_price / winner_claimed_at), which admin_reset_game() wipes. Once a
-- round is reset the win is gone: nothing ties a later payment or order back
-- to it except a (winner_id, amount, created_at) heuristic.
--
--   auction_wins          one row per won round (round_key UNIQUE), written
--                         only by claim_winner() in the same transaction that
--                         sets the winner on game_state. Snapshots what the
--                         price was computed from (locked game_state row at
--                         claim time) and the payment deadline. No status
--                         column: payment state is derived from
--                         payment_attempts / orders. winner_id has no FK to
--                         auth.users on purpose (same as orders.winner_id and
--                         payment_attempts.winner_id) — the record must
--                         survive account deletion.
--   payment_attempts.win_id, orders.win_id
--                         nullable FKs to auction_wins(id). Existing rows stay
--                         NULL (no backfill: past rounds' round_key, product
--                         and price config were never recorded). New code
--                         will set them; this migration changes no app
--                         behaviour. The existing (winner_id, win_claimed_at)
--                         index is kept.
--   claim_winner()        the production body (normalized md5
--                         e3acb73770e04ed160902af75732ae93, enforced below),
--                         plus: one v_claimed_at used for both
--                         game_state.winner_claimed_at and
--                         auction_wins.claimed_at, the elapsed-seconds input
--                         kept in a variable so it can be snapshotted, and an
--                         INSERT into auction_wins right after the winner
--                         UPDATE and before the chat message. No exception
--                         handler, no ON CONFLICT: if the INSERT fails, the
--                         whole call fails and the winner UPDATE rolls back
--                         with it. A winner without its auction_wins row
--                         cannot exist.
--
-- Access: RLS on. Production's old default ACL would give anon /
-- authenticated / service_role ALL on a new public table, so everything is
-- revoked right after CREATE and only this is granted:
--   authenticated  SELECT on 8 columns, own rows only (policy winner_id =
--                  auth.uid()). Anonymous-auth sessions are also
--                  'authenticated' but can never be a winner (join_game_
--                  participant refuses anonymous users), so they see nothing.
--   service_role   SELECT (BYPASSRLS: all rows). No writes.
--   anon           nothing.
-- Rows are inserted only by claim_winner() (SECURITY DEFINER, runs as the
-- function owner, which owns this table). Not added to Realtime.
--
-- Deploy: run while game_state is in 'waiting' or 'strategy' with no
-- winner and no pending / reconciliation_required payment. The precondition
-- locks the game_state row FOR UPDATE until commit, so no round can start —
-- and no claim can go through the old claim_winner() — while this runs.
-- The current app keeps working unchanged (it never reads auction_wins and
-- inserts payment_attempts / orders without win_id).
--
-- Rollback (manual, emergency only, NOT a migration):
-- supabase/rollbacks/20261028150000_auction_wins.rollback.sql
--
-- Deploy only through the Supabase CLI migration workflow (pinned CLI
-- v2.122.0, `db push --linked`). Do NOT execute this migration manually in
-- the Production SQL Editor: that bypasses supabase_migrations history.
-- No explicit BEGIN/COMMIT here on purpose: the CLI migration runner wraps
-- this file and its history INSERT in one transaction, so any failure
-- leaves neither partial schema nor a history row.

set local lock_timeout = '5s';

-- ── 0. Preconditions (any failure aborts before anything changes) ──────────
do $$
declare
  v_gs record;
  v_n  int;
begin
  if to_regclass('public.game_state') is null
     or to_regclass('public.payment_attempts') is null
     or to_regclass('public.orders') is null then
    raise exception 'precondition failed: game_state / payment_attempts / orders missing';
  end if;

  if to_regclass('public.auction_wins') is not null then
    raise exception 'precondition failed: public.auction_wins already exists';
  end if;

  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name in ('payment_attempts', 'orders')
               and column_name = 'win_id') then
    raise exception 'precondition failed: payment_attempts.win_id or orders.win_id already exists';
  end if;

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'claim_winner';
  if v_n <> 1 then
    raise exception 'precondition failed: expected exactly 1 claim_winner, found %', v_n;
  end if;

  if not exists (
    select 1 from pg_proc p
    where p.oid = to_regprocedure('public.claim_winner()')
      and p.prosecdef
      and p.proconfig @> array['search_path=public']
      and md5(regexp_replace(p.prosrc, '\s+', '', 'g')) = 'e3acb73770e04ed160902af75732ae93'
  ) then
    raise exception 'precondition failed: claim_winner() is not the security definer / search_path=public definition with body md5 e3acb73770e04ed160902af75732ae93';
  end if;

  select count(*) into v_n from public.game_state;
  if v_n <> 1 then
    raise exception 'precondition failed: expected exactly 1 game_state row, found %', v_n;
  end if;

  -- Held until commit: start_game() / claim_winner() wait behind it.
  select phase, winner_id, winner_claimed_at into v_gs
  from public.game_state where id = 1 for update;
  if not found then
    raise exception 'precondition failed: game_state row id = 1 missing';
  end if;
  if v_gs.winner_id is not null or v_gs.winner_claimed_at is not null
     or v_gs.phase not in ('waiting', 'strategy') then
    raise exception 'precondition failed: a round is in progress or has a winner (phase %, has winner %) — apply in waiting/strategy with no winner',
      v_gs.phase, v_gs.winner_id is not null;
  end if;

  select count(*) into v_n from public.payment_attempts
  where status in ('pending', 'reconciliation_required');
  if v_n <> 0 then
    raise exception 'precondition failed: % pending / reconciliation_required payment_attempts — resolve them first', v_n;
  end if;

  -- What claim_winner() looks like now, compared again after the replace.
  create temp table m1_claim_winner_before on commit drop as
  select p.proowner, p.proacl::text acl, p.proconfig
  from pg_proc p where p.oid = 'public.claim_winner()'::regprocedure;
end $$;

-- ── 1. auction_wins ─────────────────────────────────────────────────────────
create table public.auction_wins (
  id               uuid        primary key default gen_random_uuid(),
  round_key        uuid        not null unique,
  winner_id        uuid        not null,
  winner_nickname  text        not null,

  product_name     text        not null,
  start_price      integer     not null,
  minimum_price    integer     not null,
  winning_price    integer     not null,

  price_inputs     jsonb       not null,

  claimed_at       timestamptz not null,
  payment_deadline timestamptz not null,

  created_at       timestamptz not null default now(),

  constraint auction_wins_price_range
    check (
      winning_price > 0
      and winning_price between minimum_price and start_price
    ),

  constraint auction_wins_deadline
    check (payment_deadline > claimed_at)
);

create index auction_wins_winner_id_claimed_at_idx
  on public.auction_wins (winner_id, claimed_at desc);

alter table public.auction_wins enable row level security;

revoke all on table public.auction_wins from public, anon, authenticated, service_role;
grant select on table public.auction_wins to service_role;
grant select (id, round_key, winner_nickname, product_name, start_price, winning_price, claimed_at, payment_deadline)
  on table public.auction_wins to authenticated;

create policy auction_wins_select_own on public.auction_wins
  for select to authenticated
  using (winner_id = (select auth.uid()));

-- ── 2. win_id on payment_attempts / orders (nullable, no backfill) ─────────
alter table public.payment_attempts
  add column win_id uuid
  references public.auction_wins(id);

alter table public.orders
  add column win_id uuid
  references public.auction_wins(id);

create unique index payment_attempts_one_active_per_win_id
  on public.payment_attempts (win_id)
  where win_id is not null
    and status in ('pending', 'paid', 'reconciliation_required');

create unique index orders_one_per_win
  on public.orders (win_id)
  where win_id is not null;

-- ── 3. claim_winner(): + auction_wins INSERT in the same transaction ───────
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
  v_elapsed     numeric;
  v_claimed_at  timestamptz;
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

  v_claimed_at := now();
  v_elapsed := extract(epoch from (v_claimed_at - v_row.game_started_at)) - (v_row.paused_total_ms / 1000.0);

  v_price := calc_drop_price(
    v_elapsed,
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
      winner_claimed_at = v_claimed_at,
      phase = 'ended'
  where id = 1;

  -- Durable win record. Deliberately no exception handler / ON CONFLICT:
  -- any failure here (round_key already won, CHECK) aborts the whole call,
  -- so the winner UPDATE above never survives without this row.
  insert into auction_wins (
    round_key, winner_id, winner_nickname,
    product_name, start_price, minimum_price, winning_price,
    price_inputs,
    claimed_at, payment_deadline
  ) values (
    v_row.round_key, v_uid, v_nickname,
    v_row.product_name, v_row.start_price, v_row.minimum_price, v_price,
    jsonb_build_object(
      'elapsed_seconds',             v_elapsed,
      'game_started_at',             v_row.game_started_at,
      'paused_total_ms',             v_row.paused_total_ms,
      'start_price',                 v_row.start_price,
      'minimum_price',               v_row.minimum_price,
      'drop_amount',                 v_row.drop_amount,
      'fast_drop_price',             v_row.fast_drop_price,
      'fast_drop_amount',            v_row.fast_drop_amount,
      'final_drop_price',            v_row.final_drop_price,
      'final_drop_amount',           v_row.final_drop_amount,
      'drop_interval_seconds',       v_row.drop_interval_seconds,
      'fast_drop_interval_seconds',  v_row.fast_drop_interval_seconds,
      'final_drop_interval_seconds', v_row.final_drop_interval_seconds
    ),
    v_claimed_at, v_claimed_at + interval '1800 seconds'
  );

  insert into chat_messages (guest_id, nickname, message, kind)
  values (
    v_uid, 'system',
    '🎉 ' || v_nickname || '님이 ₩' || to_char(v_price, 'FM999,999,999') || '에 낙찰받았습니다!',
    'system'
  );

  return true;
end;
$$;

-- ── Post-conditions (any failure rolls back) ────────────────────────────────
do $$
declare
  v_tbl_owner oid;
  v_fn        record;
  v_before    record;
  v_bad       text;
begin
  -- Table, columns, constraints, indexes.
  if to_regclass('public.auction_wins') is null then
    raise exception 'post-condition failed: auction_wins missing';
  end if;

  if (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'auction_wins' and is_nullable = 'NO'
        and (column_name, data_type) in (
          ('id', 'uuid'), ('round_key', 'uuid'), ('winner_id', 'uuid'), ('winner_nickname', 'text'),
          ('product_name', 'text'), ('start_price', 'integer'), ('minimum_price', 'integer'),
          ('winning_price', 'integer'), ('price_inputs', 'jsonb'),
          ('claimed_at', 'timestamp with time zone'), ('payment_deadline', 'timestamp with time zone'),
          ('created_at', 'timestamp with time zone'))) <> 12
     or (select count(*) from information_schema.columns
         where table_schema = 'public' and table_name = 'auction_wins') <> 12 then
    raise exception 'post-condition failed: auction_wins columns differ from expected';
  end if;

  if (select count(*) from pg_constraint
      where conrelid = 'public.auction_wins'::regclass
        and ((contype = 'p' and conname = 'auction_wins_pkey')
          or (contype = 'u' and conname = 'auction_wins_round_key_key')
          or (contype = 'c' and conname in ('auction_wins_price_range', 'auction_wins_deadline')))) <> 4 then
    raise exception 'post-condition failed: auction_wins constraints missing';
  end if;

  if (select count(*) from pg_constraint
         where contype = 'f' and confrelid = 'public.auction_wins'::regclass
           and conrelid in ('public.payment_attempts'::regclass, 'public.orders'::regclass)) <> 2
     or exists (select 1 from pg_constraint where contype = 'f' and conrelid = 'public.auction_wins'::regclass) then
    raise exception 'post-condition failed: expected exactly the two win_id FKs into auction_wins and none out of it';
  end if;

  if (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name in ('payment_attempts', 'orders')
        and column_name = 'win_id' and data_type = 'uuid' and is_nullable = 'YES') <> 2 then
    raise exception 'post-condition failed: payment_attempts.win_id / orders.win_id missing or not nullable uuid';
  end if;

  if (select count(*) from pg_index i join pg_class c on c.oid = i.indexrelid
      where i.indisunique and i.indisvalid and i.indpred is not null
        and ((c.relname = 'payment_attempts_one_active_per_win_id' and i.indrelid = 'public.payment_attempts'::regclass)
          or (c.relname = 'orders_one_per_win' and i.indrelid = 'public.orders'::regclass))) <> 2 then
    raise exception 'post-condition failed: win_id partial unique indexes missing or invalid';
  end if;

  if to_regclass('public.auction_wins_winner_id_claimed_at_idx') is null
     or to_regclass('public.payment_attempts_one_active_per_win') is null then
    raise exception 'post-condition failed: auction_wins_winner_id_claimed_at_idx or the existing (winner_id, win_claimed_at) index missing';
  end if;

  -- RLS / policies / Realtime.
  if not (select relrowsecurity from pg_class where oid = 'public.auction_wins'::regclass) then
    raise exception 'post-condition failed: RLS not enabled on auction_wins';
  end if;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'auction_wins') <> 1
     or not exists (select 1 from pg_policies
                    where schemaname = 'public' and tablename = 'auction_wins'
                      and policyname = 'auction_wins_select_own' and cmd = 'SELECT'
                      and roles = array['authenticated']::name[]) then
    raise exception 'post-condition failed: auction_wins must have exactly the authenticated own-row SELECT policy';
  end if;

  if exists (select 1 from pg_publication_tables where schemaname = 'public' and tablename = 'auction_wins') then
    raise exception 'post-condition failed: auction_wins is in a publication';
  end if;

  -- Privileges: owner + service_role SELECT at table level; authenticated
  -- only the 8 column SELECTs; nobody else.
  select relowner into v_tbl_owner from pg_class where oid = 'public.auction_wins'::regclass;

  select string_agg(format('%s:%s', case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end, x.privilege_type), ', ')
    into v_bad
  from pg_class c cross join lateral aclexplode(c.relacl) x
  where c.oid = 'public.auction_wins'::regclass
    and x.grantee <> v_tbl_owner
    and not (x.grantee = 'service_role'::regrole and x.privilege_type = 'SELECT');
  if v_bad is not null then
    raise exception 'post-condition failed: unexpected table privileges on auction_wins: %', v_bad;
  end if;

  select string_agg(format('%s.%s:%s', a.attname, pg_get_userbyid(x.grantee), x.privilege_type), ', ')
    into v_bad
  from pg_attribute a cross join lateral aclexplode(a.attacl) x
  where a.attrelid = 'public.auction_wins'::regclass and a.attacl is not null
    and not (x.grantee = 'authenticated'::regrole and x.privilege_type = 'SELECT'
             and a.attname in ('id', 'round_key', 'winner_nickname', 'product_name', 'start_price',
                               'winning_price', 'claimed_at', 'payment_deadline'));
  if v_bad is not null then
    raise exception 'post-condition failed: unexpected column privileges on auction_wins: %', v_bad;
  end if;

  if (select count(*) from pg_attribute a cross join lateral aclexplode(a.attacl) x
      where a.attrelid = 'public.auction_wins'::regclass and a.attacl is not null) <> 8 then
    raise exception 'post-condition failed: authenticated must have exactly 8 column SELECT grants on auction_wins';
  end if;

  if has_table_privilege('anon', 'public.auction_wins', 'select, insert, update, delete, truncate, references, trigger')
     or has_any_column_privilege('anon', 'public.auction_wins', 'select, insert, update, references') then
    raise exception 'post-condition failed: anon has privileges on auction_wins';
  end if;
  if has_table_privilege('authenticated', 'public.auction_wins', 'select, insert, update, delete, truncate, references, trigger')
     or has_any_column_privilege('authenticated', 'public.auction_wins', 'insert, update, references') then
    raise exception 'post-condition failed: authenticated has write or table-level privileges on auction_wins';
  end if;
  if has_table_privilege('service_role', 'public.auction_wins', 'insert, update, delete, truncate, references, trigger')
     or has_any_column_privilege('service_role', 'public.auction_wins', 'insert, update, references')
     or not has_table_privilege('service_role', 'public.auction_wins', 'select') then
    raise exception 'post-condition failed: service_role must have SELECT only on auction_wins';
  end if;

  -- claim_winner(): still security definer / search_path=public, same owner
  -- and EXECUTE grants as before, new body in place, and its owner can
  -- write auction_wins past RLS.
  select p.prosecdef, p.proconfig, p.proowner, p.proacl::text acl, p.prosrc into v_fn
  from pg_proc p where p.oid = 'public.claim_winner()'::regprocedure;
  select * into v_before from m1_claim_winner_before;

  if not v_fn.prosecdef or not (v_fn.proconfig @> array['search_path=public']) then
    raise exception 'post-condition failed: claim_winner() lost security definer / search_path=public';
  end if;
  if v_fn.proowner <> v_before.proowner or v_fn.acl is distinct from v_before.acl
     or v_fn.proconfig is distinct from v_before.proconfig then
    raise exception 'post-condition failed: claim_winner() owner / EXECUTE grants / config changed';
  end if;
  v_bad := regexp_replace(v_fn.prosrc, '--[^\n]*', '', 'g');  -- body without comments
  if v_bad not like '%insert into auction_wins%'
     or v_bad not like '%winner_claimed_at = v_claimed_at%'
     or v_bad not like '%account_round_guard%'
     or v_bad ~* 'on\s+conflict'
     or v_bad ~* 'exception\s+when' then
    raise exception 'post-condition failed: claim_winner() body not as expected';
  end if;
  if v_fn.proowner <> v_tbl_owner
     and not exists (select 1 from pg_roles where oid = v_fn.proowner and (rolsuper or rolbypassrls)) then
    raise exception 'post-condition failed: claim_winner() owner neither owns auction_wins nor bypasses RLS';
  end if;
  if not has_table_privilege(v_fn.proowner, 'public.auction_wins', 'insert') then
    raise exception 'post-condition failed: claim_winner() owner cannot insert into auction_wins';
  end if;
end $$;
