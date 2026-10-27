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
