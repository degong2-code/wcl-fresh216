/**
 * P1 private BossDPS host's READ-ONLY handoff from immutable A.
 *
 * Preview never accepts caller-supplied rank rows. It reprojects committed
 * EXACT-100 A witnesses and delegates B grouping to the existing B planner.
 * The result is counts only; no player, report, fight or token information.
 *
 * B may be paid only after an independently attested, COMPLETE A source
 * and a separate immutable B state/owner approval. This function itself
 * never authorizes WCL, writes checkpoints or returns a charged request.
 */
import {makeFreshDatedHeroicManifest,projectCompletedFreshCohort}
  from './fresh-cohort-source.mjs';
import {planFreshBossFirstPages,makeFreshBossFirstPageQuery}
  from './fresh-boss-first-page.mjs';

const need=(valid,code)=>{if(!valid)throw Error(code);};
const sha40=s=>typeof s==='string'&&/^[0-9a-f]{40}$/.test(s);

export function inspectFreshBossHostReadiness({
  sourceState,expectedScopeKey,expectedSourceCommit,
  bossJobsPerRequest=9
}={}){
  need(sourceState?.schema===1&&sourceState.status==='ACTIVE'&&
    typeof expectedScopeKey==='string'&&expectedScopeKey.length>0&&
    sha40(expectedSourceCommit)&&
    [8,9].includes(bossJobsPerRequest),
    'BOSS_HOST_READONLY_INPUT_INVALID');
  need(sourceState.scopeKey===expectedScopeKey&&
    sourceState.sourceCodeCommit===expectedSourceCommit,
    'BOSS_HOST_SOURCE_PIN_MISMATCH');

  const manifest=makeFreshDatedHeroicManifest(expectedScopeKey);
  const source=projectCompletedFreshCohort(sourceState,manifest);
  const complete=source.summary.status==='SOURCE_COMPLETE'&&
    source.summary.jobsCompleted===216&&
    source.summary.rankSlotsCompleted===21600;
  const boss=planFreshBossFirstPages(source.slots,{
    jobsPerRequest:bossJobsPerRequest,allowPartialSource:!complete
  });

  // Validate the shape of EVERY B query without WCL or outputting a raw
  // GraphQL request (the query would contain no actor identity anyway).
  let aliases=0;
  for(const batch of boss.batches){
    const q=makeFreshBossFirstPageQuery(batch);
    need(q.query.includes('metric:bossdps')&&
      batch.jobs.every((j,i)=>q.variables['c'+i]===j.className&&
        q.variables['s'+i]===j.specName)&&
      batch.jobs.length<=bossJobsPerRequest,
      'BOSS_HOST_B_QUERY_DRIFT');
    aliases+=batch.jobs.length;
  }
  need(aliases===source.summary.jobsCompleted&&
    boss.sourceRows===source.summary.rankSlotsCompleted&&
    boss.sourceJobs===source.summary.jobsCompleted,
    'BOSS_HOST_SOURCE_COVERAGE_DRIFT');

  // This is readiness for SEPARATE owner-reviewed host setup only.
  // A partial preview index is NOT stable under future A completions.
  return Object.freeze({
    kind:complete?'BOSS_SOURCE_COMPLETE_READONLY':
      'BOSS_SOURCE_INCOMPLETE_READONLY',
    sourceScopeKey:expectedScopeKey,
    sourceCodeCommit:expectedSourceCommit,
    sourceJobsComplete:source.summary.jobsCompleted,
    sourceJobsRequired:216,
    sourceRankRows:source.summary.rankSlotsCompleted,
    sourceRankRowsRequired:21600,
    sourceJobsPerRequest:source.summary.jobsPerRequest,
    sourceRequestsComplete:source.summary.requestsCompleted,
    nextSourceBatchIndex:source.summary.nextBatchIndex,
    bossJobsPerRequest,
    bossPreviewRequests:boss.batches.length,
    bossPreviewJobs:aliases,
    bossPlanStableForPaidPreparation:complete,
    sourceWitnessComplete:complete,
    paidDispatchAuthorized:false,
    bossRankRowsObserved:0,
    newSameFightProofsObserved:0,
    wclCalls:0,
    gitWrites:0,
    sheetsWrites:0
  });
}
