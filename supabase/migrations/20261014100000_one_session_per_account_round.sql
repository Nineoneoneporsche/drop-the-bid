-- One active participant session per account per round.
--
-- participants is keyed by guest_id (= auth.uid()) alone, so every device
-- signed in to the same account shares one participant row, and
-- claim_winner() accepted a claim from any of them. device_round_guard
-- doesn't help: it stops one device cookie joining as several accounts,
-- not one account joining from several devices (and claim_winner(), called
-- straight from the browser, can't see that cookie anyway).
--
-- Identity used here: (round_key, user_id, session_id), where session_id is
-- the Supabase Auth session id carried in the signed access token's
-- session_id claim. One sign-in = one session: tabs, reloads and browser
-- restarts of the same sign-in keep it; another device (or a private
-- window) signs in separately and gets a different one. Confirmed in
-- production 2026-10-14 (two devices on one account, two different uuids).
--
--   account_round_guard   one row per (round_key, user_id): the holder
--                         session and its lease (last_seen_at). RLS on, no
--                         policies, no client privileges — only the
--                         SECURITY DEFINER functions below touch it.
--   join_game_participant gains p_session_id. Only /api/join/participant
--                         calls it (service_role), passing the session_id
--                         of the access token it has just verified with
--                         Supabase Auth — never a value from the request
--                         body. auth.jwt() is NOT used here: under
--                         service_role it is the server's key, not the
--                         end user's session. Also now refuses participant
--                         joins outside waiting/strategy or once
--                         scheduled_start_at has passed (the /join UI rule,
--                         now enforced by the DB, by server now()).
--   claim_winner          returns false unless the caller's own JWT
--                         session_id holds the guard for the current round.
--                         Nothing else in it changes.
--   touch_participant_session  heartbeat; extends the lease only for the
--                         holder session (auth.uid() + auth.jwt() + current
--                         round_key, all read in the DB).
--   join_game             a spectator entry from a session that doesn't
--                         hold the guard no longer rewrites the account's
--                         participant row (role/nickname) — it's a no-op.
--
-- Join rules (round_key, user_id) — serialized by the existing per-user
-- advisory lock plus game_state FOR UPDATE, and the primary key:
--   no guard row            -> caller's session becomes holder
--   same session            -> allowed (refresh / tab / restart), lease renewed
--   other session, lease < 90s old  -> 'account active on another session'
--   other session, lease >= 90s old -> takeover (takeover_count + 1)
-- Joins (and so takeovers) only happen in waiting/strategy. There's no
-- forced eviction of a live holder. 90s = 3 missed 30s heartbeats, same
-- threshold as cleanup_stale_participants().
--
-- Untouched: device_round_guard and its check (verbatim), the price calc,
-- FOR UPDATE / phase / winner / pause / health-lease checks and the winner
-- update in claim_winner, admin_reset_game() (a new round_key makes old
-- guard rows inert; join_game_participant deletes them), payment tables.
--
-- BASE DEFINITIONS: the three replaced functions are the repo versions
-- (claim_winner: 20260917100000, join_game / join_game_participant:
-- 20260921100000). Section 0 aborts unless production's current bodies
-- hash to exactly those (whitespace-normalized md5, with or without their
-- comments), so this can't silently overwrite a drifted production
-- definition.
--
-- Deploy: apply while no round is in progress (phase 'waiting', no
-- participants), then deploy the app right after — the old app calls the
-- 3-argument join_game_participant(), which this drops.
--
-- Run this manually in the Supabase SQL Editor (Database > SQL Editor).

begin;

set local lock_timeout = '5s';

-- ── 0. Preconditions: production matches the base definitions ───────────────
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('public.claim_winner()',                             '1d9c0a025461ec2c05979cc97c0bc24f', '9013dd21487a3a4ffb85eef835f8b755'),
      ('public.join_game(text,text)',                       '54c4cc88e3a2329522f1c48b3be5d3d3', '54c4cc88e3a2329522f1c48b3be5d3d3'),
      ('public.join_game_participant(uuid,text,text)',      '520ab731e66f0715bdba5a587c010cec', '297287ef885b3afb11e4327c5fb99314')
    ) as t(sig, md5_raw, md5_no_comments)
  loop
    if to_regprocedure(r.sig) is null then
      raise exception 'precondition failed: % does not exist', r.sig;
    end if;
    if not exists (
      select 1 from pg_proc p
      where p.oid = to_regprocedure(r.sig)
        and (md5(regexp_replace(p.prosrc, '\s+', '', 'g')) = r.md5_raw
             or md5(regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '\s+', '', 'g')) = r.md5_no_comments)
    ) then
      raise exception 'precondition failed: % differs from the base definition this migration was written against', r.sig;
    end if;
  end loop;

  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'join_game_participant') <> 1 then
    raise exception 'precondition failed: unexpected join_game_participant overloads';
  end if;

  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'game_state'
                   and column_name = 'scheduled_start_at') then
    raise exception 'precondition failed: game_state.scheduled_start_at missing';
  end if;

  if to_regclass('public.account_round_guard') is not null then
    raise exception 'precondition failed: account_round_guard already exists';
  end if;
end $$;

-- ── 1. account_round_guard ──────────────────────────────────────────────────
create table public.account_round_guard (
  round_key      uuid        not null,
  user_id        uuid        not null references auth.users(id) on delete cascade,
  session_id     uuid        not null,
  joined_at      timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  takeover_count integer     not null default 0 check (takeover_count >= 0),
  primary key (round_key, user_id)
);

alter table public.account_round_guard enable row level security;
revoke all on table public.account_round_guard from public, anon, authenticated;
grant select, insert, update, delete on table public.account_round_guard to service_role;

-- ── 2. join_game_participant(): + p_session_id, phase gate, account guard ──
drop function public.join_game_participant(uuid, text, text);

create function public.join_game_participant(
  p_uid uuid,
  p_nickname text,
  p_device_hash text,
  p_session_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nickname          text := trim(p_nickname);
  v_is_anon           boolean;
  v_old_role          text;
  v_operator_nickname text;
  v_round_key         uuid;
  v_existing_uid      uuid;
  v_phase             text;
  v_scheduled_start   timestamptz;
  v_holder_session    uuid;
  v_holder_seen       timestamptz;
begin
  if p_uid is null then
    raise exception 'authentication required';
  end if;

  if length(v_nickname) < 2 or length(v_nickname) > 20 then
    raise exception 'invalid nickname';
  end if;

  -- Same rule join_game() has always enforced for participants: an
  -- Anonymous Auth session (app-wide identity bootstrap) can spectate but
  -- never hold a real participant slot.
  select is_anonymous into v_is_anon from auth.users where id = p_uid;
  if coalesce(v_is_anon, true) then
    raise exception 'participant role requires a signed-in account';
  end if;

  if p_device_hash is null or p_device_hash = '' then
    raise exception 'device check required';
  end if;

  if p_session_id is null then
    raise exception 'session check required';
  end if;

  -- Turnstile proof, recent enough to matter (10 min covers a slow /join
  -- flow without leaving a stale pass usable hours later).
  if not exists (
    select 1 from participant_verifications
    where guest_id = p_uid and verified_at > now() - interval '10 minutes'
  ) then
    raise exception 'verification required';
  end if;

  select operator_nickname into v_operator_nickname from game_state where id = 1;
  if v_nickname = v_operator_nickname then
    raise exception 'nickname reserved';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_uid::text)::bigint);

  select round_key, phase, scheduled_start_at
    into v_round_key, v_phase, v_scheduled_start
  from game_state where id = 1 for update;

  if coalesce(v_phase, '') not in ('waiting', 'strategy')
     or (v_scheduled_start is not null and v_scheduled_start <= now()) then
    raise exception 'participant join closed';
  end if;

  select guest_id into v_existing_uid
  from device_round_guard
  where round_key = v_round_key and device_hash = p_device_hash;

  if v_existing_uid is null then
    insert into device_round_guard (round_key, device_hash, guest_id)
    values (v_round_key, p_device_hash, p_uid);
  elsif v_existing_uid <> p_uid then
    raise exception 'this device already joined as a participant this round';
  end if;
  -- v_existing_uid = p_uid: same user retrying (e.g. network hiccup) — allowed through.

  delete from account_round_guard where round_key <> v_round_key;

  select session_id, last_seen_at
    into v_holder_session, v_holder_seen
  from account_round_guard
  where round_key = v_round_key and user_id = p_uid
  for update;

  if v_holder_session is null then
    insert into account_round_guard (round_key, user_id, session_id)
    values (v_round_key, p_uid, p_session_id);
  elsif v_holder_session = p_session_id then
    update account_round_guard
    set last_seen_at = now()
    where round_key = v_round_key and user_id = p_uid;
  elsif v_holder_seen > now() - interval '90 seconds' then
    raise exception 'account active on another session';
  else
    update account_round_guard
    set session_id     = p_session_id,
        joined_at      = now(),
        last_seen_at   = now(),
        takeover_count = takeover_count + 1
    where round_key = v_round_key and user_id = p_uid;
  end if;

  select role into v_old_role from participants where guest_id = p_uid;

  insert into participants (guest_id, nickname, role, last_seen)
  values (p_uid, v_nickname, 'participant', now())
  on conflict (guest_id) do update
    set nickname  = excluded.nickname,
        role      = 'participant',
        last_seen = now();

  if v_old_role is null or v_old_role <> 'participant' then
    insert into chat_messages (guest_id, nickname, message, kind)
    values (
      p_uid, 'system',
      v_nickname || '님이 참여자로 입장했습니다 👋',
      'system'
    );
  end if;

  update game_state
  set phase = 'strategy', strategy_started_at = now()
  where id = 1 and phase = 'waiting';
end;
$$;
revoke all on function public.join_game_participant(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.join_game_participant(uuid, text, text, uuid) to service_role;

-- ── 3. claim_winner(): only the guard's holder session can win ─────────────
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

  if not exists (
    select 1
    from account_round_guard g
    where g.round_key = v_row.round_key
      and g.user_id = v_uid
      and g.session_id::text = coalesce(auth.jwt() ->> 'session_id', '')
  ) then
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
-- ── 4. touch_participant_session(): holder-only lease heartbeat ────────────
create function public.touch_participant_session()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_session   text := auth.jwt() ->> 'session_id';
  v_round_key uuid;
begin
  if v_uid is null or v_session is null then
    return false;
  end if;

  select round_key into v_round_key from game_state where id = 1;

  update account_round_guard
  set last_seen_at = now()
  where round_key = v_round_key
    and user_id = v_uid
    and session_id::text = v_session;

  return found;
end;
$$;

revoke all on function public.touch_participant_session() from public, anon, authenticated;
grant execute on function public.touch_participant_session() to authenticated;

-- ── 5. join_game(): a non-holder session's spectator entry is a no-op ──────
create or replace function public.join_game(p_role text, p_nickname text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid              uuid := auth.uid();
  v_nickname         text := trim(p_nickname);
  v_old_role         text;
  v_operator_nickname text;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  if p_role = 'participant' then
    raise exception 'participant join must go through the verified join route';
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

  perform pg_advisory_xact_lock(hashtext(v_uid::text)::bigint);

  select role into v_old_role from participants where guest_id = v_uid;

  if v_old_role = 'participant' and exists (
    select 1
    from account_round_guard g
    join game_state gs on gs.id = 1 and gs.round_key = g.round_key
    where g.user_id = v_uid
      and g.session_id::text is distinct from (auth.jwt() ->> 'session_id')
  ) then
    return;
  end if;

  insert into participants (guest_id, nickname, role, last_seen)
  values (v_uid, v_nickname, p_role, now())
  on conflict (guest_id) do update
    set nickname  = excluded.nickname,
        role      = excluded.role,
        last_seen = now();

  if v_old_role is null or v_old_role <> p_role then
    insert into chat_messages (guest_id, nickname, message, kind)
    values (
      v_uid, 'system',
      v_nickname || '님이 관전자로 입장했습니다 👋',
      'system'
    );
  end if;
end;
$$;
-- ── Post-conditions (any failure rolls back) ────────────────────────────────
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.account_round_guard'::regclass) then
    raise exception 'post-condition failed: RLS not enabled on account_round_guard';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'account_round_guard') then
    raise exception 'post-condition failed: account_round_guard has policies (expected none)';
  end if;
  if has_table_privilege('anon',          'public.account_round_guard', 'select, insert, update, delete')
     or has_table_privilege('authenticated', 'public.account_round_guard', 'select, insert, update, delete') then
    raise exception 'post-condition failed: a client role has privileges on account_round_guard';
  end if;
  if not has_table_privilege('service_role', 'public.account_round_guard', 'select, insert, update, delete') then
    raise exception 'post-condition failed: service_role lacks privileges on account_round_guard';
  end if;

  if to_regprocedure('public.join_game_participant(uuid,text,text)') is not null then
    raise exception 'post-condition failed: old 3-argument join_game_participant still exists';
  end if;
  if has_function_privilege('anon', 'public.join_game_participant(uuid,text,text,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.join_game_participant(uuid,text,text,uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.join_game_participant(uuid,text,text,uuid)', 'execute') then
    raise exception 'post-condition failed: join_game_participant must be service_role-only';
  end if;

  if has_function_privilege('anon', 'public.touch_participant_session()', 'execute')
     or not has_function_privilege('authenticated', 'public.touch_participant_session()', 'execute') then
    raise exception 'post-condition failed: touch_participant_session must be authenticated-only';
  end if;

  if (select prosrc from pg_proc where oid = 'public.claim_winner()'::regprocedure) not like '%account_round_guard%'
     or (select prosrc from pg_proc where oid = 'public.join_game(text,text)'::regprocedure) not like '%account_round_guard%'
     or (select prosrc from pg_proc where oid = 'public.join_game_participant(uuid,text,text,uuid)'::regprocedure) not like '%device_round_guard%' then
    raise exception 'post-condition failed: function bodies not as expected';
  end if;
end $$;

commit;
