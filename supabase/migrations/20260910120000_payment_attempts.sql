-- Phase 3.6: post-confirm order durability / reconciliation.
--
-- Problem this closes: Phase 3.5's confirm route calls Toss BEFORE any
-- local record of the attempt exists. If Toss confirms the charge but the
-- final `orders` INSERT then fails (a transient DB error), the only trace
-- left was a console.error — a real, successful charge with no durable
-- record anywhere in the DB.
--
-- payment_attempts is written *before* Toss is ever contacted (status
-- 'pending'), carrying order_id + the already-verified user.id/winner_id/
-- amount from Phase 3's checks, and is updated on every outcome:
--   'paid'                    — Toss confirmed AND orders saved cleanly
--   'failed'                  — Toss itself rejected the confirm
--   'reconciliation_required' — Toss confirmed but the orders insert
--                                failed; the payment genuinely succeeded,
--                                this row carries everything (toss_response
--                                has orderName/totalAmount/method, plus
--                                user_id/winner_id/amount/payment_key)
--                                needed to manually — or via a future
--                                automated job — insert the missing
--                                `orders` row later.
--
-- order_id is the primary key: it's the natural idempotency key for the
-- whole confirm flow (see app/api/payment/confirm/route.ts), and one
-- order_id should only ever correspond to one attempt.
--
-- Access lockdown (unlike every other table in this schema so far — RLS for
-- the rest is its own separate, later phase): this table holds
-- payment_key/toss_response/error_detail, which is more sensitive than
-- anything else currently in the DB, and the browser client never needs to
-- read or write it directly — only app/api/payment/confirm/route.ts's
-- service-role client touches it. So it gets locked down immediately,
-- scoped to just this table, via two independent, complementary
-- mechanisms:
--   1. RLS enabled with zero policies — Postgres's RLS default is deny-all
--      for any role subject to it once RLS is on, with no policy needed to
--      express that; service_role has BYPASSRLS on Supabase projects, so
--      it's unaffected.
--   2. An explicit REVOKE undoing the privileges this table would
--      otherwise inherit from this project's schema-level default
--      privileges (the same mechanism that already gives anon/authenticated
--      open CRUD on every pre-existing table in this schema — a brand new
--      table in the public schema inherits that unless revoked).
-- Belt and suspenders on purpose: either one alone would already block
-- anon/authenticated, but they fail closed independently of each other.
--
-- Run this manually in the Supabase SQL Editor (Database > SQL Editor).

begin;

create table if not exists public.payment_attempts (
  order_id      text primary key,
  user_id       uuid not null,
  winner_id     uuid not null,
  amount        integer not null,
  payment_key   text not null,
  status        text not null default 'pending'
                check (status in ('pending', 'paid', 'failed', 'reconciliation_required')),
  toss_response jsonb,
  error_detail  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.payment_attempts enable row level security;

revoke all on table public.payment_attempts from public, anon, authenticated;

commit;
