# DTB Session Snapshot

Generated: 2026-11-19 15:28:07 +0900

## Git

```text
branch: preview/pg-readiness
head: c1610681b34d347edab19eec259b25ead7db2262

[status]
 M DTB_CURRENT_STATE.md
 M DTB_SESSION_SNAPSHOT.md
?? public/Gemini_Generated_Image_pae8kxpae8kxpae8.png
?? "public/\354\232\260\354\243\274\353\225\205\354\275\251.PNG"

[recent commits]
c161068 (HEAD -> preview/pg-readiness, origin/preview/pg-readiness) Review drop: listed reviewer accounts may join a live round
119999e (origin/main, origin/HEAD) Fix business number (444-74); pay button reaches click with no gateway
851ecaf DTB state: Kakao Pay 1st application received
4bc37fb DTB state: PG status, Kakao Pay application, catalog and guide changes
b4caa5b Guide slides 3/6 recaptioned; footer drop-format blurb removed
7feb97a 드랍 일정: remove Apple Watch Series 11 (discontinued at Apple Korea)
452402d 드랍 일정: fill 상품정보 제공고시 (KC, 제조국, 크기·무게) for iPad Air, AirPods Pro 3, Airwrap
3e608bd Service name in Korean only: 드랍더비드 (no "Drop The Bid")
5b0e465 Home art: finalmainimage.png replaces main.png; new OG image; slides recaptured
5c33165 Remove gavel video and unused assets; neutral share image and meta copy
```

## Changed files vs HEAD

```text
M	DTB_CURRENT_STATE.md
M	DTB_SESSION_SNAPSHOT.md
```

## Environment variable names only

> Values are intentionally excluded.

```text
[.env.local]
ADMIN_PASSWORD
NEXT_PUBLIC_KAKAO_JAVASCRIPT_KEY
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_TURNSTILE_SITE_KEY
SUPABASE_SERVICE_ROLE_KEY
TURNSTILE_SECRET_KEY

```

## Supabase migration files

```text
supabase/migrations/20260901000000_schema_baseline.sql
supabase/migrations/20260902120000_drop_zones.sql
supabase/migrations/20260902130000_drop_interval.sql
supabase/migrations/20260903100000_per_zone_drop_interval.sql
supabase/migrations/20260904090000_floor_below_start_check.sql
supabase/migrations/20260904100000_fractional_drop_interval.sql
supabase/migrations/20260909100000_operator_messages.sql
supabase/migrations/20260910090000_server_clock_sync.sql
supabase/migrations/20260910100000_identity_phase1.sql
supabase/migrations/20260910110000_identity_phase2_claim_winner.sql
supabase/migrations/20260910120000_payment_attempts.sql
supabase/migrations/20260910130000_chat_security.sql
supabase/migrations/20260910140000_admin_security.sql
supabase/migrations/20260910150000_game_transition_security.sql
supabase/migrations/20260910170000_final_rls_lockdown.sql
supabase/migrations/20260911100000_phase8_operational_reliability.sql
supabase/migrations/20260911110000_drop_legacy_calc_drop_price.sql
supabase/migrations/20260911120000_orders_survive_account_deletion.sql
supabase/migrations/20260917100000_fail_closed_pause.sql
supabase/migrations/20260921100000_anti_multi_account.sql
supabase/migrations/20260921120000_fix_stale_lease_false_pause.sql
supabase/migrations/20260921130000_fix_reset_game_pause_fields.sql
supabase/migrations/20261006100000_orders_shipping_snapshot.sql
supabase/migrations/20261007100000_one_active_payment_per_win.sql
supabase/migrations/20261008100000_block_reset_of_payable_win.sql
supabase/migrations/20261014100000_one_session_per_account_round.sql
supabase/migrations/20261022100000_reset_clears_pause_fields.sql
supabase/migrations/20261026100000_reconcile_send_chat_message.sql
supabase/migrations/20261027100000_drop_orphan_calc_drop_price.sql
supabase/migrations/20261027110000_explicit_data_api_grants.sql
supabase/migrations/20261028150000_auction_wins.sql
supabase/migrations/20261029100000_reset_game_uses_auction_wins.sql
supabase/migrations/20261030100000_scheduled_start_join_window.sql
supabase/migrations/20261030200000_payment_confirm_safety.sql
supabase/migrations/20261104100000_payment_cancellations.sql
supabase/migrations/20261119100000_review_account_live_join.sql
```

## TODO

- Update DTB_CURRENT_STATE.md before ending the session.
- Record durable decisions in DTB_DECISION_LOG.md.
- Never paste secrets into this snapshot.
