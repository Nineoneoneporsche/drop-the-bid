# DTB Current State

Last updated: 2026-11-19
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

## P. PG / 결제대행 심사 — 진행 중 (2026-11-19)

- Toss Payments: 2026-11-11 심사 거절("고정 상품·고정 금액"만 가능). 가입비 330,000원 환불 요청 중. Production 결제는 꺼져 있음(`NEXT_PUBLIC_PAYMENT_PROVIDER` 미설정 → none), Toss 코드는 휴면 상태로 유지.
- 카카오페이(독립형 쇼핑몰) 1차 신청: 2026-11-19 접수 완료 (첫 시도는 파트너센터 로그인 만료로 실패, 재로그인 후 접수). 독립형 1차는 신청현황에 안 보이고 결과는 help@dropthebid.com 메일로 옴(약 5영업일). 1차 통과 시 메일 링크로 2차 서류(사업자등록증, 정산계좌, 대표자 신분증) 제출.
- 심사 대비 Production 반영 내역 (main `b4caa5b`):
  - `3e608bd` 영문 "Drop The Bid" 표기 제거, 한글 상호만 사용
  - `452402d` /drops 3개 상품(iPad Air 11 M4, AirPods Pro 3, 다이슨 에어랩 코안다2x) 상품정보 제공고시 전부 채움 (판매처 페이지에서 직접 확인)
  - `7feb97a` 단종 Apple Watch Series 11 카탈로그에서 제거 (3개 상품 = 카카오 최소 조건)
  - `b4caa5b` 이용방법 설명3/설명6 문구 변경, 하단 "실시간 가격하락 딜 방식…" 문구 제거
- 카카오 독립몰 자료 요청 회신 대응 (2026-11-19): 사업자번호 444-74-00462로 정정(`119999e`, 1차 신청서엔 444-64로 잘못 기재 → 회신 시 정정), 결제사 미연동 시 결제하기 클릭 → "결제 연동 준비 중" 안내(`119999e`).
- 심사용 상시 드랍 (`c161068`, preview): migration `20261119100000_review_account_live_join` **미적용** (Owner가 CLI로 적용). review_accounts에 등록된 계정만 진행 중 라운드에 참여 가능. `REVIEW_DROP_MODE`(app/lib/reviewDrop.ts) on. `scripts/review-keepalive.sh`로 auto-pause 방지.
- **PG 연동 후 복원 목록:** ① `docs/archive/guide-slides-pre-kakao/` 슬라이드 복원 여부 ② `REVIEW_DROP_MODE = false` ③ review_accounts 비우기(`supabase/ops/review_accounts.sql`) ④ keep-alive 중지 ⑤ 드랍 가격 설정 원복 ⑥ 결제하기 "연동 준비 중" 경로가 실제 결제로 대체됐는지 확인 ⑦ 하단 "실시간 가격하락 딜 방식…" 문구 복원 여부 ⑧ 필요 시 migration 20261119100000 rollback.
- 원칙: 심사에는 가격 하락·선착순 구조를 정직하게 설명하고, 승인 후 모델을 바꾸지 않는다.

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

## B0. Production 배포 — 2026-11-09 (main = `80399c2`)

- origin/main을 `8754020` → `80399c2`로 fast-forward (M4 결제 안전성 + PG 심사 대비 작업 전체). Vercel Production 배포 성공
- 배포 전 확인: Production migration history 35/35, pending 0 (DB 작업 없음)
- 배포 후 READ-only 확인: 주요 페이지/정책 페이지 200, 예전 경매 이미지 404, 관리자 API 비로그인 401, 번들에 live_sk/test_sk 없음, 경매/낙찰 문구 0, Auth redirect 정상(dropthebid.com/auth/callback)
- **Toss live 키 없음 (Toss 신청 내역 없음)**: M4 fail-closed 정책상 Production 결제창은 열리지 않음 (B안). live 계약 후 Production scope에만 live 키 설정 → 재배포
- 롤백: Vercel Deployments에서 직전 Production 배포(`8754020`)로 Instant Rollback. Redeploy 금지
- local `main`은 여전히 `35701fb` (origin/main과 다름) — local main에서 push 금지

---

## B2. PG 심사 대비 작업 — branch `preview/pg-readiness` (2026-11-09)

- M4 tip(`8741083`)에서 분기. 2026-11-09 main/Production 반영 완료 (B0 참고)
- 사용자 화면 용어: 역경매 → 실시간 가격하락 딜, 경매 → 드랍, 낙찰 → 구매 (관리자 화면·코드 주석은 유지). 마케팅 표현은 추후 재검토
- 공개 페이지 `/terms`, `/privacy`, `/refund` 추가 (본문: `app/lib/legal.ts`, 시행일 2026-11-09)
- 사업자 정보 footer (`app/lib/businessInfo.ts` 한 곳에서 관리): 홈, 마이페이지, 회원가입, 정책 페이지
- 회원가입의 (숨겨져 있던) 카드 입력 단계 삭제
- 회귀 테스트: `tests/pgReadiness.test.ts`
- 남은 일 (사용자):
  - `public/winner-animation.mp4`에 경매 요소가 있는지 확인
- 완료 (2026-11-09):
  - 홈 이미지 `public/main.png`(경매 요소 제거, 테두리 정리), 공유 이미지 `public/og-image-drop.jpg`(새 파일명으로 공유 캐시 회피)
  - 게임/모의훈련 배경 영상 → `StageBackdrop`(main.png + 천천히 움직이는 효과). `newmainimage.png`, `gamepagevideo.mp4`, `og-image.jpg` 삭제
  - 게임방법 슬라이드 `public/설명1~7.png` 재제작: 실제 화면을 백엔드 모킹으로 렌더링(운영 DB 접속 없음), 1번·6번 제목 변경
  - `help@dropthebid.com` 수신: 가비아 DNS에 ImprovMX MX 2개 + SPF TXT 추가, Gmail 전달 확인 (Gmail 필터: 스팸 분류 안 함)

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
