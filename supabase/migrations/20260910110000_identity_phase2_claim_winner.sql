-- Identity Phase 2: claim_winner() drops the client-supplied
-- (p_guest_id, p_nickname, p_price) identity/price and uses auth.uid()
-- instead — the same trust model Phase 1 gave join_game().
--
-- Everything about HOW the winner/price gets decided is unchanged from the
-- version in 20260904100000_fractional_drop_interval.sql: same
-- calc_drop_price() call against now()/game_started_at, same
-- `select ... for update` row lock, same `phase='game' and winner_id is
-- null` atomic guard, same winner_id/winner_nickname/winner_price UPDATE,
-- same system chat_messages insert. The only lines that changed are the
-- ones that used to trust p_guest_id/p_nickname — they now read auth.uid()
-- and look up the caller's own participants row instead. A second guard
-- rejects anyone whose participants row isn't role='participant' (blocks a
-- spectator, or a signed-in user who never joined at all, from calling this
-- directly) — Anonymous Auth users are already excluded from ever having a
-- role='participant' row by join_game() (Phase 1), so that exclusion holds
-- here transitively without needing to re-check is_anonymous.
--
-- The old 3-parameter signature is a distinct function overload in
-- Postgres and `create or replace` would NOT have replaced it — it's
-- explicitly dropped first so it can no longer be called at all (matches
-- the drop-then-recreate pattern already used in this repo's history for
-- calc_drop_price's parameter-type change).
--
-- Run this manually in the Supabase SQL Editor (Database > SQL Editor).

begin;

drop function if exists public.claim_winner(uuid, text, integer);

create or replace function public.claim_winner()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_row      game_state%rowtype;
  v_price    integer;
  v_nickname text;
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
  set winner_id = v_uid,
      winner_nickname = v_nickname,
      winner_price = v_price,
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
