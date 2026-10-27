# WCL v2 (October 2026) points/rankings-vs-table — bounded decision gate

Status: **ORIGINAL TWO/TWO + NEWLY APPROVED ONE/ONE GRAPHQL ATTEMPTS EXECUTED — ALL CONSUMED, NO RETRY**, 2026-10-27.
The once-only marker exists; runtime transport succeeded but table's
same-actor identity comparison was NOT established. The preserved older
planning sections below describe the pre-execution state and are NOT
authorization to spend any more WCL points. No Sheets/deployment approval.

## Follow-up single-query identity witness — 2026-10-27

**Owner separately approved at most ONE more GraphQL request** for
public WCL report dQbNzMkG94LqYTh1, FightID 11. It was executed
exactly ONCE via exclusive add-only commit
62751d5283c760dc970785e200d5660d4aa9cf8d after offline CI PASS.
CI run:
https://github.com/degong2-code/wcl-fresh216/actions/runs/40513601801

Unlike the previous twice-approved report experiment, this query COMBINED:
- overall rankings(dps) and boss rankings(bossdps) for Fight 11;
- table(DamageDone, Source, translate:false) for Fight 11;
- masterData(translate:false){actors{id name server type subType petOwner}};
- rateLimitData direct category witness.

GraphQL HTTP 200, report revision 17, elapsed 3394 ms, point fields
currentRequest.total=6.68, application=4, database=25, user=2.68;
application remaining 3599, database remaining 250,
userHasRemainingPoints NULL. Category fields are NOT additive or proof
of final billing from the client-credentials OAuth flow.

Redacted on-run diagnostics:
- 14 total/boss rankings actors matched across metrics.
- 20 DamageDone source table rows; zero direct numeric ID overlap
  between ranked actors and table sources.
- 235 Report master actors: 34 Player, 153 Pet, 48 NPC.
- ALL 20 table source IDs were found among masterData actor IDs.
- All 14 ranking actors had names and class, but ZERO ranking rows
  presented a nonempty server STRING.
- Offline identity bridge returned MASTER_ACTOR_IDS_AMBIGUOUS and
  NO_VERIFIED_NAMESPACE_BRIDGE (NEEDS_REVIEW, exit 3). The original
  bridge requires positive unique IDs across masterData actors and
  name+server+class consistency. Actual reason for ambiguous master
  actor IDs (nullable/missing/repeated) remains unverified because
  raw responses were intentionally not written to public logs or
  preserved. ReportActor.id is nullable in the official schema.

Observed result establishes table-to-masterData structural ID
membership on 20/20 sources, NOT unique player attribution.
With no ranking server strings, strong name+server+class bridging
cannot be validated. Neither EXACT-100 BossDPS numerator nor DPS
denominator, pet ownership or per-player identity equivalence is
proven. Never fill missing evidence with name-only assumptions.

Dedicated one-shot marker exists:
refs/heads/wcl-fresh216-identity-one-query-consumed-20261027,
pointing at request commit. The previous two-query marker remains
untouched. No other WCL requests, retries, marker resets, additional
OAuth grants, Sheets writes, main merges or production collector
changes are authorized.

This run comprises (1) an automatic push CI offline job SUCCESS,
(2) the new identity job COMPLETED FAILURE purely due to conservative
semantic NEEDS_REVIEW after HTTP 200, and (3) the old WCL paid relay
SKIPPED. No raw response or artifacts were uploaded.

---

## Verified one-time live result — 2026-10-27 (supersedes pre-run statements below)

**Execution path verified without user's GitHub Actions UI, Work browser
or local CLI.** The ChatGPT-authored ADD-only request commit
'e6387bebc3d9a2c7b317c0e66c1f159c8df78c1e' on the
'work/collector-architecture' branch automatically triggered existing
offline push CI run 40486404087 (PASS); its isolated Actions:write relay
job dispatched the manual-only default-main WCL workflow run 40486449886.
The relay reported the EXACT resulting workflow run ID. All unrelated
development pushes skipped the relay job. The main WCL workflow was NOT
switched to automatic push triggering.

Links:
- https://github.com/degong2-code/wcl-fresh216/actions/runs/40486404087
- https://github.com/degong2-code/wcl-fresh216/actions/runs/40486449886

Source: one CURRENT public report 'dQbNzMkG94LqYTh1', FightID 11,
independently linked by a public 2026-10-16 video, but NOT independently
validated by a separately billed WCL report fetch. Both bounded GraphQL
requests themselves returned HTTP 200, with matching report revision in
the safe receipt. OAuth authentication and the EXACTLY-ONCE persistent
GitHub ref guard succeeded. The marker
'refs/heads/wcl-fresh216-one-time-probe-consumed-20261027' exists.

Observed redacted request metadata (NOT an authorization to infer actual
settled category billing):

| Metric | rankings(dps,bossdps) | DamageDone table(Source) |
|---|---:|---:|
| HTTP | 200 | 200 |
| elapsed ms | 3624 | 988 |
| currentRequest.total | 4 | 1.62 |
| currentRequest.application | 4 | 0 |
| currentRequest.database | 35 | NULL |
| currentRequest.user | NULL | 1.62 |
| userHasRemainingPoints | NULL | NULL |
| same report revision | yes | yes |

CAVEATS: 'currentRequest.user' is a potential User-eligible allocation,
NOT proof of actual User-point settlement with a client-credentials
OAuth token. No user was authenticated. Database is a separately metered
sub-quota and cannot be arithmetically added to total/application cost.
The observed 3624 vs 988 ms is **ONE sample** per method, not an
end-to-end 216-job completion benchmark. No confirmed app/DB savings
or exact same-actor boss-only DPS equivalence may be concluded.

The first rankings request identified **14** cross-metric DPS actors.
The table response contained **20** source rows but **0** rows shared
numeric IDs directly with those ranking actors. This is a failure of
the attempted **direct-ID equivalence method**, not proof that the
underlying players differ or their DPS numbers disagree. A canonical
character ID versus report-local actor ID mapping is a plausible,
**UNVERIFIED** cause. Raw JSON was deliberately held privately and
deleted at workflow exit; public GitHub retains only aggregate metadata.

Result: run 40486449886 completed **failure** with application-level
'FRESH_TABLE_NO_SHARED_RANKED_SOURCE'/'NEEDS_REVIEW' (exit 3), even
though both HTTP requests returned 200. The configured one-time ref
was consumed. **Further WCL requests, a new nonce or marker deletion,
retry, other credential grants, and automatic scheduled experiments
require new explicit owner authorization.** Keep rankings and EXACT-100
semantics unchanged.

---

## What changed and why it matters

Archon/WCL announced **20 October 2026** beta API point changes, intended
to remain in beta at least through November 2026. Current categories:

- **Application**: usual app-key spending; Database points form a limited
  subset of Application points with potentially separate quota.
- **Database**: rankings and similar database-intensive fields; Report
  `rankings()` is marked **[Database Points]**.
- **User**: eligible report tables/graphs under a **user-authorized OAuth
  code/PKCE flow**. `Report.table()` is marked **[User-Eligible Points]**,
  but this is **not** automatically free/available to client-credentials
  requests. User-point availability, fallback, and separate caps must
  be confirmed from a live, user-authorized rate witness.
- A request can require app-point availability even when eligible to spend
  User points. Therefore do NOT treat `currentRequest.total` or the old
  `limitPerHour` aggregate as a verified complete three-category budget.
  The JSON shape/caps must be observed during this beta.

Sources (public, recheck before LIVE):
- https://www.archon.gg/classic-mop/articles/help/archon-api-updates-beta
- https://www.warcraftlogs.com/v2-api-docs/warcraft/report.doc.html
- https://www.warcraftlogs.com/v2-api-docs/warcraft/ratelimitdata.doc.html
- https://www.warcraftlogs.com/v2-api-docs/warcraft/tabledatatype.doc.html
- https://www.warcraftlogs.com/v2-api-docs/warcraft/viewtype.doc.html
- https://www.warcraftlogs.com/api/docs

## Offline code and critical schema correction

- `src/core/wcl-query-comparison.mjs` generates **TWO separate** query
  documents scoped to the **same single** report/fight/revision: existing
  `rankings(dps)` + `rankings(bossdps)` and
  `table(dataType:DamageDone,viewBy:Source,translate:false)`.
- No HTTP client is added; `authorizedToExecute:false` is explicit.
- Crucial correction: official `rateLimitData.currentRequest` is a **JSON
  scalar**, so queries must select `rateLimitData{currentRequest}`, not
  `currentRequest{total}`. The reported `currentRequest` payload may
  contain `total` but its nested JSON keys are NOT a GraphQL selection set.
  Both one-Fight and wave query builders now request the scalar correctly.
  Numeric point accounting remains UNKNOWN if a trustworthy witness is absent.

## One-time LIVE decision experiment — approved scope, not yet executed

1. Select **one legitimately accessible report + one Fight** already
   represented by a ranking snapshot. Keep report code, fight ID, actor IDs,
   and private user data only in a private executor/receipt, never public Git.
2. Verify snapshot SHA, report revision, encounter ID, difficulty,
   normalization/actor IDs and fight selection. STOP if they drift.
3. Send at most **two separate**, sequential GraphQL requests (one rankings
   with both dps/bossdps; one DamageDone table), with a strictly bounded
   persisted **one-Fight** checkpoint and verified runtime rate-category
   observation. No combined alias query: that would obscure per-method
   point cost. Avoid any additional exploratory requests/automatic retries.
4. Capture in a **private** receipt for each attempt: route/auth flow type
   (not token), request start/finish timestamps, HTTP/GraphQL status,
   rate-limit class/counter witness including database/application/user
   if exposed, raw reported cost (nullable), report revision,
   response shape/actor matching status, and duration. When missing,
   explicitly store UNKNOWN; never infer from historical average HTTP cost.
5. To evaluate parity: match the same Fight, ranking slot and *unique*
   actor (including pets if applicable), compare normalized total DPS and
   BossDPS numerator and fight-time denominator. The raw DamageDone table
   MAY aggregate raw damage rather than ranking-normalized DPS; the overall
   table response alone cannot establish **boss-only target selection**
   (multi-boss encounters, adds, duplicate actor IDs, pet rules), so it must
   NOT be promoted to an EXACT same-actor BossDPS proof.
6. Report a 2-row comparison with measured app/DB/user points if separately
   observed, latency, unresolved semantic differences and actual rank/actor
   proof coverage. Any missing piece leaves the candidate as
   `NOT_EQUIVALENT_OR_UNPROVEN`; keep `rankings` baseline.
7. A third query, a different OAuth grant, a real 216-job run, Google Sheets
   writes, trigger activation or production merge require NEW explicit
   authorization. This probe does not authorize those actions.

## Decision rule

Adopt `table()` only if it demonstrably reproduces the required
same-ranked-character **TOTAL and BossDPS metrics** with no estimated
denominators or target guesses **and** has a measured practical benefit for
real quota categories and end-to-end time. Otherwise retain rankings.
Separate semantic feasibility from point cost; lower DB cost does not
compensate for wrong attribution.

## Owner approval and still-required private execution inputs

- **Approved 2026-10-27**: up to **2 WCL GraphQL requests** for one
  legitimately accessible Report/Fight, existing owned client credentials,
  acknowledging unpredictable point cost. Approval does not supply the
  original private snapshot, source Report/Fight/revision, or credentials.
  No credentials may be pasted into chat or a repository.
- **Separate optional**: whether to implement a user-login OAuth Code/PKCE
  grant to use User points. Do not silently change the current
  client-credentials security model. Only decide this after seeing real
  point allocation and whether this mode is needed.

**Do not schedule, run, or repeat an actual experiment from this document alone.**


## Offline receipt assessment (not itself execution authorization)

The existing two-query plan now exposes
'fingerprintComparisonRequest(request)' and
'assessTwoRequestComparison(plan, observations)' from
'src/core/wcl-query-comparison.mjs'. These are pure, network-free helpers
for processing redacted observation metadata **after** a separately authorized
private experiment. They neither create authorization nor execute requests.

- Require the original ordered request fingerprints, at most TWO observations
  for ONE Report/Fight; mismatched or third entries are rejected.
- Return only aggregate metadata. Raw reports, actor IDs, credentials,
  caller-added fields and rankings data are never copied to the summary.
- Reported 'currentRequest.total' is held independently from any directly
  witnessed Application/Database/User categories. Category costs remain NULL
  when category-level evidence is unavailable; no deduction from HTTP count,
  GraphQL alias count or client-credentials point eligibility is allowed.
- A valid HTTP/GraphQL response with matching revision is **necessary but
  not sufficient** for correctness. Even two nominal successes yield
  'NOT_EQUIVALENT_OR_UNPROVEN' and 'adoptTable:false'. Target classification,
  pet ownership, DPS denominator and per-rank actor parity require a separate
  evidence-based validator after actual response shapes are known.
- This is an offline comparison receipt *structure*, not proof that supplied
  metadata was genuinely produced by WCL or that the live query is valid.
  Never use it as the live point admission or production execution host.

Offline regression adds six fail-closed Node test declarations, all using
synthetic non-real reports. Existing historical installed-source tests remain
outside this synthetic CI. The owner subsequently authorized the two-query scope. These offline
receipt helpers still introduce zero WCL requests; real execution is not
verified until a private local run and its receipts are independently reviewed.


## Private local one-time executor (post-approval)

See [PRIVATE_TWO_QUERY_PROBE_RUNBOOK.md](PRIVATE_TWO_QUERY_PROBE_RUNBOOK.md)
and 'tools/run-private-wcl-two-query-probe.mjs'. It requires a user-owned
local .env, one exact private rank-snapshot fixture, a new private output
directory, and an explicit CLI execution flag. It uses existing client
credentials, never triggers user OAuth, requires an observed app headroom
floor and only performs the two specified GraphQL queries if the first
rankings proof verifies. One OAuth client-credentials **token exchange**
is an additional non-GraphQL HTTP operation needed for authentication.

Its source and synthetic CI do not constitute a real WCL experiment.
The private user target and credentials are unavailable in ChatGPT/GitHub;
**live GraphQL calls actually executed so far: ZERO**. Actual user-point
benefits are not tested under client_credentials. No automatic retry, PR
merge, trigger action, or Sheet write is authorized.

## Fresh current-WCL observations and 2026 point-class receipts

**Development mode now prefers CURRENT public WCL Report/Fight evidence rather
than an old EXACT-100 ranking snapshot.** The archived snapshot-based local
path above remains available for historical auditing, but it is NOT a
prerequisite for the bounded 2-query *method comparison*. The new public mode
is implemented in 'src/core/fresh-two-query-probe.mjs' and staged in the
development-branch Actions workflow. Its first real rankings() response must
independently establish current report revision, exact FightID, encounter,
difficulty and at least one same-actor total/boss DPS witness. The second
table() query is conditional on this validation and is scoped to the same
report/fight, with a revision equality check. A current public report URL,
report code and FightID are the only target inputs; NO prior rank/SHA,
previously observed DPS or legacy GAS cache is required.

Official schema https://www.warcraftlogs.com/v2-api-docs/warcraft/ratelimitdata.doc.html
documents:
- 'currentRequest' as JSON with 'total', 'application', 'database' and 'user'
  breakdowns when exposed. The 'total' includes a minimum request cost.
  The 'database' value is a SUBSET of Application, not an independent charge;
  never sum these three fields to reconstruct 'total'.
- 'databaseLimitPerHour' and 'databasePointsSpentThisHour' as separate
  database-quota witnesses (not an extra charge to add).
- 'userHasRemainingPoints' as null when no authenticated user. Under the
  currently retained client_credentials flow, do NOT claim user billing
  eligibility or User-point savings.

The fresh query now requests these documented fields with the rate witness;
'currentRequest' remains a JSON scalar in the GraphQL document. The
offline-only 'observeFreshRateLimit()' reads category values DIRECTLY if
finite/nonnegative. Unknown, malformed or absent values stay null. It keeps
application and database remaining quotas separate, reports a request total
as actually returned, and does not infer zero charge from a missing category.
Five new synthetic regressions cover documented direct witnesses,
database-subset accounting, absent/malformed inputs, 2-response receipts
and query shape.

This improves the **observability** of actual WCL point cost; it is not a
measurement, a point saving, or proof that DamageDone totals can reproduce
EXACT-100 BossDPS. NO WCL API calls, Secrets access, Google Sheets edits or
main-branch deployment occurred as part of this offline update. The latest
verified push CI must be matched to the corresponding exact HEAD.

Existing development CI is automatic on isolated-branch push, with the
duplicate PR test job skipped. The separate one-time LIVE workflow remains
workflow_dispatch-only and the old main dispatcher is NOT updated here.
