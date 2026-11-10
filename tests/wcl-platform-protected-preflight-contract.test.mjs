import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const doc=readFileSync(new URL('../.github/workflows/wcl-platform-protected-capture-preflight.yml',
  import.meta.url),'utf8');

test('manual preflight is never push/schedule/PR-triggered',()=>{
  assert.match(doc,/^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(doc,/^  (push|pull_request|schedule|workflow_run):/m);
  assert.match(doc,/github\.ref == 'refs\/heads\/main'/);
  assert.match(doc,/inputs\.mode == 'offline-sqlite-only'/);
});

test('manual preflight uses a named protected environment and refuses unconfigured gate',()=>{
  assert.match(doc,/environment:\n      name: wcl-platform-capture-preflight\n      deployment: false/);
  assert.match(doc,/vars\.WCL_CAPTURE_PREFLIGHT_READY/);
  assert.match(doc,/test "\$EXPECTED_GATE" = "OFFLINE_TEST_ONLY_APPROVED_V1"/);
  assert.match(doc,/cancel-in-progress: false/);
});

test('manual preflight never grants write permissions or accesses live API/Secrets',()=>{
  assert.match(doc,/^permissions:\n  contents: read/m);
  assert.doesNotMatch(doc,/\bcontents: write\b/);
  assert.doesNotMatch(doc,/secrets\.|wcl.*token|curl |wget |api\.warcraftlogs\.com|api\.blizzard\.com/i);
  assert.doesNotMatch(doc,/upload-artifact|cloudflare|workflow_call:|repository_dispatch:/i);
});

test('manual preflight uses synthetic local database tests and pinned checkout',()=>{
  assert.match(doc,/actions\/checkout@11bd71901bbe5b1630ceea73d27597364c9af683/);
  assert.match(doc,/persist-credentials: false/);
  assert.match(doc,/tests\/wcl-sqlite-capture-ledger\.test\.mjs/);
  assert.match(doc,/tests\/wcl-capture-trust-governance\.test\.mjs/);
});
