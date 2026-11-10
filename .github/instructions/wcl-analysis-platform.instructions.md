---
applyTo: "**/*"
---

Follow the repository-root `AGENTS.md` and `docs/PRODUCT_DIRECTION.md`.

The current product is a season/expansion-independent WCL analysis platform, not a fixed Fresh216 216-job or Google Sheets repair. Keep four systems distinct: automatic environment discovery, intelligent collection/quota/recovery, independent evidence/statistics, and web UI/dashboard.

Develop and validate through GitHub first. Cloudflare is deferred until product E2E readiness. Keep domain logic host-neutral. Compact snapshots/minimal provenance/compact Checkpoints are the default; do not add raw bulk archives, PostgreSQL, Redis, R2/S3, VPS or mandatory Sheets without evidence.

Do not hardcode the old 216-job/8-boss/27-spec/Top-100/Boss500 assumptions. Depth affects rank coverage, never proof quality. Preserve same Report/Fight/Actor/revision attribution; discover NPC candidates and validate scoped BossDPS rules; never subtract non-boss damage to infer BossDPS. Use live WCL rateLimitData and safe centralized quota accounting. Historical Fresh216 fixtures are regression evidence only.
