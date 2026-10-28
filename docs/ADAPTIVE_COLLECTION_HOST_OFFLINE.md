# Fresh216 unified one-operation collector — OFFLINE boundary

**Status 2026-10-28:** Implemented and regression-tested using *synthetic*
21,600-slot inputs. This is NOT a live WCL collector activation, nor an
authorized GitHub Actions job. No Sheets/GAS writes or tokens.

## Decision

Reuse one schema-1 durable JSON checkpoint for both classes of potentially
billed WCL GraphQL requests:

- **Ranking batch:** one specialization, already frozen TotalDPS top100,
  next 1–10 BossDPS ranking pages (no hardcoded maximum page index).
- **Report wave:** up to four same-report fight groups normally, one WCL
  `report(code)` query with overall/boss aliases per fight.

Both use atomic **READY → IN_FLIGHT → COMPLETED/NEEDS_REVIEW** transitions.
A crash or ambiguous HTTP/GraphQL response leaves the *whole request*
NEEDS_REVIEW and is never automatically replayed. A second request for
the same scope is forbidden while another request is IN_FLIGHT or has
unreconciled costs. The existing single-fight runner remains available.

## Implemented modules

- `src/core/rank-batch-checkpoint.mjs`: source-attested ranking-page
  request registration, immutable job/snapshot identity, page sequencing,
  evidence proof commit, incident handling and persisted page history.
- `src/core/rank-batch-runner.mjs`: builds the official BossDPS
  `characterRankings` aliases from the **checkpointed** scope, validates
  exact same report/fight/name/startTime and source revision, and commits
  only uniquely proven named actors. Anonymous is preserved for Report.
  A WCL `{error:...}` page is an observed pagination-unavailable
  terminal result, not an invented rank cap.
- `src/core/report-wave-runner.mjs`: existing one-request grouped Report
  proof join and atomic full-wave persistence, including uniquely proven
  Anonymous via report-local actor ID/`Player (n)`.
- `src/core/observed-cost-calibration.mjs`: reads **successful,
  cost-witnessed** ranking and grouped Report operations from the shared
  checkpoint. It refuses to produce a two-sided comparison before enough
  ranking and grouped Report observations exist. The per-fight value is
  an observed *wave average*, **not the marginal saving of one fight**.
- `src/core/adaptive-collector-runner.mjs`: recomputes the original
  216×100 proof state, merges committed ranking and Report evidence,
  invokes the adaptive planner, chooses one next paid operation, and
  resumes previously registered READY operations before making a new plan.
  `mode:'preview'` has no I/O, `mode:'execute'` requires
  `approved:true`, a point/rate admission policy, both caller-injected
  transports, and a caller-owned atomic persistent store.

## Evidence-derived cost policy

Earlier *actual WCL* measurements establish:

| Evidence | Observed |
| --- | --- |
| Dated Nek'zali Total page1 + Boss pages1–10 | 11.01 reported total per specialization; 3 requests |
| Dated Nek'zali completion-depth, 3 other specs | 20 GraphQL requests, 234.06 summed reported totals, 22.509 seconds summed GraphQL response |
| Within that completion run | 9 ranking GraphQL requests, 11 Report fallback requests; 40 distinct Report/fight groups |
| Page20 vs page21 shape probe | reported total 1.01 for that two-page query; page21 `{error}` |

These numbers **do not separately disclose the 11 individual Report
request costs**. Nor is the previous experiment's four-Report-alias
query the same shape as the new one-`report(code)`, four-fight alias
wave. Consequently it would be false to set a measured marginal
`reportPointsPerFight` from 234.06 alone.

The cost calibrator therefore requires observed **both-side** request
receipts before returning `economics`. Until then the planner permits
bounded initial ranking discovery but routes the remaining named and
Anonymous slots to official Report fallback rather than fabricate a
savings percentage. It never replaces missing values with zeros.

The economic heuristic applies only to **potentially avoidable** Report
fight groups after global coalescing, not all matching character slots.
Even observed per-wave cost divided by fight count is a cost-model
proxy, not a guaranteed marginal WCL tariff. Actual run time and
points are tracked separately.

## Offline regression

- New ranking-batch tests include exact match/revision/scope,
  Anonymous, pagination-unavailable, persistent JSON restart, refusal
  of replay or forged resumed scope, crash recovery, shared Report
  operation lock, and no fictitious cost.
- Unified runner tests build synthetic **216×100** sources and confirm
  preview-only default, owner admission required, single ranking
  operation, 4-fight Report operation with 108 uniquely verified actor
  proofs, and an actual next action that excludes completed fights.
- Existing checkpoint, single-fight, adaptive planner and grouped
  Report regressions must remain passing.

## Remaining before a LIVE full216 run

1. Prepare one trusted adapter from the installed WCL top100 snapshots to
   the immutable planner slot schema, including date filter, startTime,
   reportRevision and exact actor evidence; do not use private workbook
   `정보` or publish raw rankings to public GitHub.
2. Supply WCL OAuth transport and a private **persistent**, single-owner
   checkpoint volume. GitHub Actions' ephemeral worker filesystem alone
   must not be treated as durable resume storage.
3. Capture per-request `currentRequest.total` for the new wave query
   shape, calibrate actual latency/points, then trial a chosen scope.
   Unknown/billed requests are never blindly retried.
4. Only after selected-scope exactness, points, duration and recovery are
   measured should Sheets/GAS or main branch activation be considered.

**No WCL HTTP, Secrets, Sheets or GAS operations occurred in this
offline-only change.**


## Historical source importer checkpoint

The historical G3/G4.13 source importer has now been implemented and
passed synthetic 216-job/21,600-row integrity regression:
[G3_COMMITTED_SNAPSHOT_ADAPTER_OFFLINE.md](G3_COMMITTED_SNAPSHOT_ADAPTER_OFFLINE.md).
It does **not** assert live Spreadsheet source authenticity. Original
G3 source is Oct 8–12/partition 1 and has no attested report revision;
the importer retains this instead of manufacturing new-period data or
allowing unprovable ranking shortcuts. Obtain the private actual export
and producer scope attestation before live execution.

## 2026-10-28 actual workbook provenance audit

A previously uploaded original XLSX supplied a **partial historical**
G4.13 source: 44 COMMITTED envelopes and 44 RAW A:T rows. All 44
passed envelope/metric digest and RAW-KPI parity. There is no complete
216-job current-period source in that uploaded workbook. The public
repository contains only code and sanitized count-level evidence.
The G3 adapter supports audited partial import with a non-dispatchable
flag; its strict full216 path remains unchanged. The owner-approved
same report/fight/name/startTime unique identity rule is now recognized
for ranking proof even when the historical producer omitted reportRevision.


## 2026-10-28 new-period TotalDPS source boundary

The missing fresh source has a dedicated **OFFLINE, transport-injected**
capture path: [FRESH_COHORT_20261022_28_OFFLINE.md](FRESH_COHORT_20261022_28_OFFLINE.md).
It reuses the common durable checkpoint's `sourceRequests` and point
accounting, validates the actual imported 8×27 boss/spec roster, makes
32 proposed grouped TotalDPS first-page requests, and refuses to
export Full216 slots until every 100-row job is committed. Runtime
requires explicit owner approval, WCL transport and private persistent
volume. No new live WCL calls, actor data publishing, Sheets or GAS
changes were made in this offline development stage.
