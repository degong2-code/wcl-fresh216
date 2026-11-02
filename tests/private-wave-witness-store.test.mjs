import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {planReportWaves,makeRankingsWaveQuery}
  from '../src/core/report-wave-plan.mjs';
import {createPrivateWaveWitnessStore}
  from '../src/adapters/private-wave-witness-store.mjs';

const sha=v=>createHash('sha256').update(v).digest('hex');
const SOURCE='a'.repeat(64);
function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fresh216-witness-'));
  const repo=path.join(root,'repo'),privateDir=path.join(root,'private');
  fs.mkdirSync(repo,{mode:0o700});
  const slot={
    jobKey:'Hunter|Marksmanship',rank:1,snapshotSha:sha('snapshot'),
    totalDps:1000,className:'Hunter',specName:'Marksmanship',
    startTime:1792594801000,name:'SyntheticActor'
  };
  const group={
    scopeKey:'heroic:2026-10-22_27:latest:source',
    reportCode:'SYNTHETIC-REPORT',reportRevision:2,
    fightId:7,encounterId:3470,difficulty:4,slots:[slot]
  };
  const wave=planReportWaves({groups:[group]}).waves[0];
  const requestBodyText=JSON.stringify(makeRankingsWaveQuery(wave));
  const responseBodyBytes=Buffer.from(JSON.stringify({
    data:{rateLimitData:{currentRequest:{total:1}},reportData:{report:{}}}
  }),'utf8');
  const input={
    wave,requestBodyText,
    requestBodySha256:sha(Buffer.from(requestBodyText,'utf8')),
    responseBodyBytes,responseBodySha256:sha(responseBodyBytes),
    httpStatus:200,observedPoints:1,capturedAtMs:1793450000000,
    attemptId:'SYNTHETIC-WITNESS-ATTEMPT',
    joinedByFight:[{verified:[],unresolved:[{
      jobKey:slot.jobKey,rank:slot.rank,snapshotSha:slot.snapshotSha
    }]}]
  };
  const store=createPrivateWaveWitnessStore({
    privateDir,repoRoot:repo,sourceSha256:SOURCE
  });
  return {root,store,input,wave};
}
test('private witness persists exact bytes and reopens with immutable identity',()=>{
  const f=fixture();
  try{
    const first=f.store.persist(f.input);
    assert.equal(first.waveId,f.wave.waveId);
    assert.equal(first.reused,false);
    const read=f.store.read(first.witnessRef);
    assert.equal(read.wave.waveId,f.wave.waveId);
    assert.equal(read.waveSha256,first.waveSha256);
    assert.equal(read.witnessSha256,first.witnessSha256);
    assert.deepEqual(read.responseBodyBytes,f.input.responseBodyBytes);
    assert.equal(sha(read.responseBodyBytes),f.input.responseBodySha256);
    const second=f.store.persist(f.input);
    assert.equal(second.reused,true);
    assert.equal(second.waveId,f.wave.waveId);
    assert.equal(second.witnessSha256,first.witnessSha256);
  }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('create-only race receipt retains wave identity required by Report-wave checkpoint',()=>{
  const f=fixture(),original=fs.linkSync;
  try{
    fs.linkSync=(source,target)=>{
      original(source,target);
      const error=new Error('synthetic create-only race');
      error.code='EEXIST';
      throw error;
    };
    const receipt=f.store.persist(f.input);
    assert.equal(receipt.reused,true);
    assert.equal(receipt.waveId,f.wave.waveId);
    assert.equal(f.store.read(receipt.witnessRef).wave.waveId,f.wave.waveId);
  }finally{
    fs.linkSync=original;
    fs.rmSync(f.root,{recursive:true,force:true});
  }
});
