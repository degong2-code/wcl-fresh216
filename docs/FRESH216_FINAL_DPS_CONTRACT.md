# Fresh216 — 최종 DPS 데이터 계약 (2026-10-29)

## 목적과 기준

이 문서는 8보스 × 27전문화 × 1~100위, 2026-10-22~27 KST 영웅 difficulty 4 / `date.1792594800000.1793113200000`, latest/default 파티션에 대한 **Google Sheets 최종 KPI의 의미**를 고정한다. 이 기간의 WCL `metric:dps` EXACT100 원본은 비공개 Git checkpoint에서 **216/216, 21,600행** 확보·독립 검증 완료. **BossDPS는 실제 수집 전**이므로 아직 B/C 값이 없다. 현재 문서는 API 호출·Sheets 쓰기 승인이 아니다.

## 서로 다른 3개의 원본

| 구분 | 순위·식별 축 | 보관 대상 | 사용 지표 |
|---|---|---|---|
| **A: Total-ranked** | 공식 `metric:dps`의 각 보스/전문화 1~100위 | 순위, DPS, Report, Fight, unique name, startTime, revision, 원본 해시 | TotalDPS 1/30/100위, Top30/Top100 평균 |
| **B: Boss-ranked** | **독립** 공식 `metric:bossdps`의 각 보스/전문화 1~100위 | 독립 순위, DPS, Report/Fight, 이름/시각, 원본 해시 | BossDPS **자체 순위** 1/30/100위, Top30/Top100 평균 |
| **C: Total-linked Boss** | **A 순위 고정** 후 A와 동일 Report/Fight·유일 캐릭터의 공식 BossDPS | A rank, source SHA, BossDPS, exact same-fight actor proof, 매칭 출처 | U:Y 및 Total-rank 기준 개별/상위 N 비보스 비중 |

B의 1위가 A의 1위와 같은 캐릭터일 필요는 **없다**. B의 BossDPS 숫자를 A의 해당 순위에 위치만 맞춰 C로 대입하면 잘못된 결과다. A의 1위 이름/전투에 대응하는 C만 A의 1위 비보스 비중에 사용한다.

독립 B의 원본 순위 벡터와 C의 A-rank 결합 벡터를 **동시에 보존**하며, B 데이터를 C의 proof로 취급하려면 각 Report/Fight/name/startTime 조건이 충족되어야 한다. Page 1에 100행이 없더라도 확보된 1·30위 및 Top30은 정확한 범위 내에서만 사용할 수 있고, 확보되지 않은 100위/Top100은 `null`로 남긴다. 순위 101+ 또는 이전 기간의 데이터로 메우지 않는다.

## KPI 5개씩

각 216개 job에는 정확히 다음 3개의 독립 계열이 있다.

- **TotalDPS (A):** A rank1, rank30, rank100, A top30 mean, A top100 mean.
- **BossDPS (B):** B rank1, rank30, rank100, B top30 mean, B top100 mean.
- **Non-boss share U:Y (A+C):** A rank1, rank30, rank100에 대한 `(Total−same-fight Boss)/Total` 및 A 상위 30·100에 대한 `(ΣTotal−Σsame-fight Boss)/ΣTotal`. **모든 필요 순위의 C가 있을 때만** 해당 평균 비중을 표시한다. 매칭된 일부만으로 분모를 축소하면 안 된다.

내부 진단용으로 A 순위에서 관측한 C의 보스DPS 5지표를 추가 보관할 수 있으나, 이는 **B의 공식 보스DPS 독립 순위 KPI가 아니다.** `src/core/job-kpis.mjs`의 레거시 `bossDpsMetrics` 필드는 A-linked C에 해당한다. 최종 출력 계약 `src/core/fresh-dps-output-contract.mjs`는 이를 `totalRankJoinedBossDpsMetrics`로 명시하고, B의 `bossRankedDpsMetrics`와 분리한다.

## 동일인 귀속 증거

- 우선 일치 조건: **동일 Report + 동일 Fight + 양쪽에서 유일한 캐릭터 이름**, 충돌하지 않는 시작 시각, class/spec 및 report revision. 전역 canonical ID를 필수로 하지 않는다.
- 랭킹 우선: 공식 B page 1 매칭 → 회수율·실측 포인트 기준에 따라 B 추가 페이지 선택 조회 → 아직 미해결인 기명 A 전투에 대해 공식 `report.rankings(fightIDs, playerMetric: bossdps)` 여러 Fight/Report를 가능한 한 묶어 조회.
- 다른 Report 또는 Fight에서 나온 같은 이름은 C 증거가 될 수 없다.
- Anonymous·`Player (n)`은 A rank에서 **삭제·재정렬하지 않는다**. 현재 기본 복구 대상에서는 제외하며, 신뢰 가능한 별도 동일인 증거가 없으면 C와 종속 U:Y는 `null`.
- 조회 응답 200이어도 정체성·순위·원본 해시 불일치, API 포인트 불명, 중간 저장 실패 발생 시 **확정값으로 승격하지 않는다.** `null`은 0이 아니며, 구간 평균을 추정하거나 보간하지 않는다.

## 데이터 흐름 및 배포 경계

1. A의 비공개 영속 checkpoint SHA `d077daf32426edb660e25ca1a527392cfb077c8b`, 소스 코드 고정 SHA `7b1a075ad2663c8aa07734b7733cbe81bf9c6071`을 읽는다. 이미 증명된 21,600개 A행은 **재수집하지 않는다**.
2. 소스 고정 B page 1: `src/core/fresh-boss-first-page.mjs`가 같은 보스 전문화 최대 8개씩 묶은 32개의 **후보 GraphQL 문서**를 만든다. 응답을 받을 때 **B 원본 1~100위 랭킹 및 snapshot SHA**와 **C 동일 전투 proof**를 서로 다른 필드로 보존해야 한다. 32는 예상 호출 문서 수이며 **실측 비용/커버리지가 아니다**.
3. B/C API 실행은 사전 승인된 범위와 비공개 원격 Git state의 묶음 단위 `IN_FLIGHT → COMPLETED/NEEDS_REVIEW` 저장이 구현·검증된 이후에만 허용한다. 지금까지 이 연결은 구현되지 않았다.
4. 각각의 job에서 순수 함수 `summarizeFreshDpsJob`를 적용하여 `totalDpsMetrics`, `bossRankedDpsMetrics`, `totalRankJoinedBossDpsMetrics`, `nonBossShare`를 별도로 만든다.
5. `영웅_DPS지표_V5`의 기존 RAW A:T 지표/순서를 원본 Sheet 헤더로 대조한 뒤 보존하고, **U:Y** 5개 비보스 비중을 대응 job에 추가한다. `신화_DPS지표_V5`는 해당 난이도 소스를 별도로 확보해야 갱신할 수 있다. 216개 영웅 데이터로 신화 지표를 대체하지 않는다.
6. 한 번의 Sheets batch write를 우선 검토하되, 변경 전 시트 ID·헤더·순서·수식·대상 날짜를 확인한다. 쓰기 성공만으로 완료 판정하지 않고 **독립 읽기 검증** 후 완료로 선언한다.
7. 사용자 확정 정책: **Sheets 갱신·독립 검증 PASS 후에만** 비공개 저장소의 시점별 원본/중간 checkpoint 및 전용 상태 브랜치 정리를 수행하고, 소형 수집 영수증을 남긴다. Git 히스토리의 완전 삭제를 보장한다고 말하지 않는다.

## 현재 단계 검증 상태

- A: **실수집 216/216, 원본 21,600행, 소스 checkpoint v65**, 원격 독립 복원 확인.
- B/C: 실제 BossDPS 호출 **0회**, 랭킹 32문서 묶음 계획과 오프라인 응답 디코더만 구현.
- BossDPS 익명 비용 통제: 실제 A 기준 21,261 named, 339 anonymous; 익명 때문에 예약된 즉시 Report waves **244 → 0**으로 수정, 공개·비공개 오프라인 CI PASS.
- Google Sheets 쓰기: **0회**. RAW/대시보드 반영 및 source 정리는 미완료.

이 계약은 **독립 순위 B와 동일 전투 귀속 C의 혼동을 방지**하는 최상위 개발 기준이다.
