-- Phase 7: final RLS / database access lockdown. Adds RLS to the two
-- tables that never had it (participants, and a defense-in-depth layer on
-- game_state/chat_messages which were already REVOKE-locked), closes a
-- real exploitable gap in orders (self-serve fake order INSERT), replaces
-- participants' unrestricted ghost-cleanup DELETE with a parameterless
-- server-time-only RPC, and moves every user-callable RPC off implicit
-- PUBLIC EXECUTE onto explicit anon/authenticated grants. Does not touch
-- anything already correctly locked down in Phase 3.6/4/5/6
-- (payment_attempts, admin_sessions, admin_login_attempts, the admin-only
-- RPCs, or profiles — profiles has only `id`+`nickname`, no PII, its
-- existing policies are already correct).
--
-- Run this manually in the Supabase SQL Editor (Database > SQL Editor).

begin;

-- ────────────────────────────────────────────────────────────────────────
-- orders: close the self-serve fake-order INSERT gap
-- ────────────────────────────────────────────────────────────────────────
-- The existing INSERT policy (`with check (auth.uid() = user_id)`, name
-- unknown — not created by any migration in this repo, predates it) only
-- restricted *whose name* a fake order could be filed under, not whether
-- filing one at all was allowed. Verified exploitable: an authenticated
-- user could POST /rest/v1/orders directly and create an arbitrary
-- "purchase" row with any product_name/amount, bypassing Toss entirely and
-- everything in app/api/payment/confirm/route.ts (payment_attempts
-- durability, idempotency, amount/winner checks). orders is only ever
-- legitimately written by that route's service-role client — no
-- legitimate client-side INSERT exists at all. SELECT (own-row) and
-- UPDATE/DELETE (already fully blocked) are untouched.
do $$
declare
  pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'orders' and cmd = 'INSERT'
  loop
    execute format('drop policy %I on public.orders', pol.policyname);
  end loop;
end $$;

revoke insert on table public.orders from public, anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- participants: first-time RLS, ghost-cleanup moved to a dedicated RPC
-- ────────────────────────────────────────────────────────────────────────
-- Phase 4 could only narrow UPDATE to the last_seen *column* (RLS didn't
-- exist yet), leaving every row's last_seen writable by anyone, and left
-- DELETE fully open (needed for both leaveGame's own-row delete and the
-- client-driven ghost-participant cleanup on *other* people's stale rows —
-- there was no way to express "own row, or anyone's if truly stale" at the
-- privilege layer alone). RLS now lets UPDATE/DELETE be pinned to the
-- caller's own row exactly, and the "anyone's stale row" case is carved
-- out into its own narrow, parameterless RPC below instead of being baked
-- into the DELETE policy itself — cleanup_stale_participants() decides
-- staleness from the DB's own now(), never a client-supplied id or time,
-- so it can't be used to delete anything but genuinely stale rows.
alter table public.participants enable row level security;

create policy participants_select_all
  on public.participants for select
  to anon, authenticated
  using (true);

-- No INSERT policy at all — join_game() (SECURITY DEFINER) is the only
-- way a participants row can ever be created; a raw client INSERT (which
-- previously bypassed join_game()'s role/nickname/anonymous-participant
-- validation entirely — verified exploitable) is now rejected outright.
revoke insert on table public.participants from public, anon, authenticated;

create policy participants_update_own
  on public.participants for update
  to anon, authenticated
  using (auth.uid() = guest_id)
  with check (auth.uid() = guest_id);
-- Combines with Phase 4's existing `grant update (last_seen) to anon,
-- authenticated` (untouched, still in effect): the column grant limits
-- *which columns*, this policy limits *which row* — together, exactly
-- "only your own last_seen".

create policy participants_delete_own
  on public.participants for delete
  to anon, authenticated
  using (auth.uid() = guest_id);
-- leaveGame() (own row) keeps working via this policy. Deleting *someone
-- else's* stale row is no longer possible via raw DELETE at all — that
-- capability now only exists inside the RPC below.

create or replace function public.cleanup_stale_participants()
returns void
language sql
security definer
set search_path = public
as $$
  delete from participants where last_seen < now() - interval '90 seconds';
$$;
-- Deliberately takes no parameters — it can only ever delete rows that are
-- actually stale by the DB's own clock, never a caller-chosen guest_id or
-- threshold. Same callers as today's raw cleanup (every connected client,
-- periodically), so kept open to anon/authenticated — just not to PUBLIC.
revoke execute on function public.cleanup_stale_participants() from public;
grant execute on function public.cleanup_stale_participants() to anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- game_state / chat_messages: defense-in-depth RLS layer
-- ────────────────────────────────────────────────────────────────────────
-- Existing REVOKEs (Phase 4 for chat_messages, Phase 6 for game_state)
-- already block every write for anon/authenticated/public — this doesn't
-- change or loosen either. Adding RLS with a public SELECT-only policy is
-- a second, independent mechanism blocking writes (belt-and-suspenders,
-- same reasoning already used for admin_sessions/payment_attempts), and
-- makes the *only* way to write either table explicit: a SECURITY DEFINER
-- function, or (for game_state) the service-role admin route — both of
-- which run under a role with BYPASSRLS, so this doesn't affect them.
alter table public.game_state enable row level security;
create policy game_state_select_all
  on public.game_state for select
  to anon, authenticated
  using (true);

alter table public.chat_messages enable row level security;
create policy chat_messages_select_all
  on public.chat_messages for select
  to anon, authenticated
  using (true);

-- ────────────────────────────────────────────────────────────────────────
-- RPC EXECUTE: stop relying on implicit PUBLIC grant
-- ────────────────────────────────────────────────────────────────────────
-- Every function below currently works only because Postgres auto-grants
-- EXECUTE to PUBLIC when a function is created and nothing here has ever
-- revoked it (unlike the admin-only RPCs, which already explicitly revoke
-- from public/anon/authenticated and grant only to service_role). Revoking
-- from PUBLIC and granting explicitly to anon/authenticated makes that
-- reliance explicit instead of implicit, with no behavior change for
-- either role.
revoke execute on function public.join_game(text, text) from public;
grant execute on function public.join_game(text, text) to anon, authenticated;

revoke execute on function public.send_chat_message(text) from public;
grant execute on function public.send_chat_message(text) to anon, authenticated;

revoke execute on function public.claim_winner() from public;
grant execute on function public.claim_winner() to anon, authenticated;

revoke execute on function public.start_game() from public;
grant execute on function public.start_game() to anon, authenticated;

revoke execute on function public.server_now() from public;
grant execute on function public.server_now() to anon, authenticated;

-- calc_drop_price: pure computation, no table access — but nothing calls
-- it directly over the API (only claim_winner() calls it internally, and
-- a SECURITY DEFINER function's internal calls run under its owner's
-- rights regardless of grants to other roles, so this doesn't break that
-- call). No role needs direct EXECUTE on it. Both overloads: the current
-- one, and an orphaned 9-parameter version from
-- 20260902130000_drop_interval.sql that per_zone_drop_interval.sql's
-- signature change never explicitly dropped — confirmed still callable
-- directly, now closed off too.
revoke execute on function public.calc_drop_price(
  numeric, integer, integer, integer, integer, integer, integer, integer, numeric, numeric, numeric
) from public, anon, authenticated;
revoke execute on function public.calc_drop_price(
  numeric, integer, integer, integer, integer, integer, integer, integer, integer
) from public, anon, authenticated;

commit;
