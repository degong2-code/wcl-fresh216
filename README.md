# WCL Analysis Platform

The `wcl-fresh216` repository is evolving from a fixed-scope Fresh216 collector into a **season/expansion-independent WCL analysis web platform**.

Read [AGENTS.md](AGENTS.md) and [docs/PRODUCT_DIRECTION.md](docs/PRODUCT_DIRECTION.md) before changing product code.

## Product systems

1. Automatic WCL environment discovery/build.
2. Intelligent collection with live point accounting and safe checkpoint/resume.
3. Independent evidence validation and depth-aware analytics.
4. Web app, run monitor and statistics dashboard.

## Development and deployment

- Develop and validate through GitHub (isolated branches, tests, Actions and PRs).
- Cloudflare is a later deployment/operation target; it is not a current development dependency.
- Dashboard and compact statistics snapshots are primary. Google Sheets is optional future export.
- Do not hardcode the historical 216-job/A216/B500/Top-100/Google Sheets assumptions as universal product behavior.

Detailed private implementation history, migration mapping and evidence receipts remain in the private `degong2-code/ai-project-lab` WCL project knowledge base. No private raw data or credentials belong in this public repository.
