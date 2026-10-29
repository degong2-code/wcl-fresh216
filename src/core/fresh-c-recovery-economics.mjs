/**
 * Fresh216 C (Total-ranked exact same-fight BossDPS) recovery economics.
 * Consumes the already validated 216-job adaptive plan and saved Boss page1
 * evidence. No API, Sheets, time estimates, or synthetic "savings" claims.
 *
 * Report candidates below are NOT a paid queue. Dispatch requires a
 * separately approved, checkpointed pilot with real observed point costs.
 */
import {planReportWaves} from './report-wave-plan.mjs';

const check=(ok,code)=>{if(!ok)throw Error(code);};
const fightKey=g=>JSON.stringify([
  g.scopeKey,g.reportCode,g.fightId,g.encounterId,
  g.difficulty,g.reportRevision??null
]);
const countSlots=wave=>wave.fightGroups.reduce(
  (n,g)=>n+g.slots.length,0);
const positive=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;

export function planNamedRecoveryEconomics(adaptive,{
  spentReportFightKeys=[],maxFightsPerWave=4,
  pilotFights=2,observedCost=null
}={}){
  check(adaptive?.jobs===216&&adaptive.rankSlots===21600&&
    Array.isArray(adaptive.jobDecisions)&&
    Array.isArray(adaptive.reportNowGroups)&&
    Array.isArray(adaptive.reportDeferredGroups)&&
    Number.isInteger(maxFightsPerWave)&&
    maxFightsPerWave>=1&&maxFightsPerWave<=8&&
    Number.isInteger(pilotFights)&&pilotFights>=1&&
    pilotFights<=maxFightsPerWave&&
    Array.isArray(spentReportFightKeys),
    'C_RECOVERY_PLAN_INVALID');
  check(observedCost===null||(
    positive(observedCost?.rankingPointsPerPage)&&
    positive(observedCost?.reportPointsPerFight)),
    'C_RECOVERY_COST_NOT_OBSERVED');
  const spent=new Set(spentReportFightKeys);
  check(spent.size===spentReportFightKeys.length&&
    spentReportFightKeys.every(x=>typeof x==='string'&&x.length>0),
    'C_RECOVERY_SPENT_FIGHTS_INVALID');
  const reportGroups=adaptive.reportNowGroups
    .filter(g=>!spent.has(fightKey(g)));
  const deferredGroups=adaptive.reportDeferredGroups
    .filter(g=>!spent.has(fightKey(g)));
  const skipped=adaptive.reportNowGroups.length+
    adaptive.reportDeferredGroups.length-reportGroups.length-
    deferredGroups.length;
  const grouped=planReportWaves({groups:reportGroups},{
    maxFightsPerWave
  });
  const namedSlots=reportGroups.reduce((n,g)=>n+g.slots.length,0);
  const repeated=reportGroups.filter(g=>g.slots.length>1);
  // Page 1 is already paid for and must never be requested again. Page 2
  // eligibility is NOT an expected yield; page 2's marginal gain is unknown.
  const rankable=adaptive.jobDecisions.filter(d=>
    d.pendingNamed>0&&d.lastObservedPage>=1&&
    d.reason!=='WCL_PAGINATION_ENDED');
  const singletonByJob=new Map();
  for(const g of reportGroups){
    if(g.slots.length!==1)continue;
    const slot=g.slots[0];
    singletonByJob.set(slot.jobKey,
      (singletonByJob.get(slot.jobKey)??0)+1);
  }
  const rankingSamples=rankable.map(d=>({
    jobKey:d.jobKey,snapshotSha:d.snapshotSha,
    namedPending:d.pendingNamed,
    observedFirstPage:d.lastObservedPage,
    singletonFightUpperBound:singletonByJob.get(d.jobKey)??0,
    nextPage:d.lastObservedPage+1
  })).sort((a,b)=>
    b.singletonFightUpperBound-a.singletonFightUpperBound||
    b.namedPending-a.namedPending||
    a.jobKey.localeCompare(b.jobKey));
  // Select just one controlled pilot. It is a discovery candidate, not
  // an automatic rank-vs-Report recommendation.
  const reportPilotWaves=planReportWaves({groups:reportGroups},{
    maxFightsPerWave:pilotFights
  }).waves;
  reportPilotWaves.sort((a,b)=>
    b.fightGroups.length-a.fightGroups.length||
    countSlots(b)-countSlots(a)||
    a.waveId.localeCompare(b.waveId));
  const reportPilot=reportPilotWaves[0]??null;
  const rankPilot=rankingSamples[0]??null;
  let scenario=null;
  if(observedCost){
    const {rankingPointsPerPage,reportPointsPerFight}=observedCost;
    const minAvoided=Math.floor(rankingPointsPerPage/reportPointsPerFight)+1;
    scenario={
      inputCostsUserOrPilotSupplied:true,
      notAnObservedYieldOrSavingsEstimate:true,
      rankingPointsPerPage,reportPointsPerFight,
      minimumAvoidedSingletonFightGroupsForStrictBreakEven:minAvoided,
      selectedRankCandidateHasTheoreticalCapacity:
        (rankPilot?.singletonFightUpperBound??0)>=minAvoided
    };
  }
  return {
    status:'READ_ONLY_PILOT_CANDIDATES_NOT_AUTHORIZED',
    namedPendingReferences:adaptive.jobDecisions.reduce(
      (n,d)=>n+d.pendingNamed,0),
    maskedExcluded:adaptive.anonymousRanksExcludedFromReport,
    originalNamedFightCandidates:adaptive.eligibleNamedReportFights,
    eligibleReportFightGroups:reportGroups.length,
    alreadyAttemptedFightGroupsNotToReplay:skipped,
    pendingNamedReferencesInReportCandidates:namedSlots,
    referencesCoalescedWithinFights:namedSlots-reportGroups.length,
    multiReferenceFightGroups:repeated.length,
    reportWavesAtChosenGrouping:grouped.graphQLWaveCount,
    fightGroupsPerWaveMaximum:maxFightsPerWave,
    theoreticalHttpRequestReductionVsOneFightCalls:
      grouped.theoreticalHttpCallsCoalesced,
    reportQueryAliasesForTwoMetrics:grouped.queryRankingsAliases,
    rankingPage2EligibleJobs:rankable.length,
    rankPilot:rankPilot?{
      ...rankPilot,authority:'CANDIDATE_ONLY',
      observedIncrementalPage2Matches:null,
      observedIncrementalPage2Points:null
    }:null,
    reportPilot:reportPilot?{
      wave:reportPilot,jobSlots:countSlots(reportPilot),
      fightGroups:reportPilot.fightGroups.length,
      graphqlAliases:reportPilot.fightGroups.length*2,
      observedPoints:null,verifiedProofs:null,
      authority:'CANDIDATE_ONLY'
    }:null,
    comparison:scenario,
    predictedWclPointSavings:null,
    automaticDispatchAllowed:false,
    requiresSeparateApproval:true
  };
}
