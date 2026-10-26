-- Drops the 8-argument calc_drop_price overload created by
-- 20260902120000_drop_zones.sql. 20260902130000 replaced it with a new
-- signature instead of altering it, and no repo migration ever dropped it
-- (20260911110000 only dropped the 9-argument one). Production does not have
-- it — it was removed there by hand — so this is a no-op on Production and
-- only removes the orphan from databases built by replaying the migrations.
-- Nothing calls it: claim_winner() uses the 11-argument version.
--
-- NOT APPLIED TO PRODUCTION (decided 2026-10-26): it would be a no-op there.
-- It runs only as part of a fresh replay of the migration chain.

begin;

drop function if exists public.calc_drop_price(
  numeric, integer, integer, integer, integer, integer, integer, integer
);

do $$
begin
  if to_regprocedure('public.calc_drop_price(numeric, integer, integer, integer, integer, integer, integer, integer)') is not null then
    raise exception 'calc_drop_price 8-argument overload still exists';
  end if;
  if to_regprocedure('public.calc_drop_price(numeric, integer, integer, integer, integer, integer, integer, integer, numeric, numeric, numeric)') is null then
    raise exception 'calc_drop_price 11-argument overload is missing — refusing to continue';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'calc_drop_price') <> 1 then
    raise exception 'unexpected calc_drop_price overloads remain';
  end if;
end $$;

commit;
