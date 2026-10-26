# Fresh216 collector architecture — evidence-first review (provisional)

Status: **ARCHITECTURE REVIEW / NO LIVE ACTIVATION**. This is not a collector release.

## Outcome we are optimizing

- Complete a selected difficulty's **216 jobs** (8 encounters × 27 specs), each from a verified top-100 ranking snapshot.
- Preserve same-fight, same-character **total DPS + boss DPS** attribution. Do not guess null or anonymous evidence.
- Produce rank 1/30/100, top-30/top-100 averages and the five non-boss KPIs for Google Sheets U:Y.
- Prior 4h 09m 46s end-to-end runtime is a **historical comparison baseline**, not an acceptance threshold. Seek the shortest realistically attainable runtime and lowest actual WCL points **without compromising EXACT-100**; report measured improvements and overhead honestly, even when incremental.
- Rank snapshots, evidence quality, WCL point consumption, total elapsed time and operational simplicity matter more than G4.x version count.

## Confirmed code-level issues (from private installed-source review)

- `Code.js:wcl35RankQuery_` builds `worldData.encounter.characterRankings` for overall and boss DPS, and reuses a committed snapshot when available.
- `Code.js:wcl40Wire_` builds one `report.rankings(fightIDs:[fid],playerMetric:dps)` and one `report.rankings(...bossdps)` per report/fight alias. GraphQL HTTP count and aliases are **not interchangeable with WCL point cost**.
- `Code.js:wcl40FastReport_` memoizes report rosters only within a tick/execution. `wcl35One_` loops batches **within one job** and persists proof and U:Y via Sheets calls.
- `Code.js:wcl35Groups_` discards missing rankings without a character identity; G4.25 offers a separate, disabled planner that may include such anonymous fights, but does not automatically prove an actor.
- `Code.js:wcl35Recover_` already applies useful invariants: one same-amount overall actor, same class/spec, unique actor identity, one matching boss actor and boss DPS ≤ total DPS (0.005 tolerance).
- `13_F216.js:wcl43G413Core_` replays RAW into the legacy `wcl35One_`; `415.js:wcl43G415Tick` temporarily substitutes core functions to handle auth-related failures. These are tightly coupled Apps Script wrappers, **not a clean independently portable engine**.

Observed historical measurements (private user evidence): 43/216 jobs committed (16 EXACT-100, 27 valid partial); G4.17 identified 217 report HTTPs. For the **41 jobs with complete point coverage**, 6,685 observed OPT points included 6,636 Report points. Do not extrapolate this cost to all 216 or count unknown failed-request charges as zero.

## API options — key uncertainty

Official WCL schema:
- `report.rankings()` is labelled **Database Points**.
- `report.table()` is labelled **User-Eligible Points** and accepts `fightIDs`, `sourceID`, `targetID`, event/time filters. Its JSON data is **not frozen**.
- `@onlySpendUserPoints` requires an OAuth **user** context; it errors with no OAuth user. The existing implementation uses the **client_credentials /api/v2/client** flow. Therefore the table label **does not prove** cheaper points under our current credentials.
- Neither same DPS denominators, pet ownership, target filtering, actor identity nor response cost has yet been proven equivalent on real paired fights. Report `revision` must be part of a persistent cache identity where available.

References:
- https://www.warcraftlogs.com/v2-api-docs/warcraft/report.doc.html
- https://www.warcraftlogs.com/v2-api-docs/warcraft/onlyspenduserpoints.doc.html
- https://www.warcraftlogs.com/api/docs
- https://www.warcraftlogs.com/v2-api-docs/warcraft/ratelimitdata.doc.html

**Decision:** DO NOT replace rankings with table on assumption. Next compare the algorithms and data shapes offline on one known proven fight, then seek explicit approval for *one bounded paired live measurement* only if still decision-relevant. Unknown or unmeasured cost is `null`, never zero.

## Minimal collector design (no historical G4.x layers copied)

```text
RankingSnapshot → GlobalFetchPlanner → WCLFetchAdapter → ExactProofValidator
                                             ↓                 ↓
                                     Rate/Cost Witness   EvidenceCheckpoint
                                                               ↓
                                                      GoogleSheetsPublisher
```

1. **Snapshot**: one immutable ranked top-100 witness per boss/spec/difficulty/date scope. Preserve rank slot, original DPS, report/fight, hashes; never silently requery a drifting snapshot.
2. **Global planner**: across **all 216 jobs**, group identical report+fight+encounter+difficulty (+revision where known) and attach multiple pending rank slots. A query is not a verified slot. Retain separate snapshot provenance per slot.
3. **Fetch adapter**: choose the WCL data source only after exact-actor parity and observed point cost. No unsafe merge of distinct `fightIDs`; prior G4.20 trial did not establish equivalent result.
4. **Proof validator**: same fight, matching encounter/difficulty, unique character, strict class/spec and overall DPS equality, one matching boss DPS, preserved ranking snapshot. Anonymous row is eligible for a query but NOT automatically complete.
5. **Checkpoint**: durable idempotent proof commits keyed by scope/snapshot/job/rank/fight/revision; no duplicate point-spending retry on uncertain 504/429/partial GraphQL response.
6. **Sheets publisher**: batch committed results to existing RAW + U:Y contract; private raw proofs need not be Git-committed. Keep sheet-writing separate from WCL collection.

## Execution environment — deliberately unresolved

| Option | Advantage | Constraint |
| --- | --- | --- |
| Streamlined Apps Script | Already connected to private Sheets, known auth/checkpoints | 6-min execution window, Script Properties/trigger complexity, Sheets I/O in core |
| Node.js cloud runner + Sheets output adapter | Clean pure-core tests and control of batching | GitHub Actions runners are ephemeral, need durable checkpoint/credentials/rate-safe retries, operating cost |
| Hybrid | Reuse current private Apps Script for bounded LIVE while building/test-driving pure core in GitHub | Two paths temporarily; must not create dual writers |

**Near-term preferred development path:** implement the minimal **pure JavaScript global planner + exact validator under GitHub offline CI**, keep existing Apps Script **STOPPED** and treat it as the historical witness and (only with approval) bounded live reference. Select future LIVE host based on measured end-to-end latency, points and checkpoint integrity, not on code-porting convenience. No new cloud infrastructure in this stage.

## Milestones and measurable decisions

1. **Offline portable proof**: extract synthetic/previously verified fight-shape fixtures and reproduce rank/actor matching; global dedupe planner test must produce no invented values. Zero API requests.
2. **Decision-grade API comparison**: same fight, same character; overall/boss DPS parity or explicit rejection, report revision, response bytes/time and **observed** points; no larger search while this is unresolved.
3. **One-job end-to-end run**: capture actual point cost, retries, elapsed time, final EXACT proof and persistent checkpoint as a single controlled result (separate explicit LIVE approval).
4. **Small-cohort before 216**: prove repeated-work elimination, rate handling and safe resume; extrapolation remains labelled uncertain.
5. **216 scope + Sheets publishing**: one start/cancel/resume interface; final verdict from number of truly complete EXACT-100 jobs, wall time and observed points.

## Safety / regression boundary

- Existing G4.13/G4.15 were last observed **STOPPED**, cursor 43; G4.25 collector hook disabled.
- Never start/restart those jobs, change triggers, write Sheets, upload credentials, or run paid WCL tests through public PR CI without separate approval.
- New planner source is a **non-operational offline prototype**; it cannot fetch WCL, infer boss DPS, commit proofs or publish sheets.
- Only promote a future architecture after a controlled direct comparison, rather than treating old scripts as mandatory foundations.

## Implementation progress (offline, no LIVE authorization)

The Public Draft PR includes five pure-core components/suites; NONE of these is an installed or deployable WCL collector:

| Core module | Contract / current result |
| --- | --- |
| `src/core/fetch-plan.mjs` | Pending ranks grouped across jobs by scope + report + fight + encounter + difficulty + revision; keeps per-rank snapshot provenance; actor name preserved |
| `src/core/resolve-proof.mjs` | Same-fight, unique actor and exact BossDPS validator; refuses ambiguous evidence |
| `src/core/evidence-join.mjs` | Joins an already-fetched report with per-rank proof; requires matching report code and report revision; returns unresolved ranks explicitly |
| `src/core/job-kpis.mjs` | Builds rank 1/30/100, first 30/100 averages and U:Y non-boss share from exactly proved same-rank BossDPS; missing proofs make dependent metrics null |
| `tests/legacy-proof-parity.test.mjs` | Independent historical recover() oracle verified on **500 synthetic report shapes**; not real WCL proof replay |

The new core was demonstrated in CI end-to-end using **synthetic** 100-rank input: rank snapshot → fight grouping → evidence-join → EXACT100 KPI. The test deliberately creates inputs without private report IDs or actor identities. Proof values are **only** considered verified when joined to a known report code, known report revision, same fight/encounter/difficulty, unique actor, class/spec and raw DPS amount. A known revision is not itself a license for cross-run cache reuse: freshness and provenance must be revalidated.

Five offline Node test suites currently total **32 test declarations**, one of which compares **500 deterministic simulated cases** to the extracted legacy matching algorithm. Original G4.13/G4.15/G4.25 75 historical cases are not yet present or executed by this CI. CI passing is **NOT** an end-to-end latency/point improvement claim.

## Single decision-grade future LIVE measurement (not authorized or executed)

Use one **previously proven, non-anonymous** report/fight and the exact same scope/snapshot. Compare *separate requests*, without modifying the reference proof or restarting the stopped collector:

1. Baseline: query `report.rankings(fightIDs:[id],playerMetric:dps|bossdps)`; retain the legacy DPS and same-actor witness.
2. Candidate: query `report.table(...)` with matched `fightIDs`, `dataType`, `sourceID`, boss `targetID`/encounter rules and any required actor/pet ownership translations. Target classification, effective fight DPS denominator, pets and absorbs must not be assumed equivalent.
3. Measure each request's elapsed time, rate-limit `currentRequest` charge when observable, response bytes and retry/error status; unknown failure costs remain **null**.
4. Compare actor identity, total DPS, BossDPS and both 30/100 rank-aggregate semantics against the frozen witness. Mark any mismatch as a failure; no interpolation or expected savings projection until parity is demonstrated.
5. Prefer the route with **lower observed cost at equal evidence**. If the table path cannot preserve exact DPS or only shifts quota type, retain rankings while optimizing report/fight reuse. Do not generalize a single fight's cost to 216 jobs without additional measured cohort evidence.

User approval is required before step 1's live queries. No automation is enabled by this document.

## Durable checkpoint prototype — available, not deployed

- `src/core/checkpoint.mjs` implements strict, pure state transitions with a private per-run scope. A fetch transitions `READY → IN_FLIGHT` **before** any HTTP call. The caller must durably commit that transition first. Responses become `COMPLETED` or `COMPLETED_PARTIAL` only after the exact evidence join covers every referenced slot. The original snapshot SHA stays linked to each accepted proof.
- Uncertain `HTTP_429`, `HTTP_504`, auth/partial errors and crashes during `IN_FLIGHT` become `NEEDS_REVIEW`, **never silently READY**. Already completed groups cannot be fetched again in this run. No automatic retries have been implemented for uncertain requests. Missing WCL point observations stay `null`, not 0; cost totals stay unknown if any attempted request lacks a cost witness.
- `src/adapters/json-checkpoint-store.mjs` persists this state to a private absolute filesystem path with restrictive permissions, atomic rename, fsync and fail-closed lock. It is a small prototype for a **persistent private volume**, not an approved GitHub Actions production store. A Codespace or Actions ephemeral disk is insufficient for unattended whole-run durability. On lock contention/stale lock, stop for investigation rather than delete state blindly.
- `tests/checkpoint.test.mjs`: interrupted request, duplicate attempt, stopped/resumed state, uncertain cost, partial proof, corrupted provenance and read-after-restart cases using synthetic data. No real WCL calls or private proof evidence.
- One interface, one checkpoint machine. Do not add a new collector-version layer for individual incidents. Route all future hosts/adapters through these same state transitions; migrate only after actual identity/provenance checks.

**Explicitly incomplete:** LIVE WCL fetch adapter, existing RAW/PROOF ingestion, a persistent production checkpoint backend, Google Sheets batching/publishing, credentials, UI/progress/cancel orchestration, real-evidence parity and 216-job measurement. The temporary JSON store must never be committed into Public Git or uploaded as a public CI artifact.

### Engineering scorecard (relative, not a fixed multiplier)

1. **Correctness first**: verified EXACT-100 jobs out of 216; same-fight/same-actor provenance and no guessed KPI.
2. **Cost**: measured WCL point spend per completed job, measured/unknown request coverage, failed-request cost and successful evidence per point.
3. **Time**: measured wall-clock time to complete useful evidence including rate-wait/retries, separately from CPU/Sheets time. Any improvement is welcome; no arbitrary mandatory speedup factor.
4. **Resilience**: no accidental duplicate charged requests, safe cancellation/resume, durable proof after crashes and 429/504 incidents.
5. **Complexity**: minimal modules and deployment prerequisites, no redundant version-specific wrappers.

All reported results must separate synthetic CI PASS from real same-fight evidence parity and paid-point observations.
