# WCL Analysis Platform — Product Direction

**Effective:** 2026-11-10  
**Status:** Current product direction for this repository.

## Product goal

Build a season- and expansion-independent WCL analysis web platform. The user chooses the WCL content and analysis scope; the engine discovers the environment, plans and performs efficient collection, validates the evidence, computes useful statistics and presents them in a web dashboard.

The repository name remains `wcl-fresh216` for continuity. The historical Fresh216 216-job workload is a regression/evidence fixture, not the product definition.

## Four systems

1. **Environment discovery/build:** discover current WCL seasons/expansions, supported zones and encounters (including non-raid content where the API exposes usable rankings), difficulties/partitions, DPS specs, NPC gameID candidates and scoped BossDPS inclusion rules.
2. **Intelligent collection:** choose correct and efficient query paths; deduplicate shared Report/Fight work; account for live WCL application/database/user point classes; checkpoint before external requests; safely pause, wait, resume and quarantine uncertain outcomes.
3. **Evidence validation and analytics:** verify Report/Fight/Actor/revision identity, NPC target scope and proof class; keep unknown values NULL/partial; compute statistics for the selected rank depth.
4. **Web app/dashboard:** multi-select content/encounters (default all supported), choose available difficulty, date range, DPS specs (default all) and predefined Top-N depth; inspect asynchronous run progress; view rankings, comparisons, trends, data quality and provenance.

## Accuracy and scope

- Ranking depth changes the number of ranks collected, not the correctness standard.
- Do not assume a fixed 216-job cohort, eight bosses, 27 specializations, Top-100, BossDPS rank 500 or fixed date range.
- Discover NPC IDs automatically. A candidate list is not certification; validate BossDPS inclusion for explicit content/difficulty/phase scope using independent Reports/Fights and official WCL evidence.
- Never derive BossDPS by subtracting non-boss damage. TotalDPS=BossDPS is a shortcut only when directly proven for the applicable scope.
- Preserve same Report/Fight/Actor/revision attribution. Unresolved or ambiguous data stays explicitly unresolved.

## Development and deployment

- **GitHub-first development** continues: source, isolated branches, tests, Actions CI and PR review.
- **Cloudflare is deferred** until the GitHub-developed product passes zero-state and cross-environment E2E acceptance. Workers/Workflows/D1/Durable Objects are future candidates, not current dependencies.
- Dashboard is the primary output. JSON/CSV and Google Sheets are optional exports.
- Retain compact statistics snapshots, minimal provenance and small Checkpoints. Raw WCL payloads are transient by default; no bulk archive or external storage service is assumed.
- Confirm current Cloudflare/GitHub plan limits and pricing when relevant; never assume free tiers are unlimited.

## Historical compatibility

Existing Fresh216 collectors, Report-wave/Checkpoint/evidence/KPI modules and A216/B500/official/pilot fixtures may be reused after their fixed-scope assumptions are reviewed. Historical figures and approvals do not become current defaults or new live WCL authorization.
