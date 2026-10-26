# Fresh216 collector architecture — evidence-first review (provisional)

Status: **ARCHITECTURE REVIEW / NO LIVE ACTIVATION**. This is not a collector release.

## Outcome we are optimizing

- Complete a selected difficulty's **216 jobs** (8 encounters × 27 specs), each from a verified top-100 ranking snapshot.
- Preserve same-fight, same-character **total DPS + boss DPS** attribution. Do not guess null or anonymous evidence.
- Produce rank 1/30/100, top-30/top-100 averages and the five non-boss KPIs for Google Sheets U:Y.
- Prior 4h 09m 46s end-to-end runtime is the comparison baseline; 5–10× improvement remains an **unproved aspiration**.
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
