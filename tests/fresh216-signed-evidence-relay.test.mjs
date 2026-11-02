import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
  buildActorProofArchive,buildActorProofWaveManifest
} from '../src/core/fresh216-actor-proof-archive.mjs';
import {
  preparePrivateSignedWaveStage,inspectPublicSignedWaveStage
} from '../src/adapters/fresh216-signed-evidence-relay.mjs';

const KEY='SYNTHETIC_TEST_ONLY_64_RANDOM_STYLE_CHARACTERS_NO_REAL_SECRET_0011';
const sha=x=>createHash('sha256').update(x).digest('hex');
function fixture(){
  const make=fightId=>buildActorProofArchive({
    group:{scopeKey:'heroic:synthetic',
      reportCode:'SYNTHETIC-RAW-REPORT-NOT_FOR_PUBLIC',
      reportRevision:5,fightId,encounterId:3470,difficulty:4,
      slots:[{jobKey:'SYNTHETIC_JOB',rank:1,
        snapshotSha:'a'.repeat(64),name:'Synthetic Person',
        totalDps:1000,className:'Hunter',specName:'Marksmanship',
        startTime:1792594801000,reportRevision:5}]},
    report:{code:'SYNTHETIC-RAW-REPORT-NOT_FOR_PUBLIC',
      revision:5,overall:{data:[{fightID:fightId,
        encounter:{id:3470},difficulty:4,
        roles:{dps:{characters:[{id:7,name:'Synthetic Person',
          class:'Hunter',spec:'Marksmanship',amount:1000}]}}}]},
      boss:{data:[{fightID:fightId,encounter:{id:3470},
        difficulty:4,roles:{dps:{characters:[{id:7,
          name:'Synthetic Person',class:'Hunter',
          spec:'Marksmanship',amount:700}]}}}]}},
    sourceSha256:'a'.repeat(64),waveSha256:'b'.repeat(64),
    requestBodySha256:sha('synthetic query'),
    responseBodySha256:sha('synthetic exact response'),
    httpStatus:200,observedPoints:1.25,capturedAtMs:1793450000000,
    hmacKey:KEY
  });
  const archives=[make(10),make(11)];
  const manifest=buildActorProofWaveManifest({
    archives,hmacKey:KEY,createdAtMs:1793450000000
  });
  return {archives,manifest};
}
function prepared(){
  const f=fixture();
  const staged=preparePrivateSignedWaveStage({
    ...f,hmacKey:KEY,privateReportStateCommit:'a'.repeat(40)
  });
  const inspect=overrides=>inspectPublicSignedWaveStage({
    index:staged.index,indexContent:staged.indexContent,
    files:staged.files,approvedPrivateStageCommit:'c'.repeat(40),
    checkedOutPrivateStageCommit:'c'.repeat(40),...overrides
  });
  return {staged,inspect};
}
test('private HMAC authenticates once; public can inspect ONLY redacted bytes pinned to private commit',()=>{
  const {staged,inspect}=prepared();
  const result=inspect();
  assert.equal(result.status,'PUBLIC_RELAY_INSPECTED_WITHOUT_HMAC_KEY');
  assert.equal(result.archiveCount,2);
  assert.equal(result.verifiedSlots,2);
  assert.equal(result.unresolvedSlots,0);
  assert.equal(result.hmacAuthenticatedOnPublicRunner,false);
  assert.equal(result.files.length,3);
  assert.equal(result.files.at(-1).path,
    'evidence/fresh216/waves/'+staged.index.waveSha256+'.json');
  for(const f of result.files){
    assert.ok(!f.content.includes('SYNTHETIC-RAW-REPORT-NOT_FOR_PUBLIC'));
    assert.ok(!f.content.includes('Synthetic Person'));
    assert.ok(!f.content.includes('"actorRef"'));
    assert.ok(!f.content.includes('"reportCode"'));
  }
});
test('public cannot accept unapproved or drifting private Git commit',()=>{
  const {inspect}=prepared();
  assert.throws(()=>inspect({checkedOutPrivateStageCommit:'d'.repeat(40)}),
    /SIGNED_RELAY_PRIVATE_COMMIT_NOT_PINNED/);
  assert.throws(()=>inspect({approvedPrivateStageCommit:'unverified'}),
    /SIGNED_RELAY_PRIVATE_COMMIT_NOT_PINNED/);
});
test('corrupted private file bytes and additional private paths fail before public writing',()=>{
  const {staged,inspect}=prepared();
  const files=structuredClone(staged.files);
  files[0].content=files[0].content.replace('"bossDps": 700',
    '"bossDps": 701');
  assert.throws(()=>inspect({files}),
    /SIGNED_RELAY_PRIVATE_FILE_HASH_DRIFT/);
  const fileNames=structuredClone(staged.files);
  fileNames[0].path='projects/wcl-fresh216/private-source/secrets.json';
  assert.throws(()=>inspect({files:fileNames}),
    /SIGNED_RELAY_PRIVATE_FILE_HASH_DRIFT/);
});
test('private HMAC mismatch cannot produce a staging index',()=>{
  const f=fixture();
  assert.throws(()=>preparePrivateSignedWaveStage({
    ...f,hmacKey:'another_strong_synthetic_key_with_more_than_32_characters',
    privateReportStateCommit:'a'.repeat(40)
  }),/ACTOR_ARCHIVE_HMAC_INVALID/);
});
test('public rejects forged private manifest digest and schema-only substitution',()=>{
  const {staged,inspect}=prepared();
  const files=structuredClone(staged.files);
  const manifest=JSON.parse(files.at(-1).content);
  manifest.verifiedSlots=7;
  files.at(-1).content=JSON.stringify(manifest,null,2)+'\n';
  files.at(-1).sha256=sha(files.at(-1).content);
  const index=structuredClone(staged.index);
  index.files.at(-1).sha256=files.at(-1).sha256;
  assert.throws(()=>inspect({
    index,indexContent:JSON.stringify(index,null,2)+'\n',files
  }),/ACTOR_WAVE_MANIFEST_CONTENT_SHA_MISMATCH/);
});
