# WCL Analysis Platform — offline Environment Discovery V1 slice

**Date:** 2026-11-10. **Status:** Implemented and CI-verified **synthetic, zero-state contract only**. This is **not** WCL live catalog discovery, boss/NPC policy certification, a collection run, the L2 acceptance gate, or product/main promotion.

**Base:** `work/fresh216-adaptive-archive-delta-20261031` at `61658b002541d7eff48ce86b6b1407d77139eb89`. Work isolated from existing product Draft PR #21 and the earlier docs-only PR #30. The current product direction is `docs/PRODUCT_DIRECTION.md`, the private `ACCEPTANCE_CRITERIA.md`, and D18–D24.

## Implemented public ESM interfaces

- `src/core/environment-discovery.mjs` exports:
  - `normalizeWclCatalog(raw)`: strict normalization of a **port-level** input, not an undocumented WCL response.
  - `canonicalCatalogJson(value)`: deterministic key-ordered JSON for a normalized record.
  - `discoverEnvironment({catalogPort,sha256,observedAtMs,previousProfile})`: one injected catalog read, normalized SHA-256 fingerprint, versioned profile, idempotent reuse and changed-zone/spec keys.
- `src/core/analysis-scope.mjs` exports:
  - `buildAnalysisScope({profile,selections,sha256})`: immutable, hashed scope containing discovered zone/encounter IDs, supported difficulty/partition, time range, DPS specialization keys, Top-N rank depth and evidence policy. Selection defaults include all **supported** encounters/specs; unsupported or ambiguous choices fail closed.
- `tests/environment-discovery.test.mjs`: synthetic-only Node tests; `tools/ci.mjs` includes these tests in future existing offline core CI.
- `.github/workflows/wcl-platform-discovery-offline.yml`: dedicated, narrowly scoped, read-only, no-Secrets CI on this isolated development branch.

## Port-level normalized catalog contract

The caller implements `catalogPort.readCatalog()` and returns a **normalized** object, not a raw `worldData` or `reportData` body. The current implementation intentionally does **not** guess which WCL GraphQL fields expose season, partition, or DPS specializations. The later WCL adapter must verify the actual upstream schema and map its available fields.

~~~js
const snapshot = {
  schema:'WCL_CATALOG_PORT_V1',
  catalogKey:'synthetic-season-v1', // adapter-produced source namespace, not inferred
  contents:[{
    zoneId:502, name:'Example Dungeon', type:'dungeon',
    encounters:[{
      id:8001, name:'First Boss',
      difficulties:[4], partitions:[] // null means unknown, [] known none
    }]
  }],
  dpsSpecializations:[{
    key:'Mage:Fire',className:'Mage',specName:'Fire',role:'dps'
  }]
};
const sha256 = input => /* injected trusted platform SHA256 function */;
const {profile,reused,changed} = await discoverEnvironment({
  catalogPort:{readCatalog:async()=>snapshot},
  sha256,observedAtMs:Date.now(),previousProfile:null
});
const scope=await buildAnalysisScope({
  profile,sha256,
  selections:{startMs:1,endMs:2,depth:10}
});
~~~

The example IDs and labels are **synthetic**. No WCL metadata, encounter IDs, partition options, or specializations from an active season were retrieved. The hash function is injected to keep the core independent of Node, browser and Cloudflare runtime specifics.

### Failure policy and limits

- Unknown `encounters` or `difficulties/partitions` are `UNRESOLVED`; an explicit zero supported encounter/difficulty set is `UNSUPPORTED`.
- NPC `candidateGameIds` and `certifiedRules` start empty and `UNRESOLVED` for every encounter. **No automatic BossDPS policy certification** is performed.
- A scope cannot silently select unknown zones, unsupported/ambiguous encounters, non-intersecting difficulties, unavailable partitions or unknown specializations. When multiple difficulty/partition choices remain, an explicit selection is required.
- Selected rank depth changes **coverage only**; evidence policy remains `EXACT_SAME_REPORT_FIGHT_ACTOR_V1`. This scope builder issues no rank requests and grants no permission to publish BossDPS.
- Profile fingerprint excludes wall-clock `observedAtMs`; unchanged normalized metadata reuses a previous profile. Changed zone/spec IDs are returned, but a durable refresh scheduler/store is **not** implemented.
- The current contract requires the adapter to supply a unique `catalogKey`. It does not yet discover expansion/season taxonomies from real WCL metadata or implement WCL schema pagination and dynamic spec roster inference.
- No permanent player data or raw WCL API payloads are stored. No live quota, collection/Checkpoint writes, synthetic C publication, or Cloudflare setup.
- The prior fixed 216×100 source remains a regression fixture, **not** a zero-state input or new-season default.

## Verification evidence

[Actions #42787266766](https://github.com/degong2-code/wcl-fresh216/actions/runs/42787266766) completed SUCCESS: node syntax checks, **10/10 tests PASS, 0 failed**, synthetic catalog fixtures only. It ran before adding this documentation and before adding the test to the legacy `tools/ci.mjs` list; those follow-ups are small integration changes and do not by themselves evidence a full existing-core retest.

Tests cover: empty-state profile; stable reordering; changed-ID diff; unresolved/unsupported status; duplicate/invalid metadata and digest rejection; default all-supported scope; depth 10 vs 100 policy parity; invalid selections; explicit partition/difficulty disambiguation; injected port call count.

## Next smallest work item (requires a distinct development step)

1. Inspect current official WCL API schema/documentation and confirm how seasons/expansions, zones, encounters, difficulty/partition and specialization metadata can actually be queried. **No speculative GraphQL field names.**
2. Implement a read-only, injected `WclCatalogPort` adapter with bounded pagination, schema-version/coverage diagnostics, deterministic normalized output and explicit `UNRESOLVED` for unavailable sources.
3. Add offline fixtures that mirror **verified** upstream response shapes; then secure a separately approved, point-bounded metadata probe before claiming live WCL discovery.
4. Only after adapter parity, connect `AnalysisScope` to an existing reusable plan/Checkpoint through a thin compatibility port; never call the old `planFull216` for arbitrary Top-N. Keep NPC policy certification as a separate scoped gate.

**L2 / L7 / L8 remain NOT PROVEN.** This slice establishes a platform-neutral, tested *application boundary*, not production deployment.
