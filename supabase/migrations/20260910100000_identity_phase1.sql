-- Identity Phase 1: participants registration moves off a client-supplied
-- guest_id onto Supabase Auth's auth.uid() (real login or Anonymous Auth,
-- bootstrapped client-side — see app/context/GameContext.tsx).
--
-- join_game() is the only new/changed DB object in this migration. It
-- replaces the client's raw `insert into participants(...)` (previously
-- keyed by a client-generated crypto.randomUUID(), fully client-trusted)
-- with a security definer RPC that:
--   - uses auth.uid() as the row's identity, never a client-supplied id
--   - rejects role='participant' when the caller's session is an
--     Anonymous Auth session (auth.jwt()'s is_anonymous claim), enforcing
--     "참여자는 로그인 필요" at the DB layer instead of only in UI copy
--   - validates nickname length/role value server-side
--   - upserts on the (already-existing) guest_id primary key, so re-joining
--     under the same auth.uid() updates the existing row instead of
--     accumulating duplicates
--
-- Deliberately NOT touched here (later phases): claim_winner, chat_messages/
-- sendMessage, heartbeat, start_game, admin config/reset, payment confirm,
-- RLS on any table. participants has no RLS yet, so this RPC's own checks
-- are the only guard for now — that's consistent with every other RPC in
-- this schema today (start_game, claim_winner) predating RLS.
--
-- Run this manually in the Supabase SQL Editor (Database > SQL Editor).

begin;

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

  insert into participants (guest_id, nickname, role, last_seen)
  values (v_uid, v_nickname, p_role, now())
  on conflict (guest_id) do update
    set nickname  = excluded.nickname,
        role      = excluded.role,
        last_seen = now();
end;
$$;

commit;
