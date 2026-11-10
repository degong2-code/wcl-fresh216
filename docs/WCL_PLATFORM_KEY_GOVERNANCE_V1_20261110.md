# WCL Analysis Platform — capture key governance and replay admission V1

**Date:** 2026-11-10. **Scope:** isolated draft feature stacked on Draft PR #35; pure Node.js, OFFLINE ONLY. This work adds no real credentials, signer private keys, WCL/Blizzard network client, persistent storage, collector mutation, Sheets data or Cloudflare deployment. All positive proof fixtures are synthetic and do **not** prove any real WCL/Blizzard payload was acquired.

## Empirical cross-project review: WEQUIP

Consulted the existing, actively used public repository **`degong2-code/WEQUIP`**, read-only:
- [WEQUIP private-source runner manual](https://github.com/degong2-code/WEQUIP/blob/work/private-source-runner-20261031/docs/private-source-runner/README.md)
- [WEQUIP protected test runner](https://github.com/degong2-code/WEQUIP/blob/work/private-source-runner-20261031/.github/workflows/private-source-focused-tests.yml)
- [WEQUIP M1 offline smoke](https://github.com/degong2-code/WEQUIP/blob/work/private-source-runner-20261031/.github/workflows/m1-offline-smoke.yml)

Reusable, independently confirmed operating patterns:
1. Manual `workflow_dispatch` and a **preconfigured protected GitHub Environment** (no default-unprotected implicit environment), restricted to a pinned branch, with an approver and no deployment record.
2. Exact immutable source SHAs and allowlisted sparse-checkout paths; `persist-credentials: false`, public runner `contents: read`, pinned checkout Action commit and isolated test scope.
3. If a private source read is necessary, supply an expiring, fine-grained **read-only token** via Environment Secret only, then revoke it and delete the temporary secret. Never print tokens or upload raw private-source archives.
4. Publish only sanitized Actions receipts listing approved source hashes, test outcomes and **production-not-certified** status. A green TEST_ONLY workflow is not proof of downstream production correctness.

This branch **does not** modify WEQUIP or copy its code. It adopts these policy principles, not its workflow's production permissions. There is **no** live WCL capture workflow authorized here; the protected/manual capture workflow must be approved and securely configured before any actual WCL API points are spent.

## Rationale

PR #35 validates an operator-signed Ed25519 capture envelope and independently pinned source bytes. Alone it cannot prevent an old signed envelope being replayed after a key is compromised or retired, and it cannot persist a global sequence against concurrent processes. This slice explicitly separates **trusted key policy**, **signature verification**, **atomic replay ledger**, and **upstream authenticity**.

[The SLSA artifact verification specification](https://github.com/slsa-framework/slsa/blob/main/spec/verifying-artifacts.md) similarly requires independent trust expectations, signature verification and exact artifact/source identity checks. We make no SLSA level or official upstream-attestation claim; WCL capture is not a SLSA build artifact.

## New implementation

`src/adapters/wcl-capture-trust-governance.mjs` exports:

- `governanceDigest(value)` — deterministic SHA-256 of canonical JSON for external registry and ledger integrity pins.
- `makeGenesisCaptureHead({sourceNamespace,expansionId})` — explicit empty ledger header, to be **stored once by a trusted host**, not silently created on each admission.
- `admitGovernedSignedWclCapture({signedBundle,registry,registrySha256,priorHead,commitHead,expected,readCapture,nowMs,...})` — verifies independently pinned key registry; permits **exactly one ACTIVE Ed25519 signing key** per scoped registry, refuses revoked/retired/unauthorized keys, old registry revisions, revoked capture IDs, reused immediately preceding set IDs or non-increasing signed issue time. It calls the **existing** `admitSignedWclCapture` (PR #35) to verify signed metadata and raw captured bytes, then requests a trusted atomic Compare-And-Swap before returning admitted evidence.
- `isGovernedCaptureCurrentlyTrusted({governanceReceipt,registry,registrySha256,expected,nowMs})` — re-evaluates an **already trusted, externally persisted receipt** against current active signer and revocation list; cannot authenticate arbitrary untrusted receipt objects on its own. A retired/revoked key invalidates future use, but does not rewrite history.

### Trust registry

Only the host may provision the expected `registrySha256`. A signed capture **cannot** nominate or modify its trust root.

`WCL_CAPTURE_TRUST_REGISTRY_V1` fields are `sourceNamespace,revision,activeKeyId,keys,revokedCaptureSetIds`. Each key has `keyId,publicKeyPem,status` (`ACTIVE | RETIRED | REVOKED`), `validFromMs,validUntilMs,allowedExpansionIds`. Distinct identities, single active key and explicit expansion allowlisting are mandatory. Rotation creates a **new pinned registry revision**; rollback is rejected by the persisted ledger. Revocation can be applied to past capture-set IDs without deleting prior audit history.

### Replay ledger

`WCL_CAPTURE_GOVERNANCE_HEAD_V1` stores `sourceNamespace,expansionId,generation,registryRevision,lastIssuedAtMs,lastCaptureSetId,lastPayloadSha256`. The caller must supply the real previous head. A successful transition increments the generation and binds the new signed-payload digest and registry revision.

The **host-owned durable CAS** callback receives `{expectedHeadSha256,nextHead,nextHeadSha256}` and must atomically (1) compare the current durable head digest, (2) write the complete replacement, (3) acknowledge that exact head digest. Missing, stale, false, mismatched, or ambiguous acknowledgement **blocks admission**. This module cannot guarantee concurrency safety if the host lies about CAS or loses durable state; the tests use an in-memory CAS fixture only.

The returned `governanceReceipt` states `commitStatus:'CONFIRMED_BY_TRUSTED_HOST_CAS'`, signer/registry/payload/ledger hashes, scope and `upstreamAuthenticated:false`. It is **not a standalone cryptographically signed receipt**; independent verification requires an authenticated trusted-host ledger readback.

**Important limitation:** strictly increasing signed `issuedAtMs` and atomic head CAS prevent exact replay in one durable sequence, but this contract does **not** guarantee globally unique `captureSetId` values beyond the immediately preceding set. A production host must also enforce lifetime capture-set ID uniqueness when it persists the receipt. This is recorded as a separate acceptance gate; do not represent it as already solved.

## Negative and cross-project-aligned tests

`tests/wcl-capture-trust-governance.test.mjs` covers genesis, two successive admissions, identical signed-envelope replay, repeated last set ID, explicit key rotation, retired/revoked signer exclusion, revocation of earlier receipt, duplicate/ambiguous signing keys, registry digest tampering and revision rollback, two concurrent compare-and-swap operations, false/mismatched acknowledgements, byte substitution, forged signature, expired bundle, missing ledger, wrong scope and malformed receipt.

The dedicated read-only, branch-limited [WCL governance Actions workflow](../.github/workflows/wcl-platform-key-governance-offline.yml) runs all new/previous metadata and verification suites plus existing full offline core via `node tools/ci.mjs`; uses a pinned checkout SHA and no Secrets. It does **not** add a live-capture workflow, protected Environment, API client, WCL points cost or private file archive.

## Actual next milestones and operational approval gates

1. Specify a real, **protected, manually triggered** capture host using the WEQUIP pattern: checkout pinned source, no implicit unprotected GitHub Environment, narrow expiry-limited secrets, sanitized receipt, no raw sensitive artifacts or automatic retries of uncertain WCL consumption.
2. Implement a trusted persistent CAS ledger **and global capture-set uniqueness** backed by a real store. Verify crash recovery, concurrent admission and key rotation; never publish private source material into public Actions artifacts.
3. Provision independent signer/public-key governance, operator approval, protected registry digest and revocation process. No private signing keys or long-lived tokens go in public GitHub.
4. Independently verify the actual authenticated WCL+Blizzard capture path and ID crosswalk with a **separately approved, points-bounded metadata-only** run. Record exact request scope/cost. Until then, original-source authentication remains **NOT PROVEN**.
5. Only after verified real metadata and actor proof connect existing report-wave/Checkpoint, encounter difficulty/partition and phase/NPC BossDPS policy; protect old Fresh216 evidence and avoid hard-coded 216×100 assumptions.

**No merge, no real API, no secrets, no production promotion.**
