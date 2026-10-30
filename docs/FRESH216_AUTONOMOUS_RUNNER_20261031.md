# Fresh216 — autonomous GitHub runner (no Work, no user-side terminal)

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
