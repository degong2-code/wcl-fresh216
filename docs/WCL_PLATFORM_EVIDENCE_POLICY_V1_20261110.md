# WCL Analysis Platform — Evidence-gated catalog classification V1 (2026-11-10)

**Status:** New isolated, **offline-only** policy port + synthetic tests. No live Warcraft Logs or Blizzard API request, no official production attestation, no NPC/BossDPS policy certification, no deployment/merge. This branch stacks on metadata adapter PR #32 (SHA `f22e4b704f8ec5cc1efb52b0e9a7fb37974ed296`). The source collector/Checkpoint and public `main` remain untouched.

## Why an independent evidence gate is necessary

The public Warcraft Logs v2 GraphQL schema provides **WCL zone IDs and encounters**, but the `Zone` object does **not** expose a direct raid/dungeon classification; `GameSpec` does **not** expose DPS/tank/healer role. `Zone.difficulties` / `Zone.partitions` are zone-level support lists and do not certify individual encounters. `Encounter.journalID` provides a potential external crosswalk, not proof of a particular WCL zone's type or which season/phase a fight belongs to.

Reference schema:
- WCL Zone: https://www.warcraftlogs.com/v2-api-docs/warcraft/zone.doc.html
- WCL Encounter: https://www.warcraftlogs.com/v2-api-docs/warcraft/encounter.doc.html
- WCL GameSpec: https://www.warcraftlogs.com/v2-api-docs/warcraft/gamespec.doc.html
- WCL GameClass: https://www.warcraftlogs.com/v2-api-docs/warcraft/gameclass.doc.html

Potential separate authoritative evidence (not implemented or ingested):
- Blizzard's `/data/wow/playable-specialization/{specId}` Game Data API response contains a role type (historic Blizzard developer discussion, 2019). The exact current response, namespace and WCL↔Blizzard class/spec ID mapping still need validation. https://us.forums.blizzard.com/en/blizzard/t/wow-profile-api-specialization/1707
- WoW in-game Encounter Journal APIs return an `isRaid` flag for journal instances; do **not** assume a WCL zone ID equals a journal instance ID. A verified encounter `journalID` crosswalk and game/client version are required. https://warcraft.wiki.gg/wiki/API:EJ_GetInstanceByIndex
- One observed WCL ranking at a given encounter/difficulty/partition is scoped evidence only; it cannot certify *every* phase, partition, metric or season. A source-specific verifier for that combination remains a separate task.

## New implementation

`src/core/wcl-catalog-evidence-policy.mjs` exports:

- `buildEvidenceGatedWclPolicy({manifest,verifyEvidence,sha256,nowMs})` — validates a capped `WCL_CLASSIFICATION_POLICY_V1` manifest of **candidate claims**, hashes each exact WCL identity and value with its expansion/namespace, and invokes a **separately trusted verifier** for each non-expired witness. The verifier must return both the original source SHA-256 and expected claim SHA-256 with a bounded verification timestamp. A claim with `UNVERIFIED` status is never accepted. A forged/malformed verdict throws.
- `bindEvidenceGatedWclCatalogPort({policy,sourceNamespace,expansionId,queryGraphql,...bounds})` — can bind only a policy created in this process; it rejects mismatching endpoint namespaces/expansions **before GraphQL**. It reuses `createWclCatalogPort` rather than adding a new collector, query endpoint or checkpoint.

Allowed classification claim kinds:

| Claim | WCL identity pinned | Evidence-source category | Result if unverified |
| --- | --- | --- | --- |
| `ZONE_KIND` | zone ID + exact zone name + expansion/namespace | Blizzard Encounter Journal or WoW client journal attestation | `unclassified` |
| `SPEC_ROLE` | WCL class ID/slug + spec ID/slug + namespace/expansion | Blizzard playable specialization / client specialization attestation with independently checked crosswalk | **excluded** from confirmed DPS list |
| `ENCOUNTER_SUPPORT` | zone ID/name + encounter ID/name + `journalID` + expansion/namespace | WCL encounter/difficulty/partition-specific attested evidence | `difficulties:null`, `partitions:null` |

Each candidate supplies `evidence.sourceKind`, `sourceRef`, `sourceSha256`, `capturedAtMs` and `validUntilMs`. An entry is **not trusted** because the manifest includes a legitimate-looking URL, matching SHA or `VERIFIED` string: those are untrusted assertions until the external `verifyEvidence` has checked captured bytes and independently confirmed the claim/identity crosswalk.

**Explicit limitation:** this version does not implement `verifyEvidence` itself or ingest Blizzard/Warcraft Logs data. A caller that supplies a dishonest verifier could defeat the gate; production integration must use an independently trusted source reader/attestation mechanism with access controls. The synthetic verifier in tests demonstrates the *contract* only, **not official certification**.

The output `policyVersion` is a deterministic fingerprint (`ev1-...`) over accepted claims, witnessed source digests, scope and manifest version. Changed accepted evidence changes the catalog key, EnvironmentProfile fingerprint and downstream AnalysisScope hash. Expired/rejected claims are not applied; no retry or alternate inferential policy is introduced.

**Important non-goals:** this does not turn optional metadata observations into season-wide collection authorization. `AnalysisScope`'s rank depth still means coverage, not weakened proof. Certified BossDPS requires later phase/variant-specific NPC gameID validation and same Report/Fight/Actor evidence; no subtraction of non-boss damage. Cached historical A/B/C proofs and checkpoint schemas are unchanged.

## Verification and safety

[GitHub Actions #42794953630](https://github.com/degong2-code/wcl-fresh216/actions/runs/42794953630) at `4586f5b8418355033d2bc81ea4d2c9ef3259a43a`: **SUCCESS, 32/32 targeted tests PASS, 0 fail**. This includes 11 new evidence-gating cases, 8 metadata port cases, 3 port→profile→scope cases and 10 zero-state profile/scope cases.

New scenarios include exact scope-bound policy binding, negative/expired witness, digest and claim mismatch, tampered verdict timestamp, name/slug/journal drift, duplicate candidate, unsupported zone-level difficulty, changed policy fingerprint, Top-10/Top-100 proof-policy parity, zero requests on policy construction and no NPC certification. No real WCL, Blizzard, OAuth, private evidence, Sheets, C/Checkpoint mutation, Secrets or Cloudflare action occurred.

## Next required gate — executable trusted witness verifier

1. Independently confirm a specific Blizzard WoW API/client metadata payload for specialization role and journal instance category; capture provenance without personal data, identify WCL↔Blizzard ID mapping via documented IDs/`journalID`. Current official schemas must be inspected, not guessed.
2. Implement an isolated **read-only** verifier using captured immutable source bytes, digest readback, source-host identity and explicit WCL ID crosswalk. Add conflict, translation/locale and source-version regression fixtures.
3. If the data requires OAuth or consumes API points, obtain a separate user-approved bounded verification run. Never turn this offline policy port into a paid transport.
4. Certify encounter difficulty/partition evidence for the selected **time interval** and only then connect scope planning; NPC/phase/BossDPS certification remains a separate scoped gate. No platform L2/L3/L7/L8 completion claim until real checks pass.

**Promotion:** Draft PR only; no merge, no public `main` update. Keep older PR #21/#30/#31/#32 independent and current. No old 216-job assumptions introduced.
