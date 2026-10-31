import test from 'node:test';
import assert from 'node:assert/strict';
import {preflightFresh216PublicPilot,executePublicPilotOnce}
 from '../tools/run-fresh216-public-pilot-once.mjs';
const request={
 id:'FRESH216_PUBLIC_1_WAVE_V3_20261031',
 approval:'OWNER_PROCEED_PUBLIC_RESULTS_V3_AFTER_ZERO_WCL_20261031',
 maxGraphql:1,maxFights:4,
 sourceSha256:'7231c678f305dfe2a278b6a0371897044d4d0a0058cf5f6219c993a4a3fae9d2'
};
const diff='A\texperiments/fresh216-one-wave-public-pilot-v3-20261031.json\n';
const env={
 GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'push',
 GITHUB_REPOSITORY:'degong2-code/wcl-fresh216',
 GITHUB_REF:'refs/heads/work/fresh216-autonomous-host-20261031',
 GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'41100000000',RUNNER_OS:'Linux',
 GITHUB_TOKEN:'SYNTHETIC_GITHUB_TOKEN_WITH_ENOUGH_LENGTH',
 WCL_CLIENT_ID:'SYNTHETIC_ID',WCL_CLIENT_SECRET:'SYNTHETIC_SECRET'
};
const slot={scopeKey:'heroic:2026-10-22_27:latest:source',
 jobKey:'synthetic',rank:1,snapshotSha:'a'.repeat(64),status:'PENDING',
 name:'Anonymous',className:'Hunter',specName:'Marksmanship',
 reportCode:'SYNTHETIC',fightId:3,encounterId:3470,difficulty:4,
 reportRevision:1,totalDps:1000,startTime:1792594801000};
const privateWave={schema:1,
 sourceSha256:request.sourceSha256,
 sourceCommit:'39573a118f2a57f9dc6758936e9d73e9aa6cebf5',
 deltaCommit:'d56befacce6ff8062878ed3a4edec6a55cd91b07',
 wave:{scopeKey:slot.scopeKey,reportCode:'SYNTHETIC',reportRevision:1,
 fightGroups:[{scopeKey:slot.scopeKey,reportCode:'SYNTHETIC',
  reportRevision:1,fightId:3,encounterId:3470,difficulty:4,slots:[slot]}]
 }};
test('explicit add-only owner request and exact pinned wave accepted',()=>{
 assert.equal(preflightFresh216PublicPilot({
  env,request,diff,privateWave
 }),privateWave.wave);
});
test('ordinary CI commit, other branch, missing credentials and changed approval all deny',()=>{
 for(const args of [
  {diff:'M\ttools/ci.mjs'},
  {env:{...env,GITHUB_REF:'refs/heads/main'}},
  {env:{...env,GITHUB_TOKEN:''}},
  {env:{...env,WCL_CLIENT_SECRET:''}},
  {request:{...request,maxGraphql:2}},
  {request:{...request,approval:'NOT_APPROVED'}},
  {privateWave:{...privateWave,sourceCommit:'0'.repeat(40)}},
  {privateWave:{...privateWave,wave:{...privateWave.wave,
    fightGroups:Array(5).fill(privateWave.wave.fightGroups[0])}}}
 ]){
  assert.throws(()=>preflightFresh216PublicPilot({
   env,request,diff,privateWave,...args
  }),/^(Error: )?PILOT_/);
 }
});
test('no request file addition means no OAuth, no WCL, no GitHub network',async()=>{
 let calls=0;
 await assert.rejects(executePublicPilotOnce({
  env,request,diff:'M\tsrc/core/resolve-proof.mjs',privateWave,
  fetchImpl:async()=>{calls++;throw Error('must not run');}
 }),/PILOT_ONE_TIME_ADD_ONLY_REQUEST_REQUIRED/);
 assert.equal(calls,0);
});
