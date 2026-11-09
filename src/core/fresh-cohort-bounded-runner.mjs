/**
 * One bounded invocation over the EXISTING durable A source journal.
 * Checkpoint points are lifetime evidence, never an hourly WCL allowance.
 * The approved-wave cap starts at this invocation's witnessed baseline.
 *
 * An optional quotaReader is supplied by the trusted owner-approved host;
 * it calls the WCL rateLimitData API before new source HTTP, never during
 * an unapproved preview. A refresh never clears a NEEDS_REVIEW attempt.
 */
import {runOneFreshCohortBatch,nextFreshCohortBatch}
  from './fresh-cohort-source.mjs';
import {evaluateRequestAdmission,evaluateWclHourlyQuota}
  from './request-admission.mjs';
import {checkpointStats} from './checkpoint.mjs';

const need=(x,code)=>{if(!x)throw Error(code);};
const allowedSize=n=>Number.isSafeInteger(n)&&n>=1&&n<=10;
const allowedMax=n=>Number.isSafeInteger(n)&&n>=1&&n<=32;
const point=n=>Number.isFinite(n)&&n>=0;

export async function runBoundedFreshCohortBatches({
  store,manifest,transport,admissionPolicy,
  approved=false,jobsPerRequest=8,maxRequests=1,
  quotaReader=null,quotaCacheMs=60000,clock=Date.now
}={}){
  need(approved===true&&allowedSize(jobsPerRequest)&&
    allowedMax(maxRequests)&&typeof transport==='function'&&
    store&&typeof store.read==='function'&&
    typeof store.update==='function'&&typeof clock==='function'&&
    admissionPolicy&&Number.isFinite(admissionPolicy.maxObservedPoints)&&
    admissionPolicy.maxObservedPoints>0&&
    Number.isFinite(admissionPolicy.reservePoints)&&
    admissionPolicy.reservePoints>0&&
    (quotaReader===null||typeof quotaReader==='function')&&
    Number.isSafeInteger(quotaCacheMs)&&
    quotaCacheMs>=0&&quotaCacheMs<=60000,
    'FRESH_BOUNDED_OWNER_AUTHORIZATION_REQUIRED');

  const initial=store.read();
  need(initial.sourceManifestSha==null||
    (initial.sourceJobsPerRequest??8)===jobsPerRequest,
    'FRESH_COHORT_BATCH_SIZE_DRIFT');
  const initialPoints=checkpointStats(initial).witnessedPoints;
  need(point(initialPoints)&&
    admissionPolicy.budgetBaselinePoints==null&&
    admissionPolicy.hourlyQuota==null,
    'FRESH_BOUNDED_EXTERNAL_BUDGET_OVERRIDE_FORBIDDEN');
  // Restrict the cap to the approved invocation, NOT to this checkpoint's
  // lifetime history (which can span many WCL hourly resets).
  const policy={...admissionPolicy,budgetBaselinePoints:initialPoints};
  let attempted=0,recorded=0,points=0,wallMs=0;
  let reason='MAX_REQUESTS_REACHED',waitMs=0;
  let sampled=null,sampledAt=null,spendSinceSample=0;
  let quotaProbeCalls=0,quotaProbePoints=0;
  for(let i=0;i<maxRequests;i++){
    const state=store.read();
    const current=nextFreshCohortBatch(state,manifest);
    if(current.kind==='NEEDS_REVIEW'||current.kind==='SOURCE_COMPLETE'){
      reason=current.kind;break;
    }
    let stepPolicy=policy;
    if(quotaReader!==null){
      const now=clock();
      const age=sampledAt===null?Infinity:now-sampledAt;
      const resetMs=sampledAt===null?0:
        sampledAt+sampled.pointsResetIn*1000;
      if(!sampled||age<0||age>=quotaCacheMs||now>=resetMs){
        try{
          sampled=await quotaReader();
          quotaProbeCalls++;
          // rateLimitData.currentRequest.total includes the minimum
          // application point cost of the quota GET itself.
          let probe=sampled?.currentRequest;
          if(typeof probe==='string')probe=JSON.parse(probe);
          need(point(probe?.total)&&probe.total>0,
            'HOURLY_QUOTA_PROBE_POINT_WITNESS_MISSING');
          quotaProbePoints+=probe.total;
          // Validate the WCL response before writing ANY source checkpoint.
          evaluateWclHourlyQuota(sampled,{
            reservePoints:policy.reservePoints,
            databaseReservePoints:policy.databaseReservePoints??0
          });
          sampledAt=clock();
          spendSinceSample=0;
        }catch{
          reason='HOURLY_QUOTA_UNAVAILABLE';break;
        }
      }
      // Another service can consume quota while this runs. Each sample
      // expires quickly; local witnessed costs are added conservatively.
      const observed={
        ...sampled,
        pointsSpentThisHour:sampled.pointsSpentThisHour+spendSinceSample,
        ...(policy.databaseReservePoints>0?
          {databasePointsSpentThisHour:
            sampled.databasePointsSpentThisHour+spendSinceSample}:{})
      };
      const hourly=evaluateWclHourlyQuota(observed,{
        reservePoints:policy.reservePoints,
        databaseReservePoints:policy.databaseReservePoints??0
      });
      if(!hourly.allowed){
        reason=hourly.status;
        waitMs=hourly.waitMs;break;
      }
      stepPolicy={...policy,hourlyQuota:observed};
    }
    // Read-only preflight; runOne... repeats the admission inside the
    // remotely durable IN_FLIGHT transition, preventing bypass.
    if(current.kind!=='PLAN_REQUIRED'){
      const admit=evaluateRequestAdmission(state,{
        ...stepPolicy,nowMs:clock()});
      if(!admit.allowed){
        reason=admit.status;
        waitMs=admit.waitMs;break;
      }
    }
    const receipt=await runOneFreshCohortBatch({
      store,manifest,mode:'execute',approved:true,transport,
      admissionPolicy:stepPolicy,jobsPerRequest,clock
    });
    if(receipt.attempted===true)attempted++;
    if(receipt.status!=='RECORDED'){
      reason=receipt.status;break;
    }
    need(receipt.attempted===true&&
      point(receipt.observedRequestPoints),
      'FRESH_BOUNDED_WITNESS_UNCERTAIN');
    recorded++;
    points+=receipt.observedRequestPoints;
    if(sampled)spendSinceSample+=receipt.observedRequestPoints;
    wallMs+=receipt.wallMs??0;
  }
  const after=nextFreshCohortBatch(store.read(),manifest);
  const final=after.kind==='NEEDS_REVIEW'?'NEEDS_REVIEW':
    after.kind==='SOURCE_COMPLETE'?'SOURCE_COMPLETE':reason;
  return {
    status:final,attemptedRequests:attempted,
    recordedRequests:recorded,observedPoints:points,
    measuredWaveWallMs:wallMs,completedJobs:after.completedJobs,
    nextBatchIndex:after.batch?.batchIndex??null,
    sourceComplete:after.kind==='SOURCE_COMPLETE',
    maxRequests,jobsPerRequest,
    budgetBasis:'APPROVED_INVOCATION',
    lifetimePointsBeforeInvocation:initialPoints,
    hourlyQuotaProbes:quotaProbeCalls,
    quotaProbePointsObserved:quotaProbePoints,
    totalInvocationApiPointsObserved:points+quotaProbePoints,
    waitMs,automaticRetries:0
  };
}
