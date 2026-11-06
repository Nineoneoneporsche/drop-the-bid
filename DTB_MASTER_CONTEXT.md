# DTB Master Context

> 목적: 거의 변하지 않는 프로젝트 기준 정보를 보관한다.
> 실제 코드/DB가 이 문서와 다르면 실제 상태가 우선이며 문서를 갱신한다.

## Product
DTB (Drop The Bid / 드더비)는 실시간 역경매형 모바일 웹 서비스다.

- 가격이 실시간 하락
- 먼저 낙찰 버튼을 누른 1인이 낙찰
- 참가자 / 관전자
- 실시간 채팅
- Drop Zone: NORMAL → FAST → FINAL
- 낙찰 연출 및 Winner 화면
- 결제 및 미결제 처리

## Core stack
- Next.js 15 / App Router
- Supabase
  - Postgres
  - Auth
  - Realtime
  - RPC
  - RLS
- Vercel
- GitHub
- Toss Payments

## Known production identifiers
- Production custom domain: `https://dropthebid.com`
- Supabase project ref currently associated with DTB: `ivnoxbsqzeodnoouqped`
- 위 ref는 secret이 아니지만, 실제 작업 전 현재 repo/env와 다시 일치하는지 확인한다.

## Security principles
- Browser: anon/public key only
- `service_role`: server-only route에서만 사용
- 결제 승인/계정삭제 같은 privileged 작업은 server route에서 처리
- key 노출 이력이 있으면 rotate 여부를 문서에 명시
- Auth / Payment / Admin 관련 변경은 fail-closed 우선

## Auction principles
- winner 결정은 서버/RPC가 authoritative
- 가격, winner, status, 자격 검증은 가능한 한 원자적으로 처리
- race condition 방지를 위해 DB lock / RPC 사용
- 클라이언트 표시 가격은 낙찰 authoritative price가 아님

## Payment principles
- 낙찰 가격의 immutable source는 DB의 낙찰 기록을 사용
- 브라우저에서 전달된 금액을 authoritative amount로 신뢰하지 않음
- Toss 인증 제한과 DTB 자체 결제 마감은 별개
- paymentKey/secret/Toss 원문 오류는 클라이언트에 그대로 노출하지 않음
- reconciliation 경로를 별도로 둔다

## Realtime / availability
- Realtime disconnect 이후 재동기화가 필요할 수 있음
- health lease / fail-closed pause 구조를 사용
- 장애 상태에서 낙찰 진행을 허용하는 것보다 일시정지를 우선

## Auth principles
- Google/Kakao OAuth
- Production callback/reset URL과 Preview URL을 Supabase allow list에 관리
- custom domain과 Supabase callback URL을 혼동하지 않음
- OAuth provider callback과 앱 최종 redirect는 별개의 단계

## Known historical work
아래는 과거 개발 흐름에서 중요했던 항목이며, 현재 코드에 남아있는지 실제 repo로 확인한다.

- `claim_winner()` server-side winner arbitration
- `pause_game()`
- `resume_game()`
- `touch_health_lease()`
- `admin_reset_game()`
- `game_state`
- `participants`
- `chat_messages`
- `auction_wins`
- payment confirmation server route
- account deletion server route

## Deferred / later items
현재 launch-critical 작업보다 뒤로 미뤄진 것으로 알려진 항목:

- scheduled-start entry UX refinements beyond the configurable join-lead implementation already present in remote main
- 일부 Winner UX polish
- 동적 OG / 추가 공유 기능
- launch 전 Toss live access policy 재검토

이 목록은 `DTB_CURRENT_STATE.md`가 우선한다.
