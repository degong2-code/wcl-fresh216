# Fresh216 live ranking-depth receipt — current Heroic Nek'zali, 2026-10-28

**Execution:** GitHub Actions run [40634406776](https://github.com/degong2-code/wcl-fresh216/actions/runs/40634406776), isolated branch `work/collector-architecture`, activation commit `b168e403b9856370163028e162b60064e4ac7aa4`.

**Authorization:** owner explicitly approved all WCL queries required for this experiment in chat on 2026-10-28. The run used the existing repository Actions Secrets path. No secret value, access token, player name, report code, fight ID, raw ranking row, Sheets ID or private workbook content was logged or committed.

## Fixed scope

- Encounter 3470, Heroic difficulty 4.
- Current global leaderboard scope at query time; no historical 2026-10-08..12 date filter and no manually pinned partition.
- Specializations: Balance Druid, Enhancement Shaman, Survival Hunter.
- Per specialization, one GraphQL POST with TotalDPS page 1 plus BossDPS pages 1, 2 and 3 as aliases.
- A BossDPS row was accepted only for the same **report + fight + unique non-anonymous normalized name + identical startTime**, with noncontradictory known metadata and BossDPS <= TotalDPS.
- This experiment measures leaderboard recovery only. It does not query per-Report fallback, write Sheets, change GAS or merge the PR.

## Observed results

| Spec | Total top100 | Boss page sizes | Same-fight matches page 1 | + page 2 | + page 3 | Cumulative through 300 | Unresolved after page 3 | Anonymous |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Balance | 100 | 100 / 100 / 100 | 29 | 9 | 9 | **47 / 100** | 53 | 2 |
| Enhancement | 100 | 100 / 100 / 100 | 56 | 14 | 8 | **78 / 100** | 22 | 0 |
| Survival | 100 | 100 / 100 / 100 | 63 | 14 | 3 | **80 / 100** | 20 | 0 |
| **Total** | **300** | — | **148** | **+37** | **+20** | **205 / 300 (68.3%)** | **95** | **2** |

Additional aggregate checks:

- Same-key ambiguity: **0**.
- Matching timestamp/revision conflicts: **0**.
- BossDPS greater than TotalDPS conflicts: **0**.
- Named TotalDPS slots not found as the same exact fight in BossDPS pages 1–3: **93**.
- Top-30 same-fight matches after page 3: Balance **13/30**, Enhancement **26/30**, Survival **25/30**. None reached exact top30 completeness from leaderboard pages alone.

### Marginal value by page

Across the 300 TotalDPS actors:

- BossDPS page 1 recovered **148 / 300 = 49.3%**.
- Page 2 added **37 / 300 = 12.3 percentage points**, cumulative **61.7%**.
- Page 3 added **20 / 300 = 6.7 percentage points**, cumulative **68.3%**.

The marginal yield declines but remains material at page 3. Therefore **rank 300 is not a defensible hard completeness boundary** for the current-global sample.

## Actual request cost and time

Exactly **3 authenticated GraphQL POSTs** were attempted and all returned HTTP 200.

| Spec | `currentRequest.total` | Application | Database | User | GraphQL elapsed |
| --- | ---: | ---: | ---: | ---: | ---: |
| Balance | 4.01 | 4.01 | 4 | null | 283 ms |
| Enhancement | 4.01 | 4.01 | 4 | null | 268 ms |
| Survival | 4.01 | 4.01 | 4 | null | 280 ms |
| **Observed sum** | **12.03** | — | — | — | **831 ms** |

Point classes are separate witnesses and are **not additive within a request**. The sum 12.03 above is the sum of the three reported request totals, not application+database+user arithmetic.

The first response reported application headroom 3599 and database headroom 250; subsequent responses decreased consistently. No User-point eligibility was observed.

## Decision impact

The owner's proposed ranking-depth shortcut is **partly validated**:

- **Yes:** page 2/3 are cheap and recover a meaningful extra **57 / 300** exact same-fight BossDPS values beyond page 1.
- **No:** stopping at rank 300 and excluding the rest would discard **95 / 300 (31.7%)** of this current-global TotalDPS top100 sample, including **93 named** slots. That is too large for EXACT-100 U:Y.
- The evidence therefore supports a **hybrid** collection order: reuse page1, extend BossDPS ranking pages while marginal yield remains worthwhile, then use a bounded same-fight official Report rankings fallback for unresolved named slots. Anonymous remains excluded by default and unresolved values remain null.
- This current-global trial is **not the historical 2026-10-08..12 production scope**. A shorter date-filtered cohort may have different page-depth recovery, so do not transplant the 68.3% number into that scope without measurement.

The consumed ref `wcl-fresh216-approved-nekzali-current-20261028-consumed` exists. This experiment must not be replayed by deleting/resetting it.
