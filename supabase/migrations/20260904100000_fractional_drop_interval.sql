-- Allows drop intervals below 1 second (e.g. 0.5) for NORMAL/FAST/FINAL.
-- The columns and calc_drop_price's interval parameters were `integer`,
-- which silently floored anything under 1 to 0 and tripped the "> 0" CHECK
-- constraint — admin.tsx's parseInt() truncation on the client made this
-- doubly invisible (typing "0.5" parsed to 0 before it even reached the DB).
--
-- Changing a function parameter's type isn't a plain CREATE OR REPLACE in
-- Postgres (it's a different signature), so the old integer-parameter
-- calc_drop_price is dropped with CASCADE, which also drops claim_winner
-- (it calls calc_drop_price) — both are recreated below, claim_winner
-- otherwise unchanged from 20260903100000_per_zone_drop_interval.sql.
--
-- Run this manually in the Supabase SQL Editor (Database > SQL Editor),
-- after 20260903100000_per_zone_drop_interval.sql.

begin;

alter table public.game_state
  alter column drop_interval_seconds       type numeric using drop_interval_seconds::numeric,
  alter column fast_drop_interval_seconds  type numeric using fast_drop_interval_seconds::numeric,
  alter column final_drop_interval_seconds type numeric using final_drop_interval_seconds::numeric;

drop function if exists public.calc_drop_price(
  numeric, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer
) cascade;

create or replace function public.calc_drop_price(
  p_elapsed_seconds        numeric,
  p_start_price            integer,
  p_minimum_price          integer,
  p_drop_amount            integer,
  p_fast_price             integer,
  p_fast_amount            integer,
  p_final_price            integer,
  p_final_amount           integer,
  p_normal_interval_seconds numeric,
  p_fast_interval_seconds   numeric,
  p_final_interval_seconds  numeric
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
