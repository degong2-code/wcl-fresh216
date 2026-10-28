# Fresh216 — common approved WCL runner: reuse proven GitHub Actions

**2026-10-28. Status: reviewed design, NOT operational/activated.** No WCL request or OAuth exchange, no read of GitHub Secrets, no Sheets/GAS write and no merge/main change was made for this document.

## Verified execution facts

- [Run 40523902098](https://github.com/degong2-code/wcl-fresh216/actions/runs/40523902098): `work/collector-architecture` PUSH. `offline` SUCCESS; dedicated `approved-one-time-wcl-typed-roster` SUCCESS. One real WCL GraphQL POST returned HTTP 200, elapsed 2,527 ms, `currentRequest.total=6.74` (separate categories `application=4`, `database=15`, `user=2.74`; categories **not additive**).
- [Run 40513601801](https://github.com/degong2-code/wcl-fresh216/actions/runs/40513601801): `offline` SUCCESS, one GraphQL HTTP 200, but paid experiment job FAILURE because semantic identity validation returned NEEDS_REVIEW, **not because OAuth failed**.
- [Run 40486449886](https://github.com/degong2-code/wcl-fresh216/actions/runs/40486449886): older default-branch manual 2-query experiment reached two HTTP 200s, then NEEDS_REVIEW. Its immutable one-time runner/marker is consumed.
- Existing `.github/workflows/ci.yml` contains three distinct approved one-shot jobs. Each reads GitHub Actions Secrets named `WCL_CLIENT_ID` and `WCL_CLIENT_SECRET` **inside the runner only**. The old jobs trigger solely after offline success and an exclusive, exact **add-only** approved request file. Their executors create unique consumed Git refs **before** OAuth, blocking replay.
- Preserve old refs for `wcl-fresh216-one-time-probe-consumed-20261027`, `wcl-fresh216-identity-one-query-consumed-20261027`, `wcl-fresh216-typed-roster-one-query-consumed-20261027`. Never recycle or delete them. Current values of Secrets cannot be inspected or guaranteed from historic success.
- An attempted *new* credential-bearing GitHub Actions workflow for the fresh Nek'zali trial was rejected by tool safety screening, with no commit and no WCL calls. **Exact screening cause is not known**; no attempt to bypass a refusal.

## One minimal common path to implement next

**Reuse the existing development-branch CI file**, rather than adding a fourth independent workflow or modifying `main`:

1. Add one reusable Node runner for **fixed, reviewed WCL query types**, not arbitrary shell, URL or GraphQL input. Factor common OAuth, official GraphQL POST, strict HTTP/schema/point observation and sanitized result handling from previous `run-actions-wcl-*.mjs` executors. Existing historical executors may remain immutable.
2. Add exactly one *future* conditional `approved-measurement` job in the existing `ci.yml`, dependent on `offline` SUCCESS, on the isolated `work/collector-architecture` push branch only. Keep WCL Secrets scoped to that job, not the offline job or PR jobs. Use minimum job permissions.
3. **Code commit first:** runner, bounded configuration validation, synthetic test, CI PASS; ordinary source commits must have **zero paid jobs**.
4. **Separate activation commit:** only after review and explicit owner approval, add a single unique `experiments/approved-<id>.json` file with an **exact one-file-added commit diff**. Validate repo, branch, request ID and allowlisted experiment definition before any authentication. The request file is a selector, **not by itself user approval**.
5. Create a fresh immutable `refs/heads/wcl-fresh216-approved-<id>-consumed` reservation using GitHub's atomic 201-create / 422-already-present behavior **before OAuth**. Fail closed on uncertain reservation, auth or GraphQL outcome; never auto-rerun/erase markers.
6. Output **aggregate-only** per-spec page lengths, same report/fight/unique name/startTime matches, incremental 1→2→3 match counts, observed WCL `currentRequest` point categories, HTTP timings and errors. Never log/upload raw actor names, report/fight IDs, ranking rows, access tokens, credentials or private Sheets data.

This is **one shared credential/client path**; individual experiments change a small, reviewed manifest only. It avoids three copied OAuth implementations, a new workflow for each experiment and unnecessary secondary collectors. If secure workflow modification is again refused by tooling, stop and report the limitation rather than trying an ungated workaround.

## Owner-approved next short measurement — current heroic Nek'zali

Current user approval (2026-10-28): fresh, not archived, **Nek'zali encounter 3470**, difficulty 4, Balance Druid / Enhancement Shaman / Survival Hunter. For each specialization collect TotalDPS first page (`metric:dps`) and BossDPS pages 1, 2, 3 (`metric:bossdps`) with **one batched GraphQL document per specialization where supported** (up to three primary POSTs). Same query-time partition/filter and encounter/spec/difficulty across all aliases. The exact **current default partition** and true page size need confirmation from authenticated response; absent date filter means current *global* leaderboard, not today's fights.

Keep TotalDPS top100 intact. Count only **identical report+fight+unique non-anonymous name+matching startTime**, and reject conflicting known metadata, duplicates, bossDPS > totalDPS, and alternative parses from the same character. Never replace missing with rank101/zero/estimates. Historical private 44-snapshot results are a different cohort.

The official GraphQL field `rateLimitData.currentRequest` is a **JSON scalar**, so use `rateLimitData{currentRequest}`, then read `body.data.rateLimitData.currentRequest.total`. Do **not** query `currentRequest{total}`: that was an invalid selection in the failed, **uncommitted and unexecuted** prototype. Cost and 100-rows-per-page are unknown until measured. Distinguish single HTTP requests from WCL metering; impose explicit operational bounds even though in-chat approval did not set a count ceiling.

**No fresh Nek'zali live run has taken place.** This document alone must never enable the paid job, spend API points, publish private raw results, write to Sheets, alter GAS, merge a PR or deploy. A long-running 216-job collector belongs on a private durable single-owner host, not disposable GitHub Actions; see [RUNTIME_HOST_DECISION.md](RUNTIME_HOST_DECISION.md).
