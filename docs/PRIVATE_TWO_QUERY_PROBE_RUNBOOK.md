# Fresh216 — owner-controlled, ONE-TIME WCL rankings vs table probe

**Scope:** user separately approved at most two GraphQL calls for ONE public,
previously ranked Report/Fight. This is an execution runbook, NOT permission
for continuous collection, a third call, new OAuth grants, deployment,
Google Sheets writes, or PR merge. The public experiment branch and CI
NEVER connect to WCL.

## Why execution cannot be performed from GitHub/ChatGPT

A user-owned WCL OAuth credential pair and one source ranking snapshot
(report code, FightID, revision, the original rank slot) are required in a
**private machine**. Neither credentials nor a target for *this exact probe*
are present in the repository. Do not mine the Git history, invent a report
or use the WCL web page as a substitute for observed API point accounting.

This utility deliberately uses only existing **client_credentials** to access
the public v2 endpoint. It cannot read private reports and CANNOT test the
**User Point** behavior available to independently user-authorized
OAuth Code/PKCE flows. That would require separate approval.

## Prerequisites (Windows/PowerShell, example paths only)

- Node.js 20 or later.
- A local clone of 'degong2-code/wcl-fresh216' at branch
  'work/collector-architecture'. The working tree must include
  'src/core/private-two-query-probe.mjs' and
  'tools/run-private-wcl-two-query-probe.mjs'.
- Existing LOCAL '.env' with 'WCL_CLIENT_ID' and 'WCL_CLIENT_SECRET' only.
  Neither value should be pasted into chat or written to a command line.
  This flow exchanges those credentials once for an access token via
  'https://www.warcraftlogs.com/oauth/token' (a non-GraphQL auth HTTP
  request); it then sends at most two GraphQL POST requests to
  'https://www.warcraftlogs.com/api/v2/client'.
- Existing user-authorized private original ranking snapshot. A selected
  rank must have a verified original Report code, FightID, encounter,
  difficulty, revision, exact rank number, job identity, total DPS,
  class/spec/name and a real 64-hex snapshot digest.
- A LOCAL directory outside the public repository for input, .env and
  output. Output parent must already exist; output run directory must NOT
  exist. Don't store reports or output in public or private Git history.

Example **private fixture** (replace EVERY placeholder with evidence;
the below example is never a real target):

    {
      "scopeKey": "HEROIC:PRIVATE",
      "reportCode": "PLACEHOLDER_REPORT_NOT_REAL",
      "reportRevision": 5,
      "fightId": 12,
      "encounterId": 3470,
      "difficulty": 4,
      "slots": [{
        "jobKey": "BOSS|CLASS|SPEC",
        "rank": 12,
        "snapshotSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "totalDps": 1000,
        "className": "Hunter",
        "specName": "Marksmanship",
        "name": "ExampleCharacter"
      }]
    }

A fabricated digest is not a real snapshot. Do not run the paid experiment
on this example fixture.

Command example (adjust to your *private* paths; no secrets on command line):

    node tools/run-private-wcl-two-query-probe.mjs --fixture "C:\WCL-private\fixture.json" --env-file "C:\WCL-private\.env" --out "C:\WCL-private\probe-001" --i-confirm-authorized-two-wcl-queries

## Fail-closed behavior and limits

1. The local CLI rejects GitHub Actions, missing explicit execution flag,
   missing credentials/fixture, any pre-existing output directory, and
   fixture/output located within the public repository.
2. Before paid requests, it creates an exclusive marker next to the
   fixture ('fixture.json.wcl-two-query-attempted'), preventing accidental
   reruns with a new output directory. Never delete it and repeat without
   reviewing the previous request ledger and obtaining any needed new approval.
3. Before each POST, 'journal.json' is durably marked 'IN_FLIGHT'.
   Interrupted, timed-out or ambiguous POST is NEVER automatically retried.
   The journal and separate raw 'response-1.json' / 'response-2.json' remain
   private (mode 0600 on POSIX; the Windows account controls ACLs).
4. First call: rankings(dps+bossdps), report code + revision, exact ranked
   slot/actor/boss evidence and point witness must agree. Any failure
   prevents second call. This verifies consistency with the supplied slot,
   **not independent WCL rank snapshot authenticity**.
5. To attempt the second call, the first response must include a real
   numeric 'currentRequest.total' and legacy app headroom fields
   ('limitPerHour' and 'pointsSpentThisHour') indicating at least 100 points
   remain. This is a conservative admission floor, NOT a spending cap or
   a complete October 2026 App/DB/User quota witness.
6. Second call: table(DamageDone, Source), SAME Report/Fight/revision.
   No retries, no extra queries. The returned damage table is NOT
   assumed equivalent to ranking DPS or boss-only targeted DPS.
7. Detailed HTTP bodies, request source identity and user data stay under
   the private run directory. Console emits only status/call count/reason.
   'summary.json' and 'journal.json' include private scope fields; neither
   should be uploaded to public repositories or shared without sanitization.
8. A successful two-request receipt still returns
   'NOT_EQUIVALENT_OR_UNPROVEN' and 'tableAdopted:false'. Determining
   actor/pet/boss target/denominator parity requires private evidence
   review of the actual response format. Unknown app/database/user category
   costs remain NULL, never estimated from aggregate points.

**Explicit operational boundaries:** no Sheets, no Apps Script, no
OAuth Code/PKCE, no automatic retry, no new paid calls after the second, no
PR merge, no deployment. The checkpoint storage remains original JSON.
The experimental one-time ledger is deliberately separate from a
full-216 production collector.

## Verification

The repository's offline CI runs seven synthetic private-probe tests,
including real on-disk no-replay markers and fail-stop after the first
request. These tests perform ZERO WCL/OAuth network requests. See the
current HEAD's CI run; never infer actual point savings from synthetic data.
