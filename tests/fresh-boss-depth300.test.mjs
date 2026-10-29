import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {newCheckpoint,beginFetch,checkpointStats} from '../src/core/checkpoint.mjs';
import {makeFreshDatedHeroicManifest,installFreshCohortPlan,
  planFreshCohortBatches,exportVerifiedFreshCohort}
  from '../src/core/fresh-cohort-source.mjs';
import {planFreshBossThrough300}
  from '../src/core/fresh-boss-depth300.mjs';
import {runFreshBossThrough300}
  from '../src/core/fresh-boss-depth300-sweep.mjs';
import {registerRankBatch,beginRankBatch,completeRankBatch}
  from '../src/core/rank-batch-checkpoint.mjs';

const scope='heroic:2026-10-22_27:latest:source';
const original='7b1a075ad2663c8aa07734b7733cbe81bf9c6071';
const checksum=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const manifest=makeFreshDatedHeroicManifest(scope);
function completedSource(){
  let state=installFreshCohortPlan(newCheckpoint(scope,'synthetic-pinned'),manifest);
  state.sourceCodeCommit=original;
  const batches=planFreshCohortBatches(manifest).batches;
  for(const batch of batches){
    const e=state.sourceRequests[batch.key];
    e.status='COMPLETED';e.observedPoints=8;
    e.attempt={id:'source-'+batch.batchIndex,startedAtMs:12};
    e.result={jobs:batch.jobs.map((j,i)=>{
      const rows=Array.from({length:100},(_,rank)=>({
        name:'Actor'+rank,amount:200000-rank*100,
        reportCode:'R'+batch.batchIndex+'-'+i+'-'+rank,
        fightId:rank+1,startTime:1792594801000+rank*1000,
        reportRevision:null
      }));
      return {...j,rows,snapshotSha:checksum(rows)};
    })};
    const boss=state.bossPageRequests??={};
    boss['page1:'+batch.batchIndex]={
      status:'COMPLETED',key:'page1:'+batch.batchIndex,
      sourceCommit:original,scopeKey:scope,
      observedPoints:8,attempt:{
        id:'boss-'+batch.batchIndex,startedAtMs:13},
      result:{jobs:e.result.jobs.map(j=>({
        jobKey:j.jobKey,snapshotSha:j.snapshotSha,
        pages:[{page:1,status:'OK',rowCount:100,
          hasMorePages:true,newVerifiedRanks:[]}],
        verified:[]
      }))}
    };
  }
  return state;
}
const initial=completedSource();
const mem=s=>{let value=structuredClone(s),updates=0;
  return {read:()=>structuredClone(value),update:fn=>{
    const next=fn(structuredClone(value));
    assert.equal(next.version,value.version+1);
    value=next;updates++;return structuredClone(value);
  },get updates(){return updates;}};
};
test('216-job frozen Boss page1 permits exactly 2 extra pages per named job',async()=>{
  const plan=planFreshBossThrough300(initial);
  assert.equal(plan.jobs,216);
  assert.equal(plan.originalTotalRows,21600);
  assert.equal(plan.candidateJobs,216);
  assert.equal(plan.candidateAdditionalPages,432);
  assert(plan.requests.every(r=>r.firstPage===2&&r.pageCount===2));
  const store=mem(initial),before=store.read();
  const preview=await runFreshBossThrough300({store,mode:'preview'});
  assert.equal(preview.eligibleJobs,216);
  assert.equal(store.updates,0);
  assert.deepEqual(store.read(),before);
  let calls=0;
  const result=await runFreshBossThrough300({store,
    mode:'execute',approved:true,maxRequests:1,
    clock:()=>100,admissionPolicy:{
      notBeforeMs:0,maxObservedPoints:2000,reservePoints:5
    },transport:async q=>{
      calls++;
      assert.equal((q.query.match(/metric:bossdps/g)||[]).length,2);
      assert(q.query.includes('page:2')&&q.query.includes('page:3'));
      assert(!q.query.includes('metric:dps,'));
      assert(!q.query.includes('partition:'));
      const source=exportVerifiedFreshCohort(initial,manifest);
      const req=plan.requests[0],slots=source.slots.filter(s=>
        s.jobKey===req.jobKey);
      const pages=[2,3].map(p=>({rankings:Array.from({length:100},
        (_,i)=>p===3&&i<5?({
          name:slots[i].name,amount:slots[i].totalDps-150,
          startTime:slots[i].startTime,
          report:{code:slots[i].reportCode,fightID:slots[i].fightId}
        }):({name:'Different'+p+'-'+i,amount:100,
          startTime:1792594801000+i*1000,
          report:{code:'Other'+p+'-'+i,fightID:999+i}
        })),hasMorePages:true}));
      assert.equal(checkpointStats(store.read()).counts.IN_FLIGHT,1);
      return {httpStatus:200,body:{data:{
        rateLimitData:{currentRequest:{total:2.01}},
        worldData:{encounter:{b0:pages[0],b1:pages[1]}}}}};
    }
  });
  assert.equal(calls,1);
  assert.equal(result.attemptedRequests,1);
  assert.equal(result.newMatches,5);
  assert.equal(result.page2NewMatches,0);
  assert.equal(result.page3NewMatches,5);
  assert.equal(result.receipts[0].observedPoints,2.01);
  assert.equal(store.updates,3);
  assert.equal(store.read().sourceRequests[Object.keys(
    store.read().sourceRequests)[0]].status,'COMPLETED');
  const again=planFreshBossThrough300(store.read());
  assert.equal(again.candidateAdditionalPages,430);
  assert.equal(again.candidateJobs,215);
});
test('precommitted zero-gain page2 is reused; page3 still planned',()=>{
  const s=structuredClone(initial);
  const first=planFreshBossThrough300(s).requests[0];
  const registered=registerRankBatch(s,{...first,pageCount:1});
  const req=Object.values(registered.rankRequests)[0];
  const marked=beginRankBatch(registered,req.key,'prepaid-page2',100);
  const result=completeRankBatch(marked,req.key,'prepaid-page2',{
    pages:[{page:2,status:'OK',rowCount:100,
      hasMorePages:true,newVerifiedRanks:[]}],verified:[]
  },{points:1.01,wallMs:200});
  const plan=planFreshBossThrough300(result);
  assert.equal(plan.candidateJobs,216);
  assert.equal(plan.candidateAdditionalPages,431);
  assert.equal(plan.previouslyVisitedPage2Jobs,1);
  const continued=plan.requests.find(r=>r.jobKey===first.jobKey);
  assert.equal(continued.firstPage,3);
  assert.equal(continued.pageCount,1);
});
