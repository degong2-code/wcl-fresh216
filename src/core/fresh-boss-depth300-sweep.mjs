/**
 * One-at-a-time official BossDPS page2/page3 collection on the SAME
 * existing private Git checkpoint. No network, credentials or scheduler.
 * Transport is injected only by the separately authorized private host.
 */
import {planFreshBossThrough300} from './fresh-boss-depth300.mjs';
import {registerRankBatch,readyRankBatches}
  from './rank-batch-checkpoint.mjs';
import {executeOneRankBatch} from './rank-batch-runner.mjs';
import {checkpointStats} from './checkpoint.mjs';

const need=(v,c)=>{if(!v)throw Error(c);};

export async function runFreshBossThrough300({
  store,mode='preview',approved=false,
  transport,admissionPolicy,maxRequests=1,clock=Date.now
}={}){
  need(store&&typeof store.read==='function'&&
    typeof store.update==='function'&&
    Number.isSafeInteger(maxRequests)&&maxRequests>=1&&
    maxRequests<=179,'DEPTH300_SWEEP_CONFIG_INVALID');
  const plan=planFreshBossThrough300(store.read());
  if(mode==='preview')return {
    status:'PREVIEW_NOT_AUTHORIZED',
    eligibleJobs:plan.candidateJobs,
    plannedAdditionalPages:plan.candidateAdditionalPages,
    alreadyPaidPage2Jobs:plan.previouslyVisitedPage2Jobs,
    attemptedRequests:0,observedAdditionalPoints:0
  };
  need(mode==='execute'&&approved===true&&
    typeof transport==='function'&&admissionPolicy&&
    typeof clock==='function',
    'DEPTH300_PAID_EXECUTION_NOT_AUTHORIZED');
  const receipts=[];
  for(const candidate of plan.requests.slice(0,maxRequests)){
    // The same durable rank-request entry must be used for every retry-safe
    // resume. A READY entry may be resumed, an attempted one NEVER replayed.
    store.update(s=>registerRankBatch(s,candidate));
    const request=readyRankBatches(store.read()).find(r=>
      r.jobKey===candidate.jobKey&&
      r.snapshotSha===candidate.snapshotSha&&
      r.firstPage===candidate.firstPage&&
      r.pageCount===candidate.pageCount);
    need(request,'DEPTH300_REQUEST_REGISTRATION_DRIFT');
    const result=await executeOneRankBatch({
      store,request,transport,admissionPolicy,clock
    });
    const recorded=store.read().rankRequests?.[request.key];
    const pages=recorded?.result?.pages??[];
    const counts={};
    for(const p of pages)
      counts[p.page]=p.newVerifiedRanks.length;
    receipts.push({
      requestedFirstPage:request.firstPage,
      requestedPageCount:request.pageCount,
      observedPageCount:pages.length,
      status:result.status,
      attempted:result.attempted??false,
      observedPoints:result.observedPoints??null,
      newVerified:result.verified??0,
      page2Gain:counts[2]??0,page3Gain:counts[3]??0,
      terminal:pages.some(p=>p.status==='UNAVAILABLE'||
        p.rowCount<100||p.hasMorePages===false)
    });
    // No second request after a non-durable, uncertain or rejected result.
    if(result.status!=='RECORDED'||
      !Number.isFinite(result.observedPoints))break;
  }
  const statistics=checkpointStats(store.read());
  const successful=receipts.filter(r=>r.status==='RECORDED');
  const allCompleted=successful.length===plan.candidateJobs;
  const last=receipts.at(-1);
  const points=successful.reduce((n,r)=>n+r.observedPoints,0);
  return {
    status:allCompleted?'DEPTH300_COMPLETED':
      last?.status==='NEEDS_REVIEW'?'NEEDS_REVIEW':
      last?.status==='BUDGET_PAUSED'?'BUDGET_PAUSED':
      last?.status==='RATE_WAIT'?'RATE_WAIT':'DEPTH300_PARTIAL',
    requestedJobs:plan.candidateJobs,
    attemptedRequests:receipts.filter(r=>r.attempted).length,
    successfulRequests:successful.length,
    page2NewMatches:successful.reduce((n,r)=>n+r.page2Gain,0),
    page3NewMatches:successful.reduce((n,r)=>n+r.page3Gain,0),
    newMatches:successful.reduce((n,r)=>n+r.newVerified,0),
    observedAdditionalPoints:Math.round(points*100)/100,
    cumulativeObservedPoints:statistics.witnessedPoints,
    unknownPointAttempts:statistics.pointsUnobserved,
    uncertainRequests:statistics.counts.NEEDS_REVIEW+
      statistics.counts.IN_FLIGHT,
    sourceOriginalUnchanged:true,googleSheetsWrites:0,
    receipts
  };
}
