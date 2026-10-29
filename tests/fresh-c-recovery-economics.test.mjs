import {planFreshNamedCPilot} from '../src/core/fresh-c-pilot.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {planNamedRecoveryEconomics}
  from '../src/core/fresh-c-recovery-economics.mjs';

const scopeKey='heroic:synthetic';
const source=(jobKey,rank)=>({jobKey,rank,snapshotSha:'a'.repeat(64),
  totalDps:100000,className:'Shaman',specName:'Enhancement',name:'Actor'+rank});
const group=(reportCode,fightId,slots)=>({
  scopeKey,reportCode,fightId,encounterId:3470,difficulty:4,
  reportRevision:null,slots
});
const sample=()=>{
  const jobs=Array.from({length:216},(_,i)=>({
    scopeKey,jobKey:'job'+i,snapshotSha:'a'.repeat(64),
    pendingNamed:0,pendingAnonymous:0,lastObservedPage:1,
    reason:'ALREADY_VERIFIED'
  }));
  jobs[0]={...jobs[0],pendingNamed:4,reason:'COST_NOT_MEASURED'};
  jobs[1]={...jobs[1],pendingNamed:1,reason:'COST_NOT_MEASURED'};
  const groups=[
    group('R_A',1,[source('job0',1),source('job0',2)]),
    group('R_A',2,[source('job0',3)]),
    group('R_B',1,[source('job1',4)]),
    group('R_C',1,[source('job0',5)])
  ];
  return {jobs:216,rankSlots:21600,jobDecisions:jobs,
    reportNowGroups:groups,reportDeferredGroups:[],
    eligibleNamedReportFights:4,
    anonymousRanksExcludedFromReport:339};
};
const key=g=>JSON.stringify([
  g.scopeKey,g.reportCode,g.fightId,g.encounterId,
  g.difficulty,g.reportRevision??null
]);
test('coalesces named Report fights but never confuses HTTP count and WCL points',()=>{
  const p=planNamedRecoveryEconomics(sample());
  assert.equal(p.status,'READ_ONLY_PILOT_CANDIDATES_NOT_AUTHORIZED');
  assert.equal(p.originalNamedFightCandidates,4);
  assert.equal(p.eligibleReportFightGroups,4);
  assert.equal(p.pendingNamedReferencesInReportCandidates,5);
  assert.equal(p.referencesCoalescedWithinFights,1);
  assert.equal(p.multiReferenceFightGroups,1);
  assert.equal(p.reportWavesAtChosenGrouping,3);
  assert.equal(p.theoreticalHttpRequestReductionVsOneFightCalls,1);
  assert.equal(p.reportQueryAliasesForTwoMetrics,8);
  assert.equal(p.rankingPage2EligibleJobs,2);
  assert.equal(p.rankPilot.jobKey,'job0');
  assert.equal(p.rankPilot.nextPage,2);
  assert.equal(p.rankPilot.singletonFightUpperBound,2);
  assert.equal(p.reportPilot.fightGroups,2);
  assert.equal(p.reportPilot.jobSlots,3);
  assert.equal(p.reportPilot.graphqlAliases,4);
  assert.equal(p.reportPilot.wave.reportCode,'R_A');
  assert.equal(p.predictedWclPointSavings,null);
  assert.equal(p.automaticDispatchAllowed,false);
  assert.equal(p.requiresSeparateApproval,true);
  assert.equal(p.comparison,null);
});
test('already-attempted Report fight never returns to paid pilot queue',()=>{
  const prior=sample(),spent=key(prior.reportNowGroups[0]);
  const p=planNamedRecoveryEconomics(prior,{
    spentReportFightKeys:[spent]});
  assert.equal(p.alreadyAttemptedFightGroupsNotToReplay,1);
  assert.equal(p.eligibleReportFightGroups,3);
  assert.equal(p.pendingNamedReferencesInReportCandidates,3);
  assert.equal(p.reportWavesAtChosenGrouping,3);
  assert(p.reportPilot.wave.fightGroups.every(g=>key(g)!==spent));
});
test('cost input yields a strict break-even bound, never an expected gain',()=>{
  const p=planNamedRecoveryEconomics(sample(),{
    observedCost:{rankingPointsPerPage:1.01,reportPointsPerFight:2}});
  assert.equal(p.comparison.minimumAvoidedSingletonFightGroupsForStrictBreakEven,1);
  assert.equal(p.comparison.selectedRankCandidateHasTheoreticalCapacity,true);
  assert.equal(p.comparison.notAnObservedYieldOrSavingsEstimate,true);
  assert.equal(p.predictedWclPointSavings,null);
});
test('terminal ranking jobs and masked slots cannot trigger an automatic pilot',()=>{
  const s=sample();
  s.jobDecisions[0].reason='WCL_PAGINATION_ENDED';
  s.jobDecisions[1].reason='WCL_PAGINATION_ENDED';
  const p=planNamedRecoveryEconomics(s);
  assert.equal(p.rankPilot,null);
  assert.equal(p.rankingPage2EligibleJobs,0);
  assert.equal(p.maskedExcluded,339);
  assert.equal(p.automaticDispatchAllowed,false);
});
test('rejects invalid cost, duplicate spent keys and malformed limit',()=>{
  assert.throws(()=>planNamedRecoveryEconomics(sample(),{
    observedCost:{rankingPointsPerPage:0,reportPointsPerFight:1}
  }),/C_RECOVERY_COST_NOT_OBSERVED/);
  const spent=key(sample().reportNowGroups[0]);
  assert.throws(()=>planNamedRecoveryEconomics(sample(),{
    spentReportFightKeys:[spent,spent]
  }),/C_RECOVERY_SPENT_FIGHTS_INVALID/);
  assert.throws(()=>planNamedRecoveryEconomics(sample(),{
    pilotFights:9
  }),/C_RECOVERY_PLAN_INVALID/);
});

test('paid C pilot requires full persisted A and B source, never plans from an empty checkpoint',()=>{
  assert.throws(()=>planFreshNamedCPilot({
    schema:1,status:'ACTIVE',scopeKey:'heroic:synthetic',
    sourceRequests:{},bossPageRequests:{},entries:{},rankRequests:{}
  }),/FRESH_DPS|SCOPE|CHECKPOINT|C_PILOT/);
});
