# Fresh216 — no-new-PAT two-stage Actor-proof Archive relay

Status (2026-11-02): **offline contracts PASS; production staging and public publication NOT enabled**. Product PR #21 remains DRAFT. This plan reuses existing private Actions, public Actions, HMAC v1, the existing redacted archive format and the existing public atomic Git wave writer. It is NOT a replacement for the adaptive Report-wave engine.

## Decision: pull across the permission boundary

| Responsible runtime | Existing permission | May do | Must not do |
|---|---|---|---|
| Private `degong2-code/ai-project-lab` Actions | native private `GITHUB_TOKEN`, contents:write | HMAC-verify Report-wave output and stage ONLY redacted signed archive/manifest bytes in private Git, with Git remote SHA confirmation | Copy raw witness or credential to public Git; issue WCL on publishing retries |
| Public `degong2-code/wcl-fresh216` Actions | existing `FRESH216_PRIVATE_READ_TOKEN` from protected `fresh216-private-read` Environment, contents:read on private repo | Fetch only allowlisted stage files from an exact approved private commit SHA; verify SHA, strict schema, deterministic DPS replay and file paths | Expand read token permissions; clone or upload private raw checkpoint, source, WCL response or OAuth secret |
| Public product Actions publish job | its own native public `GITHUB_TOKEN`, contents:write | Atomically append the signed files and wave manifest to `fresh216-public-evidence-pilot-20261031` using the existing Git API commit/readback implementation | Write outside the approved evidence paths, overwrite existing files, run WCL, update canonical C or Sheets |

This avoids a NEW cross-repository write PAT, avoids copying HMAC into the public repository, and avoids moving WCL credentials to the public publishing job. It relies on keeping existing environment/branch protection and read-only token scope unchanged. The public workflow write ability to the dedicated evidence branch, including its Ruleset, still needs an authorized non-destructive configuration check before production enablement.

## Tested code

- `src/core/fresh216-actor-proof-archive.mjs`: `inspectActorProofArchivePublic` and `inspectActorProofWaveManifestPublic` validate strict redacted schema, content digests, deterministic arithmetic/actor replay and exact archive/manifest linkage **without HMAC**.
- `src/adapters/fresh216-signed-evidence-relay.mjs`: `preparePrivateSignedWaveStage` runs the genuine HMAC verification PRIVATELY and produces an allowlisted signed stage index plus exact JSON files. `inspectPublicSignedWaveStage` verifies the approved private SHA matches the checked-out SHA and every file digest/path/manifest link.
- `src/adapters/fresh216-public-actor-proof-store.mjs`: `createPublicActorProofArchiveStore({relayOnly:true,token,fetchImpl})` extends the existing single-wave atomic Git writer; accepts a pre-signed manifest only when an exact private commit is pinned; outright rejects HMAC-key injection and unsigned API calls. The original private HMAC-in-process mode remains intact.
- `tests/fresh216-signed-evidence-relay.test.mjs` and `tests/fresh216-public-actor-proof-store.test.mjs`: signed private staging, keyless public SHA/replay inspection, private commit mismatch, tampering, raw actor leakage checks, existing Git writer reuse, idempotent publication and fail-closed controls.

Evidence: public Offline Core [#41370988989](https://github.com/degong2-code/wcl-fresh216/actions/runs/41370988989), **63/63 suites SUCCESS**; no WCL call and no private/public Git data write during these tests.

## Trust and limitations

**No-key inspection is not cryptographic HMAC authentication.** Only the trusted private Actions runner knows the HMAC key and can check the MAC. Public Actions trusts that previously verified private stage and the manually approved immutable private commit SHA, then checks that the bytes are unchanged and that replay is correct. A public runner cannot verify MAC authenticity independently.

Stage index schema: `FRESH216_PRIVATE_SIGNED_WAVE_STAGE_V1`, with `waveSha256`, `sourceSha256`, `manifestSha256`, `privateReportStateCommit`, and allowlisted `files[path,sha256]`. Data paths MUST be `evidence/fresh216/actor-proof/<archiveId>.json` and `evidence/fresh216/waves/<waveSha256>.json`. No private roster/witness/raw report file may be staged.

The pure functions do not yet create durable private stage Git commits or fetch private stage files over the real GitHub API. Nor does any authorized public publishing workflow run the new relay code yet. **Do not report the handoff as deployed.** A real token-bearing public job remains blocked until stage persistence, immutable Git SHA approval, protected workflow review, Ruleset/Environment write permission validation, and a no-WCL rehearsal PASS.

## Required order before new WCL

1. Implement create-only PRIVATE staged redacted wave/manifest persistence + remote SHA readback under tightly scoped Actions permissions. Reuse Git persistence rather than adding another checkpoint engine.
2. Implement PUBLIC read-only pinned-commit fetch of only the stage index and allowlisted files using existing `FRESH216_PRIVATE_READ_TOKEN`; run the no-key inspector with no public writes.
3. Add a distinct protected PUBLIC job using the existing repo-native `GITHUB_TOKEN` for the dedicated branch; perform a non-WCL preflight and stage-only release dry run before any real publication. Require the owner's approval for initial actual Archive publication.
4. On verified public readback, resume the PRIVATE runner, verify C-delta private candidate remote commit and checkpoint confirmation. Do not infer C proof from a public manifest alone.
5. Only after all gates, separately scope the first live WCL Report wave (one of five READY named fights); 339 masked slots stay quarantined. Do not broaden WCL or public write authorization implicitly.

Baseline preserved: pinned A 21,600; Exact C 21,252; adaptive v1 5 READY fight groups; C candidate 231 historical parts and zero new production deltas; HMAC configured only in private repo; PR #21 OPEN/DRAFT; canonical/Sheets untouched.
