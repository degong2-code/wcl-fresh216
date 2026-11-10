# WCL Analysis Platform — SQLite durable capture ledger and protected manual preflight V1

**Date:** 2026-11-10. **Scope:** stacked offline development on PR #36; new feature branch only, no merge/deployment/live WCL/Blizzard call/Secrets/points usage. The prior in-memory CAS design now has a concrete file-backed SQLite adapter. This is a **validated local storage implementation, not an already-provisioned production host**.

## What is implemented

`src/adapters/wcl-sqlite-capture-ledger.mjs` exports `openSqliteCaptureLedger({dbPath})` using Node 22's built-in `node:sqlite`. The caller must supply an **absolute path ending in .sqlite inside an existing directory**; in-memory and implicit temporary database paths are rejected. It creates only two compact tables:

- `capture_heads` — one current head per source namespace + expansion ID: exact canonical JSON and its SHA-256 digest
- `capture_admissions` — **globally unique** capture-set ID in the same physical SQLite database, plus signer ID, registry digest/revision, signed payload digest, generation, issue timestamp and resulting head digest. A global unique signed-payload digest is enforced as well.

No raw WCL/Blizzard payloads, original client captures, OAuth tokens or private signing keys are written into this database. The caller remains responsible for protecting and retaining separately trusted captured source bytes.

The storage host exposes `initializeScope(expected)`, `readHead(expected)`, `commitHead({expectedHeadSha256,nextHead,nextHeadSha256,registrySha256,signerId})`, `readAdmission(captureSetId)` and `close()`. `initializeScope` is a **manual one-time** genesis operation. It returns `created:false` for a pre-existing scope and never wipes or resets admitted history.

`commitHead` performs a concrete SQLite `BEGIN IMMEDIATE` transaction: validate the current recorded head and prior audit row, compare the expected old hash, check monotonically increasing generation/issue time/registry revision and unchanged registry SHA within one revision, reserve the globally unique capture ID + signed payload hash, update head with a conditional WHERE old-hash match, and commit. Failure rolls back both writes. The callback acknowledges success only after reading the committed head and audit row back. `PRAGMA synchronous=FULL` and rollback journal `DELETE` are explicitly required. `readHead` rejects a digest-corrupt or malformed record instead of regenerating genesis.

`src/adapters/wcl-capture-trust-governance.mjs` now forwards independently validated `registrySha256` and `signerId` into the existing injected CAS callback for durable audit history. Existing legacy in-memory callbacks can ignore these extra fields without breaking the prior contract.

**Offline trusted-host usage (illustrative):**

~~~js
import {openSqliteCaptureLedger} from './src/adapters/wcl-sqlite-capture-ledger.mjs';
import {admitGovernedSignedWclCapture} from './src/adapters/wcl-capture-trust-governance.mjs';

const ledger = openSqliteCaptureLedger({dbPath: '/trusted/local/durable/captures.sqlite'});
try {
  // Operator-owned initialization of each genuinely new scope, once:
  ledger.initializeScope({sourceNamespace: expected.sourceNamespace,
    expansionId: expected.expansionId});
  // A fresh head is read for EACH attempt. SQLite CAS handles concurrent
  // readers trying to promote the same previous generation.
  const priorHead = ledger.readHead(expected);
  const result = await admitGovernedSignedWclCapture({
    signedBundle, registry, registrySha256, priorHead,
    commitHead: ledger.commitHead, expected, readCapture, nowMs
  });
  // Keep only the sanitized governance receipt and offline scope evidence.
} finally {
  ledger.close();
}
~~~

This snippet does not create keys, authorize a capture or provide an authenticated network transport.

## What was actually tested

`tests/wcl-sqlite-capture-ledger.test.mjs` creates **real on-disk SQLite databases**, not in-memory mocks. Tests verify:

1. Explicit genesis; reopen without reset; complete signed capture → existing governor → real SQLite CAS → audit readback.
2. Reopen in a **different Node process** with the same file; persistent head and ID lookup.
3. Exact replay and an older capture ID returning **after a newer different ID** — the global unique index rejects both; multiple namespace/expansion scopes sharing this database cannot use the same capture ID.
4. Two separate DB connections racing with stale prior state — one CAS wins, the other is rejected without pretending the database is corrupt.
5. A SQLite trigger that aborts the head UPDATE — the preceding audit INSERT is also rolled back; subsequent admission succeeds after the fault is removed.
6. Audit signing registry digest, monotonic revision, duplicate signed-payload digest, invalid transitions, tampering/corruption, incompatible SQLite schema, and no raw payload columns.

The dedicated `.github/workflows/wcl-platform-sqlite-ledger-offline.yml` performs these file-backed tests plus all existing offline core regressions in credential-free GitHub Actions. **A GitHub-hosted runner's temporary filesystem is ephemeral** and does not persist between separate runs. The CI proves real SQLite file semantics during one run and child-process reopen, **not** operational cross-run durability.

Node 22's built-in `node:sqlite` is still flagged experimental by the runtime used by CI. Upgrading or hardening this runtime is a separate production host acceptance check; its observed CI PASS does not certify an unattended multi-host database architecture.

## WEQUIP pattern reused for a manual preflight, not for source collection

Read-only investigation of the user's active [WEQUIP private-source test runner](https://github.com/degong2-code/WEQUIP/blob/work/private-source-runner-20261031/.github/workflows/private-source-focused-tests.yml) and [operations guide](https://github.com/degong2-code/WEQUIP/blob/work/private-source-runner-20261031/docs/private-source-runner/README.md) confirmed a useful gate pattern: pinned checkout, `workflow_dispatch` only, one protected named GitHub Environment with reviewer approval and deployment disabled, shortest-lived minimal secrets, sanitised receipts, and explicit TEST_ONLY ≠ production.

`.github/workflows/wcl-platform-protected-capture-preflight.yml` prepares the **offline-only** part of that pattern:

- Manual `workflow_dispatch` with one fixed input: `offline-sqlite-only`. No push/PR/schedule automation; branch guard enforces the public repository's `main`.
- `contents:read`, pinned checkout, no persisted credentials, fixed synthetic SQLite/key-governance tests, no secret reference, no upstream access, no artifact upload.
- The job declares protected environment `wcl-platform-capture-preflight` with `deployment:false`. It checks the environment-scoped variable `WCL_CAPTURE_PREFLIGHT_READY=OFFLINE_TEST_ONLY_APPROVED_V1` before any repository checkout or test and fails if absent. **This flag is an additional safety guard, not a replacement for real environment protection/reviewers.**
- Runbook prerequisites *before any manual dispatch*: owner explicitly creates the named Environment, configures required reviewer(s), limits allowed deployment branches to `main`, and sets that readiness variable **in the environment only**. GitHub can auto-create a missing environment without protective rules; do **not** run on an unconfigured environment. No keys or WCL/Blizzard tokens are required for this test-only workflow.
- Because the workflow is currently only in an **unmerged feature branch**, GitHub's standard Actions UI may not offer the manual dispatch until it is included on the default branch. **No manual protected run is claimed.** Separate offline push CI verifies its static policy contract.

## Production constraints still open

- The local database must reside on a durable **trusted local volume** with restricted file permissions, backup/restore, snapshot rollback prevention and single-writer/locking guarantees. A fresh runner, deleted file, restored old database backup, or multiple uncoordinated SQLite copies destroy global capture-ID uniqueness. A real multi-host operation requires a properly designed shared transactional store or a single trusted host.
- The current metadata JSON and signing registry require independently verified trusted upstream acquisition, private signing-key governance and a protected, persistent digest. Nothing here verifies WCL/Blizzard actually returned claimed bytes.
- Manual preflight performs **no live metadata probe**; do not add OAuth or API point-consuming GraphQL until explicit bounded authorization and a separately reviewed protected environment.
- Existing historical Apps Script source-dependent tests remain unavailable in bootstrap CI; targeted synthetic PASS is not L2 live discovery, L3 BossDPS/NPC certification, L7 zero-state collection E2E, or L8 cross-environment repeatability.
- Do not merge other stacked Draft PRs automatically; preserve the original evidence archives and the existing request-admission/Checkpoint code.

**Next practical steps:** prepare a trusted local durable directory and a reviewed protected Environment, verify crash/backup recovery and signing-key rotation against that actual host, and only then request bounded approval for real WCL metadata acquisition. No user Secrets should be pasted into chat or a public branch.
