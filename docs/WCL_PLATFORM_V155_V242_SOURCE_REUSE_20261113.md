# WCL V2 — 기존 인증 v155/v242 WCL 소스 재사용

2026-11-13. PR #39 기반 격리 Draft 작업. **새 WCL OAuth 클라이언트·GraphQL 수집기·API 호출은 필요하지 않다.** 이미 정상 작동한 기존 제품 수집 경로를 V2의 부분 환경 카탈로그 입력으로 재사용한다.

## 실제 조회/봉인/소비 소유자 (읽기 전용으로 확인)

기존 정본 저장소: [simc-secondary-optimizer-runner](https://github.com/degong2-code/simc-secondary-optimizer-runner), 검토 SHA `cec7cbee5375aed8d1057526b4e36354bf509dd4`.

- [`runner/v155_season_api_probe.py`](https://github.com/degong2-code/simc-secondary-optimizer-runner/blob/cec7cbee5375aed8d1057526b4e36354bf509dd4/runner/v155_season_api_probe.py): 기존 OAuth + WCL GraphQL 2회 (`worldData.expansions`, 모든 확장팩의 `worldData.zones`). 실제 요청 본문 SHA, 원본 응답 SHA 및 길이를 보관하며 **원본 HTTP 응답 바이트는 보고서에 저장하지 않는다**.
- [`runner/v242_authenticated_season_source_stage.py`](https://github.com/degong2-code/simc-secondary-optimizer-runner/blob/cec7cbee5375aed8d1057526b4e36354bf509dd4/runner/v242_authenticated_season_source_stage.py) 및 v217: `source/season_api_report.json`과 기존 봉인 stage 영수증·캐시; 같은 stage를 재사용하면 신규 GraphQL 0회.
- [`runner/v163_zero_seed_db2_join.py`](https://github.com/degong2-code/simc-secondary-optimizer-runner/blob/cec7cbee5375aed8d1057526b4e36354bf509dd4/runner/v163_zero_seed_db2_join.py): 같은 빌드 Wago DB2와 조인해 시즌에 속한 활성 레이드·쐐기 후보를 판정. **WCL expansion ID와 DB2 ExpansionID가 같다고 가정하지 않는다.**
- `runner/v216_environment_build_coordinator.py`: 기존 제품 소비·Build 연결.

[실제 인증 WCL source Actions #43365490208](https://github.com/degong2-code/simc-secondary-optimizer-runner/actions/runs/43365490208): 제품 쪽 검증 SHA `b4dc028c661a6e5effee8db99b5ad58fa70dacfa`. `expansion_index` 원문 HTTP 응답 296바이트, 요청 SHA `ee42860a946c1e5a740d5ecfe17ec1922e45fd8e58eb6dc40c71fdaf81368617`, 응답 SHA `417bcf6818ea7c288151a1f8752402a4456edd44a975f7037302d66dbbb4ad33`. `all_expansion_zones` 23,857바이트, 요청 SHA `377f720590ba5b6f6412185ed7eaf386fe6f3ad2df72fdc0e1cf455d44a05f09`, 응답 SHA `f2603768896e37772a168fe35104e55e08e95ac3029b158b7795d55648474007`.

같은 빌드의 [기존 A3 DB2 조인 증거](https://github.com/degong2-code/simc-secondary-optimizer-runner/blob/cec7cbee5375aed8d1057526b4e36354bf509dd4/docs/development/notes/2026-11-13_p1-v396-a3-active-raid-mplus-current-source-scope-pass.md)는 레이드 우두머리 10개, 쐐기 던전 8개 관계를 확인했다. 이것이 전체 시즌 아이템·모든 NPC/BossDPS 규칙의 증명은 아니다.

## 새 V2 읽기 전용 연결부

`src/adapters/wcl-v155-stage-reuse.mjs`의 `createSealedV155CatalogPort`는 기존 V2 `WCL_CATALOG_PORT_V1` 인터페이스를 반환한다. 네트워크·파일 쓰기·OAuth·새 수집기 기능이 **없다**.

입력은 이미 수집·보관된 **원본 v242 보고서 JSON 바이트** (`reportBytes`), 외부에서 승인/봉인한 전체 보고서 SHA-256 (`expectedReportSha256`), 외부에서 승인한 두 GraphQL 요청/응답 SHA와 길이 (`pinnedGraphql`), 그리고 선택한 `sourceNamespace`·`expansionId`다. 두 GraphQL 고정 키는 `expansion_index`, `all_expansion_zones`다. 승인값은 원본 보고서 내부의 자기 주장으로부터 만들어서는 안 된다.

사용 예시 (경로 및 승인값은 기존 호스트가 제공, 여기서는 실행하지 않음):

```js
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createSealedV155CatalogPort}
  from './src/adapters/wcl-v155-stage-reuse.mjs';
import {discoverEnvironment}
  from './src/core/environment-discovery.mjs';

const reportBytes = await readFile(existingV242ReportPath);
const port = createSealedV155CatalogPort({
  reportBytes,
  expectedReportSha256:approvedV217FullReportSha256,
  pinnedGraphql:approvedV155OriginalGraphqlPins,
  sourceNamespace:approvedNamespace,
  expansionId:approvedWclExpansionId
});
const {profile} = await discoverEnvironment({
  catalogPort:port,
  sha256: text => createHash('sha256').update(text).digest('hex'),
  observedAtMs:approvedObservedAtMs
});
```

## 범용성·품질 경계

- 기존 v155 보고서는 각 `zone_id`, `zone_name`, `wcl_frozen`, `expansion_id`, `encounters[].wcl_encounter_id`, `blizzard_journal_encounter_id` 등을 보존한다. 그러나 **원본 GraphQL HTTP 바이트, WCL class/spec 전체, zone 난이도·파티션·전투별 지원 범위는 보관하지 않는다.**
- 따라서 이 포트는 `type:'unclassified'`, 난이도/파티션 `null`, DPS 전문화 `[]`를 반환한다. `discoverEnvironment`는 이 원본으로 부분 프로필을 기록하되 아직 전투별 실행 `buildAnalysisScope`를 승인하지 않는다.
- `frozen=false`는 활성 후보일 뿐 **현재 시즌 레이드 인증이 아니다**. `journalID=0`은 Blizzard 저널 ID가 아니다. 실제 시즌 연결은 이미 검증된 v163 조인 결과를 별도로 사용해야 한다.
- 보고서의 해시 목록을 외부 승인 해시와 비교하는 것은 **기존 봉인 보고서와의 정체성 비교**다. 원본 HTTP 바이트가 현재 재제공되지 않는 한 원본 응답 SHA를 독립적으로 재계산한 것처럼 표현하지 않는다.
- 위 실측 SHA·현재 확장팩 번호·현재 레이드 이름은 **테스트/코드의 정답 상수로 삽입하지 않는다**. 새로운 시즌에도 동일한 계약을 사용한다.
- 공개 GitHub에는 원본 보고서·키·토큰을 올리지 않는다. 이 PR은 실제 원본을 다시 조회하거나 복제하지 않는다.

`tests/wcl-v155-stage-reuse.test.mjs`는 13개 합성 정규화/해시/범위/회귀 시나리오를 테스트한다. 다음 실제 작업은 **기존 v163/v216 동일 빌드 조인 영수증의 특정 검증 필드를 V2로 재사용**하는 것이지, 새 인증 API와 수집기를 만드는 일이 아니다.
