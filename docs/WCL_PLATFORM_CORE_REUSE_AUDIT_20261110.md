# WCL Analysis Platform — Core reuse audit and minimal contract (2026-11-10)

**Status:** Phase-1 implementation planning, code-evidence audit; **NOT IMPLEMENTED**, not a live WCL authorization, not a promotion or release.  
**Source:** public product `work/fresh216-adaptive-archive-delta-20261031` at immutable `61658b002541d7eff48ce86b6b1407d77139eb89` (Draft PR [#21](https://github.com/degong2-code/wcl-fresh216/pull/21), OPEN/DRAFT at audit).  
**Change isolation:** This audit is on a new branch based on the above SHA; it neither edits PR #21 nor merges into `main`.  
**Current product authority:** [Public product direction](PRODUCT_DIRECTION.md) and [repository instructions](../AGENTS.md); detailed private `projects/wcl-fresh216/{PRODUCT_VISION,ARCHITECTURE,ACCEPTANCE_CRITERIA}.md`, decisions D18–D24 and V2 handoff on `degong2-code/ai-project-lab`. V23 and older Fresh216 plans are fixtures, not current instructions.

## Executive result

**Reuse the existing Report-wave, checkpoint transitions, evidence join and pure admission decisions.** Do not start a new collector, scheduler, evidence proof format or KPI computation stack. Generalize the *input boundaries* first; keep the legacy Exact-100 path immutable and tested during extraction. The primary gap is a zero-state catalog/profile + generic scope interface that the existing fixed-216 planner/host does not consume yet.

GitHub tree inspection: public `main` `src/core` contains `fresh216-archive-to-c.mjs` only; this feature branch has 51 `src/core` files and 15 `src/adapters` files. The source code and its existing offline tests are **branch-local**; no platform-ready product/main linkage or zero-state E2E is established.

## 1. Call path and ownership of effects

Current adaptive flow (source inspection, not an assertion that the production host is live):

~~~text
Legacy immutable 216×100 A source
  fresh-cohort-source.mjs / full-scope-plan.mjs
    -> adaptive-collector-runner.mjs : prepareAdaptiveNext
         -> adaptive-depth-plan.mjs : planAdaptive216
              -> fetch-plan.mjs -> report-wave-plan.mjs
         -> rank-batch-checkpoint.mjs (ranking page state)
         -> checkpoint.mjs (Report-wave state)
         -> observed-cost-calibration.mjs
    -> adaptive-collector-runner.mjs : runOneAdaptiveStep
         -> rank-batch-runner.mjs OR report-wave-runner.mjs
              -> request-admission.mjs
              -> injected transport + injected durable store
              -> evidence-join.mjs -> resolve-proof.mjs
         -> pending evidence -> existing evidence publisher/archives/C adapter

Host/IO: private-fresh-cohort-host.mjs, fresh216-engine-tick.mjs,
JsonCheckpointStore and private Git-backed stores (Node/Git-specific).
KPI: job-kpis.mjs and fresh-dps-output-contract.mjs (fixed Top-100 A/B/C).
~~~

**Effect boundary:** `src/core/report-wave-runner.mjs` and `rank-batch-runner.mjs` coordinate one external operation through an injected transport/store, but import `node:crypto`; they are not currently pure, Cloudflare-portable domain modules. `src/core/checkpoint.mjs` itself is a pure state machine and requires durable host updates. `src/adapters/json-checkpoint-store.mjs` is a Node filesystem adapter, not the abstract storage contract or a hosted long-running scheduler.

The exact integration bridge is missing: a dynamic `EnvironmentProfile` / `AnalysisScope` has no existing, verified adapter that can produce rank cohorts, launch the old engine without `21600`, and emit a generic, provenance-addressable `StatisticsSnapshot`. A plan is not live product behavior.

## 2. Source-backed disposition matrix

| Capability / existing source | Decision | Code evidence and specific gap | Minimal action |
|---|---|---|---|
| `report-wave-plan.mjs` | **REUSE + EXTEND** | `planReportWaves` groups by scope/report/revision and bounds a wave to ≤8 fights; separately counts HTTP requests vs observed points. `Fresh216Wave` query name and bucket-level `scopeKey` are legacy conveniences. | Preserve grouping/one-call semantics; parameterize query shape and policy, verify semantic equality before using across new scopes. |
| `report-wave-runner.mjs` | **REUSE + CONNECT** | `executeOneReportWave` persists the whole-wave `IN_FLIGHT` before transport; records raw response SHA and verified witness; uses Node Buffer/crypto. | Keep one-operation logic; isolate byte hashing/UUID and WCL transport behind ports. |
| `checkpoint.mjs` | **REUSE + EXTEND** | `beginWaveFetch`, `completeWaveFetch`, `pendingWaveEvidence`, `markWaveEvidenceCommitted`, `recoverCheckpoint` already prevent blind retry. `registerPlan` rejects ranks >100; schema stores legacy slot identities. | Keep state transitions and uncertain semantics; introduce a versioned rank-depth adapter / migration before changing persisted format. |
| `request-admission.mjs` | **REUSE + CONNECT** | `evaluateWclHourlyQuota` reads limit/spent/reset and optional database budget; `evaluateRequestAdmission` blocks uncertain/unobserved work. A pure decision function is not a central multi-run reservation ledger. | Supply a fresh quota-reader and atomic coordinator. Account for real point categories, observed cost and uncertain charges. |
| `fetch-plan.mjs` | **REUSE + EXTEND** | Already globally groups Report/Fight/Encounter/difficulty/revision, retaining slot-specific identities; `validateSlot` enforces rank 1..100. | Accept immutable selected Top-N slot contract without weakening exactness. |
| `adaptive-depth-plan.mjs` | **EXTEND** | `planAdaptive216` calls `planFull216` and hardcodes 216 jobs and 21,600 slots, Top-100 rank/page assumptions. | Extract a strategy planner consuming a generic selected scope; keep old 216 compatibility wrapper. |
| `adaptive-collector-runner.mjs` | **CONNECT + EXTEND** | `prepareAdaptiveNext` requires `slots.length===21600`; `runOneAdaptiveStep` already reuses rank batches, Report waves, checkpoint and cost calibration. | Do not fork an executor. Generalize plan input/return types and inject runtime adapters around this single execution path. |
| `rank-batch-checkpoint.mjs` / `rank-batch-runner.mjs` | **REUSE + EXTEND** | Source batches contain exactly 100 original ranks and page size ≤100; official Boss-ranked evidence is tracked separately. | Separate source depth from WCL pagination size; preserve immutable source membership and proof classes. |
| `evidence-join.mjs` / `resolve-proof.mjs` | **REUSE + EXTEND** | Requires same Report/Fight/Encounter/difficulty/revision and unique actor; null on ambiguity. `resolve-proof` explicitly warns live WCL response-shape parity is not universal. | Preserve fail-closed identity; move legacy field names into an input normalizer, and add NPC policy version/phase gating separately. |
| `job-kpis.mjs` / `fresh-dps-output-contract.mjs` | **EXTEND** | `summarizeJobSnapshot` requires exactly 100 ranks and produces 1/30/100, Top-30/100 with null-safe BossDPS. A-ranked C and independently B-ranked metrics are distinct. | Introduce depth-aware aggregation while keeping the verified fixed-100 adapter unchanged for regression. |
| `fresh-cohort-source.mjs` / `full-scope-plan.mjs` | **STOP as runtime defaults; REUSE as fixtures** | Hardcoded eight bosses, 27 specializations, exact 216 jobs, 100 ranks. | Never use these defaults for new seasons. Keep immutable historical fixtures and compatibility tests. |
| `json-checkpoint-store.mjs`, private Git witness, `private-fresh-cohort-host.mjs` | **CONNECT** | Atomic local store, owner lease, Git remote witness model and lazy OAuth exist. Host uses Node fs/Buffer, exact legacy A source, no generic browser-independent service. | Define durable `StorePort` / `LeasePort` / `ClockPort` / `TransportPort`. Preserve fail-closed preflight, allow an isolated local test adapter; no Cloudflare deployment. |
| Versioned environment discovery and scoped NPC policy validator | **NEW** | No verified metadata-to-`EnvironmentProfile` path or multi-report/phase official BossDPS certification. Historical one-fight NPC samples are not certification. | Start small catalog/profile vertical slice; candidate discovery and certification are separate follow-on gates. |
| Generic analysis run / statistics snapshot / web API + UI | **NEW + CONNECT** | No verified generic run/status/dashboard product wiring; legacy output is Sheets/A-B-C centric. | Wire application use cases to existing core; add compact JSON snapshots first, UI after API contract. |
| Historical B500 missing 63, forced Google Sheets U:Y, V23 BOOT, early Cloudflare configuration | **STOP** | No longer acceptance criteria. | Use only as regression or historical evidence, not as next implementation tasks. |

**REPLACE is intentionally not assigned to a working module.** No measured correctness or performance defect justifies rewriting a tested state machine or executor. If later evidence establishes a narrower, more reliable replacement, require before/after contract and cost results and isolate the change.

## 3. Minimal contracts to implement (schema sketches, not yet shipped APIs)

Avoid a brand-new infrastructure stack or universal WCL schema. Versioned logical records with only necessary fields:

~~~text
EnvironmentProfile v1
  profileId, version, sourceFingerprint, discoveredAt,
  catalogSource, content[] (type, zoneId, encounterIds, supported partitions),
  dpsSpecs[] (WCL IDs, class/spec labels),
  npcPolicies[] (encounterId, candidateGameIDs, phase/variant coverage,
    evidenceRefs, ruleFingerprint, status),
  unresolved[], quality

AnalysisScope v1 (immutable, user-selected)
  environmentProfileId, contentIds[], encounterIds[],
  difficulty/partition, timeRange, dpsSpecIds[], depth,
  metricPolicyVersion, scopeHash

AnalysisRun v1
  runId, scopeHash, planHash, status, createdAt, updatedAt,
  request/point counters (predicted vs observed vs uncertain),
  completenessByMetric, lastCheckpointVersion

TaskCheckpoint v1 (adapter over existing state machine)
  runId, scopeHash, taskFingerprint, attemptId, requestClass,
  READY | IN_FLIGHT | COMMITTED | NEEDS_REVIEW | UNCERTAIN,
  request/response digests if available, observedPoints,
  quotaWindowReference, storeVersion
  (Do not silently map legacy PENDING evidence to COMMITTED.)

EvidenceRef v1
  sourceClass (OFFICIAL_RANK | REPORT_SOURCE | NPC_POLICY | HISTORICAL_FIXTURE),
  reportCode, fightId, encounterId, difficulty/partition,
  reportRevision?, actorRef?, rank?, metric,
  sourceHash, ruleFingerprint?, verifiedAt, status
  (unknown actor/revision/policy evidence stays unresolved)

StatisticsSnapshot v1
  snapshotId, runId, scopeHash, environmentProfileVersion,
  metricPolicyVersion, calculationVersion,
  depth, measures[], rankCoverage, nullCount,
  quality/status, minimal evidenceRefs, computedAt
~~~

Rules: depth defines **rank coverage, never weaker proof**. Official BossDPS or **positively validated** NPC gameID target rules only; never `TotalDPS - NonBossDPS` to manufacture BossDPS. Total=Boss shortcuts require actual scoped witnesses. An evidence JOIN must include immutable source/rule versions and applicable Report/Fight/Actor identity; ambiguous data is NULL/partial. Metadata discovery cannot claim `CERTIFIED_FOR_SCOPE` before independent phase/variant + official evidence. Do not prescribe a fixed 3,600-point/hour rate.

**Compatibility design:** leave old saved `schema:1` Checkpoints and A/B/C rank snapshots intact. Map into a new typed application boundary first. Only change the on-disk schema with an explicit version bump, old→new fixture transformation and restart/collision regression. No automatic in-place migration of historical state.

## 4. Thin vertical slice: the next code PR (after this audit)

**Purpose:** from an empty environment state, discover a WCL-supported catalog subset and emit a stable versioned profile that a generic `AnalysisScope` validator can consume. No historical 8-boss fixture is allowed as the discovery input.

**Minimal path:**

1. `WclCatalogPort` (read-only): inject GraphQL transport; normalize only fields actually supported by the verified WCL schema. If season/partition/spec metadata is absent or ambiguous, return `UNSUPPORTED` or `UNRESOLVED`, never guess.
2. `discoverEnvironment(catalogPort, clock, existingProfile?)`: stable IDs, per-entity coverage/source fingerprints, deterministic sorting and versioned diff; no player/actor log collection initially.
3. `buildAnalysisScope(profile, selections)`: defaults to all supported encounters/DPS specs in selected content; validates actual discovered difficulties/partitions, date range and Top-N depth. Depth is a positive integer/preset with identical exactness policy for every rank.
4. `planEnvironmentRefresh` / integration fixture: on identical metadata no redundant work; changed profile fingerprint invalidates only affected elements. Return a typed **planning handoff**, not an unauthorized paid data fetch.
5. Offline tests: zero-state discovery, partial/unsupported API responses, duplicate IDs, deterministic replay/fingerprint, optional missing metadata, invalid scope, selected depth 10 vs 100 (same proof requirements), no network/secret/side-effect on import.

**Not included in first slice:** NPC phase certification, WCL paid collection, persistence migration, GitHub scheduler, C publication, Sheets export, dashboard UI, Cloudflare setup. Those become later vertical slices with independent approval/acceptance evidence.

### Release gates for the slice

- L2 partial: new EnvironmentProfile built from injected source fixtures with **no manually prefilled season/zone/spec/NPC registry**.
- Exact source/provenance version and uncertainty visible; discovery candidates never silently certified.
- Existing legacy suites remain valid without changing historical witness SHA/Checkpoint states.
- The only CI that must be rerun is tests affected by changed source/import boundaries; previous unchanged-SHA PASS evidence remains reusable.
- Explicit later approval is required before any live WCL metadata probe that consumes real API points.

## 5. Merge and execution order

1. Audit PR targets **the existing feature branch only**; remain Draft, no automatic merge or activation. Never report feature code as present on public `main`.
2. After review, implement the small, runtime-neutral catalog/profile/scope slice on another isolated branch; keep effects behind ports. Use synthetic input and bounded CI.
3. Connect the generic plan/identity interfaces to existing Report-wave/checkpoint/evidence paths incrementally, with old 216 compatibility tests as invariant checks.
4. Establish live quota and service lifecycle separately; do not blindly transfer a finite historical owner approval or introduce a second scheduler/Checkpoint engine.
5. Extend null-safe Top-N stats and provenance, then web application. Prove L7 zero-state and L8 cross-environment repeats before Cloudflare release gate R1.

**Observed evidence scope:** this document is based on static source/tree and preexisting Actions logs; it does not run code, issue WCL queries, inspect Secrets, write runtime Checkpoints/C/KPI/Sheets, or establish full production parity.
