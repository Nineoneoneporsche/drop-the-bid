# DTB Session Snapshot

Generated: 2026-11-09 14:14:47 +0900

## Git

```text
branch: preview/pg-readiness
head: 87410830acaa267353e9f7bcc98bfc6e502bb1ee

[status]
 M DTB_CURRENT_STATE.md
 M DTB_SESSION_SNAPSHOT.md
 M app/api/join/participant/route.ts
 M app/api/payment/confirm/route.ts
 M app/components/PaymentReviewList.tsx
 M app/components/PendingWinBanner.tsx
 M app/components/RightActionMenu.tsx
 M app/join/page.tsx
 M app/layout.tsx
 M app/lib/auctionSchedule.ts
 M app/lib/paymentCodes.ts
 M app/lib/paymentReview.ts
 M app/mini-game/page.tsx
 M app/mypage/page.tsx
 M app/page.tsx
 M app/payment/page.tsx
 M app/payment/success/page.tsx
 M app/practice/page.tsx
 M app/signup/page.tsx
 M app/strategy/page.tsx
 M tests/auctionSchedule.test.ts
 M tests/joinParticipantRoute.test.ts
 M tests/paymentConfirm.test.ts
?? app/components/LegalDocument.tsx
?? app/components/SiteFooter.tsx
?? app/lib/businessInfo.ts
?? app/lib/legal.ts
?? app/privacy/
?? app/refund/
?? app/terms/
?? tests/pgReadiness.test.ts

[recent commits]
8741083 (HEAD -> preview/pg-readiness, origin/preview/m4a-payment-safety, preview/m4a-payment-safety) docs: M4 결제 안전성 작업 상태 체크포인트
ed9c842 Merge remote-tracking branch 'origin/main' into preview/m4a-payment-safety
8754020 (origin/main, origin/HEAD) 연속성 시스템 병합 후 저장소 체크포인트 문구 정리
edd5670 (origin/chore/dtb-context-continuity) Add DTB development continuity context
f9c412e Add admin payment refund management
3a74bdf Add durable payment cancellation ledger
9e9116a Add payment reconciliation recheck flow
40a5a13 Fix reconciliation payment recheck flow
35701fb (main) Harden Toss payment confirmation
0be30ad Use scheduled auction start for participation
```

## Changed files vs HEAD

```text
M	DTB_CURRENT_STATE.md
M	DTB_SESSION_SNAPSHOT.md
M	app/api/join/participant/route.ts
M	app/api/payment/confirm/route.ts
M	app/components/PaymentReviewList.tsx
M	app/components/PendingWinBanner.tsx
M	app/components/RightActionMenu.tsx
M	app/join/page.tsx
M	app/layout.tsx
M	app/lib/auctionSchedule.ts
M	app/lib/paymentCodes.ts
M	app/lib/paymentReview.ts
M	app/mini-game/page.tsx
M	app/mypage/page.tsx
M	app/page.tsx
M	app/payment/page.tsx
M	app/payment/success/page.tsx
M	app/practice/page.tsx
M	app/signup/page.tsx
M	app/strategy/page.tsx
M	tests/auctionSchedule.test.ts
M	tests/joinParticipantRoute.test.ts
M	tests/paymentConfirm.test.ts
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
```

## TODO

- Update DTB_CURRENT_STATE.md before ending the session.
- Record durable decisions in DTB_DECISION_LOG.md.
- Never paste secrets into this snapshot.
