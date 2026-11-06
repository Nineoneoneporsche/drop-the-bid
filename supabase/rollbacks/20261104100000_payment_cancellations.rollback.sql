-- EMERGENCY ROLLBACK for supabase/migrations/20261104100000_payment_cancellations.sql (M4-B1).
--
-- NOT a migration: it lives outside supabase/migrations on purpose, so a
-- fresh replay never undoes M4-B1. Run it by hand in the Supabase SQL Editor
-- only if M4-B1 has to be taken back. Roll the app back FIRST (no refund
-- code calling the RPCs below).
--
-- Drops everything M4-B1 created:
--   trigger  orders_guard_refunded_at on orders
--   trigger  payment_cancellations_guard_transition on payment_cancellations
--   payment_cancel_reserve(text,text,uuid)                       md5 9e3c4d40972a7ef7a56f2bb2b105382d
--   payment_cancel_record_post(uuid,text,integer,text)           md5 a002cf826d9c383412fa03c9aff90f1a
--   payment_cancel_mark(uuid,text,text,text,jsonb,text)          md5 8a10282e6588281821833dcd7c23648c
--   payment_cancel_finalize(uuid,text,text,timestamptz,jsonb)    md5 cffac42874250be292dc5f823a6717ff
--   payment_cancellations_guard_transition()                     md5 02185e30dad239701e18ff5de3063f8f
--   orders_guard_refunded_at()                                   md5 0845977dc26ace018ae0b5c8a78c83ce
--   table   payment_cancellations
--   column  orders.refunded_at
--
-- REFUSES (nothing changes) once any refund history exists — a row in
-- payment_cancellations or a non-NULL orders.refunded_at: refund records
-- are never deleted. In that case leave M4-B1 in place and disable the
-- refund code in the app instead.
-- Payment data (payment_attempts / orders / auction_wins rows) is never
-- deleted or rewritten here.
--
-- MIGRATION HISTORY WARNING:
--   - Once M4-B1 has been applied with `db push` and recorded as applied in
--     supabase_migrations.schema_migrations, running this script by hand
--     only reverts the OBJECTS. Migration history is NOT changed: version
--     20261104100000 stays recorded as applied.
--   - After a successful rollback, do NOT run `db push` again until the
--     remote migration history has been verified and reconciled separately.
--   - If needed, `migration repair --status reverted 20261104100000` is run
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
  v_n   bigint;
begin
  for r in
    select * from (values
      ('public.payment_cancel_reserve(text,text,uuid)',                    '9e3c4d40972a7ef7a56f2bb2b105382d'),
      ('public.payment_cancel_record_post(uuid,text,integer,text)',        'a002cf826d9c383412fa03c9aff90f1a'),
      ('public.payment_cancel_mark(uuid,text,text,text,jsonb,text)',       '8a10282e6588281821833dcd7c23648c'),
      ('public.payment_cancel_finalize(uuid,text,text,timestamptz,jsonb)', 'cffac42874250be292dc5f823a6717ff'),
      ('public.payment_cancellations_guard_transition()',                  '02185e30dad239701e18ff5de3063f8f'),
      ('public.orders_guard_refunded_at()',                                '0845977dc26ace018ae0b5c8a78c83ce')
    ) t(sig, md5)
  loop
    select md5(regexp_replace(p.prosrc, '\s+', '', 'g')) into v_md5 from pg_proc p where p.oid = to_regprocedure(r.sig);
    if v_md5 is distinct from r.md5 then
      raise exception 'rollback precondition failed: % body md5 is %, expected %', r.sig, coalesce(v_md5, '<missing>'), r.md5;
    end if;
  end loop;
  if to_regclass('public.payment_cancellations') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'refunded_at') then
    raise exception 'rollback precondition failed: payment_cancellations / orders.refunded_at missing';
  end if;

  select count(*) into v_n from public.payment_cancellations;
  if v_n > 0 then
    raise exception 'rollback refused: % payment_cancellations row(s) exist — refund history is never deleted', v_n;
  end if;
  select count(*) into v_n from public.orders where refunded_at is not null;
  if v_n > 0 then
    raise exception 'rollback refused: % orders row(s) have refunded_at — refund history is never deleted', v_n;
  end if;
end $$;

-- ── 1. Drop ─────────────────────────────────────────────────────────────────
drop trigger orders_guard_refunded_at on public.orders;
drop function public.orders_guard_refunded_at();
drop function public.payment_cancel_finalize(uuid, text, text, timestamptz, jsonb);
drop function public.payment_cancel_mark(uuid, text, text, text, jsonb, text);
drop function public.payment_cancel_record_post(uuid, text, integer, text);
drop function public.payment_cancel_reserve(text, text, uuid);
drop table public.payment_cancellations;
drop function public.payment_cancellations_guard_transition();
alter table public.orders drop column refunded_at;

-- ── 2. Post-conditions ──────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.payment_cancellations') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'refunded_at')
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public'
                  and p.proname in ('payment_cancel_reserve', 'payment_cancel_record_post', 'payment_cancel_mark', 'payment_cancel_finalize',
                                    'payment_cancellations_guard_transition', 'orders_guard_refunded_at'))
     or exists (select 1 from pg_trigger where tgrelid = 'public.orders'::regclass and not tgisinternal) then
    raise exception 'rollback post-condition failed: an M4-B1 object is still present';
  end if;
end $$;

commit;
