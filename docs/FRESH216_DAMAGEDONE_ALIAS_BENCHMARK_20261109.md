# Fresh216 — DamageDone GraphQL alias batching: real 1/2/4/8 experiment

**Date:** 2026-11-09. **Scope:** public-only isolated small experiment, not production B/C collection or Sheets update.

## Pinned evidence

- [Actions #42567989939](https://github.com/degong2-code/wcl-fresh216/actions/runs/42567989939): **SUCCESS**.
- Isolated branch: `work/fresh216-damage-table-alias-benchmark-20261109`.
- Immutable experiment receipts: `experiments/fresh216-table-alias-benchmark-20261109/PREFLIGHT.json` and `RESULT.json`, at first finalized run head `918fe0e93c650a40981ae2ffcf44d83fdcf745c5`.
- One-shot `REQUEST.json` **disarmed** after completion via commit `672870bbd6bc631807abe57d681578ee8adad42a` (`approved:false`, `mode:preview`).
- No private A216/B/C read/write, no raw player data committed, no Sheets, no automatic retry.

## Equal-workload table benchmark

Four already verified public report/fight pairs (3 LFR, 1 Heroic), in 2 report codes.
Each fight has TWO independent `report.table(dataType:DamageDone,viewBy:Source,fightIDs:[fight])` fields:

- Unfiltered (TotalDamage table);
- Boss-only (`filterExpression: "target.id IN (NPC gameID...)"`), reusing boss IDs from report-specific `fights` + `masterData`.

Every benchmark variant retrieved the **same 8 distinct logical table fields**, not an expanding workload.

| Alias fields per GraphQL call | Calls to fetch same 8 tables | Observed application points | Observed database points | Sum WCL HTTP elapsed | Total response bytes |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 8 | 8 | 0 | 2,725ms | 832,263 |
| 2 | 4 | 8 | 0 | 755ms | 831,690 |
| 4 | 2 | 8 | 0 | 403ms | 831,450 |
| **8** | **1** | **8** | **0** | **193ms** | **831,307** |

**24/24 identical per-table response hashes** across the 4 variants. Cross-Report aliases worked in the 8-field request; groupings containing one Report reused its `report(code)` parent selection.

Total actual experimental work: **17 WCL calls**, **37 WCL app points** =
**1pt** preflight hourly-quota query + **4pt** one-time cached metadata (2 reports / 4 fights) + **32pt** four sets of identical eight tables. One-time metadata response **702ms**; table traffic across four variants **4,076ms**. WCL returned application cap **3,600pt/h** and displayed DB cap **250pt/h**; **every DamageDone table was marked 0 Database Points**, as expected for `User-Eligible Points` fields.

### Interpretation and limitations

- **Proven:** GraphQL alias packing of separate same-fight table fields cuts network request count by 8× here at **unchanged point tariff (1pt/table)** and with identical full table data; low per-request overhead and metadata reuse.
- **Observed HTTP time ratio:** 2,725/193 ≈ **14.1×** for this set. This is **NOT a general guaranteed speedup**. The test ran in fixed order 1→2→4→8, so later queries may have benefited from server-side caching; response volume and report sizes are not representative of all A216 fights.
- **NOT proven:** safe payload capacity at 16/32/108 tables; rate under parallelism; table from report with 10+ fights; unfiltered table avoidability; actor attribution to current private A216; real same-fight C completion per point.
- The 8-table response is already **~831KB**. A naive 108-table response may exceed size/timeout constraints. Use **response byte caps, adaptive batch split and persistent private raw receipt storage**, not a blind 108-table setting.
- Query separate `fightIDs:[fight]` per alias; do **not** query `fightIDs:[fight1,fight2]` and assume an aggregate table preserves per-fight DPS identity.
- Keep immutable A TotalDPS and independent BossDPS-ranked KPI distinct from matched C value. The B1000→exact A/C join should happen **before** building the residual DamageDone request list.
- **Cost savings come from avoiding table fields**, not combining them; alias packing delivers throughput/HTTP+Git savings only.

### Proposed reusable engine integration

1. Finish independent B1000 ranked capture (original A216 unchanged), using compact Git batch checkpoints and rate-aware admission; separately persist official Boss ranking snapshots.
2. Offline join A + B by report code/revision, fight, unique unmasked actor and noncontradictory identity; compute residual distinct named report/fight groups. This step spends **zero** WCL points and removes duplicate/known-resolved fights.
3. Use cached report/fight boss-NPC gameIDs and full fight duration. Ask **one boss-target filtered DamageDone table per residual fight** if exact actor attribution can be independently proved; perform a second unfiltered table only when actor identity/TotalDPS consistency requires it.
4. Pack independent, per-fight tables into GraphQL alias calls across multiple Reports; default preliminary limit **8 fields per call** because it is proven in this benchmark. Increase only after bounded larger-payload tests; split on observed response bytes/latency and ensure no duplicate costs after successful checkpoint.
5. Persist each response body privately and durably (small compressed chunks with request/response digests, report revision, points and original sample identity), then **do all detailed actor matching and KPI calculation offline in batches**. Metadata cache keyed by Report revision; do not reuse across revisions without revalidation.
6. WCL old app point cap and result-verifiable idempotent queues remain. Failure of a possibly charged WCL attempt is not automatically retried in strict mode; handle the owner's previously accepted local-journal batch replay policy as a conscious, bounded tradeoff.
7. Defer C/Sheets promotion until independent verification. Masked/ambiguous actors remain `null`, never fabricated.

Official schema:
- [Report.table](https://www.warcraftlogs.com/v2-api-docs/warcraft/report.doc.html)
- [ReportData.report](https://www.warcraftlogs.com/v2-api-docs/warcraft/reportdata.doc.html)

**Decision:** experimentally validated design, **not connected to production B/C**. Do not mark the new collection or Google Sheets completed.
