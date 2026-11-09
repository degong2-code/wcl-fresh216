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
