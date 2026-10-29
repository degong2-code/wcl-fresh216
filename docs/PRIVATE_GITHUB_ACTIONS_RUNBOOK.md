# Fresh216 — GitHub Actions private source collection runbook (2026-10-29)

> **Live state of this document:** The status-only private GitHub Actions job succeeded twice; the collector's private Git bridge passed the exact public SHA's offline CI. **Actual October 22–27 source collection remains 0/216 until confirmed by a private Actions receipt and private checkpoint.** Do not treat this document as permission for more than the expressly approved batch.

## Canonical topology

- **Public code (never raw WCL rows):** `degong2-code/wcl-fresh216`, developer branch `work/collector-architecture`. The currently pinned *runtime code* is **`7b1a075ad2663c8aa07734b7733cbe81bf9c6071`** (offline push CI: `40819689422`, SUCCESS). Later documentation-only HEADs must not silently repin an existing checkpoint.
- **Private GitHub Actions control:** `degong2-code/ai-project-lab` branch `work/fresh216-private-actions`, workflows `.github/workflows/fresh216-private-status.yml` and `fresh216-private-collect.yml`. This is the controller, not the state store.
- **Private durable state:** same private repository, independent branch `work/fresh216-private-source-state`, file `projects/wcl-fresh216/private-source/fresh216-checkpoint.json`. The private Git branch, not the ephemeral Actions workspace, persists the state. A fresh runner can reload it. The private Git history **contains prior checkpoint versions and may contain names, report codes and fight IDs once collection begins**. Private repository access, branch history and backups must be treated as sensitive; deletion of a file does not erase history.
- **Canonical handoff/developer notes:** private repo branch `work/wcl-fresh216-source-review`, `projects/wcl-fresh216/handoff/BOOT_PROMPT.md`, `CURRENT.json`, `TECHNICAL_CONTEXT.md`, and `../project.json`. These are sanitized instructions; always confirm current GitHub status rather than treating snapshots as live telemetry.

## Secret handling and authorization

- The owner reported that `WCL_CLIENT_ID` and `WCL_CLIENT_SECRET` were added to **private** `ai-project-lab` Actions Secrets. The values cannot be inspected here. Never place values, token responses or credentials in repositories, docs, logs or chat. Earlier public-repo Secrets do not grant access to private-repo Actions.
- Status-only workflow is triggered by updates to **its own workflow file** on the private control branch. It performs no OAuth, WCL HTTP or Sheets write. Verified run: https://github.com/degong2-code/ai-project-lab/actions/runs/40821278691 ; attempts 1 and 2 both SUCCESS. Initial private checkpoint version 0 was committed at state branch SHA `eeef6d19fe552067e06ad27934e8c50146c5d689`.
- Collection is triggered **only** by an exclusive commit adding exactly one new `projects/wcl-fresh216/requests/source-batch-NNNN.json` approval file on the control branch. Its contents must match the pinned product SHA, scope, `batchIndex` and maximum policy. Every additional source batch needs a separate explicit approval file. Do not treat the existence of the workflow as blanket live consent. No approvals should be committed together with documentation changes.
- Current per-batch authorization: at most **one** GraphQL request, cumulative observed-point budget 20, reserve 10. These values are admission controls, not a guaranteed absolute charge ceiling. OAuth token exchange is separate from GraphQL request count; network failures/unknown points are never interpreted as zero.

## Fail-closed sequence

1. Private Actions checkout exact pinned public runtime code, control SHA, and private state branch; verify no code or scope drift and next `batchIndex` equals the approved next batch. GitHub's ephemeral runner is allowed solely as a processing workspace because each state transition is pushed to private Git before continuing.
2. Read existing private checkpoint or, for status-only bootstrap, initialize once. Require checkpoint `sourceCodeCommit` equal to the pinned runtime SHA. Checkpoint schema=1, run scope `heroic:2026-10-22_27:latest:source`, difficulty=4, filter `date.1792594800000.1793113200000`, no partition argument, 8 bosses x 27 DPS specializations, EXACT100.
3. In collection mode, OAuth is obtained from private Actions Secrets. **Before GraphQL**, persist the request's `IN_FLIGHT` checkpoint transition in private Git; confirm remote ref matches the local commit. After the response, persist either completed 8x100 source rows or `NEEDS_REVIEW`. A failed post-HTTP push leaves remote `IN_FLIGHT`; on next attempt, refuse automatic retry or reset.
4. Review the **sanitized Actions receipt**, source job completion count, request count, actual observed points and source-state commit. Do not log or publish raw rows, actor names, report/fight IDs or access tokens. Test results are distinct from WCL live observations.
5. First acceptance: **8/216 durable jobs / 800 exact rows**, no `NEEDS_REVIEW`, known observed points; second independent read/restart verifies same checkpoint **without a second WCL GraphQL request**. Only then expand through the existing 32-batch source plan. Further BossDPS attribution and Sheets updates require their own contracts/approval.

## Stop conditions

- Missing/private Secrets, WCL non-200, data-shape/identity drift, missing ranks, exceeded admission limits, remote Git write conflict, unknown observed point cost, `IN_FLIGHT` or `NEEDS_REVIEW` **=> stop and inspect existing state**; no blind automatic retries or state resets.
- Avoid rebuilding an alternative state store, rerunning historical G4.x audits, promoting MOCK or CI PASS to LIVE collection, modifying operational GAS/Sheets, or merging Draft PR #2 merely to advance the source collector.
- **Owner PC/WSL2/PowerShell are no longer on the primary collection path**; retain as optional fallback, not a prerequisite. No extra Linux VM, Cloud subscription, self-hosted runner or local copy-paste loop is necessary.
