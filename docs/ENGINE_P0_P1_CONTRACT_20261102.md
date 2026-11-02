# Fresh216 engine — P0/P1 common contract and implementation order

Status 2026-11-02: **P0 partial source-to-KPI boundary is implemented and CI-proven.
P1 actual A→B→C live integration is NOT yet proven.**

## North star: implementation engine, not 216 rows repaired

Use Fresh216 as the first strict test of a general reusable engine: given a
versioned scope (dates, difficulty, bosses, specs, metric policy), acquire
official ranking evidence; coalesce already-observed Report/Fight records;
prove BossDPS belongs to exactly the same fight and actor; calculate
independent Total-ranked and Boss-ranked metrics; and publish only verified
outputs. A new season must change scope data, **not** introduce a new
collector, checkpoint implementation or KPI calculation stack.

Full initial production acceptance: **216 jobs × EXACT100 A ranks = 21,600
immutable source slots**, independent B BossDPS-ranked leaderboards, exact
same-fight C proofs for each eligible A actor, and correct nullable U:Y.
Anonymous stays in A rank and C stays null without a defensible paired
witness. All 1st/30th/100th and Top30/Top100 averages preserve exact cohorts;
no interpolation, zero-fill or replacement ranks.

## Reuse inventory, not redesign from scratch

| Engine boundary | Existing reusable implementation | Verified today | Known coupling / next edit |
| --- | --- | --- | --- |
| Scope and A source | `fresh-cohort-source.mjs`, `fresh-cohort-bounded-runner.mjs` | 1 and 9 aliases real; 72-suite CI | Date/roster are literal; extract versioned owner scope after evidence contract is stable |
| A source → A-ranked slots | `projectCompletedFreshCohort` (same projector used by full exporter) | exact per-completed-job 100 rows, checksum, sorting/date/identity checks | Only this one source projection should be used by future B/C |
| Independent B page1 | `fresh-boss-first-page.mjs`, `fresh-boss-wave-journal.mjs` | 8-alias synthetic, not yet same current 9-A scope live | Planner/query/wave tests assume 32 batches × 8, must decouple B batches from A source batches |
| Named C proofs | `rank-batch-runner.mjs`, `resolve-proof.mjs`, `report-wave-runner.mjs` | preexisting offline/old source evidence | Validate unique Report/Fight/name and snapshot; avoid mandatory global ID and repeated reports |
| A/B/C KPI | `summarizeFreshDpsJob` and `summarizeJobSnapshot` | synthetic B≠C rank order, missing>null invariants | One existing KPI module; no parallel formula implementation |
| Read-only P0 bridge | `inspectFresh216EngineContract` | new suite: 8/9 partial A, sample B/C join, full A gate, collision, SHA and fit errors | Caller must supply **previously attested** B and C from private evidence store; no network |
| Persistence | `JsonCheckpointStore` + `makeGitDurableStore` | real source checkpoint and restart | 3 waves: 10,676ms for 6 Git commits; benchmark compressed immutable witnesses before changing state transition |
| Sheets interface | `uy-batch-plan.mjs` | synthetic contract only, no writes | Configure verified batchUpdate+readback; never claim CAS from read-only plan |

## P0 implementation completed here

The new **read-only** `projectCompletedFreshCohort(state,manifest)` consumes
only `COMPLETED` batches; it rejects unresolved attempts, an altered plan,
missing/reranked A slots, failed witness SHA, wrong date or malformed fight.
It returns 100 original A ranks per completed specialization, without
pretending the other 216 jobs exist. The old full
`exportVerifiedFreshCohort` now reuses that identical projector, then
requires `SOURCE_COMPLETE` and independently calls `planFull216`.

The new read-only `inspectFresh216EngineContract` calls the existing
`summarizeFreshDpsJob`; separate B pages and C same-fight proofs must
already be validated by the caller's private evidence adapter. It verifies
independent B leaderboard SHA and C snapshot/Report/Fight/actor attribution
via the existing KPI contract and never queries WCL or writes Sheets.
Its `safeToPublish` is **false** until 216 complete A jobs, 216 B exact
leaderboards and 21,600 attributable C rows are all independently witnessed.
This full-publish gate is intentionally stricter than useful partial KPI
preview; masked rows can remain null under the owner's accepted partial
reporting policy, but do not mislabel that as all-C complete.

## P0 read-only actual A verification (2026-11-02)

- Public product CI [#41454311294](https://github.com/degong2-code/wcl-fresh216/actions/runs/41454311294)
  **SUCCESS**, 72/72 offline suites including shared A projector and A/B/C
  independent KPI contract, at `260feb4b0f9e5722cbdc40a5936778320db3a431`.
- Private [PR #14](https://github.com/degong2-code/ai-project-lab/pull/14)
  added only a dormant-authorization-safe read-only projection job to
  the existing private runner; merged commit
  `9843631363ab71d056656222901bc1eb2b2736f3`.
- Private [Actions #41455182732](https://github.com/degong2-code/ai-project-lab/actions/runs/41455182732)
  **SUCCESS**. Read exact existing 9-alias source checkpoint HEAD
  `0c3fc4d6bd7e20694305835779c8c6574f491ee5` and recomputed all
  **36 real A jobs / 3,600 official TotalDPS ranks** via the shared source
  projector, then calculated 36 source KPI previews using the existing
  `summarizeFreshDpsJob` module.
- **Zero** B pages and C actor proofs are attached in this run because none
  was supplied from a same-scope attested store. Therefore all B-ranked
  BossDPS and five U:Y nonboss values are **null**, not guessed.
  `safeToPublish=false`; no new B/C completeness claim.
- The P0 job is read-only (`WCL=0`, Git writes=0, Sheets writes=0),
  while the private `REQUEST.json` remains `preview/approved:false`.
  All paid jobs SKIPPED. Next source index is 4; canonical historic C
  remains unchanged. This verifies **G1 actual A**, not G2 actual B/C.

## P1 next: one credible same-scope pipeline integration

1. Run the P0 projection read-only on the actual isolated 9-alias A checkpoint
   (36/216, 3,600 rows at `0c3fc4d6bd7e20694305835779c8c6574f491ee5`).
   Recompute hashes in the private Actions checkout; confirm no B/C claimed,
   no paid requests and no mutations. This is **real A**, not live B/C.
2. Refactor the existing **B plan and query** to accept a proven A cohort with
   its own B batch size (8 or 9, chosen independently), not hard-code the
   32-batch source plan. Preserve the current 8-batch legacy contract/tests
   and require exact source job-key/snapshot matching.
3. With a separately owner-authorized bounded live B request, read back
   official B rankings from *the same* date/encounter roster and attach
   exact matching C proofs only where evidence exists. Do not fabricate
   same-fight C from numeric-only or name-only coincidence.
4. Dry-run a single real A+B+C job through the already-tested KPI function.
   Require comparison with official WCL BossDPS and correct nonboss U:Y;
   test the difficult cases (revision changes, duplicates, masked actors,
   missing B page, B-ranked actor != A-ranked actor, partial top-N).
5. Only then use the global existing planner to coalesce residual Report/Fight
   queries, and evaluate total points and true end-to-end elapsed time.
   The measured Git overhead justifies an offline compact-state candidate,
   **not** abandoning the two remote commit boundaries around each WCL call.
6. Finally, perform owner-approved Sheets batchUpdate, validate RAW identity
   before and after the update, and read back U:Y. No automatic production
   publication based on a synthetic end-to-end test.

## Reusable completion gates

- **G0 (pure contract):** source alias 1/8/9 parity, saved rank hashes,
  full-export gate, B≠C rank order, null propagation, bad identity fail-closed.
- **G1 (actual readback):** immutable verified A rank rows, no WCL, no Git
  writes, no synthetic B/C claimed.
- **G2 (actual B/C):** same-scope official WCL BossDPS, same Report/Fight,
  unique actor and revision checks; observed cost, immutable evidence, restart.
- **G3 (full-source):** exact selected-scope A source complete, bounded
  ranked B and documented C coverage / reasons; no guessed KPI.
- **G4 (publication):** Sheets guarded write and post-write independent
  readback plus reversible audit receipt.

P0 G0 PASS alone is **not** G2/G4, and the existing canonical C
21,252/21,600 is not a new-cohort G2 attestation. Current paid WCL request
is `preview / approved:false`. None of this document authorizes a call.

## Performance and maintenance principles

- Avoid duplicate execution stacks and custom per-feature validators.
  Reuse the existing published Node.js modules, one state persistence
  boundary and the same evidence contract across tests and live runs.
- Keep run-specific roster, revision and immutable manifest identity in
  scope data; choose batch size based on measured throughput, not magic 8.
- Preserve the cost witness for every response and never automatically
  repeat a request with unknown charge or `IN_FLIGHT`.
- Evaluate unit performance using actual WCL response time, Git commit and
  readback time, checkpoint bytes and **end-to-end** wall time separately.
- Independent tasks may be batched for development; *charged requests* need
  explicit bounded owner authorization and durable remote attempt records.
