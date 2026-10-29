-- M3: the scheduled start T is the auction's only time axis.
--
-- Until now the first participant join flipped waiting -> strategy and
-- stamped strategy_started_at = now(); start_game() then started the real
-- auction strategy_duration (60 s) later with game_started_at = now(). So an
-- early participant started the auction long before game_state.
-- scheduled_start_at (T), which only closed joins once it had passed.
--
-- From this migration on, with T = scheduled_start_at and
-- N = participant_join_lead_minutes (new column, 1..180, default 30):
--
--   join window      a participant may join iff T is set, phase is waiting /
--                    strategy and T - N minutes <= now() < T (DB time).
--                    Before the window (or with no T): the stable error
--                    'participant_join_not_open'; from T on, or in game /
--                    ended: 'participant join closed' as before.
--   strategy phase   the first join still flips waiting -> strategy (and
--                    still stamps strategy_started_at), but strategy only
--                    means "pre-game, with participants". Neither
--                    strategy_started_at nor strategy_duration is a timing
--                    input any more; both columns stay for compatibility.
--   start_game()     strategy -> game once now() >= T and at least one
--                    participant holds this round's account_round_guard (the
--                    same pair claim_winner() requires). game_started_at = T,
--                    never now(): however late a client calls it, the price
--                    (client calcPriceAndStage() and claim_winner(), both off
--                    game_started_at) has been dropping since T. No
--                    participant at T -> no start: phase stays waiting, joins
--                    stay closed (T passed) until the admin sets a new T.
--   admin_force_start_game()  any pre-game phase (waiting / strategy), no
--                    winner, at least one participant (as above): T and
--                    game_started_at are both set to the same now(), so even
--                    a forced start keeps the single time axis.
--   admin_update_schedule(p_start, p_lead_minutes)  new, service_role only:
--                    sets T and N together, only while phase = 'waiting'
--                    (game_state row locked, so it serializes with the joins
--                    that move it to strategy). N must be 1..180, T must be
--                    NULL (no auction scheduled) or > now() + 60 s.
--
-- Unchanged: claim_winner() (M1, 3b84dfd5…: prices off game_started_at,
-- which is now T), admin_reset_game() (M2, e7440558…), pause / resume /
-- health lease (start_game() and admin_force_start_game() still stamp a
-- fresh lease when they flip the phase), the device / account guards and
-- everything else in join_game_participant().
--
-- Normalized body md5s (md5(regexp_replace(prosrc, '\s+', '', 'g'))):
--   join_game_participant(uuid,text,text,uuid)  6a02b52987290c468efad952ad43c057 -> b8d03a4d9dcc5e349d9a30b6d349511d
--   start_game()                                f8148a6a15c973d48b4b372a5e49a554 -> 8f8cba95b88422c9c717bb804faa6da9
--   admin_force_start_game()                    92115841ed6a40b50f03e3c17fde1a60 -> 0251520809f95fa35f1c010dd6deeade
--   admin_update_schedule(timestamptz,integer)  new                              -> fadb9870e7de7dbd0a6ce3591cfd73b0
-- (the "before" values are enforced below, the "after" ones by the
-- post-conditions).
--
-- Apply only with no round in progress: phase 'waiting' or 'ended'
-- (enforced). A 'strategy' round would otherwise wait for a T it was never
-- scheduled against.
--
-- Deploy only through the Supabase CLI migration workflow (pinned CLI
-- v2.122.0, `db push --linked`). Do NOT execute this migration manually in
-- the Production SQL Editor: that bypasses supabase_migrations history.
-- No explicit BEGIN/COMMIT here on purpose: the CLI migration runner wraps
-- this file and its history INSERT in one transaction, so any failure
-- leaves neither a partial schema / function change nor a history row.
--
-- Rollback (manual, emergency only, NOT a migration):
-- supabase/rollbacks/20261030100000_scheduled_start_join_window.rollback.sql

set local lock_timeout = '5s';

-- ── 0. Preconditions (any failure aborts before anything changes) ──────────
do $$
declare
  r     record;
  v_n   int;
  v_md5 text;
  v_col record;
  v_gs  record;
begin
  -- 1. The three replaced functions: exactly one of each name, security
  --    definer, search_path=public, the repo bodies (20261014100000 /
  --    20260921120000).
  for r in
    select * from (values
      ('join_game_participant',  'public.join_game_participant(uuid,text,text,uuid)', '6a02b52987290c468efad952ad43c057'),
      ('start_game',             'public.start_game()',                               'f8148a6a15c973d48b4b372a5e49a554'),
      ('admin_force_start_game', 'public.admin_force_start_game()',                   '92115841ed6a40b50f03e3c17fde1a60')
    ) t(name, sig, md5)
  loop
    select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = r.name;
    if v_n <> 1 then
      raise exception 'precondition failed: expected exactly 1 %, found %', r.name, v_n;
    end if;
    select md5(regexp_replace(p.prosrc, '\s+', '', 'g')) into v_md5
    from pg_proc p
    where p.oid = to_regprocedure(r.sig)
      and p.prosecdef and p.proconfig @> array['search_path=public'];
    if v_md5 is distinct from r.md5 then
      raise exception 'precondition failed: % body md5 is %, expected %', r.sig, coalesce(v_md5, '<missing/not secdef>'), r.md5;
    end if;
  end loop;

  -- 2. M1 and M2 are live (claim_winner writes auction_wins; the
  --    auction_wins-based reset guard).
  for r in
    select * from (values
      ('public.claim_winner()',     '3b84dfd5ca929a55d5c093209693d225'),
      ('public.admin_reset_game()', 'e74405580db4c4694302f25e9d9d1e37')
    ) t(sig, md5)
  loop
    select md5(regexp_replace(p.prosrc, '\s+', '', 'g')) into v_md5
    from pg_proc p where p.oid = to_regprocedure(r.sig);
    if v_md5 is distinct from r.md5 then
      raise exception 'precondition failed: % body md5 is %, expected %', r.sig, coalesce(v_md5, '<missing>'), r.md5;
    end if;
  end loop;

  -- 3. admin_update_schedule does not exist yet (any overload).
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'admin_update_schedule') then
    raise exception 'precondition failed: admin_update_schedule already exists';
  end if;

  -- 4. The columns the new bodies read exist.
  select count(*) into v_n from information_schema.columns
  where table_schema = 'public'
    and ((table_name = 'game_state' and (column_name, data_type) in (
            ('id', 'integer'), ('phase', 'text'), ('round_key', 'uuid'), ('winner_id', 'uuid'),
            ('scheduled_start_at', 'timestamp with time zone'), ('game_started_at', 'timestamp with time zone'),
            ('strategy_started_at', 'timestamp with time zone')))
      or (table_name = 'participants' and (column_name, data_type) in (('guest_id', 'uuid'), ('role', 'text')))
      or (table_name = 'account_round_guard' and (column_name, data_type) in (('round_key', 'uuid'), ('user_id', 'uuid')))
      or (table_name = 'service_health' and (column_name, data_type) in (
            ('service_name', 'text'), ('lease_until', 'timestamp with time zone'))));
  if v_n <> 13 then
    raise exception 'precondition failed: game_state / participants / account_round_guard / service_health columns differ from expected (found % of 13)', v_n;
  end if;

  -- 5. participant_join_lead_minutes: absent, or exactly the shape this
  --    migration creates (left behind by the rollback, which keeps it).
  select c.data_type, c.is_nullable, c.column_default into v_col
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'game_state' and c.column_name = 'participant_join_lead_minutes';
  if found and not (
       v_col.data_type = 'integer' and v_col.is_nullable = 'NO' and v_col.column_default = '30'
       and exists (select 1 from pg_constraint
                   where conrelid = 'public.game_state'::regclass
                     and conname = 'game_state_participant_join_lead_minutes_range'
                     and pg_get_constraintdef(oid) = 'CHECK (((participant_join_lead_minutes >= 1) AND (participant_join_lead_minutes <= 180)))')) then
    raise exception 'precondition failed: game_state.participant_join_lead_minutes exists with an unexpected shape';
  end if;

  -- 6. game_state is the singleton row id = 1, no round in progress. Locked
  --    until commit: no join, start, claim or reset runs during the swap.
  select count(*) into v_n from game_state;
  if v_n <> 1 then
    raise exception 'precondition failed: expected exactly 1 game_state row, found %', v_n;
  end if;
  select phase into v_gs from game_state where id = 1 for update;
  if not found then
    raise exception 'precondition failed: game_state row id = 1 missing';
  end if;
  if v_gs.phase not in ('waiting', 'ended') then
    raise exception 'precondition failed: game_state.phase is %, expected waiting or ended (no round in progress)', v_gs.phase;
  end if;
end $$;

-- Owner / EXECUTE grants / config before the swap, compared afterwards.
create temp table m3_fn_before on commit drop as
  select p.oid::regprocedure::text sig, p.proowner, p.proacl::text acl, p.proconfig
  from pg_proc p
  where p.oid in ('public.join_game_participant(uuid,text,text,uuid)'::regprocedure,
                  'public.start_game()'::regprocedure,
                  'public.admin_force_start_game()'::regprocedure);

-- ── 1. N: participant_join_lead_minutes ─────────────────────────────────────
alter table public.game_state
  add column if not exists participant_join_lead_minutes integer not null default 30
    constraint game_state_participant_join_lead_minutes_range
      check (participant_join_lead_minutes >= 1 and participant_join_lead_minutes <= 180);

-- ── 2. join_game_participant(): the T - N .. T join window ──────────────────
create or replace function public.join_game_participant(p_uid uuid, p_nickname text, p_device_hash text, p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_nickname          text := trim(p_nickname);
  v_is_anon           boolean;
  v_old_role          text;
  v_operator_nickname text;
  v_round_key         uuid;
  v_existing_uid      uuid;
  v_phase             text;
  v_scheduled_start   timestamptz;
  v_lead_minutes      integer;
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

  select round_key, phase, scheduled_start_at, participant_join_lead_minutes
    into v_round_key, v_phase, v_scheduled_start, v_lead_minutes
  from game_state where id = 1 for update;

  -- Join window, by DB time only: T - N minutes <= now() < T.
  if coalesce(v_phase, '') not in ('waiting', 'strategy')
     or (v_scheduled_start is not null and now() >= v_scheduled_start) then
    raise exception 'participant join closed';
  end if;
  if v_scheduled_start is null
     or now() < v_scheduled_start - make_interval(mins => v_lead_minutes) then
    raise exception 'participant_join_not_open';
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

  -- strategy = "pre-game, with participants". Not a timing input: T alone
  -- decides when the auction starts.
  update game_state
  set phase = 'strategy', strategy_started_at = now()
  where id = 1 and phase = 'waiting';
end;
$function$;

-- ── 3. start_game(): at T, with a participant; game_started_at = T ─────────
create or replace function public.start_game()
returns boolean
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_updated int;
begin
  -- One atomic UPDATE: concurrent callers serialize on the row and only the
  -- first sees phase = 'strategy'. game_started_at is T itself, not now(),
  -- so a late call never shifts the price's time axis.
  update game_state gs
  set phase = 'game', game_started_at = gs.scheduled_start_at
  where gs.id = 1
    and gs.phase = 'strategy'
    and gs.scheduled_start_at is not null
    and now() >= gs.scheduled_start_at
    and exists (
      select 1
      from participants p
      join account_round_guard g on g.user_id = p.guest_id and g.round_key = gs.round_key
      where p.role = 'participant'
    );

  get diagnostics v_updated = row_count;

  if v_updated > 0 then
    update service_health
    set last_ok_at = now(), lease_until = now() + interval '10 seconds'
    where service_name = 'auction_api';
  end if;

  return v_updated > 0;
end;
$function$;

-- ── 4. admin_force_start_game(): T := game_started_at := now() ─────────────
create or replace function public.admin_force_start_game()
returns boolean
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_now     timestamptz := now();
  v_updated int;
begin
  update game_state gs
  set phase = 'game', scheduled_start_at = v_now, game_started_at = v_now
  where gs.id = 1
    and gs.phase in ('waiting', 'strategy')
    and gs.winner_id is null
    and exists (
      select 1
      from participants p
      join account_round_guard g on g.user_id = p.guest_id and g.round_key = gs.round_key
      where p.role = 'participant'
    );

  get diagnostics v_updated = row_count;

  if v_updated > 0 then
    update service_health
    set last_ok_at = now(), lease_until = now() + interval '10 seconds'
    where service_name = 'auction_api';
  end if;

  return v_updated > 0;
end;
$function$;

-- ── 5. admin_update_schedule(): T and N together, waiting only ─────────────
create function public.admin_update_schedule(p_start timestamptz, p_lead_minutes integer)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_phase text;
begin
  select phase into v_phase from game_state where id = 1 for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'schedule_invalid:no_game_state';
  end if;
  if v_phase <> 'waiting' then
    raise exception using errcode = 'P0001', message = 'schedule_locked:not_waiting';
  end if;
  if p_lead_minutes is null or p_lead_minutes < 1 or p_lead_minutes > 180 then
    raise exception using errcode = 'P0001', message = 'schedule_invalid:lead_minutes';
  end if;
  if p_start is not null and p_start <= now() + interval '60 seconds' then
    raise exception using errcode = 'P0001', message = 'schedule_invalid:start_too_soon';
  end if;

  update game_state
  set scheduled_start_at = p_start,
      participant_join_lead_minutes = p_lead_minutes
  where id = 1;
end;
$function$;
revoke all on function public.admin_update_schedule(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.admin_update_schedule(timestamptz, integer) to service_role;

-- ── Post-conditions (any failure rolls back) ────────────────────────────────
do $$
declare
  r     record;
  v_md5 text;
  v_p   record;
begin
  -- Replaced functions: owner / EXECUTE grants / config unchanged, new bodies.
  if (select count(*) from m3_fn_before) <> 3 then
    raise exception 'post-condition failed: expected 3 saved function rows';
  end if;
  for r in
    select b.sig, b.proowner, b.acl, b.proconfig, p.proowner new_owner, p.proacl::text new_acl, p.proconfig new_config, p.prosecdef
    from m3_fn_before b join pg_proc p on p.oid = to_regprocedure(b.sig)
  loop
    if r.new_owner <> r.proowner or r.new_acl is distinct from r.acl or r.new_config is distinct from r.proconfig or not r.prosecdef then
      raise exception 'post-condition failed: % owner / grants / config / security definer changed', r.sig;
    end if;
  end loop;

  for r in
    select * from (values
      ('public.join_game_participant(uuid,text,text,uuid)', 'b8d03a4d9dcc5e349d9a30b6d349511d'),
      ('public.start_game()',                               '8f8cba95b88422c9c717bb804faa6da9'),
      ('public.admin_force_start_game()',                   '0251520809f95fa35f1c010dd6deeade'),
      ('public.admin_update_schedule(timestamptz,integer)', 'fadb9870e7de7dbd0a6ce3591cfd73b0')
    ) t(sig, md5)
  loop
    select md5(regexp_replace(p.prosrc, '\s+', '', 'g')) into v_md5
    from pg_proc p where p.oid = to_regprocedure(r.sig);
    if v_md5 is distinct from r.md5 then
      raise exception 'post-condition failed: % body md5 is %, expected %', r.sig, coalesce(v_md5, '<missing>'), r.md5;
    end if;
  end loop;

  -- admin_update_schedule: security definer, search_path=public, same owner
  -- as start_game(), EXECUTE for service_role only.
  select p.prosecdef, p.proconfig, p.proowner,
         (select proowner from pg_proc where oid = 'public.start_game()'::regprocedure) start_owner
    into v_p
  from pg_proc p where p.oid = 'public.admin_update_schedule(timestamptz,integer)'::regprocedure;
  if not v_p.prosecdef or v_p.proconfig is distinct from array['search_path=public'] or v_p.proowner <> v_p.start_owner then
    raise exception 'post-condition failed: admin_update_schedule security definer / search_path / owner';
  end if;
  if has_function_privilege('anon', 'public.admin_update_schedule(timestamptz,integer)', 'execute')
     or has_function_privilege('authenticated', 'public.admin_update_schedule(timestamptz,integer)', 'execute')
     or not has_function_privilege('service_role', 'public.admin_update_schedule(timestamptz,integer)', 'execute')
     or exists (select 1 from pg_proc p, aclexplode(p.proacl) x
                where p.oid = 'public.admin_update_schedule(timestamptz,integer)'::regprocedure
                  and x.grantee = 0) then
    raise exception 'post-condition failed: admin_update_schedule EXECUTE must be service_role only';
  end if;

  -- The column and its range CHECK.
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'game_state'
                   and column_name = 'participant_join_lead_minutes'
                   and data_type = 'integer' and is_nullable = 'NO' and column_default = '30')
     or not exists (select 1 from pg_constraint
                    where conrelid = 'public.game_state'::regclass
                      and conname = 'game_state_participant_join_lead_minutes_range'
                      and pg_get_constraintdef(oid) = 'CHECK (((participant_join_lead_minutes >= 1) AND (participant_join_lead_minutes <= 180)))') then
    raise exception 'post-condition failed: game_state.participant_join_lead_minutes column / CHECK';
  end if;

  -- No timing input left on the old 60 s strategy clock.
  if exists (select 1 from pg_proc p
             where p.oid in ('public.start_game()'::regprocedure, 'public.admin_force_start_game()'::regprocedure,
                             'public.join_game_participant(uuid,text,text,uuid)'::regprocedure)
               and p.prosrc like '%strategy_duration%') then
    raise exception 'post-condition failed: a replaced function still reads strategy_duration';
  end if;
end $$;
