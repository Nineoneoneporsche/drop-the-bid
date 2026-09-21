-- Bug fix: starting a round immediately auto-paused itself.
--
-- Root cause: the health lease (supabase/migrations/20260917100000_fail_closed_pause.sql)
-- is only ever renewed by a heartbeat while phase='game' — nobody polls it
-- during 'waiting'/'strategy'. So any idle time between rounds (which is
-- completely normal) lets the lease sit expired for however long the app
-- was quiet. The instant a new round flips to phase='game', the very
-- first heartbeat or claim_winner() call sees that stale lease and
-- immediately auto-pauses — a false positive, not a real outage.
--
-- Fix: whichever function actually flips the phase to 'game' also stamps
-- a fresh lease at that exact moment, so a round always starts from a
-- clean slate regardless of how long the app sat idle beforehand.
--
-- Run this manually in the Supabase SQL Editor (Database > SQL Editor).

begin;

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

  if v_updated > 0 then
    update service_health
    set last_ok_at = now(), lease_until = now() + interval '10 seconds'
    where service_name = 'auction_api';
  end if;

  return v_updated > 0;
end;
$$;

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

  if v_updated > 0 then
    update service_health
    set last_ok_at = now(), lease_until = now() + interval '10 seconds'
    where service_name = 'auction_api';
  end if;

  return v_updated > 0;
end;
$$;

commit;
