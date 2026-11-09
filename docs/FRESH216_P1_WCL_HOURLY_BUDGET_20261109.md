# Fresh216 P1 — WCL hourly quota, not a lifetime collection cap

## Owner decision and WCL API rate source (2026-11-09)

The practical WCL API constraint is its hourly allowance, reset every window.
Lifetime checkpoint point evidence must NOT become a permanent quota ceiling.
WCL GraphQL rateLimitData provides limitPerHour, pointsSpentThisHour,
pointsResetIn (seconds), databaseLimitPerHour and databasePointsSpentThisHour.
Source: https://www.warcraftlogs.com/v2-api-docs/warcraft/ratelimitdata.doc.html
The common 3,600 points/hour is NOT hard-coded as the actual WCL key limit.

## Reused architecture and point semantics

- The immutable A checkpoint remains the lifetime receipt. Historical A90 /
  9,000 original ranks / 90.10 source points is preserved without any reset.
- Existing request-admission and bounded-cohort runner use a new
  budgetBaselinePoints to scope an OWNER-APPROVED WAVE cap per invocation.
- The trusted owner-approved host queries WCL rateLimitData before any new
  source data request. Probe responses are cached up to 60 seconds and never
  beyond the server-reported reset. Confirmed source costs since sampling
  are added locally to the hourly spent counter.
- The quota query itself costs API points, which are reported separately
  from the source-rank witness ledger. Unknown probe points are null, not 0.
- Owner cap for one bounded source wave may be 1..3600 observed source points
  and 1..32 requests; these are AUTHORIZATION bounds, never the server quota.
- Optional independent Database Points reserve can be specified for API
  requests that use database-counted fields.
- Hour exhausted -> HOURLY_RATE_WAIT with reset-based waitMs, no data HTTP.
- Quota unknown -> HOURLY_QUOTA_UNAVAILABLE, no data HTTP or state mutation.
- A later owner-approved invocation checks live quota afresh, resumes at
  the next READY batch, and does not replay an ambiguous IN_FLIGHT request.
- No hourly sleeper, background scheduler or automatic owner reapproval
  has been implemented by this change.

## Exact live compatibility boundary

The existing private A90 checkpoint at
work/fresh216-engine-source-candidate-20261102 pins provenance commit
0d2c3de4d34ea7dccdba3d4f9a4326d8c0e34179. Its current private Actions
source-bounded job still checks out that exact product commit and the runner
refuses sourceCodeCommit != productHead. Updating only the checkout SHA would
be unsafe and fail. This isolated P1 implementation is not yet deployed.

Before a live successor may reuse A90, independently validate old/new
source planning, GraphQL schema, immutable 9-alias partition, row decoding,
saved SHA-256 digests and restart behavior. Introduce a separately pinned
compatible execution-code identity while retaining the immutable origin
provenance in A. Explicit owner approval remains required for every run.

## Acceptance evidence / limits

Test legacy recovery, fresh hour after >90 lifetime points, near-3600 pause,
reset/refetch, database reservation, quota probe point accounting, uncertain
quota and HTTP fail-closed, zero duplicate paid data calls and 216-job export.
CI must use a credential-free isolated ref. Private request remains
preview / approved=false. No B/C/Sheets publication from partial A.

The objective is a reusable A/B/C/verification/recovery/KPI/Sheets engine,
not a one-off repair of an old 216-job snapshot.

## Independent source-compatibility inspection (read-only; NOT a promotion)

Compared original A-origin source code at
0d2c3de4d34ea7dccdba3d4f9a4326d8c0e34179 against this P1 branch:
- Source class/boss roster, manifest validation, 9-alias planner, GraphQL
  query builder, installation, next-batch selection, IN_FLIGHT transition,
  decoding, committed-witness finish, and runOneFreshCohortBatch function
  bodies were byte-identical in the inspected source spans.
- The checkpoint state module's Git blob is identical across those commits:
  d5717f9c3a92b327cb881d644fda3b4dd04c1ae9.
- The whole source module blob is NOT identical (original
  3c59982bb0a866f8f91a2b98053f93b51dd97ee9; successor
  21709015b45bba3e44a4c1c53fcc7b04f4f26262), partly due to
  the later read-only completed-cohort projector. This byte-span comparison
  is supporting evidence, not a full executable equivalence proof.
- Private A90 checkpoint's original origin code pin must remain unchanged.
  A new owner-approved execution-code compatibility proof/adapter is
  still required before the P1 engine can be used live on this checkpoint.

Offline CI proof: https://github.com/degong2-code/wcl-fresh216/actions/runs/42548407822
76 pure-core suites PASS; private inventory and WCL jobs SKIPPED.
Temporary CI branch trigger reverted byte-for-byte before PR review.

## P1.1 A90 execution-code compatibility adapter (2026-11-09)

- `sourceCodeCommit` in the private A90 checkpoint stays the original
  immutable provenance `0d2c3de4d34ea7dccdba3d4f9a4326d8c0e34179`.
- The owner request can separately pin the execution code (`productCommit`)
  and the explicitly audited `compatibleSourceOriginCommit`. For the
  current A90 only, the compatible origin must match exactly that original
  SHA. `source-one` and other modes reject origin compatibility override.
- The private runner reads BOTH original and successor product Git trees,
  checking their HEAD SHA, source-module blob identities, clean worktrees,
  and origin repository address. It then compares 11 paid-path functions,
  every one of the 24 immutable nine-alias GraphQL queries, the exact
  next batch, and all already committed rank-row snapshot hashes via
  the shared projector. All checks precede OAuth, data HTTP or state writes.
- Exact allowed source-module blob pair:
  original `3c59982bb0a866f8f91a2b98053f93b51dd97ee9`,
  successor `21709015b45bba3e44a4c1c53fcc7b04f4f26262`.
- The generic `attestFreshCohortExecutionCompatibility` function is
  read-only and has synthetic positive/tamper/uncertain-state regression.
- On successful explicit future paid operation, only standard checkpoint
  transitions update version and A job count; the origin code commit is
  never rewritten, and execution code SHA is only included in the
  sanitized operation receipt.
- Existing active private control request remains preview/approved=false.
  This adapter alone is not permission for WCL API calls or auto-resume.

### Remaining promotion gates

1. Product PR #24 offline suite PASS after all P1.1 changes.
2. Separate private `preview` job imports original and successor product
   code, reads the actual A90 checkpoint and checks 9,000 original rows.
3. A private owner-reviewed source-bounded workflow may check out the
   new exact P1.1 code commit only after its preview integration PASS.
4. Any paid continuation still needs an explicit owner request pinning
   product HEAD, source HEAD, origin SHA, request bound and hourly budget.

No historical C, new B or Sheets state is promoted by this change.
