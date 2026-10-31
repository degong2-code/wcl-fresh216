# Fresh216 — autonomous GitHub runner (no Work, no user-side terminal)

> **2026-10-31 integration update:** PR [#21](https://github.com/degong2-code/wcl-fresh216/pull/21) remains OPEN/DRAFT on `work/fresh216-adaptive-archive-delta-20261031`, current code head `5c85eb0e4aef84ba655ea09f0d9c4424698fbe82`. The offline implementation now connects the existing adaptive one-step runner, Report-wave checkpoint, private raw-byte witness, atomic public archive/manifest publisher, PR #19 Archive-to-C bridge, and existing C-delta v1 adapter contract. It does **not** activate collection or promotion.

## 2026-10-31 current integration status

### Verified
- Public Offline Core Actions [#41184977305](https://github.com/degong2-code/wcl-fresh216/actions/runs/41184977305): **SUCCESS**, 56/56 offline test suites, zero failures.
- Dedicated C-delta adapter Actions [#41183603570](https://github.com/degong2-code/wcl-fresh216/actions/runs/41183603570): **SUCCESS**; existing codec 3/3 and archive adapter 4/4 synthetic tests.
- `runPrivateAdaptiveStep` invokes the existing `runOneAdaptiveStep` under the private single-owner lease; it creates no second scheduler or checkpoint.
- `makePrivateWclTransport` is lazy. Constructing it performs no network call; OAuth exchange begins only when the runner invokes the transport after its durable IN_FLIGHT transition. Report-wave request text is sent unchanged, and Fetch response bytes are retained for private witness hashing.
- `derivePinnedFresh216SourceSlots` verifies `sha256(sourceState.sourceRequests) === SOURCE_SHA256`, re-exports the immutable A slots with `exportVerifiedFreshCohort`, and rejects a caller-supplied slot projection that differs.
- `createPrivateFresh216EvidenceHooks` requires the existing C-delta source identity before constructing the private witness and evidence publisher.
- The private witness store uses create-only persistence and exact readback; its EEXIST race receipt preserves `waveId` so the same Report-wave checkpoint can reconcile idempotently.
- The public product branch contains the C-delta v1 codec and adapter source plus synthetic tests solely to use the approved public-repository Actions allowance. No private A/B/C rows, raw WCL responses, credentials, tokens, or real actor evidence were copied.

### Explicitly not executed
- `public-one-wave-wcl-pilot` and `private-evidence-inventory` were skipped on the current PR branch.
- New WCL GraphQL requests: **0**; OAuth exchanges: **0**; observed new WCL points: **0**.
- Public actor archive writes: **0**; C-delta appends: **0**; canonical C promotions: **0**; Sheets/GAS writes: **0**; Secret changes: **0**.
- The private repository's Actions runner could not be allocated (jobs had no runner and no steps). This was an execution-environment failure, not a code-test failure; the same codec/adapter source and synthetic suites passed in the public product repo.

### Remaining gates before calling the engine integration complete
1. The concrete `createFresh216ArchiveCDeltaAppender` now verifies the pinned compressed base and contiguous existing delta chain, performs create-only append, and replays the full C union with `applyCDeltas` before returning. New rows bind response-body SHA, archive-wave SHA and archive-manifest SHA; legacy C-delta v1 rows remain readable.
2. The host still must load the real base bytes and existing 231-part candidate chain from the pinned private source, derive the verified priority map, and provide `getReportStateCommit` from an authenticated private state store. Those real private inputs have not been wired or exercised; public tests cover synthetic bridge/adapter contracts and fail-closed base preflight only.
3. Load the immutable A source checkpoint from the pinned private source commit and provision/verify the persistent private Linux volume; offline source derivation and host wrapper tests are not evidence of a provisioned production host.
4. Verify the dedicated HMAC key presence/minimum length without disclosing its value.
5. Only after the offline gates pass, request a new exact-scope v4 WCL authorization. C promotion and Sheets publication remain separate approvals.

The last authenticated read-only baseline remains C **21,252/21,600**, unresolved **348** (9 named + 339 masked), U:Y **861/1,080**. The current PR branch did not rerun the private inventory, so these are baseline figures, not a newly refreshed inventory.

---


Date: 2026-10-31. Stage: **public offline CI PASS; private inventory blocked pending dedicated read-only credential**. This is a deliberately restricted experiment, not public/private data integration or production deployment.

## Verified execution and immutable state

- Public branch: `work/fresh216-autonomous-host-20261031`.
- Workflow: `.github/workflows/fresh216-autonomous-host.yml`.
- First direct-push run: https://github.com/degong2-code/wcl-fresh216/actions/runs/41088248841 .
- `offline-core`: **SUCCESS**, runs `node tools/ci.mjs`, no WCL, Sheets, or private data.
- `private-evidence-inventory`: auth readiness step **SUCCESS**, but emitted `PRIVATE_INVENTORY_BLOCKED`; private clones and analyzer **NOT EXECUTED**. Overall workflow green is **not** evidence that private analysis passed.
- Source private state remains: canonical C `1ac4ab9aba8b0c1ad6479d8480c1902e58fdd075`, candidate `d56befacce6ff8062878ed3a4edec6a55cd91b07` (21,252/21,600), 348 unresolved.
- Trusted analyzer source pin `2c7806c35f2c21aecf57362f356e57f27f03f0a5` in **private** repository; host uses private Git checkouts pinned to immutable SHAs.
- No WCL, Google Sheets, paid private Actions, public raw proofs, artifact uploads, PR merges or canonical C promotions occurred during setup.

## One-time owner bootstrap (not solved by installing ChatGPT Github connector)

A public repository's default `GITHUB_TOKEN` cannot fetch another private repository. The ChatGPT GitHub connector token is **not** automatically available to the public hosted runner. The code cannot grant itself access to `degong2-code/ai-project-lab`.

Owner must create a **fine-grained personal access token** (or an equivalent short-lived GitHub App installation token) scoped to:

- Resource owner: `degong2-code`
- Repository access: **only** `ai-project-lab`
- Repository permissions: **Contents — Read-only**; leave all others at no access/minimum required metadata. Use a short expiration and rotate/revoke after work.
- Store the token **only** as Actions repository secret named `FRESH216_PRIVATE_READ_TOKEN` in **public** `degong2-code/wcl-fresh216`, via **Settings → Secrets and variables → Actions → New repository secret**.
- **Never paste token values into ChatGPT**, terminal logs, source, issues or Actions outputs.

This design grants a public runner temporary access to a private repo; this has a **real residual risk** if branch/workflow code or a third-party action is compromised. Until that tradeoff is accepted, keep the token **unset** and leave private inventory blocked. Do not create a secret with broader write permissions merely to automate the step.

After owner-only setup, ChatGPT can initiate the next **push** to the isolated branch and monitor the Actions run; no user Codespaces commands required. There is **no scheduled private run** and `workflow_dispatch` cannot run the private job because it is guarded to `push` only.

## Trusted execution boundary

- Trigger: **direct push** to one exact owner-controlled public branch. No pull requests, `pull_request_target`, `workflow_run`, fork checkout, untrusted user input, or public artifact reuse.
- Public `offline-core` uses `contents:read`, no secret, and `node tools/ci.mjs`. The private job is gated behind public CI.
- The gate checks only whether `FRESH216_PRIVATE_READ_TOKEN` exists. A missing secret means **no private checkout**; it must never be reported as private inventory PASS.
- Private checkouts use `actions/checkout@v4` with `persist-credentials:false` and immutable SHAs. Private-token scope remains Contents read-only. The analyzer is Node.js from the pinned **private** repository, with no WCL credentials.
- Private source A `39573a118f2a57f9dc6758936e9d73e9aa6cebf5`, C candidate `d56befacce6ff8062878ed3a4edec6a55cd91b07`, Report raw `5b302ee00483c1415fa9c3c73df43e8ac4f89dc1`, priority plan `811c4e67878f9b70e420fccb4ecf84301d211223`, product code `8bb96e64add3703a9c9d60c973754943b64d57be`.
- A separate author-approved private analyzer guard checks exact GitHub repository, branch, push event and Linux host. Credential bypass by spoofing `GITHUB_ACTIONS` is prohibited.
- Private analysis generates a temporary, *aggregate-only* JSON; host logs only selected count fields. No public raw payloads, Report code, actor names, fight/actor identifiers, API tokens, or private archive artifacts. Failed inventory prints only allowlisted error category.
- Read-only collection **never promotes a recovered candidate**. A candidate C remains a preview until identity and independent proof verification; A/B and existing 21,252 C proofs are immutable.

## Scope and limitations

This already automates ordinary public **development/test/CI** without a terminal. It does **not** yet complete a private evidence run, WCL collection, or Sheets publication.

Only after credential gate succeeds should the engine team decide whether to (a) reuse old Report bodies, (b) verify anonymous identity evidence, (c) compare one bounded live DamageDone fallback, and (d) append independently verified C proofs. Each paid fetch and Sheets change needs distinct authorization.

GitHub official references:
- https://docs.github.com/en/actions/concepts/billing-and-usage
- https://github.com/actions/checkout/blob/main/README.md#checkout-multiple-repos-private
- https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target
