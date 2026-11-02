# Fresh216 Source batch-engine decision — 2026-11-02

## Scope and evidence boundaries

This work builds a **reusable execution engine**, not a migration of historical
TotalDPS evidence. No existing A or EXACT C is promoted or mutated here.

**Prior actually measured:**
- 2026-10-28: 8 GraphQL aliases for 8 specializations in **one** HTTP
  request; 800 first-page rows validated; **8.01 WCL API points** and
  **954 ms API round trip**. This first smoke did *not* persist raw rows.
  See `docs/LIVE_FRESH_COHORT_20261022_27_8ALIAS_PILOT.md`.
- 2026-10-29: private Actions 8-alias single batch, 800 rank rows
  persisted to private Git, 8.01 points, restart verified. See
  `docs/PRIVATE_GITHUB_ACTIONS_RUNBOOK.md`.
- 2026-11-02: a **different** isolated 1-alias source run made one real
  WCL request, **1.01 points**, 100 rows durably saved, 1/216 complete.
  Remote checkpoint `5079b68e288802fff13bbc03910ad300e4def8ba`
  and read-only restart PASS in private Actions `41414415941`.
  Original Exact C remains **21,252/21,600**, unchanged.
- The historical private full source checkpoint Git blob had an actual size
  of **43,267,342 bytes**. Repeated serializing, Git commit and remote
  readback may dominate *wall time* even if HTTP count is reduced. This is
  **not** a measured Git-push duration.

## What request grouping changes

For an immutable 8-encounter × 27-specialization cohort, requesting the
first 100 ranked rows for each specialization:

| Aliases per WCL request | HTTP batches per full 216-job cohort | Evidence |
| --- | ---: | --- |
| 1 | 216 | 1-call, 100-row live and private restart PASS |
| 8 | 32 | 8-alias live WCL request and remote private evidence PASS |
| 9 | 24 | Planner/offline synthetic evidence only; live point/time unknown |
| 10 | 24 | Planner potential; no advantage in count over 9 |

A 9-alias candidate reduces *HTTP request count* by 25% against
8 aliases. **It does not establish a 25% wall-time improvement.**
There is no current evidence of the 9-alias API point tariff, server latency,
response size in Git, or reliability. Do not assert one.

## Reusable batch engine

`src/core/fresh-cohort-bounded-runner.mjs` delegates each HTTP operation to
the pre-existing `runOneFreshCohortBatch`:
- A single owner-approved bounded invocation (1–32 requests), selected
  specialization alias count (1–10), and fixed observed-point reservation.
- Same immutable run-wide manifest, rank/character schema, checkpoint and
  WCL transport; **no second collector or journal**.
- Each request's `IN_FLIGHT` must be remotely committed and confirmed
  *before* transport. Completion is durably recorded *before* the next call.
- Initial plan installation is separate, and the **alias count is immutable
  after installation**. Requiring a different alias count calls for a fresh
  *isolated* run, not editing the current source or reallocating slots.
- On unresolved/uncertain outcomes or budget admission failure stop without
  automatic retry; nonzero observed point evidence is required for all
  committed jobs. Observed points are not a hard tariff cap.
- Return sanitized counts, next batch, points and accumulated batch wall
  time. Caller retains responsibility for trusted GitHub context, remote
  owner lease, immutable code SHA, explicit authorization and secure secrets.

Test contract: `tests/fresh-cohort-bounded-runner.test.mjs` compares the
8/9 planning envelope and tests all-216 synthetic source completion in
24 9-alias requests, crash/restart persistence boundaries, point-budget stop,
review-needed terminal state, and zero duplicate paid requests.

## What NOT to migrate from old runs

Do not revive the old 32-batch checkpoint by changing its batch size,
re-rank the 1/216 new source as though it were 9-alias evidence, or copy
old WCL actor rows into a fresh cohort. The single-file checkpoint is
preserved until an **actual Git remote write/readback benchmark** demonstrates
a better storage representation. The synthetic 2026-10-27 journal benchmark
did *not* show a win; see `docs/CHECKPOINT_BENCHMARK.md`.

## Next verification gate

1. CI-pass the **pure** bounded coordinator and source plan tests.
2. Prepare a **new private isolated 9-alias source run** with its own
   source run identity and blank checkpoint; never mutate existing 1-alias
   test or protected C.
3. Require separate explicit owner approval for any new WCL call. First
   compare **one 8-alias historic observed call** vs a separately authorized
   **one 9-alias live call** on a comparable scope, logging observed API
   points, server round trip, Git commit/readback wall time, and payload
   bytes. Past 8-alias timings are not paired contemporaneous measurements.
4. Only after measured results, choose 8 vs 9 and evaluate a bounded,
   serial multi-request Action with point stop and durable restart.
5. If remote Git is dominant, **then** prototype a compact state index plus
   compressed immutable batch witnesses, with exact restore and replay
   parity, rather than assuming append-only logs are faster.

No live paid requests, Sheets writes, public evidence publication or
canonical C promotion are authorized by this decision document.

## Implemented private-host boundary (candidate, not deployed)

- `tools/run-private-engine-source.mjs` now delegates both the old
  `source-one` and the new `source-bounded` operation to the shared
  coordinator. The one-shot path still hard-requires one alias and
  **one** request; no backward compatibility with 9-alias re-planning.
- `source-bounded` authorizes only 8/9 aliases and a separately bounded
  `maxRequests` from 1 to 8. Its new private Git target is the isolated
  branch `work/fresh216-engine-source-candidate-20261102`, which has
  a **different** scope and checkpoint path from the completed 1-alias run.
- Remote Git telemetry is captured inside the private host:
  `remoteGitCommits`, `remoteGitCommitMs`, and
  `privateCheckpointBytes`. These are aggregate timings and byte counts,
  not raw actor rows or credentials.
- Existing private Actions remains pinned to its **previous** public
  runtime SHA. This newer candidate is **not** an enabled paid workflow
  until a code-SHA-pinned dormant job is reviewed and explicitly approved
  per operation. No private test data or API calls were made by these edits.
