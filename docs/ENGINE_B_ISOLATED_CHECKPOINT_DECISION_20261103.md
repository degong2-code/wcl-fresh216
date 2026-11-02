# Fresh216 P1 — isolated B checkpoint, engine-first architecture

**Status:** implemented in public reusable core, offline CI verified. New
private B storage branch exists but **no B checkpoint has been initialized,
no paid B operation enabled**, and no real new-cohort B/C WCL evidence was
collected. Historical EXACT C is separate and unchanged.

## Objective and observed evidence

We are developing a configurable, reusable WCL collection, attribution,
recovery and KPI implementation **ENGINE**. Fresh216 (8 heroic bosses ×
27 specializations × exact Top100) is an acceptance test, not the product
architecture. Independently ranked B BossDPS must remain distinct from C
BossDPS for the original A TotalDPS actors matched by exact fight.

Actual A candidate is **36/216 jobs (3,600 ranks)** at private
`work/fresh216-engine-source-candidate-20261102` HEAD
`0c3fc4d6bd7e20694305835779c8c6574f491ee5`, source product SHA
`0d2c3de4d34ea7dccdba3d4f9a4326d8c0e34179`. That A is not
complete; B paid execution is **blocked**.

In a previous live A3-batch experiment the original JSON checkpoint grew
160,624 → 541,308 bytes; six Git remote-confirmed writes accumulated
10,676ms vs 7,503ms measured WCL transport+decode. The absolute Git costs
are observed, but these two phases alone do not establish full Actions
wall-time percentage or a single best optimization.

## Decision: immutable A read + compact B-only Git writes

Preserve the original A branch **as immutable evidence**, not as a copy in
every B transition. A standalone B branch
`work/fresh216-engine-boss-state-20261103` is created from a clean base,
without a B checkpoint file. Its future target is
`projects/wcl-fresh216/engine-boss/boss-checkpoint.json`.

- `src/core/fresh-boss-isolated-store.mjs`: in-memory virtual checkpoint
  adapter. It attests all 216 A jobs × 100 original rank witnesses, immutable
  snapshot digests, scope, source SHA, source manifest and source HEAD
  **before** generating the B state. It builds the existing independent
  8/9-alias BossDPS plan without duplicating A data on disk.
- Initial compact B checkpoint stores `bossSourcePin`:
  original A HEAD, source code SHA, scope, A state hash, source plan hash,
  source batch size and B batch size. It starts with no A `sourceRequests`
  and no B evidence. Every future read checks this seal and composes A+B
  in memory **only** for the unchanged `runOneFreshBossWave`.
- Every B update verifies A cannot be changed and strips all A source
  request rows before persisting. The existing `JsonCheckpointStore`
  atomically saves the smaller B state; the existing private
  `makeGitDurableStore` / `commitState(target='engineBoss')` must
  synchronously Git push and read back the remote HEAD before allowing the
  WCL transport callback.
- `bossAdmissionPolicy` uses the same generic
  `evaluateRequestAdmission` and subtracts confirmed historical A points
  by offsetting the total cap by **exactly the observed A amount**.
  Thus B's approved point budget applies only to B without forking the
  generic rate/admission logic or double charging historical A.
- A B result can legitimately contain B official BossDPS ranks and
  C same-fight Report/Fight/actor proof. These are **new B evidence**, not
  a copied TotalDPS A source. No inferred C, fabricated rank or automatic
  retry is permitted.

This design reduces **B checkpoint serialized A-data duplication**, not
the number of safety-critical remote commits per WCL request. It may
reduce Git blob sizes, pack processing, and remote I/O. Real remote
wall-time savings are **not yet measured**: the offline byte ratio is an
unpaired synthetic reference, not a network benchmark.

## Host and authorization

- `tools/run-private-github-fresh216.mjs` now allowlists
  `engineBoss` as a separate private state target. This does not
  enable GitHub Actions jobs.
- `tools/run-private-engine-boss-one.mjs` is a **dormant, unconnected**
  one-wave host. It requires exact owner `boss-one` approval,
  trusted Actions push SHA, original A HEAD, B state HEAD, code SHA, scope,
  B8 or B9 selection, max requests = **one**, explicit B-only point
  cap and reserve. It remote-confirms both A/B checked-out heads.
- The existing private workflow mode selector **does not recognize
  `boss-one`**; user request remains `preview/approved:false`.
  Consequently the dormant host is not runnable as an approved paid
  Actions job. It must not be activated while the A scope is incomplete.
- At source 36/216, even an authorized host call would reject the
  incomplete A **before any B state write, OAuth, or WCL request**.
  Real branch readback and user approval remain separate gates.

## Regression and completion contracts

`tests/fresh-boss-isolated-store.test.mjs` covers:
A8/A9 → B8/B9 independent plan, compact serialized B bytes,
all 216 A jobs required, changed A HEAD or rank SHA rejection,
B plan or pin drift, simulated remote write failure before HTTP,
B-specific observed-points budget pause, uncertain HTTP result halting
automatic retry, exact 900-row B and C proof, and restart with zero replay.
It also tests the B-one owner/context/source/state/code-SHA authorization
predicate.

**P1 isolated-state proof complete:**
- Product [offline Actions #41474937887](https://github.com/degong2-code/wcl-fresh216/actions/runs/41474937887)
  **SUCCESS, 76/76 pure-core suites PASS**, pinned implementation SHA
  `ff440d8212769d516fdbae0d3ee32cd8db01649f`.
- Private [PR #17](https://github.com/degong2-code/ai-project-lab/pull/17)
  read-only workflow change manually inspected and merged in
  `fce7bf611a48beca865e7fdeecf116a3e9cd5ab3`.
- Private [Actions #41475552524](https://github.com/degong2-code/ai-project-lab/actions/runs/41475552524)
  new `fresh-boss-isolated-checkpoint-readonly` job **PASS**. Actual
  36/216 A, 3,600 verified rank rows, next index 4; isolated B private
  branch still at `c89bc6a5130fb2f81fd5a98445ab187725b099ae`,
  with **no B checkpoint file**. Initializing paid B fails with
  `BOSS_ISOLATED_REQUIRES_COMPLETE_A`. No WCL, Git state writes or Sheets
  writes; all paid jobs SKIPPED.
- Result establishes strict real-A admission refusal and the disjoint
  storage path. It does NOT benchmark real remote Git B write latency,
  certify a full A scope or authorize B paid execution.

**Next milestones:** (1) complete/attest A 216/216 under separate
owner-approved bounded source execution; (2) compare compact B vs any
alternative storage only using measured Git remote writes; (3) review and
install an initially dormant authenticated B-one Actions workflow once
full A is proven; (4) only after explicit bounded approval, collect and
independently read back one real B wave and original-fight C proofs;
(5) verify full A/B/C→KPI→Sheets dry-run before any publication.

We have deliberately **not** added a second WCL collector, separate
checkpoint state machine, new KPI formula or speculative journal. The
implementation composes existing proven functions; further optimizations
must first be backed by measured cost and parity tests.
