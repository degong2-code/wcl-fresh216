import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
  buildActorProofArchive,buildActorProofWaveManifest
} from '../src/core/fresh216-actor-proof-archive.mjs';
import {
  preparePrivateSignedWaveStage,inspectPublicSignedWaveStage,
  fetchPinnedPrivateSignedWaveStage,publishPinnedPrivateSignedWave,
  validatePublicRelayApproval,PUBLIC_RELAY_APPROVAL_KIND
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
  }),/ACTOR_WAVE_MANIFEST_HMAC_INVALID|ACTOR_ARCHIVE_HMAC_INVALID/);
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

const blobSha=txt=>createHash('sha1')
  .update('blob '+Buffer.byteLength(txt,'utf8')+String.fromCharCode(0))
  .update(txt,'utf8').digest('hex');
function privateReadonlyFixture(staged){
  const map=new Map([[staged.indexPath,staged.indexContent],
    ...staged.files.map(f=>[f.path,f.content])]);
  const requests=[];
  const fetchImpl=async(url,init)=>{
    requests.push({url,method:init.method});
    assert.equal(init.method,'GET');
    assert.ok(url.startsWith(
      'https://api.github.com/repos/degong2-code/ai-project-lab/contents/'));
    assert.ok(url.endsWith('?ref='+ 'c'.repeat(40)));
    assert.equal(init.headers.Authorization,
      'Bearer SYNTHETIC_PRIVATE_READ_TOKEN_NOT_REAL');
    const key=url.split('/contents/')[1].split('?ref=')[0];
    const content=map.get(key);
    if(!content)return {status:404};
    const raw=Buffer.from(content,'utf8');
    return {status:200,json:async()=>({
      encoding:'base64',content:raw.toString('base64'),
      size:raw.length,sha:blobSha(content)
    })};
  };
  return {fetchImpl,requests,map};
}
test('public pull fetches ONLY pinned private redacted index and archive paths via GET',async()=>{
  const {staged}=prepared(),p=privateReadonlyFixture(staged);
  const inspected=await fetchPinnedPrivateSignedWaveStage({
    approvedPrivateStageCommit:'c'.repeat(40),
    waveSha256:staged.index.waveSha256,
    privateReadToken:'SYNTHETIC_PRIVATE_READ_TOKEN_NOT_REAL',
    fetchImpl:p.fetchImpl
  });
  assert.equal(inspected.archiveCount,2);
  assert.equal(p.requests.length,4);
  assert.ok(p.requests.every(x=>x.method==='GET'));
  assert.ok(p.requests.every(x=>!x.url.includes('private-source')&&
    !x.url.includes('report-wave-witnesses')));
});
test('public pull refuses missing/changed Git blob and undeclared private file path',async()=>{
  const {staged}=prepared(),p=privateReadonlyFixture(staged);
  const poisoned=async(url,init)=>{
    const out=await p.fetchImpl(url,init);
    if(url.includes('/actor-proof/')&&out.status===200){
      const body=await out.json();
      return {status:200,json:async()=>({...body,sha:'a'.repeat(40)})};
    }
    return out;
  };
  await assert.rejects(fetchPinnedPrivateSignedWaveStage({
    approvedPrivateStageCommit:'c'.repeat(40),
    waveSha256:staged.index.waveSha256,
    privateReadToken:'SYNTHETIC_PRIVATE_READ_TOKEN_NOT_REAL',
    fetchImpl:poisoned
  }),/SIGNED_RELAY_PRIVATE_GIT_BLOB_DRIFT/);
  const edited=structuredClone(staged.index);
  edited.files[0].path='projects/wcl-fresh216/private-source/raw.json';
  p.map.set(staged.indexPath,JSON.stringify(edited,null,2)+'\n');
  await assert.rejects(fetchPinnedPrivateSignedWaveStage({
    approvedPrivateStageCommit:'c'.repeat(40),
    waveSha256:staged.index.waveSha256,
    privateReadToken:'SYNTHETIC_PRIVATE_READ_TOKEN_NOT_REAL',
    fetchImpl:p.fetchImpl
  }),/SIGNED_RELAY_PRIVATE_PATH_NOT_ALLOWED/);
});
test('public relay cannot publish without an explicit authorization gate',async()=>{
  let calls=0;
  await assert.rejects(publishPinnedPrivateSignedWave({
    approvedPrivateStageCommit:'c'.repeat(40),
    waveSha256:'b'.repeat(64),
    privateReadToken:'SYNTHETIC_PRIVATE_READ_TOKEN_NOT_REAL',
    publicGitToken:'SYNTHETIC_PUBLIC_TOKEN_NOT_REAL',
    privateFetch:async()=>{calls++;throw Error('unexpected');},
    publicFetch:async()=>{calls++;throw Error('unexpected');}
  }),/SIGNED_RELAY_PUBLICATION_NOT_AUTHORIZED/);
  assert.equal(calls,0);
});


const TRUSTED_RELAY_CONTEXT={
  GITHUB_ACTIONS:'true',
  GITHUB_REPOSITORY:'degong2-code/wcl-fresh216',
  GITHUB_REF:'refs/heads/work/fresh216-autonomous-host-20261031',
  GITHUB_EVENT_NAME:'push',
  GITHUB_SHA:'d'.repeat(40)
};
const sampleRelease=(overrides={})=>({
  schema:1,kind:PUBLIC_RELAY_APPROVAL_KIND,
  privateStageCommit:'c'.repeat(40),
  waveSha256:'b'.repeat(64),
  reviewedWorkflowCommit:'d'.repeat(40),
  expectedPublicEvidenceHead:'a'.repeat(40),
  ...overrides
});
test('exact owner-approved private commit and wave must match the trusted workflow SHA',()=>{
  const checked=validatePublicRelayApproval({
    approval:sampleRelease(),
    approvedPrivateStageCommit:'c'.repeat(40),
    waveSha256:'b'.repeat(64),githubContext:TRUSTED_RELAY_CONTEXT
  });
  assert.equal(checked.privateStageCommit,'c'.repeat(40));
  assert.equal(checked.expectedPublicEvidenceHead,'a'.repeat(40));
  for(const altered of [
    {privateStageCommit:'e'.repeat(40)},
    {waveSha256:'a'.repeat(64)},
    {reviewedWorkflowCommit:'f'.repeat(40)},
    {expectedPublicEvidenceHead:'not-an-immutable-sha'},
    {schema:2}
  ]){
    assert.throws(()=>validatePublicRelayApproval({
      approval:sampleRelease(altered),
      approvedPrivateStageCommit:'c'.repeat(40),
      waveSha256:'b'.repeat(64),githubContext:TRUSTED_RELAY_CONTEXT
    }),/SIGNED_RELAY_EXACT_OWNER_APPROVAL_MISSING|SIGNED_RELAY_UNTRUSTED_PUBLIC_WORKFLOW_CONTEXT/);
  }
});
test('branch, event, repository and workflow commit drift always refuse relay approval',()=>{
  const altered=[
    {GITHUB_REF:'refs/heads/work/fresh216-adaptive-archive-delta-20261031'},
    {GITHUB_EVENT_NAME:'pull_request'},
    {GITHUB_REPOSITORY:'another-org/wcl-fresh216'},
    {GITHUB_SHA:'f'.repeat(40)},
    {GITHUB_ACTIONS:'false'}
  ];
  for(const item of altered)
    assert.throws(()=>validatePublicRelayApproval({
      approval:sampleRelease(),approvedPrivateStageCommit:'c'.repeat(40),
      waveSha256:'b'.repeat(64),
      githubContext:{...TRUSTED_RELAY_CONTEXT,...item}
    }),/SIGNED_RELAY_UNTRUSTED_PUBLIC_WORKFLOW_CONTEXT/);
});
test('publicationApproved true without exact external approval still performs zero requests',async()=>{
  let calls=0;
  const fetchImpl=async()=>{calls++;throw Error('network not allowed');};
  const base={
    approvedPrivateStageCommit:'c'.repeat(40),
    waveSha256:'b'.repeat(64),
    privateReadToken:'SYNTHETIC_PRIVATE_READ_TOKEN_NOT_REAL',
    publicGitToken:'SYNTHETIC_PUBLIC_TOKEN_NOT_REAL',
    publicationApproved:true,
    privateFetch:fetchImpl,publicFetch:fetchImpl,
    githubContext:TRUSTED_RELAY_CONTEXT
  };
  await assert.rejects(publishPinnedPrivateSignedWave(base),
    /SIGNED_RELAY_EXACT_OWNER_APPROVAL_MISSING/);
  await assert.rejects(publishPinnedPrivateSignedWave({
    ...base,approvedPublication:sampleRelease({waveSha256:'a'.repeat(64)})
  }),/SIGNED_RELAY_EXACT_OWNER_APPROVAL_MISSING/);
  await assert.rejects(publishPinnedPrivateSignedWave({
    ...base,approvedPublication:sampleRelease(),
    githubContext:{...TRUSTED_RELAY_CONTEXT,GITHUB_EVENT_NAME:'pull_request'}
  }),/SIGNED_RELAY_UNTRUSTED_PUBLIC_WORKFLOW_CONTEXT/);
  assert.equal(calls,0);
});
