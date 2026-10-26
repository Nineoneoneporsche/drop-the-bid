-- Reconcile: record production's send_chat_message(text) as the repo definition.
--
-- Production's function differs from the repo-final version
-- (20260910130000_chat_security.sql, normalized body md5
-- 8d3c9d3947c75f38fe564cce76a57190): it was updated directly in the SQL
-- Editor and never committed. The production body (normalized md5
-- ed95a0d396f5808cf920e464256057ea, comment-stripped
-- 966fb76fea1cf9dc93fcbd00cb3b10ab) is adopted as-is, because it keeps every
-- guarantee of the repo version and fixes two bugs in it:
--   1. Rate limit counted every chat_messages row with the caller's guest_id,
--      including the system rows join_game() (entry announcement) and
--      claim_winner() (win announcement) insert under that guest_id — so a
--      user's first real message within 1.5s of joining/winning was refused
--      with 'sending too fast'. Production counts only kind = 'chat'.
--   2. A NULL p_message slipped past the blank check (trim(NULL) = '' is
--      NULL, not true) and the length check. Production rejects it
--      explicitly with 'message cannot be empty'.
-- Unchanged: auth.uid() is the only identity, nickname comes from
-- participants (any role — spectators can chat, as before), per-caller
-- pg_advisory_xact_lock(hashtext(v_uid::text)::bigint) serializes the
-- check-then-insert, 200-char limit, 1.5s interval, guest_id / nickname /
-- kind decided server-side.
--
-- The body below is production's prosrc verbatim (comments included), so the
-- normalized md5 is identical. Don't edit it here — write a new migration.
--
-- Accepted starting states (anything else aborts before any change):
--   ed95a0d3… production   -> re-created identical: no behavioural change
--   8d3c9d39… repo 0910130000 (fresh replay / never-patched DB) -> upgraded
-- EXECUTE is re-asserted to production's current state: no PUBLIC grant;
-- anon, authenticated, service_role (owner postgres keeps its implicit
-- right). No data is changed.
--
-- NOT APPLIED TO PRODUCTION (decided 2026-10-26): production already runs
-- exactly this body (ed95a0d3…) with these EXECUTE grants, and has no
-- supabase_migrations.schema_migrations to record it in. This file exists
-- so a fresh replay ends in production's state. Running it on production
-- is safe (pre-condition accepts ed95a0d3…, result is identical) but unneeded.

begin;

set local lock_timeout = '5s';

-- ── Pre-conditions (any failure aborts before anything changes) ────────────
do $$
declare
  v_n   int;
  v_md5 text;
begin
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'send_chat_message';
  if v_n <> 1 or to_regprocedure('public.send_chat_message(text)') is null then
    raise exception 'precondition failed: expected exactly one public.send_chat_message(text), found %', v_n;
  end if;

  select md5(regexp_replace(p.prosrc, '\s+', '', 'g')) into v_md5
  from pg_proc p
  where p.oid = 'public.send_chat_message(text)'::regprocedure
    and p.prosecdef and p.proconfig @> array['search_path=public'];

  if v_md5 is distinct from 'ed95a0d396f5808cf920e464256057ea'
     and v_md5 is distinct from '8d3c9d3947c75f38fe564cce76a57190' then
    raise exception 'precondition failed: send_chat_message body md5 is %, expected ed95a0d396f5808cf920e464256057ea (production) or 8d3c9d3947c75f38fe564cce76a57190 (repo 20260910130000)',
      coalesce(v_md5, '<not security definer / search_path=public>');
  end if;
end $$;

create or replace function public.send_chat_message(p_message text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_nickname  text;
  v_message   text := trim(p_message);
  v_last_sent timestamptz;
begin
  -- Authentication required.
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  -- Serialize chat sends per auth.uid().
  -- Concurrent calls from the same user cannot bypass rate limiting.
  perform pg_advisory_xact_lock(
    hashtext(v_uid::text)::bigint
  );

  -- Nickname is never trusted from the client.
  select nickname
  into v_nickname
  from public.participants
  where guest_id = v_uid;

  if v_nickname is null then
    raise exception 'must join before chatting';
  end if;

  -- Explicit NULL + blank validation.
  if v_message is null
     or v_message = '' then
    raise exception 'message cannot be empty';
  end if;

  if length(v_message) > 200 then
    raise exception 'message too long';
  end if;

  -- Only actual user chat messages count toward the rate limit.
  -- System messages such as join announcements must not block
  -- the user's first real chat message.
  select max(created_at)
  into v_last_sent
  from public.chat_messages
  where guest_id = v_uid
    and kind = 'chat';

  if v_last_sent is not null
     and now() - v_last_sent < interval '1.5 seconds' then
    raise exception 'sending too fast';
  end if;

  -- Identity, nickname and kind are all decided server-side.
  insert into public.chat_messages (
    guest_id,
    nickname,
    message,
    kind
  )
  values (
    v_uid,
    v_nickname,
    v_message,
    'chat'
  );
end;
$$;

revoke execute on function public.send_chat_message(text) from public;
grant execute on function public.send_chat_message(text) to anon, authenticated, service_role;

-- ── Post-conditions (any failure rolls back) ────────────────────────────────
do $$
declare
  v_md5   text;
  v_owner text;
begin
  select md5(regexp_replace(p.prosrc, '\s+', '', 'g')), pg_get_userbyid(p.proowner) into v_md5, v_owner
  from pg_proc p
  where p.oid = 'public.send_chat_message(text)'::regprocedure
    and p.prosecdef and p.proconfig @> array['search_path=public'];

  if v_md5 is distinct from 'ed95a0d396f5808cf920e464256057ea' then
    raise exception 'post-condition failed: send_chat_message body md5 is %, expected ed95a0d396f5808cf920e464256057ea', coalesce(v_md5, '<missing / not security definer>');
  end if;
  if v_owner is distinct from 'postgres' then
    raise exception 'post-condition failed: send_chat_message owner is %, expected postgres', v_owner;
  end if;
  if exists (select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
             where p.oid = 'public.send_chat_message(text)'::regprocedure and x.grantee = 0) then
    raise exception 'post-condition failed: PUBLIC holds a direct grant on send_chat_message';
  end if;
  if not (has_function_privilege('anon', 'public.send_chat_message(text)', 'execute')
          and has_function_privilege('authenticated', 'public.send_chat_message(text)', 'execute')
          and has_function_privilege('service_role', 'public.send_chat_message(text)', 'execute')) then
    raise exception 'post-condition failed: anon / authenticated / service_role must be able to execute send_chat_message';
  end if;
end $$;

commit;
