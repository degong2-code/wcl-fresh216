/**
 * Read-only source-origin/execution-code compatibility gate for A continuation.
 *
 * The checkpoint's sourceCodeCommit is immutable PROVENANCE, not the
 * version of the code allowed to execute the next owner-approved batch.
 * Compare all exported source paid-path functions by their actual JS text,
 * and independently compare the complete 216-job plan and GraphQL payloads
 * against the ORIGINAL pinned code. Validate already-committed A witnesses
 * with the successor's existing projector. This does not call WCL, persist
 * state, or grant any owner authorization.
 */
import {createHash} from 'node:crypto';
import {projectCompletedFreshCohort}
  from './fresh-cohort-source.mjs';

const need=(ok,code)=>{if(!ok)throw Error(code);};
const digest=o=>createHash('sha256')
  .update(JSON.stringify(o)).digest('hex');
const keys=Object.freeze([
  'makeFreshDatedHeroicManifest',
  'validateFreshCohortManifest',
  'planFreshCohortBatches',
  'buildFreshCohortQuery',
  'installFreshCohortPlan',
  'nextFreshCohortBatch',
  'beginFreshCohortBatch',
  'decodeFreshCohortBatch',
  'finishFreshCohortBatch',
  'uncertainFreshCohortBatch',
  'runOneFreshCohortBatch'
]);
export function attestFreshCohortExecutionCompatibility({
  sourceState,originCore,successorCore,
  expectedScopeKey,expectedOriginCommit
}={}){
  need(sourceState?.schema===1&&
    sourceState.status==='ACTIVE'&&
    sourceState.sourceCodeCommit===expectedOriginCommit&&
    typeof expectedOriginCommit==='string'&&
    /^[0-9a-f]{40}$/.test(expectedOriginCommit)&&
    expectedScopeKey===sourceState.scopeKey&&
    sourceState.sourceJobsPerRequest===9&&
    sourceState.sourceManifestSha&&
    Object.keys(sourceState.entries??{}).length===0&&
    Object.keys(sourceState.rankRequests??{}).length===0&&
    Object.keys(sourceState.bossPageRequests??{}).length===0,
    'FRESH_SOURCE_COMPAT_ORIGIN_INVALID');
  need(originCore&&successorCore,
    'FRESH_SOURCE_COMPAT_MODULES_REQUIRED');
  // Fail on ANY edited paid-path exported routine. The quota admission
  // module is intentionally independent and may differ in the successor.
  for(const k of keys){
    need(typeof originCore[k]==='function'&&
      typeof successorCore[k]==='function'&&
      String(originCore[k])===String(successorCore[k]),
      'FRESH_SOURCE_COMPAT_PAID_FUNCTION_DRIFT');
  }
  const origin=originCore.makeFreshDatedHeroicManifest(expectedScopeKey);
  const current=successorCore.makeFreshDatedHeroicManifest(expectedScopeKey);
  need(digest(origin)===digest(current),
    'FRESH_SOURCE_COMPAT_MANIFEST_DRIFT');
  const oldPlan=originCore.planFreshCohortBatches(origin,{
    jobsPerRequest:9
  });
  const newPlan=successorCore.planFreshCohortBatches(current,{
    jobsPerRequest:9
  });
  need(oldPlan.requestCount===24&&newPlan.requestCount===24&&
    oldPlan.totalJobs===216&&newPlan.totalJobs===216&&
    digest(oldPlan)===digest(newPlan)&&
    sourceState.sourceManifestSha===oldPlan.manifestSha,
    'FRESH_SOURCE_COMPAT_PLAN_DRIFT');
  const allQueries=[];
  for(let i=0;i<oldPlan.batches.length;i++){
    const a=originCore.buildFreshCohortQuery(oldPlan.batches[i]);
    const b=successorCore.buildFreshCohortQuery(newPlan.batches[i]);
    need(digest(a)===digest(b)&&
      a.query.includes('metric:dps,page:1,filter:$filter')&&
      !a.query.includes('metric:bossdps'),
      'FRESH_SOURCE_COMPAT_QUERY_DRIFT');
    allQueries.push(digest(a));
  }
  const prior=originCore.nextFreshCohortBatch(sourceState,origin);
  const next=successorCore.nextFreshCohortBatch(sourceState,current);
  need(digest(prior)===digest(next)&&
    next.kind==='SOURCE_BATCH'&&
    Number.isSafeInteger(next.batch?.batchIndex)&&
    next.batch.batchIndex>=1&&next.batch.batchIndex<24,
    'FRESH_SOURCE_COMPAT_NEXT_BATCH_NOT_READY');
  const projected=projectCompletedFreshCohort(sourceState,current);
  const p=projected.summary;
  need(p.status==='SOURCE_BATCH'&&
    p.jobsCompleted>0&&p.jobsCompleted<216&&
    p.rankSlotsCompleted===p.jobsCompleted*100&&
    p.requestsCompleted*9===p.jobsCompleted&&
    p.nextBatchIndex===next.batch.batchIndex&&
    p.requestsRequired===24,
    'FRESH_SOURCE_COMPAT_SNAPSHOT_DRIFT');
  return Object.freeze({
    status:'FRESH_SOURCE_ORIGIN_COMPATIBILITY_PASS',
    sourceOriginCommit:expectedOriginCommit,
    scopeKey:expectedScopeKey,
    sourceJobs:p.jobsCompleted,
    sourceRows:p.rankSlotsCompleted,
    nextBatchIndex:p.nextBatchIndex,
    sourceRequestsCompleted:p.requestsCompleted,
    queryPlanSha256:digest(allQueries),
    paidPathFunctionsCompared:keys.length,
    verifiedSnapshotRows:p.rankSlotsCompleted,
    ownerApproved:false,wclCalls:0,gitWrites:0,sheetsWrites:0
  });
}
