/**
 * Fresh216 complete pipeline: immutable A source -> independent B leaderboard
 * -> C same-fight proofs -> exact three-family KPIs and recovery preview.
 *
 * The source is read from the existing private checkpoint. No network or
 * Sheets I/O here. The optional sweep delegates every WCL call and each
 * durable pre/post-HTTP Git commit to runOneFreshBossWave().
 */
import {makeFreshDatedHeroicManifest,exportVerifiedFreshCohort}
  from './fresh-cohort-source.mjs';
import {planFreshBossFirstPages} from './fresh-boss-first-page.mjs';
import {runOneFreshBossWave} from './fresh-boss-wave-journal.mjs';
import {summarizeFreshDpsJob} from './fresh-dps-output-contract.mjs';
import {committedProofs,checkpointStats} from './checkpoint.mjs';
import {committedRankingEvidence} from './rank-batch-checkpoint.mjs';
import {planAdaptive216} from './adaptive-depth-plan.mjs';
import {planNamedRecoveryEconomics} from './fresh-c-recovery-economics.mjs';

const need=(v,c)=>{if(!v)throw Error(c);};
const slotId=s=>JSON.stringify([s.jobKey,s.rank,s.snapshotSha]);
const proofId=p=>JSON.stringify([p.proofType,p.actorRef,p.bossDps,
  p.snapshotSha,p.reportCode,p.fightId,p.encounterId,p.difficulty,
  p.reportRevision??null,p.sourceStartTime??null]);
const masked=x=>!String(x??'').trim()||
  /^anonymous$/i.test(x.trim())||
  /^player\s*\(\d+\)$/i.test(x.trim());

/** Read-only. No actor identifiers leave this module unless caller logs them. */
export function inspectFreshDpsPipeline(state,{includeOutputs=false,
  recoveryEconomics=null}={}){
  need(state?.schema===1&&state.status==='ACTIVE',
    'FRESH_DPS_STATE_NOT_ACTIVE');
  const stats=checkpointStats(state);
  if(stats.counts.IN_FLIGHT||stats.counts.NEEDS_REVIEW||
    stats.pointsUnobserved)
    return {stage:'NEEDS_REVIEW',safeToDispatch:false,
      inFlight:stats.counts.IN_FLIGHT,needsReview:stats.counts.NEEDS_REVIEW,
      observedPoints:stats.witnessedPoints};
  const manifest=makeFreshDatedHeroicManifest(state.scopeKey);
  const source=exportVerifiedFreshCohort(state,manifest);
  const plan=planFreshBossFirstPages(source.slots);
  const entries=state.bossPageRequests??{};
  let complete=0,officialBossRows=0,linkedFromB=0;
  const bossByJob=new Map();
  let nextBatch=null;
  for(const batch of plan.batches){
    const e=entries['page1:'+batch.batchIndex];
    if(!e){
      if(nextBatch===null)nextBatch=batch;
      continue;
    }
    need(e.batchIndex===batch.batchIndex&&
      e.scopeKey===state.scopeKey&&
      e.sourceCommit===state.sourceCodeCommit,
      'FRESH_DPS_BOSS_CHECKPOINT_IDENTITY');
    if(e.status==='READY'){
      need(nextBatch===null,'FRESH_DPS_BOSS_CHECKPOINT_GAP');
      nextBatch=batch;
      continue;
    }
    need(e.status==='COMPLETED'&&nextBatch===null&&
      Array.isArray(e.result?.jobs)&&
      e.result.jobs.length===batch.jobs.length&&
      Number.isFinite(e.observedPoints),
      'FRESH_DPS_BOSS_CHECKPOINT_NOT_COMPLETE');
    complete++;
    for(const job of e.result.jobs){
      need(!bossByJob.has(job.jobKey)&&
        job.snapshotSha===batch.jobs.find(j=>j.jobKey===job.jobKey)?.snapshotSha&&
        Array.isArray(job.rankings)&&
        job.rankings.length<=100,
        'FRESH_DPS_BOSS_JOB_DRIFT');
      bossByJob.set(job.jobKey,job);
      officialBossRows+=job.rankings.length;
      linkedFromB+=job.verified.length;
    }
  }
  need(Object.keys(entries).length===complete+(nextBatch&&
    entries['page1:'+nextBatch.batchIndex]?1:0),
    'FRESH_DPS_BOSS_UNKNOWN_REQUEST');
  const sourceByJob=new Map(plan.batches.flatMap(b=>b.jobs)
    .map(j=>[j.jobKey,j.slots]));
  const proofs=new Map();
  for(const p of committedProofs(state)){
    const k=slotId(p),previous=proofs.get(k);
    need(!previous||proofId(previous.proof)===proofId(p.proof),
      'FRESH_DPS_CONFLICTING_SAME_FIGHT_PROOFS');
    proofs.set(k,p);
  }
  const outputs=[],updatedSlots=[];
  let exactLinked=0,pendingNamed=0,pendingMasked=0,
      bossKpiCells=0,uYCells=0;
  for(const [jobKey,slots] of sourceByJob){
    const attached=slots.flatMap(s=>{
      const row=proofs.get(slotId(s));
      if(!row){
        if(masked(s.name))pendingMasked++;
        else pendingNamed++;
        updatedSlots.push(s);
        return [];
      }
      updatedSlots.push({...s,status:'VERIFIED',proof:row.proof});
      return [row];
    });
    const result=summarizeFreshDpsJob({
      totalRankSlots:slots,bossPage:bossByJob.get(jobKey)??null,
      verifiedProofs:attached
    });
    exactLinked+=result.verifiedRanks;
    bossKpiCells+=result.bossRankedDpsMetrics
      .filter(Number.isFinite).length;
    uYCells+=result.nonBossShare.filter(Number.isFinite).length;
    outputs.push(result);
  }
  need(outputs.length===216&&
    exactLinked+pendingNamed+pendingMasked===21600,
    'FRESH_DPS_PROJECTION_COVERAGE');
  const summary={
    sourceJobs:216,sourceRankRows:21600,
    bossPage1BatchesCompleted:complete,
    bossPage1BatchesRequired:32,
    bossJobsCompleted:bossByJob.size,
    bossRankRows:officialBossRows,
    sameFightProofs:exactLinked,
    firstPageSameFightProofs:linkedFromB,
    remainingNamed:pendingNamed,remainingMasked:pendingMasked,
    bossKpiCells,uYCells,
    observedWclPoints:stats.witnessedPoints,
    nextBossBatchIndex:nextBatch?.batchIndex??null,
    inFlight:0,needsReview:0
  };
  const result={stage:nextBatch?'BOSS_PAGE1':'RECOVERY_REVIEW',
    safeToDispatch:false,summary};
  if(includeOutputs)result.outputs=outputs;
  if(nextBatch)result.nextBossBatch=nextBatch;
  else{
    const recovery=planAdaptive216(updatedSlots,{
      pageEvidence:committedRankingEvidence(state),
      economics:recoveryEconomics
    });
    const spentReportFightKeys=Object.values(state.entries??{})
      .filter(e=>e.attempt).map(e=>JSON.stringify([
        e.identity.scopeKey,e.identity.reportCode,e.identity.fightId,
        e.identity.encounterId,e.identity.difficulty,
        e.identity.reportRevision??null
      ]));
    const portfolio=planNamedRecoveryEconomics(recovery,{
      spentReportFightKeys,observedCost:recoveryEconomics
    });
    result.recovery={
      status:recoveryEconomics?'COST_INPUT_POLICY_PREVIEW':
        'COST_INPUT_NEEDED_BEFORE_PAID_RECOVERY',
      namedPending:pendingNamed,maskedPending:pendingMasked,
      nextRankingJobs:recovery.rankingCandidates.length,
      reportFightsCurrentlyProposed:recovery.reportNowGroups.length,
      reportFightsDeferred:recovery.reportDeferredGroups.length,
      reportWaveCountAtFourFights:portfolio.reportWavesAtChosenGrouping,
      reportQueryAliasesForTwoMetrics:
        portfolio.reportQueryAliasesForTwoMetrics,
      reportFightGroupsAlreadyAttempted:
        portfolio.alreadyAttemptedFightGroupsNotToReplay,
      multiReferenceFightGroups:portfolio.multiReferenceFightGroups,
      referencesCoalescedWithinFights:
        portfolio.referencesCoalescedWithinFights,
      rankingPage2EligibleJobs:portfolio.rankingPage2EligibleJobs,
      rankPilot:portfolio.rankPilot?{
        namedPending:portfolio.rankPilot.namedPending,
        singletonFightUpperBound:
          portfolio.rankPilot.singletonFightUpperBound,
        nextPage:portfolio.rankPilot.nextPage,
        observedIncrementalPage2Points:null,
        observedIncrementalPage2Matches:null
      }:null,
      reportPilot:portfolio.reportPilot?{
        fightGroups:portfolio.reportPilot.fightGroups,
        jobSlots:portfolio.reportPilot.jobSlots,
        graphqlAliases:portfolio.reportPilot.graphqlAliases,
        observedPoints:null,verifiedProofs:null
      }:null,
      costBreakEvenScenario:portfolio.comparison?{
        minimumAvoidedSingletonFightGroups:
          portfolio.comparison.minimumAvoidedSingletonFightGroupsForStrictBreakEven,
        theoreticalOpportunityOnly:true,
        actualIncrementalGainUnmeasured:true
      }:null,
      estimatedPointSavings:null,
      dispatchAuthorized:false
    };
  }
  return result;
}

/** One permission covers at most maxRequests *new* Boss page1 calls.
 * Remaining completed batches are skipped without charging/re-querying.
 * No scheduled/background work; the private GitHub job owns all execution.
 */
export async function runFreshBossPage1Sweep({store,mode='preview',
  approved=false,transport,admissionPolicy,maxRequests=1,
  clock=Date.now}={}){
  need(store&&typeof store.read==='function'&&
    typeof store.update==='function'&&
    Number.isInteger(maxRequests)&&maxRequests>=1&&maxRequests<=31,
    'FRESH_DPS_SWEEP_CONFIG_INVALID');
  const before=inspectFreshDpsPipeline(store.read());
  if(mode==='preview')return {
    status:'PREVIEW',stage:before.stage,
    summary:before.summary??null,
    maxRequestsAllowed:maxRequests,actualRequests:0
  };
  need(mode==='execute'&&approved===true&&
    typeof transport==='function'&&admissionPolicy&&
    typeof clock==='function',
    'FRESH_DPS_SWEEP_PAID_NOT_AUTHORIZED');
  const receipts=[];
  for(let i=0;i<maxRequests;i++){
    const snapshot=inspectFreshDpsPipeline(store.read());
    if(snapshot.stage!=='BOSS_PAGE1')break;
    const single=await runOneFreshBossWave({
      store,batch:snapshot.nextBossBatch,mode:'execute',
      approved:true,transport,admissionPolicy,clock
    });
    receipts.push({
      batchIndex:single.batchIndex??snapshot.nextBossBatch.batchIndex,
      status:single.status,attempted:single.attempted??false,
      observedPoints:single.observedPoints??null,
      verifiedSameFight:single.verifiedSameFight??null
    });
    // Explicitly fail closed on a disputed/unknown WCL response.
    if(single.status!=='RECORDED')break;
  }
  const after=inspectFreshDpsPipeline(store.read());
  return {
    status:after.stage==='NEEDS_REVIEW'?'NEEDS_REVIEW':
      after.stage==='RECOVERY_REVIEW'?'BOSS_PAGE1_COMPLETE':
      receipts.length&&receipts.at(-1).status!=='RECORDED'?
        receipts.at(-1).status:'BOSS_PAGE1_PARTIAL',
    requestsAttempted:receipts.filter(x=>x.attempted).length,
    receipts,summary:after.summary??null,
    nextBossBatchIndex:after.summary?.nextBossBatchIndex??null
  };
}
