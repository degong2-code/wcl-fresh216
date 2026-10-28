# Fresh216 — ranking-first BossDPS recovery policy (owner decision 2026-10-28)

**Authority:** explicit user decisions in the completed ChatGPT conversation, and accompanying user-supplied `last_chat(3).txt` outlining the proposed response. This document supersedes **prior overstrict actor-ID-only and per-Report-first design recommendations** where they conflict. **It is a policy/design document, not a deployed implementation or authorization for API calls.**

## User's actual acceptance policy

1. **Rank cohort:** preserve the source **TotalDPS ranks 1–100** for each selected boss/class/spec/difficulty. Never replace a missing rank with TotalDPS rank 101+, FAST-10 sampling or interpolated values. The 8 bosses × 27 specializations remain 216 jobs per selected difficulty.
2. **Actor equivalence:** if two records have **the same report, same fight, unique character name within that report/fight**, with noncontradictory available start-time/class/spec and report revision, accept them as the same actor for this project. **A canonical Character ID is NOT required**. Block collisions, anonymous names or source identity disagreements. Report-local vs global WCL ID namespace research must not hold up already policy-accepted unique name matching.
3. **Anonymous:** **exclude by default from expensive BossDPS recovery**, even though the WCL report may display stable `Player (1)` style anonymized actors across Bosses/Non-Bosses filters. Their *source TotalDPS rank remains in place*: unresolved BossDPS is `null`; do not delete/rerank people or silently shrink denominators. No standard combatantInfo/trinket/talent probe. Optional narrowly bounded recovery only if future evidence shows worthwhile net benefit and owner chooses to enable.
4. **Missing:** missing BossDPS is `null`, **never zero, a nearest numeric DPS guess, or a rescaled average**. Stop after economical bounded source checks. Partial completion is honest; prioritize a high useful coverage at low marginal WCL points/time, not infinite per-report recovery.
5. **Metric:** use **WCL's official BossDPS** rather than custom target-damage calculation as the default. In-report Bosses / Non-Bosses filters are valid conceptual UI context, but a raw `table(DamageDone)` number or target percentage is **not automatically equivalent** to WCL BossDPS without independent validation.
6. **Original RAW metrics:** keep existing TotalDPS and independent BossDPS ranking statistics and exact underlying rank snapshots unchanged where required by the existing contract. Crucially, the **U:Y nonboss shares refer to TotalDPS rank 1/30/100 and TotalDPS top30/top100 cohorts**, not whatever actor is BossDPS-rank 1/30/100. If existing RAW has separate BossDPS-ranked top100 KPI columns, retain them and do not confuse them with the joined per-TotalDPS-rank BossDPS vector.
7. **Top-N U:Y formula:** individual `(TotalDPS - same-actor BossDPS) / TotalDPS`; top-N `(sum(TotalDPS) - sum(BossDPS)) / sum(TotalDPS)` only when **all required ranks have BossDPS**. Never silently divide by the matched subset.

## Proposed simplest collection order — validate before implementing

- Reuse authenticated, immutable TotalDPS top100 and first 100 official BossDPS ranks **without repeating an already proved fetch**.
- Join the two rankings using owner-approved unique **report + fight + name**, enforcing noncontradictory timestamp/snapshot/revision and **uniqueness on both sides**.
- If all eligible slots are resolved, STOP. If more remain (excluding the anonymous policy), **try BossDPS's next ranking page**, stop when marginal recovered slots/point or wall-clock cost becomes unattractive, tentatively cap at page 3 (~rank300 **ONLY IF the official current API page size is confirmed to be 100**).
- Per-report fight `rankings()` recovery: **not the default**; reuse any existing proof, and only consider a bounded fallback when measured marginal cost and recovery justify it. Don't increase TotalDPS depth automatically to 200/300: the output cohort stays at TotalDPS top100, and more TotalDPS rows cannot find an actor absent in the BossDPS sorted list.
- De-duplicate page requests across specs/bosses where the actual current API scope and access policy allow; don't assume queries can be shared across distinct specs just because page index matches.
- Treat all cached current PROOF values as **already stored numeric witnesses**, not automatic proof of canonical actor identity. Never re-fetch 2,721 already name-matched or 4,326 historically stored values merely to satisfy an ID-only criterion.

## 2026-10-28 P0 offline cutoff finding — leaderboard best-parse limitation

This is an **aggregate-only finding** from the already source-attested **44 private G413 snapshots and saved PROOF**. It is NOT another 44-hash audit; no identities, report codes, raw ranking rows, workbook, or credentials were copied to this repository. No new WCL/Sheets operations were performed.

| Existing stored evidence | Aggregate |
| --- | ---: |
| TotalDPS top-100 source slots | 4,400 |
| Direct same-fight/name BossDPS values | 2,721 |
| Other non-null saved BossDPS values | 1,605 |
| Other saved BossDPS **below** their own job's cached BossDPS rank-100 cutoff | **1,460** |
| Other saved BossDPS **above** the same cutoff | **145** (40/44 jobs) |
| Above-cutoff values present in BossDPS page 1 by same report+fight+normalized name | **0** |
| Above-cutoff values with same name elsewhere in BossDPS page 1 but different report/fight | 23 (possible namesakes; not actor proof) |
| Below-cutoff values with same name elsewhere in BossDPS page 1 but different report/fight | 17 |
| Above-cutoff within 5% of cutoff | 92 |
| Missing slots: anonymous/blank vs named | 70 vs 4 |

**Why the original page-2/3 hypothesis needs a qualification:** Warcraft Logs distinguishes a character's **ranking (best metric-specific score)** from their **parses (all individual fight results)**. The best TotalDPS report/fight and the best BossDPS report/fight may differ even for the same actor. An encounter BossDPS ranking page does **not promise to list every other eligible BossDPS parse of that actor**; more leaderboard pages may therefore never expose the BossDPS for the **specific** fight selected by TotalDPS rank 1-100.

Under an identical, complete, unchanged and descending BossDPS leaderboard, **a saved BossDPS above the 100th-place amount cannot first appear on page 2 or 3**. The 145 cases are therefore **not evidence that pagination depth alone explains every missed direct match**. Their exact root causes (leaderboard eligibility, best-parse selection, archival timing, metric/partition/scope differences or stored source provenance) remain unverified. Likewise, 1,460 below-cutoff cases are **potential** new-page matches, *not measured page-200/300 recovery*. Do not classify a specific named null by cutoff without a trustworthy same-fight BossDPS.

**Revised smallest path:**
1. Reuse existing TotalDPS top100, official BossDPS page1 and already stored same-fight PROOF. Never re-fetch or reassign a different fight's BossDPS.
2. Treat BossDPS page 2/3 as **conditional discovery**, not a proven complete replacement for per-fight Report sources; inspect and stop according to *actual newly matched same-report+fight+unique-name slots per observed points and elapsed time*. Do not assume 100 rows per future page.
3. Keep a **bounded, measured official `report.rankings(fightIDs, playerMetric: bossdps)` fallback** for economically worthwhile **named** TotalDPS fights absent from leaderboards. It is not an unrestricted Report chase; the report-level response remains subject to identity/metric/revision checks. Do not substitute unverified `table(DamageDone)` for official BossDPS.
4. Anonymous remains excluded by default. Source TotalDPS ranks remain fixed; unresolved BossDPS and dependent U:Y are null. Neither saved numeric concordance nor matching names on **different** fights prove same-actor parity.
5. Do **not** introduce a speculative page adapter, permanent retry loops, a new validation gate, or more ID bridges before a separately approved **bounded live page/Report ROI observation**. The four prior paid approvals are exhausted.

Sources (public documentation, not new authenticated queries): [WCL rankings vs parses](https://www.warcraftlogs.com/help/ranks/); [Encounter.characterRankings page/metric/partition/filter](https://classic.warcraftlogs.com/v2-api-docs/warcraft/encounter.doc.html); [Report.rankings fightIDs and playerMetric](https://www.warcraftlogs.com/v2-api-docs/warcraft/report.doc.html).

### Current measured facts and remaining questions

1. **Current-global page size was observed:** in the approved 2026-10-28 Heroic Nek'zali trial, BossDPS pages 1, 2 and 3 each returned 100 rows for Balance, Enhancement and Survival. This does **not** prove that every encounter/spec/date-filter scope always has 100 rows/page.
2. **Exact same-fight semantics:** only rows with the same report, fight, unique non-anonymous normalized name and identical startTime were joined. Different fights for the same apparent player are not substitutes.
3. **Archived cutoff study is complete:** among 1,605 historical non-direct stored values, 1,460 were below the same-job cached Boss rank100 cutoff and 145 above it. That was a prospective bound, not page-depth recall.
4. **Current-global page-depth cost is now measured:** three batched GraphQL requests (Total page1 + Boss pages1–3) cost 4.01 reported total points each, sum 12.03, with 831 ms summed request elapsed. The cost/yield of a production-equivalent date-filtered scope and the residual grouped Report fallback remain unmeasured.
5. **Current-global rank300 was insufficient:** exact recovery was 205/300 (68.3%), leaving 95 unresolved, 93 of them named. Page2 added 37 exact matches and page3 added 20. Do not adopt rank300 as a fixed completeness boundary.
6. Archived evidence remains: 44 private snapshots (4,400 TotalDPS ranks), 2,721 direct name joins, 1,605 other stored BossDPS values, 4,326 saved / 74 null. The 43-job G421 69-missing/67-anonymous scope is distinct.

## Current next executable development

- Preserve already verified page1/cached same-fight values.
- Integrate measured ranking-depth recovery into the 216-job plan without creating another heavyweight runtime: page2/page3 (and any deeper page) is justified only by observed marginal same-fight recovery per points/time.
- For named residuals, retain bounded official same-fight `report.rankings(fightIDs, playerMetric: bossdps)` fallback; do not replace it with arbitrary table damage or estimates.
- Before choosing a permanent page-depth stop rule for the historical production cohort, measure the same strategy under the actual date-filter/partition scope. Current-global 68.3% is evidence about the present global leaderboard only.
- Keep Anonymous default-null and preserve fixed TotalDPS top100 denominators.

## Stop rules and environment

- The **historical 4/4** WCL GraphQL approvals from 2026-10-27 remain consumed and their immutable refs must never be reset. Separately, the owner approved the 2026-10-28 current Nek'zali depth study; exactly **3 additional GraphQL requests** executed successfully in run 40634406776. Its consumed ref `wcl-fresh216-approved-nekzali-current-20261028-consumed` now blocks replay of that exact experiment.
- Normal CI, BOOT or handoff must not open a new paid experiment. A new live scope requires the existing fixed allowlist/manifest gate and clear owner authorization for that scope.
- No GAS runtime changes, trigger edits, Google Sheets writes, PR merge or main deployment without explicit approval.
- Actual installed TEST GAS export (36 files/35 JS) privately redacted one real WCL `client_secret`; do not upload any ZIP/raw source, Sheet/PROOF, IDs or tokens to the public repo.
- Baseline last observed TEST G4.13/G4.15: STOPPED, cursor 43 (historical observation, not current live check); G4.25 disabled.
- Product source of truth: `degong2-code/wcl-fresh216` branch `work/collector-architecture`, Draft PR #2. Private continuity: `degong2-code/ai-project-lab` branch `work/wcl-fresh216-source-review`.
- Progress proof remains one finished 216-job selected-scope execution with measured time, WCL points and truthful unresolved-share reporting, followed by correct A:Y Google Sheets output.

**Status 2026-10-28:** ranking page2/page3 live ROI is now measured for three current-global Heroic Nek'zali specs. It is cheap and materially useful, but rank300 alone is insufficient; the active design is ranking-first plus bounded same-fight Report fallback.

## Historical offline execution bridge after cutoff study (completed before LIVE pilot)

The new pure module \`src/core/boss-page-recovery.mjs\` implements the **missing normalized page boundary only**, not another report collector or runtime. Its entry points make an official-shaped **BossDPS-only page 2 or 3** GraphQL document (no network), decode an *injected* response and observed \`currentRequest.total\` (unknown cost remains null), and compare cached page 1..N to exactly 100 immutable TotalDPS rows, preserving any previously saved BossDPS proof. They refuse different report/fight, ambiguous/masked names, conflicting timestamps or known revisions, and implausible BossDPS. A page-3 candidate is explicitly **not authorization to dispatch**; there is no automatic retry, token, request scheduler, durable write, or Google Sheets I/O.

**Minimal future operation sequence (not executed):** 
1. Read one scope's certified TotalDPS 100, existing BossDPS page 1 and saved same-fight BossDPS. Distinguish already stored numeric evidence from newly verified actor provenance.
2. Match cached rows; if there are no unresolved named actors, stop. Skip masked Anonymous without changing TotalDPS ranks or computing partial top-N KPI denominators.
3. If needed, decide whether an **observed-cost-bound** request for BossDPS page 2 is worth issuing; record durable request intent before *any* future HTTP. Inspect actual page size and response identity. Repeat for page 3 only with meaningful observed marginal benefit. The current module merely emits candidates and has **no network/durable integration**.
4. Group remaining named actors by original report/fight; reuse cached official per-fight BossDPS evidence before considering bounded \`report.rankings(fightIDs, playerMetric: bossdps)\` recovery. The existing single-fight durable runner is not yet wired to a ranking-page journal, so these paid operations remain BLOCKED.
5. Record per-page new **same-fight** matches, observed point classes, HTTP cost, wall time, unresolved counts, and completed top30/top100 jobs. Do not extrapolate 44 archived snapshots into 216-job live throughput. Maintain independent boss-ranked RAW KPI values alongside TotalDPS-linked U:Y.

The offline synthetic tests in \`tests/boss-page-recovery.test.mjs\` demonstrate query scope, one-to-one matching, null and cached-proof preservation, guarded failure, and no auto dispatch. They do **not** verify WCL's real pagination length, official response shape, cross-version identity or actual time/points. Historic 75 tests are not rerun by this patch. Production approval is still separately required for LIVE query, GAS/Sheets edit or merge.


## LIVE current-global depth result — 2026-10-28

The owner approved a fresh current Heroic Nek'zali measurement and the common GitHub Actions lane executed it successfully in run [40634406776](https://github.com/degong2-code/wcl-fresh216/actions/runs/40634406776). Three specializations were queried independently; each request batched TotalDPS page 1 with BossDPS pages 1–3. All three Boss pages returned 100 rows.

Exact same-report/fight/unique-name/startTime recovery was:

- Balance: **29 → 38 → 47 / 100**
- Enhancement: **56 → 70 → 78 / 100**
- Survival: **63 → 77 → 80 / 100**
- Aggregate: **148 → 185 → 205 / 300 = 68.3%**, leaving **95 unresolved**, of which **93 were named** and 2 anonymous.

No duplicate-key, timestamp/revision or BossDPS>TotalDPS conflict was observed. Page 2 added 37 exact matches and page 3 added 20. Three WCL GraphQL requests reported total costs 4.01 each (sum **12.03**) and 831 ms summed request elapsed.

**Policy consequence:** page-depth recovery is cheap and valuable, but a fixed rank-300 stop is **not sufficient** for current-global EXACT-100. Keep ranking expansion first, then bounded official same-fight Report `rankings(... playerMetric: bossdps)` fallback for named unresolved actors. Do not exclude 31.7% merely to avoid the fallback. The optimal stop depth should be based on measured marginal same-fight recovery per observed points/time, not an assumed rank count.

This live result does **not** measure the historic 2026-10-08..12 date-filtered production cohort; that shorter scope can have different recovery. Full sanitized receipt: [LIVE_NEKZALI_RANK_DEPTH_20261028.md](LIVE_NEKZALI_RANK_DEPTH_20261028.md).


## LIVE production-like date-window depth result — 2026-10-28

A second owner-approved live measurement used Heroic Nek'zali with a **2026-10-22..28 KST date filter** and BossDPS pages 1–10. The first attempt forced stale `partition:1` and returned zero ranking rows; the corrected run omitted partition so WCL selected the latest default partition.

Corrected exact same-report/fight/unique-name/startTime recovery:
- Balance: **60/100**
- Enhancement: **92/100**
- Survival: **92/100**
- Aggregate cumulative: **162 → 202 → 217 → 223 → 226 → 232 → 235 → 237 → 240 → 244 / 300** from BossDPS page1 through page10.
- Final rank1000 coverage: **81.3%**, leaving **56 unresolved = 52 named + 4 anonymous**.
- Top30 through rank1000: Balance 19/30, Enhancement 28/30, Survival 27/30.

Three corrected GraphQL requests reported 11.01 total points each (33.03 summed) and 2,350 ms summed GraphQL elapsed. All BossDPS pages 1–10 returned 100 rows.

**Policy consequence:** a shorter date window improves ranking-depth recall, and rank300→1000 has measurable value (+27/300), but even rank1000 does not replace same-fight Report recovery. Permanent depth should therefore be **adaptive/marginal**, not a fixed 300 or 1000 threshold. Named residuals continue to the bounded official Report rankings path; anonymous stays null.

Sanitized receipt: [LIVE_NEKZALI_DATE_20261022_28_RANK1000.md](LIVE_NEKZALI_DATE_20261022_28_RANK1000.md).


## LIVE completion-depth + Anonymous result — 2026-10-28

Owner-approved Heroic Nek'zali (Oct 22–28 KST) completion-depth experiment used **Frost DK / Retribution / Shadow**, not the previous three specs. BossDPS rankings had no project-defined rank cap: 10-page batches continued until WCL stopped returning a normal rankings shape. Page20 returned 100 rows; page21 returned an `error` object, so practical ranking discovery stopped at the WCL endpoint boundary.

Ranking alone recovered **259/300 (86.3%)** through page20: Frost 91, Ret 87, Shadow 81. Rank1000→2000 added only 12 exact same-fight slots total.

Grouped official same-fight Report fallback then recovered **37 named + 4 Anonymous**, producing **300/300**. Anonymous recovery succeeded after matching the installed collector's existing rule: use exact TotalDPS + class/spec within the same report/fight, then crosswalk overall→boss by positive actor id or stable report-local temporary label such as `Player (n)`. Never use the literal `Anonymous` as identity.

Successful final run: 20 GraphQL requests, reported request-total sum **234.06**, 22.509 s summed GraphQL elapsed. Full sanitized receipt: [LIVE_NEKZALI_COMPLETION_DEPTH_20261028.md](LIVE_NEKZALI_COMPLETION_DEPTH_20261028.md).

**Active policy:** adaptive ranking-first discovery is an optimization, not the completion mechanism. Stop ranking on measured low marginal value or WCL pagination unavailability; then use bounded grouped same-fight Report rankings for all residual named and Anonymous slots. Preserve null for genuinely ambiguous future cases rather than guessing.
