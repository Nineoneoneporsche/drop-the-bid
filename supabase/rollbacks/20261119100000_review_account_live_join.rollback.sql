-- EMERGENCY ROLLBACK for supabase/migrations/20261119100000_review_account_live_join.sql.
--
-- NOT a migration: it lives outside supabase/migrations on purpose, so a
-- fresh replay never undoes it. Run it by hand in the Supabase SQL Editor
-- only if that migration has to be taken back. Roll the app back first (the
-- /join page calls am_i_review_account(), which this script drops; the call
-- fails closed, so an un-rolled-back app only loses the reviewer path).
--
-- Restores join_game_participant(uuid,text,text,uuid) to the
-- 20261030100000 body, copied verbatim below (md5
-- b8d03a4d9dcc5e349d9a30b6d349511d). Owner, EXECUTE grants and config are
-- kept (CREATE OR REPLACE) and checked afterwards. Drops
-- am_i_review_account() and the review_accounts table (its rows are only
-- reviewer account ids).
--
-- Refuses (nothing changes) unless join_game_participant is exactly the
-- 20261119100000 body (md5 a0ba24fbba36a716eea3c90b7a91b41e) and no round
-- is in progress (phase waiting / ended). game_state is locked FOR UPDATE
-- until commit.
--
-- MIGRATION HISTORY WARNING: running this by hand only reverts the schema.
-- Version 20261119100000 stays recorded as applied in
-- supabase_migrations.schema_migrations. Do NOT `db push` again until the
-- remote history has been reconciled separately (e.g. `migration repair
-- --status reverted 20261119100000`, as its own controlled step).

begin;
set local lock_timeout = '5s';

do $$
declare
  v_md5 text;
  v_gs  record;
begin
  select md5(regexp_replace(p.prosrc, '\s+', '', 'g')) into v_md5
  from pg_proc p
  where p.oid = to_regprocedure('public.join_game_participant(uuid,text,text,uuid)')
    and p.prosecdef and p.proconfig @> array['search_path=public'];
  if v_md5 is distinct from 'a0ba24fbba36a716eea3c90b7a91b41e' then
    raise exception 'rollback refused: join_game_participant body md5 is %, expected a0ba24fbba36a716eea3c90b7a91b41e', coalesce(v_md5, '<missing/not secdef>');
  end if;
  select phase into v_gs from game_state where id = 1 for update;
  if not found or v_gs.phase not in ('waiting', 'ended') then
    raise exception 'rollback refused: game_state.phase is %, expected waiting or ended', coalesce(v_gs.phase, '<missing>');
  end if;
end $$;

create temp table rv_rb_before on commit drop as
  select p.oid::regprocedure::text sig, p.proowner, p.proacl::text acl, p.proconfig
  from pg_proc p
  where p.oid = 'public.join_game_participant(uuid,text,text,uuid)'::regprocedure;

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

drop function public.am_i_review_account();
drop table public.review_accounts;

do $$
declare
  v_md5 text;
begin
  if exists (select 1 from rv_rb_before b join pg_proc p on p.oid = to_regprocedure(b.sig)
             where p.proowner is distinct from b.proowner or p.proacl::text is distinct from b.acl
                or p.proconfig is distinct from b.proconfig or not p.prosecdef) then
    raise exception 'rollback post-condition failed: join_game_participant owner / grants / config changed';
  end if;
  select md5(regexp_replace(p.prosrc, '\s+', '', 'g')) into v_md5
  from pg_proc p where p.oid = 'public.join_game_participant(uuid,text,text,uuid)'::regprocedure;
  if v_md5 is distinct from 'b8d03a4d9dcc5e349d9a30b6d349511d' then
    raise exception 'rollback post-condition failed: join_game_participant body md5 is %', v_md5;
  end if;
end $$;

commit;
