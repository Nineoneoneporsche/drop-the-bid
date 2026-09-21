-- Second bug found while testing the previous fix: admin_reset_game()
-- never resets is_paused/paused_at/paused_total_ms/pause_reason, so a
-- past pause incident's accumulated paused_total_ms silently survives
-- every reset afterward. The next round then starts with a fresh
-- game_started_at but a stale multi-hour paused_total_ms still subtracted
-- from its elapsed time in claim_winner()'s price calc — driving elapsed
-- seconds deeply negative and the computed price well *above* start_price
-- instead of dropping normally.
--
-- Run this manually in the Supabase SQL Editor (Database > SQL Editor).

begin;

create or replace function public.admin_reset_game()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from chat_messages where true;
  delete from participants where true;
  update game_state set
    phase = 'waiting',
    strategy_started_at = null,
    game_started_at = null,
    winner_id = null,
    winner_nickname = null,
    winner_price = null,
    winner_claimed_at = null,
    is_paused = false,
    paused_at = null,
    paused_total_ms = 0,
    pause_reason = null
  where id = 1;
end;
$$;

-- Fix the currently-live row directly — it was reset just now with the
-- old buggy version above, so paused_total_ms is still stale.
update public.game_state
set is_paused = false,
    paused_at = null,
    paused_total_ms = 0,
    pause_reason = null
where id = 1;

commit;
