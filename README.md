# WCL Fresh216 — 재사용 가능한 WCL 데이터 엔진

이 저장소의 목표는 특정 시점의 216개 기록을 한 번 보충하는 것이 아니라, 새로운 기간·레이드·난이도·전문화에도 적용할 수 있는 **정확한 WCL 수집·동일 Report/Fight/actor 증거 귀속·검증·중단 복구·KPI·Google Sheets 발행 엔진**입니다.

## 구현을 찾는 가장 짧은 경로

| 질문 | 코드·자료 | 확인할 경계 |
|---|---|---|
| 원본 랭킹을 어떻게 가져오는가? | [fresh-cohort-source](https://github.com/degong2-code/wcl-fresh216/blob/work/fresh216-adaptive-archive-delta-20261031/src/core/fresh-cohort-source.mjs), [rank-batch-runner](https://github.com/degong2-code/wcl-fresh216/blob/work/fresh216-adaptive-archive-delta-20261031/src/core/rank-batch-runner.mjs) | 정확한 1~100위, original identity |
| 동일 Report-wave를 어떻게 묶는가? | [report-wave-runner](https://github.com/degong2-code/wcl-fresh216/blob/work/fresh216-adaptive-archive-delta-20261031/src/core/report-wave-runner.mjs), [checkpoint](https://github.com/degong2-code/wcl-fresh216/blob/work/fresh216-adaptive-archive-delta-20261031/src/core/checkpoint.mjs) | IN_FLIGHT/불확실한 요청은 자동 재시도 금지 |
| 동일 actor의 증거를 어떻게 계산하는가? | [archive→C bridge](https://github.com/degong2-code/wcl-fresh216/blob/work/fresh216-adaptive-archive-delta-20261031/src/core/fresh216-archive-to-c.mjs), [actor archive](https://github.com/degong2-code/wcl-fresh216/blob/work/fresh216-adaptive-archive-delta-20261031/src/core/fresh216-actor-proof-archive.mjs) | pure code 존재 ≠ 운영 C 승격 |
| KPI/U:Y와 시트 입력을 어떻게 계획하는가? | [output contract](https://github.com/degong2-code/wcl-fresh216/blob/work/fresh216-adaptive-archive-delta-20261031/src/core/fresh-dps-output-contract.mjs), [U:Y batch plan](https://github.com/degong2-code/wcl-fresh216/blob/work/fresh216-adaptive-archive-delta-20261031/src/core/uy-batch-plan.mjs) | 계획 ≠ 실제 Sheets write/readback |
| 왜 현재 구조인가? | [설계 로드맵](https://github.com/degong2-code/wcl-fresh216/blob/work/fresh216-adaptive-archive-delta-20261031/docs/PROJECT_ROADMAP.md), [public PR #21](https://github.com/degong2-code/wcl-fresh216/pull/21) | 과거 문서 상태는 날짜별로 구분 |

**기능 코드의 현재 작업 브랜치와 기본 `main`은 같지 않을 수 있습니다.** 위 링크는 명시된 개발 브랜치를 가리킵니다. 각 PR의 최신 HEAD/병합 여부를 직접 확인하고 코드를 재사용하세요. 비공개 원본·검증 영수증과 현재 세부 승인/상태는 별도 비공개 인계에서 관리되므로 이 공개 README만으로 운영 완료를 판단하지 않습니다.

## 개발 원칙과 자주 반복되던 실수

- 기존 수집기·Report-wave·Checkpoint·actor proof·Archive→C·KPI를 확인하고 **중복 구현하지 않습니다**. 최소 수정으로 공통 실행 경로를 완성합니다.
- GitHub의 **CODE / OFFLINE PASS / 실전 Source / 공식 BossDPS parity / 제품에 MERGED / C·Sheets PUBLISHED**는 서로 다른 검증 등급입니다.
- GraphQL HTTP 요청 수 감소가 항상 WCL API points 또는 전체 완료시간 감소를 보장하지는 않습니다. 관측 비용·payload·Git 크기·Actions 시간·복구 손실까지 측정합니다.
- Report-local actor ID와 WCL NPC global `gameID`를 혼동하지 않습니다. BossDPS는 공식 정책과 대조한 target NPC 필터 기준이며, nonboss 차감 역산은 현재 적용 정책이 아닙니다.
- 역사적 `jobKey`·`snapshotSha`를 보존하고, 스냅샷이 다른 C/U:Y 결과를 하나의 완료도에 합치지 않습니다.
- 과거 승인·CI PASS는 새로운 WCL/OAuth 호출, 데이터 공개·승격 또는 Sheets 쓰기 승인이 아닙니다.

## 변경 이력의 역할

코드와 PR은 **무엇이 구현됐는지**, 테스트/실행 영수증은 **어디까지 확인했는지**, 설계 문서는 **왜 선택했는지**를 기록합니다. 새 작업 전 세 가지를 함께 확인해야 합니다. 오래된 로드맵의 `P0` 또는 `미완료` 표시는 현재 상태가 아닐 수 있습니다. 최종 제품 통합과 발행은 실제 제품 브랜치와 읽기 검증 가능한 실행 영수증으로만 판정합니다.
