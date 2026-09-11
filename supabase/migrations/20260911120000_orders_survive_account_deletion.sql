-- Fixes: deleting a user's account (app/api/account/delete/route.ts) used
-- to CASCADE-delete their `orders` rows entirely, destroying the record of
-- an already-completed payment. Two changes, applied together:
--
--   1. orders.winner_id (new, NOT NULL, no FK) — an immutable historical
--      record of who this order was for, mirroring the existing
--      payment_attempts.winner_id pattern (which has no FK to auth.users
--      and is therefore already immune to account deletion, by
--      construction rather than accident). Set once at insert
--      (app/api/payment/confirm/route.ts), never updated again.
--
--   2. orders.user_id: FK to auth.users(id) changed from ON DELETE CASCADE
--      to ON DELETE SET NULL — the order row itself now survives an
--      account deletion; only the "which currently-live account is this"
--      pointer goes null. Admin/reconciliation logic (payment-status
--      route) now keys off winner_id, not user_id, so it stays correct
--      even after user_id is nulled.
--
-- The existing SELECT RLS policy on orders (`using (auth.uid() = user_id)`)
-- is untouched — a null user_id can never match auth.uid(), so a deleted
-- account's old order correctly becomes invisible to the (nonexistent)
-- owner, which is exactly the desired behavior. Nothing else about orders'
-- access control changes.
--
-- Constraint discovery/replacement is precise, not a hardcoded name and
-- not "any FK on this column": it identifies the FK whose SOURCE is
-- exactly public.orders.user_id AND whose TARGET is exactly
-- auth.users.id (checked via pg_constraint.confrelid/confkey, not just
-- conrelid/conkey), and drops only that one. If some OTHER, unexpected FK
-- is present on orders.user_id (targeting something other than
-- auth.users.id), this migration aborts instead of dropping it blindly —
-- that shouldn't happen, but this doesn't assume it can't. After adding
-- the new ON DELETE SET NULL constraint, three post-conditions are
-- verified before commit: exactly one FK from orders.user_id to
-- auth.users.id exists, its delete action is SET NULL, and no CASCADE FK
-- of any kind remains on orders.user_id. Any of these failing raises an
-- exception, rolling back the whole transaction.
--
-- Run this manually in the Supabase SQL Editor (Database > SQL Editor).

begin;

-- ── 1. winner_id: immutable historical link, independent of account lifecycle ──
alter table public.orders
  add column if not exists winner_id uuid;

update public.orders set winner_id = user_id where winner_id is null;

alter table public.orders
  alter column winner_id set not null;

-- Matches the admin payment-status route's actual query shape exactly:
-- .eq("winner_id", ...).eq("amount", ...).gte("created_at", ...) —
-- equality columns first, range column last.
create index if not exists orders_winner_id_amount_created_at_idx
  on public.orders (winner_id, amount, created_at);

-- ── 2. user_id: nullable, FK switched from CASCADE to SET NULL ──────────────
-- Defensive no-op if the column is already nullable.
alter table public.orders
  alter column user_id drop not null;

do $$
declare
  v_matching_conname text;
  v_other_count      int;
begin
  -- The FK whose source is exactly orders.user_id AND whose target is
  -- exactly auth.users.id — both ends checked via conrelid/conkey (source)
  -- and confrelid/confkey (target), not just the source side.
  select con.conname into v_matching_conname
  from pg_constraint con
  join pg_class      rel  on rel.oid  = con.conrelid
  join pg_namespace  nsp  on nsp.oid  = rel.relnamespace
  join pg_attribute  att  on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
  join pg_class      frel on frel.oid = con.confrelid
  join pg_namespace  fnsp on fnsp.oid = frel.relnamespace
  join pg_attribute  fatt on fatt.attrelid = con.confrelid and fatt.attnum = con.confkey[1]
  where con.contype = 'f'
    and nsp.nspname  = 'public'
    and rel.relname  = 'orders'
    and att.attname  = 'user_id'
    and array_length(con.conkey, 1)  = 1
    and array_length(con.confkey, 1) = 1
    and fnsp.nspname = 'auth'
    and frel.relname = 'users'
    and fatt.attname = 'id'
  limit 1;

  -- Any OTHER single-column FK on orders.user_id that does NOT match the
  -- source/target pair above (i.e. doesn't target auth.users.id) — if one
  -- exists, it's unexpected and must not be touched silently.
  select count(*) into v_other_count
  from pg_constraint con
  join pg_class     rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
  where con.contype = 'f'
    and nsp.nspname = 'public'
    and rel.relname = 'orders'
    and att.attname = 'user_id'
    and array_length(con.conkey, 1) = 1
    and (v_matching_conname is null or con.conname <> v_matching_conname);

  if v_other_count > 0 then
    raise exception 'orders.user_id has % unexpected foreign key constraint(s) not targeting auth.users.id — aborting, refusing to drop blindly', v_other_count;
  end if;

  if v_matching_conname is not null then
    execute format('alter table public.orders drop constraint %I', v_matching_conname);
  end if;
end $$;

-- The only FK orders.user_id should have from this point on.
alter table public.orders
  add constraint orders_user_id_fkey
  foreign key (user_id) references auth.users(id)
  on delete set null;

-- ── Post-conditions — verified, not assumed ─────────────────────────────────
do $$
declare
  v_count         int;
  v_confdeltype   char;
  v_cascade_count int;
begin
  -- 1. Exactly one FK from orders.user_id to auth.users.id.
  select count(*) into v_count
  from pg_constraint con
  join pg_class      rel  on rel.oid  = con.conrelid
  join pg_namespace  nsp  on nsp.oid  = rel.relnamespace
  join pg_attribute  att  on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
  join pg_class      frel on frel.oid = con.confrelid
  join pg_namespace  fnsp on fnsp.oid = frel.relnamespace
  join pg_attribute  fatt on fatt.attrelid = con.confrelid and fatt.attnum = con.confkey[1]
  where con.contype = 'f'
    and nsp.nspname  = 'public'
    and rel.relname  = 'orders'
    and att.attname  = 'user_id'
    and array_length(con.conkey, 1)  = 1
    and array_length(con.confkey, 1) = 1
    and fnsp.nspname = 'auth'
    and frel.relname = 'users'
    and fatt.attname = 'id';

  if v_count <> 1 then
    raise exception 'post-condition failed: expected exactly 1 FK from orders.user_id to auth.users.id, found %', v_count;
  end if;

  -- 2. That FK's delete action is SET NULL ('n' in pg_constraint.confdeltype).
  select con.confdeltype into v_confdeltype
  from pg_constraint con
  join pg_class      rel  on rel.oid  = con.conrelid
  join pg_namespace  nsp  on nsp.oid  = rel.relnamespace
  join pg_attribute  att  on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
  join pg_class      frel on frel.oid = con.confrelid
  join pg_namespace  fnsp on fnsp.oid = frel.relnamespace
  join pg_attribute  fatt on fatt.attrelid = con.confrelid and fatt.attnum = con.confkey[1]
  where con.contype = 'f'
    and nsp.nspname  = 'public'
    and rel.relname  = 'orders'
    and att.attname  = 'user_id'
    and array_length(con.conkey, 1)  = 1
    and array_length(con.confkey, 1) = 1
    and fnsp.nspname = 'auth'
    and frel.relname = 'users'
    and fatt.attname = 'id';

  if v_confdeltype <> 'n' then
    raise exception 'post-condition failed: orders.user_id -> auth.users.id FK delete action is % (expected n = SET NULL)', v_confdeltype;
  end if;

  -- 3. No CASCADE FK of any kind remains on orders.user_id.
  select count(*) into v_cascade_count
  from pg_constraint con
  join pg_class     rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
  where con.contype = 'f'
    and nsp.nspname = 'public'
    and rel.relname = 'orders'
    and att.attname = 'user_id'
    and array_length(con.conkey, 1) = 1
    and con.confdeltype = 'c';

  if v_cascade_count > 0 then
    raise exception 'post-condition failed: % CASCADE foreign key(s) still present on orders.user_id', v_cascade_count;
  end if;
end $$;

commit;
