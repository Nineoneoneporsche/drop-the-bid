# DTB Context Continuity System

이 폴더의 목적은 **채팅 길이 제한, 새 ChatGPT 대화, Claude Code 재시작, 담당자 변경**이 발생해도
DTB 개발 상태가 끊기지 않도록 하는 것입니다.

## Source of truth 우선순위

1. 실제 코드 / DB / 배포 상태
2. `DTB_CURRENT_STATE.md`
3. `DTB_DECISION_LOG.md`
4. `DTB_MASTER_CONTEXT.md`
5. 과거 채팅 기억

채팅 기억이 문서나 실제 코드와 충돌하면 **채팅 기억을 버리고 실제 상태를 우선**합니다.

## 새 세션 시작 순서

AI/개발자는 반드시 아래 순서로 확인합니다.

1. `AGENTS.md`
2. `DTB_MASTER_CONTEXT.md`
3. `DTB_CURRENT_STATE.md`
4. `DTB_DECISION_LOG.md`
5. `DTB_SESSION_SNAPSHOT.md` (존재하면)
6. `git status`
7. 최근 commit 10개
8. 현재 이슈와 관련된 코드 diff

그 후에만 수정 작업을 시작합니다.

## 세션 종료 순서

1. `./scripts/dtb-checkpoint.sh`
2. `DTB_CURRENT_STATE.md` 업데이트
3. 중요한 설계 결정은 `DTB_DECISION_LOG.md`에 기록
4. Production 반영 여부를 명시
5. 다음 세션 첫 작업을 1~3개로 한정
6. 문서 변경까지 commit

## 절대 기록 금지

다음 값은 이 문서 시스템에 저장하지 않습니다.

- Supabase service_role key
- Supabase secret / access token
- Toss secret key / paymentKey
- OAuth client secret
- Vercel token
- 개인 API key
- 실제 고객 개인정보

환경변수는 **이름만 기록**하고 값은 기록하지 않습니다.
