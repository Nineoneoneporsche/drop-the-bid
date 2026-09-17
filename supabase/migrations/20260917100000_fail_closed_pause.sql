-- Fail-closed pause + health-lease infrastructure. Targets the failure mode
-- from the recent multi-day Supabase REST API outage: the client's price
-- ticker is computed purely from game_started_at + config (no live
-- round-trip needed to keep counting down), so if PostgREST/claim_winner()
-- is actually dead while a round is live, a user's screen keeps dropping
-- the price against a backend that can't honor a claim — or worse, against
-- one that recovers mid-outage at a price that silently discounted through
-- the whole dead window. This migration adds:
--   1. A pause/resume model on game_state itself (admin-triggered).
--   2. A separate service_health lease table + touch_health_lease() RPC, so
--      an outage auto-pauses the game the moment anyone (a heartbeat tick,
--      or claim_winner() itself) next successfully reaches Postgres —
--      nothing needs to be listening *during* the outage for this to work.
--   3. claim_winner() checks both gates before ever computing a price, and
--      computes price against paused-time-adjusted elapsed time so a pause
--      never silently discounts the item further.
--
-- Run this manually in the Supabase SQL Editor (Database > SQL Editor).

begin;

-- ── 1. Pause columns on game_state ──────────────────────────────────────
alter table public.game_state
  add column if not exists is_paused boolean not null default false,
  add column if not exists paused_at timestamptz,
  add column if not exists paused_total_ms bigint not null default 0,
  add column if not exists pause_reason text;

-- ── 2. service_health: a single-row-per-service lease, kept separate from
-- game_state so heartbeats never contend with claim_winner()'s row lock. ──
create table if not exists public.service_health (
  service_name text primary key,
  last_ok_at   timestamptz not null,
  lease_until  timestamptz not null
);

insert into public.service_health (service_name, last_ok_at, lease_until)
values ('auction_api', now(), now() + interval '10 seconds')
on conflict (service_name) do nothing;

-- RLS enabled with zero policies: only service_role (which bypasses RLS)
-- or the security-definer functions below ever touch this table. Nobody
-- can read/write it directly via PostgREST as anon/authenticated.
alter table public.service_health enable row level security;

-- ── 3. pause_game() / resume_game(): admin-only. Invoked from
-- app/api/admin/pause-game and /resume-game via the service-role client —
-- never reachable from the browser directly. ────────────────────────────
create or replace function public.pause_game(p_reason text default 'manual')
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update game_state
  set is_paused = true,
      paused_at = now(),
      pause_reason = left(coalesce(p_reason, 'manual'), 200)
  where id = 1
    and is_paused = false
    and phase = 'game';

  return found;
end;
$$;
revoke all on function public.pause_game(text) from public, anon, authenticated;
grant execute on function public.pause_game(text) to service_role;

create or replace function public.resume_game()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paused_at timestamptz;
begin
  select paused_at into v_paused_at
  from game_state
  where id = 1 and is_paused = true
  for update;

  if v_paused_at is null then
    return false;
  end if;

  update game_state
  set paused_total_ms = paused_total_ms
        + floor(extract(epoch from (now() - v_paused_at)) * 1000)::bigint,
      is_paused = false,
      paused_at = null,
      pause_reason = null
  where id = 1;

  return true;
end;
$$;
revoke all on function public.resume_game() from public, anon, authenticated;
grant execute on function public.resume_game() to service_role;

-- ── 4. touch_health_lease(): called by /api/game/heartbeat (a public
-- route — liveness probe, not a privileged action) via the service-role
-- client. If the lease had already expired (nobody successfully reached
-- Postgres for 10s+), auto-pauses a live game *before* renewing the lease,
-- so the outage window itself is never silently absorbed into a fresh
-- lease. paused_at is backdated to when the lease actually expired
-- (clamped to game_started_at), not to "now" — the price freezes at what
-- it was worth *when the outage started*, not after however long the
-- outage plus recovery lag ran. ──────────────────────────────────────────
create or replace function public.touch_health_lease()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_health  service_health%rowtype;
  v_expired boolean;
begin
  select * into v_health
  from service_health
  where service_name = 'auction_api'
  for update;

  v_expired := v_health.lease_until < now();

  if v_expired then
    update game_state
    set is_paused = true,
        paused_at = greatest(game_started_at, v_health.lease_until),
        pause_reason = 'health_lease_expired'
    where id = 1
      and is_paused = false
      and phase = 'game';
  end if;

  update service_health
  set last_ok_at = now(),
      lease_until = now() + interval '10 seconds'
  where service_name = 'auction_api';

  return jsonb_build_object(
    'recovered_from_expiry', v_expired,
    'lease_until', now() + interval '10 seconds'
  );
end;
$$;
revoke all on function public.touch_health_lease() from public, anon, authenticated;
grant execute on function public.touch_health_lease() to service_role;

-- ── 5. claim_winner(): adds the pause gate + health-lease gate ahead of
-- the existing winner_id/phase checks, and makes the price calc
-- paused-time-adjusted. Everything else (FOR UPDATE row lock, nickname
-- lookup, atomic winner+price+phase update, chat insert, boolean success
-- signal) is unchanged from Phase 8 — see
-- supabase/migrations/20260911100000_phase8_operational_reliability.sql. ──
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

  v_price := calc_drop_price(
    extract(epoch from (now() - v_row.game_started_at)) - (v_row.paused_total_ms / 1000.0),
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
      winner_claimed_at = now(),
      phase = 'ended'
  where id = 1;

  insert into chat_messages (guest_id, nickname, message, kind)
  values (
    v_uid, 'system',
    '🎉 ' || v_nickname || '님이 ₩' || to_char(v_price, 'FM999,999,999') || '에 낙찰받았습니다!',
    'system'
  );

  return true;
end;
$$;

commit;
