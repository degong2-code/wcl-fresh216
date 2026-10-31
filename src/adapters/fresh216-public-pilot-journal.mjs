/**
 * Fresh216: one-shot public journal for a WCL wave and actor-proof manifest.
 * Raw report/actor identifiers are stored only in the separate HMAC archive.
 * Reserve IN_FLIGHT and verify GitHub readback BEFORE OAuth.
 * Any uncertain write or readback stops the operation; never retry WCL.
 */
import {createHash} from 'node:crypto';

export const PILOT_JOURNAL=Object.freeze({
  repo:'degong2-code/wcl-fresh216',
  branch:'fresh216-public-evidence-pilot-20261031',
  path:'evidence/fresh216/pilot-20261031.json',
  trustedRef:'refs/heads/work/fresh216-autonomous-host-20261031'
});
const isSha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const isCommit=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
const check=(v,code)=>{if(!v)throw Error(code);};
const API='https://api.github.com/repos/'+PILOT_JOURNAL.repo+'/contents/'+
 PILOT_JOURNAL.path+'?ref='+encodeURIComponent(PILOT_JOURNAL.branch);
const WRITE='https://api.github.com/repos/'+PILOT_JOURNAL.repo+'/contents/'+
 PILOT_JOURNAL.path;
const mandatoryKeys=[
 'httpStatus','observedPoints','requestBodySha256','responseBodySha256',
 'fightGroups','candidateVerifiedSlots','verifiedSlots','unresolvedSlots',
 'archiveCount','archiveManifestSha256','incident'
];
const INCIDENTS=[
 'HTTP_OR_GRAPHQL_UNCERTAIN','WAVE_REPORT_IDENTITY_DRIFT',
 'WAVE_RANKINGS_SHAPE_INVALID','WAVE_TRANSPORT_OR_PROCESSING_EXCEPTION',
 'RESPONSE_NOT_PERSISTABLE','WCL_POINTS_UNOBSERVED',
 'RAW_RESPONSE_BYTES_UNAVAILABLE','ACTOR_ARCHIVE_BUILD_OR_STORE_FAILED',
 'ACTOR_ARCHIVE_READBACK_COUNT_DRIFT'
];
const resultCheck=s=>{
  check(s&&typeof s==='object'&&!Array.isArray(s)&&
   Object.keys(s).sort().join('|')===mandatoryKeys.slice().sort().join('|'),
   'PUBLIC_PILOT_RESULT_FIELDS');
  check((s.httpStatus===null||Number.isInteger(s.httpStatus)&&s.httpStatus>=100&&s.httpStatus<=599)&&
   (s.observedPoints===null||typeof s.observedPoints==='number'&&
     Number.isFinite(s.observedPoints)&&s.observedPoints>=0)&&
   isSha(s.requestBodySha256)&&
   (s.responseBodySha256===null||isSha(s.responseBodySha256))&&
   Number.isSafeInteger(s.fightGroups)&&s.fightGroups>=0&&s.fightGroups<=4&&
   Number.isSafeInteger(s.candidateVerifiedSlots)&&s.candidateVerifiedSlots>=0&&
   Number.isSafeInteger(s.verifiedSlots)&&s.verifiedSlots>=0&&
   Number.isSafeInteger(s.unresolvedSlots)&&s.unresolvedSlots>=0&&
   Number.isSafeInteger(s.archiveCount)&&s.archiveCount>=0&&
   s.archiveCount<=s.fightGroups&&
   (s.archiveManifestSha256===null||isSha(s.archiveManifestSha256))&&
   (s.incident===null||INCIDENTS.includes(s.incident)),
   'PUBLIC_PILOT_RESULT_SHAPE');
  if(s.incident===null){
    check(s.httpStatus===200&&s.observedPoints!==null&&
      s.responseBodySha256!==null&&s.archiveCount===s.fightGroups&&
      isSha(s.archiveManifestSha256)&&
      s.verifiedSlots+s.unresolvedSlots>=1&&
      s.verifiedSlots<=s.candidateVerifiedSlots,
      'PUBLIC_PILOT_COMPLETION_PROOF_MISSING');
  }
  return structuredClone(s);
};
/** Caller MUST pass the exact protected-branch env (not PR/fork). */
export function makePilotReservation({env,waveSha256,sourceSha256,nowMs}={}){
  check(env?.GITHUB_ACTIONS==='true'&&env?.GITHUB_EVENT_NAME==='push'&&
   env?.GITHUB_REPOSITORY===PILOT_JOURNAL.repo&&
   env?.GITHUB_REF===PILOT_JOURNAL.trustedRef&&
   isCommit(env.GITHUB_SHA)&&
   /^[0-9]+$/.test(env.GITHUB_RUN_ID??'')&&
   isSha(waveSha256)&&isSha(sourceSha256)&&
   Number.isSafeInteger(nowMs)&&nowMs>0,
   'PUBLIC_PILOT_UNTRUSTED_CONTEXT');
  return {
    schema:1,kind:'FRESH216_SINGLE_WAVE_PUBLIC_PILOT',
    status:'IN_FLIGHT',runSha:env.GITHUB_SHA,
    runId:env.GITHUB_RUN_ID,sourceSha256,waveSha256,
    maxGraphql:1,maxFights:4,reservedAtMs:nowMs,
    result:null
  };
}
/** GitHub Contents API read/write with optimistic SHA locking and readback. */
export function createPublicPilotJournal({token,fetchImpl=fetch}={}){
  check(typeof token==='string'&&token.length>20&&
    typeof fetchImpl==='function','PUBLIC_PILOT_JOURNAL_CONFIG');
  const headers={
    Authorization:'Bearer '+token,
    Accept:'application/vnd.github+json',
    'X-GitHub-Api-Version':'2022-11-28',
    'Content-Type':'application/json'
  };
  async function http(url,init={}){
    try{return await fetchImpl(url,{
      ...init,headers,redirect:'error',signal:AbortSignal.timeout(15000)
    });}catch{throw Error('PUBLIC_PILOT_GITHUB_OUTCOME_UNKNOWN_STOP');}
  }
  async function read(){
    const res=await http(API);
    if(res.status===404)return null;
    check(res.status===200,'PUBLIC_PILOT_GITHUB_READ_DENIED');
    const v=await res.json().catch(()=>null);
    check(v&&typeof v.sha==='string'&&v.encoding==='base64'&&
      typeof v.content==='string','PUBLIC_PILOT_READBACK_SHAPE');
    let data;
    try{data=JSON.parse(Buffer.from(v.content,'base64').toString('utf8'));}
    catch{throw Error('PUBLIC_PILOT_READBACK_CORRUPT');}
    return {blobSha:v.sha,data};
  }
  async function put(data,message,blobSha=null){
    const payload={branch:PILOT_JOURNAL.branch,message,
      content:Buffer.from(JSON.stringify(data,null,2)+'\n').toString('base64')};
    if(blobSha!==null)payload.sha=blobSha;
    const res=await http(WRITE,{method:'PUT',body:JSON.stringify(payload)});
    check(res.status===(blobSha===null?201:200),
      'PUBLIC_PILOT_GITHUB_WRITE_UNCONFIRMED_STOP');
    const v=await res.json().catch(()=>null);
    check(isCommit(v?.commit?.sha)&&typeof v?.content?.sha==='string',
      'PUBLIC_PILOT_GITHUB_COMMIT_UNCONFIRMED_STOP');
    const back=await read();
    check(back&&back.blobSha===v.content.sha&&
      JSON.stringify(back.data)===JSON.stringify(data),
      'PUBLIC_PILOT_READBACK_MISMATCH_STOP');
    return {blobSha:back.blobSha,commitSha:v.commit.sha,data};
  }
  return {
    read,
    async reserve(reservation){
      check(reservation?.schema===1&&
        reservation.status==='IN_FLIGHT'&&reservation.result===null&&
        reservation.maxGraphql===1&&reservation.maxFights===4&&
        isSha(reservation.waveSha256)&&isSha(reservation.sourceSha256)&&
        isCommit(reservation.runSha),
        'PUBLIC_PILOT_RESERVATION_INVALID');
      // 404, then a create-only PUT. Even concurrent executions cannot
      // overwrite an existing reservation. A 422 is terminal.
      check((await read())===null,'PUBLIC_PILOT_ALREADY_RESERVED_STOP');
      return put(reservation,'fresh216: reserve one-wave IN_FLIGHT before OAuth');
    },
    async seal(reserved,summary){
      check(reserved?.data?.status==='IN_FLIGHT'&&
       typeof reserved.blobSha==='string'&&
       isCommit(reserved.commitSha),
       'PUBLIC_PILOT_NO_VERIFIED_RESERVATION');
      const result=resultCheck(summary);
      const complete=result.incident===null;
      const final={...reserved.data,status:complete?'COMPLETED':'NEEDS_REVIEW',
        result};
      // No retry: a write/readback error leaves the durable IN_FLIGHT marker.
      return put(final,'fresh216: seal one-wave actor-proof archive observation',
        reserved.blobSha);
    }
  };
}
