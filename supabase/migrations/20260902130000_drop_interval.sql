-- Adds an explicit "how many seconds between price drops" control, separate
-- from "how much per drop" (fast_drop_amount etc, unchanged). Default is 1
-- second, which reproduces today's exact behavior — a fresh column with no
-- interval configured never changes anything for an existing game.
--
-- Run this manually in the Supabase SQL Editor (Database > SQL Editor),
-- after 20260902120000_drop_zones.sql.

begin;

alter table public.game_state
  add column if not exists drop_interval_seconds integer not null default 1;

alter table public.game_state
  drop constraint if exists game_state_drop_interval_valid;

alter table public.game_state
  add constraint game_state_drop_interval_valid check (drop_interval_seconds > 0);

-- calc_drop_price gains p_interval_seconds: elapsed time is snapped down to
-- the start of its current interval bucket before any zone math runs, so
-- price holds flat within a bucket and steps down by
-- rate * interval_seconds at each bucket boundary, instead of decreasing
-- continuously every fraction of a second. Zone thresholds/ordering are
-- unaffected — only how often the number on screen actually changes.
create or replace function public.calc_drop_price(
  p_elapsed_seconds numeric,
  p_start_price      integer,
  p_minimum_price    integer,
  p_drop_amount      integer,
  p_fast_price       integer,
  p_fast_amount      integer,
  p_final_price      integer,
  p_final_amount     integer,
  p_interval_seconds integer
) returns integer
language plpgsql
immutable
as $$
declare
  t_fast    numeric;
  t_final   numeric;
  stepped   numeric;
begin
  stepped := floor(p_elapsed_seconds / p_interval_seconds) * p_interval_seconds;

  if p_fast_price is null then
    return greatest(p_minimum_price, p_start_price - round(stepped * p_drop_amount)::integer);
  end if;

  t_fast := (p_start_price - p_fast_price) / p_drop_amount::numeric;

  if stepped <= t_fast then
    return p_start_price - round(stepped * p_drop_amount)::integer;
  end if;

  if p_final_price is null then
    return greatest(p_minimum_price,
      p_fast_price - round((stepped - t_fast) * p_fast_amount)::integer);
  end if;

  t_final := (p_fast_price - p_final_price) / p_fast_amount::numeric;

  if stepped <= t_fast + t_final then
    return p_fast_price - round((stepped - t_fast) * p_fast_amount)::integer;
  end if;

  return greatest(p_minimum_price,
    p_final_price - round((stepped - t_fast - t_final) * p_final_amount)::integer);
end;
$$;

-- claim_winner: pass the row's drop_interval_seconds through so the winning
-- price snaps to the same stepped value everyone was seeing on screen.
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
    v_row.drop_interval_seconds
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
