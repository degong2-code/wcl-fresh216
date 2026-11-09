import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {newCheckpoint} from '../src/core/checkpoint.mjs';
import {
  makeFreshDatedHeroicManifest,installFreshCohortPlan,
  planFreshCohortBatches,projectCompletedFreshCohort,
  exportVerifiedFreshCohort
} from '../src/core/fresh-cohort-source.mjs';
import {inspectFresh216EngineContract}
  from '../src/core/fresh216-engine-contract.mjs';

const scope='contract:heroic:oct22_27';
const manifest=makeFreshDatedHeroicManifest(scope);
const digest=x=>createHash('sha256')
  .update(JSON.stringify(x)).digest('hex');
const starts=1792594801000;
function seed({aliases=9,completed=1}={}){
  const state=installFreshCohortPlan(
    newCheckpoint(scope,'contract-source'),manifest,
    {jobsPerRequest:aliases}
  );
  state.sourceCodeCommit='f'.repeat(40);
  const batches=planFreshCohortBatches(manifest,{
    jobsPerRequest:aliases
  }).batches;
  for(const b of batches.slice(0,completed)){
    const e=state.sourceRequests[b.key];
    e.status='COMPLETED';
    e.observedPoints=b.jobs.length+0.01;
    e.attempt={id:'synthetic:'+b.batchIndex,
      kind:'TOTAL_COHORT_BATCH',startedAtMs:starts};
    e.result={jobs:b.jobs.map((j,i)=>{
      const rows=Array.from({length:100},(_,n)=>({
        name:'Actor'+n,amount:200000-n*1000-i,
        reportCode:'R_'+b.batchIndex+'_'+i+'_'+n,
        fightId:n+1,startTime:starts+n*1000,
        reportRevision:null
      }));
      return {...j,rows,snapshotSha:digest(rows)};
    })};
  }
  return state;
}
function evidences(state){
  const {slots}=projectCompletedFreshCohort(state,manifest);
  const job=slots[0].jobKey;
  const a=slots.filter(s=>s.jobKey===job);
  const reordered=[a[1],a[0],...a.slice(2)];
  const rankings=reordered.map((r,n)=>({
    name:r.name,amount:n===0?180000:n===1?170000:
      100000-(n-2)*100,
    startTime:r.startTime,report:{code:r.reportCode,fightID:r.fightId}
  }));
  const bossPage={jobKey:job,snapshotSha:a[0].snapshotSha,
    rankings,rankingsStatus:'EXACT100',
    bossRankingSha:digest(rankings)};
  const proofs=rankings.map(r=>{
    const s=a.find(row=>row.reportCode===r.report.code);
    return {jobKey:job,rank:s.rank,snapshotSha:s.snapshotSha,proof:{
      proofType:'EXACT_SAME_FIGHT_ACTOR',
      actorRef:'name:'+s.name.toLowerCase(),
      bossDps:r.amount,
      snapshotSha:s.snapshotSha,reportCode:s.reportCode,
      fightId:s.fightId,encounterId:s.encounterId,
      difficulty:s.difficulty,reportRevision:null,
      sourceStartTime:s.startTime,
      discovery:{kind:'BOSSDPS_RANKING_PAGE',page:1}
    }};
  });
  return {bossPage,proofs};
}
test('partial 9-alias source produces safe A-only KPI previews without claiming whole run',()=>{
  const state=seed();
  const before=JSON.stringify(state);
  const result=inspectFresh216EngineContract({
    sourceState:state,manifest,includeOutputs:true
  });
  assert.equal(result.kind,'A_SOURCE_PARTIAL');
  assert.equal(result.safeToPublish,false);
  assert.equal(result.summary.sourceJobsPerRequest,9);
  assert.equal(result.summary.sourceRequestsRequired,24);
  assert.equal(result.summary.sourceRequestsCompleted,1);
  assert.equal(result.summary.sourceJobsCompleted,9);
  assert.equal(result.summary.sourceRankRows,900);
  assert.equal(result.summary.sourceNextBatchIndex,1);
  assert.equal(result.summary.bossJobsExact100,0);
  assert.equal(result.summary.exactSameFightRanks,0);
  assert.equal(result.summary.nonBossMetricCells,0);
  assert.equal(result.outputs.length,9);
  for(const output of result.outputs){
    assert.equal(output.totalDpsMetrics.length,5);
    assert(output.totalDpsMetrics.every(Number.isFinite));
    assert.deepEqual(output.bossRankedDpsMetrics,Array(5).fill(null));
    assert.deepEqual(output.nonBossShare,Array(5).fill(null));
  }
  assert.equal(JSON.stringify(state),before);
});
test('one verified A/B/C job uses existing independent ranks and exact U:Y engine',()=>{
  const state=seed();
  const {bossPage,proofs}=evidences(state);
  const result=inspectFresh216EngineContract({
    sourceState:state,manifest,bossPages:[bossPage],
    proofRows:proofs,includeOutputs:true
  });
  assert.equal(result.summary.sourceJobsCompleted,9);
  assert.equal(result.summary.bossJobsExact100,1);
  assert.equal(result.summary.bossRankRows,100);
  assert.equal(result.summary.exactSameFightRanks,100);
  assert.equal(result.summary.nonBossMetricCells,5);
  assert.equal(result.safeToPublish,false);
  const one=result.outputs.find(o=>o.jobKey===bossPage.jobKey);
  assert.equal(one.status,'EXACT100');
  assert.equal(one.bossRankedDpsMetrics[0],180000);
  assert.equal(one.totalRankJoinedBossDpsMetrics[0],170000);
  assert.equal(one.totalDpsMetrics[0],200000);
  assert.equal(one.nonBossShare[0],0.15);
  assert(result.outputs.filter(o=>o.jobKey!==bossPage.jobKey)
    .every(o=>o.nonBossShare.every(v=>v===null)));
});
test('wrong fight, false leaderboard hash and unknown A rank are rejected',()=>{
  const state=seed();
  const {bossPage,proofs}=evidences(state);
  const badProofs=structuredClone(proofs);
  badProofs[0].proof.fightId=555;
  assert.throws(()=>inspectFresh216EngineContract({
    sourceState:state,manifest,bossPages:[bossPage],
    proofRows:badProofs
  }),/DPS_PROOF_FIGHT_ACTOR_INVALID/);
  const badBoss=structuredClone(bossPage);
  badBoss.rankings[0].amount+=1;
  assert.throws(()=>inspectFresh216EngineContract({
    sourceState:state,manifest,bossPages:[badBoss]
  }),/DPS_BOSS_RANKING_WITNESS_INVALID/);
  assert.throws(()=>inspectFresh216EngineContract({
    sourceState:state,manifest,
    proofRows:[{...proofs[0],jobKey:'UNRECORDED_JOB'}]
  }),/ENGINE_CONTRACT_PROOF_UNKNOWN_OR_DUPLICATE/);
});
test('both 8 and 9-alias completed batches use same downstream contract',()=>{
  for(const n of [8,9]){
    const result=inspectFresh216EngineContract({
      sourceState:seed({aliases:n}),manifest
    });
    assert.equal(result.summary.sourceJobsPerRequest,n);
    assert.equal(result.summary.sourceJobsCompleted,n);
    assert.equal(result.summary.sourceRankRows,n*100);
    assert.equal(result.summary.sourceRequestsRequired,n===8?32:24);
  }
});
test('tampering or unresolved paid attempt rejects read-only data promotion',()=>{
  const state=seed(),batch=Object.values(state.sourceRequests)
    .find(e=>e.status==='COMPLETED');
  batch.result.jobs[0].rows[0].amount+=123;
  assert.throws(()=>inspectFresh216EngineContract({
    sourceState:state,manifest
  }),/FRESH_COHORT_EXPORT_DRIFT/);
  const attempt=seed();
  const pending=Object.values(attempt.sourceRequests)
    .find(e=>e.status==='READY');
  pending.status='IN_FLIGHT';
  pending.attempt={id:'unknown-paid-charge',
    startedAtMs:starts,kind:'TOTAL_COHORT_BATCH'};
  assert.throws(()=>projectCompletedFreshCohort(attempt,manifest),
    /FRESH_COHORT_PROJECTION_NOT_READY/);
});
test('full A export reuses identical strict projector and still requires all 216 jobs',()=>{
  const partial=seed({completed:1});
  assert.throws(()=>exportVerifiedFreshCohort(partial,manifest),
    /FRESH_COHORT_INCOMPLETE/);
  const full=seed({completed:24});
  const projection=projectCompletedFreshCohort(full,manifest);
  const exportResult=exportVerifiedFreshCohort(full,manifest);
  assert.equal(exportResult.summary.rankSlots,21600);
  assert.equal(projection.summary.jobsCompleted,216);
  assert.deepEqual(projection.slots,exportResult.slots);
  const inspected=inspectFresh216EngineContract({
    sourceState:full,manifest
  });
  assert.equal(inspected.summary.totalJobsComplete,true);
  assert.equal(inspected.summary.endToEndComplete,false);
  assert.equal(inspected.kind,'B_C_EVIDENCE_PENDING');
});
