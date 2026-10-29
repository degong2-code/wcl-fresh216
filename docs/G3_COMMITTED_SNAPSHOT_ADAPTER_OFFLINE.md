# Private G3/G4.13 committed snapshot → Full216 adapter (OFFLINE)

**Status:** implemented and synthetic regression CI PASS, 2026-10-28.
Code: `src/core/g3-snapshot-adapter.mjs`.
Tests: `tests/g3-snapshot-adapter.test.mjs`.

## What was actually verified

The *private imported review copy* of the user's historical Apps Script
`Code.js` and `13_F216.js` contains a G3/G4.13 committed snapshot
envelope: SHA-256 of original JSON, UTF-8 chunked payload, producer
run/scope/job/RAW row identity, `overall` and `boss` arrays of 100
source ranking rows, independent SHA-256 rank fingerprints, and five
DPS summary figures per metric. A snapshot is only replayable from the
historical source after its sheet row is marked `COMMITTED` and matched
to the run and corresponding RAW A:T row.

The adapter accepts *private caller-provided* input shaped like:

```js
importCommittedG3Snapshots({
  manifest: {
    scopeKey: 'private:your-run',
    producerScope: '12.1|1|2026-10-08|2026-10-12|4',
    runId: 'exact-source-run-id',
    difficulty: 4,
    filter: 'date.1791385200000.1791817200000',
    partitionMode: 'EXPLICIT_1'
  },
  items: [
    // exactly 216 items, one per original source job/RAW row 4..219
    // {status:'COMMITTED', envelope:{...}, rawRow:[...A:T]}
  ]
});
```

**Never put the contents of `items` into public GitHub, Actions logs,
CI artifacts or a public issue.** The source is not present in this
repository. The examples and tests are synthetic only.

## Strict import semantics

1. Requires 216 completed source envelopes, with unique RAW row number
   4–219 and unique boss/class/spec job key.
2. Verifies each envelope SHA-256 over its original chunk-joined JSON,
   original `runId`/`scope`/job/ROW identity, both metric fingerprints
   using the installed-source `wcl35RankFingerprint_` field semantics,
   all 100 positive DPS rows sorted descending and their start times
   inside the historical source date range.
3. Checks original RAW top1/top30/top100 and top30/top100 averages for
   both metrics against the saved snapshot. Rejects forged or mismatched
   report/fight identities, wrong dates, missing/duplicate work items.
4. Builds immutable `planFull216` input slots **from the TotalDPS
   `overall` top100 only**: 216 job keys, rank1..100, source SHA,
   report/fight/name/startTime, DPS, difficulty and original date filter.
   It does not overwrite TotalDPS, invent unobserved BossDPS or
   interpolate missing actor proofs.
5. The historical G3 snapshots do **not** attest `reportRevision`.
   This remains `null`: we do not fabricate a revision. A named
   actor can still acquire a ranking-derived proof only through the
   owner-approved alternative: same report, fight, uniquely matching
   nonmasked name **and exact source startTime**. A missing or mismatched
   timestamp or ambiguous candidate stays unresolved and may be checked
   through official same-fight Report rankings.
6. Full216 schema verification is performed after conversion. The
   importer returns no raw player content in its `summary`.

## Critical scope and authenticity boundaries

This importer is **specific to the installed historical G3 producer**:
2026-10-08..12 KST, heroic, partition 1. It explicitly **rejects**
2026-10-22..28 latest-partition data and any unrelated scopes rather
than relabeling a source period. A new period requires that period's
genuinely committed top100 snapshots and a scope-attested source
contract, not a change to a JSON date label.

Checksums establish consistency between the *supplied* JSON, ranking
fingerprints and RAW summaries. They do not by themselves authenticate
the source Spreadsheet/Apps Script installation or prove that the
input was exported from the user's live sheet. That requires separate
owner-controlled provenance of the committed source export. The
private review code is not independently certified as byte-identical
to the currently installed source.

The user's previously uploaded original workbook was privately inspected
in this session. It contains **44 COMMITTED** G4.13 snapshots and 44
corresponding RAW A:T rows, not all 216. Every observed snapshot
passed independent envelope SHA-256, overall and Boss ranking digests,
top1/top30/top100 and average RAW reconciliation, time scope and source
identity: **44/44**. Original player rows and credentials were never
uploaded to public GitHub. This validates the uploaded workbook copy,
not the currently installed live Spreadsheet.

`importCommittedG3Snapshots({...,allowPartial:true})` can now audit
a subset without claiming completion; it explicitly returns
`full216SourceComplete:false` and `full216DispatchEligible:false`.
The default strict import still requires exactly 216 committed rows.
CI uses synthetic 216×100 and partial-44 fixtures only.

## Next integration boundary

- Source-side, privately export actual COMMITTED envelopes and their
  original RAW A:T rows with scope/run identity. Preserve the original
  byte sequence for envelope SHA validation.
- For a later latest-partition period, obtain a genuinely new top100
  source and independent collection-scope proof; do not reuse the
  partition-1 G3 period.
- Bind this private source through the already implemented
  single-owner persistent checkpoint and the transport-injected
  ranking/Report coordinator. Then measure the same-query grouped
  Report point cost and end-to-end full216 coverage before Sheets/GAS
  activation.

**This task performed 0 WCL HTTP requests and 0 Google writes.**
