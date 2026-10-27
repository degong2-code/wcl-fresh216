/**
 * Fresh WCL two-query probe: NO legacy EXACT-100 snapshot, rank slot,
 * revision fingerprint or historic data required.
 *
 * A currently PUBLIC WCL report code and its FightID are selected from the
 * WCL public website. Only two paid GraphQL operations may occur:
 *   #1 rankings(dps)+rankings(bossdps) -> live reference actor/format
 *   #2 table(DamageDone, Source) for the SAME report/fight
 *
 * This module has NO HTTP client and does not select the public report.
 * Caller must pre-reserve the ONE-TIME GitHub ref before any WCL operations.
 * It neither claims EXACT-100 parity nor writes any Sheet.
 */
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';

const validCode=v=>typeof v==='string'&&v.length>0&&v.length<=128&&
  /^[\x21-\x7e]+$/.test(v);
const positiveInt=v=>Number.isSafeInteger(v)&&v>0;
const nonNegative=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const fieldRate='rateLimitData{currentRequest limitPerHour pointsSpentThisHour pointsResetIn databaseLimitPerHour databasePointsSpentThisHour userHasRemainingPoints userPointsResetIn}';
const makeQuery=(root)=>'query FreshLiveComparison($code:String!,$fightID:Int!){ '+
  fieldRate+' reportData{report(code:$code){code revision '+root+'}}}';

export function buildFreshQueryPair(target) {
  if(!target||!validCode(target.reportCode)||!positiveInt(target.fightId)||
     Object.keys(target).some(k=>!['reportCode','fightId'].includes(k)))
    throw Error('FRESH_PUBLIC_REPORT_TARGET_INVALID');
  const variables={code:target.reportCode,fightID:target.fightId};
  return [
    {kind:'SAME_FIGHT_RANKINGS_DPS_BOSSDPS',query:makeQuery(
      'overall:rankings(fightIDs:[$fightID],playerMetric:dps) '+
      'boss:rankings(fightIDs:[$fightID],playerMetric:bossdps)'),
     variables},
    {kind:'SAME_FIGHT_DAMAGE_DONE_TABLE',query:makeQuery(
      'damage:table(fightIDs:[$fightID],dataType:DamageDone,viewBy:Source,translate:false)'),
     variables}
  ];
}
const digest=q=>createHash('sha256').update(JSON.stringify(q)).digest('hex');
const fightOf=(ranking, fightId)=>{
  // The query is scoped to exactly ONE Fight. An extra/unexpected Fight
  // is an API contract deviation, not a second candidate to ignore.
  if(!Array.isArray(ranking?.data)||ranking.data.length!==1)return null;
  const fight=ranking.data[0];
  if(fight?.fightID!==fightId)return null;
  if(!positiveInt(fight.encounter?.id)||!positiveInt(fight.difficulty)||
    !Array.isArray(fight.roles?.dps?.characters))return null;
  return fight;
};
const actorId=a=>positiveInt(a?.id)?a.id:null;
/**
 * Reference extracted LIVE from rankings #1, not the historical global
 * top-100. This independently establishes which actors this report lists
 * for this fight, but NOT a top-100 ranking position or table equivalence.
 */
export function summarizeFreshRankings(target,body) {
  const report=body?.data?.reportData?.report;
  if(report?.code!==target.reportCode||
     !Number.isSafeInteger(report?.revision)||report.revision<0)
    return {ok:false,reason:'FRESH_REPORT_OR_REVISION_INVALID'};
  const all=fightOf(report.overall,target.fightId);
  const boss=fightOf(report.boss,target.fightId);
  if(!all||!boss||all.encounter.id!==boss.encounter.id||
     all.difficulty!==boss.difficulty)
    return {ok:false,reason:'FRESH_FIGHT_SCOPE_UNVERIFIED'};
  const totals=new Map(),bosses=new Map();
  for(const a of all.roles.dps.characters){
    const id=actorId(a);
    if(!id||totals.has(id)||!nonNegative(a.amount)||a.amount<=0||
       !a.class||!a.spec)
      return {ok:false,reason:'FRESH_ACTOR_ROSTER_UNVERIFIED'};
    totals.set(id,a);
  }
  for(const a of boss.roles.dps.characters){
    const id=actorId(a);
    if(!id||bosses.has(id)||!nonNegative(a.amount)||!a.class||!a.spec)
      return {ok:false,reason:'FRESH_BOSS_ROSTER_UNVERIFIED'};
    bosses.set(id,a);
  }
  let verifiedActors=0;
  for(const [id,a] of totals) {
    const b=bosses.get(id);
    if(!b)continue;
    // An ID shared across rankings must have the SAME class/spec and
    // physically consistent DPS. One valid actor does not excuse an
    // inconsistent second actor; stop before the paid table request.
    if(a.class!==b.class||a.spec!==b.spec||b.amount>a.amount)
      return {ok:false,reason:'FRESH_ACTOR_METRIC_CONFLICT'};
    verifiedActors++;
  }
  if(verifiedActors===0)
    return {ok:false,reason:'FRESH_NO_MATCHED_DPS_ACTORS'};
  return {ok:true,revision:report.revision,
    encounterId:all.encounter.id,difficulty:all.difficulty,
    verifiedActors,totalActors:totals.size,bossActors:bosses.size};
}
const rateOf=body=>body?.data?.rateLimitData??null;
/**
 * Direct WCL v2 RateLimitData JSON witnesses only. Database is a subset
 * of application points, not an independent addend. 'total' includes the
 * minimum request cost and MUST NOT be reconstructed from these classes.
 * A missing class stays null; do not silently claim that it cost zero.
 * Application cap, database cap and User eligibility are separate
 * dimensions; the client-credentials flow does not prove User billing.
 */
export function observeFreshRateLimit(body) {
  const rate=rateOf(body);
  const details=rate?.currentRequest;
  const pointClasses={application:null,database:null,user:null};
  if(details!==null&&typeof details==='object'&&!Array.isArray(details)){
    for(const k of Object.keys(pointClasses))
      if(nonNegative(details[k]))pointClasses[k]=details[k];
  }
  const total=nonNegative(details?.total)?details.total:null;
  const appRemaining=nonNegative(rate?.limitPerHour)&&
    nonNegative(rate?.pointsSpentThisHour)?
    Math.max(0,rate.limitPerHour-rate.pointsSpentThisHour):null;
  const databaseRemaining=nonNegative(rate?.databaseLimitPerHour)&&
    nonNegative(rate?.databasePointsSpentThisHour)?
    Math.max(0,rate.databaseLimitPerHour-rate.databasePointsSpentThisHour):null;
  const userHasRemainingPoints=typeof rate?.userHasRemainingPoints==='boolean'?
    rate.userHasRemainingPoints:null;
  return {
    total,pointClasses,appRemaining,databaseRemaining,
    userHasRemainingPoints,
    classWitnesses:Object.values(pointClasses).filter(v=>v!==null).length
  };
}
function writePrivate(dir,name,data) {
  const temp=path.join(dir,'.'+name+'.'+randomUUID()+'.tmp');
  let fd;
  try {
    fd=fs.openSync(temp,'wx',0o600);
    fs.writeFileSync(fd,JSON.stringify(data,null,2)+'\n');
    fs.fsyncSync(fd);fs.closeSync(fd);fd=null;
    fs.renameSync(temp,path.join(dir,name));
    if(process.platform!=='win32'){
      const d=fs.openSync(dir,'r');
      try{fs.fsyncSync(d);}finally{fs.closeSync(d);}
    }
  } finally {
    if(fd!==null&&fd!==undefined)fs.closeSync(fd);
    if(fs.existsSync(temp))fs.unlinkSync(temp);
  }
}

/**
 * Network-free orchestration boundary. 'send' is injected; mock-only in CI.
 * NEVER called before external one-time GitHub ref reservation is committed.
 * Output directory must be new, private and outside the public Git checkout.
 */
export async function runFreshTwoQueryProbe({
  target, privateOutputDir, send, minAppHeadroom=100, clock=Date.now
}={}){
  const queries=buildFreshQueryPair(target);
  if(typeof privateOutputDir!=='string'||!path.isAbsolute(privateOutputDir)||
     typeof send!=='function'||typeof clock!=='function'||
     !nonNegative(minAppHeadroom)||minAppHeadroom<1)
    throw Error('FRESH_EXECUTION_CONFIG_INVALID');
  fs.mkdirSync(privateOutputDir,{recursive:false,mode:0o700});
  const journal={
    schema:1,mode:'FRESH_ONE_TIME_TWO_QUERY',status:'PREPARED',
    attemptedGraphql:0,maxGraphql:2,observations:[],
    source:'CURRENT_PUBLIC_WCL_REPORT',
    targetDigest:createHash('sha256').update(
      target.reportCode+':'+target.fightId).digest('hex')
  };
  writePrivate(privateOutputDir,'journal.json',journal);
  let reference=null;
  for(let i=0;i<2;i++){
    const q=queries[i];
    journal.status='IN_FLIGHT';
    journal.attemptedGraphql=i+1;
    journal.inFlightKind=q.kind;
    journal.inFlightQueryDigest=digest(q);
    journal.startedAtMs=clock();
    writePrivate(privateOutputDir,'journal.json',journal);

    let reply,uncertain=false;
    try{reply=await send({query:q.query,variables:q.variables});}
    catch(_error){uncertain=true;}
    const finishedAtMs=clock();
    if(uncertain||!reply||!Number.isSafeInteger(reply.httpStatus)){
      journal.status='NEEDS_REVIEW';
      journal.failure='UNKNOWN_PAID_ATTEMPT_NO_RETRY';
      writePrivate(privateOutputDir,'journal.json',journal);
      break;
    }
    // Raw WCL responses remain in the private ephemeral directory only;
    // no uploading or printing actors or report codes.
    writePrivate(privateOutputDir,'raw-'+(i+1)+'.json',reply);
    const report=reply.body?.data?.reportData?.report;
    const rate=observeFreshRateLimit(reply.body);
    const observation={
      method:q.kind,httpStatus:reply.httpStatus,
      startedAtMs:journal.startedAtMs,finishedAtMs,
      elapsedMs:Math.max(0,finishedAtMs-journal.startedAtMs),
      reportedTotalPoints:rate.total,
      pointClasses:rate.pointClasses,
      appHeadroomObserved:rate.appRemaining,
      databaseHeadroomObserved:rate.databaseRemaining,
      userHasRemainingPoints:rate.userHasRemainingPoints,
      pointClassWitnessCount:rate.classWitnesses,
      graphqlErrors:reply.body?.errors==null?false:
        Array.isArray(reply.body.errors)?reply.body.errors.length>0:true,
      reportRevision:Number.isSafeInteger(report?.revision)?
        report.revision:null
    };
    journal.observations.push(observation);
    let reason=null;
    if(reply.httpStatus!==200||observation.graphqlErrors)
      reason='FRESH_HTTP_OR_GRAPHQL_ERROR';
    else if(report?.code!==target.reportCode)
      reason='FRESH_REPORT_CODE_MISMATCH';
    else if(i===0){
      const summary=summarizeFreshRankings(target,reply.body);
      if(!summary.ok)reason=summary.reason;
      else {
        reference=summary;
        journal.liveBaseline={
          encounterId:summary.encounterId,
          difficulty:summary.difficulty,
          reportRevision:summary.revision,
          matchedActors:summary.verifiedActors
        };
      }
      if(!reason&&observation.reportedTotalPoints===null)
        reason='FRESH_POINT_COST_UNKNOWN';
      if(!reason&&(rate.appRemaining===null||
          rate.appRemaining<minAppHeadroom))
        reason='FRESH_APP_HEADROOM_UNKNOWN_OR_LOW';
    }else if(!reference||report?.revision!==reference.revision||
      report?.damage==null)reason='FRESH_TABLE_REVISION_OR_SHAPE_UNPROVEN';

    journal.inFlightKind=null;
    journal.inFlightQueryDigest=null;
    journal.startedAtMs=null;
    journal.failure=reason;
    journal.status=reason?'NEEDS_REVIEW':'RECORDED';
    writePrivate(privateOutputDir,'journal.json',journal);
    if(reason)break;
  }
  const safe={
    status:journal.status,
    reason:journal.failure??null,
    graphqlRequests:journal.attemptedGraphql,
    source:'FRESH_WCL_NO_HISTORIC_EXACT100_DEPENDENCY',
    liveReferenceObserved:reference!==null,
    matchedRankingsActors:reference?.verifiedActors??0,
    sameFightTableResponseRecorded:journal.attemptedGraphql===2&&
      journal.status==='RECORDED',
    actorBossTargetAndDpsDenominatorParity:'UNPROVEN',
    tableAdopted:false,
    observations:journal.observations.map(o=>({
      method:o.method,httpStatus:o.httpStatus,
      elapsedMs:o.elapsedMs,reportedTotalPoints:o.reportedTotalPoints,
      appPoints:o.pointClasses.application,
      databasePoints:o.pointClasses.database,userPoints:o.pointClasses.user,
      appHeadroomObserved:o.appHeadroomObserved,
      databaseHeadroomObserved:o.databaseHeadroomObserved,
      userHasRemainingPoints:o.userHasRemainingPoints,
      pointClassWitnessCount:o.pointClassWitnessCount,
      reportRevisionMatched:reference!==null&&
        o.reportRevision===reference.revision
    }))
  };
  writePrivate(privateOutputDir,'summary.json',safe);
  return safe;
}
