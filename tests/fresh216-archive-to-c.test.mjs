import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
  buildActorProofArchive,buildActorProofWaveManifest
} from '../src/core/fresh216-actor-proof-archive.mjs';
import {joinFightEvidence} from '../src/core/evidence-join.mjs';
import {summarizeFreshDpsJob} from '../src/core/fresh-dps-output-contract.mjs';
import {
  buildFresh216CProofRowsFromActorArchives
} from '../src/core/fresh216-archive-to-c.mjs';

const sha=v=>createHash('sha256').update(v).digest('hex');
const KEY='SYNTHETIC_ARCHIVE_TO_C_HMAC_KEY_NEVER_USE_IN_PRODUCTION_20261031';
const SOURCE='a'.repeat(64),WAVE='b'.repeat(64),
  REQUEST='c'.repeat(64),RESPONSE='d'.repeat(64);
const SCOPE='heroic:2026-10-22_27:latest:source';
const REPORT='SYNTHETIC-REPORT';
const REVISION=5,FIGHT=3,ENCOUNTER=3470,DIFFICULTY=4;
const ACTOR_ID=7,TOTAL=1000,BOSS=700,START=1792594801000;
function fixture({actorName='Player (1)',duplicateNamed=false}={}){
  const sourceSlots=[];
  for(let j=0;j<216;j++){
    const jobKey='Job'+String(j).padStart(3,'0')+'|Hunter|Marksmanship';
    const snapshotSha=sha('snapshot:'+jobKey);
    for(let rank=1;rank<=100;rank++){
      const isTarget=j===0&&rank===1;
      const duplicate=j===0&&rank===2&&duplicateNamed;
      sourceSlots.push({
        scopeKey:SCOPE,jobKey,rank,snapshotSha,status:'PENDING',
        className:'Hunter',specName:'Marksmanship',
        totalDps:isTarget?TOTAL:10000-rank,
        reportCode:isTarget||duplicate?REPORT:'OTHER-'+jobKey+'-'+rank,
        fightId:isTarget||duplicate?FIGHT:10000+j*100+rank,
        encounterId:isTarget||duplicate?ENCOUNTER:ENCOUNTER,
        difficulty:DIFFICULTY,
        name:isTarget||duplicate?actorName:'Player ('+rank+')',
        startTime:isTarget||duplicate?START:START+rank,
        reportRevision:isTarget||duplicate?REVISION:null,
        filter:'date.2026-10-22.2026-10-27'
      });
    }
  }
  const slot=sourceSlots[0];
  const group={
    scopeKey:SCOPE,reportCode:REPORT,reportRevision:REVISION,
    fightId:FIGHT,encounterId:ENCOUNTER,difficulty:DIFFICULTY,
    slots:[slot]
  };
  const overallActor={
    id:ACTOR_ID,name:actorName,class:'Hunter',
    spec:'Marksmanship',amount:TOTAL
  };
  const bossActor={...overallActor,amount:BOSS};
  const fight=(actor)=>({
    fightID:FIGHT,encounter:{id:ENCOUNTER},difficulty:DIFFICULTY,
    roles:{dps:{characters:[actor]}}
  });
  const report={
    code:REPORT,revision:REVISION,
    overall:{data:[fight(overallActor)]},
    boss:{data:[fight(bossActor)]}
  };
  const archive=buildActorProofArchive({
    group,report,sourceSha256:SOURCE,waveSha256:WAVE,
    requestBodySha256:REQUEST,responseBodySha256:RESPONSE,
    httpStatus:200,observedPoints:3.25,capturedAtMs:1793450000000,
    hmacKey:KEY
  });
  const manifest=buildActorProofWaveManifest({
    archives:[archive],hmacKey:KEY,createdAtMs:1793450001000
  });
  const joined=joinFightEvidence(group,report);
  assert.equal(joined.verified.length,1);
  const identity={
    scopeKey:SCOPE,reportCode:REPORT,reportRevision:REVISION,
    fightId:FIGHT,encounterId:ENCOUNTER,difficulty:DIFFICULTY
  };
  const privateProofRows=joined.verified.map(row=>({identity,...row}));
  return {sourceSlots,group,report,archive,manifest,privateProofRows};
}
function convert(f,overrides={}){
  return buildFresh216CProofRowsFromActorArchives({
    groups:[f.group],archives:[f.archive],manifest:f.manifest,
    sourceSlots:f.sourceSlots,privateProofRows:f.privateProofRows,
    hmacKey:KEY,expectedSourceSha256:SOURCE,expectedScopeKey:SCOPE,
    ...overrides
  });
}

test('masked actor archive binds to private raw proof and passes the final C contract',()=>{
  const f=fixture({actorName:'Player (1)'});
  const out=convert(f);
  assert.equal(out.archiveCount,1);
  assert.equal(out.sourceSlots,1);
  assert.equal(out.candidateVerifiedSlots,1);
  assert.equal(out.verifiedSlots,1);
  assert.equal(out.unresolvedSlots,0);
  const proof=out.proofRows[0].proof;
  assert.equal(proof.actorRef,'id:7');
  assert.equal(proof.bossDps,700);
  assert.equal(proof.sourceStartTime,START);
  assert.equal(proof.discovery.kind,'REPORT_DUAL_RANKINGS_MASKED');
  assert.equal(proof.discovery.evidenceSha256,f.archive.responseProjectionSha256);
  const summary=summarizeFreshDpsJob({
    totalRankSlots:f.sourceSlots.slice(0,100),
    verifiedProofs:out.proofRows
  });
  assert.equal(summary.verifiedRanks,1);
});

test('named actor archive binds to private raw proof and passes the final C contract',()=>{
  const f=fixture({actorName:'Alice'});
  const out=convert(f);
  assert.equal(out.verifiedSlots,1);
  assert.equal(out.proofRows[0].proof.discovery.kind,'REPORT_DUAL_RANKINGS');
  const summary=summarizeFreshDpsJob({
    totalRankSlots:f.sourceSlots.slice(0,100),
    verifiedProofs:out.proofRows
  });
  assert.equal(summary.verifiedRanks,1);
});

test('a repeated named identity in the same job/report/fight is withheld, not promoted',()=>{
  const f=fixture({actorName:'Alice',duplicateNamed:true});
  const out=convert(f);
  assert.equal(out.candidateVerifiedSlots,1);
  assert.equal(out.verifiedSlots,0);
  assert.equal(out.unresolvedSlots,1);
  assert.equal(out.withheldCanonicalProofs,1);
  assert.equal(out.unresolved[0].reason,'NAMED_SOURCE_IDENTITY_NOT_UNIQUE');
  assert.equal(summarizeFreshDpsJob({
    totalRankSlots:f.sourceSlots.slice(0,100),verifiedProofs:out.proofRows
  }).verifiedRanks,0);
});

test('actor HMAC, BossDPS, report identity and A snapshot drift fail closed',()=>{
  const f=fixture({actorName:'Player (1)'});
  const badActor=f.privateProofRows.map(r=>({...r,
    proof:{...r.proof,actorRef:'id:8'}
  }));
  assert.throws(()=>convert(f,{privateProofRows:badActor}),
    /ARCHIVE_TO_C_HMAC_ACTOR_BINDING_MISMATCH/);
  const badBoss=f.privateProofRows.map(r=>({...r,
    proof:{...r.proof,bossDps:701}
  }));
  assert.throws(()=>convert(f,{privateProofRows:badBoss}),
    /ARCHIVE_TO_C_CANONICAL_PROOF_DIVERGENCE/);
  const badGroup={...f.group,reportCode:'OTHER-REPORT'};
  assert.throws(()=>convert(f,{groups:[badGroup]}),
    /ARCHIVE_TO_C_GROUP_NOT_IN_IMMUTABLE_A/);
  const badSlots=f.sourceSlots.map(s=>({...s}));
  badSlots[0].snapshotSha='e'.repeat(64);
  assert.throws(()=>convert(f,{sourceSlots:badSlots}),
    /ARCHIVE_TO_C_GROUP_NOT_IN_IMMUTABLE_A/);
});

test('missing canonical proof or tampered archive manifest cannot produce C',()=>{
  const f=fixture({actorName:'Player (1)'});
  assert.throws(()=>convert(f,{privateProofRows:[]}),
    /ARCHIVE_TO_C_PRIVATE_PROOF_MISSING/);
  const badManifest={...f.manifest,verifiedSlots:2};
  assert.throws(()=>convert(f,{manifest:badManifest}),
    /ACTOR_WAVE_MANIFEST_CONTENT_SHA_MISMATCH/);
  const badArchive={...f.archive};
  badArchive.outcomes=[{...badArchive.outcomes[0],bossDps:701}];
  assert.throws(()=>convert(f,{archives:[badArchive]}),
    /ACTOR_ARCHIVE_CONTENT_SHA_MISMATCH/);
});
