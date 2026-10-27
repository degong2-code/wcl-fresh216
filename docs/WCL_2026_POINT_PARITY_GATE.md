# WCL v2 (October 2026) points/rankings-vs-table — bounded decision gate

Status: **OWNER APPROVED UP TO TWO GRAPHQL CALLS / STILL UNEXECUTED**, 2026-10-27.
This document is not itself execution authorization and no live credentials
or private target have been provided to this chat/repository. No Sheets or deployment approval.

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
