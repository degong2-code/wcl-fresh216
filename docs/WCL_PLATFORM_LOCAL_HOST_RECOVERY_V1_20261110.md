# WCL Analysis Platform — Local SQLite host recovery and anchored backup V1

**2026-11-10 · Draft/offline only · stacked on PR #37.** No live WCL/Blizzard requests, Secrets, API points, repo merges, or deployment. This implements a useful **local host diagnostic**, not an already-provisioned production service.

## What changed

- `src/adapters/wcl-sqlite-ledger-recovery.mjs` performs read-only SQLite inspection with `DatabaseSync({readOnly:true})` and `PRAGMA query_only=ON`. Checks schema version, SQLite integrity, foreign keys, complete historical admission sequence, generation and issuer monotonicity, registry revision and digest continuity, reconstructed head digests, and scoped current heads. Missing/corrupt records fail closed. Unlike the older writer adapter, inspecting a missing file **does not initialize a new database**.
- `candidateWclLedgerAnchors(audit)` outputs a proposed per-scope generation/head-digest anchor. A candidate is NOT independently authenticated. An operator must keep an approved high-water anchor in a **separately secured storage and rollback domain**.
- `verifyWclLedgerAnchors` requires a trusted anchor for *every* recorded scope. It finds the exact historical head digest at the anchored generation and rejects missing scopes, older snapshots and altered histories. An obsolete anchor cannot detect all rollbacks; advance the independent anchor after each accepted admission.
- `backupAnchoredWclSqliteLedger` creates a fresh 0700 subdirectory and uses Node's official SQLite `backup` API, checking both source and target audits against the external anchors. It does not overwrite backups and does not provide a restore command.
- `verifyAnchoredWclSqliteBackup` requires BOTH independently recorded file SHA-256 and trusted high-water anchors. The returned receipt itself is not signed or independently trusted; keep its hash and latest anchor outside the original DB/backup domain.
- `tools/wcl-platform-ledger-host.mjs` accepts only `candidate`, `status`, `backup`, `verify-backup`. `tools/Invoke-WclLedgerHost.ps1` allows explicit PowerShell→WSL2 Ubuntu use without shell-interpolated commands. `.gitignore` excludes SQLite auxiliary files, locally stored anchors and backup directories.

**Runtime:** Node >=22.16 for `sqlite.backup`. Node v22.23.4 was actually used by GitHub CI. Official Node API: https://nodejs.org/download/release/v22.23.0/docs/api/sqlite.html

## Local commands — examples, not executed on the user's PC

These assume a *preexisting*, separately approved local SQLite ledger and a protected independent anchor store. Placeholder paths below are not asserted to exist. The commands do not provision an operational host or create a new ledger.

```sh
node --version

# Proposed anchor ONLY — must be separately reviewed and protected.
node tools/wcl-platform-ledger-host.mjs candidate \
  --db /trusted/state/wcl-platform/ledger.sqlite

# Read-only check using previously trusted high-water anchors.
node tools/wcl-platform-ledger-host.mjs status \
  --db /trusted/state/wcl-platform/ledger.sqlite \
  --anchor-file /separate-trust/ledger-anchors.json

# Explicit new backup; do not overwrite previous backups.
node tools/wcl-platform-ledger-host.mjs backup \
  --db /trusted/state/wcl-platform/ledger.sqlite \
  --anchor-file /separate-trust/ledger-anchors.json \
  --backup-root /trusted/backup-root

# Before any human-authorized recovery, check saved SHA AND anchors.
node tools/wcl-platform-ledger-host.mjs verify-backup \
  --db /trusted/backup-root/wcl-ledger-xxxxx/admissions.sqlite \
  --anchor-file /separate-trust/ledger-anchors.json \
  --sha256 REPLACE_WITH_TRUSTED_SHA256
```

PowerShell wrapper for an already installed WSL2 Ubuntu distribution:

```powershell
.\tools\Invoke-WclLedgerHost.ps1 -Mode Candidate `
  -RepoLinuxPath '/home/your-user/wcl-fresh216' `
  -DbLinuxPath '/trusted/state/wcl-platform/ledger.sqlite'

.\tools\Invoke-WclLedgerHost.ps1 -Mode Status `
  -RepoLinuxPath '/home/your-user/wcl-fresh216' `
  -DbLinuxPath '/trusted/state/wcl-platform/ledger.sqlite' `
  -AnchorLinuxPath '/separate-trust/ledger-anchors.json'
```

## Security and proof limitations

1. **A local audit is not upstream authenticity.** It cannot show that WCL/Blizzard issued any response. A signer ID in SQLite can be changed without altering the historical head hash, so any independent signer-authenticity claim additionally requires a separately signed/trusted governance receipt. The regression explicitly documents this limitation.
2. **Anchor provenance is external.** Reading a JSON anchor file proves nothing about who approved it. Restoring both the DB and its anchor file to old states defeats local rollback detection. Keep an independent, authenticated, append-only/latest high-water store outside the backup's failure domain.
3. **One physical database only.** Replay uniqueness is shared by all scopes in that file, not by independent SQLite copies, remote hosts or deleted/restored DB files. Avoid network filesystems, uncoordinated writers, CI runner ephemeral storage and an unreviewed migration.
4. **No automated restore.** Shut down and audit every writer before an independently approved restore, reconcile high-water anchors, and never silently replace current DB files. The CLI intentionally exposes no reset or restore operation.
5. **No live environment setup was performed.** The existing GitHub manual preflight from PR #37 is not deployed and no protected Environment status was verified. Operating paths, credentials, signing authority and actual WCL metadata attestations remain unproven.

## Verification

- `tests/wcl-sqlite-ledger-recovery.test.mjs`: real on-disk files, valid hot backups, file SHA tampering, older snapshot vs newer external high-water, historical reconstruction, missing/corrupt/duplicate records and unsafe paths.
- `tests/wcl-platform-ledger-host-cli.test.mjs`: actual CLI subprocess execution for candidate/status/backup/verify-backup, stale-snapshot rejection, symlink anchor rejection, no implicit init or restore, and static PowerShell boundary test.
- `.github/workflows/wcl-platform-host-recovery-offline.yml`: branch-only read-only GitHub Actions, synthetic local files and existing full offline core.

GitHub Actions **#42832659510** at code SHA `e8e720b1c30d81de0e090fa222eb9d4d09f96e78`: **114/114 targeted PASS; 87/87 offline pure-core suite files PASS; two Python synthetic checks PASS; 0 failures**. The bootstrap CI still does **not** execute 75 historical Apps Script source-dependent tests.

## Next practical gate

The next task is **host selection and installation**, not additional abstract evidence-policy layers. An operator must designate a real durable local WSL2/Linux location, separate independent anchor/backup storage, and a secure key-approval lifecycle. Then run **offline TEST_ONLY status/backup verification** on that host. Obtain separately bounded approval before any live WCL API calls or points consumption; no such call is enabled or authorized by this PR.
