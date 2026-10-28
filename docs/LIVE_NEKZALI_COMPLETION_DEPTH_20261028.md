# Fresh216 live completion-depth receipt — Heroic Nek'zali, 2026-10-22..28 KST

**Successful final execution:** GitHub Actions run [40639479233](https://github.com/degong2-code/wcl-fresh216/actions/runs/40639479233), activation commit `f5f600008380e3c7eef60dd4117d8d8013ba6266`.

## Scope

- Encounter 3470 (Nek'zali), Heroic difficulty 4.
- Date filter: `date.1792594800000.1793199600000` = 2026-10-22 00:00 KST through 2026-10-29 00:00 KST exclusive.
- Latest/default partition (no explicit partition number).
- Specializations: Frost Death Knight, Retribution Paladin, Shadow Priest.
- TotalDPS cohort: fixed page1 top100 per spec.
- BossDPS ranking: batches of 10 pages with **no project-defined rank ceiling**, continuing until all named TotalDPS slots match or WCL pagination becomes unavailable.
- Same-fight ranking join: same report + fight + unique normalized non-anonymous name + identical startTime.
- Residual fallback: official `report.rankings(fightIDs:[...], playerMetric:dps/bossdps)` grouped by report/fight, including Anonymous.
- Anonymous report recovery: find one same-fight overall DPS row with exact TotalDPS amount (±0.005), matching class/spec; then crosswalk to boss row by positive report-local actor id, or by the stable report-local temporary label such as `Player (1)` when no positive id is present. Literal `Anonymous` is never used as an actor key.

## Observed ranking pagination ceiling

A sanitized one-query shape probe (run [40638819630](https://github.com/degong2-code/wcl-fresh216/actions/runs/40638819630)) compared Frost DK BossDPS page20 and page21:

- page20: object keys `count, hasMorePages, page, rankings`, rankings length **100**
- page21: object keys `error`, no `rankings`
- HTTP 200, reported request total **1.01**

Therefore the experiment did **not** stop at a chosen rank1000/2000 cap. It continued until WCL itself stopped providing the normal ranking page shape after page20. Treat this as an observed endpoint ceiling for this query/scope, not a universal undocumented API guarantee.

## Ranking phase results

| Spec | Named top100 | Anonymous | Through rank1000 | Added rank1001-2000 | Ranking result through page20 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Frost DK | 99 | 1 | 90 | +1 | **91/100** |
| Retribution | 98 | 2 | 85 | +2 | **87/100** |
| Shadow | 99 | 1 | 72 | +9 | **81/100** |
| **Total** | **296** | **4** | **247/300** | **+12** | **259/300 (86.3%)** |

Per-page exact same-fight yields:

- Frost DK pages1..20: `70,11,3,5,1,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0`
- Retribution pages1..20: `48,20,6,2,5,1,1,0,1,1,0,0,0,1,1,0,0,0,0,0`
- Shadow pages1..20: `35,12,10,4,3,2,3,3,0,0,1,2,0,0,1,3,1,0,1,0`

All page1..20 responses contained 100 ranking rows. Page21 returned the non-ranking `error` object described above.

## Report fallback results

| Spec | Residual after ranking | Report requests | Distinct report/fights | Named recovered | Anonymous recovered | Final |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Frost DK | 9 | 2 | 8 | 8 | 1 | **100/100** |
| Retribution | 13 | 4 | 13 | 11 | 2 | **100/100** |
| Shadow | 19 | 5 | 19 | 18 | 1 | **100/100** |
| **Total** | **41** | **11** | **40** | **37** | **4** | **300/300** |

No same-key ambiguity, startTime conflict, or BossDPS>TotalDPS conflict was observed in the ranking phase.

The earlier integrated run before the temporary-label fix reached **296/300**: all 296 named slots were recovered, but all four Anonymous remained. The cause was an experiment-only bug that rejected `Player (n)` as a report-local actor ref, whereas the installed collector's `wcl35ActorRef_` already allows any nonempty report-local name other than the literal `anonymous`. After restoring that installed behavior, Anonymous recovered **4/4**.

## Cost/time of the successful final run

- Authenticated GraphQL requests: **20**
  - ranking requests: 9 (3 per specialization: pages1-10, pages11-20, page21 ceiling observation)
  - Report fallback requests: 11
- Reported `currentRequest.total` sum: **234.06**
- Sum of GraphQL request elapsed time: **22,509 ms**
- Final result: **COMPLETE_300_OF_300**

This receipt reports the successful final run only. Earlier failed/correction runs and the shape probe also consumed WCL requests; their evidence is preserved by separate immutable consumed refs and must not be silently merged into the successful run's 234.06-point figure.

## Decision impact

1. **A project-defined fixed rank ceiling is unnecessary.** Query ranking pages while they remain useful/available.
2. In the observed endpoint, normal ranking pagination ceased after page20 even though page20 still had 100 rows. Thus the ranking path alone cannot guarantee completion.
3. Ranking depth has diminishing and specialization-dependent marginal yield. Extending rank1000→2000 added only **12/300 = 4.0 percentage points** in this sample.
4. Official same-fight Report fallback completed every remaining named slot and, with report-local `Player (n)` support, every Anonymous slot.
5. The exact target semantics are therefore achievable with the simple hybrid:
   **cached/page1 → adaptive ranking depth → WCL pagination stop or economic stop → grouped same-fight Report fallback → 100/100 or truthful null if a future fight remains genuinely ambiguous.**
6. Do not assume every future job will achieve 100/100; retain fail-closed uniqueness and contradiction checks. This experiment establishes feasibility, not permission to guess.

No raw ranking rows, player names, report/fight identifiers, credentials, OAuth tokens, private workbook content, Sheets writes, GAS changes, PR merge or main deployment occurred.
