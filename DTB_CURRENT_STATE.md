# DTB Current State

Last updated: 2026-11-09
Status owner: update at every meaningful development session

---

## 0. 저장소 체크포인트

- GitHub 저장소: `Nineoneoneporsche/drop-the-bid`
- 기본 브랜치: `main`
- 연속성 시스템은 코드 커밋 `0be30ad9d408d348dc19c1462a98470d9b19a298`을 기준으로 처음 구축했다.
- 연속성 문서는 커밋 `edd567054399a63daccf320dd407acac3b19353a`을 통해 `main`에 최초 반영되었다.
- 검토용 브랜치 `chore/dtb-context-continuity`는 감사 추적용으로 유지한다.
- 2026-11-06 확인 당시 GitHub 저장소 공개 범위는 `public`이었다.

중요: **이 문서에 적힌 SHA를 현재 HEAD로 간주하지 않는다.** 새 개발 세션을 시작할 때마다 실제 브랜치/HEAD/status를 먼저 확인한다. 로컬 작업 트리는 GitHub보다 앞서 있을 수도 있다.

---

## A. Login failure / Supabase Auth redirect issue — CLOSED

상태: `CLOSED` (2026-11-06 해결)

증상:

- Production / Preview에서 소셜 로그인 후 `http://localhost:3000/#access_token=...`으로 이동

해결 내용:

- Supabase Site URL을 잠시 다른 값으로 변경
- 다시 `https://dropthebid.com`으로 원복
- 몇 분 뒤 로그인 재테스트
- 정상 동작 확인 (runtime probe에서 Production/Preview callback, reset-password 모두 정상 redirect, 미허용 URL은 `https://dropthebid.com`으로 fallback)
- 앱 코드 변경 없음

원인:

- 근본 원인 확정 아님
- Supabase Dashboard / Management API에는 정상 설정이 보였는데 실제 Auth runtime redirect가 이전 상태(Site URL `localhost:3000`, allow-list 미적용)처럼 동작했던 정황
- 따라서 Supabase Auth stale config 또는 설정 propagation 지연 가능성이 높음
- 앱 코드(redirectTo = `window.location.origin` + `/auth/callback`), Production bundle의 Supabase project, Google/Kakao provider 단계는 모두 정상으로 확인됨

재발 시 무작정 Auth 설정이나 앱 코드를 수정하기 전에:

1. 현재 Site URL / redirect allow-list 확인
2. 필요 시 Site URL 재저장 또는 값 변경→원복
3. 수 분 기다린 뒤 재테스트

순서로 확인한다. 실제 runtime 동작은 로그인 없이 READ-only로 확인할 수 있다:
`GET <SUPABASE_URL>/auth/v1/verify?type=signup&token=<invalid>&redirect_to=<url>` → 303 Location이 `<url>`이면 허용, 아니면 Site URL로 fallback.

후속 정리(긴급 아님):

- Redirect URLs에서 `http://localhost:3000/auth/callback` 제거
- 사용하지 않는 옛 Preview URL(`drop-the-bg837xet0…`, `drop-the-h2rl5y7mo…`) 제거
- `www.dropthebid.com` DNS 미연결 (별개 이슈)

---

## B. Current development branch state

- branch: `preview/m4a-payment-safety`
- HEAD: `ed9c842` (Merge remote-tracking branch 'origin/main' into preview/m4a-payment-safety)
- origin/main(`8754020`) merge 완료
- merge 충돌 없음
- working tree clean

### M4 commits in this branch

- `35701fb` Harden Toss payment confirmation
- `40a5a13` Fix reconciliation payment recheck flow
- `9e9116a` Add payment reconciliation recheck flow
- `3a74bdf` Add durable payment cancellation ledger
- `f9c412e` Add admin payment refund management

### Verification (2026-11-09, at `ed9c842`)

- `npm test`: **31 files / 1071 tests PASS**
- `npm run build`: **PASS**
- build output: **38 pages**
- 오류/경고 없음
- 검증 후 working tree clean

### Production DB state

이미 적용 완료:

- `20261030200000_payment_confirm_safety` — M4-A
- `20261104100000_payment_cancellations` — M4-B1

마지막 확인된 migration history 최신값: `20261104100000`

중요:

- Production DB는 M4 DB 변경까지 반영되어 있음
- Production app의 main은 아직 M4 app code가 반영되지 않은 상태
- 따라서 Preview smoke 검증 이후 app code와 Production DB 상태를 맞추는 것이 중요한 launch-critical 작업임
- `supabase db push`, `migration repair`, SQL Editor 실행은 별도 승인 없이 하지 않는다

### Git 주의사항

- local main: `35701fb`
- origin/main: `8754020`
- 서로 다름
- **local main에서 push 금지**
- 이후 push는 반드시 현재 Preview branch를 명시적으로 대상으로 한다: `git push origin HEAD:preview/m4a-payment-safety`

---

## C. Recently confirmed platform state

- Production domain: `https://dropthebid.com`
- Supabase ref: `ivnoxbsqzeodnoouqped`
- Production / linked project identity 검증은 통과
- custom domain 연결 이후 Supabase Site URL/redirect 및 OAuth 설정을 갱신해 온 이력이 있음

---

## D. Remote-main development state worth preserving

Recent verified remote commits include:

- `0be30ad` — scheduled auction start / configurable participant join lead window
- `a62c74e` — game reset uses durable win ledger
- `55dd3da` — payment flow uses durable win IDs
- `eddb9ea` — durable `auction_wins` ledger
- `29f53b0` — ignore local Supabase CLI state
- `ca7572d`, `19db69e` — reproducible Supabase baseline / explicit Data API grants
- `db848f2` — reset pause fields for new round
- `0a0ed29` — payment confirmation auth-session recovery
- `d375e52` — block reset from erasing a payable win
- `ab8d9fe` — double-payment guard / payment recovery UX

The exact Production application state of any migration must be verified from Production or an authoritative deployment checkpoint; commit presence alone is not proof of application.

The latest remote main includes a scheduled-start participation model with a configurable join lead window. Do **not** treat the old fixed 1-minute strategy-phase behavior as current without checking the code/Production state.

---

## E. Historical auth/entry changes

Past work known from earlier development sessions includes:

- entry redirect race handling
- `isLoaded` redirect guard
- `sessionStorage` `dtb_joining` guard
- historical reference commit: `fbb9911`
- historical Supabase endpoint/env verification work
- historical reference commit: `f66d454`
- Vercel Production/Preview env omission + redeploy history
- Realtime publication / resynchronization issues

These historical references must be validated against current Git history/code before being used as an explanation for any future regression.

---

## F. DB / migration / security work

Known project principles/state:

- Production migration baseline/history reconciliation has been an explicit workstream.
- Some migrations exist to make a fresh replay reproducible and must **not** be blindly re-executed on Production.
- `auction_wins` is the durable win ledger in current remote main.
- reset/payment logic now depends on durable win identity and payment-safety invariants.
- `service_role` remains server-only.

---

## G. Payment

Historical verified test flow includes Toss approval → server confirmation → order creation → success page.

Current remote main includes multiple payment hardening commits (payment window enforcement, shipping snapshot, double-payment prevention, stale-session recovery, durable win IDs). The M4 branch (section B) adds confirm safety, reconciliation recheck, the cancellation ledger and admin full refund.

Launch-critical checks can still include:

- live key/MID and live access policy
- reconciliation behavior
- Production smoke / cancel path
- exact migration deployment status

---

## H. Security reminders

- `service_role` is server-only.
- Never store secrets in continuity docs.
- `.env.local` is ignored in remote main as of 2026-11-06.
- The GitHub repository was observed as **public** on 2026-11-06; treat every committed value as publicly visible.
- Historical key exposure/rotation work should be revalidated before launch.
- Toss TEST access policy had a temporary Korea + U.S. allowance because of Vercel Preview egress; production/live policy must be reviewed separately before launch.

---

## I. Deferred / follow-up reminders

- Distinguish the now-implemented configurable scheduled join lead from any future UX refinements to entry scheduling.
- Revisit any paused GRANT/baseline work only after confirming the exact Production migration state; do not infer it from chat memory.
- Before live launch, re-check Toss TEST temporary access policy and live-key access policy.
- M4 deferred: customer MyPage refund display, cancel POST resend, partial refund, webhook.

---

## J. Next action

Current next action is **M4 Preview smoke → Production app/DB alignment**.

Recommended order:

1. push `preview/m4a-payment-safety` and confirm the Vercel Preview build
2. Preview smoke: win → payment → confirm → admin full refund (reason + 2-step confirm) → refund done; pending / recheck paths
3. Production `supabase migration list --linked` (READ-only) to reconfirm history
4. merge to main and Production deploy only with explicit approval
5. Production smoke (login, payment, refund)
6. update this file and create a session checkpoint
