-- Review accounts may join a live round (PG merchant review, 2026-11).
--
-- Kakao Pay's 독립몰 review needs a reviewer to go from product to a
-- clickable 결제하기 on their own schedule. A participant can only join in
-- the T - N .. T window (20261030100000), and claim_winner() only accepts
-- the session that joined, so a reviewer arriving mid-round could never buy.
--
-- This migration:
--   review_accounts            new table (user_id -> auth.users). RLS on,
--                              no policies; only service_role can touch it.
--                              Rows are added / removed by hand
--                              (supabase/ops/review_accounts.sql).
--   join_game_participant()    an account listed in review_accounts may also
--                              join while phase = 'game'. Every other path
--                              (the T - N .. T window for everyone else, the
--                              device / account / session guards, the
--                              strategy flip) is unchanged.
--   am_i_review_account()      new, authenticated only: true when the caller
--                              is listed. Lets /join offer the participant
--                              role to a reviewer during a live round. Says
--                              nothing about anyone else.
--
-- Unchanged: claim_winner() (still phase 'game' + no winner + this round's
-- account_round_guard for the caller's session), start_game(),
-- admin_force_start_game(), touch_health_lease() / auto-pause, reset.
-- With review_accounts empty, behaviour is exactly as before.
--
-- Normalized body md5s (md5(regexp_replace(prosrc, '\s+', '', 'g'))):
--   join_game_participant(uuid,text,text,uuid)  b8d03a4d9dcc5e349d9a30b6d349511d -> a0ba24fbba36a716eea3c90b7a91b41e
--   am_i_review_account()                       new                              -> ba41bab0e9f4cbc8ea3d3379e6463158
--
-- Apply only with no round in progress: phase 'waiting' or 'ended'
-- (enforced).
--
-- Deploy only through the Supabase CLI migration workflow (pinned CLI
-- v2.122.0, `db push --linked`). Do NOT execute this migration manually in
-- the Production SQL Editor: that bypasses supabase_migrations history.
-- No explicit BEGIN/COMMIT here on purpose: the CLI migration runner wraps
-- this file and its history INSERT in one transaction.
--
-- Rollback (manual, emergency only, NOT a migration):
-- supabase/rollbacks/20261119100000_review_account_live_join.rollback.sql

set local lock_timeout = '5s';

-- ── 0. Preconditions (any failure aborts before anything changes) ──────────
do $$
declare
  v_n   int;
  v_md5 text;
  v_gs  record;
begin
  -- 1. join_game_participant: exactly one, security definer,
  --    search_path=public, the 20261030100000 body.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'join_game_participant';
  if v_n <> 1 then
    raise exception 'precondition failed: expected exactly 1 join_game_participant, found %', v_n;
  end if;
  select md5(regexp_replace(p.prosrc, '\s+', '', 'g')) into v_md5
  from pg_proc p
  where p.oid = to_regprocedure('public.join_game_participant(uuid,text,text,uuid)')
    and p.prosecdef and p.proconfig @> array['search_path=public'];
  if v_md5 is distinct from 'b8d03a4d9dcc5e349d9a30b6d349511d' then
    raise exception 'precondition failed: join_game_participant body md5 is %, expected b8d03a4d9dcc5e349d9a30b6d349511d', coalesce(v_md5, '<missing/not secdef>');
  end if;

  -- 2. Nothing of this migration exists yet.
  if to_regclass('public.review_accounts') is not null then
    raise exception 'precondition failed: public.review_accounts already exists';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'am_i_review_account') then
    raise exception 'precondition failed: am_i_review_account already exists';
  end if;

  -- 3. Singleton game_state, no round in progress; locked until commit.
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

create temp table rv_fn_before on commit drop as
  select p.oid::regprocedure::text sig, p.proowner, p.proacl::text acl, p.proconfig
  from pg_proc p
  where p.oid = 'public.join_game_participant(uuid,text,text,uuid)'::regprocedure;

-- ── 1. review_accounts ──────────────────────────────────────────────────────
create table public.review_accounts (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);
alter table public.review_accounts enable row level security;
revoke all on table public.review_accounts from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.review_accounts to service_role;

-- ── 2. join_game_participant(): review accounts may join a live round ──────
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
  v_review            boolean;
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

  -- Review accounts (PG merchant review): may join while the round is
  -- live, at any time, so a reviewer can reach purchase -> 결제하기 without
  -- waiting for a scheduled window. Everyone else keeps the window below.
  -- claim_winner() is unchanged: it still needs phase 'game', no winner
  -- and this round's account_round_guard for the caller's session, which
  -- the code further down writes (or takes over) exactly as for a normal
  -- join.
  v_review := exists (select 1 from review_accounts where user_id = p_uid);

  if v_review and v_phase = 'game' then
    null;
  else
    -- Join window, by DB time only: T - N minutes <= now() < T.
    if coalesce(v_phase, '') not in ('waiting', 'strategy')
       or (v_scheduled_start is not null and now() >= v_scheduled_start) then
      raise exception 'participant join closed';
    end if;
    if v_scheduled_start is null
       or now() < v_scheduled_start - make_interval(mins => v_lead_minutes) then
      raise exception 'participant_join_not_open';
    end if;
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

-- ── 3. am_i_review_account() ────────────────────────────────────────────────
create function public.am_i_review_account()
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select exists (select 1 from review_accounts where auth.uid() is not null and user_id = auth.uid());
$function$;
revoke all on function public.am_i_review_account() from public, anon;
grant execute on function public.am_i_review_account() to authenticated, service_role;

-- ── Post-conditions (any failure rolls back) ────────────────────────────────
do $$
declare
  v_md5 text;
  r     record;
begin
  for r in
    select b.sig from rv_fn_before b join pg_proc p on p.oid = to_regprocedure(b.sig)
    where p.proowner is distinct from b.proowner
       or p.proacl::text is distinct from b.acl
       or p.proconfig is distinct from b.proconfig
       or not p.prosecdef
  loop
    raise exception 'post-condition failed: % owner / grants / config / security definer changed', r.sig;
  end loop;

  select md5(regexp_replace(p.prosrc, '\s+', '', 'g')) into v_md5
  from pg_proc p where p.oid = 'public.join_game_participant(uuid,text,text,uuid)'::regprocedure;
  if v_md5 is distinct from 'a0ba24fbba36a716eea3c90b7a91b41e' then
    raise exception 'post-condition failed: join_game_participant body md5 is %', v_md5;
  end if;

  select md5(regexp_replace(p.prosrc, '\s+', '', 'g')) into v_md5
  from pg_proc p
  where p.oid = 'public.am_i_review_account()'::regprocedure
    and p.prosecdef and p.proconfig @> array['search_path=public'];
  if v_md5 is distinct from 'ba41bab0e9f4cbc8ea3d3379e6463158' then
    raise exception 'post-condition failed: am_i_review_account body md5 is % (or not secdef)', coalesce(v_md5, '<missing>');
  end if;
  if has_function_privilege('anon', 'public.am_i_review_account()', 'execute')
     or not has_function_privilege('authenticated', 'public.am_i_review_account()', 'execute') then
    raise exception 'post-condition failed: am_i_review_account EXECUTE must be authenticated (+service_role) only';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.review_accounts'::regclass)
     or exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'review_accounts')
     or has_table_privilege('anon', 'public.review_accounts', 'select')
     or has_table_privilege('authenticated', 'public.review_accounts', 'select') then
    raise exception 'post-condition failed: review_accounts must be RLS-on, policy-less, closed to anon/authenticated';
  end if;
  if exists (select 1 from pg_publication_tables where schemaname = 'public' and tablename = 'review_accounts') then
    raise exception 'post-condition failed: review_accounts is in a publication';
  end if;
  if (select count(*) from public.review_accounts) <> 0 then
    raise exception 'post-condition failed: review_accounts must start empty';
  end if;
end $$;
