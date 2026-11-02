import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildActorProofArchive,buildActorProofWaveManifest}
  from '../src/core/fresh216-actor-proof-archive.mjs';
import {createPrivateStagedPublicWaveStore,
  inspectPublishedSignedWaveReadOnly}
  from '../src/adapters/private-staged-public-wave-store.mjs';

const KEY='SYNTHETIC_ONLY_HMAC_SECRET_WITH_MORE_THAN_32_BYTES';
const sha=x=>createHash('sha256').update(x).digest('hex');
const blobSha=bytes=>createHash('sha1')
  .update('blob '+bytes.length+'\0').update(bytes).digest('hex');
function fixture(){
  const group={scopeKey:'heroic:synthetic',reportCode:'SYNTHETIC-REPORT',
    reportRevision:5,fightId:10,encounterId:3470,difficulty:4,
    slots:[{jobKey:'SYNTHETIC-ONE',rank:1,
      snapshotSha:'c'.repeat(64),name:'SyntheticActor',totalDps:1000,
      className:'Hunter',specName:'Marksmanship',
      startTime:1792594801000,reportRevision:5}]};
  const fight=amount=>({fightID:10,encounter:{id:3470},
    difficulty:4,roles:{dps:{characters:[{
      id:7,name:'SyntheticActor',class:'Hunter',spec:'Marksmanship',amount
    }]}}});
  const archive=buildActorProofArchive({
    group,report:{code:'SYNTHETIC-REPORT',revision:5,
      overall:{data:[fight(1000)]},boss:{data:[fight(700)]}},
    sourceSha256:'a'.repeat(64),waveSha256:'b'.repeat(64),
    requestBodySha256:sha('synthetic-request'),
    responseBodySha256:sha('synthetic-response'),
    httpStatus:200,observedPoints:1,capturedAtMs:1793450000000,
    hmacKey:KEY
  });
  const archives=[archive];
  const manifest=buildActorProofWaveManifest({
    archives,hmacKey:KEY,createdAtMs:1793450000000
  });
  const context={wave:{},evidence:{},attemptId:'synthetic',witness:{}};
  return {archives,manifest,context};
}
function syntheticPublic(manifest,archives,{missingManifest=false,
  missingArchive=false,tamper=false}={}){
  const files=new Map([
    ['evidence/fresh216/waves/'+manifest.waveSha256+'.json',manifest],
    ...archives.map(a=>['evidence/fresh216/actor-proof/'+a.archiveId+'.json',a])
  ]);
  let calls=0;
  const fetchImpl=async(url,opts)=>{
    calls++;
    assert.equal(opts.method,'GET');
    const filePath=url.split('/contents/')[1].split('?ref=')[0];
    if(missingManifest&&filePath.includes('/waves/'))return {status:404};
    if(missingArchive&&filePath.includes('/actor-proof/'))return {status:404};
    const data=files.get(filePath);
    if(!data)return {status:404};
    const payload=Buffer.from(JSON.stringify(data,null,2)+'\n');
    return {status:200,json:async()=>({
      encoding:'base64',size:payload.length,
      content:(tamper?Buffer.from('tampered'):payload).toString('base64'),
      sha:blobSha(payload)
    })};
  };
  return {fetchImpl,calls:()=>calls};
}
const baseStore=({stagePersist,publicFetch,stageWriteApproved=true,
  getReportStateCommit=async()=> 'f'.repeat(40)}={})=>
  createPrivateStagedPublicWaveStore({
    repoRoot:'/tmp/synthetic-private-stage',hmacKey:KEY,stageWriteApproved,
    stagePersist,publicFetch,getReportStateCommit
  });

test('missing stage authorization causes zero Git or public reads',async()=>{
  const f=fixture();let staged=0,read=0,state=0;
  const store=baseStore({
    stageWriteApproved:false,
    stagePersist:()=>{staged++;throw Error('unexpected');},
    publicFetch:()=>{read++;throw Error('unexpected');},
    getReportStateCommit:()=>{state++;throw Error('unexpected');}
  });
  await assert.rejects(store.persistWave(f.archives,{
    manifest:f.manifest,proofContext:f.context
  }),/STAGED_PUBLIC_PRIVATE_STAGE_NOT_APPROVED/);
  assert.equal(staged+read+state,0);
});
test('private staging with absent public manifest leaves pending state',async()=>{
  const f=fixture(),p=syntheticPublic(f.manifest,f.archives,{missingManifest:true});
  let stages=0;
  const store=baseStore({publicFetch:p.fetchImpl,
    stagePersist:()=>{stages++;return {
      status:'PRIVATE_SIGNED_STAGE_REMOTE_CONFIRMED',
      privateStageCommit:'e'.repeat(40),waveSha256:f.manifest.waveSha256
    };}
  });
  await assert.rejects(store.persistWave(f.archives,{
    manifest:f.manifest,proofContext:f.context
  }),/PUBLIC_ACTOR_WAVE_WRITE_NOT_ATTEMPTED/);
  assert.equal(stages,1);
  assert.equal(p.calls(),1);
});
test('public manifest and every archive must GET-confirm before C receipt',async()=>{
  const f=fixture(),p=syntheticPublic(f.manifest,f.archives);
  const store=baseStore({publicFetch:p.fetchImpl,
    stagePersist:()=>({
      status:'PRIVATE_SIGNED_STAGE_REMOTE_CONFIRMED',
      privateStageCommit:'e'.repeat(40),waveSha256:f.manifest.waveSha256
    })});
  const out=await store.persistWave(f.archives,{
    manifest:f.manifest,proofContext:f.context
  });
  assert.equal(out.manifestSha256,f.manifest.manifestSha256);
  assert.equal(out.archiveCount,1);
  assert.equal(out.verifiedSlots,1);
  assert.equal(out.unresolvedSlots,0);
  assert.equal(p.calls(),2);
});
test('present manifest with missing or corrupt archive fails closed',async()=>{
  const f=fixture();
  for(const opts of [{missingArchive:true},{tamper:true}]){
    const p=syntheticPublic(f.manifest,f.archives,opts);
    await assert.rejects(inspectPublishedSignedWaveReadOnly({
      ...f,hmacKey:KEY,fetchImpl:p.fetchImpl
    }),/STAGED_PUBLIC_MANIFEST_INCOMPLETE_STOP|STAGED_PUBLIC_BYTE_MISMATCH/);
  }
});
test('private state mismatch prevents stage write',async()=>{
  const f=fixture();let stageCalls=0;
  const store=baseStore({
    getReportStateCommit:async()=> 'invalid',
    publicFetch:async()=>{throw Error('unexpected public GET');},
    stagePersist:()=>{stageCalls++;throw Error('unexpected Git write');}
  });
  await assert.rejects(store.persistWave(f.archives,{
    manifest:f.manifest,proofContext:f.context
  }),/STAGED_PUBLIC_REPORT_STATE_UNCONFIRMED/);
  assert.equal(stageCalls,0);
});
