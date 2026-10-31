# Fresh216 private Git-backed Report-state commit provider

## Purpose

The C-delta v1 adapter requires a real 40-character Git commit for
reportStateCommit. The value must identify a private Git snapshot that
contains the completed Report-wave checkpoint and its pending evidence
metadata. It must never be synthesized from a witness digest, response hash,
receipt field, or abbreviated commit.

src/adapters/private-report-state-commit.mjs exports
createGitBackedReportStateCommitProvider. The provider is read-only. It
returns the commit that last changed the dedicated adaptive Report-wave
checkpoint file, after confirming that the commit is reachable from the
current remote branch and that the current branch head is remotely confirmed.

## Fixed private store identity

- Repository: degong2-code/ai-project-lab
- Branch: work/fresh216-private-adaptive-state
- State file: projects/wcl-fresh216/private-adaptive/report-wave-checkpoint.json
- Scope: heroic:2026-10-22_27:latest:source

This is a separate adaptive checkpoint mirror. Do not reuse the A source
checkpoint branch/path or the historical Report20/Report21-100/Report1000/
Remaining report-state commit pins.

## Required call order

1. The existing checkpoint.mjs state machine completes the Report wave and
   records evidence.status=PENDING, including the exact response-body SHA,
   request SHA, private witness reference and witness SHA.
2. The existing Git-backed checkpoint wrapper commits that state file to the
   dedicated private branch and confirms remote HEAD. No WCL request may begin
   unless its pre-request IN_FLIGHT state was already remotely confirmed.
3. The evidence publisher verifies the private witness, canonical joins and
   public archive/manifest readback.
4. createFresh216ArchiveCDeltaAppender calls the provider through its
   existing getReportStateCommit callback. The provider checks:
   - clean checkout, exact branch and private repository identity;
   - local HEAD equals the remote branch HEAD;
   - a real state-file blob exists in the Git tree;
   - the commit that last changed that file is an ancestor of the confirmed
     remote HEAD;
   - every wave fight has the same REPORT_WAVE attempt, pending evidence
     digests, slot membership, observed points and exact proof result as the
     private witness.
5. Only then is the actual state-file commit SHA written into the existing
   C-delta v1 evidence. The checkpoint is marked COMMITTED only after the
   archive and C-delta receipts are confirmed.

## Wiring

The private host supplies the checkout root for the dedicated report-state
branch:

\`\`\`js
import {createGitBackedReportStateCommitProvider}
  from './src/adapters/private-report-state-commit.mjs';
import {createFresh216ArchiveCDeltaAppender}
  from './tools/lib/fresh216-archive-c-delta.mjs';

const getReportStateCommit=createGitBackedReportStateCommitProvider({
  repoRoot:privateReportStateCheckout
});
const cDeltaAppender=createFresh216ArchiveCDeltaAppender({
  sourceSlots,baseCompressedBytes,deltaDirectory,priorityByKey,
  getReportStateCommit
});
\`\`\`

The provider performs no Git writes. The private host/store remains responsible
for durably committing each existing checkpoint transition before returning
from store.update. It fails closed if the branch has not been provisioned,
the remote cannot be read, the checkout is dirty/stale, or any evidence differs.

## Explicit non-scope

This implementation does not create the private branch, write the checkpoint,
provision a persistent Linux volume, load A source, inspect or change Secrets,
call WCL/OAuth, publish public archives, append C, promote canonical C, or write
Sheets/GAS. The actual private host and store wiring remain a separate gate.
