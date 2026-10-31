# Fresh216 redacted actor-proof archive v1

Status: **offline implementation only**. This document does not enable a WCL job, create an HMAC secret, publish actor-level rows, promote C, or write Google Sheets.

## Purpose and proof contract

The archive is a replayable, privacy-reduced projection of the paired official Report rankings already used by `resolveExactBossDps` and `crosswalkMaskedReportFight`.

Each fight archive binds:

- the pinned source A digest, wave digest, request-body SHA-256 and exact raw HTTP response-body SHA-256;
- Report revision, fight ID, encounter ID and difficulty;
- each source A slot's job key, rank, snapshot SHA, TotalDPS, class/spec and start timestamp;
- the complete DPS actor roster from both the TotalDPS and BossDPS ranking for that exact fight;
- the unique amount/class/spec/name match, stable report-local actor identity, collision checks and resulting BossDPS;
- observed WCL points, HTTP status and capture time.

The replay rules retain the current strict behavior: one TotalDPS candidate within 0.005, matching class/spec, matching name token when the source slot is named or has a `Player(n)` label, stable positive report-local actor ID or stable `Player(n)` for a masked slot, exactly one actor in each roster, and exactly one source-slot claim per actor. Missing or ambiguous identity remains `UNRESOLVED`; it is never converted to zero.

## Privacy and pseudonymization

The public archive deliberately omits raw `reportCode`, actor `id`, `actorRef`, and actor `name`. It uses domain-separated HMAC-SHA256 tokens for report, fight, actor and name references. Actor tokens are scoped to source digest + scope + report + revision + fight, so they cannot be used as a global player ID. The HMAC key is **not** the WCL OAuth secret.

Required production secret (not currently confirmed as configured): `FRESH216_EVIDENCE_HMAC_KEY`, at least 32 random bytes, stored only in the protected Actions environment. The corresponding key ID is `fresh216-evidence-hmac-v1`. Back up the key in a private password manager; without the old key, old archive MACs cannot be verified. Never commit the key, print it, or reuse the WCL client secret.

**HMAC is pseudonymization, not anonymization.** The archive contains exact TotalDPS/BossDPS amounts, rank, class/spec, fight ID and revision. Those values can be correlated with public Warcraft Logs pages to infer a player's identity. Therefore the archive store is implemented but is NOT wired into any live workflow. Explicit owner approval of public actor-level publication is required before calling `persistWave`. A private-only archive with public aggregate hashes is the safer alternative.

## Append-only persistence

`src/adapters/fresh216-public-actor-proof-store.mjs` provides create-only GitHub Contents writes on the dedicated result branch:

- per-fight: `evidence/fresh216/actor-proof/<archiveId>.json`;
- per-wave manifest: `evidence/fresh216/waves/<waveSha256>.json`.

Each file is HMAC/content-hash verified before write, created only when absent, then read back and compared byte-for-byte at the JSON serialization level and by Git blob SHA. A wave manifest is committed only after every per-fight archive has been created and independently read back. If a later archive write fails, already-written archives remain append-only, the manifest is absent, and the operation stops for manual review. No automatic retry or overwrite path exists.

The store uses the same job-scoped `GITHUB_TOKEN` Contents permission already isolated to the pilot job; it does not require a new GitHub PAT. The HMAC secret is separate and still needs owner setup.

## Important provenance limitation

`responseBodySha256` must be computed from the exact UTF-8 HTTP response bytes before JSON parsing. The v3 calibration did not preserve those bytes: its existing `responseSha256` is a digest of the parsed JSON object. The previous response was not archived, so the nine provisional matches from run #41153217467 cannot be retroactively turned into actor-proof archives or promoted to C.

Even for future archives, the redacted projection plus HMAC allows independent replay of the attribution algorithm and integrity checks, but does not let an outside reader re-derive the original WCL response hash without the original response bytes. The projection digest is a commitment, not a WCL signature. If source-level re-verification is required, a private raw/minimized witness archive must also be retained under a separately authorized private write path; no such write credential is assumed here.

## Offline verification

- `tests/fresh216-actor-proof-archive.test.mjs`: synthetic paired-roster replay, stable masked identity, cross-report/fight domain separation, duplicate/collision rejection, wrong revision/scope, tampering and wave-manifest linkage.
- `tests/fresh216-public-actor-proof-store.test.mjs`: create-only persistence, readback, no retry, tamper detection, partial wave failure and no premature manifest.
- No WCL request, GitHub secret, raw actor data or Google Sheets access is used by these tests.

## Promotion boundary

This archive format is not a C proof delta by itself. The existing private C delta still binds raw report code and actor reference. A separate reviewed private projection-to-C adapter is required before any archived result can change canonical C. Until that adapter and the source-provenance policy are independently verified, keep canonical C at **21,252/21,600** and U:Y at **861/1,080**.
