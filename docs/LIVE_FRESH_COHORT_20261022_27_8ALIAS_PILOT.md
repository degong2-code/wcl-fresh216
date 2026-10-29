# WCL Fresh216 — 2026-10-22 to 2026-10-27 KST, Heroic latest/default

**Owner-approved actual WCL pilot executed 2026-10-28.**

- Workflow: [run 40652619477](https://github.com/degong2-code/wcl-fresh216/actions/runs/40652619477)
- Activation-only source commit: `c33fd34963961279ebe18546517ea117ad7ea3fc`
- Immutable one-time consumed ref:
  `refs/heads/wcl-fresh216-oct22-27-nekzali-8alias-pilot-consumed`
  points to activation SHA, created before OAuth and WCL HTTP.
- Requested window: Oct 22 00:00 to Oct 28 00:00 **KST exclusive**
  (calendar dates Oct 22–27 inclusive)
- Official date filter: `date.1792594800000.1793113200000`
- Difficulty 4, latest/default partition (no `partition` argument)
- Encounter 3470 (네크잘리), the exact FIRST eight specializations
  in the imported `DPS_SPECS` roster.
- Query: one GraphQL POST containing **eight aliased**
  `characterRankings(metric:dps,page:1)` selections. No BossDPS query.
- Outcome: HTTP 200, 8/8 specializations each returned exactly 100
  source rows with valid report/fight/time/DPS and within-date checks.
- WCL `rateLimitData.currentRequest.total`: **8.01** (one
  request); measured API round trip **954 ms**.
- Offline bootstrap CI SUCCESS; approved paid job SUCCESS; other paid
  jobs all SKIPPED.
- Raw actors/reports/fights/OAuth tokens not printed in Actions, not
  uploaded as artifacts, not committed to repository or Google Sheets.

| Specialization | TotalDPS page 1 rows checked |
| --- | ---: |
| DeathKnight/Frost | 100 |
| DeathKnight/Unholy | 100 |
| DemonHunter/Havoc | 100 |
| DemonHunter/Devourer | 100 |
| Druid/Balance | 100 |
| Druid/Feral | 100 |
| Evoker/Devastation | 100 |
| Evoker/Augmentation | 100 |
| **Total shape-verified rows** | **800/800** |

## Critical distinction: verification is not durable source capture

The approved one-time pilot intentionally emitted **only aggregate
counts, point total and elapsed time** to the public Actions log.
The returned 800 private actor rows existed only in ephemeral runner
memory and were **not saved**.

Accordingly, **fresh 216-job TotalDPS source durability is 0/216**.
Do not count 8/216 as persisted or claim 800 recoverable character rows.
The previous historical G4.13 workbook's 44 COMMITTED jobs are for
Oct 8–12, partition 1, not the new scope.

The 8.01 point observation is for this exact 8-alias request. It is
not a guaranteed fixed WCL tariff for every boss, 3-alias tail request,
later execution, or historical date range. The 32-operation plan
remains a proposal until 216 exact source jobs are persisted.

## Next safe full capture path

Use `src/core/fresh-cohort-source.mjs` with an existing
`JsonCheckpointStore` on a **PRIVATE PERSISTENT SINGLE-OWNER**
host outside the public checkout. Caller provides authorized OAuth
transport and a bounded point admission policy.

Per request, persist entire checkpoint **before** WCL HTTP, validate
all 1–8 aliases, and persist the complete 100-row source arrays
alongside one request-total cost witness. On any uncertain response or
crash, block retry for manual reconciliation. The 216-job source
gate requires all 32 operations to be COMPLETED and every 100-row
job independently validated before feeding `planAdaptive216`.

A normal GitHub Actions worker in this PUBLIC repository has only
ephemeral disk. A public Actions artifact containing raw actors
would violate the privacy boundary, and the normal
`GITHUB_TOKEN` cannot write to a separate private repository merely
because the chat's GitHub connector can access that repository.
**Do not run the remaining paid 31 batches through summary-only
Actions if their raw results cannot be privately retained.**

The eventual complete 216-job benchmark, BossDPS recovery,
Google Sheets/GAS deployment and `main` merge remain separate.
