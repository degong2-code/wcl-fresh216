# Installed FRESH216 direct-actor collision: offline finding

## Evidence and reproduction (2026-10-28)

The user provided a privately redacted export of the installed TEST Apps
Script project. Archive SHA-256:
`b4c2439815d591e6238dceb4ddc7286a4807583df587a16752f8a1adbe7c60b5`.
There are 36 exported files (35 JavaScript modules and appsscript.json).
This hash identifies the **redacted copy**, not the unredacted installation.

The actual installed `Code.js` functions `wcl35Identity_` and `wcl35Direct_`
were extracted for local, isolated Node evaluation. `wcl35Identity_` uses
report+fight+positive ID, otherwise report+fight+lowercase name.
`wcl35Direct_` demands a unique *boss-side* match, but does not enforce
uniqueness among the *overall-side* ranking slots.

| Synthetic world-ranking scenario | Original installed function result |
| --- | --- |
| Two same-name actors with distinct positive IDs; both boss ranks | `[60,40]` |
| Two same-name overall actors without IDs; one same-name boss rank | **`[60,60]`** |

The latter result cannot be justified as two distinct same-actor proofs.
This is **synthetic reproducibility**, not evidence that the existing private
RAW/PROOF data has any real collision or that a user-visible KPI was corrupted.
No private names, reports, credentials or spreadsheet IDs are in this repo.

## Dev-branch mitigation prototype

`src/core/legacy-direct-match.mjs` is an **offline-only** proposed replacement
for direct matching. It retains the legacy output shape
`{matched,calibrators}` but requires unique, positive matching actor IDs in
BOTH metric snapshots, with consistent report/fight, plausible boss DPS, and
no contradictory observed names. Missing/ambiguous IDs result in `null`,
never estimated or duplicated values. Existing same-fight report roster
validation (`wcl35Recover_`) remains the independent fallback.

Do not replace `wcl35Identity_`: it is also necessary for selecting
report/fight groups. Do not deploy this module to Apps Script as-is. It is a
pure-core testable candidate, not a WCL response decoder or installed patch.


## Read-only impact audit of existing stored snapshots

The user's historical private WCL Fresh216 workbook was read offline using
aggregate-only processing; no workbook bytes or per-person names/IDs were
uploaded to GitHub. There were **44 committed G4.13 snapshot envelopes** with
matching stored SHA-256, each containing 100 overall and 100 boss ranks
(4,400 slots in each metric). Observed overall-rank identity coverage:

| Metric | Count |
| --- | ---: |
| Overall ranking slots | 4,400 |
| Name-only (no actor ID) | 4,330 |
| Identityless / anonymous | 70 |
| Legacy direct candidates with matching boss ranking | 2,721 |
| Name-only among legacy direct candidates | 2,721 |
| Positive-ID direct candidates | 0 |
| Same-report/fight duplicate normalized name or ID keys | **0** |

Neither `server` nor `realm` is present on any of the 8,800 stored ranking
rows examined. This dataset cannot establish canonical actor identity on
name matching alone. The 44 archived snapshots are not a live recheck of
the full 216-job dataset.

**Do not deploy strict ID-only `resolveConservativeDirect` directly.** It
would remove all **2,721** observed direct shortcuts in this sample,
potentially increasing report HTTP/alias costs substantially and violating
the runtime-efficiency objective. It is an exactness-only reference model.

The alternative `resolveCollisionGuardedDirect` adds a **uniqueness check
on the overall side**, retaining every existing direct match in this
44-snapshot sample because the problematic duplicate-key condition was not
observed; it rejects the synthetic false double attribution. This minimal
guard is compatible with current direct-ranking availability, but does NOT
magically upgrade name-only joins to cryptographically verified identity.
Further validation is required before any installed GAS edit.

## Supplementary start-time parity audit (private, zero API)

A read-only recheck of the same **44 SHA-verified committed G4.13 snapshots**
compared the `startTime` field on both sides of all **2,721** legacy
direct candidates:

| Comparison | Count |
| --- | ---: |
| Same report code / fight ID / normalized name | 2,721 |
| Identical `startTime` (integer field on each side) | **2,721** |
| Missing or different `startTime` | **0** |

The offline `resolveCollisionGuardedDirect` candidate now fails closed when
the two ranking entries lack valid equal start times. This preserves all
2,721 observed shortcuts in the private sample, without WCL requests.
Neither this nor uniqueness proves canonical character identity:
**two realm-distinct homonyms in the same fight share its start timestamp**.
Only actual WCL-sourced actor/Character crosswalk evidence (or a
user-approved, suitably verified fallback) could resolve that ambiguity.

The 44 snapshots may not represent all 216 jobs. No benchmarked WCL
point or end-to-end speed saving is claimed.

## Next safe checks before an approved GAS change

- Privately quantify name-only direct matches and duplicate-name exposure
  using source-aligned ranking snapshots; output only aggregate counts.
- Confirm actor ID **namespace** parity between real WCL overall and
  boss ranking responses. IDs from ReportActor and typed Character cannot
  be assumed interchangeable.
- Estimate the increase in report aliases/API points from refusing name-only
  shortcuts; preserve the existing EXACT-100 semantics.
- Verify original 75 historical tests and new collision tests against an
  isolated GAS patch, with zero live calls until separately authorized.

**No original Apps Script/Sheets/PROOF change, live WCL API call, token access,
trigger edit, or source import is authorized or implied.**
