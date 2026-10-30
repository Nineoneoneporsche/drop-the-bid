-- EMERGENCY ROLLBACK for supabase/migrations/20261030200000_payment_confirm_safety.sql (M4-A).
--
-- NOT a migration: it lives outside supabase/migrations on purpose, so a
-- fresh replay never undoes M4-A. Run it by hand in the Supabase SQL Editor
-- only if M4-A has to be taken back. Roll the app back FIRST (the pre-M4
-- deployment): the M4-A confirm route reserves and finalizes payments
-- through the two RPCs this script drops — with them gone it refuses every
-- new approval before Toss (fails closed), it never charges.
--
-- Drops (functions only, no data is touched):
--   trigger  payment_attempts_guard_transition on payment_attempts
--   payment_attempts_guard_transition()                                         md5 3b910dd20de5c3e8f61398caf1d8b28e
--   payment_reserve_attempt(text,uuid,uuid,integer,text,text,text,text,text,text) md5 3b0840ae43dd5807a074816a8ca03fdf
--   payment_finalize_paid(text,jsonb,text,timestamptz)                            md5 e4d02c5b0c445e83965b585bc4ff6a12
--
-- KEEPS, on purpose — none of it is destructive to keep, and dropping it
-- would destroy payment records:
--   - payment_attempts' new columns (toss_idempotency_key, toss_status,
--     approved_at, last_checked_at, shipping_*) and their constraints:
--     nullable, the pre-M4 app neither reads nor writes them, and they hold
--     the idempotency keys / snapshots of attempts made meanwhile. M4-A's
--     precondition accepts them in exactly this shape if it is re-applied.
--   - orders.payment_key NOT NULL + UNIQUE (orders_payment_key_key): the
--     pre-M4 app always writes a payment_key, one per Toss payment.
--   - orders' narrowed client privileges: the pre-M4 app reads exactly the
--     six columns authenticated can still SELECT (My Page, winOrder.ts) and
--     never wrote orders from the client. Restoring the broad grants is NOT
--     part of this rollback; the statements are at the end, commented out,
--     for the case that a client read is found to need them.
-- Payment data (payment_attempts / orders / auction_wins rows) is never
-- deleted or rewritten here.
--
-- Refuses (nothing changes) unless the three functions are exactly the
-- M4-A bodies and the trigger exists.
--
-- MIGRATION HISTORY WARNING:
--   - Once M4-A has been applied with `db push` and recorded as applied in
--     supabase_migrations.schema_migrations, running this script by hand
--     only reverts the FUNCTIONS / TRIGGER. Migration history is NOT
--     changed: version 20261030200000 stays recorded as applied.
--   - After a successful rollback, do NOT run `db push` again until the
--     remote migration history has been verified and reconciled separately.
--   - If needed, `migration repair --status reverted 20261030200000` is run
--     as a separate, controlled step, only after the rollback has been
--     verified.
--   - This script must never modify supabase_migrations directly.

begin;

set local lock_timeout = '5s';

-- ── 0. Preconditions ────────────────────────────────────────────────────────
do $$
declare
  r     record;
  v_md5 text;
begin
  for r in
    select * from (values
      ('public.payment_attempts_guard_transition()',                                             '3b910dd20de5c3e8f61398caf1d8b28e'),
      ('public.payment_reserve_attempt(text,uuid,uuid,integer,text,text,text,text,text,text)', '3b0840ae43dd5807a074816a8ca03fdf'),
      ('public.payment_finalize_paid(text,jsonb,text,timestamptz)',                              'e4d02c5b0c445e83965b585bc4ff6a12')
    ) t(sig, md5)
  loop
    select md5(regexp_replace(p.prosrc, '\s+', '', 'g')) into v_md5 from pg_proc p where p.oid = to_regprocedure(r.sig);
    if v_md5 is distinct from r.md5 then
      raise exception 'rollback refused: % body md5 is %, expected the M4-A body %', r.sig, coalesce(v_md5, '<missing>'), r.md5;
    end if;
  end loop;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.payment_attempts'::regclass
                 and tgname = 'payment_attempts_guard_transition') then
    raise exception 'rollback refused: trigger payment_attempts_guard_transition missing';
  end if;
end $$;

-- Data / privileges that must come out unchanged, compared afterwards.
create temp table m4a_rb_before on commit drop as
  select (select count(*) from public.payment_attempts) attempts,
         (select count(*) from public.orders) orders,
         (select md5(coalesce(string_agg(t::text, '|' order by order_id), '')) from public.payment_attempts t) attempts_md5,
         (select md5(coalesce(string_agg(t::text, '|' order by order_id), '')) from public.orders t) orders_md5,
         (select relacl::text from pg_class where oid = 'public.orders'::regclass) orders_acl,
         (select string_agg(a.attname || '=' || a.attacl::text, ';' order by a.attname)
          from pg_attribute a where a.attrelid = 'public.orders'::regclass and a.attacl is not null) orders_col_acl;

-- ── 1. Drop the trigger and the three functions ─────────────────────────────
drop trigger payment_attempts_guard_transition on public.payment_attempts;
drop function public.payment_attempts_guard_transition();
drop function public.payment_reserve_attempt(text, uuid, uuid, integer, text, text, text, text, text, text);
drop function public.payment_finalize_paid(text, jsonb, text, timestamptz);

-- ── Post-conditions ─────────────────────────────────────────────────────────
do $$
declare
  v_b record;
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public'
               and p.proname in ('payment_reserve_attempt', 'payment_finalize_paid', 'payment_attempts_guard_transition'))
     or exists (select 1 from pg_trigger where tgrelid = 'public.payment_attempts'::regclass and not tgisinternal) then
    raise exception 'rollback post-condition failed: an M4-A function or trigger remains';
  end if;
  select * into v_b from m4a_rb_before;
  if v_b.attempts <> (select count(*) from public.payment_attempts)
     or v_b.orders <> (select count(*) from public.orders)
     or v_b.attempts_md5 <> (select md5(coalesce(string_agg(t::text, '|' order by order_id), '')) from public.payment_attempts t)
     or v_b.orders_md5 <> (select md5(coalesce(string_agg(t::text, '|' order by order_id), '')) from public.orders t) then
    raise exception 'rollback post-condition failed: payment data changed';
  end if;
  if v_b.orders_acl is distinct from (select relacl::text from pg_class where oid = 'public.orders'::regclass)
     or v_b.orders_col_acl is distinct from (select string_agg(a.attname || '=' || a.attacl::text, ';' order by a.attname)
                                             from pg_attribute a where a.attrelid = 'public.orders'::regclass and a.attacl is not null) then
    raise exception 'rollback post-condition failed: orders privileges changed';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'payment_attempts'
      and column_name in ('toss_idempotency_key', 'toss_status', 'approved_at', 'last_checked_at', 'shipping_recipient_name',
                          'shipping_phone', 'shipping_postcode', 'shipping_address', 'shipping_address_detail')) <> 9 then
    raise exception 'rollback post-condition failed: payment_attempts recovery columns must be kept';
  end if;
end $$;

commit;

-- ── Only if a client read is proven to need the pre-M4 broad orders grants ──
-- (NOT part of the rollback; review before running, separately):
-- begin;
-- grant select, update, delete, truncate, references, trigger, maintain on table public.orders to anon, authenticated;
-- commit;
