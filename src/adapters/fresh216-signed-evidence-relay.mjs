/**
 * Two-phase archive relay WITHOUT a new PAT or copying HMAC to public Actions.
 *
 * PRIVATE trusted Actions: verify the signed wave using the HMAC secret,
 * persist ONLY these redacted paths and the index in PRIVATE Git, read back,
 * and approve the exact private staging commit SHA.
 *
 * PUBLIC trusted Actions: read the approved immutable private commit using
 * FRESH216_PRIVATE_READ_TOKEN; inspect redacted schema, hashes and replay
 * WITHOUT the HMAC secret; then use PUBLIC GITHUB_TOKEN to append only these
 * bytes to the dedicated public evidence branch. No WCL transport here.
 *
 * Public verification is NOT an independent HMAC authentication. Trust is
 * derived from the trusted private Git commit and its prior HMAC validation.
 */
import {createHash} from 'node:crypto';
import {createPublicActorProofArchiveStore}
  from './fresh216-public-actor-proof-store.mjs';
import {
  verifyActorProofArchive,verifyActorProofWaveManifest,
  inspectActorProofArchivePublic,inspectActorProofWaveManifestPublic,
  ACTOR_PROOF_ARCHIVE_MAX_BYTES
} from '../core/fresh216-actor-proof-archive.mjs';

const need=(x,c)=>{if(!x)throw Error(c);};
const digest=s=>createHash('sha256').update(s,'utf8').digest('hex');
const is64=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const is40=s=>typeof s==='string'&&/^[a-f0-9]{40}$/.test(s);
const encode=x=>JSON.stringify(x,null,2)+'\n';
const base='evidence/fresh216/';
const actorPath=id=>base+'actor-proof/'+id+'.json';
const wavePath=id=>base+'waves/'+id+'.json';
export const SIGNED_STAGE_KIND='FRESH216_PRIVATE_SIGNED_WAVE_STAGE_V1';
export const SIGNED_STAGE_INDEX_DIR='projects/wcl-fresh216/private-public-relay/';
const indexPath=id=>SIGNED_STAGE_INDEX_DIR+id+'.json';
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&
  Object.keys(v).sort().join('|')===keys.slice().sort().join('|');
const rowsFor=(archives,manifest)=>{
  need(Array.isArray(archives)&&archives.length>=1&&archives.length<=8,
    'SIGNED_RELAY_ARCHIVES_INVALID');
  const sorted=archives.slice().sort((a,b)=>
    a.archiveId.localeCompare(b.archiveId));
  const objects=[...sorted.map(a=>({path:actorPath(a.archiveId),data:a})),
    {path:wavePath(manifest.waveSha256),data:manifest}];
  const seen=new Set();
  return objects.map(o=>{
    need(!seen.has(o.path),'SIGNED_RELAY_DUPLICATE_PATH');
    seen.add(o.path);
    const content=encode(o.data);
    need(Buffer.byteLength(content,'utf8')<=ACTOR_PROOF_ARCHIVE_MAX_BYTES,
      'SIGNED_RELAY_FILE_TOO_LARGE');
    return {path:o.path,sha256:digest(content),content};
  });
};
export function preparePrivateSignedWaveStage({
  archives,manifest,hmacKey,privateReportStateCommit
}={}){
  need(is40(privateReportStateCommit),
    'SIGNED_RELAY_PRIVATE_STATE_COMMIT_INVALID');
  const v=verifyActorProofWaveManifest(manifest,{archives,hmacKey});
  const sorted=archives.slice().sort((a,b)=>
    a.archiveId.localeCompare(b.archiveId));
  for(const archive of sorted)verifyActorProofArchive(archive,{hmacKey});
  const files=rowsFor(sorted,manifest);
  const index={
    schema:1,kind:SIGNED_STAGE_KIND,
    waveSha256:manifest.waveSha256,
    sourceSha256:manifest.sourceSha256,
    manifestSha256:manifest.manifestSha256,
    privateReportStateCommit,
    files:files.map(({path,sha256})=>({path,sha256}))
  };
  return {indexPath:indexPath(manifest.waveSha256),
    indexContent:encode(index),index,
    files,verifiedSlots:v.verifiedSlots,
    unresolvedSlots:v.unresolvedSlots};
}
export function inspectPublicSignedWaveStage({
  index,indexContent,files,approvedPrivateStageCommit,
  checkedOutPrivateStageCommit
}={}){
  need(is40(approvedPrivateStageCommit)&&
    checkedOutPrivateStageCommit===approvedPrivateStageCommit,
    'SIGNED_RELAY_PRIVATE_COMMIT_NOT_PINNED');
  need(exact(index,['schema','kind','waveSha256','sourceSha256',
    'manifestSha256','privateReportStateCommit','files'])&&
    index.schema===1&&index.kind===SIGNED_STAGE_KIND&&
    is64(index.waveSha256)&&is64(index.sourceSha256)&&
    is64(index.manifestSha256)&&
    is40(index.privateReportStateCommit)&&
    Array.isArray(index.files)&&index.files.length>=2&&
    index.files.length<=9&&
    indexContent===encode(index),
    'SIGNED_RELAY_INDEX_INVALID');
  need(Array.isArray(files)&&files.length===index.files.length,
    'SIGNED_RELAY_FILE_SET_INCOMPLETE');
  const dataByPath=new Map();
  for(const [i,entry] of index.files.entries()){
    need(exact(entry,['path','sha256'])&&
      typeof entry.path==='string'&&is64(entry.sha256)&&
      exact(files[i],['path','sha256','content'])&&
      files[i].path===entry.path&&
      files[i].sha256===entry.sha256&&
      typeof files[i].content==='string'&&
      Buffer.byteLength(files[i].content,'utf8')<=ACTOR_PROOF_ARCHIVE_MAX_BYTES&&
      digest(files[i].content)===entry.sha256&&
      !dataByPath.has(entry.path),
      'SIGNED_RELAY_PRIVATE_FILE_HASH_DRIFT');
    let parsed;
    try{parsed=JSON.parse(files[i].content);}
    catch{throw Error('SIGNED_RELAY_JSON_INVALID');}
    need(files[i].content===encode(parsed),
      'SIGNED_RELAY_NOT_CANONICAL_SERIALIZATION');
    dataByPath.set(entry.path,parsed);
  }
  const expectedManifestPath=wavePath(index.waveSha256);
  const manifest=dataByPath.get(expectedManifestPath);
  need(manifest&&manifest.manifestSha256===index.manifestSha256&&
    manifest.waveSha256===index.waveSha256&&
    manifest.sourceSha256===index.sourceSha256,
    'SIGNED_RELAY_MANIFEST_MISSING_OR_DRIFT');
  const archives=index.files.filter(f=>f.path!==expectedManifestPath).map(f=>{
    const v=dataByPath.get(f.path);
    need(v&&f.path===actorPath(v.archiveId),
      'SIGNED_RELAY_UNEXPECTED_PRIVATE_PATH');
    return v;
  });
  const sorted=archives.slice().sort((a,b)=>
    a.archiveId.localeCompare(b.archiveId));
  need(archives.every((v,i)=>v===sorted[i])&&
    index.files.at(-1).path===expectedManifestPath,
    'SIGNED_RELAY_FILE_ORDER_INVALID');
  const checked=inspectActorProofWaveManifestPublic(manifest,{archives});
  need(checked.manifestSha256===index.manifestSha256,
    'SIGNED_RELAY_MANIFEST_HASH_DRIFT');
  return {
    status:'PUBLIC_RELAY_INSPECTED_WITHOUT_HMAC_KEY',
    fromPrivateCommit:approvedPrivateStageCommit,
    waveSha256:index.waveSha256,
    files:files.map(x=>({path:x.path,content:x.content,
      sha256:x.sha256})),
    archiveCount:checked.archiveCount,
    verifiedSlots:checked.verifiedSlots,
    unresolvedSlots:checked.unresolvedSlots,
    hmacAuthenticatedOnPublicRunner:false
  };
}

/**
 * PUBLIC Actions read-only fetch from the exact approved private COMMIT,
 * never by a mutable branch. Only the stage index and its allowlisted
 * redacted artifact paths can be fetched. Token is NEVER returned or logged.
 */
export async function fetchPinnedPrivateSignedWaveStage({
  approvedPrivateStageCommit,waveSha256,privateReadToken,
  fetchImpl=fetch
}={}){
  need(is40(approvedPrivateStageCommit)&&is64(waveSha256)&&
    typeof privateReadToken==='string'&&privateReadToken.length>=20&&
    typeof fetchImpl==='function',
    'SIGNED_RELAY_PRIVATE_FETCH_CONFIG_INVALID');
  const endpoint='https://api.github.com/repos/degong2-code/ai-project-lab/contents/';
  const headers={Authorization:'Bearer '+privateReadToken,
    Accept:'application/vnd.github+json',
    'X-GitHub-Api-Version':'2022-11-28'};
  async function read(allowedPath,maxBytes){
    const url=endpoint+allowedPath+'?ref='+approvedPrivateStageCommit;
    let res;
    try{res=await fetchImpl(url,{method:'GET',headers,redirect:'error',
      signal:AbortSignal.timeout(15000)});}
    catch{throw Error('SIGNED_RELAY_PRIVATE_READ_UNCERTAIN_STOP');}
    need(res?.status===200,'SIGNED_RELAY_PRIVATE_READ_DENIED');
    const v=await res.json().catch(()=>null);
    need(v&&v.encoding==='base64'&&typeof v.content==='string'&&
      /^[a-f0-9]{40}$/.test(v.sha)&&
      typeof v.size==='number'&&v.size>0&&v.size<=maxBytes,
      'SIGNED_RELAY_PRIVATE_BLOB_SHAPE');
    const bytes=Buffer.from(v.content.replace(/\s+/g,''),'base64');
    need(bytes.length===v.size&&
      createHash('sha1').update('blob '+bytes.length+String.fromCharCode(0))
        .update(bytes).digest('hex')===v.sha,
      'SIGNED_RELAY_PRIVATE_GIT_BLOB_DRIFT');
    const body=bytes.toString('utf8');
    need(Buffer.from(body,'utf8').equals(bytes),
      'SIGNED_RELAY_PRIVATE_TEXT_INVALID');
    return body;
  }
  const indexContent=await read(indexPath(waveSha256),65536);
  let index;
  try{index=JSON.parse(indexContent);}
  catch{throw Error('SIGNED_RELAY_PRIVATE_INDEX_JSON_INVALID');}
  need(index?.waveSha256===waveSha256&&
    Array.isArray(index.files)&&index.files.length>=2&&
    index.files.length<=9,
    'SIGNED_RELAY_PRIVATE_INDEX_SCOPE_DRIFT');
  // Validate the complete bounded allowlist BEFORE any artifact GET.
  // Then overlap independent immutable reads, without extra API requests.
  const planned=index.files.map(item=>{
    need(item&&typeof item.path==='string'&&is64(item.sha256)&&
      (item.path===wavePath(waveSha256)||
        (item.path.startsWith(base+'actor-proof/')&&
          is64(item.path.slice((base+'actor-proof/').length,-5))&&
          item.path.endsWith('.json'))),
      'SIGNED_RELAY_PRIVATE_PATH_NOT_ALLOWED');
    return {path:item.path,sha256:item.sha256};
  });
  need(new Set(planned.map(item=>item.path)).size===planned.length,
    'SIGNED_RELAY_PRIVATE_PATH_DUPLICATE');
  const files=await Promise.all(planned.map(async item=>({
    ...item,content:await read(item.path,ACTOR_PROOF_ARCHIVE_MAX_BYTES)
  })));
  return inspectPublicSignedWaveStage({
    index,indexContent,files,approvedPrivateStageCommit,
    checkedOutPrivateStageCommit:approvedPrivateStageCommit
  });
}

/**
 * Defense-in-depth guard for a reviewed, exact-wave approval receipt.
 * The receipt MUST come from a separately reviewed protected workflow; an
 * arbitrary caller can forge an object and no code-only Boolean is proof
 * of human approval. GitHub-hosted identity and code SHA are additional
 * fail-closed constraints, not substitutes for owner authorization.
 */
export const PUBLIC_RELAY_APPROVAL_KIND=
  'FRESH216_OWNER_APPROVED_PUBLIC_WAVE_V1';
export function validatePublicRelayApproval({
  approval,approvedPrivateStageCommit,waveSha256,
  githubContext=process.env
}={}){
  need(exact(approval,['schema','kind','privateStageCommit',
    'waveSha256','reviewedWorkflowCommit','expectedPublicEvidenceHead'])&&
    approval.schema===1&&
    approval.kind===PUBLIC_RELAY_APPROVAL_KIND&&
    is40(approval.privateStageCommit)&&
    approval.privateStageCommit===approvedPrivateStageCommit&&
    is64(approval.waveSha256)&&
    approval.waveSha256===waveSha256&&
    is40(approval.reviewedWorkflowCommit)&&
    is40(approval.expectedPublicEvidenceHead),
    'SIGNED_RELAY_EXACT_OWNER_APPROVAL_MISSING');
  need(githubContext?.GITHUB_ACTIONS==='true'&&
    githubContext.GITHUB_REPOSITORY==='degong2-code/wcl-fresh216'&&
    githubContext.GITHUB_REF===
      'refs/heads/work/fresh216-autonomous-host-20261031'&&
    githubContext.GITHUB_EVENT_NAME==='push'&&
    githubContext.GITHUB_SHA===approval.reviewedWorkflowCommit,
    'SIGNED_RELAY_UNTRUSTED_PUBLIC_WORKFLOW_CONTEXT');
  return {
    privateStageCommit:approvedPrivateStageCommit,waveSha256,
    reviewedWorkflowCommit:approval.reviewedWorkflowCommit,
    expectedPublicEvidenceHead:approval.expectedPublicEvidenceHead
  };
}

/**
 * Composition entrypoint for a future separately approved PUBLIC Actions job.
 * Requires the pinned private commit and reads only allowlisted redacted files.
 * Atomic publication reuses the existing public GitHub wave store.
 * DO NOT invoke until the protected publication job has separate approval.
 */
export async function publishPinnedPrivateSignedWave({
  approvedPrivateStageCommit,waveSha256,privateReadToken,publicGitToken,
  privateFetch=fetch,publicFetch=fetch,publicationApproved=false,
  approvedPublication=null,githubContext=process.env
}={}){
  need(publicationApproved===true,
    'SIGNED_RELAY_PUBLICATION_NOT_AUTHORIZED');
  const approved=validatePublicRelayApproval({
    approval:approvedPublication,approvedPrivateStageCommit,
    waveSha256,githubContext
  });
  need(typeof publicGitToken==='string'&&publicGitToken.length>=20,
    'SIGNED_RELAY_PUBLIC_TOKEN_MISSING');
  const staged=await fetchPinnedPrivateSignedWaveStage({
    approvedPrivateStageCommit,waveSha256,privateReadToken,
    fetchImpl:privateFetch
  });
  const byPath=new Map(staged.files.map(f=>[f.path,JSON.parse(f.content)]));
  const manifest=byPath.get(wavePath(waveSha256));
  const archives=staged.files.filter(f=>f.path!==wavePath(waveSha256))
    .map(f=>byPath.get(f.path));
  const store=createPublicActorProofArchiveStore({
    token:publicGitToken,relayOnly:true,fetchImpl:publicFetch
  });
  const receipt=await store.persistWave(archives,{
    preSignedManifest:manifest,
    approvedPrivateStageCommit,checkedOutPrivateStageCommit:
      staged.fromPrivateCommit,
    expectedPublicEvidenceHead:approved.expectedPublicEvidenceHead
  });
  need(receipt.manifestSha256===manifest.manifestSha256&&
    receipt.archiveCount===staged.archiveCount&&
    receipt.verifiedSlots===staged.verifiedSlots&&
    receipt.unresolvedSlots===staged.unresolvedSlots,
    'SIGNED_RELAY_PUBLIC_RECEIPT_DRIFT');
  return {status:'PUBLIC_SIGNED_RELAY_COMMIT_READBACK_CONFIRMED',
    archiveCount:receipt.archiveCount,
    manifestSha256:receipt.manifestSha256,
    publicCommitSha:receipt.manifestCommitSha??null,
    privateCommitSha:approvedPrivateStageCommit,
    reused:receipt.reused,verifiedSlots:receipt.verifiedSlots,
    unresolvedSlots:receipt.unresolvedSlots};
}
