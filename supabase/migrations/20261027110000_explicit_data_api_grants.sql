-- Explicit Data API privileges for every public table and function.
--
-- Since 2026-10-30, new Supabase projects no longer grant public objects to
-- anon / authenticated / service_role by default. Production got its current
-- privileges from the old default ACL at creation time, so a database built
-- from these migrations alone would lack them. This file states Production's
-- exact current object privileges (catalog snapshot inv_00, 2026-10-26).
--
-- GRANT only — no REVOKE. On Production every statement is a no-op. Some of
-- these privileges are broader than the app needs (e.g. anon on
-- device_round_guard / participant_verifications / service_health, which RLS
-- with no policies already blocks); narrowing them is a separate hardening
-- step, deliberately not mixed in here.
--
-- NOT APPLIED TO PRODUCTION (decided 2026-10-26): every grant already
-- exists there. It runs only as part of a fresh replay of the migration chain.
--
-- Every new public table or function from now on must state its own grants
-- in the migration that creates it.

begin;

grant select, insert, update, delete, truncate, references, trigger, maintain on table public.account_round_guard to service_role;
grant select, insert, update, delete, truncate, references, trigger, maintain on table public.admin_login_attempts to service_role;
grant select, insert, update, delete, truncate, references, trigger, maintain on table public.admin_sessions to service_role;
grant select, truncate, references, trigger, maintain on table public.chat_messages to anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger, maintain on table public.chat_messages to service_role;
grant select, insert, update, delete, truncate, references, trigger, maintain on table public.device_round_guard to anon, authenticated, service_role;
grant select, truncate, references, trigger, maintain on table public.game_state to anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger, maintain on table public.game_state to service_role;
grant select, update, delete, truncate, references, trigger, maintain on table public.orders to anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger, maintain on table public.orders to service_role;
grant select, insert, update, delete, truncate, references, trigger, maintain on table public.participant_verifications to anon, authenticated, service_role;
grant select, delete, truncate, references, trigger, maintain on table public.participants to anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger, maintain on table public.participants to service_role;
grant update (last_seen) on table public.participants to anon;
grant update (last_seen) on table public.participants to authenticated;
grant select, insert, update, delete, truncate, references, trigger, maintain on table public.payment_attempts to service_role;
grant select, insert, update, delete, truncate, references, trigger, maintain on table public.profiles to anon, authenticated, service_role;
grant select, insert, update, delete, truncate, references, trigger, maintain on table public.service_health to anon, authenticated, service_role;

grant execute on function public.admin_force_start_game() to service_role;
grant execute on function public.admin_login_gate(text) to service_role;
grant execute on function public.admin_login_mark_success(uuid) to service_role;
grant execute on function public.admin_reset_game() to service_role;
grant execute on function public.calc_drop_price(numeric,integer,integer,integer,integer,integer,integer,integer,numeric,numeric,numeric) to service_role;
grant execute on function public.claim_winner() to anon, authenticated, service_role;
grant execute on function public.cleanup_stale_participants() to anon, authenticated, service_role;
grant execute on function public.join_game(text,text) to anon, authenticated, service_role;
grant execute on function public.join_game_participant(uuid,text,text,uuid) to service_role;
grant execute on function public.pause_game(text) to service_role;
grant execute on function public.resume_game() to service_role;
grant execute on function public.send_chat_message(text) to anon, authenticated, service_role;
grant execute on function public.server_now() to anon, authenticated, service_role;
grant execute on function public.start_game() to anon, authenticated, service_role;
grant execute on function public.touch_health_lease() to service_role;
grant execute on function public.touch_participant_session() to authenticated, service_role;

commit;
