import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {planReportWaves,makeRankingsWaveQuery}
  from '../src/core/report-wave-plan.mjs';
import {buildActorProofWaveManifest,verifyActorProofArchive,
  verifyActorProofWaveManifest}
  from '../src/core/fresh216-actor-proof-archive.mjs';
import {createFresh216EvidencePublisher}
  from '../src/adapters/fresh216-evidence-publisher.mjs';
import {SOURCE_SHA256} from '../tools/lib/fresh216-c-delta.mjs';

const sha=v=>createHash('sha256').update(v).digest('hex');
const KEY='SYNTHETIC_EVIDENCE_PUBLISHER_HMAC_KEY_NEVER_USE_IN_PRODUCTION_20261031';
const SOURCE=SOURCE_SHA256,SCOPE='heroic:2026-10-22_27:latest:source';
const REPORT='SYNTHETIC-REPORT',REVISION=5,FIGHT=3,
  ENCOUNTER=3470,DIFFICULTY=4,START=1792594801000;
function fixture(){
  const sourceSlots=[];
  for(let j=0;j<216;j++){
    const jobKey='Job'+String(j).padStart(3,'0')+'|Hunter|Marksmanship';
    const snapshotSha=sha('snapshot:'+jobKey);
    for(let rank=1;rank<=100;rank++){
      const target=j===0&&rank===1;
      sourceSlots.push({
        scopeKey:SCOPE,jobKey,rank,snapshotSha,status:'PENDING',
        className:'Hunter',specName:'Marksmanship',
        totalDps:target?1000:10000-rank,
        reportCode:target?REPORT:'OTHER-'+jobKey+'-'+rank,
        fightId:target?FIGHT:10000+j*100+rank,
        encounterId:ENCOUNTER,difficulty:DIFFICULTY,
        name:target?'Player (1)':'Player ('+rank+')',
        startTime:target?START:START+rank,
        reportRevision:target?REVISION:null,
        filter:'date.2026-10-22.2026-10-27'
      });
    }
  }
  const slot=sourceSlots[0];
  const group={
    scopeKey:SCOPE,reportCode:REPORT,reportRevision:REVISION,
    fightId:FIGHT,encounterId:ENCOUNTER,difficulty:DIFFICULTY,
    revisionKnown:true,slots:[{
      jobKey:slot.jobKey,rank:slot.rank,snapshotSha:slot.snapshotSha,
      totalDps:slot.totalDps,className:slot.className,
      specName:slot.specName,startTime:slot.startTime,name:slot.name
    }]
  };
  const wave=planReportWaves({groups:[group]}).waves[0];
  const actor={id:7,name:'Player (1)',class:'Hunter',
    spec:'Marksmanship',amount:1000};
  const boss={...actor,amount:700};
  const fight=(a)=>({fightID:FIGHT,encounter:{id:ENCOUNTER},
    difficulty:DIFFICULTY,roles:{dps:{characters:[a]}}});
  const report={code:REPORT,revision:REVISION,
    o0:{data:[fight(actor)]},b0:{data:[fight(boss)]}};
  const body={data:{rateLimitData:{currentRequest:{total:3.25}},
    reportData:{report}}};
  const responseBodyBytes=Buffer.from(JSON.stringify(body),'utf8');
  const requestBodyText=JSON.stringify(makeRankingsWaveQuery(wave));
  const requestBodySha256=sha(Buffer.from(requestBodyText,'utf8'));
  const responseBodySha256=sha(responseBodyBytes);
  const waveSha256=sha(Buffer.from(JSON.stringify(wave),'utf8'));
  const attemptId='SYNTHETIC-WAVE-ATTEMPT';
  const witness={
    schema:1,kind:'FRESH216_PRIVATE_REPORT_WAVE_WITNESS_V1',
    sourceSha256:SOURCE,waveSha256,requestBodySha256,responseBodySha256,
    httpStatus:200,observedPoints:3.25,capturedAtMs:1793450000000,
    attemptId,requestBodyText,responseBodyBytes,wave,
    witnessSha256:'f'.repeat(64),
    witnessRef:'report-wave-witnesses/'+waveSha256+'.json.br'
  };
  const evidence={
    schema:1,status:'PENDING',waveId:wave.waveId,attemptId,
    sourceSha256:SOURCE,waveSha256,requestBodySha256,responseBodySha256,
    witnessRef:witness.witnessRef,witnessSha256:witness.witnessSha256
  };
  return {sourceSlots,group,wave,body,witness,evidence};
}
function publisherFor(f,{failArchive=false,failDelta=false}={}){
  let archiveCalls=0,deltaCalls=0;
  const archiveStore={
    async persistWave(archives,{createdAtMs}){
      archiveCalls++;
      if(failArchive)throw Error('SYNTHETIC_ARCHIVE_WRITE_UNKNOWN');
      for(const a of archives)verifyActorProofArchive(a,{
        hmacKey:KEY,expectedSourceSha256:SOURCE,
        expectedRequestBodySha256:f.evidence.requestBodySha256,
        expectedResponseBodySha256:f.evidence.responseBodySha256
      });
      const manifest=buildActorProofWaveManifest({
        archives,hmacKey:KEY,createdAtMs
      });
      const verified=verifyActorProofWaveManifest(manifest,{
        hmacKey:KEY,archives
      });
      return {
        waveSha256:manifest.waveSha256,
        manifestSha256:manifest.manifestSha256,
        manifestCommitSha:'d'.repeat(40),
        archiveCount:verified.archiveCount,
        verifiedSlots:verified.verifiedSlots,
        unresolvedSlots:verified.unresolvedSlots
      };
    }
  };
  const cDeltaAppender=async input=>{
    deltaCalls++;
    assert.equal(input.bridgeResult.verifiedSlots,1);
    assert.equal(input.archiveReceipt.status,'VERIFIED');
    assert.equal(input.archiveReceipt.manifestSha256.length,64);
    assert.equal(input.archiveReceipt.manifestSha256,input.manifest.manifestSha256);
    assert.equal(input.archiveReceipt.waveSha256,input.manifest.waveSha256);
    assert.equal(input.bridgeResult.proofRows.length,1);
    if(failDelta)throw Error('SYNTHETIC_PRIVATE_DELTA_UNCERTAIN');
    return {status:'APPENDED',sourceSha256:SOURCE,
      deltaIndex:36,deltaSha256:'e'.repeat(64),addedExactC:1};
  };
  const publish=createFresh216EvidencePublisher({
    sourceSlots:f.sourceSlots,expectedSourceSha256:SOURCE,
    expectedScopeKey:SCOPE,hmacKey:KEY,archiveStore,cDeltaAppender
  });
  return {publish,counts:()=>({archiveCalls,deltaCalls})};
}
test('one private witness flows through archive replay, PR19 bridge and C-delta callback',async()=>{
  const f=fixture(),p=publisherFor(f);
  const out=await p.publish({
    wave:f.wave,attemptId:f.witness.attemptId,
    evidence:f.evidence,witness:f.witness
  });
  assert.equal(out.status,'COMMITTED');
  assert.equal(out.archiveReceipt.status,'VERIFIED');
  assert.equal(out.archiveReceipt.archiveCount,1);
  assert.equal(out.archiveReceipt.verifiedSlots,1);
  assert.equal(out.cDeltaReceipt.status,'APPENDED');
  assert.equal(out.cDeltaReceipt.addedExactC,1);
  assert.deepEqual(p.counts(),{archiveCalls:1,deltaCalls:1});
});
test('archive write uncertainty stops before private C-delta append',async()=>{
  const f=fixture(),p=publisherFor(f,{failArchive:true});
  const out=await p.publish({
    wave:f.wave,attemptId:f.witness.attemptId,
    evidence:f.evidence,witness:f.witness
  });
  assert.deepEqual(out,{status:'NEEDS_REVIEW',
    code:'PUBLIC_ARCHIVE_WRITE_OR_READBACK_UNCERTAIN'});
  assert.deepEqual(p.counts(),{archiveCalls:1,deltaCalls:0});
});
test('private C-delta uncertainty is isolated after verified archive readback',async()=>{
  const f=fixture(),p=publisherFor(f,{failDelta:true});
  const out=await p.publish({
    wave:f.wave,attemptId:f.witness.attemptId,
    evidence:f.evidence,witness:f.witness
  });
  assert.deepEqual(out,{status:'NEEDS_REVIEW',
    code:'PRIVATE_C_DELTA_APPEND_UNCERTAIN'});
  assert.deepEqual(p.counts(),{archiveCalls:1,deltaCalls:1});
});
test('witness request/source/response drift is rejected before either writer',async()=>{
  const f=fixture(),p=publisherFor(f);
  const bad={...f.witness,responseBodySha256:'0'.repeat(64)};
  await assert.rejects(p.publish({
    wave:f.wave,attemptId:f.witness.attemptId,
    evidence:f.evidence,witness:bad
  }),/EVIDENCE_PUBLISHER_WITNESS_IDENTITY_DRIFT/);
  assert.deepEqual(p.counts(),{archiveCalls:0,deltaCalls:0});
});

test('publisher snapshots the pinned A slots so caller mutation cannot drift a later wave',async()=>{
  const f=fixture(),p=publisherFor(f);
  f.sourceSlots[0].totalDps=123456789;
  const out=await p.publish({
    wave:f.wave,attemptId:f.witness.attemptId,
    evidence:f.evidence,witness:f.witness
  });
  assert.equal(out.status,'COMMITTED');
  assert.equal(out.cDeltaReceipt.addedExactC,1);
});
