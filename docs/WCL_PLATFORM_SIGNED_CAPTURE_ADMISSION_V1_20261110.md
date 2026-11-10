# WCL Analysis Platform — Signed offline capture admission V1

**2026-11-10 · Draft feature · offline only.** This slice stacks on PR #34, not public main. It provides a concrete **operator approval and immutable-byte integrity gate** for the captured-source verifier. It **does not** collect, authenticate to, or query Warcraft Logs, Blizzard, WoW clients, Google Sheets or Cloudflare.

## Trust model and explicit limitations

- **Trust root is out-of-band:** the invoking host supplies `trustedSigner.keyId`, a **trusted Ed25519 public key** in SPKI PEM, a source namespace, allowed expansion IDs and a bounded validity window. The signed payload contains **no alternative trust root**. The signing private key is **never required or loaded by this adapter**.
- The capture operator supplies a `WCL_SIGNED_CAPTURE_V1` envelope containing `payload` plus an Ed25519 signature over the UTF-8 bytes of `WCL_CAPTURE_SET_V1\n` followed by the deterministically serialized JSON payload. A distinct domain-separation prefix prevents treating an ordinary signature on some other document as an approval for this capture set.
- **Signed does NOT mean served by WCL or Blizzard.** A signature proves approval by the separately trusted capture-operator key, and SHA-256 pins protect evidence after receipt. The host must independently authenticate upstream TLS/OAuth responses and game-client exports and bind their provenance to the signed policy. An operator who signs fake captures can create internally consistent but false data. `upstreamAuthenticated:false` is deliberate, not a missing implementation detail.
- The bundle explicitly binds source namespace, expansion ID, locale, source refs, origin strings, endpoints, per-source SHA-256 and capture validity, a WCL directory+zones envelope, WoW client build for Journal exports, and any WCL→Blizzard spec-ID crosswalk.
- The operator-supplied `sourceRef` is a logical immutable reference, not a pathname. The injected `readCapture(ref)` must use a trusted external store. **No direct filesystem, network or Git reading** occurs here.

## Implementation

`src/adapters/wcl-signed-capture-admission.mjs` exports:

`admitSignedWclCapture({signedBundle,trustedSigner,expected,readCapture,nowMs,maxCaptureBytes?,maxTotalBytes?})`

It checks (1) signer permissions, algorithm and signature over canonical payload; (2) exact signed scope and expiry; (3) source pin metadata, duplicate ref and conflicting crosswalks; (4) the raw **bytes** of every allowlisted capture against its digest; and (5) per-blob and cumulative size bounds. Any failure aborts admission. It then returns:

- `wclPin`, `sourcePins`, `specCrosswalks`, `verifiedAtMs` for direct use with existing `createTrustedCapturedEvidenceVerifier`
- a bounded, memory-snapshotted `readCapture(ref)` that returns a new byte copy for every invocation; a modified external store or mutable caller buffer cannot contaminate this admitted session
- runtime-neutral digest functions via Node's `crypto`, but **no** network transport
- immutable `receipt` with signer ID, catalog and signed-payload SHA-256, byte and capture counts, scope and explicit `provenance:'OPERATOR_SIGNED_ONLY_NOT_UPSTREAM_AUTHENTICATED'`; no claim that NPC/BossDPS is certified

**Usage in a trusted host**, with `signedBundle`, `trustedSigner`, `expected` and `readCapture` all independently and safely provisioned:

~~~js
import {admitSignedWclCapture} from '../src/adapters/wcl-signed-capture-admission.mjs';
import {createTrustedCapturedEvidenceVerifier} from '../src/core/wcl-captured-evidence-verifier.mjs';
import {buildEvidenceGatedWclPolicy} from '../src/core/wcl-catalog-evidence-policy.mjs';

const admitted = await admitSignedWclCapture({
  signedBundle, trustedSigner, expected, readCapture, nowMs
});
const verifyEvidence = createTrustedCapturedEvidenceVerifier(admitted);
const policy = await buildEvidenceGatedWclPolicy({
  manifest: classificationCandidates, verifyEvidence,
  sha256: admitted.sha256Text, nowMs
});
~~~

The snippets above describe an **offline consumer**. They do not show or supply real credentials, public/private keys, sources or manifests, and cannot be used to authorize live queries.

## Signed envelope contract

`signedBundle` fields:
- `schema:'WCL_SIGNED_CAPTURE_V1'`
- `payload:{schema:'WCL_CAPTURE_SET_V1',captureSetId,sourceNamespace,expansionId,locale,issuedAtMs,expiresAtMs,wclPin,sourcePins,specCrosswalks}`
- `signature:{alg:'Ed25519',keyId,valueBase64}`

An independent `trustedSigner` supplies exactly `keyId,publicKeyPem,sourceNamespace,allowedExpansionIds,validFromMs,validUntilMs`. The caller supplies `expected:{sourceNamespace,expansionId,locale}` independently. This contract is purpose-built for existing `WCL_CAPTURED_DIRECTORY_AND_ZONES_V1` and `WOW_CLIENT_EJ_EXPORT_V1` captured formats; it is **not** an official Blizzard/WCL response shape or a purported platform API signature.

Strict admission presently supports: one WCL catalog bundle, zero or more Blizzard playable-specialization records, zero or more WoW client Journal exports. It refuses unknown source kinds, malformed/missing refs, duplicate identifiers, unsupported origins, name-changing current-source assumptions, unpinned spec crosswalks, incorrect region/namespace, source expiration and operator-signature drift. There is **no** live refresh or automatic retry of uncertain capture reads. Limits are explicit (default 500 KB/individual, 3 MB/total; hard caps 2 MB/individual, 8 MB/total), and no API-points estimate is fabricated.

**Source reference:** WCL documents the client-credentials API path `https://www.warcraftlogs.com/api/v2/client` and indicates GraphQL access requires OAuth. Reading its documentation in a browser is not equivalent to a live metadata proof. https://www.warcraftlogs.com/api/docs

## Tests and promotion scope

`tests/wcl-signed-capture-admission.test.mjs` generates **ephemeral Ed25519 keys in the test process**, signs synthetic captured catalog/role/client-Journal envelopes, and verifies positive integration with the prior evidence policy and negative conditions: untrusted public key, tampered payload, expired signer/bundle, namespace/expansion/locale drift, missing/tampered bytes, retained-memory isolation, ref duplicates, unsupported source, reverse/conflicting/unpinned spec crosswalk, noncanonical base64, wrong key family and byte-size limits. No live keys, WCL/Blizzard response bodies or real user logs are included.

The dedicated `.github/workflows/wcl-platform-signed-capture-offline.yml` workflow runs all targeted new/previous contracts plus `node tools/ci.mjs` with only `contents:read`. Never interpret a green synthetic suite as L2/L3/L7/L8 or real-source attestation. In the historical bootstrap, unavailable Apps Script source-dependent tests remain unexecuted.

## Next gate, separately authorized

1. Specify a trusted signing-authority lifecycle (who acquires WCL/Blizzard bytes, acceptable TLS/OAuth capture evidence, release signing, key rotation/revocation, immutable source retention and replay protection) without exposing keys.
2. In a separately approved trusted environment, perform a **bounded live metadata-only probe** with observed WCL API points. Compare the actual selected expansion/season data to public schema fields, and independently verify the WCL↔Blizzard ID/locale mapping.
3. Feed the authenticated immutable captures through this adapter and record signed admission receipts. Only then claim **real** metadata discovery. Encounter-specific difficulty/partition and NPC/BossDPS certification remain further independent gates.
4. No PR merges, deployment, raw data publication or dashboard release are implied by this slice.
