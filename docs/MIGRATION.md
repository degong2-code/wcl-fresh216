# Migration checklist (no live side effects)

## Current facts
- Last provided user status (2026-10-26 09:21 KST): G4.13/G4.15 STOPPED, cursor 43/216.
- G4.25 preview PASS but `collector_hook_active=false`, `live_allowed=false`; not an operational enhancement yet.
- G4.23: one anonymous rank recovered in a bounded live probe; no proof promotion.
- G4.24: HTTP 504, cost unknown, no proof promotion; do not repeat the one-time probe.

## Before declaring source baseline
1. Export **all** currently installed TEST Apps Script source as read-only data, including the parent collector modules and manifest.
2. Compare all files with the prior handoff and G4.25 candidate. Label reference-only and gated modules. Do not concatenate multiple source packages or install duplicate global declarations.
3. Scan code and every file for credentials, personal IDs, report IDs, live logs, and private identifiers; sanitize/remove **before the first public commit**, not afterward.
4. Store a sanitized installed-source fingerprint and comparison result in a **private** receipt.
5. Add real offline tests and CI; no fixture-derived result may be described as a live WCL PASS.
6. Only then propose a reviewed PR to promote collector source to `main`.

## Deployment safety
- `clasp pull` for read-only export is preferred initially.
- Do NOT perform `clasp push`, enable triggers, restart G4.13/G4.15, or write RAW/PROOF based on this bootstrap.
- The repository commit, installed Apps Script source, and input snapshot must be independently matched before reporting runtime parity.
- Always separate measured API points from request count and missing point coverage.
