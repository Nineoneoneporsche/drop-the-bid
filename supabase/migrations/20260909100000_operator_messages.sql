-- Admin-configurable "operator" chat messages: a chosen nickname + a free
-- list of {threshold %, message} pairs, fired once each in strategy/game
-- chat the first time the displayed price drops to/below that % of
-- startPrice. Not fixed to 10%-steps — the admin can add/remove/re-space
-- thresholds from the admin page without a code or migration change.
--
-- Run this manually in the Supabase SQL Editor (Database > SQL Editor).

begin;

alter table public.game_state
  add column if not exists operator_nickname text not null default '운영자',
  add column if not exists operator_messages jsonb not null default '[
    {"threshold": 90, "message": ""},
    {"threshold": 80, "message": ""},
    {"threshold": 70, "message": ""},
    {"threshold": 60, "message": ""},
    {"threshold": 50, "message": ""},
    {"threshold": 40, "message": ""},
    {"threshold": 30, "message": ""},
    {"threshold": 20, "message": ""},
    {"threshold": 10, "message": ""}
  ]'::jsonb;

commit;
