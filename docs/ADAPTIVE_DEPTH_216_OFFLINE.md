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

`reportWaveCandidates` group up to four fights by report. They remain
information-only: the existing checkpoint/runner currently protects
one-fight requests. A multi-fight Report wave requires a single durable
wave-level `IN_FLIGHT` operation before any live dispatch. This
planner does not create a duplicate journal or bypass that gate.

### Evidence and remaining limits

The preceding 2026-10-28 live pilot on Heroic Nek'zali, 2026-10-22..28
KST, Frost DK/Retribution/Shadow recovered 259/300 by ranking through
page20, then all 41 residual named + Anonymous slots using official
same-fight Report rankings (final 300/300).

This code-only step tests 8 synthetic full-216 scenarios; it does not
measure an actual 216-job completion time, production WCL points, or
actual batched Report cost savings. The historical 75 GAS tests remain
unrun in bootstrap CI. A future host must supply measured per-page
and per-fight economics and durable paid-request checkpoints before
activation.
