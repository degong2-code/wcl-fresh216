> **Period update (2026-10-28):** The owner changed this
> previously proposed Oct22–28 KST window to **Oct22–27 KST**.
> Source code now uses `date.1792594800000.1793113200000`;
> use [the latest owner-approved live pilot](LIVE_FRESH_COHORT_20261022_27_8ALIAS_PILOT.md)
> for current scope and actual query costs. The older date range
> documented below is a superseded design reference, **not** the
> current collection target.

# Fresh216 Heroic TotalDPS source acquisition — OFFLINE implementation

**Status (2026-10-28 KST):** Source capture engine, full
216-job synthetic end-to-end tests and shared durable checkpoint
integration implemented; **no live WCL call, no actual fresh source**.

## Exact source scope

- **Encounter roster:** original imported Apps Script `BOSS_LIST`,
  8 fixed encounter/name pairs:
  네크잘리 (3470), 파수꾼 (3445), 탐험가 (3455),
  바쉬니크 (3497), 스조라크 (3420), 쌍곳니 (3421),
  똬리 (3429), 울라텍 (3492).
- **Class/spec roster:** original imported Apps Script `DPS_SPECS`,
  exactly 27 unique specs. `makeFreshDatedHeroicManifest(scopeKey)`
  supplies the exact attested roster. The input validator refuses roster
  reordering, omission, duplication and substitution.
- **Difficulty:** Heroic (4). Mythic (5) is NOT included in this step.
- **Period:** October 22–28, 2026 KST, inclusive; server-side
  `date.1792594800000.1793199600000` (October 29 00:00 KST
  exclusive). On October 28 the date window is not yet closed, so any
  same-day capture is an **as-of capture**, not a final post-window
  leaderboard.
- **Partition:** `LATEST_DEFAULT`. The GraphQL query must **omit**
  `partition`, not force historical `partition:1`.
- **Rows:** one `characterRankings(metric:dps,page:1)` JSON
  ranking array with exactly 100 rows for each boss/class/spec.

This is not interchangeable with the old Oct 8–12 partition-1 G4.13
workbook. That workbook has 44/216 actual committed historical source
jobs verified by private SHA/RAW reconciliation, but zero accepted
**new-period** source jobs.

## Minimal execution architecture

One existing `JsonCheckpointStore` state (schema 1) holds
`sourceRequests` alongside the already implemented `rankRequests`
and same-fight Report `entries`. There is **no separate queue,
journal or public data artifact**.

`planFreshCohortBatches` groups up to **8 specializations of the
same encounter** per GraphQL request, producing a deterministic
**32-request plan** for the 216 jobs. The query uses 8 aliased
`characterRankings` fields; the paid cost of this precise query
shape has **not** been measured.

One authorized step uses:

1. Strict manifest digest and 32 requests registered as READY in the
   private checkpoint.
2. Explicit `approved:true`, `mode:'execute'`, a caller-injected
   authenticated WCL transport and a bounded point admission policy.
3. An atomic **IN_FLIGHT** checkpoint write before HTTP (one request
   covering all 1–8 jobs in the batch).
4. HTTP 200 + exact 100 source rows per alias + report/fight/name,
   positive sorted DPS and KST date-window validation. No
   interpolation of missing rows.
5. An atomic COMPLETED transition storing the exact 100-row source
   arrays privately plus each job's SHA-256 and the observed WCL
   `currentRequest.total` **once per request**.

Any uncertain HTTP/GraphQL response, shape conflict, missing point
cost, process interruption, or source drift results in a
NEEDS_REVIEW block. Automatic retry is prohibited because the previous
request may already have been charged. Only one scope owner operates
the checkpoint; avoid ephemeral filesystem-based resume assumptions.

Default execution is a **read-only preview**. Neither an OAuth client
nor a GitHub Actions paid workflow was created by this module.

## Offline API

- `makeFreshDatedHeroicManifest(scopeKey)`: builds fixed manifest.
- `planFreshCohortBatches(manifest)`: pure 32-request plan.
- `runOneFreshCohortBatch({store,manifest})`: read-only preview by default.
- `runOneFreshCohortBatch({...,mode:'execute',approved:true,
  transport,admissionPolicy})`: executes **one** bounded request in
  a caller-owned, private persistent environment.
- `exportVerifiedFreshCohort(state,manifest)`: returns the immutable
  216×100 `planFull216` slots only after all source batches are
  durably COMPLETED with observed point witnesses. The returned
  **raw slots must remain private**; only aggregate summary counts are
  safe for public logs.

The same checkpoint is passed to `prepareAdaptiveNext` and
`runOneAdaptiveStep` after complete source export. Thus the
BossDPS ranking → marginal-stop → same-fight Report workflow can
reuse already charged TotalDPS source work, without re-fetching the
frozen top100 or creating another checkpoint implementation.

## Validation evidence and limits

`tests/fresh-cohort-source.test.mjs` covers all 216×100 synthetic
rows, 32 request aliases/frames, missing or malformed rows, bad date,
missing point witness, immutable manifest, approved-only dispatch,
private JSON restart, no replay and mutual exclusion with Report
requests. Existing single-fight/ranking-wave/Report-wave/Full216
tests are kept in the same CI suite.

**Synthetic pass is not proof of live 216/216 or live point savings.**
No real Oct 22–28 TotalDPS source was retrieved. The actual WCL
request cost and response shape for 8-spec alias groups must be
measured under a later explicitly approved, fixed-budget run before
automating 32 paid calls. Preserve private checkpoint and page
snapshots independently of public GitHub.

The remaining two steps are: an owner-authorized source capture
using actual WCL OAuth on a **durable private host**, and a cost/coverage
audit before the adaptive BossDPS collector or Sheets/GAS activation.


> **New private-host implementation:** The missing durable execution
> path is now code-complete but only **OFFLINE TESTED**, not deployed:
> [PRIVATE_FRESH216_HOST_RUNBOOK.md](PRIVATE_FRESH216_HOST_RUNBOOK.md).
> The latest owner-approved source window is **Oct22–27 KST**, not the
> superseded Oct22–28 design. No additional WCL queries were made.
