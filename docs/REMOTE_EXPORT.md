# Cloud-first actual Apps Script source export

No local Windows checkout is required, but a **read-only complete source export** from the installed TEST Apps Script is necessary before declaring GitHub as the authoritative source.

## Safe approach

1. Use a browser-based Google-authenticated environment such as GitHub Codespaces (or another trusted browser workstation).
2. Authenticate to the **Google account that owns the TEST Apps Script**, using the official Google Apps Script/CLASP workflow. Never paste OAuth refresh tokens, Script ID, or application credentials into GitHub code or chat.
3. Export (pull) the complete project to a private working location and review **all** files, including `appsscript.json`.
4. Compare the exported parent/G4.13/G4.15/G4.25 files to release-package SHA-256 references in `migration/source-manifest.json`.
5. **Before any public upload**, inspect for secrets, real Report IDs, player identities, private spreadsheet IDs and run-state/PROOF dumps. Do not publish the raw export if any such material remains.
6. Commit only the reviewed distributable source to a `work/*` branch. Keep a sanitized fingerprint/receipt in the private `ai-project-lab` repo.

## Optional browser-only export via a private Codespace

Use a Codespace opened from the **private** `ai-project-lab` repository, not a public PR or a public Actions runner. Use a new short-lived Codespace that you will delete after export.

```bash
npm install -g @google/clasp
mkdir -p /tmp/wcl-installed-export
clasp login --no-localhost
clasp clone-script "<YOUR_TEST_SCRIPT_ID>" --rootDir /tmp/wcl-installed-export
```

These are the current **clasp 3.x** command names. Provide the Script ID in your own authenticated terminal, **not in chat or a Git commit**. The Google Apps Script API may need to be enabled for the Google account. Only clone/pull; **never push** during initial migration.

Treat the downloaded files as sensitive until reviewed. Do not `git add` them. Transfer them for controlled inspection without exposing tokens, verify the full project, then remove the temporary export and delete the Codespace. `clasp login` writes credentials to its own settings file, so deleting the Codespace is a useful additional containment step.

## Explicitly prohibited during source export

- No `clasp push`, trigger edits, collector start, WCL API calls, writes to RAW/PROOF, or check-point rewrites.
- Do not interpret a successful download as proof that GitHub and Apps Script runtime source match until all files have been hashed and compared.
- Do not publish `.clasp.json`, `.clasprc.json`, secret tokens or complete private report/actor evidence.

This step is not yet complete; full installed source access has not been provided through the GitHub connection.
