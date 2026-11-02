/**
 * Engine-level bounded multi-batch execution. This is a coordinator over
 * the EXISTING immutable source planner and checkpoint transitions, not
 * a second checkpoint/journal or a new HTTP client.
 *
 * A caller's durable store MUST persist and remote-confirm every update
 * before it returns (the private Git adapter already provides that).
 * A per-operation owner approval never implicitly authorizes retries.
 */
import {runOneFreshCohortBatch,nextFreshCohortBatch}
  from './fresh-cohort-source.mjs';
import {evaluateRequestAdmission} from './request-admission.mjs';

const need=(x,code)=>{if(!x)throw Error(code);};
const allowedSize=n=>Number.isSafeInteger(n)&&n>=1&&n<=10;
const allowedMax=n=>Number.isSafeInteger(n)&&n>=1&&n<=32;

export async function runBoundedFreshCohortBatches({
  store,manifest,transport,admissionPolicy,
  approved=false,jobsPerRequest=8,maxRequests=1,clock=Date.now
}={}){
  need(approved===true&&allowedSize(jobsPerRequest)&&
    allowedMax(maxRequests)&&typeof transport==='function'&&
    store&&typeof store.read==='function'&&
    typeof store.update==='function'&&typeof clock==='function'&&
    admissionPolicy&&Number.isFinite(admissionPolicy.maxObservedPoints)&&
    admissionPolicy.maxObservedPoints>0&&
    Number.isFinite(admissionPolicy.reservePoints)&&
    admissionPolicy.reservePoints>0,
    'FRESH_BOUNDED_OWNER_AUTHORIZATION_REQUIRED');
  const initial=store.read();
  need(initial.sourceManifestSha==null||
    (initial.sourceJobsPerRequest??8)===jobsPerRequest,
    'FRESH_COHORT_BATCH_SIZE_DRIFT');
  let attempted=0,recorded=0,points=0,wallMs=0;
  let reason='MAX_REQUESTS_REACHED';
  for(let i=0;i<maxRequests;i++){
    const state=store.read();
    // This preflight is read-only. Any drift or unresolved previous
    // request blocks all subsequent HTTP, including after a restart.
    const current=nextFreshCohortBatch(state,manifest);
    if(current.kind==='NEEDS_REVIEW'||current.kind==='SOURCE_COMPLETE'){
      reason=current.kind;break;
    }
    // PLAN_REQUIRED has no READY entries yet. Let the existing
    // runOne... install the immutable plan before its own admission guard.
    if(current.kind!=='PLAN_REQUIRED'){
      const nowMs=clock();
      const admit=evaluateRequestAdmission(state,{
        ...admissionPolicy,nowMs});
      if(!admit.allowed){
        reason=admit.status;break;
      }
    }
    const receipt=await runOneFreshCohortBatch({
      store,manifest,mode:'execute',approved:true,transport,
      admissionPolicy,jobsPerRequest,clock
    });
    if(receipt.attempted===true)attempted++;
    if(receipt.status!=='RECORDED'){
      reason=receipt.status;break;
    }
    need(receipt.attempted===true&&
      typeof receipt.observedRequestPoints==='number'&&
      Number.isFinite(receipt.observedRequestPoints)&&
      receipt.observedRequestPoints>=0,
      'FRESH_BOUNDED_WITNESS_UNCERTAIN');
    recorded++;
    points+=receipt.observedRequestPoints;
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
    maxRequests,jobsPerRequest,automaticRetries:0
  };
}
