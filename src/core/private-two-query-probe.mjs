import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {makeTwoRequestComparisonPlan, fingerprintComparisonRequest,
  assessTwoRequestComparison} from './wcl-query-comparison.mjs';
import {decodeRankingsEnvelope} from '../adapters/wcl-rankings-envelope.mjs';
import {joinFightEvidence} from './evidence-join.mjs';

/**
 * One-time, private, deliberately narrow experiment executor.
 * Caller owns ALL external transport, authentication and target metadata.
 * NO automatic retry, third request, Sheet write or OAuth scope change.
 * The new directory is an irreversible replay barrier for this probe run.
 */
const numeric=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const validResponse=r=>r&&typeof r==='object'&&
  Number.isSafeInteger(r.httpStatus)&&r.httpStatus>=100&&r.httpStatus<=599;

function atomicPrivateJson(dir,name,value){
  const file=path.join(dir,name);
  const tmp=path.join(dir,'.'+name+'.'+randomUUID()+'.tmp');
  let fd;
  try{
    fd=fs.openSync(tmp,'wx',0o600);
    fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');
    fs.fsyncSync(fd);fs.closeSync(fd);fd=null;
    fs.renameSync(tmp,file);
    // On Windows, directory fsync is not always supported.
    try{
      const d=fs.openSync(dir,'r');
      try{fs.fsyncSync(d);}finally{fs.closeSync(d);}
    }catch(e){if(process.platform!=='win32')throw e;}
  }finally{
    if(fd!==undefined&&fd!==null)fs.closeSync(fd);
    if(fs.existsSync(tmp))fs.unlinkSync(tmp);
  }
}
const rateOf=body=>body?.data?.rateLimitData??null;
const totalCost=rate=>{
  const n=rate?.currentRequest?.total;
  return numeric(n)?n:null;
};
const headroom=rate=>{
  if(!numeric(rate?.limitPerHour)||!numeric(rate?.pointsSpentThisHour))
    return null;
  return Math.max(0,rate.limitPerHour-rate.pointsSpentThisHour);
};
const revisionOf=body=>{
  const n=body?.data?.reportData?.report?.revision;
  return Number.isSafeInteger(n)&&n>=0?n:null;
};
const rowOf=(request,response,elapsedMs,authFlow)=>{
  const rate=rateOf(response?.body);
  return {
    kind:request.kind,
    requestFingerprint:fingerprintComparisonRequest(request),
    authFlow,httpStatus:response?.httpStatus??null,
    graphqlErrors:response?.body?.errors==null?false:
      Array.isArray(response.body.errors)?response.body.errors.length>0:null,
    reportRevision:revisionOf(response?.body),
    elapsedMs,reportedTotalPoints:totalCost(rate),
    categoryWitness:'UNAVAILABLE',
    categoryCosts:{application:null,database:null,user:null}
  };
};
const asStatus=(e)=>e?.code==='ETIMEDOUT'?'TIMED_OUT':'UNKNOWN_TRANSPORT_OR_IO';

export function validatePrivateProbeGroup(group){
  if(!group||typeof group!=='object'||
    typeof group.scopeKey!=='string'||!group.scopeKey||
    !Number.isSafeInteger(group.reportRevision)||group.reportRevision<0||
    !Array.isArray(group.slots)||group.slots.length!==1)
    throw Error('PRIVATE_PROBE_FIXTURE_INVALID');
  const s=group.slots[0];
  if(!s||typeof s.jobKey!=='string'||!s.jobKey||
     !Number.isSafeInteger(s.rank)||s.rank<1||s.rank>100||
     typeof s.snapshotSha!=='string'||!/^[a-f0-9]{64}$/i.test(s.snapshotSha)||
     !numeric(s.totalDps)||s.totalDps<=0||
     typeof s.className!=='string'||!s.className||
     typeof s.specName!=='string'||!s.specName)
    throw Error('PRIVATE_PROBE_SLOT_INVALID');
  // The shared query planner validates report/fight/encounter/difficulty.
  const plan=makeTwoRequestComparisonPlan(group);
  if(plan.requests.length!==2)throw Error('PRIVATE_PROBE_QUERY_COUNT_INVALID');
  return plan;
}

/**
 * Returns a SANITIZED summary, not raw WCL results. Raw responses stay
 * exclusively in the caller-chosen private directory (not public Git).
 * A crash/timeout leaves journal IN_FLIGHT, and the directory cannot be
 * reused: no accidental replay of a potentially billed request.
 */
export async function runPrivateTwoQueryProbe({
  group,privateOutputDir,send,authFlow='CLIENT_CREDENTIALS',
  minAppHeadroom=100,clock=Date.now
}={}){
  if(typeof privateOutputDir!=='string'||!path.isAbsolute(privateOutputDir)||
    typeof send!=='function'||typeof clock!=='function'||
    authFlow!=='CLIENT_CREDENTIALS'||!numeric(minAppHeadroom)||
    minAppHeadroom<1)
    throw Error('PRIVATE_PROBE_CONFIG_INVALID');
  const plan=validatePrivateProbeGroup(group);
  // A private newly-created output folder is the one-shot no-retry gate.
  fs.mkdirSync(privateOutputDir,{recursive:false,mode:0o700});
  const journal={schema:1,mode:'ONE_TIME_TWO_QUERY_EXPERIMENT',
    status:'PREPARED',transportCalls:0,queryLimit:2,
    completion:'NONE',reviewRequired:false,
    comparisonScope:{
      reportCode:group.reportCode,fightID:group.fightId,
      reportRevision:group.reportRevision,
      snapshotSha:group.slots[0].snapshotSha
    },
    observations:[]};
  atomicPrivateJson(privateOutputDir,'journal.json',journal);
  for(let i=0;i<2;i++){
    const request=plan.requests[i];
    // Write a paid-attempt marker before dispatch; disk uncertainty is
    // fail-closed. Do not retry an interrupted operation.
    journal.status='IN_FLIGHT';
    journal.transportCalls=i+1;
    journal.lastRequestKind=request.kind;
    journal.lastRequestFingerprint=fingerprintComparisonRequest(request);
    journal.startedAtMs=clock();
    atomicPrivateJson(privateOutputDir,'journal.json',journal);

    let response=null,transportError=false;
    try{
      response=await send(request.query);
      if(!validResponse(response))transportError=true;
    }catch(e){transportError=true;}
    const finishedAtMs=clock();
    const elapsedMs=typeof journal.startedAtMs==='number'?
      Math.max(0,finishedAtMs-journal.startedAtMs):null;
    if(transportError){
      journal.status='NEEDS_REVIEW';journal.reviewRequired=true;
      journal.failure='UNCERTAIN_TRANSPORT_MAY_HAVE_SPENT_POINTS';
      atomicPrivateJson(privateOutputDir,'journal.json',journal);
      break;
    }
    // Raw response is captured in a PRIVATE file before the completion
    // marker. If that write fails, journal remains IN_FLIGHT and must be
    // inspected manually. No automatic retry.
    atomicPrivateJson(privateOutputDir,'response-'+(i+1)+'.json',
      {requestKind:request.kind,body:response.body,httpStatus:response.httpStatus});
    const observation=rowOf(request,response,elapsedMs,authFlow);
    observation.startedAtMs=journal.startedAtMs;
    observation.finishedAtMs=finishedAtMs;
    journal.observations.push(observation);
    const rate=rateOf(response.body);
    const original= response.body?.data?.reportData?.report;
    let reason=null;
    if(response.httpStatus!==200||observation.graphqlErrors!==false)
      reason='HTTP_OR_GRAPHQL_ERROR';
    else if(original?.code!==group.reportCode||
      original?.revision!==group.reportRevision)
      reason='REPORT_REVISION_OR_CODE_CHANGED';
    else if(i===0){
      const decoded=decodeRankingsEnvelope(group,response.httpStatus,response.body);
      if(decoded.status!=='OK')reason='RANKINGS_ENVELOPE_UNVERIFIED';
      else {
        const joined=joinFightEvidence(group,decoded.report);
        if(joined.verified.length!==1||joined.unresolved.length!==0)
          reason='RANKED_ACTOR_BOSSDPS_UNVERIFIED';
      }
      if(!reason&&totalCost(rate)===null)
        reason='POINT_COST_UNWITNESSED_STOP_BEFORE_TABLE';
      if(!reason&&(headroom(rate)===null||
        headroom(rate)<minAppHeadroom))
        reason='APP_HEADROOM_UNWITNESSED_OR_LOW';
    }else if(!original||original.damage==null){
      reason='TABLE_DAMAGE_SHAPE_UNVERIFIED';
    }
    journal.status=reason?'NEEDS_REVIEW':'COMPLETED_QUERY';
    journal.reviewRequired=Boolean(reason);
    journal.failure=reason;
    journal.completion=i===0?'RANKINGS_OBSERVED':'BOTH_QUERIES_OBSERVED';
    journal.remainingAppPointsObserved=headroom(rate);
    journal.lastRequestKind=null;
    journal.lastRequestFingerprint=null;
    journal.startedAtMs=null;
    atomicPrivateJson(privateOutputDir,'journal.json',journal);
    if(reason)break;
  }
  const assessment=assessTwoRequestComparison(plan,journal.observations);
  const summary={
    mode:'PRIVATE_ONE_TIME_PROBE_SUMMARY',
    transportCalls:journal.transportCalls,
    status:journal.status,
    failure:journal.failure??null,
    reviewRequired:journal.reviewRequired,
    assessment,
    exactBossDpsEquivalenceProven:false,
    tableAdopted:false,
    noAutomaticRetry:true
  };
  atomicPrivateJson(privateOutputDir,'summary.json',summary);
  return summary;
}
