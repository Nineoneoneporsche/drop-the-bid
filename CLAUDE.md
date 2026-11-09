# Claude Code — DTB Mandatory Context

Claude Code는 작업 시작 전에 반드시 아래 파일을 읽는다.

1. `AGENTS.md`
2. `DTB_MASTER_CONTEXT.md`
3. `DTB_CURRENT_STATE.md`
4. `DTB_DECISION_LOG.md`
5. `DTB_SESSION_SNAPSHOT.md` (존재 시)

## 첫 응답 형식
코드를 수정하기 전에 아래만 먼저 요약한다.

- 현재 Production 상태
- 현재 미해결 이슈
- 이미 배제된 원인
- 이번 세션에서 확인할 파일/경로
- 수정 없이 먼저 수행할 진단

사용자 승인 없이 광범위 refactor 금지.

## DTB 특수 주의
- Supabase Auth / RLS / RPC / migration history는 서로 다른 층이다.
- Production DB 상태와 migration 파일 존재 여부를 동일시하지 않는다.
- Toss 결제에서 브라우저 값은 authoritative source가 아니다.
- `service_role`은 server-only.
- secret 값을 출력하거나 문서에 남기지 않는다.
