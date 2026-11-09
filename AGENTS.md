# DTB AI Agent Rules

이 저장소에서 작업하는 모든 AI(ChatGPT, Claude Code 등)는 아래 규칙을 따른다.

## 1. 시작 전 필수 읽기
반드시 순서대로 읽는다.

- `DTB_MASTER_CONTEXT.md`
- `DTB_CURRENT_STATE.md`
- `DTB_DECISION_LOG.md`
- `DTB_SESSION_SNAPSHOT.md` (있으면)

읽기 전 코드 수정 금지.

## 2. 기억보다 저장소 우선
이전 채팅에서 기억하는 내용과 현재 코드/문서가 충돌하면 현재 저장소와 Production 검증 결과가 우선이다.

## 3. 이미 끝난 작업 반복 금지
`DTB_CURRENT_STATE.md`에 완료로 표시된 검증이나 수정은 근거 없이 처음부터 반복하지 않는다.
다시 검증할 필요가 있으면 **왜 재검증하는지 먼저 설명**한다.

## 4. Production 안전 규칙
- DB migration, RLS, GRANT, RPC, 결제, Auth 설정은 영향 범위를 먼저 확인한다.
- 수정 전 `local / preview / production` 중 어디를 바꾸는지 명시한다.
- history repair와 실제 SQL 실행을 혼동하지 않는다.
- destructive SQL 금지. 필요하면 사용자 승인 전 실행하지 않는다.
- env/key 값은 출력·문서화하지 않는다.

## 5. 디버깅 규칙
현상 → 이미 확인한 사실 → 배제된 가설 → 남은 가설 → 최소 검증 순서로 진행한다.

추측만으로 설정을 바꾸지 않는다.

## 6. 작업 종료 규칙
의미 있는 작업이 끝나면 반드시:
- `DTB_CURRENT_STATE.md` 업데이트
- 필요 시 `DTB_DECISION_LOG.md` 업데이트
- `./scripts/dtb-checkpoint.sh` 실행
- commit/push/production 반영 여부를 각각 명시

## 7. 새 채팅 handoff
새 채팅에서 사용자가 "DTB 이어서 하자"라고 하면
새 설명을 요구하기 전에 위 문서들을 기준으로 현재 상태를 복원한다.
