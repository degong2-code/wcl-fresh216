# Fresh216 live dated ranking-depth receipt — Heroic Nek'zali, 2026-10-22..28 KST, BossDPS to rank 1000

**Corrected successful execution:** GitHub Actions run [40637307499](https://github.com/degong2-code/wcl-fresh216/actions/runs/40637307499), activation commit `c1614ac2036d1a5232514fc38c76df56eefe91d5`.

**Scope**
- Encounter 3470 (Nek'zali), Heroic difficulty 4.
- Date filter: `date.1792594800000.1793199600000` = 2026-10-22 00:00 KST through 2026-10-29 00:00 KST exclusive, i.e. calendar dates Oct 22–28 inclusive.
- Partition: omitted so Warcraft Logs selects the latest/default partition.
- Specs: Balance Druid, Enhancement Shaman, Survival Hunter.
- TotalDPS: page 1 (top 100) per spec.
- BossDPS: pages 1–10 (up to rank 1000) per spec.
- One GraphQL POST per specialization, with TotalDPS page1 and BossDPS pages1..10 aliased in the same document.
- Join acceptance: same report + same fight + unique non-anonymous normalized name + identical startTime, with no known revision conflict and BossDPS <= TotalDPS.

## Corrected result

| Spec | p1 | +p2 | +p3 | +p4 | +p5 | +p6 | +p7 | +p8 | +p9 | +p10 | Final through rank1000 | Unresolved | Anonymous |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Balance | 24 | 16 | 5 | 1 | 1 | 4 | 1 | 2 | 2 | 4 | **60/100** | 40 | 4 |
| Enhancement | 64 | 13 | 6 | 3 | 2 | 1 | 2 | 0 | 1 | 0 | **92/100** | 8 | 0 |
| Survival | 74 | 11 | 4 | 2 | 0 | 1 | 0 | 0 | 0 | 0 | **92/100** | 8 | 0 |
| **Aggregate** | **162** | **40** | **15** | **6** | **3** | **6** | **3** | **2** | **3** | **4** | **244/300 (81.3%)** | **56** | **4** |

Aggregate cumulative exact same-fight recovery:
- rank100: 162/300 = 54.0%
- rank200: 202/300 = 67.3%
- rank300: 217/300 = 72.3%
- rank400: 223/300 = 74.3%
- rank500: 226/300 = 75.3%
- rank600: 232/300 = 77.3%
- rank700: 235/300 = 78.3%
- rank800: 237/300 = 79.0%
- rank900: 240/300 = 80.0%
- rank1000: 244/300 = 81.3%

Top30 exact same-fight recovery through rank1000:
- Balance 19/30
- Enhancement 28/30
- Survival 27/30

No same-key ambiguity, startTime/revision conflict, or BossDPS>TotalDPS conflict was observed.

Residual after rank1000: **56/300**, consisting of **52 named** and **4 anonymous** TotalDPS slots.

## WCL request cost/time

Exactly 3 authenticated GraphQL POSTs returned HTTP 200.

| Spec | reported currentRequest.total | application | database | user | elapsed |
| --- | ---: | ---: | ---: | ---: | ---: |
| Balance | 11.01 | 11.01 | 11 | null | 764 ms |
| Enhancement | 11.01 | 11.01 | 11 | null | 792 ms |
| Survival | 11.01 | 11.01 | 11 | null | 794 ms |
| **Sum of request totals / elapsed** | **33.03** | — | — | — | **2,350 ms** |

Point classes are separate witnesses and are not additive within a request.

## Important partition correction

An earlier approved attempt in run [40636994318](https://github.com/degong2-code/wcl-fresh216/actions/runs/40636994318) used the same date filter but explicitly forced `partition:1`. All three HTTP 200 responses returned 0 TotalDPS rows and 0 BossDPS rows. That run consumed three request totals of 11.01 (sum 33.03) and is retained as failed-scope evidence.

Warcraft Logs v2 documents `partition` as optional for encounter rankings and states that the **latest partition is chosen by default**. The corrected run therefore omitted the partition instead of guessing a current partition number.

## Decision impact

- Narrowing to Oct 22–28 improves rank300 recovery versus the previous current-global trial: **72.3%** here vs **68.3%** in the earlier current-global sample.
- Extending rank300 → rank1000 adds **27 exact matches** (217 → 244), improving coverage by **9.0 percentage points**.
- The gain beyond rank300 is real but diminishing and highly specialization-dependent: Balance gains +15 from pages4–10, Enhancement +9, Survival +3.
- A fixed rank1000 cutoff still leaves **18.7% unresolved**, including **52 named** slots. Therefore ranking depth alone still does not preserve EXACT-100 semantics.
- Best current design remains: ranking-first depth expansion while marginal yield is worthwhile, then bounded official same-fight Report rankings fallback for named residuals; Anonymous stays default-null.

No raw ranking rows, actor names, report/fight identifiers, OAuth tokens or private workbook content were published. No Sheets/GAS writes, PR merge or main deployment occurred.
