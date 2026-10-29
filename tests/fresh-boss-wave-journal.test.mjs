import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {newCheckpoint,checkpointStats,recoverCheckpoint,
  committedProofs} from '../src/core/checkpoint.mjs';
import {makeFreshDatedHeroicManifest,installFreshCohortPlan,
  planFreshCohortBatches,exportVerifiedFreshCohort}
  from '../src/core/fresh-cohort-source.mjs';
import {planFreshBossFirstPages}
  from '../src/core/fresh-boss-first-page.mjs';
import {summarizeFreshDpsJob}
  from '../src/core/fresh-dps-output-contract.mjs';
import {
  registerFreshBossWave,beginFreshBossWave,
  runOneFreshBossWave
} from '../src/core/fresh-boss-wave-journal.mjs';

const scope='heroic:2026-10-22_27:latest:source';
const code='7b1a075ad2663c8aa07734b7733cbe81bf9c6071';
const digest=o=>createHash('sha256').update(JSON.stringify(o)).digest('hex');
const policy={notBeforeMs:0,maxObservedPoints:1000,reservePoints:10};
const manifest=makeFreshDatedHeroicManifest(scope);

function fixture(){
  let state=installFreshCohortPlan(newCheckpoint(scope,'real-shaped-offline-fixture'),
    manifest);
  state.sourceCodeCommit=code;
  const plan=planFreshCohortBatches(manifest);
  for(const b of plan.batches){
    const e=state.sourceRequests[b.key];
    const jobs=b.jobs.map((j,i)=>{
      const rows=Array.from({length:100},(_,r)=>({
        name:'Actor'+r,amount:100000-r*100-i,
        reportCode:'R'+b.batchIndex+'_'+i+'_'+r,
        fightId:r+1,startTime:1792594801000+r*1000,
        reportRevision:null
      }));
      return {...j,rows,snapshotSha:digest(rows)};
    });
    e.status='COMPLETED';
    e.result={jobs};
    e.attempt={id:'source-'+b.batchIndex,kind:'TOTAL_COHORT_BATCH',
      startedAtMs:1};
    e.observedPoints=b.jobs.length+0.01;
  }
  const source=exportVerifiedFreshCohort(state,manifest);
  const batches=planFreshBossFirstPages(source.slots).batches;
  return {state,batches};
}
const seed=fixture();
function fresh(){
  return {state:structuredClone(seed.state),
    batch:structuredClone(seed.batches[0]),
    nextBatch:structuredClone(seed.batches[1])};
}
function memory(state,{failUpdate=Infinity}={}){
  let value=structuredClone(state),count=0;
  const history=[];
  return {
    read:()=>structuredClone(value),
    update(fn){
      const next=fn(structuredClone(value));
      count++;
      if(count===failUpdate)throw Error('PRIVATE_GIT_PUSH_FAILED');
      value=next;history.push(structuredClone(next));
      return structuredClone(value);
    },
    get count(){return count;},
    get history(){return history;}
  };
}
function response(batch,{masked=false,badAlias=false,unknownCost=false}={}){
  const encounter={};
  for(const [i,j] of batch.jobs.entries()){
    encounter['b'+i]={rankings:j.slots.map((s,r)=>({
      name:masked&&i===0&&r===99?'Anonymous':s.name,
      amount:s.totalDps-100,
      startTime:s.startTime,
      report:{code:s.reportCode,fightID:s.fightId}
    }))};
  }
  if(badAlias)delete encounter['b'+(batch.jobs.length-1)];
  return {httpStatus:200,body:{data:{
    rateLimitData:{currentRequest:unknownCost?null:
      JSON.stringify({total:8.01})},
    worldData:{encounter}
  }}};
}
const send=opts=>async()=>response(seed.batches[0],opts);
test('first BossDPS wave is preview-only by default; source checkpoint unchanged',async()=>{
  const {state,batch}=fresh(),store=memory(state);
  const result=await runOneFreshBossWave({store,batch});
  assert.equal(result.status,'PREVIEW');
  assert.equal(result.sourceJobs,8);
  assert.equal(store.count,0);
  assert.equal(store.read().bossPageRequests,undefined);
  assert.equal(store.read().sourceRequests[Object.keys(state.sourceRequests)[0]].status,
    'COMPLETED');
  assert.equal(checkpointStats(store.read()).witnessedPoints,216.32);
});
test('one paid 8alias WCL response persists B independent ranks and C exact proofs once',async()=>{
  const {state,batch}=fresh(),store=memory(state);
  let calls=0,checkedInFlight=false;
  const output=await runOneFreshBossWave({
    store,batch,mode:'execute',approved:true,admissionPolicy:policy,
    clock:()=>100,attemptId:'boss-wave-0',
    transport:async q=>{
      calls++;
      assert.equal((q.query.match(/metric:bossdps/g)||[]).length,8);
      assert.equal(store.read().bossPageRequests['page1:0'].status,'IN_FLIGHT');
      checkedInFlight=true;
      return response(batch);
    }
  });
  assert.equal(output.status,'RECORDED');
  assert.equal(output.verifiedSameFight,800);
  assert.equal(output.observedPoints,8.01);
  assert.equal(calls,1);
  assert.equal(checkedInFlight,true);
  assert.equal(store.count,3);
  assert.deepEqual(store.history.map(s=>s.bossPageRequests['page1:0'].status),
    ['READY','IN_FLIGHT','COMPLETED']);
  assert.equal(checkpointStats(store.read()).witnessedPoints,224.33);
  assert.equal(checkpointStats(store.read()).verifiedSlotEvidence,800);
  const saved=store.read().bossPageRequests['page1:0'];
  assert.equal(saved.result.jobs.length,8);
  assert.equal(saved.result.jobs[0].rankings.length,100);
  assert.equal(saved.result.jobs[0].bossRankingSha,
    digest(saved.result.jobs[0].rankings));
  assert.equal(saved.result.jobs[0].verified.length,100);
  assert.equal(committedProofs(store.read()).length,800);
  const proj=summarizeFreshDpsJob({
    totalRankSlots:batch.jobs[0].slots,bossPage:saved.result.jobs[0],
    verifiedProofs:saved.result.jobs[0].verified
  });
  assert.equal(proj.bossRankingStatus,'EXACT100');
  assert.equal(proj.status,'EXACT100');
  assert.equal(proj.nonBossShare[0],0.001);
  assert.equal(store.read().sourceRequests[
    Object.keys(state.sourceRequests)[0]].result.jobs[0].snapshotSha,
    state.sourceRequests[Object.keys(state.sourceRequests)[0]].result.jobs[0].snapshotSha);
  const repeated=await runOneFreshBossWave({
    store,batch,mode:'execute',approved:true,
    admissionPolicy:policy,transport:async()=>{calls++;return response(batch);}
  });
  assert.equal(repeated.status,'COMPLETED');
  assert.equal(repeated.attempted,false);
  assert.equal(calls,1);
});
test('failure of remote Git push during IN_FLIGHT transition prevents WCL HTTP',async()=>{
  const {state,batch}=fresh();
  const store=memory(state,{failUpdate:2});
  let calls=0;
  await assert.rejects(runOneFreshBossWave({
    store,batch,mode:'execute',approved:true,
    attemptId:'not-sent',clock:()=>100,
    admissionPolicy:policy,transport:async()=>{calls++;return response(batch);}
  }),/PRIVATE_GIT_PUSH_FAILED/);
  assert.equal(calls,0);
  assert.equal(store.read().bossPageRequests['page1:0'].status,'READY');
});
test('after HTTP unknown cost remains NEEDS_REVIEW, never auto replays',async()=>{
  const {state,batch,nextBatch}=fresh(),store=memory(state);
  let calls=0;
  const out=await runOneFreshBossWave({
    store,batch,mode:'execute',approved:true,admissionPolicy:policy,
    clock:()=>100,attemptId:'uncertain-point',
    transport:async()=>{
      calls++;return response(batch,{unknownCost:true});
    }
  });
  assert.equal(out.status,'NEEDS_REVIEW');
  assert.equal(calls,1);
  assert.equal(checkpointStats(store.read()).pointsUnobserved,1);
  assert.equal(store.read().bossPageRequests['page1:0'].result,null);
  const retry=await runOneFreshBossWave({
    store,batch,mode:'execute',approved:true,admissionPolicy:policy,
    transport:async()=>{calls++;throw Error('WRONG_RETRY');}
  });
  assert.equal(retry.attempted,false);
  assert.equal(calls,1);
  await assert.rejects(runOneFreshBossWave({
    store,batch:nextBatch,mode:'execute',approved:true,admissionPolicy:policy,
    transport:async()=>{calls++;throw Error('WRONG_NEW_CALL');}
  }),/BOSS_WAVE_OUT_OF_SEQUENCE_OR_UNSAFE/);
  assert.equal(calls,1);
});
test('missing alias marks whole eight-spec response uncertain; no partial B/C',async()=>{
  const {state,batch}=fresh(),store=memory(state);
  const out=await runOneFreshBossWave({
    store,batch,mode:'execute',approved:true,admissionPolicy:policy,
    clock:()=>100,attemptId:'bad-alias',
    transport:async()=>response(batch,{badAlias:true})
  });
  assert.equal(out.status,'NEEDS_REVIEW');
  const e=store.read().bossPageRequests['page1:0'];
  assert.equal(e.result,null);
  assert.equal(e.incident.automaticRetry,false);
  assert.equal(e.observedPoints,8.01);
  assert.equal(checkpointStats(store.read()).pointsUnobserved,0);
  assert.equal(checkpointStats(store.read()).counts.NEEDS_REVIEW,1);
});
test('crashed live IN_FLIGHT becomes needs-review on separate recovery, no replay',async()=>{
  const {state,batch}=fresh();
  const registered=registerFreshBossWave(state,batch);
  const waiting=beginFreshBossWave(registered,batch,'crashed-before-response',100);
  assert.equal(checkpointStats(waiting).counts.IN_FLIGHT,1);
  const recovered=recoverCheckpoint(waiting);
  assert.equal(recovered.bossPageRequests['page1:0'].status,'NEEDS_REVIEW');
  assert.equal(recovered.bossPageRequests['page1:0'].incident.automaticRetry,false);
  assert.equal(checkpointStats(recovered).pointsUnobserved,1);
  const store=memory(recovered);
  const res=await runOneFreshBossWave({
    store,batch,mode:'execute',approved:true,admissionPolicy:policy,
    transport:async()=>{throw Error('MUST_NOT_SEND');}
  });
  assert.equal(res.attempted,false);
  assert.equal(store.count,0);
});
test('changed original source or bogus batch is rejected before HTTP',async()=>{
  const {state,batch}=fresh(),bad=structuredClone(state);
  const original=Object.keys(bad.sourceRequests)[0];
  bad.sourceRequests[original].result.jobs[0].rows[0].amount+=1;
  const store=memory(bad);
  let calls=0;
  await assert.rejects(runOneFreshBossWave({
    store,batch,mode:'execute',approved:true,admissionPolicy:policy,
    transport:async()=>{calls++;return response(batch);}
  }),/BOSS_WAVE_SOURCE_JOB_DRIFT/);
  assert.equal(calls,0);
  const wrong=structuredClone(batch);
  wrong.jobs[0].slots[0].reportCode='UNRELATED';
  await assert.rejects(runOneFreshBossWave({
    store:memory(state),batch:wrong,mode:'execute',approved:true,
    admissionPolicy:policy,transport:async()=>{calls++;return response(batch);}
  }),/BOSS_WAVE_SOURCE_RANK_DRIFT/);
  assert.equal(calls,0);
});
test('masked actor may remain in official B top100 without forged same-fight C',async()=>{
  const {state,batch}=fresh(),store=memory(state);
  const result=await runOneFreshBossWave({
    store,batch,mode:'execute',approved:true,admissionPolicy:policy,
    clock:()=>100,attemptId:'anon-wcl',
    transport:async()=>response(batch,{masked:true})
  });
  assert.equal(result.status,'RECORDED');
  assert.equal(result.verifiedSameFight,799);
  const b=store.read().bossPageRequests['page1:0'].result.jobs[0];
  assert.equal(b.rankings.length,100);
  assert.equal(b.verified.length,99);
  const x=summarizeFreshDpsJob({
    totalRankSlots:batch.jobs[0].slots,bossPage:b,
    verifiedProofs:b.verified
  });
  assert.equal(x.bossRankedDpsMetrics[2],b.rankings[99].amount);
  assert.equal(x.totalRankJoinedBossDpsMetrics[2],null);
  assert.equal(x.nonBossShare[4],null);
});
