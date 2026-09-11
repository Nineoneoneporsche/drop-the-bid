-- Phase 8: operational reliability. Adds a server-recorded winner claim
-- timestamp (game_state.winner_claimed_at) so the payment page's payment
-- window and the admin monitoring panel's "elapsed since win" both read
-- the same server-anchored time instead of the payment page's previous
-- purely client-side, refresh-resetting countdown. Also closes a nickname
-- gap in join_game(): a participant could legitimately register under the
-- exact configured operator_nickname and impersonate the operator in chat.
-- Does not add auto-timeout/auto-reset/next-bidder-fallback behavior —
-- that's explicitly out of scope for this phase; this only makes the
-- underlying timestamp available so the UI can display accurate elapsed/
-- remaining time and so admin can see it.
--
-- Run this manually in the Supabase SQL Editor (Database > SQL Editor).

begin;

alter table public.game_state
  add column if not exists winner_claimed_at timestamptz;

-- claim_winner(): unchanged in every other respect (same auth.uid()-only
-- identity, same `for update` row lock, same phase='game' and
-- winner_id is null guard, same price calc) — just also stamps
-- winner_claimed_at = now() atomically with the rest of the winner UPDATE.
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

-- admin_reset_game(): unchanged transaction shape — just also nulls
-- winner_claimed_at alongside the other winner_* fields it already resets.
create or replace function public.admin_reset_game()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from chat_messages where true;
  delete from participants where true;
  update game_state set
    phase = 'waiting',
    strategy_started_at = null,
    game_started_at = null,
    winner_id = null,
    winner_nickname = null,
    winner_price = null,
    winner_claimed_at = null
  where id = 1;
end;
$$;
revoke all on function public.admin_reset_game() from public, anon, authenticated;
grant execute on function public.admin_reset_game() to service_role;

-- join_game(): adds one check — reject registering (or re-registering)
-- under the room's current operator_nickname, so a regular participant
-- can no longer legitimately chat as the configured operator identity.
-- Strictly additive: narrows what's allowed, doesn't loosen anything
-- Phase 1/4/6 already established (identity from auth.uid(), participant
-- role requires non-anonymous session, atomic waiting->strategy on
-- participant join).
create or replace function public.join_game(p_role text, p_nickname text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid              uuid := auth.uid();
  v_nickname         text := trim(p_nickname);
  v_is_anon          boolean := coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
  v_old_role         text;
  v_operator_nickname text;
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

  select operator_nickname into v_operator_nickname from game_state where id = 1;
  if v_nickname = v_operator_nickname then
    raise exception 'nickname reserved';
  end if;

  if p_role = 'participant' and v_is_anon then
    raise exception 'participant role requires a signed-in account';
  end if;

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

  if p_role = 'participant' then
    update game_state
    set phase = 'strategy', strategy_started_at = now()
    where id = 1 and phase = 'waiting';
  end if;
end;
$$;

commit;
