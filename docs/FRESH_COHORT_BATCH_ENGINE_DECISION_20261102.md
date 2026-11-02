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
| 9 | 24 | 2026-11-02 live 9-alias / 900-row WCL + private Git restart PASS |
| 10 | 24 | Planner potential; no advantage in count over 9 |

A 9-alias candidate reduces *HTTP request count* by 25% against
8 aliases. **It does not establish a 25% wall-time improvement.**
One 9-alias call was subsequently verified: 9.01pt and 900 durable ranks.
The limited data cannot prove total-run wall-time superiority or long-run reliability.

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

## New 9-alias live verification (2026-11-02)

- User explicitly approved **one** 9-alias WCL request and an isolated candidate
  private state. [Live Actions #41421723348](https://github.com/degong2-code/ai-project-lab/actions/runs/41421723348) **SUCCESS**:
  GraphQL calls 1; WCL `currentRequest.total=9.01`; 9 × 100 rank rows,
  1/24 source batches recorded; checkpoint version 3.
- Source batch `wallMs=3,020` includes HTTP plus result processing before
  final durable transition. It is **not directly comparable** to the earlier
  8-alias 954ms API round-trip-only observation, measured on another day.
- Actual private Git operations: **4 remote-verified commits**, cumulative
  `remoteGitCommitMs=7,371`; resulting private JSON checkpoint
  **160,624 bytes**. First operation includes initial reservation,
  immutable plan installation, IN_FLIGHT and result commit; subsequent
  batches typically involve only two state transitions.
- New candidate private branch `work/fresh216-engine-source-candidate-20261102`
  remote HEAD `7439426da8d3befacc420328659ba86a1447ef58`.
  Independently fetched checkpoint: 1 COMPLETED, 23 READY, 0 IN_FLIGHT,
  0 NEEDS_REVIEW, 900 original ranks, next batch 1.
- [Independent read-only Actions #41422256184](https://github.com/degong2-code/ai-project-lab/actions/runs/41422256184)
  **SUCCESS**: recomputed 9 snapshot SHA-256 digests from saved rank rows,
  checked 24-batch immutable plan and next index 1, 0 WCL and 0 Git writes.
- Approved request disarmed immediately (`preview`, `approved:false`)
  at commit `d415c5846d6eabaa0e1609e5677ac94072b8e88f`.
  No additional WCL call authorized. Historical 1-alias source and EXACT C
  21,252/21,600 are unchanged.
- The 9-alias request saves **25% of HTTP request count** versus 8-alias
  planning (24 vs 32) for this 216-job cohort. Actual aggregate elapsed
  time, point savings, Git growth, and failure rate require a longer
  measured run. A new 8-alias paired comparison would need another isolated
  source or stateless authorized probe.

## Next verification gate

1. CI-passed the bounded engine and verified its one 9-alias live operation
   with isolated private checkpoint and independent restart.
2. Next compare *measured full Action elapsed time*, private Git commit/write
   timing, and size growth for multiple actual batches. A new WCL run requires
   separate explicit owner approval and a fresh immutable request HEAD.
3. Retain current safe 9-alias checkpoint and test another bounded restart
   only after approval; do not automatically loop or rerun the completed wave.
4. Evaluate compact state index + compressed witnesses **only after** enough
   actual remote write timing evidence, preserving the exact same hashes,
   fail-closed transitions and independent readback.

No live paid requests, Sheets writes, public evidence publication or
canonical C promotion are authorized by this decision document.

## Implemented private-host boundary (deployed, paid mode disarmed)

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
- The reusable private Actions now has a reviewed, owner-gated
  `independent-source-bounded` job (PR #13 merged). One user-approved live
  9-alias operation was executed and then disarmed; the paid job is skipped
  under current `preview / approved:false` mode.
