# Fresh216 — official BossDPS exact reconstruction from DamageDone tables
2026-10-30. **PUBLIC WCL report pilots only. Production Fresh216 A/C untouched.**

## Executive experimental result

The following target-filter method reproduced the official `rankings(...,playerMetric:bossdps)` to **within 0.005 DPS for all 65 sampled DPS actors across four boss encounters**, including a public **Heroic** Nek'zali kill and an LFR 3-Boss NPC encounter. The public report bodies and actor rosters were NOT committed; durable Git receipts contain cost, provenance, aggregate shape, hash, and mismatch statistics only. Separate Actions independently read back the receipts, not the original raw character damage, so this is **live in-run numeric comparison + independent receipt validation**, not an independent raw-data replay.

| Public WCL case | Encounter | Difficulty | Boss NPC target count | Exact TotalDPS from unfiltered DamageDone | Exact BossDPS from boss-target DamageDone |
|---|---:|---:|---:|---:|---:|
| `wyCNP6db8FrxG7gk`, fight 50 | 3129 | LFR (1) | 1 | 17/17 | **17/17** |
| Same report, fight 6 | 3132 | LFR (1) | 1 | 18/18 | **18/18** |
| Same report, fight 10 | 3122 | LFR (1) | 3 | 18/18 | **18/18** |
| `rPRCwg6fjc9XdQLz`, fight 2 | **3470** | **Heroic (4)** | 2 | 12/12 | **12/12** |
| **Distinct actor comparisons** | 4 boss encounters | LFR & Heroic | 1–3 | **65/65** | **65/65** |

Numeric formula verified independently *inside each paid comparison run*: `table.data.entries[actor].total / ((fight.endTime - fight.startTime) / 1000)`. Strict comparison threshold `absolute error <= 0.005 DPS`; observed maxima were less than **5e-9 DPS** on Heroic, less than **5e-10 DPS** on LFR. This is a same-fight report actor parity, **NOT** a final C proof attributed to one of the user's private immutable A top100 characters.

## How to identify boss targets without refetching per-character rankings

1. Obtain official `report.fights(fightIDs:[fight]){id encounterID difficulty startTime endTime enemyNPCs{id gameID}}`.
2. Obtain `report.masterData{actors{id gameID type subType}}`. Intersect `fight.enemyNPCs[].id` with master actors where `type === "NPC"` and `subType === "Boss"`.
3. Use each matched actor's **`gameID` (global NPC ID)** — *not* the report-scoped `id` — in one filter `target.id IN (<gameIDs...>)`.
4. Request `table(dataType:DamageDone,fightIDs:[fight],viewBy:Source,filterExpression:$filter)` once to sum boss damage across all boss target game IDs. Divide by full fight duration; handle pets and actor identity conservatively.
5. To attribute to the original immutable A TotalDPS ranked slot, request an **unfiltered** `table(dataType:DamageDone,fightIDs:[fight],viewBy:Source)` and verify unique report+fight+actor/class/name+TotalDPS agreement. A spec/identity test is still needed; do not blindly use name alone or infer anonymous slots.

**Incorrect test:** `target.id IN (<report-scoped actor ids>)` returned 0 rows for a 3-boss NPC fight. Correct using global `gameID` returned 18/18 exact BossDPS actors. This distinction is critical.

## Actual observed WCL point costs

| Query type and scope | WCL points |
|---|---:|
| One public fight dual `rankings(dps)` + `rankings(bossdps)` | 4 |
| Same fight `rankings(bossdps)` only | 2 |
| One unfiltered `table(DamageDone, viewBy:Source)` | 1 |
| One boss-target `table(DamageDone, targetID:bossReportID)` | 1 in public LFR |
| 3 separate `targetID` boss-target tables (LFR fight 10) | 3 |
| Boss-only rankings plus a **single three-Boss global-gameID filtered table** (LFR fight 10) | 3 total |
| Boss-only rankings plus a **single two-Boss global-gameID filtered table** (Heroic fight 2) | 3.42 total |
| Heroic `fights+masterData` discovery | 2 |
| Heroic same-fight full rankings + 2 tables + metadata request | 8.60 |
| Earlier report-wide rankings 9 fights together | 36 = 9 × 4 |

The table and ranking costs can be non-integer and depend on payload: **never promise that all production tables will cost exactly 1pt**. The public heroic gameID-filter request charged **3.42pt INCLUDING official boss-only rankings**; the target table's isolated marginal price within that combined query was not separately measured.

Across the new parity pilots after the previously published 44pt baseline comparison, **69.98 additional WCL points** were observed:
- LFR parity v1 9, corrected parity v2 9, cross-fight discovery+two fights 23.80.
- Incorrect multi-boss report actor-id expression 5.16; corrected global gameID expression 5.00.
- Heroic discovery and targetID test 12.60; Heroic global gameID expression 5.42.
- Together with the preceding 44pt public cost comparisons: **113.98pt** of observed WCL point costs, **zero** charged calls during audit and documentation.
- No private A/B/C input or private report codes, no Google Sheets writes, and no additional official C proofs claimed.

## GitHub Actions proof links

- Initial and corrected LFR one-boss parity: [#41067770241](https://github.com/degong2-code/wcl-fresh216/actions/runs/41067770241), [#41068015861](https://github.com/degong2-code/wcl-fresh216/actions/runs/41068015861); corrected receipt readback [#41068295684](https://github.com/degong2-code/wcl-fresh216/actions/runs/41068295684).
- Two other LFR encounters including three NPC bosses: [#41068755320](https://github.com/degong2-code/wcl-fresh216/actions/runs/41068755320); audit [#41069115169](https://github.com/degong2-code/wcl-fresh216/actions/runs/41069115169).
- Wrong scoped actor ID expression, 0 rows: [#41069288441](https://github.com/degong2-code/wcl-fresh216/actions/runs/41069288441). Correct global gameID, 18/18 exact: [#41069579742](https://github.com/degong2-code/wcl-fresh216/actions/runs/41069579742); audit [#41069792738](https://github.com/degong2-code/wcl-fresh216/actions/runs/41069792738).
- Public Heroic Nek'zali fight discovery and 12/12 exact bossDPS by per-NPC targetID: [#41070243464](https://github.com/degong2-code/wcl-fresh216/actions/runs/41070243464).
- Heroic single global gameID expression, **12/12 exact**: [#41070515985](https://github.com/degong2-code/wcl-fresh216/actions/runs/41070515985); receipt audit [#41070784271](https://github.com/degong2-code/wcl-fresh216/actions/runs/41070784271).

## Production feasibility and next work

**Potential two-table approach:** unfiltered DamageDone 1pt + boss-filtered DamageDone 1pt per fight in observed LFR cases, plus fights/masterData metadata cached once per report, versus dual report rankings 4pt per fight. That suggests about **50% marginal point reduction** on many named same-fight C recoveries, subject to independent private A attribution and WCL real costs.

Illustrative **historical**, non-current workload: 2,256 distinct named missing report/fight groups × 2pt = 4,512pt plus the earlier 2,162pt BossDPS top1000 page collection = 6,674pt, **before metadata, failed queries, anonymous slots and original A collection**. On a hypothetical 3,600pt/hour budget this is at least ~1.85 hours of point allowance, so a 2–3h exact named top100 job may become plausible. This is NOT a measured complete pipeline or a guarantee. Current private checkpoint has already collected many of these reports; use cached evidence instead of requery.

**Blockers before accepting the 2-table method as production-equivalent**:
1. **Private exact A identity:** same report/fight/name/class/spec/TotalDPS unique actor proof, pet handling, duplicate names, missing specs, unlisted/anonymous; do not fabricate 100th rank.
2. **Other Heroic encounters:** test additional 7 bosses, especially overlapping/untargetable boss NPC targets, phases, adds, normalized ranking DPS and hidden boss IDs.
3. **Cost/point and speed regression:** test table queries against the same frozen A in an isolated private runner, compare recovered C/pt vs incumbent rankings and ensure duration/SQL filter evidence. Public Actions has NO permission to read private data.
4. All source API/Report tables are mutable; persist original response hash and report revision, avoid silent recomputation drift.
5. Choose 100 rank vs 50 rank after computing actual **per-rank completion from private A**; anonymous 339 earlier missing slots are not resolved by named-only matching.

**No private source or production collector was modified by these public experiments.**
