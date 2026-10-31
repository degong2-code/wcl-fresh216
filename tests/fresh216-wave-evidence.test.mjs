import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {planFightFetches} from '../src/core/fetch-plan.mjs';
import {planReportWaves} from '../src/core/report-wave-plan.mjs';
import {
  newCheckpoint,registerPlan,checkpointStats,pendingWaveEvidence,
  markWaveEvidenceCommitted,markWaveEvidenceNeedsReview
} from '../src/core/checkpoint.mjs';
import {executeOneReportWave} from '../src/core/report-wave-runner.mjs';
import {createPrivateWaveWitnessStore}
  from '../src/adapters/private-wave-witness-store.mjs';

const sha=v=>createHash('sha256').update(v).digest('hex');
const SOURCE='e'.repeat(64);
const SNAPSHOT='a'.repeat(64);
const slot=(i)=>({
  scopeKey:'heroic:test',jobKey:'BossA|Hunter|Marksmanship',
  rank:i+1,snapshotSha:SNAPSHOT,status:'PENDING',
  name:i===0?'Player (1)':'Actor'+i,className:'Hunter',
  specName:'Marksmanship',totalDps:1000-i,
  startTime:1792600000000+i,
  reportCode:'SYNTHETIC_REPORT',fightId:10+i,
  encounterId:3470,difficulty:4,reportRevision:5
});
function setup(){
  const slots=[slot(0),slot(1)];
  const groups=planFightFetches(slots).groups;
  const wave=planReportWaves({groups},{maxFightsPerWave:4}).waves[0];
  const state=registerPlan(newCheckpoint('heroic:test','wave-evidence-test'),groups);
  return {slots,groups,wave,state};
}
function bodyFor(wave){
  const report={code:'SYNTHETIC_REPORT',revision:5};
  for(let i=0;i<wave.fightGroups.length;i++){
    const g=wave.fightGroups[i],s=g.slots[0];
    const overall={id:7+i,name:i===0?'Player (1)':'Actor'+i,
      class:'Hunter',spec:'Marksmanship',amount:s.totalDps};
    const boss={...overall,amount:s.totalDps-200};
    const fight=actor=>({data:[{fightID:g.fightId,
      encounter:{id:3470},difficulty:4,
      roles:{dps:{characters:[actor]}}}]});
    report['o'+i]=fight(overall);
    report['b'+i]=fight(boss);
  }
  return {data:{rateLimitData:{currentRequest:{total:21}},
    reportData:{report}}};
}
function memoryStore(state){
  let current=structuredClone(state);
  return {read:()=>structuredClone(current),update:fn=>{
    current=fn(structuredClone(current));return structuredClone(current);
  }};
}
function privateDirs(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fresh216-witness-'));
  const repo=path.join(root,'public-repo'),privateDir=path.join(root,'private-data');
  fs.mkdirSync(repo,{mode:0o700});fs.mkdirSync(privateDir,{mode:0o700});
  return {root,repo,privateDir};
}
async function collectWithWitness({withoutBytes=false}={}){
  const {wave,state}=setup(),store=memoryStore(state),dirs=privateDirs();
  const witnessStore=createPrivateWaveWitnessStore({
    privateDir:dirs.privateDir,repoRoot:dirs.repo,sourceSha256:SOURCE
  });
  const raw=Buffer.from(JSON.stringify(bodyFor(wave)),'utf8');
  let callbackSawInflight=false;
  const out=await executeOneReportWave({
    store,wave,attemptId:'WITNESS-ATTEMPT-1',clock:(()=>{let n=100;return()=>n+=10;})(),
    transport:async()=>({httpStatus:200,body:bodyFor(wave),
      ...(withoutBytes?{}:{rawBodyBytes:raw})}),
    onVerifiedWave:async input=>{
      callbackSawInflight=Object.values(store.read().entries)
        .every(e=>e.status==='IN_FLIGHT');
      return witnessStore.persist(input);
    }
  });
  return {out,store,witnessStore,dirs,wave,callbackSawInflight,raw};
}
test('exact Fetch bytes are durably witnessed before wave checkpoint completion',async()=>{
  const x=await collectWithWitness();
  try{
    assert.equal(x.out.status,'RECORDED');
    assert.equal(x.out.responseBodySha256,sha(x.raw));
    assert.equal(x.callbackSawInflight,true);
    const state=x.store.read();
    assert.equal(checkpointStats(state).evidencePending,2);
    assert.equal(checkpointStats(state).evidenceCommitted,0);
    const pending=pendingWaveEvidence(state);
    assert.equal(pending.length,1);
    assert.equal(pending[0].wave.fightGroups.length,2);
    const witness=x.witnessStore.read(x.out.witnessRef);
    assert.equal(witness.sourceSha256,SOURCE);
    assert.equal(witness.responseBodySha256,sha(x.raw));
    assert.deepEqual(witness.responseBodyBytes,x.raw);
    assert.equal(witness.joinedByFight.length,2);
    assert.equal(fs.statSync(path.join(x.dirs.privateDir,x.out.witnessRef)).mode&0o077,0);
  }finally{fs.rmSync(x.dirs.root,{recursive:true,force:true});}
});
test('private witness survives store reconstruction and rejects path escape',async()=>{
  const x=await collectWithWitness();
  try{
    const reopened=createPrivateWaveWitnessStore({
      privateDir:x.dirs.privateDir,repoRoot:x.dirs.repo,sourceSha256:SOURCE
    });
    const witness=reopened.read(x.out.witnessRef);
    const evidence=pendingWaveEvidence(x.store.read())[0].evidence;
    assert.equal(witness.witnessSha256,evidence.witnessSha256);
    assert.equal(witness.waveSha256,evidence.waveSha256);
    assert.throws(()=>reopened.read('../outside.json.br'),
      /PRIVATE_WAVE_WITNESS_REF_INVALID/);
  }finally{fs.rmSync(x.dirs.root,{recursive:true,force:true});}
});
test('missing exact response bytes leaves the billed wave NEEDS_REVIEW without retry',async()=>{
  const x=await collectWithWitness({withoutBytes:true});
  try{
    assert.equal(x.out.status,'NEEDS_REVIEW');
    assert.equal(x.out.incident,'RAW_RESPONSE_BYTES_UNAVAILABLE');
    assert.equal(checkpointStats(x.store.read()).counts.NEEDS_REVIEW,2);
    assert.equal(checkpointStats(x.store.read()).pointsUnobserved,1);
    assert.equal(checkpointStats(x.store.read()).evidencePending,0);
  }finally{fs.rmSync(x.dirs.root,{recursive:true,force:true});}
});
test('archive and C-delta commit is a separate resumable checkpoint stage',async()=>{
  const x=await collectWithWitness();
  try{
    const pending=pendingWaveEvidence(x.store.read())[0];
    const blocked=markWaveEvidenceNeedsReview(x.store.read(),pending.wave,
      pending.attemptId,'SYNTHETIC_ARCHIVE_WRITE_UNKNOWN');
    assert.equal(checkpointStats(blocked).evidenceNeedsReview,2);
    assert.equal(pendingWaveEvidence(blocked).length,0);
    const committed=markWaveEvidenceCommitted(x.store.read(),pending.wave,
      pending.attemptId,{
        archiveReceipt:{status:'VERIFIED',waveSha256:pending.evidence.waveSha256,
          manifestSha256:'1'.repeat(64),archiveCount:2,
          verifiedSlots:2,unresolvedSlots:0},
        cDeltaReceipt:{status:'APPENDED',sourceSha256:pending.evidence.sourceSha256,
          deltaIndex:36,deltaSha256:'2'.repeat(64),addedExactC:1}
      });
    assert.equal(checkpointStats(committed).evidencePending,0);
    assert.equal(checkpointStats(committed).evidenceCommitted,2);
    assert.equal(pendingWaveEvidence(committed).length,0);
  }finally{fs.rmSync(x.dirs.root,{recursive:true,force:true});}
});
