-- EMERGENCY ROLLBACK for supabase/migrations/20261030100000_scheduled_start_join_window.sql (M3).
--
-- NOT a migration: it lives outside supabase/migrations on purpose, so a
-- fresh replay never undoes M3. Run it by hand in the Supabase SQL Editor
-- only if M3 has to be taken back. Roll the app back first (the pre-M3 app
-- deployment): the M3 app sends T / N through admin_update_schedule(),
-- which this script drops.
--
-- Restores the pre-M3 bodies, copied verbatim (prosrc) below:
--   join_game_participant(uuid,text,text,uuid)  20261014100000  md5 6a02b52987290c468efad952ad43c057
--   start_game()                                20260921120000  md5 f8148a6a15c973d48b4b372a5e49a554
--   admin_force_start_game()                    20260921120000  md5 92115841ed6a40b50f03e3c17fde1a60
-- i.e. the first participant join starts a strategy_duration (60 s) clock
-- again and start_game() stamps game_started_at = now(). Owner, EXECUTE
-- grants and config are kept (CREATE OR REPLACE) and checked afterwards.
-- Drops admin_update_schedule(timestamptz, integer).
--
-- KEEPS game_state.participant_join_lead_minutes and its CHECK
-- (game_state_participant_join_lead_minutes_range): no pre-M3 function or
-- app reads it, dropping a column of the realtime-published singleton needs
-- an ACCESS EXCLUSIVE lock in an emergency path, and M3's precondition
-- accepts the column in exactly this shape if M3 is ever re-applied.
-- scheduled_start_at is left as it is. No other data is changed.
--
-- Refuses (nothing changes) unless all three functions are exactly the M3
-- bodies and admin_update_schedule exists, and unless no round is in
-- progress (phase waiting / ended): restoring the 60 s clock under a
-- 'strategy' round whose first join was long ago would start it at once
-- with game_started_at = now(). Reset the round first if needed. game_state
-- is locked FOR UPDATE until commit.
--
-- MIGRATION HISTORY WARNING:
--   - Once M3 has been applied with `db push` and recorded as applied in
--     supabase_migrations.schema_migrations, running this script by hand
--     only reverts the FUNCTIONS. Migration history is NOT changed: version
--     20261030100000 stays recorded as applied.
--   - After a successful rollback, do NOT run `db push` again until the
--     remote migration history has been verified and reconciled separately.
--   - If needed, `migration repair --status reverted 20261030100000` is run
--     as a separate, controlled step, only after the rollback has been
--     verified.
--   - This script must never modify supabase_migrations directly.

begin;

set local lock_timeout = '5s';

-- ── 0. Preconditions ────────────────────────────────────────────────────────
do $$
declare
  r     record;
  v_n   int;
  v_md5 text;
  v_phase text;
begin
  for r in
    select * from (values
      ('join_game_participant',  'public.join_game_participant(uuid,text,text,uuid)', 'b8d03a4d9dcc5e349d9a30b6d349511d'),
      ('start_game',             'public.start_game()',                               '8f8cba95b88422c9c717bb804faa6da9'),
      ('admin_force_start_game', 'public.admin_force_start_game()',                   '0251520809f95fa35f1c010dd6deeade')
    ) t(name, sig, md5)
  loop
    select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = r.name;
    if v_n <> 1 then
      raise exception 'rollback refused: expected exactly 1 %, found %', r.name, v_n;
    end if;
    select md5(regexp_replace(p.prosrc, '\s+', '', 'g')) into v_md5
    from pg_proc p
    where p.oid = to_regprocedure(r.sig)
      and p.prosecdef and p.proconfig @> array['search_path=public'];
    if v_md5 is distinct from r.md5 then
      raise exception 'rollback refused: % is not the M3 definition (md5 %, expected %)', r.sig, coalesce(v_md5, '<missing/not secdef>'), r.md5;
    end if;
  end loop;
  if to_regprocedure('public.admin_update_schedule(timestamptz,integer)') is null then
    raise exception 'rollback refused: admin_update_schedule(timestamptz, integer) missing (M3 not applied?)';
  end if;
  select phase into v_phase from game_state where id = 1 for update;
  if not found then
    raise exception 'rollback refused: game_state row id = 1 missing';
  end if;
  if v_phase not in ('waiting', 'ended') then
    raise exception 'rollback refused: game_state.phase is %, expected waiting or ended (reset the round first)', v_phase;
  end if;
end $$;

create temp table m3_rollback_before on commit drop as
  select p.oid::regprocedure::text sig, p.proowner, p.proacl::text acl, p.proconfig
  from pg_proc p
  where p.oid in ('public.join_game_participant(uuid,text,text,uuid)'::regprocedure,
                  'public.start_game()'::regprocedure,
                  'public.admin_force_start_game()'::regprocedure);

-- ── 1. Pre-M3 bodies (verbatim) ─────────────────────────────────────────────
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
$function$;

create or replace function public.start_game()
returns boolean
language plpgsql
security definer
set search_path = public
as $function$
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
$function$;

create or replace function public.admin_force_start_game()
returns boolean
language plpgsql
security definer
set search_path = public
as $function$
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
$function$;

drop function public.admin_update_schedule(timestamptz, integer);

-- ── Post-conditions (any failure rolls back) ────────────────────────────────
do $$
declare
  r     record;
  v_md5 text;
begin
  for r in
    select b.sig, b.proowner, b.acl, b.proconfig, p.proowner new_owner, p.proacl::text new_acl, p.proconfig new_config, p.prosecdef
    from m3_rollback_before b join pg_proc p on p.oid = to_regprocedure(b.sig)
  loop
    if r.new_owner <> r.proowner or r.new_acl is distinct from r.acl or r.new_config is distinct from r.proconfig or not r.prosecdef then
      raise exception 'rollback post-condition failed: % owner / grants / config / security definer changed', r.sig;
    end if;
  end loop;
  if (select count(*) from m3_rollback_before) <> 3 then
    raise exception 'rollback post-condition failed: expected 3 saved function rows';
  end if;
  for r in
    select * from (values
      ('public.join_game_participant(uuid,text,text,uuid)', '6a02b52987290c468efad952ad43c057'),
      ('public.start_game()',                               'f8148a6a15c973d48b4b372a5e49a554'),
      ('public.admin_force_start_game()',                   '92115841ed6a40b50f03e3c17fde1a60')
    ) t(sig, md5)
  loop
    select md5(regexp_replace(p.prosrc, '\s+', '', 'g')) into v_md5
    from pg_proc p where p.oid = to_regprocedure(r.sig);
    if v_md5 is distinct from r.md5 then
      raise exception 'rollback post-condition failed: % body md5 is %, expected %', r.sig, coalesce(v_md5, '<missing>'), r.md5;
    end if;
  end loop;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'admin_update_schedule') then
    raise exception 'rollback post-condition failed: admin_update_schedule still exists';
  end if;
end $$;

commit;
