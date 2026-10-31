/**
 * Append-only GitHub Contents adapter for redacted actor-proof archives.
 * No raw WCL bodies or identifiers are accepted; no update/overwrite path
 * exists. A timeout or uncertain PUT is terminal for the current operation.
 */
import {
  verifyActorProofArchive,ACTOR_PROOF_ARCHIVE_MAX_BYTES
} from '../core/fresh216-actor-proof-archive.mjs';
import {PILOT_JOURNAL} from './fresh216-public-pilot-journal.mjs';

const need=(v,c)=>{if(!v)throw Error(c);};
const commitSha=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
const archivePath=id=>{
  need(typeof id==='string'&&/^[a-f0-9]{64}$/.test(id),
    'PUBLIC_ACTOR_ARCHIVE_ID_INVALID');
  return 'evidence/fresh216/actor-proof/'+id+'.json';
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
  return {
    pathForArchive:archivePath,
    async persist(archive){
      const verified=verifyActorProofArchive(archive,{hmacKey});
      const p=archivePath(archive.archiveId);
      need(Buffer.byteLength(JSON.stringify(archive),'utf8')<=
        ACTOR_PROOF_ARCHIVE_MAX_BYTES,'PUBLIC_ACTOR_ARCHIVE_SIZE_LIMIT');
      // A pre-existing path is never overwritten, even if content looks equal.
      need((await read(p))===null,'PUBLIC_ACTOR_ARCHIVE_ALREADY_EXISTS_STOP');
      const content=JSON.stringify(archive,null,2)+'\n';
      let response;
      try{
        response=await http(apiPath(p),{
          method:'PUT',
          body:JSON.stringify({
            branch:PILOT_JOURNAL.branch,
            message:'fresh216: append redacted actor proof archive '+archive.archiveId.slice(0,12),
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
        JSON.stringify(back.data)===JSON.stringify(archive),
        'PUBLIC_ACTOR_ARCHIVE_READBACK_MISMATCH_STOP');
      const reverified=verifyActorProofArchive(back.data,{hmacKey});
      return {
        archiveId:archive.archiveId,path:p,
        commitSha:receipt.commit.sha,blobSha:back.blobSha,
        verifiedSlots:reverified.verifiedSlots,
        unresolvedSlots:reverified.unresolvedSlots
      };
    }
  };
}
function verifyActorProofArchiveKey(key){
  // Delegate minimum key-size validation without touching GitHub.
  const probe=Buffer.isBuffer(key)?key:Buffer.from(String(key??''),'utf8');
  need(probe.length>=32,'ACTOR_ARCHIVE_HMAC_KEY_TOO_SHORT');
}
