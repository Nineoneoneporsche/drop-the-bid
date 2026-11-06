-- M4-B1: full-refund ledger (Toss full cancellation), before any refund UI.
--
-- What this adds (app side: app/lib/paymentRefund.ts, app/lib/tossClient.ts):
--
--   payment_cancellations   the source of truth for refunds. One row per
--       cancellation request of one paid order (full amount only):
--         order_id / win_id / payment_key / amount   copied from the paid
--                                attempt + order at reservation, never changed
--         reason                 Toss cancelReason, 1..200 chars, trimmed
--         toss_idempotency_key   generated here ('cancel-' || uuid), never by a
--                                client, never changed: every send of this
--                                cancellation uses it. UNIQUE.
--         status                 pending | done | failed | reconciliation_required
--         toss_status / toss_transaction_key / canceled_at / toss_response
--                                what a VERIFIED Toss answer said (sanitized)
--         initial_post_outcome / initial_post_http_status / initial_post_error_code
--                                what the FIRST cancel POST got back, machine-
--                                readable, recorded once (NULL -> value while
--                                pending, never changed afterwards):
--                                  verified_cancel      2xx, a verified full cancellation
--                                  definite_rejection   definitive 4xx with a listed
--                                                       business / auth rejection code
--                                  http_ambiguous       5xx / 408 / 429 / unlisted code /
--                                                       unreadable body / unverified 2xx
--                                  timeout_unknown      no response (timeout)
--                                  network_unknown      no response (network error)
--                                timeout_unknown / network_unknown are the "no
--                                answer at all" cases (a resend with the SAME
--                                key is safe there; not implemented here).
--                                'failed' requires definite_rejection (CHECK).
--         error_detail           operator / log text ONLY — no decision ever
--                                parses it
--         requested_by_session   the admin session that asked (admin_sessions;
--                                ON DELETE SET NULL)
--       At most one pending / reconciliation_required / done row per order
--       (partial unique index): an order is refunded once; only after a
--       'failed' row (Toss provably did not cancel) can a new one be made.
--       payment_attempts stays 'paid' and orders is never deleted: a refund
--       never frees the win for a new payment, and admin_reset_game() /
--       the active-attempt indexes see exactly what they saw before.
--
--   orders.refunded_at      Toss's verified Cancel.canceledAt of the done
--       cancellation (nullable; set once, only by payment_cancel_finalize(),
--       guarded by a trigger). No client grant yet (no UI in this step).
--
--   payment_cancellations_guard_transition (trigger, also blocks DELETE):
--         INSERT                   status must be 'pending'
--         pending                  -> pending | done | failed | reconciliation_required
--         reconciliation_required  -> reconciliation_required | done | failed
--         failed                   -> failed                     (terminal)
--         done                     -> done                       (terminal)
--       id / order_id / win_id / payment_key / amount / reason /
--       requested_at / toss_idempotency_key never change; a done row's
--       transaction key / canceled_at / completed_at never change;
--       requested_by_session only to NULL (FK SET NULL); initial_post_*
--       NULL on INSERT, set only while pending and only from NULL.
--
--   orders_guard_refunded_at (trigger): refunded_at NULL on INSERT; set only
--       NULL -> the canceled_at of a done cancellation of that order; never
--       changed afterwards.
--
--   RPCs (SECURITY DEFINER, search_path=public, EXECUTE service_role only):
--     payment_cancel_reserve(order_id, reason, admin_session)  -> jsonb
--         locks the order and its attempt; requires attempt 'paid', the
--         order present, order_id / payment_key / win_id / amount equal on
--         both, no refund yet, no cancellation in progress, an active admin
--         session; inserts the 'pending' row with a new key. Returns what
--         the server needs to call Toss (id, key, paymentKey, amount, reason).
--     payment_cancel_record_post(id, outcome, http_status, error_code) -> boolean
--         records the first cancel POST's outcome on a pending row whose
--         outcome is still NULL (true), otherwise writes nothing (false).
--     payment_cancel_mark(id, from, status, toss_status, toss_response, detail) -> boolean
--         from pending / reconciliation_required to failed /
--         reconciliation_required, only from `from`. 'failed' only with a
--         Toss status of DONE (still paid, not canceled), never once a
--         cancel was seen, and only when initial_post_outcome is
--         definite_rejection.
--     payment_cancel_finalize(id, toss_status, transaction_key, canceled_at, toss_response) -> text
--         verified CANCELED -> the row 'done' + orders.refunded_at =
--         canceled_at in ONE transaction (row + order locked). A replay of
--         a done row is idempotent ('already_done').
--
-- service_role: SELECT on payment_cancellations only (every write is an
-- RPC); anon / authenticated: nothing. RLS on, no policies.
--
-- Unchanged: claim_winner() (M1), admin_reset_game() (M2), the M3 timing
-- functions, the M4-A payment functions and trigger, auction_wins and
-- payment_attempts (columns, privileges), orders' privileges / RLS / policy.
--
-- Normalized body md5s (md5(regexp_replace(prosrc, '\s+', '', 'g'))):
--   payment_cancel_reserve(text,text,uuid)                              new -> 9e3c4d40972a7ef7a56f2bb2b105382d
--   payment_cancel_record_post(uuid,text,integer,text)                  new -> a002cf826d9c383412fa03c9aff90f1a
--   payment_cancel_mark(uuid,text,text,text,jsonb,text)                 new -> 8a10282e6588281821833dcd7c23648c
--   payment_cancel_finalize(uuid,text,text,timestamptz,jsonb)           new -> cffac42874250be292dc5f823a6717ff
--   payment_cancellations_guard_transition()                            new -> 02185e30dad239701e18ff5de3063f8f
--   orders_guard_refunded_at()                                          new -> 0845977dc26ace018ae0b5c8a78c83ce
-- (enforced by the post-conditions).
--
-- Requires M4-A (20261030200000). Deploy only through the Supabase CLI
-- migration workflow (pinned CLI v2.122.0, `db push --linked`). Do NOT
-- execute this migration manually in the Production SQL Editor: that
-- bypasses supabase_migrations history. No explicit BEGIN/COMMIT here on
-- purpose: the CLI migration runner wraps this file and its history INSERT
-- in one transaction, so any failure leaves neither a partial change nor a
-- history row.
--
-- Rollback (manual, emergency only, NOT a migration; refuses once any
-- refund history exists):
-- supabase/rollbacks/20261104100000_payment_cancellations.rollback.sql

set local lock_timeout = '5s';

-- ── 0. Preconditions (any failure aborts before anything changes) ──────────
do $$
declare
  v_n   int;
  r     record;
  v_md5 text;
begin
  -- 1. The columns this migration reads / references.
  select count(*) into v_n from information_schema.columns
  where table_schema = 'public'
    and ((table_name = 'payment_attempts' and (column_name, data_type) in (
            ('order_id', 'text'), ('amount', 'integer'), ('payment_key', 'text'), ('status', 'text'), ('win_id', 'uuid')))
      or (table_name = 'orders' and (column_name, data_type) in (
            ('order_id', 'text'), ('win_id', 'uuid'), ('payment_key', 'text'), ('amount', 'integer')))
      or (table_name = 'auction_wins' and (column_name, data_type) in (('id', 'uuid')))
      or (table_name = 'admin_sessions' and (column_name, data_type) in (
            ('id', 'uuid'), ('expires_at', 'timestamp with time zone'), ('revoked_at', 'timestamp with time zone'))));
  if v_n <> 13 then
    raise exception 'precondition failed: payment_attempts / orders / auction_wins / admin_sessions columns differ from expected (found % of 13)', v_n;
  end if;

  -- 2. The keys the foreign keys point at.
  if not exists (select 1 from pg_constraint where conrelid = 'public.orders'::regclass
                 and conname = 'orders_order_id_key' and pg_get_constraintdef(oid) = 'UNIQUE (order_id)')
     or not exists (select 1 from pg_constraint where conrelid = 'public.orders'::regclass
                    and conname = 'orders_payment_key_key' and pg_get_constraintdef(oid) = 'UNIQUE (payment_key)') then
    raise exception 'precondition failed: orders_order_id_key / orders_payment_key_key missing or unexpected';
  end if;

  -- 3. M4-A is in place, exactly as pinned.
  for r in
    select * from (values
      ('public.payment_reserve_attempt(text,uuid,uuid,integer,text,text,text,text,text,text)', '3b0840ae43dd5807a074816a8ca03fdf'),
      ('public.payment_finalize_paid(text,jsonb,text,timestamptz)',                              'e4d02c5b0c445e83965b585bc4ff6a12'),
      ('public.payment_attempts_guard_transition()',                                             '3b910dd20de5c3e8f61398caf1d8b28e')
    ) t(sig, md5)
  loop
    select md5(regexp_replace(p.prosrc, '\s+', '', 'g')) into v_md5 from pg_proc p where p.oid = to_regprocedure(r.sig);
    if v_md5 is distinct from r.md5 then
      raise exception 'precondition failed: M4-A % body md5 is %, expected %', r.sig, coalesce(v_md5, '<missing>'), r.md5;
    end if;
  end loop;

  -- 4. Nothing this migration creates exists yet (the rollback removes all
  --    of it, and only while no refund history exists).
  if to_regclass('public.payment_cancellations') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'refunded_at')
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public'
                  and p.proname in ('payment_cancel_reserve', 'payment_cancel_record_post', 'payment_cancel_mark', 'payment_cancel_finalize',
                                    'payment_cancellations_guard_transition', 'orders_guard_refunded_at'))
     or exists (select 1 from pg_trigger where tgrelid = 'public.orders'::regclass and not tgisinternal) then
    raise exception 'precondition failed: an M4-B1 object (payment_cancellations, orders.refunded_at, a function or an orders trigger) already exists';
  end if;

  -- 5. RLS where the RPCs read.
  if not (select relrowsecurity from pg_class where oid = 'public.orders'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.payment_attempts'::regclass) then
    raise exception 'precondition failed: RLS is not enabled on orders / payment_attempts';
  end if;
end $$;

-- Privileges of the tables whose grants must NOT change, compared afterwards.
create temp table m4b1_acl_before on commit drop as
  select c.oid::regclass::text t, c.relacl::text acl,
         (select string_agg(a.attname || '=' || a.attacl::text, ';' order by a.attname)
          from pg_attribute a where a.attrelid = c.oid and a.attacl is not null) col_acl
  from pg_class c
  where c.oid in ('public.orders'::regclass, 'public.payment_attempts'::regclass, 'public.auction_wins'::regclass,
                  'public.admin_sessions'::regclass);

-- ── 1. payment_cancellations ────────────────────────────────────────────────
create table public.payment_cancellations (
  id                   uuid        primary key default gen_random_uuid(),
  order_id             text        not null references public.orders (order_id),
  win_id               uuid        not null references public.auction_wins (id),
  payment_key          text        not null,
  amount               integer     not null,
  reason               text        not null,
  toss_idempotency_key text        not null,
  status               text        not null default 'pending',
  toss_status          text,
  toss_transaction_key text,
  canceled_at          timestamptz,
  toss_response        jsonb,
  initial_post_outcome     text,
  initial_post_http_status integer,
  initial_post_error_code  text,
  error_detail         text,
  requested_by_session uuid        references public.admin_sessions (id) on delete set null,
  requested_at         timestamptz not null default now(),
  completed_at         timestamptz,
  last_checked_at      timestamptz,
  updated_at           timestamptz not null default now(),

  constraint payment_cancellations_status_check
    check (status in ('pending', 'done', 'failed', 'reconciliation_required')),
  constraint payment_cancellations_amount_positive check (amount > 0),
  constraint payment_cancellations_reason_length
    check (char_length(reason) between 1 and 200 and reason = btrim(reason)),
  constraint payment_cancellations_toss_idempotency_key_key unique (toss_idempotency_key),
  constraint payment_cancellations_toss_idempotency_key_length
    check (char_length(toss_idempotency_key) between 1 and 300),
  constraint payment_cancellations_toss_transaction_key_key unique (toss_transaction_key),
  constraint payment_cancellations_done_complete
    check (status <> 'done' or (toss_status is not distinct from 'CANCELED' and toss_transaction_key is not null
                                and canceled_at is not null and completed_at is not null)),
  constraint payment_cancellations_initial_post_outcome_check
    check (initial_post_outcome is null
           or initial_post_outcome in ('verified_cancel', 'definite_rejection', 'http_ambiguous', 'timeout_unknown', 'network_unknown')),
  constraint payment_cancellations_initial_post_shape
    check ((initial_post_outcome is null and initial_post_http_status is null and initial_post_error_code is null)
        or (initial_post_outcome in ('timeout_unknown', 'network_unknown')
            and initial_post_http_status is null and initial_post_error_code is null)
        or (initial_post_outcome = 'definite_rejection' and initial_post_http_status is not null
            and initial_post_http_status between 400 and 499 and initial_post_http_status not in (408, 429)
            and initial_post_error_code is not null)
        or (initial_post_outcome = 'verified_cancel' and initial_post_http_status is not null
            and initial_post_http_status between 200 and 299 and initial_post_error_code is null)
        or (initial_post_outcome = 'http_ambiguous' and initial_post_http_status is not null
            and initial_post_http_status between 100 and 599)),
  constraint payment_cancellations_initial_post_error_code_length
    check (initial_post_error_code is null or char_length(initial_post_error_code) between 1 and 100),
  -- 'failed' = Toss provably did not cancel: only after a definitive rejection.
  constraint payment_cancellations_failed_needs_rejection
    check (status <> 'failed' or initial_post_outcome is not distinct from 'definite_rejection')
);

-- One refund per order: at most one row that is in progress or done.
create unique index payment_cancellations_one_active_per_order
  on public.payment_cancellations (order_id)
  where status in ('pending', 'reconciliation_required', 'done');

alter table public.payment_cancellations enable row level security;

-- Explicit, whatever the project's default privileges grant new tables.
revoke all on table public.payment_cancellations from public, anon, authenticated, service_role;
grant select on table public.payment_cancellations to service_role;

-- ── 2. orders.refunded_at ───────────────────────────────────────────────────
alter table public.orders add column refunded_at timestamptz;

-- ── 3. Allowed moves on payment_cancellations ──────────────────────────────
create function public.payment_cancellations_guard_transition()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = 'P0001', message = 'payment_cancellation_transition_forbidden:delete';
  end if;
  if tg_op = 'INSERT' then
    if new.status is distinct from 'pending' then
      raise exception using errcode = 'P0001', message = 'payment_cancellation_transition_forbidden:insert_' || coalesce(new.status, 'null');
    end if;
    if new.initial_post_outcome is not null then
      raise exception using errcode = 'P0001', message = 'payment_cancellation_transition_forbidden:insert_initial_post';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id or new.order_id is distinct from old.order_id or new.win_id is distinct from old.win_id
     or new.payment_key is distinct from old.payment_key or new.amount is distinct from old.amount
     or new.reason is distinct from old.reason or new.requested_at is distinct from old.requested_at then
    raise exception using errcode = 'P0001', message = 'payment_cancellation_transition_forbidden:identity';
  end if;
  if new.toss_idempotency_key is distinct from old.toss_idempotency_key then
    raise exception using errcode = 'P0001', message = 'payment_cancellation_transition_forbidden:idempotency_key';
  end if;
  if new.requested_by_session is distinct from old.requested_by_session and new.requested_by_session is not null then
    raise exception using errcode = 'P0001', message = 'payment_cancellation_transition_forbidden:requested_by_session';
  end if;
  -- The first POST's outcome: recorded once, while pending, never rewritten.
  if (new.initial_post_outcome, new.initial_post_http_status, new.initial_post_error_code)
       is distinct from (old.initial_post_outcome, old.initial_post_http_status, old.initial_post_error_code)
     and (old.initial_post_outcome is not null or old.status <> 'pending') then
    raise exception using errcode = 'P0001', message = 'payment_cancellation_transition_forbidden:initial_post';
  end if;
  if old.status = 'done' and (new.toss_transaction_key is distinct from old.toss_transaction_key
                              or new.canceled_at is distinct from old.canceled_at
                              or new.completed_at is distinct from old.completed_at) then
    raise exception using errcode = 'P0001', message = 'payment_cancellation_transition_forbidden:done_fields';
  end if;

  if not (
       (old.status = 'pending' and new.status in ('pending', 'done', 'failed', 'reconciliation_required'))
    or (old.status = 'reconciliation_required' and new.status in ('reconciliation_required', 'done', 'failed'))
    or (old.status = 'failed' and new.status = 'failed')
    or (old.status = 'done' and new.status = 'done')
  ) then
    raise exception using errcode = 'P0001', message = 'payment_cancellation_transition_forbidden:' || old.status || '_to_' || new.status;
  end if;
  return new;
end;
$function$;
revoke all on function public.payment_cancellations_guard_transition() from public, anon, authenticated, service_role;

create trigger payment_cancellations_guard_transition
  before insert or update or delete on public.payment_cancellations
  for each row execute function public.payment_cancellations_guard_transition();

-- ── 4. orders.refunded_at: set once, to a done cancellation's canceled_at ──
create function public.orders_guard_refunded_at()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  if tg_op = 'INSERT' then
    if new.refunded_at is not null then
      raise exception using errcode = 'P0001', message = 'orders_refunded_at_forbidden:insert';
    end if;
    return new;
  end if;
  if new.refunded_at is distinct from old.refunded_at then
    if old.refunded_at is not null then
      raise exception using errcode = 'P0001', message = 'orders_refunded_at_forbidden:immutable';
    end if;
    if not exists (select 1 from payment_cancellations c
                   where c.order_id = new.order_id and c.status = 'done' and c.canceled_at = new.refunded_at) then
      raise exception using errcode = 'P0001', message = 'orders_refunded_at_forbidden:no_done_cancellation';
    end if;
  end if;
  return new;
end;
$function$;
revoke all on function public.orders_guard_refunded_at() from public, anon, authenticated, service_role;

create trigger orders_guard_refunded_at
  before insert or update on public.orders
  for each row execute function public.orders_guard_refunded_at();

-- ── 5. payment_cancel_reserve(): checks + the 'pending' row, one transaction ─
-- Refusals are stable messages ('cancel_reserve:<reason>'); nothing is
-- written for any of them.
create function public.payment_cancel_reserve(p_order_id text, p_reason text, p_requested_by_session uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_order  record;
  v_att    record;
  v_row    record;
begin
  if p_order_id is null or p_order_id = '' then
    raise exception using errcode = 'P0001', message = 'cancel_reserve:invalid';
  end if;
  if char_length(v_reason) < 1 or char_length(v_reason) > 200 then
    raise exception using errcode = 'P0001', message = 'cancel_reserve:invalid_reason';
  end if;
  if p_requested_by_session is null then
    raise exception using errcode = 'P0001', message = 'cancel_reserve:no_session';
  end if;
  if not exists (select 1 from admin_sessions s
                 where s.id = p_requested_by_session and s.revoked_at is null and s.expires_at > now()) then
    raise exception using errcode = 'P0001', message = 'cancel_reserve:invalid_session';
  end if;

  -- Order first, then attempt: the same lock order for every caller, so two
  -- requests for one order serialize here.
  select o.order_id, o.win_id, o.payment_key, o.amount, o.refunded_at into v_order
  from orders o where o.order_id = p_order_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'cancel_reserve:no_order';
  end if;
  select a.order_id, a.status, a.win_id, a.payment_key, a.amount into v_att
  from payment_attempts a where a.order_id = p_order_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'cancel_reserve:no_attempt';
  end if;
  if v_att.status <> 'paid' then
    raise exception using errcode = 'P0001', message = 'cancel_reserve:not_paid';
  end if;
  if v_order.win_id is null or v_att.win_id is null then
    raise exception using errcode = 'P0001', message = 'cancel_reserve:legacy_order';
  end if;
  if v_order.win_id <> v_att.win_id or v_order.payment_key <> v_att.payment_key or v_order.amount <> v_att.amount
     or v_att.amount <= 0 then
    raise exception using errcode = 'P0001', message = 'cancel_reserve:identity_mismatch';
  end if;
  if v_order.refunded_at is not null
     or exists (select 1 from payment_cancellations c where c.order_id = p_order_id and c.status = 'done') then
    raise exception using errcode = 'P0001', message = 'cancel_reserve:already_refunded';
  end if;
  if exists (select 1 from payment_cancellations c
             where c.order_id = p_order_id and c.status in ('pending', 'reconciliation_required')) then
    raise exception using errcode = 'P0001', message = 'cancel_reserve:in_progress';
  end if;

  insert into payment_cancellations (order_id, win_id, payment_key, amount, reason, toss_idempotency_key, status, requested_by_session)
  values (v_att.order_id, v_att.win_id, v_att.payment_key, v_att.amount, v_reason,
          'cancel-' || gen_random_uuid()::text, 'pending', p_requested_by_session)
  returning id, order_id, payment_key, amount, reason, toss_idempotency_key into v_row;

  return jsonb_build_object(
    'cancellation_id', v_row.id, 'order_id', v_row.order_id, 'payment_key', v_row.payment_key,
    'amount', v_row.amount, 'reason', v_row.reason, 'toss_idempotency_key', v_row.toss_idempotency_key);
end;
$function$;
revoke all on function public.payment_cancel_reserve(text, text, uuid) from public, anon, authenticated;
grant execute on function public.payment_cancel_reserve(text, text, uuid) to service_role;

-- ── 6a. payment_cancel_record_post(): the first cancel POST's outcome ──────
-- true when recorded; false (nothing written) when the row is not pending
-- or already has an outcome. An inconsistent status / code combination is
-- refused by the table's CHECKs.
create function public.payment_cancel_record_post(p_id uuid, p_outcome text, p_http_status integer, p_error_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $function$
begin
  if p_outcome is null
     or p_outcome not in ('verified_cancel', 'definite_rejection', 'http_ambiguous', 'timeout_unknown', 'network_unknown') then
    raise exception using errcode = 'P0001', message = 'cancel_record_post:invalid';
  end if;
  update payment_cancellations
  set initial_post_outcome = p_outcome, initial_post_http_status = p_http_status, initial_post_error_code = p_error_code,
      updated_at = now()
  where id = p_id and status = 'pending' and initial_post_outcome is null;
  return found;
end;
$function$;
revoke all on function public.payment_cancel_record_post(uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.payment_cancel_record_post(uuid, text, integer, text) to service_role;

-- ── 6. payment_cancel_mark(): failed / reconciliation_required ─────────────
-- true when exactly this row moved from p_from. A NULL toss_status /
-- toss_response keeps what is stored.
create function public.payment_cancel_mark(p_id uuid, p_from text, p_status text, p_toss_status text, p_toss_response jsonb, p_error_detail text)
returns boolean
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_row record;
begin
  if p_from is null or p_from not in ('pending', 'reconciliation_required')
     or p_status is null or p_status not in ('failed', 'reconciliation_required') then
    raise exception using errcode = 'P0001', message = 'cancel_mark:invalid';
  end if;
  select status, toss_status, canceled_at, initial_post_outcome into v_row from payment_cancellations where id = p_id for update;
  if not found or v_row.status <> p_from then
    return false;
  end if;
  if p_status = 'failed' and v_row.initial_post_outcome is distinct from 'definite_rejection' then
    raise exception using errcode = 'P0001', message = 'cancel_mark:failed_needs_definite_rejection';
  end if;
  if p_status = 'failed'
     and (p_toss_status is distinct from 'DONE' or v_row.toss_status in ('CANCELED', 'PARTIAL_CANCELED') or v_row.canceled_at is not null) then
    raise exception using errcode = 'P0001', message = 'cancel_mark:failed_needs_uncanceled_payment';
  end if;
  update payment_cancellations
  set status = p_status, toss_status = coalesce(p_toss_status, toss_status), toss_response = coalesce(p_toss_response, toss_response),
      error_detail = left(p_error_detail, 500), last_checked_at = now(), updated_at = now()
  where id = p_id;
  return true;
end;
$function$;
revoke all on function public.payment_cancel_mark(uuid, text, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.payment_cancel_mark(uuid, text, text, text, jsonb, text) to service_role;

-- ── 7. payment_cancel_finalize(): done + orders.refunded_at, one transaction
-- Called only after the caller verified a full cancellation (CANCELED,
-- balanceAmount 0, a DONE cancel for the whole amount). Returns done |
-- already_done; raises (nothing written) for anything that can't apply.
create function public.payment_cancel_finalize(p_id uuid, p_toss_status text, p_transaction_key text, p_canceled_at timestamptz, p_toss_response jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_c     record;
  v_order record;
begin
  if p_toss_status is distinct from 'CANCELED' or p_transaction_key is null or btrim(p_transaction_key) = ''
     or p_canceled_at is null then
    raise exception using errcode = 'P0001', message = 'cancel_finalize:not_canceled';
  end if;

  select * into v_c from payment_cancellations where id = p_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'cancel_finalize:no_cancellation';
  end if;
  select o.order_id, o.win_id, o.payment_key, o.amount, o.refunded_at into v_order
  from orders o where o.order_id = v_c.order_id for update;

  if v_c.status = 'done' then
    if v_c.toss_transaction_key = p_transaction_key and v_order.refunded_at = v_c.canceled_at then
      return 'already_done';
    end if;
    raise exception using errcode = 'P0001', message = 'cancel_finalize:done_mismatch';
  end if;
  if v_c.status not in ('pending', 'reconciliation_required') then
    raise exception using errcode = 'P0001', message = 'cancel_finalize:status_' || v_c.status;
  end if;
  if v_order.order_id is null or v_order.win_id is distinct from v_c.win_id
     or v_order.payment_key is distinct from v_c.payment_key or v_order.amount is distinct from v_c.amount then
    raise exception using errcode = 'P0001', message = 'cancel_finalize:order_mismatch';
  end if;
  if v_order.refunded_at is not null then
    raise exception using errcode = 'P0001', message = 'cancel_finalize:already_refunded';
  end if;

  update payment_cancellations
  set status = 'done', toss_status = p_toss_status, toss_transaction_key = p_transaction_key, canceled_at = p_canceled_at,
      toss_response = p_toss_response, error_detail = null, completed_at = now(), last_checked_at = now(), updated_at = now()
  where id = p_id;
  update orders set refunded_at = p_canceled_at where order_id = v_c.order_id;
  return 'done';
end;
$function$;
revoke all on function public.payment_cancel_finalize(uuid, text, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.payment_cancel_finalize(uuid, text, text, timestamptz, jsonb) to service_role;

-- ── Post-conditions (any failure rolls back) ────────────────────────────────
do $$
declare
  r      record;
  v_md5  text;
  v_own  oid;
begin
  -- New functions: bodies as pinned; RPCs security definer with
  -- search_path=public, owned like claim_winner(), EXECUTE service_role only;
  -- trigger functions executable by nobody.
  select proowner into v_own from pg_proc where oid = 'public.claim_winner()'::regprocedure;
  for r in
    select * from (values
      ('public.payment_cancel_reserve(text,text,uuid)',                     '9e3c4d40972a7ef7a56f2bb2b105382d', true),
      ('public.payment_cancel_record_post(uuid,text,integer,text)',         'a002cf826d9c383412fa03c9aff90f1a', true),
      ('public.payment_cancel_mark(uuid,text,text,text,jsonb,text)',        '8a10282e6588281821833dcd7c23648c', true),
      ('public.payment_cancel_finalize(uuid,text,text,timestamptz,jsonb)',  'cffac42874250be292dc5f823a6717ff', true),
      ('public.payment_cancellations_guard_transition()',                   '02185e30dad239701e18ff5de3063f8f', false),
      ('public.orders_guard_refunded_at()',                                 '0845977dc26ace018ae0b5c8a78c83ce', false)
    ) t(sig, md5, rpc)
  loop
    select md5(regexp_replace(p.prosrc, '\s+', '', 'g')) into v_md5 from pg_proc p where p.oid = to_regprocedure(r.sig);
    if v_md5 is distinct from r.md5 then
      raise exception 'post-condition failed: % body md5 is %, expected %', r.sig, coalesce(v_md5, '<missing>'), r.md5;
    end if;
    if exists (select 1 from pg_proc p where p.oid = to_regprocedure(r.sig)
               and (p.prosecdef <> r.rpc or p.proconfig is distinct from array['search_path=public'] or p.proowner <> v_own)) then
      raise exception 'post-condition failed: % security definer / search_path / owner', r.sig;
    end if;
    if has_function_privilege('anon', r.sig, 'execute') or has_function_privilege('authenticated', r.sig, 'execute')
       or has_function_privilege('service_role', r.sig, 'execute') <> r.rpc
       or exists (select 1 from pg_proc p, aclexplode(p.proacl) x where p.oid = to_regprocedure(r.sig) and x.grantee = 0) then
      raise exception 'post-condition failed: % EXECUTE grants', r.sig;
    end if;
  end loop;
  if not has_table_privilege(v_own, 'public.payment_cancellations', 'select, insert, update')
     or not has_table_privilege(v_own, 'public.orders', 'select, update')
     or not has_table_privilege(v_own, 'public.payment_attempts', 'select')
     or not has_table_privilege(v_own, 'public.admin_sessions', 'select') then
    raise exception 'post-condition failed: the RPC owner lacks privileges on payment_cancellations / orders / payment_attempts / admin_sessions';
  end if;

  -- M4-A untouched.
  for r in
    select * from (values
      ('public.payment_reserve_attempt(text,uuid,uuid,integer,text,text,text,text,text,text)', '3b0840ae43dd5807a074816a8ca03fdf'),
      ('public.payment_finalize_paid(text,jsonb,text,timestamptz)',                              'e4d02c5b0c445e83965b585bc4ff6a12'),
      ('public.payment_attempts_guard_transition()',                                             '3b910dd20de5c3e8f61398caf1d8b28e')
    ) t(sig, md5)
  loop
    select md5(regexp_replace(p.prosrc, '\s+', '', 'g')) into v_md5 from pg_proc p where p.oid = to_regprocedure(r.sig);
    if v_md5 is distinct from r.md5 then
      raise exception 'post-condition failed: M4-A % body changed', r.sig;
    end if;
  end loop;

  -- Triggers: enabled, row-level, before (insert/update/delete | insert/update).
  if not exists (select 1 from pg_trigger t
                 where t.tgrelid = 'public.payment_cancellations'::regclass and t.tgname = 'payment_cancellations_guard_transition'
                   and t.tgfoid = 'public.payment_cancellations_guard_transition()'::regprocedure
                   and t.tgenabled = 'O' and t.tgtype = 31)
     or not exists (select 1 from pg_trigger t
                    where t.tgrelid = 'public.orders'::regclass and t.tgname = 'orders_guard_refunded_at'
                      and t.tgfoid = 'public.orders_guard_refunded_at()'::regprocedure
                      and t.tgenabled = 'O' and t.tgtype = 23) then
    raise exception 'post-condition failed: payment_cancellations / orders guard triggers';
  end if;

  -- The table: RLS on, no policies; service_role SELECT only; no client or
  -- PUBLIC privilege; the one-active index.
  if not (select relrowsecurity from pg_class where oid = 'public.payment_cancellations'::regclass)
     or exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'payment_cancellations') then
    raise exception 'post-condition failed: payment_cancellations RLS / policies';
  end if;
  if exists (select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
             where c.oid = 'public.payment_cancellations'::regclass
               and (x.grantee = 0 or pg_get_userbyid(x.grantee) in ('anon', 'authenticated')
                    or (pg_get_userbyid(x.grantee) = 'service_role' and x.privilege_type <> 'SELECT')))
     or not has_table_privilege('service_role', 'public.payment_cancellations', 'select')
     or exists (select 1 from pg_attribute a where a.attrelid = 'public.payment_cancellations'::regclass and a.attacl is not null) then
    raise exception 'post-condition failed: payment_cancellations privileges';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'payment_cancellations'
                 and indexname = 'payment_cancellations_one_active_per_order'
                 and indexdef = 'CREATE UNIQUE INDEX payment_cancellations_one_active_per_order ON public.payment_cancellations USING btree (order_id) WHERE (status = ANY (ARRAY[''pending''::text, ''reconciliation_required''::text, ''done''::text]))') then
    raise exception 'post-condition failed: payment_cancellations_one_active_per_order';
  end if;
  if (select count(*) from pg_constraint where conrelid = 'public.payment_cancellations'::regclass and contype in ('c', 'u', 'f', 'p')) <> 15 then
    raise exception 'post-condition failed: payment_cancellations constraints';
  end if;

  -- orders.refunded_at: nullable, no default; no client can read or write it.
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders'
                 and column_name = 'refunded_at' and data_type = 'timestamp with time zone' and is_nullable = 'YES'
                 and column_default is null)
     or has_column_privilege('authenticated', 'public.orders', 'refunded_at', 'select')
     or has_column_privilege('anon', 'public.orders', 'refunded_at', 'select') then
    raise exception 'post-condition failed: orders.refunded_at';
  end if;

  -- orders / payment_attempts / auction_wins / admin_sessions privileges unchanged.
  if (select count(*) from m4b1_acl_before) <> 4
     or exists (select 1 from m4b1_acl_before b join pg_class c on c.oid = b.t::regclass
                where c.relacl::text is distinct from b.acl
                   or (select string_agg(a.attname || '=' || a.attacl::text, ';' order by a.attname)
                       from pg_attribute a where a.attrelid = c.oid and a.attacl is not null) is distinct from b.col_acl) then
    raise exception 'post-condition failed: orders / payment_attempts / auction_wins / admin_sessions privileges changed';
  end if;
end $$;
