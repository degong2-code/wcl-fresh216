# Historical Fresh216 source-package audit (offline; NOT installed-source parity)

Audited 2026-10-28 from a user-owned Library archive:
`WCL_G425_Identityless_Collector_Planner_RELEASE_GATED.zip`.

## Reproducible source identity

Archive SHA-256: `48ee32a1c231e8e2c894568cb6047436742a88cee64c4be5c2424a7b22128575`, 16 ZIP entries.

| Recovered historical source | SHA-256 | Bytes |
|---|---|---:|
| `g413/parent/PARENT_REAL/WCL_Integrated_v31_43_G31_G32_TEST.gs` | `8f920ad36335b4961ea05d2e18eb5fb36e6fe01d928c3e9673bda3ad6713407c` | 245,189 |
| `g413/WCL_v31_43_G413_Fresh216_Incremental_OPT_RELEASE_GATED.gs` | `0b85b02fcce5d362bd543aafeb63334a5ce26310d0e373d7fcb22e52080b591e` | 59,017 |
| `g415/WCL_G415_AliasScoped_AUTH_Recovery_GATED.gs` | `1894fa0183e9aa463919ec5e04f624269562d67fa7e093e9f0319ac7289cca8c` | 17,098 |
| `WCL_G425_Identityless_Collector_Planner_GATED.gs` | `f20c13d5fb73d8c1270a06284d7929d23b5da38e0e03435110f64b4a7e66d34e` | 8,020 |

All FOUR byte hashes exactly match `migration/source-manifest.json`. This
demonstrates **historical package byte continuity**, not equality to the
user's currently installed TEST Apps Script project.

## Independently rerun historical tests

Executed directly from the extracted archive with a local Node 22 runtime,
without invoking WCL, Apps Script, GitHub Actions or Google Sheets:

| Archive test entry | Result |
|---|---|
| `g413/test_g413_incremental.js` | exit 0; 12/12 PASS |
| `g415/test_g415.js` | exit 0; 22/22 PASS |
| `tests/test_g425.js` | exit 0; 41/41 PASS |
| **Total** | **75/75 PASS** |

These are historical, offline tests. They are **not** part of the present
GitHub Actions suites; do not add 75 to the currently advertised CI test
count, and do not claim a CI re-run that did not occur.

## Existing legacy recovery contract / optimization implications

Read-only review of the recovered historical parent:

- `wcl35Identity_`: report+fight+characterID when available, else
  report+fight+name; masked/anonymous identity is excluded.
- `wcl35Groups_`: reuse one Report+Fight for candidate ranks and skip
  already-attempted fight hashes; named-character groups take priority.
- `wcl35Roster_`: requires one matching Fight, encounter ID and
  heroic difficulty 4 in BOTH `overall` and `boss` rankings.
- `wcl35Recover_`: match exactly ONE overall DPS actor by raw rank
  amount (tolerance 0.005), class/spec and optional name; require a
  unique actor reference in both metric rosters and BossDPS
  in [0,totalDPS+0.005]. Otherwise return null.
- `wcl35ActorRef_`: uses numeric ID if available, falling back to name;
  do not silently conflate that JSON ID with report-local `ReportActor.id`
  or `Character.canonicalID`.
- `G4.25` adds only a disabled anonymous recovery candidate planner.
  The archive's reference patched G4.15 is **NOT installable alongside**
  the original G4.15 because of duplicate declarations.

The independently observed 14/14 *candidate* typed-roster crosswalk in
the later GitHub one-query experiment does NOT replace this stricter
EXACT-100 actor/damage contract. In particular, `table(DamageDone)`
semantics, pet ownership, boss target boundaries and scale-wide
throughput equivalence remain unverified.

## Status / safe next step

- `source_imported=false`, `installed_source_verified=false` and
  `production_ready=false` remain unchanged.
- Do NOT upload the original 245 kB parent, scripts, or entire ZIP
  blindly into this public repository. A targeted static scan found
  no obvious hardcoded OAuth token/secret assignments but that is not
  a complete privacy or installation parity audit.
- The next high-value step is to read-only export **all currently installed**
  `[TEST][FRESH216]` Apps Script files, preserving bytes and source names,
  privately review any identifiers/secrets, compute hashes, compare to
  these four known historical sources, then run original tests against
  the actual installed-source export.
- No `clasp push`, WCL API requests, Google Sheets writes, trigger
  changes, baseline promotion, PR merge or release approval implied.

This document is a recovery/provenance receipt only; not an installed
collector artifact.
