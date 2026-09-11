-- Phase 4: chat identity/kind moves server-side, same trust model as
-- join_game()/claim_winner() (Phase 1/2) — auth.uid() is the only identity,
-- never a client-supplied guest_id/nickname/kind. This revision adds four
-- things found while re-checking the security boundary before running the
-- first draft: two direct-REST holes that a client-code-only fix cannot
-- close, and two logic bugs (a rate-limit race, and system-message spam).
--
-- ────────────────────────────────────────────────────────────────────────
-- 1. chat_messages: lock down direct client writes
-- ────────────────────────────────────────────────────────────────────────
-- No RLS project-wide yet (that's its own later phase) — this is a plain
-- privilege REVOKE, scoped to just this table's write operations, not RLS.
-- SELECT stays granted (Realtime + initial history load both need it).
-- send_chat_message()/join_game()/claim_winner() are SECURITY DEFINER, so
-- their internal INSERTs run as the function owner (whichever role ran
-- this migration) — a role never touched by a REVOKE aimed at
-- anon/authenticated, so they keep working unaffected by this.
--
-- ────────────────────────────────────────────────────────────────────────
-- 2. participants: nickname forgery via direct REST — confirmed exploitable
-- ────────────────────────────────────────────────────────────────────────
-- Verified live against the current (unmodified) schema before writing
-- this: an authenticated session can PATCH `participants?guest_id=eq.<own
-- uid>` directly and set nickname to anything — e.g. "운영자" — bypassing
-- join_game()'s validation entirely. send_chat_message() trusts
-- participants.nickname, so this defeats "nickname 위조 불가" even though
-- the RPC itself never accepts a client-supplied nickname.
--
-- heartbeat (`update participants set last_seen=...`) and leaveGame
-- (`delete from participants ...`) both still do raw client writes today
-- and must keep working — so this can't be a blanket REVOKE of all
-- participants writes. The fix is column-level: revoke UPDATE on the whole
-- row, then re-grant UPDATE on just the `last_seen` column. heartbeat's
-- exact query keeps working; a PATCH that touches nickname/role now fails
-- with a permission error.
--   Residual, out of this phase's scope (flagged, not fixed here):
--   - heartbeat's UPDATE isn't restricted to *only the caller's own row* —
--     that needs `USING (guest_id = auth.uid())`, i.e. real RLS.
--   - raw INSERT into participants (join with a self-declared role,
--     bypassing join_game()'s participant/anonymous check) is still open —
--     already flagged in the Phase 1 report as deliberately deferred to
--     the full RLS phase; unchanged here, not this ticket's concern.
--   DELETE (leaveGame) is untouched — forging a nickname isn't reachable
--   through DELETE, so narrowing it isn't needed for this fix and would
--   risk breaking leaveGame for no security benefit.
--
-- ────────────────────────────────────────────────────────────────────────
-- 3. send_chat_message(): rate-limit race
-- ────────────────────────────────────────────────────────────────────────
-- The original draft's rate limit was check-then-act (SELECT max(created_at),
-- compare, then INSERT) with no atomicity — concurrent calls from the same
-- auth.uid() could all read "no recent message" before any of them commits
-- its INSERT, letting all of them through. Fixed with
-- pg_advisory_xact_lock(), keyed by a hash of auth.uid(): the first call
-- from a given uid to reach this point takes the lock and holds it for the
-- rest of the transaction (released automatically on commit), so any
-- concurrent call from the *same* uid blocks until the first one has
-- actually committed its INSERT — at which point its own SELECT
-- max(created_at) correctly sees that just-committed row and is rejected.
-- Different uids use different lock keys and never block each other.
--
-- ────────────────────────────────────────────────────────────────────────
-- 4. join_game(): system-message spam on repeated calls
-- ────────────────────────────────────────────────────────────────────────
-- The first draft fired the entry-announcement on *every* call, matching
-- the old client behavior byte-for-byte — but that old behavior was never
-- reachable more than once per real join in practice (the client only ever
-- called it from the one-shot /join flow). Now that it's a public RPC,
-- nothing stops calling it in a loop to spam the same announcement forever.
-- Fixed by reading the caller's *previous* role (if any) before the
-- upsert, and only inserting the announcement when there wasn't one yet
-- (first real join) or the role actually changed (spectator ↔
-- participant) — a repeat call with the same role updates last_seen/
-- nickname silently, same as it already would have, but announces nothing.
-- Same advisory-lock technique as #3 closes the equivalent concurrent-spam
-- race for this function too (two truly simultaneous join_game() calls
-- from the same uid could otherwise both read "no previous role" and both
-- announce).
--
-- Run this manually in the Supabase SQL Editor (Database > SQL Editor).

begin;

-- ── 1. chat_messages write lockdown ───────────────────────────────────────
revoke insert, update, delete on table public.chat_messages from anon, authenticated;

-- Supports send_chat_message()'s per-caller rate-limit lookup
-- (max(created_at) where guest_id = ...) without a full table scan as chat
-- volume grows.
create index if not exists chat_messages_guest_id_created_at_idx
  on public.chat_messages (guest_id, created_at);

-- ── 2. participants nickname-forgery lockdown ─────────────────────────────
revoke update on table public.participants from anon, authenticated;
grant update (last_seen) on table public.participants to anon, authenticated;

-- ── join_game(): conditional announcement + advisory lock ────────────────
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
  v_old_role text;
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

  -- Serializes this whole check-then-act sequence per caller — see #3/#4
  -- above. Released automatically at the end of this transaction.
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
end;
$$;

-- ── send_chat_message(): atomic rate limit ────────────────────────────────
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
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  -- Serializes this caller's check-then-insert — see #3 above.
  perform pg_advisory_xact_lock(hashtext(v_uid::text)::bigint);

  select nickname into v_nickname from participants where guest_id = v_uid;
  if v_nickname is null then
    raise exception 'must join before chatting';
  end if;

  if v_message = '' then
    raise exception 'message cannot be empty';
  end if;
  if length(v_message) > 200 then
    raise exception 'message too long';
  end if;

  select max(created_at) into v_last_sent from chat_messages where guest_id = v_uid;
  if v_last_sent is not null and now() - v_last_sent < interval '1.5 seconds' then
    raise exception 'sending too fast';
  end if;

  insert into chat_messages (guest_id, nickname, message, kind)
  values (v_uid, v_nickname, v_message, 'chat');
end;
$$;

commit;
