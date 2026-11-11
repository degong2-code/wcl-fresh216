# WCL Analysis Platform — Full offline evidence admission acceptance V1

**2026-11-11 | TEST_ONLY | stacked Draft PR (parent #38)**

This slice closes an implementation/test coverage gap in the V2 path: previously the Ed25519 signature, WCL↔Blizzard identity evidence, SQLite CAS ledger and SQLite backup were verified in separate tests, but a single acceptance path had not proven the **whole sequence or the post-commit external-anchor failure boundary**.

## Exact flow

1. Acquire signed capture input **from an independently authenticated trusted host**. PR #39 does **not** add a WCL/Blizzard client, credentials, API-points budgeting or capture acquisition.
2. Read the current externally authenticated high-water anchor through host-injected `anchorHost.readVerifiedAnchor(scope)`.
3. Open the **already initialized** SQLite ledger, read its current head and demand **exact** namespace/expansion/generation/digest equality with the trusted anchor. Refuse to proceed if the anchor is older, newer, missing or forged.
4. Run the existing `admitGovernedSignedWclCapture`: verify trusted signer registry, signature, exact source bytes, schema-scope/role/journal crosswalk pins; record the signed capture with SQLite's durable CAS and global capture ID constraints.
5. Request the independent trusted host to atomically and durably compare/advance the high-water anchor from the prior digest to the newly committed SQLite digest.
6. **Read the independently verified anchor again** and confirm the new digest/generation exactly.
7. Only after steps 1–6 may `admitWithIndependentAnchor` return the admitted capture and a finalization receipt with `status:'LEDGER_AND_INDEPENDENT_ANCHOR_CONFIRMED'`. This receipt explicitly says `upstreamAuthenticated:false`; operator signature and local test proof do not authenticate real WCL/Blizzard endpoints.
8. A separate consumer may run the existing evidence policy, then optional read-only historical SQLite audit and anchored hot backup. No automatic production promotion.

The implementation is `src/adapters/wcl-anchored-admission.mjs`. It injects the existing `ledger` and a separately controlled `anchorHost`, rather than creating a GitHub action or local JSON source and incorrectly calling it an independent trust root.

### Failure boundary

**There is no general distributed atomic transaction across SQLite and an independent external anchor host.** If SQLite commits but anchor update/readback fails, the function throws one of:

- `ANCHORED_ADMISSION_DB_COMMITTED_ANCHOR_UNCONFIRMED`
- `ANCHORED_ADMISSION_DB_COMMITTED_ANCHOR_READBACK_FAILED`

No admissible capture bytes or finalization receipt are returned. The SQLite head may already be ahead of the external anchor. Subsequent attempts are refused by `ANCHORED_ADMISSION_LEDGER_ANCHOR_DIVERGENCE` **before reading captures**. Do **not** retry automatically, reset the ledger, overwrite the anchor, or fabricate a success receipt. An explicitly authorized operator must independently inspect complete SQLite history, archived signed capture and trusted anchor records and determine whether and how to reconcile.

The injected `anchorHost` must provide independently authenticated and strictly monotonic, compare-and-swap-durable operations. **An in-memory map, JSON file next to SQLite or a self-asserted signed JSON response is not sufficient for production**, and no such external service has been provisioned here. An attacker able to roll back both ledger and external anchor is outside this slice's verified guarantee.

### Tests

`tests/wcl-anchored-admission-e2e.test.mjs` uses synthetic Ed25519 keys and invented WCL directory/zones, Blizzard role and client Encounter Journal captures; a **real on-disk SQLite** file; a synthetic injected external-anchor CAS; existing `createTrustedCapturedEvidenceVerifier` + `buildEvidenceGatedWclPolicy`; SQLite hot backup, digest/anchor verification and DB reopen.

The 10 new end-to-end scenarios cover:

- End-to-end signed evidence → SQLite → independent anchor → DPS/raid classification → backup → restart → exact replay rejected
- Anchor CAS throw **after** committed DB: no promotion and further attempts refused
- Forged anchor acknowledgement; no durable anchor write; lost anchor readback
- Existing external high-water newer than DB; different expansion anchor; bad signature before any DB commit
- Two concurrent submissions and two sequential submissions

Dedicated `.github/workflows/wcl-platform-offline-e2e.yml` and the registered `tools/ci.mjs` suite execute this with synthetic data only. **GitHub Actions' ephemeral SQLite files and in-memory fake external anchor are not the user's operational WSL host.** Full Apps Script source-dependent historic tests remain excluded from this bootstrap CI.

## Prior artifacts remain unchanged

- PR #38: [anchored backups, SQLite audit, PowerShell WSL operator tools](https://github.com/degong2-code/wcl-fresh216/pull/38)
- PR #37: real SQLite durable CAS and test-only guarded manual preflight
- PR #36: signing key revocation and high-water policy
- PR #35: signed Ed25519 source capture admission
- PR #34: pinned bytes and WCL↔Blizzard identity crosswalk

No merge, live data query, OAuth/Secrets, WCL API points, production deployment, protected GitHub Environment configuration, or modification of original Report-wave/Checkpoint/C/KPI/Sheets has been performed.

## Next operational acceptance gates

1. **Choose the actual trusted host** and independently authenticated high-water anchor store; establish documented operator review, key rotation, backup retention and signed-capture provenance. A generic GitHub-hosted Actions runner is not a durable external anchor store.
2. **Run offline TEST_ONLY against the actual host**, including reboot/readback, lost-anchor acknowledgement and controlled recovery. Do not use synthetic success as evidence for real WCL capture authenticity.
3. Only after explicit separate authorization, run a bounded WCL/Blizzard **metadata-only** probe with actual source provenance, current schema/crosswalk validation and measured API-point usage.
4. Encounter-specific difficulty/partition evidence, NPC gameID and BossDPS correctness remain independent unresolved requirements; no old Fresh216 216-job defaults introduced.
