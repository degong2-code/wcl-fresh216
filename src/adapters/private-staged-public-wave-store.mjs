/**
 * Private signed stage -> public readback, using the existing ArchiveStore
 * persistWave() contract. The existing checkpoint resumes a pending Wave.
 * This adapter has NO WCL, public Git write, C append or new state format.
 */
import {createHash} from 'node:crypto';
import {persistPrivateSignedWaveStage}
  from './private-signed-evidence-git-store.mjs';
import {verifyActorProofWaveManifest,ACTOR_PROOF_ARCHIVE_MAX_BYTES}
  from '../core/fresh216-actor-proof-archive.mjs';

const need=(v,c)=>{if(!v)throw Error(c);};
const sha40=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
const sha64=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const encode=v=>JSON.stringify(v,null,2)+'\n';
const root='https://api.github.com/repos/degong2-code/wcl-fresh216/contents/';
const evidenceRef='fresh216-public-evidence-pilot-20261031';
const archivePath=id=>'evidence/fresh216/actor-proof/'+id+'.json';
const manifestPath=id=>'evidence/fresh216/waves/'+id+'.json';
const blobSha=bytes=>createHash('sha1')
  .update('blob '+bytes.length+'\0').update(bytes).digest('hex');

/**
 * GET-only. Missing manifest is pending; present manifest with a
 * missing/conflicting archive is an integrity failure, never a retry cue.
 */
export async function inspectPublishedSignedWaveReadOnly({
  archives,manifest,hmacKey,fetchImpl=fetch
}={}){
  need(Array.isArray(archives)&&archives.length>=1&&archives.length<=8&&
    manifest&&sha64(manifest.waveSha256)&&
    typeof fetchImpl==='function','STAGED_PUBLIC_READ_CONFIG_INVALID');
  const verified=verifyActorProofWaveManifest(manifest,{archives,hmacKey});
  const request=async(path,expected)=>{
    const bytes=Buffer.from(encode(expected),'utf8');
    need(bytes.length<=ACTOR_PROOF_ARCHIVE_MAX_BYTES,
      'STAGED_PUBLIC_FILE_TOO_LARGE');
    let result;
    try{
      result=await fetchImpl(root+path+'?ref='+evidenceRef,{
        method:'GET',headers:{Accept:'application/vnd.github+json',
          'X-GitHub-Api-Version':'2022-11-28'},
        redirect:'error',signal:AbortSignal.timeout(15000)
      });
    }catch{throw Error('STAGED_PUBLIC_GET_OUTCOME_UNKNOWN_STOP');}
    if(result?.status===404)return false;
    need(result?.status===200,'STAGED_PUBLIC_GET_FAILED_STOP');
    const response=await result.json().catch(()=>null);
    need(response?.encoding==='base64'&&
      typeof response.content==='string'&&
      typeof response.sha==='string'&&
      response.sha===blobSha(bytes)&&
      response.size===bytes.length,
      'STAGED_PUBLIC_GIT_BLOB_DRIFT');
    const remote=Buffer.from(response.content.replace(/\s+/g,''),'base64');
    need(remote.equals(bytes)&&blobSha(remote)===response.sha,
      'STAGED_PUBLIC_BYTE_MISMATCH');
    return true;
  };
  if(!(await request(manifestPath(manifest.waveSha256),manifest)))
    return null;
  const paths=archives.map(a=>{
    need(sha64(a?.archiveId),'STAGED_PUBLIC_ARCHIVE_ID_INVALID');
    return {path:archivePath(a.archiveId),archive:a};
  });
  need(new Set(paths.map(p=>p.path)).size===paths.length,
    'STAGED_PUBLIC_DUPLICATE_ARCHIVE');
  const found=await Promise.all(paths.map(p=>request(p.path,p.archive)));
  need(found.every(Boolean),'STAGED_PUBLIC_MANIFEST_INCOMPLETE_STOP');
  return {
    waveSha256:manifest.waveSha256,manifestSha256:manifest.manifestSha256,
    archiveCount:verified.archiveCount,
    verifiedSlots:verified.verifiedSlots,
    unresolvedSlots:verified.unresolvedSlots,
    manifestCommitSha:null,reused:true
  };
}

/**
 * Pre-stage requires exact owner authorization. Stage-only success is
 * not enough to unblock the existing Archive-to-C adapter.
 */
export function createPrivateStagedPublicWaveStore({
  repoRoot,hmacKey,getReportStateCommit,
  stageWriteApproved=false,cDeltaAdvanceApproved=false,publicFetch=fetch,
  stagePersist=persistPrivateSignedWaveStage
}={}){
  need(typeof repoRoot==='string'&&repoRoot.startsWith('/')&&
    typeof hmacKey==='string'&&Buffer.byteLength(hmacKey,'utf8')>=32&&
    typeof getReportStateCommit==='function'&&
    typeof publicFetch==='function'&&typeof stagePersist==='function',
    'STAGED_PUBLIC_STORE_CONFIG_INVALID');
  return {
    async persistWave(archives,{manifest,proofContext}={}){
      need(stageWriteApproved===true,
        'STAGED_PUBLIC_PRIVATE_STAGE_NOT_APPROVED');
      need(proofContext?.wave&&proofContext?.evidence&&
        typeof proofContext.attemptId==='string'&&
        proofContext.witness,
        'STAGED_PUBLIC_WITNESS_CONTEXT_REQUIRED');
      verifyActorProofWaveManifest(manifest,{archives,hmacKey});
      const stateCommit=await getReportStateCommit(proofContext);
      need(sha40(stateCommit),'STAGED_PUBLIC_REPORT_STATE_UNCONFIRMED');
      const staged=await stagePersist({
        repoRoot,archives,manifest,hmacKey,
        privateReportStateCommit:stateCommit
      });
      need(staged?.status==='PRIVATE_SIGNED_STAGE_REMOTE_CONFIRMED'&&
        sha40(staged.privateStageCommit)&&
        staged.waveSha256===manifest.waveSha256,
        'STAGED_PUBLIC_PRIVATE_STAGE_UNCONFIRMED');
      const published=await inspectPublishedSignedWaveReadOnly({
        archives,manifest,hmacKey,fetchImpl:publicFetch
      });
      if(!published)throw Error('PUBLIC_ACTOR_WAVE_WRITE_NOT_ATTEMPTED');
      // Actual C-delta persistence is independent of Stage/public approval.
      // Keep the existing checkpoint PENDING until this gate is separately
      // enabled; never imply C authorization from a public GET receipt.
      if(cDeltaAdvanceApproved!==true)
        throw Error('STAGED_PUBLIC_C_DELTA_NOT_APPROVED');
      return published;
    }
  };
}
