import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {newCheckpoint} from '../src/core/checkpoint.mjs';
import {
  makeFreshDatedHeroicManifest,planFreshCohortBatches,
  installFreshCohortPlan,projectCompletedFreshCohort
} from '../src/core/fresh-cohort-source.mjs';
import {planFreshBossFirstPages,makeFreshBossFirstPageQuery,
  decodeFreshBossFirstPage} from '../src/core/fresh-boss-first-page.mjs';
import {summarizeFreshDpsJob}
  from '../src/core/fresh-dps-output-contract.mjs';
const scope='engine:independent-B-test';
const manifest=makeFreshDatedHeroicManifest(scope);
const hash=o=>createHash('sha256').update(JSON.stringify(o)).digest('hex');
const timestamp=1792594801000;
function sourceJobs({complete=4,sourceAliases=9}={}){
  const p=planFreshCohortBatches(manifest,{
    jobsPerRequest:sourceAliases
  });
  const state=installFreshCohortPlan(newCheckpoint(scope,'offline'),manifest,{
    jobsPerRequest:sourceAliases
  });
  state.sourceCodeCommit='a'.repeat(40);
  for(const b of p.batches.slice(0,complete)){
    const e=state.sourceRequests[b.key];
    e.status='COMPLETED';e.observedPoints=b.jobs.length+0.01;
    e.attempt={id:'offline-'+b.batchIndex,startedAtMs:1,
      kind:'TOTAL_COHORT_BATCH'};
    e.result={jobs:b.jobs.map((j,i)=>{
      const rows=Array.from({length:100},(_,r)=>({
        name:'Actor'+r,amount:200000-r*1100-i,
        reportCode:'R_'+b.batchIndex+'_'+i+'_'+r,
        fightId:r+1,startTime:timestamp+r*1000,
        reportRevision:null
      }));
      return {...j,rows,snapshotSha:hash(rows)};
    })};
  }
  return projectCompletedFreshCohort(state,manifest).slots;
}
function bossReply(batch,{omit=null,unknownPoints=false}={}){
  const encounter={};
  batch.jobs.forEach((j,i)=>{
    if(i===omit)return;
    encounter['b'+i]={rankings:j.slots.map(s=>({
      name:s.name,amount:s.totalDps-100,
      startTime:s.startTime,
      report:{code:s.reportCode,fightID:s.fightId}
    }))};
  });
  return {data:{rateLimitData:{currentRequest:unknownPoints?
    null:JSON.stringify({total:batch.jobs.length+0.01})},
    worldData:{encounter}}};
}
test('8- and 9-alias B plans are independent of the 9-alias A source shape',()=>{
  const partial=sourceJobs();
  assert.equal(partial.length,3600);
  const b8=planFreshBossFirstPages(partial,{
    jobsPerRequest:8,allowPartialSource:true
  });
  const b9=planFreshBossFirstPages(partial,{
    jobsPerRequest:9,allowPartialSource:true
  });
  assert.equal(b8.sourceJobs,36);
  assert.equal(b9.sourceJobs,36);
  assert.equal(b8.batches.length,6);
  assert.equal(b9.batches.length,4);
  assert.deepEqual(b8.batches.map(b=>b.jobs.length),[8,8,8,3,8,1]);
  assert.deepEqual(b9.batches.map(b=>b.jobs.length),[9,9,9,9]);
  assert(b9.batches.every(b=>b.jobs.every(j=>
    j.slots.length===100&&j.snapshotSha===j.slots[0].snapshotSha)));
  assert.equal(b8.readyForAutomaticDispatch,false);
  assert.equal(b9.readyForAutomaticDispatch,false);
  assert.equal(b9.partialSource,true);
  const full=sourceJobs({complete:24});
  const full8=planFreshBossFirstPages(full,{jobsPerRequest:8});
  const full9=planFreshBossFirstPages(full,{jobsPerRequest:9});
  assert.equal(full8.batches.length,32);
  assert.equal(full9.batches.length,24);
  assert.equal(full8.sourceJobs,216);
  assert.equal(full9.sourceRows,21600);
  assert.equal(full9.partialSource,false);
  assert.deepEqual(
    full8.batches.flatMap(b=>b.jobs.map(j=>j.jobKey)).sort(),
    full9.batches.flatMap(b=>b.jobs.map(j=>j.jobKey)).sort()
  );
});
test('9-alias official B query and all-or-nothing decoder use independent exact A provenance',()=>{
  const batch=planFreshBossFirstPages(sourceJobs(),{
    jobsPerRequest:9,allowPartialSource:true
  }).batches[0];
  const query=makeFreshBossFirstPageQuery(batch);
  assert.equal((query.query.match(/metric:bossdps/g)||[]).length,9);
  assert.equal((query.query.match(/characterRankings\(/g)||[]).length,9);
  assert.equal(query.variables.s8,batch.jobs[8].specName);
  assert.doesNotMatch(query.query,/partition:|metric:dps,/);
  const decoded=decodeFreshBossFirstPage(batch,200,bossReply(batch));
  assert.equal(decoded.status,'OK');
  assert.equal(decoded.observedPoints,9.01);
  assert.equal(decoded.result.verifiedCount,900);
  assert.equal(decoded.result.jobs.length,9);
  const job=decoded.result.jobs[0];
  const kpi=summarizeFreshDpsJob({
    totalRankSlots:batch.jobs[0].slots,
    bossPage:job,
    verifiedProofs:job.verified
  });
  assert.equal(kpi.verifiedRanks,100);
  assert.equal(kpi.bossRankingStatus,'EXACT100');
  assert.equal(kpi.nonBossShare[0],0.0005);
});
test('a single missing alias or unknown WCL cost invalidates the 9-alias batch',()=>{
  const batch=planFreshBossFirstPages(sourceJobs(),{
    jobsPerRequest:9,allowPartialSource:true
  }).batches[0];
  assert.equal(decodeFreshBossFirstPage(batch,200,
    bossReply(batch,{omit:8})).status,'FRESH_BOSS_ALIAS_MISSING');
  assert.equal(decodeFreshBossFirstPage(batch,200,
    bossReply(batch,{unknownPoints:true})).status,
    'FRESH_BOSS_RESPONSE_OR_COST_UNKNOWN');
});
test('unknown jobs, missing ranks, wrong SHA, and incomplete source are rejected',()=>{
  const slots=sourceJobs();
  assert.throws(()=>planFreshBossFirstPages(slots),
    /FULL_SCOPE|EXACT|216|SOURCE|SCOPE|JOB|RANK/);
  assert.throws(()=>planFreshBossFirstPages(slots,{
    jobsPerRequest:10,allowPartialSource:true
  }),/FRESH_BOSS_PLAN_OPTIONS_INVALID/);
  for(const type of ['missing','foreign','rank','digest']){
    const bad=structuredClone(slots);
    if(type==='missing')bad.pop();
    if(type==='foreign')bad[0].jobKey='NOT_IN_MANIFEST';
    if(type==='rank')bad[0].rank=2;
    if(type==='digest')bad[0].snapshotSha='f'.repeat(64);
    assert.throws(()=>planFreshBossFirstPages(bad,{
      jobsPerRequest:9,allowPartialSource:true
    }),/FRESH_BOSS_/);
  }
});
test('partial source B plans never authorize a paid run by themselves',()=>{
  const slots=sourceJobs();
  const b=planFreshBossFirstPages(slots,{
    jobsPerRequest:9,allowPartialSource:true
  });
  assert.equal(b.readyForAutomaticDispatch,false);
  assert.equal(b.partialSource,true);
  assert.equal(b.batches.reduce((n,x)=>n+x.jobs.length,0),36);
});
