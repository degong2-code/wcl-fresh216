# Fresh216 — no-new-PAT two-stage Actor-proof Archive relay

Status (2026-11-02): **offline end-to-end staging/pinned-read/atomic-public-writer contracts PASS; production redacted staging and public publication NOT enabled**. Product PR #21 remains DRAFT. This plan reuses existing private Actions, public Actions, HMAC v1, the existing redacted archive format and the existing public atomic Git wave writer. It is NOT a replacement for the adaptive Report-wave engine.

## Decision: pull across the permission boundary

| Responsible runtime | Existing permission | May do | Must not do |
|---|---|---|---|
| Private `degong2-code/ai-project-lab` Actions | native private `GITHUB_TOKEN`, contents:write | HMAC-verify Report-wave output and stage ONLY redacted signed archive/manifest bytes in private Git, with Git remote SHA confirmation | Copy raw witness or credential to public Git; issue WCL on publishing retries |
| Public `degong2-code/wcl-fresh216` Actions | existing `FRESH216_PRIVATE_READ_TOKEN` from protected `fresh216-private-read` Environment, contents:read on private repo | Fetch only allowlisted stage files from an exact approved private commit SHA; verify SHA, strict schema, deterministic DPS replay and file paths | Expand read token permissions; clone or upload private raw checkpoint, source, WCL response or OAuth secret |
| Public product Actions publish job | its own native public `GITHUB_TOKEN`, contents:write | Atomically append the signed files and wave manifest to `fresh216-public-evidence-pilot-20261031` using the existing Git API commit/readback implementation | Write outside the approved evidence paths, overwrite existing files, run WCL, update canonical C or Sheets |

This avoids a NEW cross-repository write PAT, avoids copying HMAC into the public repository, and avoids moving WCL credentials to the public publishing job. It relies on keeping existing environment/branch protection and read-only token scope unchanged. The public workflow write ability to the dedicated evidence branch, including its Ruleset, still needs an authorized non-destructive configuration check before production enablement.

## Tested code

- `src/core/fresh216-actor-proof-archive.mjs`: `inspectActorProofArchivePublic` and `inspectActorProofWaveManifestPublic` validate strict redacted schema, content digests, deterministic arithmetic/actor replay and exact archive/manifest linkage **without HMAC**.
- `src/adapters/fresh216-signed-evidence-relay.mjs`: `preparePrivateSignedWaveStage` runs the genuine HMAC verification PRIVATELY and produces an allowlisted signed stage index plus exact JSON files. `fetchPinnedPrivateSignedWaveStage` issues only GETs to an exact approved private commit and checks Git blob SHA, file hash/path and the strict replay contract. `inspectPublicSignedWaveStage` requires the approved private SHA to match the immutable source SHA. `publishPinnedPrivateSignedWave` is disabled unless explicitly authorized.
- `src/adapters/fresh216-public-actor-proof-store.mjs`: `createPublicActorProofArchiveStore({relayOnly:true,token,fetchImpl})` extends the existing single-wave atomic Git writer; accepts a pre-signed manifest only when an exact private commit is pinned; outright rejects HMAC-key injection and unsigned API calls. The original private HMAC-in-process mode remains intact.
- `src/adapters/private-signed-evidence-git-store.mjs`: create-only private HMAC-verifying stage writer on isolated `work/fresh216-private-redacted-stage`, with clean Git checkout and remote SHA/blob confirmation. Never writes raw witness, C-delta, or HMAC keys.
- `tests/fresh216-signed-evidence-relay.test.mjs`, `tests/private-signed-evidence-git-store.test.mjs`, and `tests/fresh216-public-actor-proof-store.test.mjs`: pinned private read-only API, Git blob readback, HMAC private verification, public SHA/replay inspection, wrong-commit/tampering/forbidden paths, local bare-Git private stage commit/restart and public atomic Git writer reuse.

Evidence: public Offline Core [#41371898503](https://github.com/degong2-code/wcl-fresh216/actions/runs/41371898503), **64/64 suites SUCCESS**. Private hosted Actions [#41372241146](https://github.com/degong2-code/ai-project-lab/actions/runs/41372241146) SUCCESS: empty real staging branch read-only bootstrap and synthetic staging+relay tests **11/11 PASS**. No WCL call and no production Archive/C/checkpoint write.

## Trust and limitations

**No-key inspection is not cryptographic HMAC authentication.** Only the trusted private Actions runner knows the HMAC key and can check the MAC. Public Actions trusts that previously verified private stage and the manually approved immutable private commit SHA, then checks that the bytes are unchanged and that replay is correct. A public runner cannot verify MAC authenticity independently.

Stage index schema: `FRESH216_PRIVATE_SIGNED_WAVE_STAGE_V1`, with `waveSha256`, `sourceSha256`, `manifestSha256`, `privateReportStateCommit`, and allowlisted `files[path,sha256]`. Data paths MUST be `evidence/fresh216/actor-proof/<archiveId>.json` and `evidence/fresh216/waves/<waveSha256>.json`. No private roster/witness/raw report file may be staged.

The private Git staging writer and exact-commit read-only fetcher are IMPLEMENTED and SYNTHETICALLY TESTED, **not yet run with a real signed wave**. The real private stage branch was initialized with a single `README.md` (HEAD `c89bc6a5130fb2f81fd5a98445ab187725b099ae`); zero actor archive/manifest/index files exist. No authorized production workflow is yet wired to the staging writer or public relay. **Do not report deployment.** A real token-bearing public job remains blocked until an approved immutable private stage commit exists, trusted workflow and branch protection, Ruleset/Environment write permission checks and a no-WCL end-to-end rehearsal PASS. GitHub branch API currently returns `protected:false` for both private stage and public evidence branches; resolve the actual Ruleset/branch protection policy before any live publication.

## Required order before new WCL

1. **Code PASS:** create-only PRIVATE signed wave Git staging and remote SHA readback contract. **Operational pending:** trusted protected Actions job must be wired and tested with the owner-authorized HMAC secret; branch is presently empty and no real stage commit exists.
2. **Code PASS:** exact-commit PUBLIC GET-only fetch, Git blob SHA, path, manifest and keyless replay checks. **Operational pending:** protected Environment job using existing `FRESH216_PRIVATE_READ_TOKEN` and a real approved private stage SHA, without any public write.
3. Add a distinct protected PUBLIC job using the existing repo-native `GITHUB_TOKEN` for the dedicated branch; perform a non-WCL preflight and stage-only release dry run before any real publication. Require the owner's approval for initial actual Archive publication.
4. On verified public readback, resume the PRIVATE runner, verify C-delta private candidate remote commit and checkpoint confirmation. Do not infer C proof from a public manifest alone.
5. Only after all gates, separately scope the first live WCL Report wave (one of five READY named fights); 339 masked slots stay quarantined. Do not broaden WCL or public write authorization implicitly.

Baseline preserved: pinned A 21,600; Exact C 21,252; adaptive v1 5 READY fight groups; C candidate 231 historical parts and zero new production deltas; HMAC configured only in private repo; PR #21 OPEN/DRAFT; canonical/Sheets untouched.
