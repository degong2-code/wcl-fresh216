import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {newCheckpoint,checkpointStats} from '../src/core/checkpoint.mjs';
import {makeFreshDatedHeroicManifest,installFreshCohortPlan,
  planFreshCohortBatches,exportVerifiedFreshCohort}
  from '../src/core/fresh-cohort-source.mjs';
import {planFreshBossFirstPages,decodeFreshBossFirstPage}
  from '../src/core/fresh-boss-first-page.mjs';
import {registerFreshBossWave,beginFreshBossWave,completeFreshBossWave}
  from '../src/core/fresh-boss-wave-journal.mjs';
import {registerRankBatch,committedRankingEvidence}
  from '../src/core/rank-batch-checkpoint.mjs';
import {inspectFreshDpsPipeline,runFreshBossPage1Sweep}
  from '../src/core/fresh-dps-pipeline.mjs';

const scope='heroic:2026-10-22_27:latest:source';
const sha='7b1a075ad2663c8aa07734b7733cbe81bf9c6071';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const m=makeFreshDatedHeroicManifest(scope);
const batches=planFreshCohortBatches(m).batches;
function seed(){
  let state=installFreshCohortPlan(newCheckpoint(scope,'private-source-shaped'),m);
  state.sourceCodeCommit=sha;
  for(const b of batches){
    const entry=state.sourceRequests[b.key];
    entry.status='COMPLETED';
    entry.observedPoints=b.jobs.length+.01;
    entry.attempt={id:'original-'+b.batchIndex,kind:'TOTAL_COHORT_BATCH',
      startedAtMs:100};
    entry.result={jobs:b.jobs.map((j,i)=>{
      const rows=Array.from({length:100},(_,r)=>({
        name:'Actor'+r,amount:200000-r*900-i*10,
        reportCode:'R'+b.batchIndex+'-'+i+'-'+r,
        fightId:r+1,startTime:1792594801000+r*1000,
        reportRevision:null
      }));
      return {...j,rows,snapshotSha:hash(rows)};
    })};
  }
  return state;
}
const initial=seed();
const source=exportVerifiedFreshCohort(initial,m);
const plan=planFreshBossFirstPages(source.slots);
const reply=(batch,{costKnown=true,unmatched=0}={})=>{
  const enc={};
  for(const [i,j] of batch.jobs.entries()){
    enc['b'+i]={rankings:j.slots.map((s,r)=>({
      name:s.name,amount:s.totalDps-100,
      startTime:s.startTime,
      report:{code:(unmatched&&r>=unmatched)?
        'DifferentFight'+r:s.reportCode,fightID:s.fightId}
    }))};
  }
  return {httpStatus:200,body:{data:{
    rateLimitData:{currentRequest:costKnown?
      JSON.stringify({total:8.01}):null},
    worldData:{encounter:enc}
  }}};
};
function firstDone(){
  let s=structuredClone(initial);
  const b=plan.batches[0];
  const decoded=decodeFreshBossFirstPage(b,200,reply(b,{unmatched:65}).body);
  assert.equal(decoded.status,'OK');
  s=registerFreshBossWave(s,b);
  s=beginFreshBossWave(s,b,'boss-first',100);
  s=completeFreshBossWave(s,b,'boss-first',decoded,
    {points:8.01,wallMs:11});
  return s;
}
function memory(s){
  let value=structuredClone(s),writes=0;
  return {
    read:()=>structuredClone(value),
    update:fn=>{
      const next=fn(structuredClone(value));
      value=next;writes++;return structuredClone(value);
    },
    get writes(){return writes;}
  };
}
test('source-only inspection keeps B/C separate and no paid operations',()=>{
  const p=inspectFreshDpsPipeline(initial,{includeOutputs:true});
  assert.equal(p.stage,'BOSS_PAGE1');
  assert.equal(p.summary.bossPage1BatchesCompleted,0);
  assert.equal(p.summary.bossRankRows,0);
  assert.equal(p.summary.sameFightProofs,0);
  assert.equal(p.summary.bossKpiCells,0);
  assert.equal(p.summary.uYCells,0);
  assert.equal(p.summary.nextBossBatchIndex,0);
  assert.equal(p.outputs.length,216);
  assert(p.outputs.every(o=>o.totalDpsMetrics.length===5&&
    o.totalDpsMetrics.every(Number.isFinite)&&
    o.bossRankedDpsMetrics.every(v=>v===null)));
});
test('already-paid first 8 specs are reused without rank-page1 replay',async()=>{
  const s=firstDone();
  const preview=inspectFreshDpsPipeline(s,{includeOutputs:true});
  assert.equal(preview.summary.bossPage1BatchesCompleted,1);
  assert.equal(preview.summary.bossJobsCompleted,8);
  assert.equal(preview.summary.bossRankRows,800);
  assert.equal(preview.summary.sameFightProofs,520);
  assert.equal(preview.summary.nextBossBatchIndex,1);
  assert.equal(preview.summary.bossKpiCells,40);
  assert.equal(preview.stage,'BOSS_PAGE1');
  assert.equal(preview.outputs.filter(o=>o.bossRankingStatus==='EXACT100').length,8);
  const old=p=>p.summary.bossRankRows;
  const store=memory(s);
  const dry=await runFreshBossPage1Sweep({
    store,mode:'preview',maxRequests:31});
  assert.equal(dry.status,'PREVIEW');
  assert.equal(dry.actualRequests,0);
  assert.equal(store.writes,0);
  assert.equal(old(dry),800);
  const evidence=committedRankingEvidence(s);
  assert.equal(evidence.length,8);
  assert(evidence.every(e=>e.pages.length===1&&e.pages[0].page===1));
  const job=plan.batches[0].jobs[0];
  const page2={...job,firstPage:2,pageCount:2};
  const registered=registerRankBatch(s,page2);
  assert.equal(Object.values(registered.rankRequests).length,1);
  assert.equal(Object.values(registered.rankRequests)[0].source.firstPage,2);
  assert.throws(()=>registerRankBatch(s,{...job,firstPage:1,pageCount:1}),
    /RANK_BOSS_PAGE1_TERMINAL_OR_NEXT_PAGE_DRIFT/);
  assert.throws(()=>registerRankBatch(s,{...job,firstPage:3,pageCount:1}),
    /RANK_BOSS_PAGE1_TERMINAL_OR_NEXT_PAGE_DRIFT/);
});
test('bounded two-wave continuation resumes from index1 and persists index2 only',async()=>{
  const store=memory(firstDone());
  let calls=0;
  const out=await runFreshBossPage1Sweep({
    store,mode:'execute',approved:true,maxRequests:2,
    admissionPolicy:{notBeforeMs:0,maxObservedPoints:270,
      reservePoints:10},clock:()=>100,
    transport:async q=>{
      assert.equal((q.query.match(/metric:bossdps/g)||[]).length,8);
      const batch=plan.batches[++calls];
      const st=store.read();
      assert.equal(st.bossPageRequests['page1:'+calls].status,'IN_FLIGHT');
      return reply(batch);
    }
  });
  assert.equal(calls,2);
  assert.equal(out.status,'BOSS_PAGE1_PARTIAL');
  assert.equal(out.requestsAttempted,2);
  assert.deepEqual(out.receipts.map(r=>r.batchIndex),[1,2]);
  assert.equal(out.summary.bossPage1BatchesCompleted,3);
  assert.equal(out.summary.bossRankRows,2400);
  assert.equal(out.summary.nextBossBatchIndex,3);
  assert.equal(store.read().bossPageRequests['page1:0'].attempt.id,'boss-first');
  assert.equal(Object.keys(store.read().bossPageRequests).length,3);
  assert.equal(store.writes,6);
});
test('unknown point cost blocks all further B waves and never retries',async()=>{
  const store=memory(firstDone());
  let calls=0;
  const out=await runFreshBossPage1Sweep({
    store,mode:'execute',approved:true,maxRequests:2,
    admissionPolicy:{notBeforeMs:0,maxObservedPoints:270,
      reservePoints:10},clock:()=>100,
    transport:async()=>{
      calls++;
      return reply(plan.batches[1],{costKnown:false});
    }
  });
  assert.equal(calls,1);
  assert.equal(out.status,'NEEDS_REVIEW');
  assert.equal(out.requestsAttempted,1);
  assert.equal(checkpointStats(store.read()).counts.NEEDS_REVIEW,1);
  assert.equal(store.read().bossPageRequests['page1:1'].result,null);
  const rerun=await runFreshBossPage1Sweep({
    store,mode:'execute',approved:true,maxRequests:2,
    admissionPolicy:{notBeforeMs:0,maxObservedPoints:270,
      reservePoints:10},clock:()=>100,transport:async()=>{
      calls++;throw Error('UNEXPECTED_RETRY');
    }
  });
  assert.equal(rerun.requestsAttempted,0);
  assert.equal(calls,1);
});
test('global point-admission policy may pause without a WCL call',async()=>{
  const store=memory(firstDone()),before=store.read();
  const result=await runFreshBossPage1Sweep({
    store,mode:'execute',approved:true,maxRequests:1,
    admissionPolicy:{notBeforeMs:0,maxObservedPoints:230,
      reservePoints:10},clock:()=>100,
    transport:async()=>{throw Error('NO_CHARGE_ALLOWED');}
  });
  assert.equal(result.status,'BUDGET_PAUSED');
  assert.equal(result.requestsAttempted,0);
  assert.equal(store.read().sourceRequests[
    Object.keys(before.sourceRequests)[0]].result.jobs[0].snapshotSha,
    before.sourceRequests[Object.keys(before.sourceRequests)[0]].result.jobs[0].snapshotSha);
});
