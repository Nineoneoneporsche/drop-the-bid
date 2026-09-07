-- Moves every auction-timing anchor off client clocks and onto the DB
-- server's own clock, so the client no longer trusts its own Date.now()
-- for anything that has to agree across devices.
--
-- Two new RPCs:
--   server_now()  — returns the server's current timestamp, for clients to
--                    measure client/server clock offset against (see
--                    app/lib/serverClock.ts).
--   start_game()  — atomically flips phase 'strategy' -> 'game' and stamps
--                    game_started_at with the server's own now(), replacing
--                    the two client-side `.update({ game_started_at: new
--                    Date().toISOString() }).eq("phase","strategy")` calls
--                    (admin "바로시작" and the strategy-duration auto
--                    transition) that used to do this. The `where phase =
--                    'strategy'` guard is still a single atomic UPDATE, so
--                    it keeps the exact same "exactly one caller wins even
--                    under concurrent requests" property those had — this
--                    is just that UPDATE moved into a function so the
--                    timestamp it writes is `now()` instead of a value the
--                    caller supplies.
--
-- Run this manually in the Supabase SQL Editor (Database > SQL Editor).

begin;

create or replace function public.server_now()
returns timestamptz
language sql
stable
as $$
  select now();
$$;

create or replace function public.start_game()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated int;
begin
  update game_state
  set phase = 'game', game_started_at = now()
  where id = 1 and phase = 'strategy';

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

commit;
