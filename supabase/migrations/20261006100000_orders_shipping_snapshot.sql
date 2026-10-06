-- Adds a shipping-info snapshot to orders, captured at the moment a
-- payment is approved (app/api/payment/confirm/route.ts), so the delivery
-- address no longer depends on the member's live profile.
--
-- Until now the only copy of the shipping info was Supabase Auth
-- user_metadata (phone/postcode/address/addressDetail, plus the new
-- shippingRecipientName key). Deleting the account
-- (app/api/account/delete/route.ts -> auth.admin.deleteUser) deletes that
-- metadata, and a later address edit would silently change "where the
-- already-paid order goes". The snapshot columns fix both: they are written
-- once at insert and never updated.
--
-- All five columns are nullable on purpose: orders created before this
-- migration have no snapshot and must not be rewritten or rejected. The
-- "required fields present" rule for new orders is enforced by the confirm
-- route before Toss is ever contacted (missingShippingFields() in
-- app/lib/shipping.ts); shipping_address_detail is optional there too.
--
-- Untouched by design: winner_id (immutable, no FK), the
-- user_id -> auth.users ON DELETE SET NULL FK, the existing SELECT RLS
-- policy (auth.uid() = user_id) and the revoked client INSERT grant from
-- 20260910170000_final_rls_lockdown.sql. The snapshot columns live on the
-- same row, so they survive account deletion exactly like the order does.
-- Adding columns does not change table-level privileges.
--
-- Run this manually in the Supabase SQL Editor (Database > SQL Editor).

begin;

-- ADD COLUMN (nullable, no default) is metadata-only — no table rewrite —
-- but still needs a brief ACCESS EXCLUSIVE lock. Give up after 5s rather
-- than queueing behind a long-running query and blocking every orders
-- read/write behind it; on timeout nothing is applied, just re-run.
set local lock_timeout = '5s';

alter table public.orders
  add column if not exists shipping_recipient_name text,
  add column if not exists shipping_phone          text,
  add column if not exists shipping_postcode       text,
  add column if not exists shipping_address        text,
  add column if not exists shipping_address_detail text;

commit;
