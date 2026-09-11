-- Phase 5: admin security. Replaces "cookie value == ADMIN_PASSWORD" with a
-- random opaque session token (hash stored server-side, real revocation on
-- logout), adds an atomic per-IP brute-force gate for /api/admin/login, and
-- moves every admin DB write (config save, game reset) behind a
-- service-role-only RPC that an admin session-gated Next.js API route calls
-- — closing the direct anon-client UPDATE/DELETE paths the browser used to
-- have on game_state/chat_messages/participants for these specific admin
-- actions. See supabase/migrations/20260910130000_chat_security.sql for the
-- REVOKE-based lockdown pattern this follows (RLS enabled with zero
-- policies + explicit REVOKE — belt-and-suspenders, independent
-- mechanisms).
--
-- Note: game_state's existing anon UPDATE grant is deliberately left as-is
-- here — join_game() in GameContext.tsx still does a direct anon-client
-- phase transition (waiting -> strategy) as part of normal game flow, and
-- start_game() (force-start) is a pre-existing ungated RPC. Both are
-- "game transition" concerns explicitly out of scope for this phase; see
-- the accompanying report for why narrowing that grant isn't done here.
--
-- Run this manually in the Supabase SQL Editor (Database > SQL Editor).

begin;

-- ────────────────────────────────────────────────────────────────────────
-- admin_sessions — opaque random token, hash-only storage
-- ────────────────────────────────────────────────────────────────────────
create table if not exists public.admin_sessions (
  id         uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
alter table public.admin_sessions enable row level security;
revoke all on table public.admin_sessions from public, anon, authenticated;
-- app/lib/adminAuth.ts talks to this table directly (insert/update/select)
-- via the service-role client, not through a SECURITY DEFINER function —
-- stated explicitly rather than assumed, same reasoning as the function
-- grants below.
grant select, insert, update on table public.admin_sessions to service_role;

create index if not exists admin_sessions_token_hash_idx on public.admin_sessions (token_hash);

-- ────────────────────────────────────────────────────────────────────────
-- admin_login_attempts + admin_login_gate()/admin_login_mark_success() —
-- atomic per-IP brute-force gate
-- ────────────────────────────────────────────────────────────────────────
-- check-then-act across two separate statements would let concurrent
-- requests from the same IP all read "under threshold" before any of them
-- records an attempt. admin_login_gate() closes that by doing the count
-- check AND reserving an attempt slot inside one advisory-locked
-- transaction (a single RPC call = a single Postgres transaction), so
-- concurrent calls for the same IP are fully serialized at this call and
-- the (N+1)th one to reach it always sees the first N already committed.
create table if not exists public.admin_login_attempts (
  id           uuid primary key default gen_random_uuid(),
  ip           text not null,
  attempted_at timestamptz not null default now(),
  success      boolean not null default false
);
alter table public.admin_login_attempts enable row level security;
revoke all on table public.admin_login_attempts from public, anon, authenticated;

create index if not exists admin_login_attempts_ip_time_idx on public.admin_login_attempts (ip, attempted_at);

create or replace function public.admin_login_gate(p_ip text)
returns table(allowed boolean, attempt_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_id    uuid;
begin
  -- Serializes every login-gate call for this IP. Held for the rest of
  -- this transaction, released automatically on commit/return.
  perform pg_advisory_xact_lock(hashtext('admin_login:' || p_ip)::bigint);

  -- Opportunistic cleanup, no separate cron needed.
  delete from admin_login_attempts
   where ip = p_ip and attempted_at < now() - interval '1 day';

  select count(*) into v_count
    from admin_login_attempts
   where ip = p_ip
     and success = false
     and attempted_at > now() - interval '15 minutes';

  if v_count >= 5 then
    return query select false, null::uuid;
    return;
  end if;

  -- Reserve the slot as a provisional failure *before* the caller verifies
  -- the password — this is what makes the count-and-reserve step atomic
  -- with respect to concurrent requests, not just the count-check alone.
  insert into admin_login_attempts (ip, success) values (p_ip, false)
  returning id into v_id;

  return query select true, v_id;
end;
$$;
revoke all on function public.admin_login_gate(text) from public, anon, authenticated;
-- Explicit, not assumed: don't rely on service_role's default privileges
-- (unlike the table-level REVOKE pattern already proven for
-- payment_attempts, this repo has no prior EXECUTE-revoke-then-
-- service_role-call precedent, so state the grant instead of hoping).
grant execute on function public.admin_login_gate(text) to service_role;

create or replace function public.admin_login_mark_success(p_attempt_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update admin_login_attempts set success = true where id = p_attempt_id;
$$;
revoke all on function public.admin_login_mark_success(uuid) from public, anon, authenticated;
grant execute on function public.admin_login_mark_success(uuid) to service_role;

-- ────────────────────────────────────────────────────────────────────────
-- admin_reset_game() — atomic, server-only game reset
-- ────────────────────────────────────────────────────────────────────────
-- Single function body = single implicit transaction, so the chat/
-- participants wipe and the game_state reset either all happen or none do.
-- Only ever called from /api/admin/reset-game via the service-role client,
-- after that route has verified a live admin session — never reachable by
-- anon/authenticated directly.
create or replace function public.admin_reset_game()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- `where true`: this project's Postgres rejects an unqualified DELETE
  -- ("DELETE requires a WHERE clause") — the same guard the old
  -- client-side resetGame() was working around with
  -- .gte("created_at", "1970-01-01") / .gte("joined_at", "1970-01-01").
  delete from chat_messages where true;
  delete from participants where true;
  update game_state set
    phase = 'waiting',
    strategy_started_at = null,
    game_started_at = null,
    winner_id = null,
    winner_nickname = null,
    winner_price = null
  where id = 1;
end;
$$;
revoke all on function public.admin_reset_game() from public, anon, authenticated;
grant execute on function public.admin_reset_game() to service_role;

commit;
