# DTB Decision Log

중요한 결정을 시간순으로 누적한다.
기존 항목을 지우지 말고 superseded 표시를 사용한다.

---

## D-001 — Chat is not the source of truth
Date: 2026-11-06

Decision:
DTB의 개발 상태는 채팅 기억이 아니라 repo 문서를 기준으로 관리한다.

Reason:
대화 길이 제한으로 새 채팅이 생성되면 전체 transcript가 자동으로 완전 복원되지 않을 수 있다.

Rule:
실제 코드/DB → Current State → Decision Log → Master Context → Chat memory 순서로 신뢰한다.

---

## D-002 — Secret-free continuity docs
Date: 2026-11-06

Decision:
handoff 문서와 snapshot에는 secret 값을 기록하지 않는다.

Allowed:
- env variable 이름
- project ref
- public domain
- commit hash
- migration filename

Forbidden:
- service_role
- Toss secret
- OAuth secret
- access token
- paymentKey
- Vercel token

---

## D-003 — Current login incident handling
Date: 2026-11-06

Decision:
Supabase Auth 설정을 추가로 바꾸기 전에 실제 authorize request와 recent auth diff를 확인한다.

Known:
- site_url 정상
- redirect allow-list 정상
- linked project ref 정상

Therefore:
설정 변경보다 regression tracing을 우선한다.

---

## D-004 — Login incident recovery record
Date: 2026-11-09 (incident resolved 2026-11-06)

Supersedes: D-003의 "설정 변경보다 regression tracing을 우선한다"는 이번 장애에 한해 종료됨 (regression은 발견되지 않음).

Record:
- Supabase Site URL은 설정상 정상으로 보였지만 OAuth redirect가 비정상 동작
- Site URL을 잠시 다른 값으로 변경 후 원래 production URL로 원복
- 수 분 뒤 Auth 정상화
- 코드 변경 없음
- 근본 원인은 확정하지 않음
- 향후 동일 증상 발생 시 stale Auth configuration / propagation 가능성을 우선 점검
- 단, 이것을 모든 로그인 장애의 일반 원인으로 간주하지 말 것

Rule:
- Dashboard에 보이는 값과 실제 runtime 동작이 다를 수 있으므로 Auth redirect 장애 시 실제 runtime behavior를 별도로 검증한다.
