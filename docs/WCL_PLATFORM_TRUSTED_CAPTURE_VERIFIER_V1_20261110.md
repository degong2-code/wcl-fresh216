# WCL Analysis Platform — Pinned capture and crosswalk verifier V1

**2026-11-10 / OFFLINE ONLY / not promoted.** This is a narrow implementation of the *injected verifier* required by [evidence policy V1](WCL_PLATFORM_EVIDENCE_POLICY_V1_20261110.md), stacked on PR #33. **No real Blizzard/WCL capture has been ingested or authenticated.** Tests use invented identifiers and synthetic byte payloads. Historical 216-job core, Checkpoint, C, Sheets, public main and Cloudflare remain untouched.

## Public API / effects

- `src/core/wcl-captured-evidence-verifier.mjs` exports `createTrustedCapturedEvidenceVerifier`.
- Required host-owned ports: `readCapture(ref): Promise<Uint8Array>`, `sha256Bytes(Uint8Array)`, `sha256Text(string)`, separately provisioned `wclPin`, `sourcePins[]`, `specCrosswalks[]`, and a trusted `verifiedAtMs`.
- Creates `verifyEvidence` for existing `buildEvidenceGatedWclPolicy`, which now passes the evaluation clock and candidate evidence capture/expiry times into the verifier. This is a backwards-compatible addition for earlier injected verification callbacks.
- No network client, OAuth, browser access, filesystem access, secrets, scheduling, live request, source download, collector reimplementation or storage mutation. A trusted host must supply all captured bytes and its pinned origins.

## Immutable WCL catalog evidence and explicit version binding

`wclPin` binds exact capture ref, SHA-256, endpoint `www.warcraftlogs.com/api/v2/client`, environment namespace, locale and acquisition/expiry clock. Its bytes are a **custom capture envelope** `WCL_CAPTURED_DIRECTORY_AND_ZONES_V1` containing both observed raw GraphQL `directory` and `zones` responses plus `sourceNamespace` and `expansionId`. The verifier checks the WCL schema projection, expansion ID, unique class/spec/zone/encounter IDs and **unique journalIDs within each zone**. This envelope is not itself an official WCL API response and is not created here.

A source pin independently binds its source type, immutable ref and SHA-256, provenance host/endpoint/namespace/locale, capturedAtMs, validUntilMs, and for WoW-client Encounter Journal exports a `clientBuild` pin. The captured JSON bytes must match the independently provisioned pin exactly. Evaluation clock must match the policy builder clock; candidate manifest timestamps must equal or be stricter than the trusted pin, never extend it. Expires/future captures are rejected. Unknown SHA, missing bytes, non-UTF8 JSON, duplicate IDs and oversized payloads fail closed.

**Integrity does not establish authenticity.** SHA-256 and a JSON provenance string only protect bytes against unnoticed replacement *after the trusted host has independently established their origin*. The host is responsible for secure acquisition, trusted capture registry, WCL/Blizzard authentication, client-export integrity and validating the crosswalk's provenance. A malicious or compromised host/fixture source can still produce internally consistent forged data. This PR does not claim signed, production-authenticated sources.

## Supported scoped claims

| Policy kind | Verified evidence and crosswalk | Decision |
| --- | --- | --- |
| `SPEC_ROLE` | Captured Blizzard `/data/wow/playable-specialization/{specId}` object `id`, `playable_class.id`, `name` and `role.type`; exact WCL class/spec ID+slug/name from independent WCL capture; separately pinned **WCL→Blizzard ID mapping** bound to both source digests; locale/endpoint namespace | `DAMAGE→dps`, `TANK→tank`, `HEALING→healer`, otherwise `UNVERIFIED` |
| `ZONE_KIND` | Complete WCL zone Encounter list, each `journalID` mapped uniquely to one WoW client `EJ_GetEncounterInfoByIndex` export, all belonging to the same `EJ_GetInstanceByIndex` instance, and `isRaid=true`; pinned client build and locale | **raid** only. Non-raid/partial/ambiguous mapping is `UNVERIFIED` |
| `ENCOUNTER_SUPPORT` | None. Journal is not proof of per-encounter difficulty/partition validity. | `UNVERIFIED` |
| NPC gameID / phase / `BossDPS` | None. | **Not certified** |

The WoW client export `WOW_CLIENT_EJ_EXPORT_V1` is an **operator-generated normalized evidence format** with `clientBuild`, `locale` and per-instance `journalInstanceID`, `isRaid`, `encounters[].journalEncounterID`. It is not the raw Lua API response. No assumption is made that a **WCL Zone ID equals a Blizzard JournalInstance ID**, or that WCL Spec ID equals Blizzard Spec ID.

**Source documentation:**
- WCL Encounter `journalID` is the Blizzard encounter-journal ID: https://www.warcraftlogs.com/v2-api-docs/warcraft/encounter.doc.html
- WCL class/spec IDs and slugs: https://www.warcraftlogs.com/v2-api-docs/warcraft/gamedata.doc.html
- Blizzard staff's published `playable-specialization` role sample with `role.type="DAMAGE"` (2019; current live payload still needs independent verification): https://us.forums.blizzard.com/en/blizzard/t/wow-profile-api-specialization/1707
- WoW Encounter Journal `EJ_GetInstanceByIndex` (`isRaid`) and `EJ_GetEncounterInfoByIndex` (`journalEncounterID`): https://warcraft.wiki.gg/wiki/API:EJ_GetInstanceByIndex and https://warcraft.wiki.gg/wiki/API:EJ_GetEncounterInfo

## Tests and limitations

`tests/wcl-captured-evidence-verifier.test.mjs` covers positive synthetic role and complete raid crosswalks; missing pins; modified bytes; mismatching class/spec ID, name or journalID; reverse crosswalk collisions; partial/nonraid/duplicated journals; expiry/capture-clock bypass; client-build mismatch; forged manifest timestamps; unimplemented support evidence; missing/oversized bytes; and non-execution without a trusted host.

`tools/ci.mjs` includes this test alongside existing offline core. Dedicated read-only GitHub workflow `.github/workflows/wcl-platform-trusted-capture-offline.yml` runs targeted tests plus all existing offline core suites. No Secrets or private evidence are mounted into this CI.

**Remaining gates:** independently trusted source import/attestation for Blizzard and WoW client build; actual current payload/namespace and WCL-to-Blizzard ID crosswalk certification; WCL Encounter Journal matching on a real selected environment; scoped difficulty/partition evidence; NPC gameID/phase and official BossDPS verification; authorized and rate-admitted live metadata checks; durable EnvironmentProfile/profile-diff readback; zero-state cross-season E2E. None can be inferred from successful synthetic tests. No merge or deployment requested.
