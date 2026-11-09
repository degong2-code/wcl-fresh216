# Fresh216 — minimal-metadata Boss DamageDone study (2026-11-09)

## Purpose
Optimize future high-volume WCL collections, not A/B/C repair and not
rebuilding the collector, checkpoint or KPI engine. B500 remains the active
policy; BossDPS ranks beyond 500 are historical only.

## Existing independent measurements (reused; no new WCL traffic)
- **Eight Heroic fights / 24 actors:** full NPC-discovery metadata cost
  **16 App pt / 412,146 JSON bytes**; boss DamageDone table cost
  **9.55 pt / 1,219,711 bytes**; total DamageDone table cost
  **8 pt / 1,237,673 bytes**; separate quota check 1 pt, 34.55 pt overall.
  All 24 boss actor values have a subsequent official metric parity receipt.
- **88 additional fights / 200 actors:** metadata **174 App pt**,
  boss table **113.78 pt**, quota probe 1 pt. Historical metadata cost
  **1.9773 pt/fight** vs boss table **1.2930 pt/fight**. The original bulk
  result ended NEEDS_REVIEW on uncertain quota; 200 saved actor proofs
  were subsequently cross-verified against official BossDPS.
- **Direct official Report.rankings(bossdps):** 95 newly queried fights /
  285 App pt, or **3.00 pt/fight**. These 223 actor results all matched
  stored DamageDone witnesses; one earlier actor had separate evidence.
  WCL classifies rankings as Database Points and tables as User-Eligible Points.
- **Public table packing benchmark:** eight identical table fields in
  1/2/4/8-alias packs required 8/4/2/1 HTTP requests, each **8 App pt**
  (and 0 Database pt). Eight-field response about 831 KB. Response
  times were confounded by order/caching, not reliable speedup estimates.

## Candidate: only essential identity fields + boss-filtered DamageDone
- Use the existing 8-encounter boss NPC gameID candidate list (not yet
  universally phase-verified); filter by positive boss IDs only.
- Query Report.code, Report.revision, individual Fight ID/encounter/
  difficulty/kill/startTime/endTime, and one boss-filtered
  DamageDone(viewBy:Source) table per Fight.
- Group fields sharing Report.code, preserving an individual table per Fight.
  Do **not** query masterData, enemyNPCs, total DamageDone tables,
  a nonboss-exclusion list, playerDetails, gear or spells.
- Match unique Source-name hash to independently frozen actor, compare
  boss-total divided by full fight seconds to saved official BossDPS
  (tolerance 0.005 DPS). Fail closed on source duplicates, revision,
  fight identity, duration, missing points/response or actor mismatch.
- The pure module tools/lib/fresh216-lean-boss-table-query.mjs is **a
  query candidate and receipt comparator only**. It has no WCL transport,
  OAuth, state mutation, scheduling, persistent cache, C or Sheets writer.
- Preserve 3455 = 바쉬니크, 3497 = 길 잃은 탐험가; old job keys and SHA are frozen.

## Decision gate for a future bounded live comparison
1. Existing 8-fight/24-actor gold sample is the fixture; reuse the old
   metadata, total table and official BossDPS receipts as the baseline.
2. Separately authorize a **single** new eight-table GraphQL operation,
   proposed maximum **30 App pt** (not a measured cost), with hourly
   headroom check against safe target 3,240/3,600. Never reuse prior
   execution authorization without a new explicit bounded scope.
3. Capture the actual currentRequest total/application/database points,
   elapsed milliseconds, JSON bytes, report revision and 24 named actor
   exact parity, preserving hashes and aggregates but not raw actor names.
4. Abort with no automatic retry on uncertain charge or any mismatch.
   No C/Sheets changes or Boss500 writes during the experiment.
5. If the new request is exact and materially more efficient, integrate
   **only the fetch-query shape** into the existing engine. Otherwise
   retain the proven method and consider official BossDPS ranking for
   eligible actors with coverage precautions.

## Caveats
- 1.293 App pt per fight is the **isolated historical boss table cost**,
  not a guaranteed marginal cost of combined minimal identity+table query.
- This candidate leaves name translation on and does not assume a stable
  sourceID, because unique actor identity matters more than squeezing
  a few bytes. Source-name duplicate or absent is a hard failure.
- Existing source Report.revision values are null. A new query's revision
  is valid for that response, not retroactive proof for archived snapshots.
- Official Report.rankings can omit actors; 224/224 stored sample parity
  is not proof of all future actors or fights.
- The existing NPC registry is an 8-encounter Heroic candidate, not an
  all-fights/all-phases production guarantee. No padding subtraction.
