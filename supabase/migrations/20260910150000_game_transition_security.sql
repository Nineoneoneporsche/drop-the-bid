-- Phase 6: game transition security. Moves the waiting -> strategy
-- transition into join_game() as a single atomic, server-time UPDATE
-- (participant joins only — a spectator-only first arrival must not
-- advance the phase), adds a real time gate to start_game() so
-- strategy -> game can no longer be forced early by any client, adds a
-- separate admin-only, server-only force-start path for when an operator
-- genuinely wants to skip the timer, and closes the remaining raw-REST
-- write grant on game_state now that nothing legitimate needs it anymore.
-- claim_winner() (game -> ended) is untouched — it was already atomic and
-- server-time-authoritative.
--
-- Run this manually in the Supabase SQL Editor (Database > SQL Editor).

begin;

-- ────────────────────────────────────────────────────────────────────────
-- join_game(): absorb the waiting -> strategy transition, atomically,
-- participant-only
-- ────────────────────────────────────────────────────────────────────────
-- Replaces the old client-side check-then-act
-- (`select phase` then a blind `.update({phase:"strategy", ...})` with no
-- `where phase=...` guard and a client-clock timestamp) that used to live
-- in GameContext.tsx's joinGame(). That version had two real bugs: no
-- atomicity (a late/slow request could yank the game backwards from
-- 'game'/'ended' to 'strategy'), and strategy_started_at came from the
-- caller's own Date.now(), so a client with a manipulated system clock
-- could set it arbitrarily in the past.
--
-- The fix is the same single-UPDATE-with-WHERE-guard pattern start_game()
-- and claim_winner() already use: `where phase = 'waiting'` makes this
-- atomic (Postgres row-locks id=1, so under concurrent joins exactly one
-- UPDATE actually changes anything; every other one — including a slow
-- request arriving after the phase has already moved on — matches zero
-- rows and is a silent no-op), and the timestamp is always Postgres's own
-- now(), never client-supplied.
--
-- Gated to p_role = 'participant' only: a spectator (including an
-- Anonymous Auth spectator) arriving first must never start the strategy
-- clock for everyone — only a real participant joining does.
create or replace function public.join_game(p_role text, p_nickname text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_nickname text := trim(p_nickname);
  v_is_anon  boolean := coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
  v_old_role text;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  if p_role not in ('participant', 'spectator') then
    raise exception 'invalid role: %', p_role;
  end if;

  if length(v_nickname) < 2 or length(v_nickname) > 20 then
    raise exception 'invalid nickname';
  end if;

  if p_role = 'participant' and v_is_anon then
    raise exception 'participant role requires a signed-in account';
  end if;

  -- Serializes this whole check-then-act sequence per caller — see
  -- supabase/migrations/20260910130000_chat_security.sql. Released
  -- automatically at the end of this transaction.
  perform pg_advisory_xact_lock(hashtext(v_uid::text)::bigint);

  select role into v_old_role from participants where guest_id = v_uid;

  insert into participants (guest_id, nickname, role, last_seen)
  values (v_uid, v_nickname, p_role, now())
  on conflict (guest_id) do update
    set nickname  = excluded.nickname,
        role      = excluded.role,
        last_seen = now();

  if v_old_role is null or v_old_role <> p_role then
    insert into chat_messages (guest_id, nickname, message, kind)
    values (
      v_uid,
      'system',
      v_nickname || '님이 ' || (case when p_role = 'participant' then '참여자로' else '관전자로' end) || ' 입장했습니다 👋',
      'system'
    );
  end if;

  -- Phase 6: atomic waiting -> strategy, participant arrivals only.
  if p_role = 'participant' then
    update game_state
    set phase = 'strategy', strategy_started_at = now()
    where id = 1 and phase = 'waiting';
  end if;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────
-- start_game(): real time gate, boolean result unchanged in meaning
-- ────────────────────────────────────────────────────────────────────────
-- Same atomic single-UPDATE-with-WHERE-guard shape as before (still
-- exactly one caller wins under concurrency) — the WHERE clause now also
-- requires that the strategy period has actually elapsed per Postgres's
-- own now(), not whatever a client claims. A call before time's up, or
-- after someone else already advanced the phase, simply matches zero rows
-- and returns false — this is an expected, normal outcome (the client's
-- own auto-transition timer already treats false as a no-op, not an
-- error), not a failure state to raise an exception for.
create or replace function public.start_game()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated int;
begin
  update game_state
  set phase = 'game', game_started_at = now()
  where id = 1
    and phase = 'strategy'
    and strategy_started_at is not null
    and now() >= strategy_started_at + make_interval(secs => strategy_duration);

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────
-- admin_force_start_game(): admin-only, server-only, no time gate
-- ────────────────────────────────────────────────────────────────────────
-- The old "바로시작" button let *any* user on /strategy force-start
-- immediately, with zero gating. That button is removed from /strategy
-- entirely (see app/strategy/page.tsx) — a force-start capability now
-- exists only behind Phase 5's admin session + service-role path
-- (/api/admin/force-start-game), never as a public RPC. Same atomic
-- `where phase='strategy'` guard as start_game(), just without the time
-- condition, and locked down the same way admin_reset_game() is.
create or replace function public.admin_force_start_game()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated int;
begin
  update game_state
  set phase = 'game', game_started_at = now()
  where id = 1 and phase = 'strategy';

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;
revoke all on function public.admin_force_start_game() from public, anon, authenticated;
grant execute on function public.admin_force_start_game() to service_role;

-- ────────────────────────────────────────────────────────────────────────
-- game_state: close the remaining raw-REST write grant
-- ────────────────────────────────────────────────────────────────────────
-- Every legitimate write to game_state now goes through a function
-- (join_game(), start_game(), admin_force_start_game(), claim_winner(),
-- admin_reset_game()) or the service-role-only admin update-config route
-- (Phase 5) — nothing legitimate is left that needs a direct client
-- UPDATE/INSERT/DELETE on this table. This is a plain privilege REVOKE
-- (the same mechanism Phase 4 used for chat_messages), not RLS — the full
-- RLS pass is Phase 7. SELECT is untouched, so the home/strategy/payment
-- pages' reads and the Realtime subscription keep working unchanged.
--
-- Before this, any anon/authenticated client could PATCH game_state
-- directly and, among other things, set phase='ended' with an arbitrary
-- winner_id/winner_price — app/api/payment/confirm/route.ts trusts those
-- columns as read from the DB, so that raw write was a real path to
-- forging a winning payment claim without ever going through
-- claim_winner(). This REVOKE closes that.
revoke insert, update, delete on table public.game_state from public, anon, authenticated;
-- Explicit, not assumed (same reasoning as admin_sessions/admin_login_attempts
-- in Phase 5): app/api/admin/update-config/route.ts writes to this table
-- directly via the service-role client, not through a SECURITY DEFINER
-- function, so don't rely on service_role's grant here being inherited
-- from anywhere the REVOKE above might also remove it from.
grant update on table public.game_state to service_role;

commit;
