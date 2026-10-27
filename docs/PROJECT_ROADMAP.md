# Fresh216 — outcome-led execution roadmap
Status: ARCHITECTURE / OFFLINE ONLY. This plan never authorizes WCL requests, Sheets writes, or collector restart.

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
