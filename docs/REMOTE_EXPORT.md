# Cloud-first actual Apps Script source export

No local Windows checkout is required, but a **read-only complete source export** from the installed TEST Apps Script is necessary before declaring GitHub as the authoritative source.

## Safe approach

1. Use a browser-based Google-authenticated environment such as GitHub Codespaces (or another trusted browser workstation).
2. Authenticate to the **Google account that owns the TEST Apps Script**, using the official Google Apps Script/CLASP workflow. Never paste OAuth refresh tokens, Script ID, or application credentials into GitHub code or chat.
3. Export (pull) the complete project to a private working location and review **all** files, including `appsscript.json`.
4. Compare the exported parent/G4.13/G4.15/G4.25 files to release-package SHA-256 references in `migration/source-manifest.json`.
5. **Before any public upload**, inspect for secrets, real Report IDs, player identities, private spreadsheet IDs and run-state/PROOF dumps. Do not publish the raw export if any such material remains.
6. Commit only the reviewed distributable source to a `work/*` branch. Keep a sanitized fingerprint/receipt in the private `ai-project-lab` repo.

## Explicitly prohibited during source export

- No `clasp push`, trigger edits, collector start, WCL API calls, writes to RAW/PROOF, or check-point rewrites.
- Do not interpret a successful download as proof that GitHub and Apps Script runtime source match until all files have been hashed and compared.
- Do not publish `.clasp.json`, `.clasprc.json`, secret tokens or complete private report/actor evidence.

This step is not yet complete; full installed source access has not been provided through the GitHub connection.
