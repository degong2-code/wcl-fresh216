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

### Remaining technical questions: do NOT invent answers

1. Does the **current retail Warcraft Logs GraphQL** `characterRankings` query accept the needed BossDPS metric/filter and return **100 records per page** for the chosen encounter/spec/difficulty/date scope? Confirm response shape and pagination against documentation/schema or permitted cached evidence; a live query requires **new explicit user consent**.
2. Is the BossDPS ranking value on page 2/3 semantically the same as the BossDPS required for the TotalDPS-ranked actor (identical encounter, report, fight, timeframe, kill, difficulty, spec, data revision and metric)? Do not silently assume.
3. How many of the previous report-recovered slots have a BossDPS below the cached first-page BossDPS rank-100 threshold? **First run this as a read-only offline histogram using the existing 44 committed sample snapshots**; this can reveal likely payoff, but *cannot establish exact rank-200/300 recall* without those pages.
4. Real additional API **points by category**, GraphQL aliases, wall time, rate-limit waits and incremental recovery per page are **unmeasured**; one page is not guaranteed cheaper than several grouped reports. Do not optimize HTTP count in place of cost/time.
5. Currently known archived evidence: 44 private snapshots (4,400 TotalDPS ranks), 2,721 direct name joins, 1,605 other stored BossDPS values, **4,326 saved / 74 null**; top30 complete 27/44 and top100 complete 16/44. 43-job G421 historic `69 missing / 67 anonymous identityless` is a **different scope**; no false arithmetic between 69 and 74.

## Preferred next executable *offline* work

One bounded, reusable offline evaluation — **without any API request** — using already authorized private snapshots:
- For each of the 44 jobs, classify BossDPS recovery sources (first-page direct, already saved proof outside first-page, null/anonymous/ambiguous).
- Compare report-recovered BossDPS numeric values to the 100th BossDPS ranking cutoff in the same job; aggregate how many logically lie outside page 1, how many are ambiguous/unknown; measure prospective benefit and uncertainty of page 2/3. This is **an offline bound**, not a fake full-page reconstruction.
- Define a tiny ranking-page adapter contract + minimal unit tests only if the observed payoff or current installed source supports it. Prefer replacing/disabling report-heavy paths over building more G4.x diagnostic layers.
- At a later explicitly approved small live pilot, observe actual page size, payload, marginal matches, official BossDPS semantics, point cost and total elapsed time. Compare on equivalent scope with legacy grouped Report recovery. Choose the cheaper *verified* option.

## Stop rules and environment

- All **four of four** historically authorized WCL GraphQL calls have been consumed. "진행", BOOT, context handoff or normal CI **do not authorize a fifth call**. No relays/marker reset.
- No GAS runtime changes, trigger edits, OAuth/secret handling, Google Sheets writes, PR merge or main deployment without explicit approval.
- Actual installed TEST GAS export (36 files/35 JS) privately redacted one real WCL `client_secret`; **do not upload any ZIP/raw source, Sheet/PROOF, IDs or tokens to the public repo**.
- Baseline last observed TEST G4.13/G4.15: STOPPED, cursor 43 (historical observation, *not* current live check); G4.25 disabled.
- Product source of truth: `degong2-code/wcl-fresh216` branch `work/collector-architecture`, Draft PR #2. Private continuity: `degong2-code/ai-project-lab` branch `work/wcl-fresh216-source-review`.
- Progress proof is **one finished 216-job selected-scope execution** with measured time, WCL points and truthful unresolved-share reporting, followed by correct A:Y Google Sheets output — not passing ever more synthetic gates.

**Status 2026-10-28:** policy adopted and implementation strategy proposed. Ranking page 2/3 recovery, its ROI and official metrics have NOT been executed or shown effective. No operational change.

## Offline execution bridge after cutoff study (2026-10-28, no LIVE permission)

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
