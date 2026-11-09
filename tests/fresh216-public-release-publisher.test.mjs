import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildTrustedPublicReleaseRequest,readTrustedReleaseIntentFile,
  runTrustedPublicSignedWaveRelease
} from '../tools/run-public-relay-release-publisher.mjs';

const intent={schema:1,kind:'FRESH216_PUBLIC_WAVE_RELEASE_INTENT_V1',
  privateStageCommit:'c'.repeat(40),
  waveSha256:'b'.repeat(64),
  expectedPublicEvidenceHead:'a'.repeat(40)};
const env={GITHUB_ACTIONS:'true',
  GITHUB_REPOSITORY:'degong2-code/wcl-fresh216',
  GITHUB_EVENT_NAME:'push',
  GITHUB_REF:'refs/heads/work/fresh216-autonomous-host-20261031',
  GITHUB_SHA:'d'.repeat(40),
  GITHUB_TOKEN:'SYNTHETIC_GITHUB_NATIVE_TOKEN_NOT_REAL',
  FRESH216_PRIVATE_READ_TOKEN:'SYNTHETIC_PRIVATE_GET_TOKEN_NOT_REAL'};
const goodReceipt={
  status:'PUBLIC_SIGNED_RELAY_COMMIT_READBACK_CONFIRMED',
  privateCommitSha:'c'.repeat(40),
  manifestSha256:'e'.repeat(64),
  publicCommitSha:'f'.repeat(40),
  reused:false,archiveCount:2,verifiedSlots:2,unresolvedSlots:0
};
test('missing on-disk release intent fails before any request',()=>{
  assert.throws(()=>readTrustedReleaseIntentFile(),
    /FRESH216_PUBLIC_RELEASE_NO_APPROVED_INTENT_BLOCKED/);
});
test('exact immutable owner release coordinates pass only trusted push',()=>{
  const req=buildTrustedPublicReleaseRequest({intent,env});
  assert.equal(req.approvedPublication.reviewedWorkflowCommit,env.GITHUB_SHA);
  assert.equal(req.approvedPublication.expectedPublicEvidenceHead,
    intent.expectedPublicEvidenceHead);
  assert.equal(req.publicationApproved,true);
  assert.equal(req.privateReadToken,env.FRESH216_PRIVATE_READ_TOKEN);
  assert.equal(req.publicGitToken,env.GITHUB_TOKEN);
  assert.equal(Object.keys(req).includes('hmacKey'),false);
});
test('untrusted, missing credential or modified coordinates never call relay',async()=>{
  let calls=0;
  const relay=async()=>{calls++;throw Error('network forbidden');};
  for(const options of [
    {intent:{...intent,waveSha256:'bad'},env},
    {intent,env:{...env,GITHUB_EVENT_NAME:'pull_request'}},
    {intent,env:{...env,GITHUB_REF:'refs/heads/feature'}},
    {intent,env:{...env,GITHUB_ACTIONS:'false'}},
    {intent,env:{...env,GITHUB_TOKEN:''}},
    {intent,env:{...env,FRESH216_PRIVATE_READ_TOKEN:''}}
  ])await assert.rejects(
    runTrustedPublicSignedWaveRelease({...options,relay}),
    /FRESH216_|SIGNED_RELAY_/
  );
  assert.equal(calls,0);
});
test('one exact stage-publication receipt returns only safe summary',async()=>{
  let called=0;
  const result=await runTrustedPublicSignedWaveRelease({
    intent,env,relay:async params=>{
      called++;
      assert.equal(params.approvedPublication.privateStageCommit,
        intent.privateStageCommit);
      assert.equal(params.publicationApproved,true);
      return goodReceipt;
    }
  });
  assert.equal(called,1);
  assert.equal(result.status,
    'FRESH216_TRUSTED_SIGNED_WAVE_PUBLIC_READBACK_CONFIRMED');
  assert.equal(result.wclCalls,0);
  assert.equal(result.cDeltaAppends,0);
  assert.equal(JSON.stringify(result).includes(env.GITHUB_TOKEN),false);
  assert.equal(JSON.stringify(result).includes(env.FRESH216_PRIVATE_READ_TOKEN),false);
});
test('wrong signed relay receipt stops after callback without success claim',async()=>{
  await assert.rejects(runTrustedPublicSignedWaveRelease({
    intent,env,relay:async()=>({...goodReceipt,privateCommitSha:'0'.repeat(40)})
  }),/FRESH216_PUBLISH_RECEIPT_DRIFT/);
});
test('workflow keeps secrets outside preflight and never enables WCL/C',()=>{
  const yaml=fs.readFileSync(
    '.github/workflows/fresh216-public-release-intent-readonly.yml','utf8');
  const [preflight,writer]=yaml.split('  publish-approved-public-wave:');
  assert.ok(writer,'conditional publisher missing');
  assert.match(preflight,/permissions:\s*\n\s*contents: read/);
  assert.doesNotMatch(preflight,/contents:\s*write|secrets\.|WCL_CLIENT_SECRET/);
  assert.match(writer,/needs\.review-approved-intent-readonly\.outputs\.intent_present == 'true'/);
  assert.match(writer,/environment: fresh216-private-read/);
  assert.match(writer,/permissions:\s*\n\s*contents: write/);
  assert.match(writer,/secrets\.FRESH216_PRIVATE_READ_TOKEN/);
  assert.match(writer,/github\.token/);
  assert.doesNotMatch(writer,/WCL_CLIENT_SECRET|FRESH216_EVIDENCE_HMAC_KEY|workflow_dispatch|pull_request_target/);
  assert.match(yaml,/cancel-in-progress: false/);
});
