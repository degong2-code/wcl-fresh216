import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {newCheckpoint,registerPlan,checkpointStats,pendingWaveEvidence}
  from '../src/core/checkpoint.mjs';
import {createPrivateWaveWitnessStore}
  from '../src/adapters/private-wave-witness-store.mjs';
import {verifyActorProofWaveManifest}
  from '../src/core/fresh216-actor-proof-archive.mjs';
import {runOneFresh216EngineTick}
  from '../src/adapters/fresh216-engine-tick.mjs';
import {SOURCE_SHA256}
  from '../tools/lib/fresh216-c-delta.mjs';

const SCOPE='heroic:2026-10-22_27:latest:source';
const KEY='SYNTHETIC_ONLY_REUSABLE_ENGINE_TICK_TEST_HMAC_KEY_2026';
const sha=v=>createHash('sha256').update(v).digest('hex');
const slots=[];
for(let i=0;i<216;i++){
  const jobKey='SyntheticJob'+i;
  const snapshotSha=sha(jobKey);
  for(let rank=1;rank<=100;rank++)slots.push({
    scopeKey:SCOPE,jobKey,rank,snapshotSha,status:'PENDING',
    name:i===0&&rank===1?'SyntheticActor':'SyntheticOther',
    className:'Hunter',specName:'Marksmanship',
    totalDps:i===0&&rank===1?1000:2000,
    startTime:1792594801000,reportCode:i===0&&rank===1?
      'SYNTHETIC-REPORT':'OTHER-'+i+'-'+rank,
    fightId:i===0&&rank===1?10:100000+i*100+rank,
    encounterId:3470,difficulty:4,reportRevision:5,
    filter:'date.2026-10-22.2026-10-27'
  });
}
const group=()=>{
  const s=slots[0];
  return {scopeKey:SCOPE,reportCode:s.reportCode,
    reportRevision:5,fightId:10,encounterId:3470,difficulty:4,
    slots:[{jobKey:s.jobKey,rank:s.rank,snapshotSha:s.snapshotSha,
      totalDps:s.totalDps,className:s.className,specName:s.specName,
      startTime:s.startTime,name:s.name,reportRevision:5}]};
};
function makeState(){
  const state=registerPlan(newCheckpoint(SCOPE,'synthetic-tick'),[group()]);
  state.sourceSha256=SOURCE_SHA256;
  return state;
}
function store(initial){
  let data=structuredClone(initial),updates=0;
  return {
    read:()=>structuredClone(data),
    update:fn=>{
      const next=fn(structuredClone(data));
      assert.equal(next.version,data.version+1);
      data=next;updates++;
      return structuredClone(data);
    },
    get updates(){return updates;}
  };
}
const policy={notBeforeMs:0,maxObservedPoints:100,reservePoints:10};
function response(){
  const actor={id:7,name:'SyntheticActor',class:'Hunter',
    spec:'Marksmanship',amount:1000};
  const fight=a=>({fightID:10,encounter:{id:3470},difficulty:4,
    roles:{dps:{characters:[a]}}});
  const body={data:{
    rateLimitData:{currentRequest:{total:3}},
    reportData:{report:{code:'SYNTHETIC-REPORT',revision:5,
      o0:{data:[fight(actor)]},
      b0:{data:[fight({...actor,amount:700})]}}}
  }};
  return {httpStatus:200,body,
    rawBodyBytes:Buffer.from(JSON.stringify(body),'utf8')};
}
function setup(){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'fresh216-tick-'));
  const witness=createPrivateWaveWitnessStore({
    privateDir:tmp,repoRoot:process.cwd(),sourceSha256:SOURCE_SHA256
  });
  return {witness,cleanup:()=>fs.rmSync(tmp,{recursive:true,force:true})};
}
async function collectPending(s,ws){
  let transportCalls=0;
  const result=await runOneFresh216EngineTick({
    mode:'report-one',slots,store:s,approved:true,
    admissionPolicy:policy,transport:async()=>{
      transportCalls++;return response();
    },
    onVerifiedWave:input=>ws.persist(input)
  });
  assert.equal(result.status,'RECORDED');
  assert.equal(result.kind,'REPORT_WAVE');
  assert.equal(transportCalls,1);
  assert.equal(checkpointStats(s.read()).evidencePending,1);
  const pending=pendingWaveEvidence(s.read())[0];
  const witness=ws.read(pending.evidence.witnessRef);
  assert.deepEqual(pending.wave,witness.wave);
  assert.equal(sha(JSON.stringify(pending.wave)),pending.evidence.waveSha256);
  return result;
}
test('preview is immutable, and report needs explicit authorization',async()=>{
  const s=store(makeState());
  const result=await runOneFresh216EngineTick({slots,store:s});
  assert.equal(result.status,'PREVIEW');
  assert.equal(result.nextKind,'REPORT_WAVE');
  assert.equal(s.updates,0);
  let calls=0;
  await assert.rejects(runOneFresh216EngineTick({
    mode:'report-one',slots,store:s,transport:async()=>calls++
  }),/ENGINE_TICK_REPORT_NOT_AUTHORIZED/);
  assert.equal(calls,0);
  assert.equal(s.updates,0);
});
test('one Report wave uses one transport, then no second paid transport',async()=>{
  const x=setup(),s=store(makeState());
  try{
    await collectPending(s,x.witness);
    let extraCalls=0;
    const repeated=await runOneFresh216EngineTick({
      mode:'report-one',slots,store:s,approved:true,
      transport:async()=>{extraCalls++;throw Error('not allowed');},
      admissionPolicy:policy,onVerifiedWave:x.witness.persist
    });
    assert.equal(repeated.status,'NO_REPORT_WAVE');
    assert.equal(repeated.nextKind,'ARCHIVE_PUBLISH');
    assert.equal(extraCalls,0);
  }finally{x.cleanup();}
});
test('stage one reuses authentic HMAC archive, leaves checkpoint PENDING; C/public calls zero',async()=>{
  const x=setup(),s=store(makeState());
  try{
    await collectPending(s,x.witness);
    const version=s.read().version;
    let stages=0,publicCalls=0,cCalls=0;
    const stage=await runOneFresh216EngineTick({
      mode:'stage-one',slots,store:s,approved:true,
      witnessReader:x.witness.read,hmacKey:KEY,
      stageRepoRoot:'/tmp/synthetic-private-stage',
      getReportStateCommit:async()=> 'a'.repeat(40),
      stagePersist:async input=>{
        stages++;
        assert.equal(input.privateReportStateCommit,'a'.repeat(40));
        const v=verifyActorProofWaveManifest(input.manifest,{
          archives:input.archives,hmacKey:KEY
        });
        assert.equal(v.archiveCount,1);
        return {status:'PRIVATE_SIGNED_STAGE_REMOTE_CONFIRMED',
          privateStageCommit:'b'.repeat(40),
          waveSha256:input.manifest.waveSha256};
      }
    });
    assert.equal(stage.status,
      'PRIVATE_STAGE_REMOTE_CONFIRMED_PENDING_PUBLIC');
    assert.equal(stage.checkpointCommitted,false);
    assert.equal(s.read().version,version);
    assert.equal(checkpointStats(s.read()).evidencePending,1);
    assert.deepEqual({stages,publicCalls,cCalls},{stages:1,publicCalls:0,cCalls:0});
    const again=await runOneFresh216EngineTick({
      mode:'stage-one',slots,store:s,approved:true,
      witnessReader:x.witness.read,hmacKey:KEY,
      stageRepoRoot:'/tmp/synthetic-private-stage',
      getReportStateCommit:async()=> 'a'.repeat(40),
      stagePersist:async args=>({status:'PRIVATE_SIGNED_STAGE_REMOTE_CONFIRMED',
        privateStageCommit:'b'.repeat(40),waveSha256:args.manifest.waveSha256,
        reused:true})
    });
    assert.equal(again.reused,true);
    assert.equal(s.read().version,version);
  }finally{x.cleanup();}
});
test('finalize requires remote-durable candidate C receipt before checkpoint COMMITTED',async()=>{
  const x=setup(),s=store(makeState());
  try{
    await collectPending(s,x.witness);
    const version=s.read().version;
    let archiveReads=0,calls=0;
    const archiveStore={persistWave:async(archives,{manifest})=>{
      archiveReads++;
      const v=verifyActorProofWaveManifest(manifest,{archives,hmacKey:KEY});
      return {waveSha256:manifest.waveSha256,
        manifestSha256:manifest.manifestSha256,
        manifestCommitSha:'b'.repeat(40),
        archiveCount:v.archiveCount,
        verifiedSlots:v.verifiedSlots,unresolvedSlots:v.unresolvedSlots};
    }};
    const unsafe=await runOneFresh216EngineTick({
      mode:'finalize-one',slots,store:s,approved:true,
      witnessReader:x.witness.read,hmacKey:KEY,
      publishedArchiveStore:archiveStore,cDeltaAppender:async()=>{
        calls++;
        return {status:'APPENDED',sourceSha256:SOURCE_SHA256,
          deltaIndex:0,deltaSha256:'e'.repeat(64),addedExactC:1};
      }
    });
    assert.equal(unsafe.status,'NEEDS_REVIEW');
    assert.equal(calls,1);
    assert.equal(archiveReads,1);
    assert.equal(checkpointStats(s.read()).evidenceCommitted,0);
    assert.equal(s.read().version,version+1);
    // An unknown remote C outcome is terminal: the same pending wave
    // must never be attempted again automatically.
    const stopped=await runOneFresh216EngineTick({
      mode:'finalize-one',slots,store:s,approved:true,
      witnessReader:async()=>{throw Error('unexpected');},
      hmacKey:KEY,publishedArchiveStore:archiveStore,
      cDeltaAppender:async()=>{throw Error('unexpected');}
    });
    assert.equal(stopped.status,'NO_PENDING_WAVE');
    assert.equal(stopped.nextKind,'NEEDS_REVIEW');
  }finally{x.cleanup();}
});
test('finalize fully commits only with already remote-confirmed C',async()=>{
  const x=setup(),s=store(makeState());
  try{
    await collectPending(s,x.witness);
    const receipt=await runOneFresh216EngineTick({
      mode:'finalize-one',slots,store:s,approved:true,
      witnessReader:x.witness.read,hmacKey:KEY,
      publishedArchiveStore:{persistWave:async(archives,{manifest})=>{
        const v=verifyActorProofWaveManifest(manifest,{
          archives,hmacKey:KEY
        });
        return {waveSha256:manifest.waveSha256,
          manifestSha256:manifest.manifestSha256,
          manifestCommitSha:'a'.repeat(40),
          archiveCount:v.archiveCount,
          verifiedSlots:v.verifiedSlots,unresolvedSlots:v.unresolvedSlots};
      }},
      cDeltaAppender:async()=>({
        status:'APPENDED',sourceSha256:SOURCE_SHA256,
        deltaIndex:0,deltaSha256:'d'.repeat(64),addedExactC:1,
        privateCandidateRemoteConfirmed:true,
        privateCandidateCommit:'c'.repeat(40)
      })
    });
    assert.equal(receipt.status,'ENGINE_WAVE_COMMITTED');
    assert.equal(checkpointStats(s.read()).evidencePending,0);
    assert.equal(checkpointStats(s.read()).evidenceCommitted,1);
  }finally{x.cleanup();}
});
