-- M4-A: payment approval safety, before live Toss keys.
--
-- What this adds (app side: app/api/payment/confirm/route.ts,
-- app/lib/tossClient.ts):
--
--   payment_attempts, new nullable columns (existing rows keep NULLs; no
--   backfill):
--     toss_idempotency_key   the attempt's Toss Idempotency-Key, generated
--                            here (never by the client) when the attempt is
--                            reserved and never changed afterwards: every
--                            retry of the attempt sends the same key. UNIQUE.
--     toss_status            Payment.status last seen from Toss (DONE, ...).
--     approved_at            Payment.approvedAt of a DONE payment.
--     last_checked_at        when DTB last received Toss's state for it.
--     shipping_*             the shipping snapshot taken at reservation (same
--                            five columns as orders), so a payment Toss
--                            approved can still become an order after a
--                            crash between Toss and the order INSERT. All
--                            four required fields present, or none (legacy).
--
--   payment_reserve_attempt(...)   service_role only. Locks the win's
--       auction_wins row, re-checks winner / price / deadline against DB
--       now() and reserves the attempt ('pending' + snapshot + idempotency
--       key) in the same transaction — the deadline check and the
--       reservation can no longer straddle the deadline. Policy: DTB must
--       secure the right to call Toss before payment_deadline; a Toss answer
--       arriving after it is still recorded normally.
--
--   payment_finalize_paid(...)     service_role only. Toss DONE verified by
--       the caller -> the order INSERT and the attempt's 'paid' in ONE
--       transaction (attempt row locked). Refuses to pay a second order for
--       one win, a mismatched existing order, a missing snapshot or a
--       paymentKey already on another order: those leave the attempt
--       reconciliation_required instead. A replay of an already-paid
--       attempt is idempotent.
--
--   payment_attempts_guard_transition (trigger): the allowed status moves,
--       for every writer (this app, the pre-M4 app during rollout, the SQL
--       editor):
--         INSERT                   status must be 'pending'
--         pending                  -> pending | paid | failed | reconciliation_required
--         failed                   -> failed | pending            (retry of the same attempt)
--         reconciliation_required  -> reconciliation_required | paid | failed
--                                     (paid: recovered DONE; failed: an
--                                     operator who verified "not approved")
--         paid                     -> paid                         (terminal)
--       and order_id / user_id / winner_id / amount / payment_key never
--       change, win_id only on a failed -> pending retry, a set
--       toss_idempotency_key never changes.
--
--   orders: payment_key NOT NULL + UNIQUE (one Toss payment = one order) —
--       fail-closed if existing rows would violate it (no backfill).
--       Privileges narrowed to what the app reads:
--         anon            nothing (was SELECT / UPDATE / DELETE / TRUNCATE /
--                         REFERENCES / TRIGGER / MAINTAIN, RLS-blocked only —
--                         and TRUNCATE is not subject to RLS at all)
--         authenticated   column SELECT on order_id, user_id, win_id,
--                         product_name, amount, created_at only (My Page
--                         and app/lib/winOrder.ts); payment_key, winner_id
--                         and the shipping snapshot are no longer readable.
--                         Its RLS policy (own rows) stays.
--         service_role    unchanged.
--
-- Unchanged: claim_winner() (M1), admin_reset_game() (M2), the M3 timing
-- functions, auction_wins and its privileges, payment_attempts' RLS (on, no
-- policies) and privileges (service_role only), the active-attempt unique
-- indexes, orders' RLS and policy.
--
-- Normalized body md5s (md5(regexp_replace(prosrc, '\s+', '', 'g'))):
--   payment_reserve_attempt(text,uuid,uuid,integer,text,text,text,text,text,text)  new -> 3b0840ae43dd5807a074816a8ca03fdf
--   payment_finalize_paid(text,jsonb,text,timestamptz)                              new -> e4d02c5b0c445e83965b585bc4ff6a12
--   payment_attempts_guard_transition()                                             new -> 3b910dd20de5c3e8f61398caf1d8b28e
-- (enforced by the post-conditions).
--
-- Can be applied while the pre-M4 app is deployed (it writes only moves
-- the trigger allows and reads no column it loses); deploy the app after
-- it. Deploy only through the Supabase CLI migration workflow (pinned CLI
-- v2.122.0, `db push --linked`). Do NOT execute this migration manually in
-- the Production SQL Editor: that bypasses supabase_migrations history.
-- No explicit BEGIN/COMMIT here on purpose: the CLI migration runner wraps
-- this file and its history INSERT in one transaction, so any failure
-- leaves neither a partial change nor a history row.
--
-- Rollback (manual, emergency only, NOT a migration):
-- supabase/rollbacks/20261030200000_payment_confirm_safety.rollback.sql

set local lock_timeout = '5s';

-- ── 0. Preconditions (any failure aborts before anything changes) ──────────
do $$
declare
  v_n    int;
  v_bad  text;
  r      record;
begin
  -- 1. The tables and the columns this migration reads.
  select count(*) into v_n from information_schema.columns
  where table_schema = 'public'
    and ((table_name = 'payment_attempts' and (column_name, data_type) in (
            ('order_id', 'text'), ('user_id', 'uuid'), ('winner_id', 'uuid'), ('amount', 'integer'),
            ('payment_key', 'text'), ('status', 'text'), ('toss_response', 'jsonb'), ('error_detail', 'text'),
            ('created_at', 'timestamp with time zone'), ('updated_at', 'timestamp with time zone'),
            ('win_claimed_at', 'timestamp with time zone'), ('win_id', 'uuid')))
      or (table_name = 'orders' and (column_name, data_type) in (
            ('id', 'uuid'), ('user_id', 'uuid'), ('winner_id', 'uuid'), ('win_id', 'uuid'), ('product_name', 'text'),
            ('amount', 'integer'), ('order_id', 'text'), ('payment_key', 'text'), ('created_at', 'timestamp with time zone'),
            ('shipping_recipient_name', 'text'), ('shipping_phone', 'text'), ('shipping_postcode', 'text'),
            ('shipping_address', 'text'), ('shipping_address_detail', 'text')))
      or (table_name = 'auction_wins' and (column_name, data_type) in (
            ('id', 'uuid'), ('winner_id', 'uuid'), ('product_name', 'text'), ('winning_price', 'integer'),
            ('claimed_at', 'timestamp with time zone'), ('payment_deadline', 'timestamp with time zone'))));
  if v_n <> 32 then
    raise exception 'precondition failed: payment_attempts / orders / auction_wins columns differ from expected (found % of 32)', v_n;
  end if;

  -- 2. The new columns: absent, or exactly the shape created here (left
  --    behind by the rollback, which keeps them).
  select string_agg(column_name, ', ') into v_bad from information_schema.columns
  where table_schema = 'public' and table_name = 'payment_attempts'
    and column_name in ('toss_idempotency_key', 'toss_status', 'approved_at', 'last_checked_at', 'shipping_recipient_name',
                        'shipping_phone', 'shipping_postcode', 'shipping_address', 'shipping_address_detail')
    and not (is_nullable = 'YES' and column_default is null
             and data_type = case when column_name in ('approved_at', 'last_checked_at') then 'timestamp with time zone' else 'text' end);
  if v_bad is not null then
    raise exception 'precondition failed: payment_attempts column(s) % exist with an unexpected shape', v_bad;
  end if;

  -- 3. The functions and trigger this migration creates do not exist.
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public'
               and p.proname in ('payment_reserve_attempt', 'payment_finalize_paid', 'payment_attempts_guard_transition'))
     or exists (select 1 from pg_trigger where tgrelid = 'public.payment_attempts'::regclass and not tgisinternal) then
    raise exception 'precondition failed: an M4-A function or a payment_attempts trigger already exists';
  end if;

  -- 4. Data (fail closed, no backfill): orders.payment_key can become
  --    NOT NULL + UNIQUE, and no Toss payment is recorded as paid twice.
  select count(*) into v_n from orders where payment_key is null;
  if v_n > 0 then
    raise exception 'precondition failed: % orders row(s) have payment_key NULL — resolve by hand first', v_n;
  end if;
  select count(*) into v_n from (select payment_key from orders group by payment_key having count(*) > 1) d;
  if v_n > 0 then
    raise exception 'precondition failed: % payment_key value(s) appear on more than one order', v_n;
  end if;
  select count(*) into v_n from (select payment_key from payment_attempts where status = 'paid'
                                 group by payment_key having count(*) > 1) d;
  if v_n > 0 then
    raise exception 'precondition failed: % payment_key value(s) appear on more than one paid payment_attempts row', v_n;
  end if;
  if exists (select 1 from pg_constraint where conrelid = 'public.orders'::regclass and conname = 'orders_payment_key_key'
             and pg_get_constraintdef(oid) <> 'UNIQUE (payment_key)') then
    raise exception 'precondition failed: orders_payment_key_key exists with an unexpected definition';
  end if;

  -- 5. RLS and policies as expected: orders on with exactly its own-row
  --    SELECT policy, payment_attempts on with none.
  if not (select relrowsecurity from pg_class where oid = 'public.orders'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.payment_attempts'::regclass) then
    raise exception 'precondition failed: RLS is not enabled on orders / payment_attempts';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'orders') <> 1
     or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'orders'
                    and cmd = 'SELECT' and qual = '(auth.uid() = user_id)')
     or exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'payment_attempts') then
    raise exception 'precondition failed: orders / payment_attempts policies differ from expected';
  end if;

  -- 6. Client privileges: nothing on payment_attempts; on orders at most
  --    the read / RLS-blocked set being removed here (never INSERT, no
  --    column-level write grant).
  select string_agg(format('%s:%s', pg_get_userbyid(x.grantee), x.privilege_type), ', ') into v_bad
  from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
  where c.oid = 'public.orders'::regclass
    and (x.grantee = 0 or pg_get_userbyid(x.grantee) in ('anon', 'authenticated'))
    and (x.grantee = 0 or x.privilege_type not in ('SELECT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'));
  if v_bad is not null then
    raise exception 'precondition failed: unexpected client privilege(s) on orders: %', v_bad;
  end if;
  if exists (select 1 from pg_attribute a, aclexplode(a.attacl) x
             where a.attrelid = 'public.orders'::regclass and a.attacl is not null
               and (x.grantee = 0 or pg_get_userbyid(x.grantee) in ('anon', 'authenticated'))
               and x.privilege_type <> 'SELECT') then
    raise exception 'precondition failed: a client role has a column-level write grant on orders';
  end if;
  if has_table_privilege('anon', 'public.payment_attempts', 'select, insert, update, delete, truncate')
     or has_table_privilege('authenticated', 'public.payment_attempts', 'select, insert, update, delete, truncate')
     or has_any_column_privilege('anon', 'public.payment_attempts', 'select, insert, update')
     or has_any_column_privilege('authenticated', 'public.payment_attempts', 'select, insert, update') then
    raise exception 'precondition failed: a client role has privileges on payment_attempts';
  end if;
  if not has_table_privilege('service_role', 'public.orders', 'select, insert, update')
     or not has_table_privilege('service_role', 'public.payment_attempts', 'select, insert, update') then
    raise exception 'precondition failed: service_role lacks select/insert/update on orders / payment_attempts';
  end if;
end $$;

-- Privileges of the tables whose grants must NOT change, compared afterwards.
create temp table m4a_acl_before on commit drop as
  select c.oid::regclass::text t, c.relacl::text acl,
         (select string_agg(a.attname || '=' || a.attacl::text, ';' order by a.attname)
          from pg_attribute a where a.attrelid = c.oid and a.attacl is not null) col_acl
  from pg_class c
  where c.oid in ('public.payment_attempts'::regclass, 'public.auction_wins'::regclass);

-- ── 1. payment_attempts: recovery / operations columns ─────────────────────
alter table public.payment_attempts
  add column if not exists toss_idempotency_key    text,
  add column if not exists toss_status             text,
  add column if not exists approved_at             timestamptz,
  add column if not exists last_checked_at         timestamptz,
  add column if not exists shipping_recipient_name text,
  add column if not exists shipping_phone          text,
  add column if not exists shipping_postcode       text,
  add column if not exists shipping_address        text,
  add column if not exists shipping_address_detail text;

-- Constraints: created, or (left by the rollback) checked to be exactly ours.
do $$
declare
  r record;
  v_def text;
begin
  for r in
    select * from (values
      ('payment_attempts_toss_idempotency_key_key', 'UNIQUE (toss_idempotency_key)',
       'alter table public.payment_attempts add constraint payment_attempts_toss_idempotency_key_key unique (toss_idempotency_key)'),
      ('payment_attempts_toss_idempotency_key_length',
       'CHECK (((toss_idempotency_key IS NULL) OR ((char_length(toss_idempotency_key) >= 1) AND (char_length(toss_idempotency_key) <= 300))))',
       'alter table public.payment_attempts add constraint payment_attempts_toss_idempotency_key_length check (toss_idempotency_key is null or (char_length(toss_idempotency_key) >= 1 and char_length(toss_idempotency_key) <= 300))'),
      ('payment_attempts_shipping_snapshot_complete',
       'CHECK ((((shipping_recipient_name IS NULL) AND (shipping_phone IS NULL) AND (shipping_postcode IS NULL) AND (shipping_address IS NULL) AND (shipping_address_detail IS NULL)) OR ((shipping_recipient_name IS NOT NULL) AND (shipping_phone IS NOT NULL) AND (shipping_postcode IS NOT NULL) AND (shipping_address IS NOT NULL))))',
       'alter table public.payment_attempts add constraint payment_attempts_shipping_snapshot_complete check ((shipping_recipient_name is null and shipping_phone is null and shipping_postcode is null and shipping_address is null and shipping_address_detail is null) or (shipping_recipient_name is not null and shipping_phone is not null and shipping_postcode is not null and shipping_address is not null))')
    ) t(name, def, ddl)
  loop
    select pg_get_constraintdef(oid) into v_def from pg_constraint
    where conrelid = 'public.payment_attempts'::regclass and conname = r.name;
    if not found then
      execute r.ddl;
    elsif v_def <> r.def then
      raise exception 'precondition failed: constraint % exists as %', r.name, v_def;
    end if;
  end loop;
end $$;

-- ── 2. orders.payment_key: NOT NULL + UNIQUE ───────────────────────────────
-- (kept by the rollback, so it may already be there in exactly this form)
alter table public.orders alter column payment_key set not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.orders'::regclass and conname = 'orders_payment_key_key') then
    alter table public.orders add constraint orders_payment_key_key unique (payment_key);
  end if;
end $$;

-- ── 3. Allowed status moves on payment_attempts ────────────────────────────
create function public.payment_attempts_guard_transition()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  if tg_op = 'INSERT' then
    if new.status is distinct from 'pending' then
      raise exception using errcode = 'P0001', message = 'payment_attempt_transition_forbidden:insert_' || coalesce(new.status, 'null');
    end if;
    return new;
  end if;

  if new.order_id is distinct from old.order_id or new.user_id is distinct from old.user_id
     or new.winner_id is distinct from old.winner_id or new.amount is distinct from old.amount
     or new.payment_key is distinct from old.payment_key then
    raise exception using errcode = 'P0001', message = 'payment_attempt_transition_forbidden:identity';
  end if;
  if old.toss_idempotency_key is not null and new.toss_idempotency_key is distinct from old.toss_idempotency_key then
    raise exception using errcode = 'P0001', message = 'payment_attempt_transition_forbidden:idempotency_key';
  end if;
  if new.win_id is distinct from old.win_id and not (old.status = 'failed' and new.status = 'pending') then
    raise exception using errcode = 'P0001', message = 'payment_attempt_transition_forbidden:win_id';
  end if;

  if not (
       (old.status = 'pending' and new.status in ('pending', 'paid', 'failed', 'reconciliation_required'))
    or (old.status = 'failed' and new.status in ('failed', 'pending'))
    or (old.status = 'reconciliation_required' and new.status in ('reconciliation_required', 'paid', 'failed'))
    or (old.status = 'paid' and new.status = 'paid')
  ) then
    raise exception using errcode = 'P0001', message = 'payment_attempt_transition_forbidden:' || old.status || '_to_' || new.status;
  end if;
  return new;
end;
$function$;
revoke all on function public.payment_attempts_guard_transition() from public, anon, authenticated, service_role;

create trigger payment_attempts_guard_transition
  before insert or update on public.payment_attempts
  for each row execute function public.payment_attempts_guard_transition();

-- ── 4. payment_reserve_attempt(): deadline + reservation, one transaction ──
-- Returns the attempt's Toss Idempotency-Key. Refusals are stable messages
-- (reserve:*); a duplicate active attempt surfaces as the unique index's
-- own 23505, exactly as a direct INSERT did.
create function public.payment_reserve_attempt(
  p_order_id text, p_user_id uuid, p_win_id uuid, p_amount integer, p_payment_key text,
  p_recipient_name text, p_phone text, p_postcode text, p_address text, p_address_detail text)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_win     record;
  v_att     record;
  v_key     text;
  v_name    text := nullif(btrim(p_recipient_name), '');
  v_phone   text := nullif(btrim(p_phone), '');
  v_post    text := nullif(btrim(p_postcode), '');
  v_addr    text := nullif(btrim(p_address), '');
  v_detail  text := nullif(btrim(p_address_detail), '');
begin
  if p_order_id is null or p_order_id = '' or char_length(p_order_id) > 64 or p_user_id is null or p_win_id is null
     or p_amount is null or p_amount <= 0 or p_payment_key is null or p_payment_key = '' or char_length(p_payment_key) > 200 then
    raise exception using errcode = 'P0001', message = 'reserve:invalid';
  end if;
  if v_name is null or v_phone is null or v_post is null or v_addr is null then
    raise exception using errcode = 'P0001', message = 'reserve:shipping_required';
  end if;

  -- The win, locked: reservations for one win run one at a time.
  select id, winner_id, winning_price, claimed_at, payment_deadline into v_win
  from auction_wins where id = p_win_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'reserve:no_win';
  end if;
  if v_win.winner_id <> p_user_id then
    raise exception using errcode = 'P0001', message = 'reserve:not_winner';
  end if;
  if v_win.winning_price <> p_amount then
    raise exception using errcode = 'P0001', message = 'reserve:amount_mismatch';
  end if;
  if now() >= v_win.payment_deadline then
    raise exception using errcode = 'P0001', message = 'reserve:window_expired';
  end if;

  select order_id, user_id, winner_id, amount, payment_key, status, win_id into v_att
  from payment_attempts where order_id = p_order_id for update;

  if found then
    -- Only this order's own 'failed' attempt can be reserved again.
    if v_att.user_id <> p_user_id or v_att.winner_id <> p_user_id or v_att.amount <> p_amount
       or v_att.payment_key <> p_payment_key or (v_att.win_id is not null and v_att.win_id <> p_win_id) then
      raise exception using errcode = 'P0001', message = 'reserve:order_in_use';
    end if;
    if v_att.status <> 'failed' then
      raise exception using errcode = 'P0001', message = 'reserve:busy';
    end if;
    update payment_attempts
    set status = 'pending', win_id = p_win_id, win_claimed_at = v_win.claimed_at, error_detail = null,
        toss_status = null,
        toss_idempotency_key = coalesce(toss_idempotency_key, 'confirm-' || gen_random_uuid()::text),
        shipping_recipient_name = v_name, shipping_phone = v_phone, shipping_postcode = v_post,
        shipping_address = v_addr, shipping_address_detail = v_detail,
        updated_at = now()
    where order_id = p_order_id
    returning toss_idempotency_key into v_key;
    return v_key;
  end if;

  insert into payment_attempts (
    order_id, user_id, winner_id, win_id, win_claimed_at, amount, payment_key, status, toss_idempotency_key,
    shipping_recipient_name, shipping_phone, shipping_postcode, shipping_address, shipping_address_detail)
  values (
    p_order_id, p_user_id, v_win.winner_id, p_win_id, v_win.claimed_at, p_amount, p_payment_key, 'pending',
    'confirm-' || gen_random_uuid()::text,
    v_name, v_phone, v_post, v_addr, v_detail)
  returning toss_idempotency_key into v_key;
  return v_key;
end;
$function$;
revoke all on function public.payment_reserve_attempt(text, uuid, uuid, integer, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.payment_reserve_attempt(text, uuid, uuid, integer, text, text, text, text, text, text) to service_role;

-- ── 5. payment_finalize_paid(): order + 'paid', one transaction ────────────
-- Called only after the caller verified a DONE Payment for this attempt
-- (paymentKey / orderId / amount / KRW). Returns
--   paid | already_paid                      -> success
--   duplicate_win | order_mismatch | no_shipping_snapshot | duplicate_payment_key
--                                            -> attempt left reconciliation_required
-- and raises (nothing written) for a call that can't apply at all.
create function public.payment_finalize_paid(p_order_id text, p_toss_response jsonb, p_toss_status text, p_approved_at timestamptz)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_att   record;
  v_win   record;
  v_order record;
  v_user  uuid;
  v_why   text;
begin
  if p_toss_status is distinct from 'DONE' then
    raise exception using errcode = 'P0001', message = 'finalize:not_done';
  end if;

  select * into v_att from payment_attempts where order_id = p_order_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'finalize:no_attempt';
  end if;
  if v_att.win_id is null then
    raise exception using errcode = 'P0001', message = 'finalize:legacy_attempt';
  end if;

  select order_id, win_id, amount, payment_key into v_order from orders where order_id = p_order_id;

  if v_att.status = 'paid' then
    if v_order.order_id is not null then
      return 'already_paid';
    end if;
    raise exception using errcode = 'P0001', message = 'finalize:paid_without_order';
  end if;
  if v_att.status not in ('pending', 'reconciliation_required') then
    raise exception using errcode = 'P0001', message = 'finalize:status_' || v_att.status;
  end if;

  if v_order.order_id is not null then
    -- Already recorded (an earlier run that crashed before 'paid'): it must
    -- be this exact payment.
    if v_order.win_id is distinct from v_att.win_id or v_order.amount <> v_att.amount or v_order.payment_key <> v_att.payment_key then
      v_why := 'order_mismatch';
    end if;
  elsif exists (select 1 from orders where win_id = v_att.win_id) then
    v_why := 'duplicate_win';
  elsif exists (select 1 from orders where payment_key = v_att.payment_key) then
    v_why := 'duplicate_payment_key';
  elsif v_att.shipping_recipient_name is null then
    v_why := 'no_shipping_snapshot';
  end if;

  if v_why is not null then
    update payment_attempts
    set status = 'reconciliation_required', toss_response = p_toss_response, toss_status = p_toss_status,
        approved_at = p_approved_at, last_checked_at = now(), error_detail = 'finalize:' || v_why, updated_at = now()
    where order_id = p_order_id;
    return v_why;
  end if;

  if v_order.order_id is null then
    select product_name into v_win from auction_wins where id = v_att.win_id;
    v_user := v_att.user_id;
    begin
      insert into orders (
        user_id, winner_id, win_id, product_name, amount, order_id, payment_key,
        shipping_recipient_name, shipping_phone, shipping_postcode, shipping_address, shipping_address_detail)
      values (
        v_user, v_att.winner_id, v_att.win_id, v_win.product_name, v_att.amount, v_att.order_id, v_att.payment_key,
        v_att.shipping_recipient_name, v_att.shipping_phone, v_att.shipping_postcode, v_att.shipping_address,
        v_att.shipping_address_detail);
    exception when foreign_key_violation then
      -- orders.user_id references auth.users (ON DELETE SET NULL): an
      -- account deleted since the reservation still gets its order, linked
      -- by winner_id only — exactly what the deletion would have left.
      insert into orders (
        user_id, winner_id, win_id, product_name, amount, order_id, payment_key,
        shipping_recipient_name, shipping_phone, shipping_postcode, shipping_address, shipping_address_detail)
      values (
        null, v_att.winner_id, v_att.win_id, v_win.product_name, v_att.amount, v_att.order_id, v_att.payment_key,
        v_att.shipping_recipient_name, v_att.shipping_phone, v_att.shipping_postcode, v_att.shipping_address,
        v_att.shipping_address_detail);
    end;
  end if;

  update payment_attempts
  set status = 'paid', toss_response = p_toss_response, toss_status = p_toss_status, approved_at = p_approved_at,
      last_checked_at = now(), error_detail = null, updated_at = now()
  where order_id = p_order_id;
  return 'paid';
end;
$function$;
revoke all on function public.payment_finalize_paid(text, jsonb, text, timestamptz) from public, anon, authenticated;
grant execute on function public.payment_finalize_paid(text, jsonb, text, timestamptz) to service_role;

-- ── 6. orders: client privileges narrowed to what the app reads ────────────
-- REVOKE ALL on the table also drops any column-level grant, so this is
-- exact whether or not it ran before (rollback keeps it).
revoke all on table public.orders from public, anon, authenticated;
grant select (order_id, user_id, win_id, product_name, amount, created_at) on table public.orders to authenticated;

-- ── Post-conditions (any failure rolls back) ────────────────────────────────
do $$
declare
  r      record;
  v_md5  text;
  v_bad  text;
  v_own  oid;
begin
  -- New functions: bodies as pinned; the two RPCs security definer with
  -- search_path=public, owned like claim_winner(), EXECUTE service_role
  -- only; the trigger function executable by nobody (triggers don't need it).
  select proowner into v_own from pg_proc where oid = 'public.claim_winner()'::regprocedure;
  for r in
    select * from (values
      ('public.payment_reserve_attempt(text,uuid,uuid,integer,text,text,text,text,text,text)', '3b0840ae43dd5807a074816a8ca03fdf', true),
      ('public.payment_finalize_paid(text,jsonb,text,timestamptz)',                              'e4d02c5b0c445e83965b585bc4ff6a12', true),
      ('public.payment_attempts_guard_transition()',                                             '3b910dd20de5c3e8f61398caf1d8b28e', false)
    ) t(sig, md5, rpc)
  loop
    select md5(regexp_replace(p.prosrc, '\s+', '', 'g')) into v_md5 from pg_proc p where p.oid = to_regprocedure(r.sig);
    if v_md5 is distinct from r.md5 then
      raise exception 'post-condition failed: % body md5 is %, expected %', r.sig, coalesce(v_md5, '<missing>'), r.md5;
    end if;
    if exists (select 1 from pg_proc p where p.oid = to_regprocedure(r.sig)
               and (p.prosecdef <> r.rpc or p.proconfig is distinct from array['search_path=public'] or p.proowner <> v_own)) then
      raise exception 'post-condition failed: % security definer / search_path / owner', r.sig;
    end if;
    if has_function_privilege('anon', r.sig, 'execute') or has_function_privilege('authenticated', r.sig, 'execute')
       or has_function_privilege('service_role', r.sig, 'execute') <> r.rpc
       or exists (select 1 from pg_proc p, aclexplode(p.proacl) x where p.oid = to_regprocedure(r.sig) and x.grantee = 0) then
      raise exception 'post-condition failed: % EXECUTE grants', r.sig;
    end if;
  end loop;
  -- The RPC owner can do what they do (owner of these tables, or bypasses RLS).
  if not has_table_privilege(v_own, 'public.auction_wins', 'select, update')
     or not has_table_privilege(v_own, 'public.payment_attempts', 'select, insert, update')
     or not has_table_privilege(v_own, 'public.orders', 'select, insert') then
    raise exception 'post-condition failed: the RPC owner lacks privileges on auction_wins / payment_attempts / orders';
  end if;

  -- The trigger, enabled, before insert or update, for each row.
  if not exists (select 1 from pg_trigger t
                 where t.tgrelid = 'public.payment_attempts'::regclass and t.tgname = 'payment_attempts_guard_transition'
                   and t.tgfoid = 'public.payment_attempts_guard_transition()'::regprocedure
                   and t.tgenabled = 'O' and t.tgtype = 23) then
    raise exception 'post-condition failed: payment_attempts_guard_transition trigger';
  end if;

  -- Columns and constraints.
  if (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'payment_attempts' and is_nullable = 'YES'
        and column_name in ('toss_idempotency_key', 'toss_status', 'approved_at', 'last_checked_at', 'shipping_recipient_name',
                            'shipping_phone', 'shipping_postcode', 'shipping_address', 'shipping_address_detail')) <> 9 then
    raise exception 'post-condition failed: payment_attempts recovery columns';
  end if;
  if (select count(*) from pg_constraint where conrelid = 'public.payment_attempts'::regclass
      and conname in ('payment_attempts_toss_idempotency_key_key', 'payment_attempts_toss_idempotency_key_length',
                      'payment_attempts_shipping_snapshot_complete')) <> 3 then
    raise exception 'post-condition failed: payment_attempts constraints';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders'
                 and column_name = 'payment_key' and is_nullable = 'NO')
     or not exists (select 1 from pg_constraint where conrelid = 'public.orders'::regclass
                    and conname = 'orders_payment_key_key' and pg_get_constraintdef(oid) = 'UNIQUE (payment_key)') then
    raise exception 'post-condition failed: orders.payment_key NOT NULL / UNIQUE';
  end if;

  -- orders privileges: anon none, authenticated exactly the six column
  -- SELECTs, no PUBLIC; RLS and the policy kept.
  if exists (select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
             where c.oid = 'public.orders'::regclass
               and (x.grantee = 0 or pg_get_userbyid(x.grantee) in ('anon', 'authenticated'))) then
    raise exception 'post-condition failed: a client role still has a table-level privilege on orders';
  end if;
  select string_agg(format('%s.%s:%s', a.attname, case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end, x.privilege_type), ', ' order by a.attname)
    into v_bad
  from pg_attribute a, aclexplode(a.attacl) x
  where a.attrelid = 'public.orders'::regclass and a.attacl is not null
    and (x.grantee = 0 or pg_get_userbyid(x.grantee) in ('anon', 'authenticated'));
  if v_bad is distinct from 'amount.authenticated:SELECT, created_at.authenticated:SELECT, order_id.authenticated:SELECT, product_name.authenticated:SELECT, user_id.authenticated:SELECT, win_id.authenticated:SELECT' then
    raise exception 'post-condition failed: orders column grants are %', coalesce(v_bad, '<none>');
  end if;
  if has_column_privilege('authenticated', 'public.orders', 'payment_key', 'select')
     or has_any_column_privilege('anon', 'public.orders', 'select, insert, update') then
    raise exception 'post-condition failed: orders.payment_key readable by authenticated, or anon has access';
  end if;
  if not has_table_privilege('service_role', 'public.orders', 'select, insert, update, delete') then
    raise exception 'post-condition failed: service_role lost privileges on orders';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.orders'::regclass)
     or (select count(*) from pg_policies where schemaname = 'public' and tablename = 'orders') <> 1 then
    raise exception 'post-condition failed: orders RLS / policy changed';
  end if;

  -- payment_attempts and auction_wins privileges unchanged.
  if (select count(*) from m4a_acl_before) <> 2
     or exists (select 1 from m4a_acl_before b join pg_class c on c.oid = b.t::regclass
                where c.relacl::text is distinct from b.acl
                   or (select string_agg(a.attname || '=' || a.attacl::text, ';' order by a.attname)
                       from pg_attribute a where a.attrelid = c.oid and a.attacl is not null) is distinct from b.col_acl) then
    raise exception 'post-condition failed: payment_attempts / auction_wins privileges changed';
  end if;
end $$;
