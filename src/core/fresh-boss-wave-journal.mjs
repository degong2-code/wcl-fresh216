/**
 * One official BossDPS page-1 GraphQL wave (8 or 9 specs), independently
 * planned from the completed immutable A source.
 * The existing schema-1 TotalDPS checkpoint is the ONLY durable state.
 * No I/O or OAuth here. A store.update() MUST durably push to private Git
 * and confirm the remote ref before this runner invokes transport().
 */
import {createHash,randomUUID} from 'node:crypto';
import {makeFreshDatedHeroicManifest,planFreshCohortBatches}
  from './fresh-cohort-source.mjs';
import {makeFreshBossFirstPageQuery,decodeFreshBossFirstPage}
  from './fresh-boss-first-page.mjs';
import {summarizeFreshDpsJob} from './fresh-dps-output-contract.mjs';
import {checkpointStats} from './checkpoint.mjs';
import {evaluateRequestAdmission} from './request-admission.mjs';

const need=(v,c)=>{if(!v)throw Error(c);};
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const clone=x=>structuredClone(x);
// Previous B8 journal rows lack a B plan seal. They are accepted only in
// their exact historical source identity, never as a new B9 checkpoint.
const LEGACY_SOURCE_SHA='7b1a075ad2663c8aa07734b7733cbe81bf9c6071';
const LEGACY_SCOPE='heroic:2026-10-22_27:latest:source';
const all=state=>[
  ...Object.values(state.entries??{}),
  ...Object.values(state.rankRequests??{}),
  ...Object.values(state.sourceRequests??{}),
  ...Object.values(state.bossPageRequests??{})
];
const unsafe=state=>all(state).some(e=>e.status==='IN_FLIGHT'||
  e.status==='NEEDS_REVIEW'||e.attempt&&e.observedPoints===null);
const key=batch=>'page1:'+batch.batchIndex;

/**
 * Validate B's independent plan generation against ALL committed A jobs.
 * A source batch index never identifies a B batch. Each B job is looked up
 * by original jobKey + snapshotSha and all 100 source rows are checked.
 *
 * The B plan seal includes scope, source code/roster, alias grouping and all
 * A snapshot hashes. Changing B8 to B9, editing a source row or reordering
 * an encounter cannot silently reuse an already charged B request.
 *
 * This validator MUST work while the B journal itself is IN_FLIGHT;
 * projectCompletedFreshCohort() deliberately refuses that state.
 */
function sourceIdentity(state,batch){
  const sourceCommit=state?.sourceCodeCommit,scopeKey=state?.scopeKey;
  const bSize=batch?.bossJobsPerRequest??8;
  need(state?.schema===1&&state.status==='ACTIVE'&&
    typeof sourceCommit==='string'&&/^[0-9a-f]{40}$/.test(sourceCommit)&&
    typeof scopeKey==='string'&&scopeKey.length>0&&
    [8,9].includes(bSize),
    'BOSS_WAVE_SOURCE_IDENTITY');
  makeFreshBossFirstPageQuery(batch);
  const manifest=makeFreshDatedHeroicManifest(scopeKey);
  const sourcePlan=planFreshCohortBatches(manifest,{
    jobsPerRequest:state.sourceJobsPerRequest??8
  });
  const bPlan=planFreshCohortBatches(manifest,{
    jobsPerRequest:bSize
  });
  need(state.sourceManifestSha===sourcePlan.manifestSha&&
    Object.keys(state.sourceRequests??{}).length===sourcePlan.requestCount&&
    Number.isInteger(batch.batchIndex)&&batch.batchIndex>=0&&
    batch.batchIndex<bPlan.requestCount,
    'BOSS_WAVE_SOURCE_IDENTITY');
  const reference=bPlan.batches[batch.batchIndex];
  need(batch.scopeKey===scopeKey&&
    batch.encounterId===reference.encounterId&&
    batch.jobs.length===reference.jobs.length&&
    batch.difficulty===reference.difficulty&&
    batch.filter===reference.filter&&
    batch.partitionMode===reference.partitionMode,
    'BOSS_WAVE_SOURCE_BATCH_DRIFT');

  const sources=new Map(),sourceSnapshots=[];
  for(const a of sourcePlan.batches){
    const e=state.sourceRequests[a.key];
    need(e?.status==='COMPLETED'&&
      JSON.stringify(e.batch)===JSON.stringify(a)&&
      e.result?.jobs?.length===a.jobs.length&&
      Number.isFinite(e.observedPoints)&&e.observedPoints>=0,
      'BOSS_WAVE_SOURCE_BATCH_DRIFT');
    for(let i=0;i<a.jobs.length;i++){
      const j=a.jobs[i],saved=e.result.jobs[i];
      need(saved?.jobKey===j.jobKey&&
        saved.className===j.className&&
        saved.specName===j.specName&&
        Array.isArray(saved.rows)&&saved.rows.length===100&&
        saved.snapshotSha===sha(saved.rows)&&
        !sources.has(j.jobKey),
        'BOSS_WAVE_SOURCE_JOB_DRIFT');
      sources.set(j.jobKey,{...saved,encounterId:a.encounterId});
      sourceSnapshots.push([j.jobKey,saved.snapshotSha]);
    }
  }
  need(sources.size===216,'BOSS_WAVE_SOURCE_JOB_DRIFT');
  const planSha=sha({
    kind:'BOSS_FIRST_PAGE_INDEPENDENT_PLAN_V1',
    scopeKey,sourceCommit,sourceManifestSha:sourcePlan.manifestSha,
    sourceJobsPerRequest:state.sourceJobsPerRequest??8,
    bossJobsPerRequest:bSize,
    sourceSnapshots
  });
  for(const [k,e] of Object.entries(state.bossPageRequests??{})){
    const historical=e.bossPlanSha==null&&
      scopeKey===LEGACY_SCOPE&&sourceCommit===LEGACY_SOURCE_SHA&&
      bSize===8;
    need(k===key({batchIndex:e.batchIndex})&&
      e.scopeKey===scopeKey&&e.sourceCommit===sourceCommit&&
      (e.bossPlanSha===planSha||historical),
      'BOSS_WAVE_PLAN_GENERATION_DRIFT');
  }
  for(let i=0;i<reference.jobs.length;i++){
    const expected=reference.jobs[i],wanted=batch.jobs[i];
    const original=sources.get(expected.jobKey);
    need(original&&wanted?.jobKey===expected.jobKey&&
      wanted.className===expected.className&&
      wanted.specName===expected.specName&&
      wanted.snapshotSha===original.snapshotSha&&
      Array.isArray(wanted.slots)&&wanted.slots.length===100&&
      original.encounterId===batch.encounterId,
      'BOSS_WAVE_SOURCE_JOB_DRIFT');
    for(let k=0;k<100;k++){
      const raw=original.rows[k],slot=wanted.slots[k];
      need(slot.rank===k+1&&slot.jobKey===expected.jobKey&&
        slot.scopeKey===scopeKey&&slot.snapshotSha===original.snapshotSha&&
        slot.className===expected.className&&
        slot.specName===expected.specName&&
        slot.encounterId===batch.encounterId&&slot.difficulty===4&&
        slot.totalDps===raw.amount&&slot.name===raw.name&&
        slot.reportCode===raw.reportCode&&slot.fightId===raw.fightId&&
        slot.startTime===raw.startTime&&
        (slot.reportRevision??null)===(raw.reportRevision??null),
        'BOSS_WAVE_SOURCE_RANK_DRIFT');
    }
  }
  return {batchSha:sha(batch),planSha,sourceCommit,scopeKey};
}

export function registerFreshBossWave(state,batch){
  const identity=sourceIdentity(state,batch),digest=identity.batchSha,
    k=key(batch);
  const list=state.bossPageRequests??{};
  if(list[k]){
    need(list[k].batchSha===digest,'BOSS_WAVE_REPLAN_DRIFT');
    return state; // Idempotent inspection; NEVER re-authorize replay.
  }
  need(Object.keys(list).length===batch.batchIndex&&
    Object.values(list).every(e=>e.status==='COMPLETED')&&
    !unsafe(state),'BOSS_WAVE_OUT_OF_SEQUENCE_OR_UNSAFE');
  const out=clone(state);out.bossPageRequests??={};
  out.bossPageRequests[k]={
    key:k,batchIndex:batch.batchIndex,batchSha:digest,
    sourceCommit:identity.sourceCommit,scopeKey:identity.scopeKey,
    bossPlanSha:identity.planSha,status:'READY',
    attempt:null,observedPoints:null,wallMs:null,result:null,incident:null
  };
  out.version++;return out;
}

export function beginFreshBossWave(state,batch,attemptId,startedAtMs){
  const identity=sourceIdentity(state,batch),digest=identity.batchSha,
    e=state.bossPageRequests?.[key(batch)];
  need(e?.status==='READY'&&e.batchSha===digest&&
    typeof attemptId==='string'&&attemptId.length>0&&
    Number.isSafeInteger(startedAtMs)&&startedAtMs>=0,
    'BOSS_WAVE_NOT_READY_OR_DRIFT');
  need(!unsafe(state),'SCOPE_HAS_UNRESOLVED_ATTEMPT');
  need(!all(state).some(x=>x.attempt?.id===attemptId),
    'DUPLICATE_ATTEMPT_ID');
  const out=clone(state);const next=out.bossPageRequests[key(batch)];
  next.status='IN_FLIGHT';
  next.attempt={id:attemptId,startedAtMs,kind:'BOSS_PAGE_WAVE'};
  out.version++;return out;
}
function attempted(state,batch,attemptId){
  const entry=state.bossPageRequests?.[key(batch)];
  const identity=sourceIdentity(state,batch);
  need(entry?.status==='IN_FLIGHT'&&entry.attempt?.id===attemptId&&
    entry.batchSha===identity.batchSha&&
    entry.sourceCommit===identity.sourceCommit&&
    (entry.bossPlanSha===identity.planSha||
      entry.bossPlanSha==null&&identity.scopeKey===LEGACY_SCOPE&&
      identity.sourceCommit===LEGACY_SOURCE_SHA),
    'BOSS_WAVE_ATTEMPT_DRIFT');
  return entry;
}
export function completeFreshBossWave(state,batch,attemptId,decoded,{
  points,wallMs=null
}={}){
  attempted(state,batch,attemptId);
  need(decoded?.status==='OK'&&decoded.observedPoints===points&&
    typeof points==='number'&&Number.isFinite(points)&&points>=0&&
    (wallMs===null||Number.isFinite(wallMs)&&wallMs>=0)&&
    decoded.result?.jobs?.length===batch.jobs.length,
    'BOSS_WAVE_RESULT_INVALID');
  let verified=0;
  for(let i=0;i<batch.jobs.length;i++){
    const job=batch.jobs[i],result=decoded.result.jobs[i];
    need(result.jobKey===job.jobKey&&
      result.snapshotSha===job.snapshotSha&&
      Array.isArray(result.rankings)&&result.rankings.length<=100&&
      result.bossRankingSha===sha(result.rankings)&&
      result.rankingsStatus===(result.rankings.length===100?'EXACT100':'PARTIAL')&&
      Array.isArray(result.verified),'BOSS_WAVE_RANKING_OR_PROOF_DRIFT');
    // Independently revalidate B's ordered official ranks and C's exact
    // original-fight proofs against the frozen A snapshot.
    const output=summarizeFreshDpsJob({
      totalRankSlots:job.slots,bossPage:result,
      verifiedProofs:result.verified
    });
    need(output.bossRankingSnapshotSha===result.bossRankingSha,
      'BOSS_WAVE_FINAL_KPI_WITNESS_INVALID');
    verified+=output.verifiedRanks;
  }
  need(verified===decoded.result.verifiedCount,
    'BOSS_WAVE_PROOF_COUNT_DRIFT');
  const out=clone(state),next=out.bossPageRequests[key(batch)];
  next.status='COMPLETED';next.result=clone(decoded.result);
  next.observedPoints=points;next.wallMs=wallMs;
  out.version++;return out;
}
export function uncertainFreshBossWave(state,batch,attemptId,{
  code,points=null,wallMs=null
}={}){
  attempted(state,batch,attemptId);
  need(typeof code==='string'&&/^[A-Z0-9_]{3,80}$/.test(code)&&
    (points===null||typeof points==='number'&&
      Number.isFinite(points)&&points>=0),
    'BOSS_WAVE_INCIDENT_INVALID');
  const out=clone(state),entry=out.bossPageRequests[key(batch)];
  entry.status='NEEDS_REVIEW';entry.observedPoints=points;
  entry.wallMs=wallMs;entry.incident={code,automaticRetry:false};
  out.version++;return out;
}

/** Default preview. No Git/WCL/Sheets activity without explicit execution. */
export async function runOneFreshBossWave({
  store,batch,mode='preview',approved=false,transport,
  admissionPolicy,clock=Date.now,attemptId=randomUUID()
}={}){
  need(store&&typeof store.read==='function'&&
    typeof store.update==='function','BOSS_WAVE_STORE_REQUIRED');
  const before=store.read(),digest=sourceIdentity(before,batch).batchSha;
  const existing=before.bossPageRequests?.[key(batch)];
  if(existing)need(existing.batchSha===digest,'BOSS_WAVE_REPLAN_DRIFT');
  if(mode==='preview')return {
    status:'PREVIEW',batchIndex:batch.batchIndex,
    sourceJobs:batch.jobs.length,priorStatus:existing?.status??null,
    attemptsCharged:0
  };
  need(mode==='execute'&&approved===true&&
    typeof transport==='function'&&admissionPolicy&&
    typeof clock==='function'&&typeof attemptId==='string',
    'BOSS_WAVE_PAID_EXECUTION_NOT_AUTHORIZED');
  if(existing&&existing.status!=='READY')
    return {status:existing.status,attempted:false};
  if(!existing)store.update(s=>registerFreshBossWave(s,batch));
  const now=clock();
  const admitted=evaluateRequestAdmission(store.read(),{
    ...admissionPolicy,nowMs:now
  });
  if(!admitted.allowed)return {status:admitted.status,attempted:false};
  const query=makeFreshBossFirstPageQuery(batch);
  // This update MUST push the IN_FLIGHT checkpoint to the private
  // remote Git branch and confirm it before the following line.
  store.update(s=>{
    const gate=evaluateRequestAdmission(s,{...admissionPolicy,nowMs:now});
    need(gate.allowed,'BOSS_WAVE_ADMISSION_CHANGED');
    return beginFreshBossWave(s,batch,attemptId,now);
  });
  let decoded,points=null;
  try{
    const response=await transport(query);
    decoded=decodeFreshBossFirstPage(
      batch,response?.httpStatus,response?.body);
    points=decoded.observedPoints;
  }catch{
    decoded={status:'BOSS_WAVE_TRANSPORT_UNKNOWN'};
  }
  const end=clock(),wallMs=Number.isSafeInteger(end)&&end>=now?
    end-now:null;
  const ok=decoded.status==='OK';
  // If persistence fails after HTTP, REMOTE remains IN_FLIGHT.
  // Nothing in this module resets or blindly retries the query.
  store.update(s=>ok?
    completeFreshBossWave(s,batch,attemptId,decoded,{points,wallMs}):
    uncertainFreshBossWave(s,batch,attemptId,{
      code:decoded.status,points,wallMs
    }));
  return {
    status:ok?'RECORDED':'NEEDS_REVIEW',attempted:true,
    batchIndex:batch.batchIndex,sourceJobs:batch.jobs.length,
    observedPoints:points,verifiedSameFight:ok?
      decoded.result.verifiedCount:0
  };
}
