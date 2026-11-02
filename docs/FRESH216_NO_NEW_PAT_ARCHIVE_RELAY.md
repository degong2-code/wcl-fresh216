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


## 2026-11-02 trusted Environment access verified; public write scope unverified

- Ruleset \`fresh216-evidence-append-only\` (#26336785) is active for exactly
  \`fresh216-public-evidence-pilot-20261031\`, with deletion and non-fast-forward
  protections and no bypass actors. The earlier trusted-branch guard (#26227675)
  is still active and unchanged. Hosted GET-only audit
  [#41375049043](https://github.com/degong2-code/wcl-fresh216/actions/runs/41375049043)
  **PASS**; no production evidence writes.
- Protected trusted branch \`work/fresh216-autonomous-host-20261031\` merged
  one-file PR [#22](https://github.com/degong2-code/wcl-fresh216/pull/22)
  at \`9f9601e6ef2c9cb07b303e7ebbc631d9e23492b9\`. Trusted Actions
  [#41376743852](https://github.com/degong2-code/wcl-fresh216/actions/runs/41376743852)
  **PASS**: existing \`fresh216-private-read\` Environment read token was used
  to check out **only** the private signed-stage \`README.md\` at immutable
  \`c89bc6a5130fb2f81fd5a98445ab187725b099ae\`, verified commit and blob
  SHA. No raw WCL data or HMAC passed to the public job. This establishes
  trusted-branch *actual read-token access*, not an independent inspection
  of all Environment administrator configuration.
- Proposed job-level \`contents:write\` GET-only scope audit
  [PR #23](https://github.com/degong2-code/wcl-fresh216/pull/23)
  remains **OPEN/DRAFT, UNMERGED, UNEXECUTED**. A merge tool safety check
  blocked activation; do not circumvent it. Even a successful read-only
  \`GET /repos\` \`permissions.push\` check would *not* demonstrate a successful
  Git ref update under the target branch's Ruleset. Thus do not claim
  native public write permissions are production verified.

### Publication acceptance criteria — do not treat a Boolean as authorization

A future, explicitly authorized publication workflow must independently
enforce **all** of these conditions before supplying
\`publicationApproved: true\` to \`publishPinnedPrivateSignedWave\`:

1. Workflow file and executable code reviewed on the **protected trusted branch**;
   reject PR or fork event triggers, untrusted inputs, unexpected \`github.repository\`,
   \`github.ref\`, or unexpected job environment.
2. Owner-approved exact immutable private staging **commit SHA** and wave digest
   are bound to this invocation. An arbitrary 40-hex SHA passed by a caller
   is **not** an approval. The private staging branch is unprotected on the
   present GitHub plan; a commit's existence alone is not a trust proof.
3. Private HMAC authenticated the staged wave **before** private Git commit;
   public workflow may only read the approved private commit's strict index
   and allowlisted redacted files with the **existing read-only** credential.
   The public SHA/replay checker does not verify HMAC authenticity.
4. The public job's own \`GITHUB_TOKEN\` must be scoped to that job and the
   existing Ruleset must permit its **ordinary fast-forward** ref update.
   Neither global Actions default write access nor a broadened PAT is needed.
   Actual write capability remains **unproven** until one separately
   authorized real Git ref update and full readback.
5. Preserve current fail-closed create-only checks, no auto-retry on
   unknown Git outcomes, audit exact public commit/ref SHA and path+blob
   hashes after any write. A successful token preflight must never be
   confused with published evidence.
6. No automatic WCL, private C delta, canonical promotion or Sheets writes
   may be triggered by the publication job. Each retains its own approval
   and idempotent recovery procedure.

The public branch deletion/non-fast-forward Ruleset is **not** a content or
directory ACL: ordinary fast-forward commits remain possible. The production
workflow's content allowlist and independent code review remain essential.
Do not add another redundant synthetic test merely to re-prove an existing
64/64 offline suite or the actual trusted Environment read PASS.
