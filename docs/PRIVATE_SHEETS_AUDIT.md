# FRESH216 — private, read-only historical Sheets parity

**Status: available, not yet run with genuine private data.** This does not start
WCL requests, update Google Sheets, alter triggers, or touch the STOPPED cursor 43.
Do **not** paste or upload real workbook rows/Report IDs into a Public PR or chat.

## What to export once

From the existing **[TEST][FRESH216] WCL 신규 전체 수집** spreadsheet
containing these three original tabs (the two proof tabs are hidden):

- `영웅_DPS지표_V5_P12_1_TEST` — RAW A:Y
- `__WCL35_EVIDENCE_TEST` — historical 10-column PROOF ledger
- `__WCL43_G3_RANK_SNAPSHOTS` — original 32-column G3 committed rank snapshots

Use Google Sheets **File → Download → Microsoft Excel (.xlsx)** to export the
**same single workbook**. The source project may contain many other sheets;
the extractor ignores them. If the spreadsheet you downloaded does not contain
all three tabs, it explicitly fails `PRIVATE_XLSX_TAB_MISSING`; do not fabricate
or regenerate missing G3 records.

Keep the downloaded XLSX in a private machine or an authorized short-lived
Codespace; do not commit it to Git. The public repo ignores XLSX/CSV by default
and CI refuses to track them.

## Execute in a private terminal (no API keys required)

From an authorized Codespace terminal, with the exported workbook already
placed at `/tmp/wcl-fresh216-private.xlsx`:

```bash
set -o pipefail
git clone --depth 1 --branch work/collector-architecture \
  https://github.com/degong2-code/wcl-fresh216.git /tmp/wcl-private-audit-core
cd /tmp/wcl-private-audit-core
python3 tools/private-sheet-audit.py /tmp/wcl-fresh216-private.xlsx \
  | node tools/audit-private-evidence.mjs -
```

If the temporary source directory already exists, use its existing valid clone
after confirming the branch revision, rather than overwriting unknown files.

The Python extractor runs with the standard library only. It reads the workbook
as ZIP/XML, selects up to 216 aligned RAW/PROOF/G3 rows, and passes the original
G3 chunk data **directly through a pipe** to the Node auditor. It does not
write or cache extracted JSON, and it refuses to display raw JSON on a terminal
without a pipe. Both commands must be run with `pipefail`; do not use `tee`
or redirect the Python JSON output to a file. No GitHub Actions run receives the
private workbook.

The only terminal output suitable to share for analysis is the **Node aggregate
JSON** (counts and safe error codes). If Python reports a
`PRIVATE_XLSX_...` error, share only that code.

## Meaning of results

- `sourceCounts.proofRowsPresent`: PROOF entries found, not necessarily 43
  newly completed G4.13 jobs; older proof records may be present.
- `sourceCounts.committedRowsWithProof`: stored G3 COMMITTED rows paired with
  a PROOF entry; these are candidate records, not automatically good proofs.
- `sourceCounts.missingCommitForProof`: PROOF row exists but no matching
  committed G3 storage row was exported. A nonzero count makes the overall
  outcome `REQUIRES_REVIEW`.
- `sourceCommitAttested`: records whose committed G3 storage chunk data, hashes,
  source/proof scope and RAW metrics passed the audit.
- `legacyExact100`: historical numeric BossDPS proof for all 100 ranks under
  preserved legacy assumptions. This **does not reconstruct per-rank actor IDs**.
- `legacyPartial`: fewer than 100 ranks, including cases marked old `DONE`
  because the candidate pool was exhausted.
- `status:'REQUIRES_REVIEW'`: inconsistent, missing or unverified source
  evidence; **never** treat this as success or trigger a paid WCL requery.

The source COMMITTED flag and chunk SHA are an integrity witness for the
supplied workbook, **not external WCL authenticity**. Actual proof parity will
not be reported until the real private workbook is read and checked.

## Cleanup

Only after recording the aggregate terminal result, remove the temporary XLSX
from its private Codespace location and discard the short-lived Codespace if
appropriate. The original Google Sheets workbook stays unchanged.

**Remaining separate decisions:** WCL report.table versus rankings actual
same-actor/DPS and paid point comparison, choosing a genuinely durable live
host, attaching Google Sheets output, end-to-end timing. No assumed speedup.
