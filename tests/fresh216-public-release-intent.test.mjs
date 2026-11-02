import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  inspectTrustedPublicReleaseIntent,runReadOnlyReleaseIntentCli
} from '../tools/run-public-relay-release-preflight.mjs';

const env={
  GITHUB_ACTIONS:'true',
  GITHUB_REPOSITORY:'degong2-code/wcl-fresh216',
  GITHUB_REF:'refs/heads/work/fresh216-autonomous-host-20261031',
  GITHUB_EVENT_NAME:'push',
  GITHUB_SHA:'d'.repeat(40)
};
const intent={
  schema:1,kind:'FRESH216_PUBLIC_WAVE_RELEASE_INTENT_V1',
  privateStageCommit:'c'.repeat(40),
  waveSha256:'b'.repeat(64),
  expectedPublicEvidenceHead:'a'.repeat(40)
};
test('trusted workflow derives approved runtime SHA and never authorizes actual publication',()=>{
  const record=inspectTrustedPublicReleaseIntent({
    intent,githubContext:env
  });
  assert.equal(record.status,'FRESH216_PUBLIC_RELEASE_INTENT_READ_ONLY_PREFLIGHT_PASS');
  assert.equal(record.trustedWorkflowCommit,env.GITHUB_SHA);
  assert.equal(record.realPublicPublicationAuthorized,false);
  assert.equal(record.publicGitWrites,0);
  assert.equal(record.wclCalls,0);
});
test('untrusted repo, PR/fork, wrong branch or incomplete intent stops',()=>{
  for(const [key,value] of Object.entries({
    GITHUB_REPOSITORY:'evil/repo',
    GITHUB_EVENT_NAME:'pull_request',
    GITHUB_REF:'refs/heads/feature',
    GITHUB_ACTIONS:'false',
    GITHUB_SHA:'bad'
  })){
    assert.throws(()=>inspectTrustedPublicReleaseIntent({
      intent,githubContext:{...env,[key]:value}
    }),/SIGNED_RELAY_UNTRUSTED_PUBLIC_WORKFLOW_CONTEXT|SIGNED_RELAY_EXACT_OWNER_APPROVAL_MISSING/);
  }
  for(const bad of [
    {...intent,waveSha256:'bad'},
    {...intent,privateStageCommit:'bad'},
    {...intent,expectedPublicEvidenceHead:'bad'},
    {...intent,extra:'arbitrary'}
  ]){
    assert.throws(()=>inspectTrustedPublicReleaseIntent({
      intent:bad,githubContext:env
    }),/FRESH216_PUBLIC_RELEASE_INTENT_SCHEMA_INVALID|SIGNED_RELAY_EXACT_OWNER_APPROVAL_MISSING/);
  }
});
test('without an approved real stage, preflight remains blocked with zero writes',()=>{
  const result=runReadOnlyReleaseIntentCli({env});
  assert.equal(result.status,'FRESH216_PUBLIC_RELEASE_NO_APPROVED_INTENT_BLOCKED');
  assert.equal(result.publicWrites,0);
  assert.equal(result.wclCalls,0);
});
test('release preflight has no secret/write scope; conditional writer is narrow',()=>{
  const yaml=fs.readFileSync('.github/workflows/fresh216-public-release-intent-readonly.yml','utf8');
  assert.match(yaml,/permissions:\s*\n\s*contents: read/);
  assert.match(yaml,/work\/fresh216-autonomous-host-20261031/);
  const preflight=yaml.split('  publish-approved-public-wave:')[0];
  const publisher=yaml.split('  publish-approved-public-wave:')[1];
  assert.ok(publisher,'separate publisher job missing');
  assert.doesNotMatch(preflight,/contents:\s*write|workflow_dispatch|secrets\.|FRESH216_PRIVATE_READ_TOKEN|FRESH216_EVIDENCE_HMAC_KEY/);
  assert.match(publisher,/needs\.review-approved-intent-readonly\.outputs\.intent_present == 'true'/);
  assert.match(publisher,/environment: fresh216-private-read/);
  assert.match(publisher,/permissions:\s*\n\s*contents: write/);
  assert.match(publisher,/secrets\.FRESH216_PRIVATE_READ_TOKEN/);
  assert.match(publisher,/github\.token/);
  assert.doesNotMatch(publisher,/WCL_CLIENT_SECRET|FRESH216_EVIDENCE_HMAC_KEY|workflow_dispatch|pull_request_target/);
  assert.match(yaml,/cancel-in-progress: false/);
});
