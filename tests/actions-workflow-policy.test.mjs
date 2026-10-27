import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const file=path.join('.github','workflows','wcl-two-query-probe.yml');
const source=fs.readFileSync(file,'utf8');

test('the paid WCL workflow has precisely a manual dispatch trigger',()=>{
  const match=source.match(/^on:\s*\n([\s\S]*?)\n(?:concurrency|permissions|jobs):/m);
  assert.ok(match,'manual dispatch trigger missing');
  assert.match(match[1],/^\s{2}workflow_dispatch:\s*$/m);
  assert.doesNotMatch(match[1],/^\s{2}(push|pull_request|schedule|workflow_run|repository_dispatch):/m);
  assert.match(source,/github\.ref == 'refs\/heads\/main'/);
  assert.match(source,/github\.event_name == 'workflow_dispatch'/);
  assert.match(source,/github\.repository == 'degong2-code\/wcl-fresh216'/);
});
test('no automatically moving PR ref; only pinned code is allowed to access Secrets',()=>{
  const match=source.match(/ref:\s*([a-f0-9]{40})\s*$/m);
  assert.ok(match,'immutable checkout ref required');
  assert.equal(match[1],'d0170171026f939c2577fc2e91bb4fdee72149c9');
  assert.match(source,/persist-credentials:\s*false/);
  assert.match(source,/concurrency:\s*\n\s*group: wcl-fresh216-one-time-owner-approved-two-query/);
  assert.match(source,/cancel-in-progress:\s*false/);
});
test('dispatch uses repo Secrets without command-line or dispatch inputs',()=>{
  for(const field of ['WCL_CLIENT_ID','WCL_CLIENT_SECRET','WCL_PROBE_FIXTURE_JSON']){
    assert.ok(source.includes('secrets.'+field));
  }
  assert.ok(source.includes('node tools/run-actions-wcl-two-query-probe.mjs'));
  assert.doesNotMatch(source,/^\s+inputs:/m);
  assert.doesNotMatch(source,/upload-artifact|printenv|set -x|ACTIONS_STEP_DEBUG/);
  assert.match(source,/^\s+contents:\s*write/m);
  assert.doesNotMatch(source,/^\s+id-token:\s*write/m);
});
