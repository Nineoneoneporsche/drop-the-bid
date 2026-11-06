# DTB Current State

Last updated: 2026-11-06
Status owner: update at every meaningful development session

---

## 0. Repository checkpoint

- GitHub repository: `Nineoneoneporsche/drop-the-bid`
- Remote default branch: `main`
- Remote `main` HEAD verified on 2026-11-06: `0be30ad9d408d348dc19c1462a98470d9b19a298`
- HEAD message: `Use scheduled auction start for participation`
- Continuity setup branch: `chore/dtb-context-continuity`
- GitHub repository visibility observed on 2026-11-06: `public`

Important: a developer's local working tree can be ahead of GitHub. Before any change, compare local HEAD/status with this checkpoint rather than assuming remote `main` is the newest work.

---

## A. Current top-priority issue

### Login failure / Supabase Auth redirect issue — OPEN

현재 로그인 문제는 **해결되지 않았다**.

확인 완료:

- 실제 DTB Supabase project ref와 local app ref가 일치하는 것으로 확인됨
- Management API READ-only 조회 성공
- `site_url = https://dropthebid.com`
- Production `/auth/callback` allow-list 존재
- Production `/reset-password` allow-list 존재
- Vercel Preview callback/reset entries 존재
- localhost allow-list entry 1개 존재
- `linked ref == app(.env.local) ref: true`

따라서 현재 배제된 가설:

- ❌ 엉뚱한 Supabase 프로젝트를 보고 있어서 생긴 문제
- ❌ Supabase Site URL 자체가 localhost로 설정돼 있어서 생긴 문제

아직 확인할 것:

1. 실제 브라우저 로그인 순간 `/auth/v1/authorize` 요청이 어느 project ref로 가는지
2. 실제 `redirect_to` 값
3. Production Vercel bundle이 현재 env/config를 실제로 사용하는지
4. 최근 login/auth 관련 code diff에서 regression이 생겼는지
5. Google/Kakao provider 설정과 앱 callback 처리 사이의 regression 여부

**주의:** Auth 설정을 추측으로 바꾸지 않는다.

---

## B. Recently confirmed platform state

- Production domain: `https://dropthebid.com`
- Supabase ref: `ivnoxbsqzeodnoouqped`
- Production / linked project identity 검증은 통과
- custom domain 연결 이후 Supabase Site URL/redirect 및 OAuth 설정을 갱신해 온 이력이 있음

---

## C. Remote-main development state worth preserving

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

## D. Historical auth/entry changes worth checking during regression analysis

Past work known from earlier development sessions includes:

- entry redirect race handling
- `isLoaded` redirect guard
- `sessionStorage` `dtb_joining` guard
- historical reference commit: `fbb9911`
- historical Supabase endpoint/env verification work
- historical reference commit: `f66d454`
- Vercel Production/Preview env omission + redeploy history
- Realtime publication / resynchronization issues

These historical references must be validated against current Git history/code before being used as an explanation for today's login regression.

---

## E. DB / migration / security work

Known project principles/state:

- Production migration baseline/history reconciliation has been an explicit workstream.
- Some migrations exist to make a fresh replay reproducible and must **not** be blindly re-executed on Production.
- `auction_wins` is the durable win ledger in current remote main.
- reset/payment logic now depends on durable win identity and payment-safety invariants.
- `service_role` remains server-only.

While the login incident is open, do not change unrelated Production migrations or grants merely to troubleshoot Auth.

---

## F. Payment

Historical verified test flow includes Toss approval → server confirmation → order creation → success page.

Current remote main includes multiple payment hardening commits (payment window enforcement, shipping snapshot, double-payment prevention, stale-session recovery, durable win IDs).

Launch-critical checks can still include:

- live key/MID and live access policy
- reconciliation behavior
- Production smoke / cancel path
- exact migration deployment status

**Do not move the active debugging focus away from the login incident until it is resolved or explicitly deprioritized.**

---

## G. Security reminders

- `service_role` is server-only.
- Never store secrets in continuity docs.
- `.env.local` is ignored in remote main as of 2026-11-06.
- The GitHub repository was observed as **public** on 2026-11-06; treat every committed value as publicly visible.
- Historical key exposure/rotation work should be revalidated before launch.
- Toss TEST access policy had a temporary Korea + U.S. allowance because of Vercel Preview egress; production/live policy must be reviewed separately before launch.

---

## H. Deferred / follow-up reminders

- Distinguish the now-implemented configurable scheduled join lead from any future UX refinements to entry scheduling.
- Revisit any paused GRANT/baseline work only after confirming the exact Production migration state; do not infer it from chat memory.
- Before live launch, re-check Toss TEST temporary access policy and live-key access policy.

---

## I. Next action

Current next action is **login regression root-cause tracing**.

Recommended order:

1. inspect current auth/login code path and recent auth-related diffs
2. capture the actual Production OAuth `/auth/v1/authorize` request project ref + `redirect_to`
3. compare Production Vercel env scope with the code path actually used at build/runtime
4. inspect callback/session exchange and middleware/redirect guards
5. identify the regression before changing settings
6. apply the smallest fix
7. Preview smoke
8. Production deploy
9. Production login smoke
10. update this file and create a session checkpoint
