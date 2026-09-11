-- Cleanup: drops the orphaned 9-parameter calc_drop_price() overload from
-- 20260902130000_drop_interval.sql. It was superseded by the 11-parameter
-- version (per-zone numeric intervals) in 20260904100000_fractional_drop_interval.sql
-- and 20260903100000_per_zone_drop_interval.sql, but the old signature was
-- never explicitly dropped — Postgres treats a different parameter list as
-- a distinct function, so `create or replace` never touched it.
--
-- No risk change: Phase 7 (20260910170000_final_rls_lockdown.sql) already
-- revoked EXECUTE on both overloads from public/anon/authenticated, so
-- this overload has been uncallable by any client role since then. This
-- migration just removes the dead object itself.
--
-- Run this manually in the Supabase SQL Editor (Database > SQL Editor).

begin;

drop function if exists public.calc_drop_price(
  numeric, integer, integer, integer, integer, integer, integer, integer, integer
);

commit;
