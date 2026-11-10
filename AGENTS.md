# WCL Analysis Platform — Repository Instructions

This repository is the public product source for the season/expansion-independent WCL Analysis Platform. The repository name `wcl-fresh216` is retained for continuity; do not treat the historical Fresh216 216-job workload as the current product goal.

## Current authority

Read [docs/PRODUCT_DIRECTION.md](docs/PRODUCT_DIRECTION.md) before product changes. The private project knowledge base in `degong2-code/ai-project-lab` contains the full migration map, historical receipts and detailed acceptance criteria. Its current canonical project instructions are maintained under `projects/wcl-fresh216/AGENTS.md` on the private handoff branch. If public/private docs disagree, follow the latest user direction and report the conflict; do not invent private evidence.

## Product goal

Build a season/expansion-independent WCL analysis web platform:
1. Automatically discover WCL seasons/expansions, supported content/encounters, available difficulties/partitions, DPS specializations, NPC candidates and scoped BossDPS rules.
2. Collect efficiently using measured query strategies, live WCL point accounting, deduplication, Checkpoints and safe resume.
3. Independently validate Report/Fight/Actor/revision evidence and compute depth-aware statistics.
4. Provide a web app for scope/depth selection, asynchronous run monitoring, dashboards and provenance drill-down.

## Development and runtime

- Continue GitHub-first development: isolated branch, tests, Actions, PR review.
- GitHub Actions is development CI and bounded validation, not the permanent long-running production collector.
- Cloudflare is a **later deployment/operation target**, not a current development dependency. Keep domain logic platform-neutral and Cloudflare-compatible; do not configure/deploy Workers/Workflows/D1/Durable Objects until product E2E readiness and separate user approval.
- Google Sheets/GAS is optional future export, not a required storage or output system.
- Keep data small: compact statistical snapshots, minimal provenance and compact Checkpoints. Raw bulk archives, PostgreSQL, Redis, R2/S3 and VPS are not default requirements.

## Correctness and scope

- Do not hardcode 216 jobs, eight bosses, 27 specs, Heroic/Mythic, Top-100 or BossDPS rank 500 as universal defaults.
- User-selected depth controls rank coverage, not evidence quality. Every selected rank must satisfy the same exactness contract.
- Discover NPC gameID candidates; certify BossDPS inclusion rules only for explicit content/difficulty/phase scope and independent evidence coverage.
- Never infer BossDPS by subtracting non-boss damage. TotalDPS=BossDPS shortcuts require direct scoped proof.
- Preserve exact same-Report/Fight/Actor/revision attribution. Unknown/ambiguous values remain NULL or explicitly partial.
- Read live WCL rateLimitData and available point categories; do not hardcode historical hourly quotas. Centralize reservations and actual-cost accounting. Never blindly retry uncertain external requests.
- Reuse existing pure modules after reviewing their Fresh216-specific assumptions. Do not fork a duplicate collector, Checkpoint, KPI or quota engine without evidence.

## Approval boundaries

No live WCL requests, new API point consumption, credential/Secrets changes, external writes, Cloudflare setup/deployment, Google Sheets writes, PR merge or production promotion without the applicable explicit user approval.
