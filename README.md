# WCL Fresh216

A Warcraft Logs DPS and non-boss DPS evidence collector, targeting **8 raid encounters × 27 specializations (216 jobs)**.

> **Migration in progress — NOT an installable release.** The existing Google Apps Script installation remains the execution baseline until full source parity, security review, and offline CI validation are completed. No live collector source has been promoted to this repository yet.

## Project requirements

- Preserve **EXACT-100** and **same fight + same character** attribution.
- Never fill missing ranked slots with inferred or interpolated data.
- Reduce **observed** WCL API points and end-to-end completion time, without weakening evidence quality.
- Keep confirmed checkpoint/proof data unchanged until a separately approved migration or deployment.

## GitHub roles

- This **public** repository: distributable source, synthetic fixtures, offline unit tests, docs, and CI.
- `ai-project-lab` **private** companion: sanitized execution receipts, compact project state, selected private fixture metadata.
- Existing Google Apps Script and Google Sheets: authorized runtime, private credentials, persistent RAW/PROOF/checkpoints, and final output.

**No live WCL calls or Google Sheets writes in public CI.** Passing CI does not deploy the collector.

## Security

Never commit OAuth secrets, API tokens, `.env`, `.clasp.json` containing live Script IDs, raw WCL reports, player identifiers, private snapshots, caches, or operational ledger exports. Private GitHub is not a plaintext secret vault either.

## Contribution workflow

Use short-lived `work/*` branches and reviewable PRs. Validate changed components offline; require an explicit user-approved, bounded live measurement only when it materially affects a decision.

For the initial migration checklist see [docs/MIGRATION.md](docs/MIGRATION.md).
