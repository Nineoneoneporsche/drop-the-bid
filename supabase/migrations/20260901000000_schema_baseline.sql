-- Pre-history schema baseline — FRESH DATABASE BOOTSTRAP ONLY.
--
-- Recreates the five tables that predate this repo's migration chain
-- (game_state, participants, chat_messages, orders, profiles) as they had to
-- exist right before 20260902120000_drop_zones.sql. Derived from the
-- Production catalog snapshot (inv_00, 2026-10-26) minus everything a later
-- migration adds or changes: replaying this file + every migration in order
-- reproduces Production's current public schema.
--
-- DO NOT run this by hand against Production or any existing database.
-- Production already has this schema (it was built in the SQL Editor and has
-- no migration history table), so the guard below fails closed there: it
-- aborts before changing anything if any of the five tables exist.
--
-- DO NOT `supabase db push` to Production until its migration history has
-- been reconciled (a separate task). With an empty history the CLI would try
-- to replay the whole chain onto the live database.
--
-- Deliberately not here:
--   * Table privileges. Production's came from the project's default ACL at
--     creation time; the explicit Data API GRANT migration at the end of the
--     chain states them for every table, so this file grants nothing.
--   * Supabase platform state: roles, the auth schema, extensions, default
--     privileges, the supabase_realtime publication itself.

begin;

do $$
declare
  v_existing text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into v_existing
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('game_state', 'participants', 'chat_messages', 'orders', 'profiles');
  if v_existing is not null then
    raise exception 'schema baseline refused: public.% already exist(s) — this file is for empty databases only', v_existing;
  end if;
  if to_regclass('auth.users') is null then
    raise exception 'schema baseline refused: auth.users missing — run on a Supabase database';
  end if;
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'schema baseline refused: publication supabase_realtime missing';
  end if;
end $$;

-- ── game_state: singleton auction state ─────────────────────────────────────
-- 13 of Production's 28 columns, in Production's column order; the other 15
-- and the drop-zone / interval / floor CHECKs come from 0902120000 … 0921100000.
create table public.game_state (
  id                  integer not null default 1,
  phase               text not null default 'waiting',
  strategy_started_at timestamptz,
  game_started_at     timestamptz,
  product_name        text not null default 'Apple iPad Air 11형 Wi-Fi 128GB',
  start_price         integer not null default 899000,
  drop_amount         integer not null default 1000,
  minimum_price       integer not null default 550000,
  strategy_duration   integer not null default 60,
  winner_id           uuid,
  winner_nickname     text,
  winner_price        integer,
  scheduled_start_at  timestamptz,
  constraint game_state_pkey primary key (id),
  constraint single_row check (id = 1)
);

-- The one row every function reads (where id = 1), built from the defaults
-- above — a fresh waiting state, never a copy of Production's live row.
-- Later migrations ALTER it in place; their new columns take their defaults.
insert into public.game_state (id) values (1);

-- ── participants: one row per connected auth.uid() ──────────────────────────
-- No RLS or policies yet: 20260910170000 enables RLS and adds all three.
create table public.participants (
  guest_id  uuid not null default gen_random_uuid(),
  nickname  text not null,
  role      text not null default 'spectator',
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  constraint participants_pkey primary key (guest_id)
);

-- ── chat_messages ───────────────────────────────────────────────────────────
create table public.chat_messages (
  id         uuid not null default gen_random_uuid(),
  guest_id   uuid,
  nickname   text not null,
  message    text not null,
  kind       text not null default 'chat',
  created_at timestamptz not null default now(),
  constraint chat_messages_pkey primary key (id),
  constraint chat_messages_guest_id_fkey foreign key (guest_id)
    references public.participants (guest_id) on delete set null
);

-- ── orders ──────────────────────────────────────────────────────────────────
-- user_id starts NOT NULL with ON DELETE CASCADE: 20260911120000 relaxes both
-- (SET NULL) and adds winner_id; 20261006100000 adds the shipping snapshot.
create table public.orders (
  id           uuid not null default gen_random_uuid(),
  user_id      uuid not null,
  product_name text not null,
  amount       integer not null,
  order_id     text not null,
  payment_key  text,
  created_at   timestamptz default now(),
  constraint orders_pkey primary key (id),
  constraint orders_order_id_key unique (order_id),
  constraint orders_user_id_fkey foreign key (user_id)
    references auth.users (id) on delete cascade
);

-- ── profiles ────────────────────────────────────────────────────────────────
create table public.profiles (
  id       uuid not null,
  nickname text not null,
  constraint profiles_pkey primary key (id),
  constraint profiles_nickname_key unique (nickname),
  constraint profiles_id_fkey foreign key (id)
    references auth.users (id) on delete cascade
);

-- ── RLS and the dashboard-created policies that predate the chain ───────────
alter table public.game_state enable row level security;
create policy "read game_state" on public.game_state for select using (true);
create policy "update game_state" on public.game_state for update using (true);

alter table public.chat_messages enable row level security;
create policy "read chat" on public.chat_messages for select using (true);
create policy "insert chat" on public.chat_messages for insert with check (true);
create policy "delete chat" on public.chat_messages for delete using (true);

alter table public.orders enable row level security;
create policy "본인 주문만 조회" on public.orders for select using (auth.uid() = user_id);
-- The original INSERT policy's name was never recorded. 20260910170000 drops
-- it by looping over pg_policies for every cmd = 'INSERT' policy on orders,
-- not by name, so any name is removed there and none survives the chain.
create policy "orders insert own" on public.orders for insert with check (auth.uid() = user_id);

alter table public.profiles enable row level security;
create policy "닉네임 조회" on public.profiles for select using (true);
create policy "본인 프로필 등록" on public.profiles for insert with check (auth.uid() = id);
create policy "본인 프로필 수정" on public.profiles for update using (auth.uid() = id);

-- ── Realtime ────────────────────────────────────────────────────────────────
alter publication supabase_realtime
  add table public.game_state, public.participants, public.chat_messages;

commit;
