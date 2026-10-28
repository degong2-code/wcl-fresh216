import {createHash,randomUUID} from 'node:crypto';
import {planFull216} from './full-scope-plan.mjs';
import {checkpointStats} from './checkpoint.mjs';
import {evaluateRequestAdmission} from './request-admission.mjs';

const fail=code=>{throw Error(code);};
const need=(test,code)=>{if(!test)fail(code);};
const copy=x=>structuredClone(x);
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const positive=x=>Number.isSafeInteger(x)&&x>0;
const validText=x=>typeof x==='string'&&x.length>0&&x.length<=128;
const DATE_FILTER='date.1792594800000.1793199600000';
// Frozen WCL 8-boss/27-spec job roster from the user's imported original
// Apps Script Code.js. Names and IDs are metadata, never private actor rows.
export const FRESH_HEROIC_BOSSES=Object.freeze([
  {name:'네크잘리',encounterId:3470},
  {name:'파수꾼',encounterId:3445},
  {name:'탐험가',encounterId:3455},
  {name:'바쉬니크',encounterId:3497},
  {name:'스조라크',encounterId:3420},
  {name:'쌍곳니',encounterId:3421},
  {name:'똬리',encounterId:3429},
  {name:'울라텍',encounterId:3492}
]);
export const FRESH_DPS_SPECS=Object.freeze([
  ['DeathKnight','Frost'],['DeathKnight','Unholy'],
  ['DemonHunter','Havoc'],['DemonHunter','Devourer'],
  ['Druid','Balance'],['Druid','Feral'],
  ['Evoker','Devastation'],['Evoker','Augmentation'],
  ['Hunter','BeastMastery'],['Hunter','Marksmanship'],['Hunter','Survival'],
  ['Mage','Arcane'],['Mage','Fire'],['Mage','Frost'],
  ['Monk','Windwalker'],['Paladin','Retribution'],['Priest','Shadow'],
  ['Rogue','Assassination'],['Rogue','Outlaw'],['Rogue','Subtlety'],
  ['Shaman','Elemental'],['Shaman','Enhancement'],
  ['Warlock','Affliction'],['Warlock','Demonology'],
  ['Warlock','Destruction'],['Warrior','Arms'],['Warrior','Fury']
].map(([className,specName])=>Object.freeze({className,specName})));
export function makeFreshDatedHeroicManifest(scopeKey){
  need(typeof scopeKey==='string'&&scopeKey.length>0,
    'FRESH_COHORT_SCOPE_KEY_INVALID');
  return {scopeKey,difficulty:4,partitionMode:'LATEST_DEFAULT',
    filter:DATE_FILTER,bosses:copy(FRESH_HEROIC_BOSSES),
    specs:copy(FRESH_DPS_SPECS)};
}

const START=1792594800000,END=1793199600000;
const rowCode=r=>r?.report?.code??r?.reportCode??r?.reportID;
const rowFight=r=>r?.report?.fightID??r?.report?.fightId??r?.fightID??r?.fightId;
const pointCost=body=>{
  let c=body?.data?.rateLimitData?.currentRequest;
  if(typeof c==='string'){try{c=JSON.parse(c);}catch{c=null;}}
  return typeof c?.total==='number'&&Number.isFinite(c.total)&&c.total>=0?c.total:null;
};
export function validateFreshCohortManifest(m){
  need(m&&typeof m==='object'&&
    typeof m.scopeKey==='string'&&m.scopeKey&&
    m.difficulty===4&&m.partitionMode==='LATEST_DEFAULT'&&
    m.filter===DATE_FILTER&&
    Array.isArray(m.bosses)&&m.bosses.length===8&&
    Array.isArray(m.specs)&&m.specs.length===27,
    'FRESH_COHORT_MANIFEST_INVALID');
  const bosses=new Set(),ids=new Set(),specs=new Set();
  for(const b of m.bosses){
    need(validText(b?.name)&&positive(b?.encounterId)&&
      !bosses.has(b.name)&&!ids.has(b.encounterId),
      'FRESH_COHORT_BOSS_DUPLICATE_OR_INVALID');
    bosses.add(b.name);ids.add(b.encounterId);
  }
  for(const s of m.specs){
    need(validText(s?.className)&&validText(s?.specName)&&
      !specs.has(s.className+'|'+s.specName),
      'FRESH_COHORT_SPEC_DUPLICATE_OR_INVALID');
    specs.add(s.className+'|'+s.specName);
  }
  need(JSON.stringify(m.bosses)===JSON.stringify(FRESH_HEROIC_BOSSES)&&
    JSON.stringify(m.specs)===JSON.stringify(FRESH_DPS_SPECS),
    'FRESH_COHORT_ROSTER_NOT_ATTESTED');
  return digest({scopeKey:m.scopeKey,difficulty:4,
    partitionMode:'LATEST_DEFAULT',filter:DATE_FILTER,
    bosses:m.bosses,specs:m.specs});
}
export function planFreshCohortBatches(manifest,{jobsPerRequest=8}={}){
  const manifestSha=validateFreshCohortManifest(manifest);
  need(positive(jobsPerRequest)&&jobsPerRequest<=10,
    'FRESH_COHORT_BATCH_SIZE_INVALID');
  const batches=[];
  for(const boss of manifest.bosses){
    for(let start=0;start<27;start+=jobsPerRequest){
      const jobs=manifest.specs.slice(start,start+jobsPerRequest).map(s=>({
        jobKey:boss.name+'|'+s.className+'|'+s.specName,
        className:s.className,specName:s.specName
      }));
      const index=batches.length;
      batches.push({key:JSON.stringify([manifestSha,index]),
        batchIndex:index,manifestSha,scopeKey:manifest.scopeKey,
        encounterId:boss.encounterId,difficulty:4,
        filter:DATE_FILTER,partitionMode:'LATEST_DEFAULT',jobs});
    }
  }
  need(batches.reduce((a,b)=>a+b.jobs.length,0)===216,
    'FRESH_COHORT_JOB_COVERAGE');
  return {manifestSha,batches,totalJobs:216,requestCount:batches.length};
}
/** Query has no partition argument: WCL chooses latest/default. */
export function buildFreshCohortQuery(batch){
  need(batch&&positive(batch.encounterId)&&batch.difficulty===4&&
    batch.filter===DATE_FILTER&&batch.partitionMode==='LATEST_DEFAULT'&&
    Array.isArray(batch.jobs)&&batch.jobs.length>=1&&batch.jobs.length<=10,
    'FRESH_COHORT_QUERY_INVALID');
  const declarations=['$id:Int!','$difficulty:Int!','$filter:String!'];
  const variables={id:batch.encounterId,difficulty:4,filter:DATE_FILTER};
  const fields=[];
  batch.jobs.forEach((job,i)=>{
    need(validText(job.className)&&validText(job.specName),
      'FRESH_COHORT_QUERY_SPEC_INVALID');
    declarations.push('$c'+i+':String!','$s'+i+':String!');
    variables['c'+i]=job.className;
    variables['s'+i]=job.specName;
    fields.push('t'+i+':characterRankings(difficulty:$difficulty,'+
      'className:$c'+i+',specName:$s'+i+
      ',metric:dps,page:1,filter:$filter)');
  });
  return {query:'query Fresh216Cohort('+declarations.join(',')+
    '){rateLimitData{currentRequest} worldData{encounter(id:$id){'+
    fields.join(' ')+'}}}',variables};
}
const allEntries=state=>[
  ...Object.values(state.entries??{}),
  ...Object.values(state.rankRequests??{}),
  ...Object.values(state.sourceRequests??{})
];
const unresolved=state=>allEntries(state).some(e=>
  e.status==='IN_FLIGHT'||e.status==='NEEDS_REVIEW'||
  (e.attempt&&e.observedPoints==null));
export function installFreshCohortPlan(state,manifest,options={}){
  need(state?.schema===1&&state.status==='ACTIVE'&&
    state.scopeKey===manifest?.scopeKey,'FRESH_COHORT_CHECKPOINT_SCOPE');
  const plan=planFreshCohortBatches(manifest,options);
  need(!Object.keys(state.entries??{}).length&&
    !Object.keys(state.rankRequests??{}).length&&
    !Object.keys(state.sourceRequests??{}).length&&
    state.sourceManifestSha==null,
    'FRESH_COHORT_PLAN_ALREADY_PRESENT');
  const out=copy(state);out.sourceManifestSha=plan.manifestSha;
  out.sourceRequests={};
  for(const batch of plan.batches)
    out.sourceRequests[batch.key]={key:batch.key,batch,
      status:'READY',attempt:null,observedPoints:null,
      wallMs:null,result:null,incident:null};
  out.version++;return out;
}
export function nextFreshCohortBatch(state,manifest){
  const plan=planFreshCohortBatches(manifest);
  if(state.sourceManifestSha==null)
    return {kind:'PLAN_REQUIRED',requestCount:plan.requestCount,
      totalJobs:216,completedJobs:0};
  need(state.sourceManifestSha===plan.manifestSha&&
    Object.keys(state.sourceRequests??{}).length===plan.requestCount,
    'FRESH_COHORT_MANIFEST_OR_REQUEST_DRIFT');
  const entries=plan.batches.map(b=>{
    const entry=state.sourceRequests[b.key];
    need(entry&&JSON.stringify(entry.batch)===JSON.stringify(b),
      'FRESH_COHORT_SOURCE_DRIFT');
    return entry;
  });
  if(unresolved(state))return {kind:'NEEDS_REVIEW',
    completedJobs:entries.filter(e=>e.status==='COMPLETED')
      .reduce((n,e)=>n+e.batch.jobs.length,0)};
  const ready=entries.find(e=>e.status==='READY');
  if(ready)return {kind:'SOURCE_BATCH',batch:copy(ready.batch),
    completedJobs:entries.filter(e=>e.status==='COMPLETED')
      .reduce((n,e)=>n+e.batch.jobs.length,0)};
  need(entries.every(e=>e.status==='COMPLETED'),
    'FRESH_COHORT_UNKNOWN_STATUS');
  return {kind:'SOURCE_COMPLETE',completedJobs:216};
}
export function beginFreshCohortBatch(state,batch,attemptId,atMs){
  need(state?.status==='ACTIVE'&&
    state.sourceManifestSha===batch?.manifestSha&&
    state.sourceRequests?.[batch.key]?.status==='READY'&&
    JSON.stringify(state.sourceRequests[batch.key].batch)===JSON.stringify(batch),
    'FRESH_COHORT_NOT_READY_OR_DRIFT');
  need(typeof attemptId==='string'&&attemptId&&
    Number.isSafeInteger(atMs)&&atMs>=0,
    'FRESH_COHORT_ATTEMPT_INVALID');
  need(!unresolved(state),'SCOPE_HAS_UNRESOLVED_ATTEMPT');
  need(!allEntries(state).some(e=>e.attempt?.id===attemptId),
    'DUPLICATE_ATTEMPT_ID');
  const out=copy(state),e=out.sourceRequests[batch.key];
  e.status='IN_FLIGHT';e.attempt={id:attemptId,startedAtMs:atMs,
    kind:'TOTAL_COHORT_BATCH'};
  out.version++;return out;
}
function exactSourceRow(row,job,encounterId){
  need(row&&typeof row==='object'&&
    typeof row.name==='string'&&row.name.trim().length>0&&
    typeof row.amount==='number'&&Number.isFinite(row.amount)&&row.amount>0&&
    Number.isSafeInteger(row.startTime)&&row.startTime>=START&&row.startTime<END&&
    validText(rowCode(row))&&positive(Number(rowFight(row)))&&
    (row.reportRevision==null||
      Number.isSafeInteger(row.reportRevision)&&row.reportRevision>=0)&&
    (row.className==null||row.className===job.className)&&
    (row.specName==null||row.specName===job.specName)&&
    (row.encounterId==null||row.encounterId===encounterId),
    'FRESH_COHORT_ROW_INVALID');
  return {name:row.name,amount:row.amount,
    reportCode:rowCode(row),fightId:Number(rowFight(row)),
    startTime:row.startTime,reportRevision:row.reportRevision??null};
}
export function decodeFreshCohortBatch(batch,httpStatus,body){
  const points=pointCost(body);
  const failResult=reason=>({status:reason,points,result:null});
  if(httpStatus!==200||!body||typeof body!=='object'||
    body.errors!=null&&(!Array.isArray(body.errors)||body.errors.length))
    return failResult('SOURCE_HTTP_OR_GRAPHQL_UNCERTAIN');
  const enc=body.data?.worldData?.encounter;
  if(!enc||typeof enc!=='object')return failResult('SOURCE_ENCOUNTER_MISSING');
  const jobs=[];
  for(let i=0;i<batch.jobs.length;i++){
    const job=batch.jobs[i],ranking=enc['t'+i];
    if(!Array.isArray(ranking?.rankings)||ranking.rankings.length!==100)
      return failResult('SOURCE_TOP100_INCOMPLETE');
    let prior=Infinity,rows=[];
    try{
      rows=ranking.rankings.map(row=>{
        const value=exactSourceRow(row,job,batch.encounterId);
        need(value.amount<=prior,'FRESH_COHORT_SORT_DRIFT');
        prior=value.amount;return value;
      });
    }catch{return failResult('SOURCE_ROW_IDENTITY_OR_TIME_INVALID');}
    jobs.push({...job,rows,snapshotSha:digest(rows)});
  }
  if(points==null)return failResult('SOURCE_POINT_COST_UNOBSERVED');
  return {status:'OK',points,result:{jobs}};
}
export function finishFreshCohortBatch(state,batch,attemptId,result,{points,wallMs}={}){
  const entry=state.sourceRequests?.[batch?.key];
  need(entry?.status==='IN_FLIGHT'&&entry.attempt?.id===attemptId,
    'FRESH_COHORT_ATTEMPT_DRIFT');
  need(result&&Array.isArray(result.jobs)&&
    result.jobs.length===batch.jobs.length&&
    Number.isFinite(points)&&points>=0&&
    (wallMs==null||Number.isSafeInteger(wallMs)&&wallMs>=0),
    'FRESH_COHORT_COMMIT_INVALID');
  for(let i=0;i<result.jobs.length;i++){
    const job=result.jobs[i];
    need(job.jobKey===batch.jobs[i].jobKey&&
      job.className===batch.jobs[i].className&&
      job.specName===batch.jobs[i].specName&&
      Array.isArray(job.rows)&&job.rows.length===100&&
      job.snapshotSha===digest(job.rows),
      'FRESH_COHORT_JOB_DRIFT');
  }
  const out=copy(state),e=out.sourceRequests[batch.key];
  e.status='COMPLETED';e.observedPoints=points;
  e.wallMs=wallMs??null;e.result=copy(result);out.version++;return out;
}
export function uncertainFreshCohortBatch(state,batch,attemptId,reason,{
  points=null,wallMs=null
}={}){
  const entry=state.sourceRequests?.[batch?.key];
  need(entry?.status==='IN_FLIGHT'&&entry.attempt?.id===attemptId&&
    typeof reason==='string'&&/^[A-Z0-9_]+$/.test(reason),
    'FRESH_COHORT_UNCERTAIN_ATTEMPT');
  const out=copy(state),e=out.sourceRequests[batch.key];
  e.status='NEEDS_REVIEW';e.observedPoints=points;
  e.wallMs=wallMs;e.incident={code:reason,automaticRetry:false};
  out.version++;return out;
}
/** Refuse export unless 8x27 jobs and 21600 source rows are durable. */
export function exportVerifiedFreshCohort(state,manifest){
  const next=nextFreshCohortBatch(state,manifest);
  need(next.kind==='SOURCE_COMPLETE','FRESH_COHORT_INCOMPLETE');
  const batches=planFreshCohortBatches(manifest).batches,slots=[];
  for(const batch of batches){
    const entry=state.sourceRequests[batch.key];
    need(entry.observedPoints!=null&&entry.result?.jobs?.length===batch.jobs.length,
      'FRESH_COHORT_MISSING_WITNESS');
    for(let i=0;i<batch.jobs.length;i++){
      const j=entry.result.jobs[i];
      need(j.jobKey===batch.jobs[i].jobKey&&j.snapshotSha===digest(j.rows),
        'FRESH_COHORT_EXPORT_DRIFT');
      j.rows.forEach((r,n)=>slots.push({
        scopeKey:manifest.scopeKey,jobKey:j.jobKey,rank:n+1,
        snapshotSha:j.snapshotSha,status:'PENDING',
        className:j.className,specName:j.specName,totalDps:r.amount,
        reportCode:r.reportCode,fightId:r.fightId,
        encounterId:batch.encounterId,difficulty:4,
        name:r.name,startTime:r.startTime,
        reportRevision:r.reportRevision,filter:DATE_FILTER
      }));
    }
  }
  const verified=planFull216(slots);
  return {slots,summary:{status:'SOURCE_COMPLETE',jobs:verified.jobs,
    rankSlots:verified.rankSlots,
    witnessedSourceRequests:batches.length,
    observedRequestPoints:checkpointStats(state).witnessedPoints,
    partitionMode:'LATEST_DEFAULT',filter:DATE_FILTER}};
}
/** Default PREVIEW; never paid without explicit approval & owner transport. */
export async function runOneFreshCohortBatch({
  store,manifest,mode='preview',approved=false,
  transport,admissionPolicy=null,clock=Date.now,attemptId=randomUUID(),
  jobsPerRequest=8
}={}){
  need(store&&typeof store.read==='function'&&
    typeof store.update==='function'&&typeof clock==='function',
    'FRESH_COHORT_STORE_INVALID');
  const plan=planFreshCohortBatches(manifest,{jobsPerRequest});
  let state=store.read();
  const current=state.sourceManifestSha==null?
    {kind:'PLAN_REQUIRED',completedJobs:0,requestCount:plan.requestCount}:
    nextFreshCohortBatch(state,manifest);
  if(mode==='preview')return {status:'PREVIEW',kind:current.kind,
    completedJobs:current.completedJobs,plannedRequests:plan.requestCount,
    nextRequestIndex:current.batch?.batchIndex??null};
  need(mode==='execute'&&approved===true&&
    typeof transport==='function'&&admissionPolicy&&
    Number.isSafeInteger(admissionPolicy.maxObservedPoints)&&
    admissionPolicy.maxObservedPoints>0,
    'FRESH_COHORT_PAID_EXECUTION_NOT_AUTHORIZED');
  if(current.kind==='PLAN_REQUIRED'){
    store.update(s=>installFreshCohortPlan(s,manifest,{jobsPerRequest}));
    state=store.read();
  }
  const next=nextFreshCohortBatch(state,manifest);
  if(next.kind!=='SOURCE_BATCH')
    return {status:next.kind,attempted:false};
  const at=clock();
  const decision=evaluateRequestAdmission(store.read(),{
    ...admissionPolicy,nowMs:at});
  if(!decision.allowed)return {status:decision.status,attempted:false};
  const batch=next.batch,query=buildFreshCohortQuery(batch);
  store.update(s=>{
    const a=evaluateRequestAdmission(s,{...admissionPolicy,nowMs:at});
    need(a.allowed,'FRESH_COHORT_ADMISSION_CHANGED');
    return beginFreshCohortBatch(s,batch,attemptId,at);
  });
  let resolved,points=null;
  try{
    const reply=await transport(query);
    const decoded=decodeFreshCohortBatch(batch,reply?.httpStatus,reply?.body);
    points=decoded.points;resolved=decoded;
  }catch{
    resolved={status:'SOURCE_TRANSPORT_OR_PROCESSING_UNCERTAIN',result:null};
  }
  const end=clock(),wallMs=Number.isSafeInteger(end)&&end>=at?end-at:null;
  store.update(s=>resolved.status==='OK'?
    finishFreshCohortBatch(s,batch,attemptId,resolved.result,{points,wallMs}):
    uncertainFreshCohortBatch(s,batch,attemptId,resolved.status,{points,wallMs}));
  return {status:resolved.status==='OK'?'RECORDED':'NEEDS_REVIEW',
    attempted:true,completedJobsAfter:
      nextFreshCohortBatch(store.read(),manifest).completedJobs,
    observedRequestPoints:points,wallMs};
}
