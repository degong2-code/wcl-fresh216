# Fresh216 — owner-controlled, ONE-TIME WCL rankings vs table probe

**Scope:** user separately approved at most two GraphQL calls for ONE public,
previously ranked Report/Fight. This is an execution runbook, NOT permission
for continuous collection, a third call, new OAuth grants, deployment,
Google Sheets writes, or PR merge. The public experiment branch and CI
NEVER connect to WCL.

## GitHub Actions manual-dispatch path and missing private evidence

Repository Actions Secrets **WCL_CLIENT_ID** and **WCL_CLIENT_SECRET**
are now configured by the owner; their actual values have not been accessed
or verified by this chat. They are injected only into the dedicated
workflow_dispatch job, never PR/offline CI. An authentic original ranking
snapshot is still required; it is deliberately NOT public and is NOT yet
available as the additional **WCL_PROBE_FIXTURE_JSON** repository secret.
Never mine Git history, guess Fight/report identities or invent a snapshot.

The ONE-TIME Actions dispatcher exists in the default **main** branch:
'.github/workflows/wcl-two-query-probe.yml'. It checks out an immutable
CI-verified code commit rather than a movable PR head. The workflow only
runs on an explicit **workflow_dispatch** for main, with one global job
concurrency group and one persistent atomic consumed Git ref. It cannot
start on push, a timer or a pull-request event.

The owner may request the assistant to start the workflow after the missing
private source is selected. The available GitHub connector in this chat can
write workflow files and inspect runs, but does not expose a
workflow_dispatch create-run operation. Do not claim a GraphQL call occurred
just because the workflow now exists. Running it may require Work-mode
browser automation or a different authorized execution path.

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

The repository's offline CI runs seven synthetic core-probe tests and
three CLI tests, including on-disk no-replay barriers, explicit consent
flags and fail-stop after the first request. These tests perform ZERO WCL/OAuth network requests. See the
current HEAD's CI run; never infer actual point savings from synthetic data.


## Actions Secrets, evidence storage and one-time anti-replay

The workflow reads (only at job execution) three repository Secrets:
- 'WCL_CLIENT_ID' — already reportedly registered by the user;
- 'WCL_CLIENT_SECRET' — already reportedly registered by the user;
- 'WCL_PROBE_FIXTURE_JSON' — **NOT confirmed; required**, contains one
  authentic private original ranking slot and Report/Fight/revision.
Do not put fixture JSON (especially report codes and actor names) into
workflow_dispatch inputs, public issues, public pull requests or logs.
Secrets are not themselves proof the snapshot is authentic; perform original
source comparison before setting fixture.

The Actions runner creates the Git ref
'refs/heads/wcl-fresh216-one-time-probe-consumed-20261027' **atomically** before
any OAuth or WCL GraphQL request. A 422 "already exists" stops before spending
points, including an attempted rerun in another ephemeral GitHub runner.
This ref is permanent evidence that one attempt was *reserved*; its existence
does NOT prove any request occurred. DO NOT delete the ref to bypass the
owner's one-time permission. Its creation requires the workflow's narrow
'contents: write' job permission. GitHub Actions concurrency serializes
races but the atomic ref is the durable cross-run no-replay guard.

The Actions runner does NOT export or upload private raw responses to
GitHub Artifacts or logs. It prints only a redacted summary (method,
HTTP status, available aggregate point witness, duration, conservative
semantic verdict). Raw data is removed from the ephemeral runner at exit.
**This means it cannot establish detailed actor/target/pet parity or retain
private forensic data across runner destruction.** It is a small,
bounded first cost/response-shape observation, not full API semantic proof.
A separate protected evidence-retention design would require another
deliberate design decision before performing an expensive experiment if
raw-response review is indispensable.

The original Windows local-only CLI remains separately available and
continues refusing GitHub Actions; it must not be confused with
'tools/run-actions-wcl-two-query-probe.mjs'. Neither executor implements a
real full-216 collector, Sheets writes, retry loops or User OAuth.
