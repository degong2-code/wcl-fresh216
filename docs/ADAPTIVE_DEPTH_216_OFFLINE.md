# Adaptive Full216 ranking-depth planner — offline-only

## Implemented 2026-10-28

`src/core/adaptive-depth-plan.mjs` exports `planAdaptive216(slots, options)`.
It composes existing `planFull216` (exact 216 x 100 validation,
same-fight actor proof requirements), `planFightFetches` (via full-scope
plan, globally deduplicated report/fight groups), and
`planReportWaves` (candidate Report grouping).

No network, OAuth, Secrets, Google Sheets, durable runtime or API calls
are added. All results have `readyForAutomaticDispatch:false`.

### Inputs and validation

- `slots`: 21,600 immutable TotalDPS top100 slots; verified BossDPS
  slots must contain the existing `EXACT_SAME_FIGHT_ACTOR` proof.
  Already VERIFIED slots are reused, never silently re-queried.
- `pageEvidence`: optional per-job ascending page observations.
  A `newVerifiedRanks` entry is counted only when that precise rank has
  a verified same-fight proof attributed to the precise page:
  `proof.discovery={kind:'BOSSDPS_RANKING_PAGE',page:N}`.
  Snapshot drift, repeated ranks, fabricated page gains and observations
  after a terminal page fail closed.
- `economics`: optional externally calibrated measured
  `rankingPointsPerPage` and `reportPointsPerFight`.
  These are cost-model inputs, **not an official WCL tariff**.
  Without measured calibration, additional pages following a cached
  ranking page are not scheduled.
- `batchPages=3`, `recentPages=3` are tunable planning window sizes,
  **not maximum leaderboard rank or API hard caps**.

### Marginal stop criterion

Calculate mean newly VERIFIED BossDPS matches across recent observed
pages, project matches over the next proposed batch, and cap the estimate
by the still-unresolved named slots. Count only globally singleton
unresolved report/fight groups as potentially avoidable Report work:
a shared fight with another unresolved actor—or an Anonymous actor—still
requires Report fallback even when one name is found on a leaderboard.

A next-page batch becomes a candidate only when its **optimistic upper
bound** of Report points avoided exceeds estimated ranking points:
`min(projectedMatches, singletonPendingReportFights) *
reportPointsPerFight > batchPages * rankingPointsPerPage`.

An optimistic upper bound is used to reject obviously uneconomic
queries, **not** to claim confirmed savings. Grouped Report billing,
multi-fight wave costs, and cross-job execution order remain external
measurement/operation concerns.

A short terminal page, an observed `UNAVAILABLE` page (including the
page21 `{error:...}` shape seen in the live pilot), no named pending
slots, or poor marginal economics ends ranking discovery for that job.
There is **no hardcoded rank-1000 or rank-2000 stop**.

### Report fallback and Anonymous

Every pending named or Anonymous slot remains present in globally
deduplicated Report/fight candidates. When a fight must be queried for
an Anonymous actor, ranking work for that same fight is not falsely
credited as avoiding the Report. Named and Anonymous matches still
require exact same-fight overall/boss actor proof; the planner does not
synthesize BossDPS.

`reportWaveCandidates` group up to four fights by report. The
shared checkpoint now protects these as one atomic multi-fight operation,
through `executeOneReportWave`. The planner still returns candidates,
not a live WCL dispatch: the host must supply an authorized transport,
measured admission policy and persistent atomic store.

### Evidence and remaining limits

The preceding 2026-10-28 live pilot on Heroic Nek'zali, 2026-10-22..28
KST, Frost DK/Retribution/Shadow recovered 259/300 by ranking through
page20, then all 41 residual named + Anonymous slots using official
same-fight Report rankings (final 300/300).

The planner's 8 synthetic full-216 scenarios and the separate 9
atomic Report-wave regression scenarios passed. This does not
measure a full live 216-job completion time, production WCL points or
actual batched Report savings. The historical 75 GAS tests remain unrun
in bootstrap CI. A future host must supply measured page/fight
economics, credentials, and selected-scope authorization before activation.

## Atomic Report-wave checkpoint added 2026-10-28

The existing schema-1 checkpoint now supports multiple fights under a single
attempt ID. All member entries become IN_FLIGHT in one durable update, all
verified or unresolved actor results commit in one durable update, and uncertain
HTTP/GraphQL responses mark the entire wave NEEDS_REVIEW without auto-retry.
The same WCL request-total point cost is carried by all wave members for
provenance but counted **once per attempt ID** in checkpointStats. No new
journal, schema migration, WCL transport, token or worker was introduced.
The new `src/core/report-wave-runner.mjs` accepts a caller-injected transport
and existing atomic JsonCheckpointStore; no live execution is enabled by the
plan itself. Synthetic 4-fight regressions cover restart, invalid/partial
responses, actor ambiguity, budget admission and replay refusal.


## Shared rank + Report host boundary (2026-10-28)

Implemented as `src/core/adaptive-collector-runner.mjs` and
`src/core/rank-batch-runner.mjs`, using existing schema-1 checkpoint
plus new `rankRequests` entries. Both ranking and Report attempts share
one owner, pre-HTTP durable IN_FLIGHT markers, incident/restart recovery,
observed-point accounting and no automatic repeat of uncertain charged
requests. Registered ranking query identity and its top100 actor slots
are immutable even on resume. Ranking page proofs are the only ranks
counted in next-stage marginal recovery. The Report wave stays one
charged attempt, not one per fight.

The pure `observed-cost-calibration.mjs` requires at least two
successful request receipts of each kind by default; its result is
an empirical *average*, not a guarantee of marginal savings.
`runOneAdaptiveStep()` defaults to preview and requires
`mode:'execute'`, explicit approval, point admission policy, injected
rank+Report transports and a private atomic checkpoint for execution.
This is an OFFLINE integration boundary, not a running WCL collector.

Detailed protocol and remaining tasks:
[ADAPTIVE_COLLECTION_HOST_OFFLINE.md](ADAPTIVE_COLLECTION_HOST_OFFLINE.md).
