# WCL Platform — documented metadata adapter boundary (2026-11-10)

**Status:** Implemented, synthetic/offline contract **21/21 PASS**; **NOT live-WCL verified**. No approval to spend WCL API points, use credentials, promote data, merge code, or deploy. The product goal remains a season/expansion-independent reusable analytics engine, **not** a fixed 216-job Fresh216 repair.

**Stacked source:** this branch descends from `work/wcl-platform-environment-discovery-20261110-v1` (PR #31) at `98b30908c776b513d281beb73c03fc1d364f2559`, which itself is separate from existing PR #21. It does not alter old collector/checkpoint/KPI implementations or the published main branch.

## Verified public Warcraft Logs v2 GraphQL schema (documentation only)

- `Query.worldData` → `WorldData.expansions` / `WorldData.zones(expansion_id: Int)`. Documentation: https://www.warcraftlogs.com/v2-api-docs/warcraft/query.doc.html and https://www.warcraftlogs.com/v2-api-docs/warcraft/worlddata.doc.html
- `Expansion`: `id`, `name`, `zones`. https://www.warcraftlogs.com/v2-api-docs/warcraft/expansion.doc.html
- `Zone`: `id`, `name`, `frozen`, `difficulties`, `partitions`, `encounters`, `expansion`. https://www.warcraftlogs.com/v2-api-docs/warcraft/zone.doc.html
- `Difficulty`: `id`, `name`, `sizes`; `Partition`: `id`, `name`, `compactName`, `default`. https://www.warcraftlogs.com/v2-api-docs/warcraft/difficulty.doc.html and https://www.warcraftlogs.com/v2-api-docs/warcraft/partition.doc.html
- `Encounter`: `id`, `name`, `journalID`. https://www.warcraftlogs.com/v2-api-docs/warcraft/encounter.doc.html
- `Query.gameData` → `GameData.classes` → `GameClass` `id/name/slug/specs` → `GameSpec` `id/name/slug`. https://www.warcraftlogs.com/v2-api-docs/warcraft/gamedata.doc.html, https://www.warcraftlogs.com/v2-api-docs/warcraft/gameclass.doc.html and https://www.warcraftlogs.com/v2-api-docs/warcraft/gamespec.doc.html
- `rateLimitData.currentRequest` returns the API's observed request-charge JSON where supplied, not a predicted tariff. https://www.warcraftlogs.com/v2-api-docs/warcraft/ratelimitdata.doc.html

**Important negative schema facts:** the examined `Zone` type has no raid/dungeon category field; `GameSpec` has no DPS/tank/healer role field; no explicit season object or season ID is available in the examined `Expansion/Zone` path. Moreover, `Zone.difficulties` and `Zone.partitions` are **zone-level** support lists, not encounter-specific support evidence. It would be incorrect to manufacture any of these extra classifications from names.

## New implementation

`src/core/wcl-catalog-port.mjs` exports `createWclCatalogPort` and two fixed GraphQL query documents:

1. `PlatformCatalogDirectory` retrieves `worldData.expansions{id,name}`, `gameData.classes{id,name,slug,specs{id,name,slug}}`, and `rateLimitData.currentRequest`.
2. `PlatformExpansionZones` retrieves `worldData.zones(expansion_id:$expansionId)` with zone IDs/names/frozen status, documented difficulty/partition lists and Encounter IDs/names/journal IDs; also requests currentRequest.

A caller explicitly specifies `expansionId`, `sourceNamespace`, and an injected `queryGraphql(query,variables)` returning `{httpStatus,body}`. There is **no** `fetch`, OAuth, automatic retry, token source, scheduler, sleep, Secrets access, or endpoint wiring in this module. Its two sequential query invocations **could cost real WCL API points if a live transport were injected later**; this change never supplies such a transport or calls WCL.

The port returns the V1 normalized input expected by `discoverEnvironment`. Its `getLastDiagnostics()` exposes observation counts, unknown fields and `observedPoints`; unknown charge is `null`, never zero. A failed read clears any prior diagnostics before starting and emits no partially certified profile.

The official schema fields above are unpaginated list fields. This implementation **does not invent pagination**. It caps the number of expansions, zones, classes, specializations, encounters and the **serialized parsed-response length**; these checks occur after receipt and do not claim to bound the upstream HTTP response bytes or WCL point cost. Overflow fails closed.

## Separate policy boundaries (not official API fields)

Without optional caller-supplied classification functions, `Zone.type='unclassified'`, every Encounter `difficulties/partitions=null`, and the DPS specialization list is empty. The existing `EnvironmentProfile` therefore remains `UNRESOLVED` and refuses unverified analysis-scoping by default.

With an **independently evidenced, versioned** policy supplied by a future trusted host:

- `classifyZone(zone,expansion)` may return `raid` / `dungeon` / `other` / `null`.
- `classifySpec(spec,gameClass)` may return `dps` / `tank` / `healer` / `null`. Only explicitly classified DPS specs enter the rank scope; the spec ID key is `wcl:<classId>:<specId>`, not a fixed 27-spec roster.
- `confirmEncounterSupport(encounter,zone,expansion)` may return `{difficulties,partitions}`; each value must be a documented member of the enclosing Zone's supported lists. An unknown or contradicted result is rejected. **NPC/BossDPS policy remains unresolved regardless.**
- `policyVersion` is mandatory when one of these functions is supplied, and participates in the catalog/profile fingerprint. A version string alone **does not constitute independent certification**; evidence and policy provenance must be established before production use.

There is no fallback to name matching, highest expansion inference, fixed 216/Top-100 defaults, `TotalDPS - NonBossDPS` approximation, or previously observed one-fight NPC gameID extrapolation.

## Verification and exact evidence scope

[GitHub Actions #42791446872](https://github.com/degong2-code/wcl-fresh216/actions/runs/42791446872) at `bc6ff1923040869bb7a5946dd4edb14961316432` completed **SUCCESS**. Direct job log: **21/21 tests PASS, 0 fail** (10 existing profile/scope, 8 metadata-port tests, 3 full synthetic catalog → profile → scope integration tests).

Coverage: official documented query spellings, exactly two injected calls, explicit expansion, zero-state unresolved result, optional external classification, Top-10/100 proof-policy parity, stable profile reuse and policy-version invalidation, duplicate and support-bound rejection, unknown charges, GraphQL failure and ambiguous transport non-retry, maximum-response enforcement. **All test payloads are synthetic.**

The later commit adding the new test files to `tools/ci.mjs` does not modify module/test semantics. Existing broader pure-core regression evidence may be reused; no new full-suite PASS is claimed for this final docs commit.

## Next work and promotion gates

1. Prove how trusted zone category, specialization role and per-Encounter difficulty/partition support policies are sourced and versioned **without** hardcoding a season. Where the published WCL schema lacks information, document a separate authoritative data source or keep the value unresolved.
2. Establish an explicitly reviewed, points-bounded **single metadata discovery probe** in a trusted environment only after separate user approval. Inspect actual response shape, costs, rate limit, and locale/revision drift; keep the query transport/credentials outside the public pure core.
3. Persist a compact versioned profile and offline readback under a durable store; attach exact source and policy evidence. Refresh only affected keys, not whole historical ranking evidence.
4. Connect `AnalysisScope` to the **existing** plan/Checkpoint/Report-wave engine through a compatibility adapter that does not silently reuse `planFull216` for a generic Top-N scope. NPC phase/gameID certification, BossDPS validation, and stat/dashboard publication are later distinct gates.

**L2 live discovery, L3 BossDPS policy certification, L7 zero-state E2E, L8 cross-environment repeatability, and Cloudflare R1 remain NOT PROVEN.**
