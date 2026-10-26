# Unpromoted candidates

Files in this directory are historical development candidates, **not a runnable Apps Script deployment**.

- `g425/WCL_G425_Identityless_Collector_Planner_GATED.gs` is an isolated, initially inactive planner module (source SHA-256 `f20c13d5fb73d8c1270a06284d7929d23b5da38e0e03435110f64b4a7e66d34e`).
- This copy came from the reviewed G4.25 release package, **not** a fresh export of all Google Apps Script editor files.
- Offline test evidence in the original package: G4.13 12/12, G4.15 22/22, G4.25 41/41. These tests have **not yet been imported or run in this GitHub CI**.
- `collector_hook_active=false`, no approved LIVE activation, no backfill, no existing 43-job promotion.
- Do not paste this directory into an existing Apps Script project indiscriminately; dependent source files and duplicate global declaration handling matter.

Move to runnable `apps-script/` only after installed-source parity, public security review, tests-in-CI and an explicitly reviewed integration PR.
