/**
 * Append-only GitHub Contents adapter for redacted actor-proof archives.
 * No raw WCL bodies or identifiers are accepted; no update/overwrite path
 * exists. A timeout or uncertain PUT is terminal for the current operation.
 */
import {
  verifyActorProofArchive,buildActorProofWaveManifest,
  verifyActorProofWaveManifest,ACTOR_PROOF_ARCHIVE_MAX_BYTES
} from '../core/fresh216-actor-proof-archive.mjs';
import {PILOT_JOURNAL} from './fresh216-public-pilot-journal.mjs';

const need=(v,c)=>{if(!v)throw Error(c);};
const commitSha=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
const archivePath=id=>{
  need(typeof id==='string'&&/^[a-f0-9]{64}$/.test(id),
    'PUBLIC_ACTOR_ARCHIVE_ID_INVALID');
  return 'evidence/fresh216/actor-proof/'+id+'.json';
};
const wavePath=sha=>{
  need(typeof sha==='string'&&/^[a-f0-9]{64}$/.test(sha),
    'PUBLIC_ACTOR_WAVE_SHA_INVALID');
  return 'evidence/fresh216/waves/'+sha+'.json';
};
const apiPath=p=>'https://api.github.com/repos/'+PILOT_JOURNAL.repo+
  '/contents/'+p;
const readUrl=p=>apiPath(p)+'?ref='+encodeURIComponent(PILOT_JOURNAL.branch);

export function createPublicActorProofArchiveStore({
  token,hmacKey,fetchImpl=fetch
}={}){
  need(typeof token==='string'&&token.length>20&&
    typeof fetchImpl==='function','PUBLIC_ACTOR_ARCHIVE_STORE_CONFIG');
  // Fail before any GitHub network call if the dedicated key is missing.
  verifyActorProofArchiveKey(hmacKey);
  const headers={
    Authorization:'Bearer '+token,
    Accept:'application/vnd.github+json',
    'X-GitHub-Api-Version':'2022-11-28',
    'Content-Type':'application/json'
  };
  async function http(url,init={}){
    try{
      return await fetchImpl(url,{
        ...init,headers,redirect:'error',signal:AbortSignal.timeout(15000)
      });
    }catch{
      throw Error('PUBLIC_ACTOR_ARCHIVE_GITHUB_OUTCOME_UNKNOWN_STOP');
    }
  }
  async function read(p){
    const res=await http(readUrl(p));
    if(res.status===404)return null;
    need(res.status===200,'PUBLIC_ACTOR_ARCHIVE_GITHUB_READ_DENIED');
    const v=await res.json().catch(()=>null);
    need(v&&typeof v.sha==='string'&&v.encoding==='base64'&&
      typeof v.content==='string','PUBLIC_ACTOR_ARCHIVE_READBACK_SHAPE');
    let data;
    try{data=JSON.parse(Buffer.from(v.content,'base64').toString('utf8'));}
    catch{throw Error('PUBLIC_ACTOR_ARCHIVE_READBACK_CORRUPT');}
    return {blobSha:v.sha,data};
  }
  async function writeCreateOnly(p,data,message){
    // No overwrite path. A timeout or non-201 response is terminal.
    need((await read(p))===null,'PUBLIC_ACTOR_ARCHIVE_ALREADY_EXISTS_STOP');
    const content=JSON.stringify(data,null,2)+'\n';
    need(Buffer.byteLength(content,'utf8')<=ACTOR_PROOF_ARCHIVE_MAX_BYTES,
      'PUBLIC_ACTOR_ARCHIVE_SIZE_LIMIT');
    let response;
    try{
      response=await http(apiPath(p),{
        method:'PUT',
        body:JSON.stringify({
          branch:PILOT_JOURNAL.branch,message,
          content:Buffer.from(content,'utf8').toString('base64')
        })
      });
    }catch{
      throw Error('PUBLIC_ACTOR_ARCHIVE_GITHUB_OUTCOME_UNKNOWN_STOP');
    }
    need(response.status===201,'PUBLIC_ACTOR_ARCHIVE_WRITE_UNCONFIRMED_STOP');
    const receipt=await response.json().catch(()=>null);
    need(commitSha(receipt?.commit?.sha)&&
      typeof receipt?.content?.sha==='string',
      'PUBLIC_ACTOR_ARCHIVE_COMMIT_UNCONFIRMED_STOP');
    const back=await read(p);
    need(back&&back.blobSha===receipt.content.sha&&
      JSON.stringify(back.data)===JSON.stringify(data),
      'PUBLIC_ACTOR_ARCHIVE_READBACK_MISMATCH_STOP');
    return {path:p,commitSha:receipt.commit.sha,blobSha:back.blobSha,data:back.data};
  }
  async function persist(archive){
    verifyActorProofArchive(archive,{hmacKey});
    const p=archivePath(archive.archiveId);
    const saved=await writeCreateOnly(p,archive,
      'fresh216: append redacted actor proof archive '+archive.archiveId.slice(0,12));
    const v=verifyActorProofArchive(saved.data,{hmacKey});
    return {
      archiveId:archive.archiveId,path:p,commitSha:saved.commitSha,
      blobSha:saved.blobSha,verifiedSlots:v.verifiedSlots,
      unresolvedSlots:v.unresolvedSlots
    };
  }
  async function persistWave(archives,{createdAtMs=Date.now()}={}){
    // One Git Data commit makes all missing fight archives + the manifest
    // visible atomically. Existing exact objects are reused after HMAC and
    // byte-equivalent JSON verification; conflicting objects fail closed.
    const manifest=buildActorProofWaveManifest({
      archives,hmacKey,createdAtMs
    });
    const ordered=archives.slice().sort((a,b)=>
      a.archiveId.localeCompare(b.archiveId));
    const manifestFile={path:wavePath(manifest.waveSha256),data:manifest};
    const archiveFiles=ordered.map(archive=>({
      path:archivePath(archive.archiveId),data:archive
    }));
    const allFiles=[...archiveFiles,manifestFile];
    const existing=new Map();
    for(const file of allFiles){
      const back=await read(file.path);
      if(!back)continue;
      if(file.path===manifestFile.path){
        verifyActorProofWaveManifest(back.data,{hmacKey,archives:ordered});
      }else{
        verifyActorProofArchive(back.data,{hmacKey});
      }
      need(JSON.stringify(back.data)===JSON.stringify(file.data),
        'PUBLIC_ACTOR_WAVE_EXISTING_OBJECT_CONFLICT_STOP');
      existing.set(file.path,back);
    }
    if(existing.has(manifestFile.path)){
      need(archiveFiles.every(x=>existing.has(x.path)),
        'PUBLIC_ACTOR_WAVE_MANIFEST_WITH_MISSING_ARCHIVE_STOP');
      return summarizeWave(existing,archiveFiles,manifestFile,null,true,existing);
    }
    const missing=allFiles.filter(x=>!existing.has(x.path));
    const contents=missing.map(file=>{
      const text=JSON.stringify(file.data,null,2)+'\n';
      need(Buffer.byteLength(text,'utf8')<=ACTOR_PROOF_ARCHIVE_MAX_BYTES,
        'PUBLIC_ACTOR_ARCHIVE_SIZE_LIMIT');
      return {path:file.path,mode:'100644',type:'blob',content:text};
    });
    let commitShaWritten=null,refUpdateAttempted=false;
    try{
      const refUrl='https://api.github.com/repos/'+PILOT_JOURNAL.repo+
        '/git/ref/heads/'+PILOT_JOURNAL.branch;
      const refResponse=await http(refUrl);
      need(refResponse.status===200,'PUBLIC_ACTOR_WAVE_REF_READ_FAILED');
      const refData=await refResponse.json().catch(()=>null);
      const parentSha=refData?.object?.sha;
      need(commitSha(parentSha),'PUBLIC_ACTOR_WAVE_REF_SHAPE');
      const parentResponse=await http(
        'https://api.github.com/repos/'+PILOT_JOURNAL.repo+
        '/git/commits/'+parentSha
      );
      need(parentResponse.status===200,'PUBLIC_ACTOR_WAVE_PARENT_READ_FAILED');
      const parentData=await parentResponse.json().catch(()=>null);
      const baseTreeSha=parentData?.tree?.sha;
      need(commitSha(baseTreeSha),'PUBLIC_ACTOR_WAVE_PARENT_TREE_SHAPE');
      const treeResponse=await http(
        'https://api.github.com/repos/'+PILOT_JOURNAL.repo+'/git/trees',
        {method:'POST',body:JSON.stringify({
          base_tree:baseTreeSha,tree:contents
        })}
      );
      need(treeResponse.status===201,'PUBLIC_ACTOR_WAVE_TREE_CREATE_FAILED');
      const treeData=await treeResponse.json().catch(()=>null);
      need(commitSha(treeData?.sha),'PUBLIC_ACTOR_WAVE_TREE_SHAPE');
      const commitResponse=await http(
        'https://api.github.com/repos/'+PILOT_JOURNAL.repo+'/git/commits',
        {method:'POST',body:JSON.stringify({
          message:'fresh216: atomically append actor proof wave '+
            manifest.waveSha256.slice(0,12),
          tree:treeData.sha,parents:[parentSha]
        })}
      );
      need(commitResponse.status===201,
        'PUBLIC_ACTOR_WAVE_COMMIT_CREATE_FAILED');
      const commitData=await commitResponse.json().catch(()=>null);
      need(commitSha(commitData?.sha),'PUBLIC_ACTOR_WAVE_COMMIT_SHAPE');
      commitShaWritten=commitData.sha;
      refUpdateAttempted=true;
      await http(
        'https://api.github.com/repos/'+PILOT_JOURNAL.repo+
        '/git/refs/heads/'+PILOT_JOURNAL.branch,
        {method:'PATCH',body:JSON.stringify({
          sha:commitShaWritten,force:false
        })}
      ).then(async response=>{
        if(response.status!==200){
          // A concurrent update or an uncertain ref response is reconciled
          // only by exact readback below. Never force or blindly retry.
          commitShaWritten=null;
        }
      }).catch(()=>{
        // Ref outcome may be unknown. Exact readback below decides.
        commitShaWritten=null;
      });
    }catch(_error){
      // Pre-ref failures are safe to report; a ref timeout is reconciled by
      // reading every deterministic path below. No second write is attempted.
      commitShaWritten=null;
    }
    const readbacks=new Map();
    for(const file of allFiles){
      const back=await read(file.path);
      if(!back)continue;
      if(file.path===manifestFile.path){
        verifyActorProofWaveManifest(back.data,{hmacKey,archives:ordered});
      }else verifyActorProofArchive(back.data,{hmacKey});
      need(JSON.stringify(back.data)===JSON.stringify(file.data),
        'PUBLIC_ACTOR_WAVE_READBACK_MISMATCH_STOP');
      readbacks.set(file.path,back);
    }
    if(!allFiles.every(x=>readbacks.has(x.path))){
      throw Error(refUpdateAttempted?
        'PUBLIC_ACTOR_WAVE_COMMIT_UNCONFIRMED_STOP':
        'PUBLIC_ACTOR_WAVE_WRITE_NOT_ATTEMPTED');
    }
    return summarizeWave(readbacks,archiveFiles,manifestFile,
      commitShaWritten,false,existing);
  }
  function summarizeWave(readbacks,archiveFiles,manifestFile,
    publishedCommitSha,reused,existing=new Map()){
    const archiveReceipts=archiveFiles.map(file=>{
      const back=readbacks.get(file.path);
      const v=verifyActorProofArchive(back.data,{hmacKey});
      return {archiveId:file.data.archiveId,path:file.path,
        commitSha:publishedCommitSha,blobSha:back.blobSha,
        reused:reused||existing.has(file.path),
        verifiedSlots:v.verifiedSlots,
        unresolvedSlots:v.unresolvedSlots};
    });
    const verified=verifyActorProofWaveManifest(
      readbacks.get(manifestFile.path).data,{
        hmacKey,archives:archiveFiles.map(x=>x.data)
      }
    );
    return {
      waveSha256:manifestFile.data.waveSha256,
      manifestSha256:manifestFile.data.manifestSha256,
      manifestPath:manifestFile.path,
      manifestCommitSha:publishedCommitSha,
      manifestBlobSha:readbacks.get(manifestFile.path).blobSha,
      archiveReceipts,archiveCount:verified.archiveCount,
      verifiedSlots:verified.verifiedSlots,
      unresolvedSlots:verified.unresolvedSlots,
      reused:reused||existing.has(manifestFile.path),
      reconciled:!reused&&!publishedCommitSha
    };
  }
  return {
    pathForArchive:archivePath,pathForWave:wavePath,
    persist,persistWave
  };
}
function verifyActorProofArchiveKey(key){
  // Fail before any GitHub network call; the key is separate from WCL OAuth.
  const probe=Buffer.isBuffer(key)?key:Buffer.from(String(key??''),'utf8');
  need(probe.length>=32,'ACTOR_ARCHIVE_HMAC_KEY_TOO_SHORT');
}
