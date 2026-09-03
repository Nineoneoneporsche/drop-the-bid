-- Splits the single drop_interval_seconds (added in
-- 20260902130000_drop_interval.sql) into three independent per-zone
-- intervals: drop_interval_seconds now means NORMAL's specifically, and
-- fast_drop_interval_seconds / final_drop_interval_seconds are new columns
-- for their zones. All default to 1 (today's continuous-looking behavior),
-- so an existing game_state row is unaffected until an admin sets them.
--
-- Run this manually in the Supabase SQL Editor (Database > SQL Editor),
-- after 20260902130000_drop_interval.sql.

begin;

alter table public.game_state
  add column if not exists fast_drop_interval_seconds  integer not null default 1,
  add column if not exists final_drop_interval_seconds integer not null default 1;

alter table public.game_state
  drop constraint if exists game_state_fast_drop_interval_valid,
  drop constraint if exists game_state_final_drop_interval_valid;

alter table public.game_state
  add constraint game_state_fast_drop_interval_valid  check (fast_drop_interval_seconds > 0),
  add constraint game_state_final_drop_interval_valid check (final_drop_interval_seconds > 0);

-- calc_drop_price: each zone now steps against its own interval, measured
-- from that zone's own start (not from game start) — so switching a zone's
-- interval never shifts when the OTHER zones' boundaries land. Zone
-- thresholds (t_fast, t_final) still come from the continuous (unstepped)
-- rate math, exactly as before; only the price shown within a zone steps.
create or replace function public.calc_drop_price(
  p_elapsed_seconds        numeric,
  p_start_price            integer,
  p_minimum_price          integer,
  p_drop_amount            integer,
  p_fast_price             integer,
  p_fast_amount            integer,
  p_final_price            integer,
  p_final_amount           integer,
  p_normal_interval_seconds integer,
  p_fast_interval_seconds   integer,
  p_final_interval_seconds  integer
) returns integer
language plpgsql
immutable
as $$
declare
  t_fast          numeric;
  t_final         numeric;
  zone_elapsed    numeric;
  stepped         numeric;
begin
  if p_fast_price is null then
    stepped := floor(p_elapsed_seconds / p_normal_interval_seconds) * p_normal_interval_seconds;
    return greatest(p_minimum_price, p_start_price - round(stepped * p_drop_amount)::integer);
  end if;

  t_fast := (p_start_price - p_fast_price) / p_drop_amount::numeric;

  if p_elapsed_seconds <= t_fast then
    stepped := floor(p_elapsed_seconds / p_normal_interval_seconds) * p_normal_interval_seconds;
    return p_start_price - round(stepped * p_drop_amount)::integer;
  end if;

  zone_elapsed := p_elapsed_seconds - t_fast;

  if p_final_price is null then
    stepped := floor(zone_elapsed / p_fast_interval_seconds) * p_fast_interval_seconds;
    return greatest(p_minimum_price, p_fast_price - round(stepped * p_fast_amount)::integer);
  end if;

  t_final := (p_fast_price - p_final_price) / p_fast_amount::numeric;

  if zone_elapsed <= t_final then
    stepped := floor(zone_elapsed / p_fast_interval_seconds) * p_fast_interval_seconds;
    return p_fast_price - round(stepped * p_fast_amount)::integer;
  end if;

  zone_elapsed := zone_elapsed - t_final;
  stepped := floor(zone_elapsed / p_final_interval_seconds) * p_final_interval_seconds;
  return greatest(p_minimum_price, p_final_price - round(stepped * p_final_amount)::integer);
end;
$$;

-- claim_winner: pass all three per-zone intervals through.
create or replace function public.claim_winner(
  p_guest_id uuid,
  p_nickname text,
  p_price    integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row      game_state%rowtype;
  v_price    integer;
  v_nickname text;
begin
  select nickname into v_nickname
  from participants
  where guest_id = p_guest_id and role = 'participant';

  if v_nickname is null then
    return false;
  end if;

  select * into v_row from game_state where id = 1 for update;

  if v_row.phase <> 'game' or v_row.winner_id is not null or v_row.game_started_at is null then
    return false;
  end if;

  v_price := calc_drop_price(
    extract(epoch from (now() - v_row.game_started_at)),
    v_row.start_price, v_row.minimum_price, v_row.drop_amount,
    v_row.fast_drop_price, v_row.fast_drop_amount,
    v_row.final_drop_price, v_row.final_drop_amount,
    v_row.drop_interval_seconds,
    v_row.fast_drop_interval_seconds,
    v_row.final_drop_interval_seconds
  );

  update game_state
  set winner_id = p_guest_id,
      winner_nickname = v_nickname,
      winner_price = v_price,
      phase = 'ended'
  where id = 1;

  insert into chat_messages (guest_id, nickname, message, kind)
  values (
    p_guest_id, 'system',
    '🎉 ' || v_nickname || '님이 ₩' || to_char(v_price, 'FM999,999,999') || '에 낙찰받았습니다!',
    'system'
  );

  return true;
end;
$$;

commit;
