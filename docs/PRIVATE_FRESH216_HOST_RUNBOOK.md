# Fresh216 private persistent source host — OFFLINE TESTED

**Scope:** Heroic, all 8 validated encounters × 27 DPS specs, 2026-10-22..27
KST inclusive. GraphQL filter \`date.1792594800000.1793113200000\`;
latest/default partition (omit partition entirely). This is the scope
the user approved and that passed an 8-specialization/1-HTTP WCL probe:
[40652619477](https://github.com/degong2-code/wcl-fresh216/actions/runs/40652619477):
8×100 returned, observed \`currentRequest.total=8.01\`, 954 ms.

## What is implemented

The smallest host reuses **the existing checkpoint and source collector**:

- \`src/core/fresh-cohort-source.mjs\`: deterministic 32-request plan,
  official TotalDPS top100 page 1, 100-row/alias validation, stored
  provenance, point budget and 216×100 final completeness gate.
- \`src/adapters/json-checkpoint-store.mjs\`: existing 0600 JSON
  checkpoint, private directory and per-transition file lock,
  atomic fsync + rename before and after each paid WCL call.
- \`src/adapters/private-fresh-cohort-host.mjs\`: **private Linux
  directory enforcement**, immutable source-commit identity, process
  owner lease, secret-injected WCL OAuth + authenticated GraphQL
  transport, one-operation receipts with no actor names, and private
  final source export.
- \`tools/run-private-fresh216.mjs\`: one-command operator interface
  (init / status / collect / export); default is **status-only**.
- \`tests/private-fresh-cohort-host.test.mjs\`: mocked OAuth/GraphQL,
  private persistence, restart, budget gate, owner lock, no public
  raw-data output, no retry after ambiguous 504, and rejection of a
  normal ephemeral GitHub Actions host.

**IMPORTANT:** CI synthetic/mock PASS is NOT evidence that a private
persistent production host has been provisioned or that the
216-job WCL source was actually collected. The current live durable
Oct22–27 source remains **0/216**, even though the earlier live
1-request 8-alias shape probe succeeded. Actual raw source rows were
not saved during that public Actions probe.

## Required environment before any new live API calls

1. A user-controlled **persistent, private Linux filesystem volume**
   is provisioned. A normal GitHub Actions ephemeral runner/workspace
   is refused. Its filesystem's actual survival across VM replacement,
   backup policy, encryption at rest and access controls must be
   checked by the host operator — code cannot infer these from a
   private-looking path.
2. Check out the precise, clean, approved Git commit. The host pins
   its full \`git rev-parse HEAD\` in the checkpoint; source drift on
   resumed commands is blocked instead of quietly changing code.
3. Set \`FRESH216_PRIVATE_DIR\` to an ABSOLUTE directory **outside**
   the repository and outside any other Git worktree. On Linux, the
   directory must be mode 0700 and stored checkpoints mode 0600.
   Symlink roots/files are refused.
4. Supply \`WCL_CLIENT_ID\` and \`WCL_CLIENT_SECRET\` from a
   secret manager or protected environment. **Never** store them
   in CLI arguments, a tracked file, Git logs or public artifacts.
   The code never prints the token or credentials.
5. Ensure only ONE host owns the directory. A process-wide
   \`.collector-owner-lock\` and the checkpoint's request-level
   IN_FLIGHT state prevent concurrent paid work. A process killed
   mid-operation can leave locks and an uncertain charge, requiring
   manual review before any restart.

## Operator commands

From the approved clean checkout, on the private Linux host:

\`\`\`bash
# Example only. Choose an independently verified persistent private mount.
export FRESH216_PRIVATE_DIR=/secure-volume/wcl-fresh216
# Inject WCL_CLIENT_ID and WCL_CLIENT_SECRET via your secret manager.

node tools/run-private-fresh216.mjs init
node tools/run-private-fresh216.mjs status

# Exactly one WCL GraphQL source request; budget is a measured-points
# admission guard, not a fixed WCL tariff or unconditional spending cap.
node tools/run-private-fresh216.mjs collect \
  --max-requests 1 --max-points 20 --reserve-points 10

# Later, with a reviewed cumulative budget and stable private volume:
node tools/run-private-fresh216.mjs collect \
  --max-requests 32 --max-points 300 --reserve-points 10

# Only after 216/216 verified source jobs:
node tools/run-private-fresh216.mjs export
\`\`\`

The \`--max-points\` value is a **cumulative observed-point budget**
with a reserve for the next operation. WCL may charge more than the
reserve, so it cannot mathematically guarantee zero overshoot.
The 8.01-point live pilot is one measured request, not a universal
point price for other encounters or the final three-alias batch.

**Never run \`collect\` through a normal public GitHub Actions job**;
the CLI explicitly refuses \`GITHUB_ACTIONS=true\`. Copying its private
checkpoint or exported player rows to the public repo, CI artifacts,
logs, or chat is forbidden.

## Receipt and restart behavior

Printed output includes only full source-code commit SHA, synthetic
scope ID, number of completed jobs/requests, observed points,
elapsed milliseconds, incidents, and next batch index. Nothing
reveals actor names, report codes, fight IDs, credentials or private
absolute filesystem paths.

The underlying private \`fresh216-checkpoint.json\` **does** contain
actual WCL actor source rows: one COMPLETE response saves its
100 rows per spec. Re-running the command reads that checkpoint and
resumes at the next READY batch, not the first one. If an HTTP call,
parse, validation or persistence is ambiguous, no automatic
replay occurs. A process crash during IN_FLIGHT results in a review
block; stale owner locks are never silently removed.

At 216/216 completion, \`export\` writes
\`fresh216-total100-verified.json\` privately using exclusive creation,
fsync, and a SHA-256 receipt. This private output is then suitable as
input to the existing BossDPS ranking/Report collector. It MUST NOT
be committed to the public repository.

## Still NOT implemented or NOT tested

- Private host/volume actually provisioned: **NOT IMPLEMENTED**.
- WCL credentials available to that host: **UNKNOWN**.
- Full source collection actually run on that host: **NOT TESTED**.
- Live restarts across hardware/VM replacement: **NOT TESTED**.
- Remote execution from mobile or automatic private-cloud deployment:
  **NOT IMPLEMENTED**.
- Real 216-job elapsed time and measured 32-batch point total:
  **NOT TESTED**.
- Private raw-source durability/backup independent audit:
  **NOT TESTED**.
- Sheets/GAS production cutover: **NOT IMPLEMENTED**.

The historical 44/216 G4.13 Oct8–12 partition-1 snapshots remain
separate and are not substituted into this date cohort.
