# Fresh216 BossDPS technical batching benchmark — 2026-11-09

Status: **REAL WCL BENCHMARK COMPLETED** (experimental only). The full
2,000-rank source was **not** collected; A216 remains immutable.

## Exact evidence / execution

- Product code commit: `ae2e3c2bf21ffa6b6607c6a2ea71c1253ed415a8`
- Private owner-gated benchmark Actions:
  https://github.com/degong2-code/ai-project-lab/actions/runs/42562084180
- First diagnostic failed before WCL because checkout by SHA detached HEAD
  (Actions 42561934594); corrected to checked-out branch + exact event HEAD pin.
- Real private result:
  `work/fresh216-boss-technical-benchmark-private-20261109` /
  `projects/wcl-fresh216/bench/RESULT.json`
  (read-only sanitized witness SHA `147b533106232e548665a7e7c657b27da83dad3e`).
- Owner-paid request **reverted to `approved:false`, `mode:preview`**
  at private SHA `13e140da9df10a70ed0066c6a43b19409e846a7a`.
- Offline synthetic CI: 77 suites PASS (Actions #42561744215), including
  `tests/fresh-boss-technical-benchmark.test.mjs`.
- No personal identifiers, source rank raw records, Sheets/C writes, or
  existing A/B checkpoint mutations in this pilot.

## Actual same cohort/date, metric:bossdps, page1/page2 results

| Query shape | Rank fields | Rows | WCL application total | WCL database points | HTTP time |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 boss, 9 specs, one page | 9 | 900 | 9.01 | 9 | 751ms |
| 1 boss, 27 specs, one page | 27 | 2700 | 27.01 | 27 | 1498ms |
| 1 boss, 27 specs, 2 pages | 54 | 5400 | 54.01 | 54 | 2811ms |
| 2 bosses, 27 specs, 2 pages | 108 | 10800 | 108.02 | 108 | 4740ms |
| **Total** | **198** | **19800** | **198.05** | **198** | **9800ms** |

90 repeat boss/spec/page fields gave **90/90 identical response hashes**.
Actual key limit at probe: **application 3600/h**, **database 250/h**.
The 1-point preliminary hourly-quota probe is additional to the above totals.

## Full depth-2000 projection, not executed

The 8 bosses x 27 specializations x 20 pages require **4320 paid
`characterRankings` fields** regardless of alias packing.

| Shape | HTTP GraphQL calls | Conventional Git commits (2/call) | Grouped Git commits (2/4 calls) |
| --- | ---: | ---: | ---: |
| 9 fields (old) | 480 | 960 | 240 |
| 27 fields | 160 | 320 | 80 |
| 54 fields | 80 | 160 | 40 |
| 108 fields | 40 | 80 | 20 |

The real four-call batch used **2 Git commits**; measured preflight/final
commit+push time **1262+967=2229ms**, versus 8 commits under old 2-per-request
protocol (counterfactual count, NOT a measured speedup).

**Corrected quota interpretation (2026-11-09):** The `databaseLimitPerHour=250`
and `currentRequest.database` fields are also displayed to **legacy, non-opted-in**
API keys, as explicitly stated in WCL's RateLimitData schema and 2026-10-20
beta announcement. A previous live same-project B1000 pilot
[Actions #41013626639](https://github.com/degong2-code/ai-project-lab/actions/runs/41013626639)
successfully used **2,162.16 WCL points on 216 GraphQL calls / 2,160 ranking
aliases in 3m35s**, with 250 database limit displayed, 3,600 application
limit displayed, and no database throttling. Therefore the prior assertion
that 4,320 database points **necessarily require 18 hourly windows** is
**retracted**. The currently observed 3,600 application limit also matches
the old non-opted-in point system, while the 2026 beta free-tier app
limit is 1,000. Account-specific current beta opt-in state is not
independently confirmed: inspect API Client Settings / "Use New Limits"
without opting in. Under the old regime, 4,320 ranking fields at ~1
application point each require ~4,320 **application** points and at least
one quota reset, but not necessarily 18 hours. Deeper page costs are
not guaranteed to stay 1 point. TotalDPS source A is not reread.

## Production decision boundary

- Proven: 27 aliases, multi-page and multi-boss GraphQL packing, 108
  rank fields in one call, server point witnesses and 2-commit grouped
  preflight/final protocol all **execute successfully**.
- Not proven: maximum safe aliases beyond 108, pages 3–20 equivalence,
  speed for deeply paginated requests, exact C matching with this new B
  feed, or real 2000-depth throughput at the hourly reset boundary.
- Important tradeoff: grouped preflight marks multiple potentially paid
  calls IN_FLIGHT. A crash after partial execution, before the final
  journal push, makes the **whole group manual-review-only**; no blind
  retry. For production, prefer smaller crash domains and/or durable
  local write-ahead witnesses before reducing remote commits further.
- Next efficiency question: use an A-exact Report/DamageDone grouped
  retrieval where possible to reduce the NUMBER of charged database
  ranking fields, not simply the number of HTTP calls. Inspect official
  equivalent filters and previously validated 65/65 sample before
  committing to a 4320-field B scan.
- This benchmark does NOT authorize any new WCL/B/C/Sheets production work.
