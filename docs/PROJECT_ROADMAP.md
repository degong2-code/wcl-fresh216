# Fresh216 — outcome-led execution roadmap
Status: ARCHITECTURE / OFFLINE ONLY. This plan never authorizes WCL requests, Sheets writes, or collector restart.

## 2026-10-28 owner policy — NEW P0 after audited source recovery

**Read [RANKING_FIRST_RECOVERY_POLICY.md](RANKING_FIRST_RECOVERY_POLICY.md) before choosing another collector design.** The owner explicitly accepts unique report/fight/name with consistent available fight details as a same-actor match. Do **not** demand canonical actor ID for the existing direct path. Skip expensive Anonymous recovery by default; keep such TotalDPS-ranked slots in place and their BossDPS/U:Y unknown rather than reranking or estimating. Preserve legacy proof and original ranking metrics.

**New priority:** use existing TotalDPS top100 + BossDPS top100 snapshots, then extend **BossDPS rankings only, page by page** as residual named TotalDPS ranks warrant. A rank-300 ceiling assumes an unverified 100 entries/page; page size and metric correctness must be confirmed. Report-level fallback is secondary, not default. Existing 2,721 direct matches and 4,326 stored PROOF values should not be re-fetched just to reconfirm identity. Source snapshot 44/44 and historical standalone tests 75/75 already audited: repeating them without a new defect is wasteful.

**First next action (offline):** on the existing 44 private committed snapshots, compare the **1,605 non-direct stored BossDPS values** to that same job's BossDPS rank-100 cutoff, and partition the 74 null slots by Anonymous and other blockers. Report only aggregates, limitations and decision consequences; **do not claim rank200/300 recall or cost** from unavailable pages. Then design the smallest documented `characterRankings` page adapter and compare measured marginal points/elapsed time when a future **separate** live authorization exists.

All four previous authorized WCL GraphQL queries are spent; ordinary CI may only be offline. This policy supersedes older report-first / canonical-ID gate recommendations below wherever they differ.

## Non-negotiable outcome

For a selected difficulty, complete 8 encounter × 27 specialization = 216 jobs
at the original EXACT-100 ranking and same-fight/same-character BossDPS
semantics. Produce consistent 1st/30th/100th, top-30/top-100 and five U:Y
non-boss metrics on the existing RAW tabs. No approximated missing slots.

Optimize **actual total elapsed collection time and observed WCL API points**
with as little implementation and operational overhead as possible.
Historical 4 h 09 m 46 s is a baseline, not an arbitrary mandatory multiplier.

## Stop investigating historical progress by default

- Historical G4.13 evidence audit is CLOSED as a **read-only migration gate**:
  user-supplied sanitized workbook 44/44 committed/source SHA/RAW/U:Y parity;
  43 DONE (16 legacy exact100, 27 partial), 1 additional PARTIAL;
  4,326 legacy numeric BossDPS slots; no WCL calls or Sheet edits.
- The original 10-column PROOF ledger does **not** store independent per-rank
  actor IDs. Preserve numeric legacy provenance without falsely promoting it
  to new actor-level proof.
- Do not keep developing one-off G4.13/G4.15/G4.25 patches or repeatedly
  re-auditing the same 44 records unless a new defect or conflicting source
  proves that work necessary.
- Historic slots are **migration input**, not the KPI for new architecture
  success. The next success metric is one complete 216-job run.

## Workstreams by actual payoff

| Priority | Deliverable | Bounded acceptance | Known blocker |
| --- | --- | --- | --- |
| P0 | One 216-job **global** fetch graph, snapshot + revision + actor evidence join | Every pending slot mapped once; same Report/Fight reused across jobs where provenance permits; no EXTRA paid fetches for an already evidenced slot | real ranking/report shapes; different snapshot/revisions must not be merged |
| P0 | Measure rankings versus candidate report.table for **one** SAME-FIGHT case | exact actor/DPS/pet/denominator parity **and** observed points/wall-clock, failed request cost separately; keep rankings unless proven better | requires separate user approval for limited LIVE WCL call |
| P1 | One crash-safe run host (not one Apps Script wrapper per issue) | checkpoint before request, truthful point ledger, limited retries only when safe, stop/cancel/resume and progress; no duplicate charged work | persistence host/Google auth selection |
| P1 | Existing RAW A:T + U:Y publisher, batched | preflight identities/formulas/conflicts; only verified KPI cells filled; unchanged/unverified preserved; verify after write | Sheets adapter+permission; **not** part of this offline PR |
| P2 | Single-difficulty full pilot then 216-job end-to-end comparison | exact100/valid_partial counts, true measured points and wall time, failure/unknown coverage and missing slots; no speedup estimate from 43-job sample | after P0/P1 are real |

## Explicit decision rules

1. Correctness and provenance always precede cost. Never replace numeric
   EXACT-100 semantics with FAST samples to claim equivalent performance.
2. Favor **cross-job** reuse/one Report query over within-job micromemos. More
   GraphQL aliases/HTTP calls are not equal to more or fewer WCL points.
3. Keep improvements when their observed benefit outweighs code, quota,
   operational and maintenance costs. Avoid version proliferation.
4. Do not turn a historical legacy-proof read into a new actor-level witness.
   A source-consistent legacy value may only be retained under its own label.
5. Stop optimizing based on synthetic microtests alone. The first authorized
   WCL microbenchmark is a **decision experiment**, not a full rerun.
6. Do not deploy, merge, reactivate STOPPED cursor 43 or write Google Sheets
   without explicit user approval and a verified release gate.

## Workstream focus after the audit

Implement the **minimal batched U:Y write plan** as a pure offline boundary,
not another Google Sheets script. This is a secondary I/O optimization and
must not distract from the larger WCL point bottleneck. Next establish a
bounded query/cost parity experiment and choose the smallest durable host.

## P0 implementation proof — full-scope global graph (offline, 2026-10-27)

- `src/core/full-scope-plan.mjs` enforces exactly 216 distinct jobs,
  8 encounters, one fixed set of 27 class/specs across every encounter,
  100 unique ranks for every job, one snapshot per job, and one difficulty.
  Previously VERIFIED ranks can be skipped only when a complete
  source-fight/actor/revision witness is supplied, never because the old
  numeric PROOF row happens to be DONE.
- `src/core/report-wave-plan.mjs` groups identical pending Report/Fight
  evidence references and describes bounded report.rankings GraphQL waves.
  It validates one encounter/difficulty per report/revision/fight and retains
  the snapshot/actor candidate of every individual rank. Both modules are
  pure, without Google/WCL credentials or I/O.
- The synthetic fixture with **216 jobs × 100 ranks** deliberately makes 27
  specializations share each of 100 fights per boss. Under that artificial
  overlap it produces **800 unique Fight queries** from 21,600 rank references;
  waves of four fights would make **200 HTTP query documents**. These are
  *hypothetical plan cardinalities*, NOT observed WCL requests, API point
  savings, live WCL reuse ratios or completion-time predictions. Real rank
  overlap has not been measured by this test.
- The existing durable state machine checkpoints **one Fight per external
  request**. A multi-Fight wave requires a separate **atomic wave-level
  attempt journal** before any implementation may issue that HTTP request.
  Accordingly `readyForLiveExecution:false` is hardcoded in the wave
  plan. `waveJournalRequired` explicitly distinguishes nontrivial waves,
  and any observed points would be attributed to a whole wave, not divided
  across 4 fights by guesswork.
- Before any approved LIVE pilot, select either (a) one fight per request
  using the existing checkpoint, or (b) implement a single wave-level
  checkpoint and use bundles **only when same-fight semantics and measured
  WCL points justify the complexity**. Never batch solely to improve an
  HTTP-call-count headline.

This closes the **input-structure and deterministic global-graph preflight**
portion of P0. It does **not** close real cost/performance selection, paid
query parity, executor integration, progress/cancel, Google Sheets delivery,
or 216-job end-to-end correctness.

## P1 integration checkpoint — one-Fight durable run loop (offline, 2026-10-27)

The pure whole-216 snapshot preflight and global Fight groups are now
connected to a **minimal, bounded, single-Fight runtime boundary**:

- `src/core/single-fight-runner.mjs:executeOneReadyFight` accepts an injected
  transport callback, validates/builds an official-shaped WCL GraphQL query,
  **durably commits IN_FLIGHT before invoking transport**, decodes one response,
  validates same-fight/actor evidence, and atomically commits the result.
  An HTTP/GraphQL uncertainty, unexpected transport failure, or changed
  Report revision becomes `NEEDS_REVIEW`, never an automatic re-request.
  An interrupted post-response commit leaves IN_FLIGHT; subsequent manual
  recovery marks it NEEDS_REVIEW rather than resetting it to READY.
- `runBoundedSweep` processes at most 128 groups per invocation (default 16)
  using the **same checkpoint** across invocations; it returns cumulative
  confirmed/unknown points and reportable counts, supports cancellation
  **between** requests, and emits progress only after an operation commits.
  An uncertain response ends the current sweep without issuing another
  request. NEEDS_REVIEW entries prevent a misleading "all complete" label.
- Regression uses only synthetic transport responses and private temporary
  JSON checkpoint files. Includes persisted-state visibility inside the
  transport callback, process interruption, 429/504, response identity drift,
  partial actor coverage, already completed / resumed work, duplicate
  concurrent attempts, stop/cancel, and progress callback failure.
- This is **not yet a live collector**. No real WCL transport, OAuth/token,
  rate-limit scheduler or retry policy, production Google Sheets adapter,
  GUI, entire 216-job end-to-end benchmark, or automatic multi-Fight
  GraphQL operation journal is connected.
- This achieves a practical P1 *single-Fight* safety boundary without adding
  a second wave journal before a measured benefit exists. A future host may
  perform repeated bounded ticks behind one start button. The host must
  control actual API permissions, rate gate, persistent storage and user UI.

Continue prioritizing bounded semantic+cost evidence for the WCL query path
and selecting one simple end-to-end persistent host. Do **not** claim synthetic
CI improves real WCL points or wall time.


## P1 request-admission safety (offline, 2026-10-27)

- `src/core/request-admission.mjs` supplies a pure pre-HTTP decision from
  **actual witnessed points**, a caller-supplied nonzero per-request reserve,
  an explicit per-run point budget, and an externally determined `notBeforeMs`
  rate gate. It does **not** encode a WCL tariff, discover live rate limits,
  sleep, or send network requests.
- `src/core/single-fight-runner.mjs` now checks this admission before the
  IN_FLIGHT marker when a policy is supplied. `RATE_WAIT` and
  `BUDGET_PAUSED` are **zero-request / zero-checkpoint-mutation** outcomes.
  An already uncertain WCL request, unknown prior observed points, or
  IN_FLIGHT state prevents a new bounded sweep from dispatching untouched
  READY fights until reconciliation. A failed paid attempt and a blocked
  **pre-request** admission are explicitly distinguished in attempt counts.
- The caller's reserved points are a **planning parameter, not a guaranteed
  maximum WCL cost**. If the next real WCL operation costs more than reserved,
  its actual observed points must be recorded even when that exceeds the
  configured budget. No hard billing cap, future timing prediction or
  LIVE end-to-end speedup is established here.
- The gate is **optional for existing offline fixtures** and therefore does
  NOT authorize attaching an uncontrolled LIVE transport. Any future LIVE host
  must require a validated admission policy, retrieve official rate data,
  implement deliberate waiting and owner-controlled cancellation, and retain
  one durable checkpoint across invocations. Until then, branch is offline only.
- CI: 13 Node suites (124 test declarations) + 4 Python synthetic XLSX tests
  = **128 synthetic offline tests** (and the 500-case simulated legacy
  comparison nested in existing tests). Original 75 historic tests remain
  unimported.

Operational next decision remains **host plus source-of-truth rate witness**,
then user-authorized bounded WCL query/point equivalence test. Do not optimize
a theoretical HTTP count alone, and do not reopen the old 44-row G413 audit.

## P1 host + atomic budget ownership decision (offline, 2026-10-27)

- [Runtime host decision](RUNTIME_HOST_DECISION.md): one single-owner Node.js
  executor with a **private persistent volume**; local desktop or persistent
  VM is a deployment placement choice, not separate codebases. Codespaces is
  a dev environment, not an unattended runtime. No deployment authorized.
- The runner now re-evaluates **request admission inside the durable atomic
  state transition**, not only from a prior read. The checkpoint also refuses
  a second paid operation while an earlier one is IN_FLIGHT or has uncertain
  points, regardless of which Fight is selected or whether the caller uses
  the optional offline policy. Synthetic races explicitly simulate another
  worker consuming point budget after preflight but before the candidate
  request: the second request is blocked with **zero transport calls**.
- The existing JsonCheckpointStore still rewrites the entire state for each
  committed attempt. Do not promise linear-scale I/O: measure realistic
  21600-slot disk rewrite amplification offline before choosing another store.
  Retain simple files until a measured performance problem justifies a journal.
- Query accuracy and WCL points are not measured by these synthetic tests.
  The next material gate is a bound real same-fight/cost parity experiment
  **only after separate explicit user authorization**, then integrating the
  smallest single-process LIVE host with rate witness and secure persistence.


## P1 checkpoint-scale decision — CLOSED after paired CI measurement (2026-10-27)

- [Decision and numbers](CHECKPOINT_BENCHMARK.md): at synthetic
  21,600 ranked references, two durable transitions for a nearly complete
  Fight cost approximately **712 ms** in the original JSON store versus
  **708 ms** with a cached JSON variant and **1,045 ms** with a first
  append-only journal candidate (small CI-host samples, NOT a WCL benchmark).
- The cached variant had materially slower cold reads, and the journal
  candidate was slower throughout. **Neither was promoted.** Experimental
  source/tests were removed; the existing simple atomic-rename JSON store
  remains active.
- Benchmark can be reproduced on demand offline with
  `node tools/benchmark-checkpoint.mjs --samples=3`.
  It is intentionally excluded from recurring CI to conserve CI minutes.
- Do not chase additional checkpoint micro-optimizations absent real
  evidence that they dominate end-to-end 216-job runtime. Return to
  WCL query semantics, point/rate savings, durable host integration and
  secure batched Sheets delivery.

## 2026-10-27 WCL schema / point-system gate — new P0 factual dependency

- Official `RateLimitData.currentRequest` is `JSON!` (scalar): request it as
  `rateLimitData{currentRequest}`, not `currentRequest{total}`. Both
  single-Fight and inactive multi-wave query builders corrected; synthetic
  query-shape assertions passed CI. This is a schema fix, **not a live
  integration validation**.
- The WCL/Archon point-category beta announced 20 October 2026 distinguishes
  App, DB and User-Eligible charges. Rankings are marked **Database Points**;
  table is **User-Eligible** under a matching user OAuth grant. An old single
  `currentRequest.total` is NOT sufficient evidence of the three separate
  quotas, and existing offline admission is NOT authorized as a live quota
  controller until category counters are verified.
- [Bounded real-test decision protocol](WCL_2026_POINT_PARITY_GATE.md) and
  `src/core/wcl-query-comparison.mjs` prepare exactly two distinct same-Fight
  query documents **without executing HTTP**. Table DamageDone is NOT assumed
  equivalent to ranking BossDPS; semantics and actual category cost must be
  measured, not inferred from HTTP/aliases.
- Next external decision from owner: consent or refusal for a single known
  Fight, maximum two official GraphQL calls through user-owned credential
  path (no Sheets writes/restarts), accepting potentially charged points.
  User-login OAuth/PKCE to spend User points is a *separate* optional decision.
  No live requests without explicit approval.


## 2026-10-28 ranking-depth LIVE pilot — measured decision

- Common approved GitHub Actions measurement lane was implemented behind offline-PASS + exact add-only manifest + immutable consumed-ref gating. Code-only CI proved the paid job SKIPPED before activation.
- Approved current-global Heroic Nek'zali trial executed exactly 3 WCL GraphQL requests for Balance/Enhancement/Survival. TotalDPS page1 and BossDPS pages1–3 returned 100 rows/page.
- Exact same-fight recovery improved **148/300 on page1 → 185/300 through page2 → 205/300 through page3 (68.3%)**. Page2 added 37 and page3 added 20; 95 remained unresolved (93 named).
- Observed request totals were **4.01 points each, 12.03 summed**, with 831 ms summed GraphQL elapsed. This proves page2/3 are inexpensive and materially useful on this sample, but **rank300 is not an acceptable hard stop for EXACT-100**.
- Updated priority: ranking-first with measured marginal-depth continuation, then bounded official same-fight Report fallback for named residuals; Anonymous remains default-null. Do not build a complex universal ID system or discard a large named residual merely to eliminate Report queries.
- Current-global pilot is not the historical 2026-10-08..12 date-filtered scope. Compare production-equivalent scope before fixing a permanent page-depth threshold.


## 2026-10-28 dated BossDPS rank1000 LIVE pilot

- Scope: Heroic Nek'zali, Oct 22–28 KST, Balance/Enhancement/Survival, TotalDPS page1 fixed, BossDPS pages1–10.
- A stale forced `partition:1` attempt produced zero rows. Corrected execution omitted partition and used WCL's latest/default partition behavior.
- Corrected exact same-fight recovery: Balance 60%, Enhancement 92%, Survival 92%; aggregate **244/300 = 81.3%** through rank1000.
- Cumulative rank100/rank200/rank300/rank1000: **54.0% / 67.3% / 72.3% / 81.3%**.
- Rank300→1000 added 27 exact matches but still left **52 named + 4 anonymous** unresolved.
- Three corrected GraphQL requests reported 11.01 total points each, 33.03 summed, with 2.35 s summed GraphQL elapsed.
- Architecture decision strengthened: ranking depth is cheap/useful discovery, but **not a complete substitute** for bounded official same-fight Report rankings. Use adaptive marginal depth, then Report fallback for named residuals.
