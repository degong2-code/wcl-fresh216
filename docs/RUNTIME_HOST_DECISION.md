# Fresh216 — runtime host decision (architecture, NOT a deployment approval)

Decision date: 2026-10-27. Status: **offline design only**.
Target: one selected-difficulty 216-job EXACT-100 run, correct source
provenance, minimum actually observed WCL points and completion time,
one user start, truthful progress/cancel, durable pause/resume.

## Chosen EXECUTION MODEL

**One single-owner Node.js process using the existing pure .mjs collector core
and an authorized private persistent checkpoint.** This is the *execution
model*, not a declaration that the user's Windows computer must stay on.

- **Pilot placement:** a user-controlled Node.js machine with a persistently
  writable **private** volume. This can be a local desktop or a small
  persistent VM. Do not buy a server or create paid infrastructure solely
  for a hypothetical performance improvement.
- **If unattended multi-hour collection is essential:** choose an always-on
  private VM/host after checking expected run frequency and cost. Avoid a
  requirement for a currently active ChatGPT conversation.
- **Codespaces:** development, source review, synthetic CI, private bounded
  local audits; **NOT** a reliable unattended collector host. Codespaces
  normally stop after inactivity, and even an active codespace has a
  maximum 12-hour lifetime according to GitHub.
  https://docs.github.com/en/codespaces/about-codespaces/understanding-the-codespace-lifecycle
- **GitHub Actions:** CI and disposable tests, not the source of truth for
  persisted job/secret state; do not schedule paid WCL collection there in
  lieu of a durable private checkpoint.
- **Apps Script:** keep existing Sheets-facing UI/output contract; avoid
  using hundreds of GAS tick triggers as the primary network runner. Google
  documents a six-minute execution limit and trigger daily runtime quotas.
  https://developers.google.com/apps-script/guides/services/quotas

## Required end-to-end boundary before LIVE approval

| Component | Current | Must exist to ship |
| --- | --- | --- |
| Source ranking snapshot | strict full216 preflight, offline | actual live rank snapshot acquisition, time filter and immutable scope proof |
| Global Report/Fight planning | offline, cross-job grouped | real source overlap measured and revisions revalidated |
| WCL GraphQL | envelope and injected mock transport | restricted OAuth transport, official response-shape parity, witnessed currentRequest costs |
| Admission & rate | atomic per-Fight guard, explicit point reserve, notBefore | **mandatory** admission for LIVE; official rate witness and controlled waits; no tariff assumption |
| Private state | per-operation durable JsonCheckpointStore, fail closed | one owner per scope; storage persistence/permissions tested; performance on 21600 rank slots |
| Retry/resume | READY only; IN_FLIGHT/review never blindly retried | user-visible reconciliation workflow; no uncertain duplicate charges |
| Job KPI | offline EXACT same-actor calculations | verified 216-job results and coverage; missing values stay null |
| Sheets output | pure U:Y batch plan | authorized batch adapter, guarded read/recheck and readback; existing RAW IDs preserved |
| Operator | bounded sequential sweep, progress callback, cancel between calls | one-start host control, progress screen, pause/stop/resume after host restart |

## Keep the implementation small

1. **Do not add a second execution stack in Python/GAS.** Keep the pure Node
   core, one process and one WCL client. The Sheets adapter remains a thin
   boundary, not an alternate collector.
2. **No speculative multi-Fight wave journal.** The one-Fight checkpoint is
   proven offline; wave batching requires *measured* correctness and point/time
   advantage to justify its extra crash-state complexity.
3. **Persist before HTTP**, fail closed on storage lock or uncertain response.
   Admission must be rechecked under the same serialized state update; two
   workers must not both reserve a stale budget.
4. **Benchmark checkpoint I/O at realistic scale before full 216 LIVE pilot.**
   The current JSON store writes the whole checkpoint every transition. That
   is simple and correct but may cause substantial write amplification as
   evidence grows. Measure it offline with 21600 slot shapes, rather than
   adding a database dependency from intuition. If too slow, use one
   minimal incremental durable journal/store and re-prove crash invariants.
5. **No running collector in ChatGPT or Codespaces merely to keep a session
   awake.** The machine running an authorized session owns its progress.
   ChatGPT only implements, audits and reports what the tools can verify.

## Outstanding decision facts

Unknown until a separately approved controlled WCL test:
same-fight `rankings` vs `table` attribution parity, observed API points,
real 216-job fight reuse, and rate waits. Do not describe 800 synthetic
fights / 200 hypothetical documents as actual performance.

Deployment, Google Sheets writeback, WCL live traffic, new infrastructure
billing, trigger changes, and merge remain outside authorization.
