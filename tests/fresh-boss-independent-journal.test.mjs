import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {newCheckpoint,checkpointStats,recoverCheckpoint}
  from '../src/core/checkpoint.mjs';
import {
  makeFreshDatedHeroicManifest,planFreshCohortBatches,
  installFreshCohortPlan,projectCompletedFreshCohort
} from '../src/core/fresh-cohort-source.mjs';
import {planFreshBossFirstPages}
  from '../src/core/fresh-boss-first-page.mjs';
import {runOneFreshBossWave,registerFreshBossWave,
  beginFreshBossWave} from '../src/core/fresh-boss-wave-journal.mjs';

const scope='engine:boss-independent-journal';
const manifest=makeFreshDatedHeroicManifest(scope);
const hash=o=>createHash('sha256').update(JSON.stringify(o)).digest('hex');
const begin=1792594801000;
const code='f'.repeat(40);
const policy={notBeforeMs:0,maxObservedPoints:500,reservePoints:10};
function fixture({aSize=9,bSize=9,completeA=null}={}){
  const aPlan=planFreshCohortBatches(manifest,{jobsPerRequest:aSize});
  let state=installFreshCohortPlan(newCheckpoint(scope,'test-A'),manifest,{
    jobsPerRequest:aSize
  });
  state.sourceCodeCommit=code;
  for(const b of aPlan.batches.slice(0,completeA??aPlan.batches.length)){
    const e=state.sourceRequests[b.key];
    e.status='COMPLETED';e.observedPoints=b.jobs.length+.01;
    e.attempt={id:'original-A-'+b.batchIndex,kind:'TOTAL_COHORT_BATCH',
      startedAtMs:100};
    e.result={jobs:b.jobs.map((j,i)=>{
      const rows=Array.from({length:100},(_,r)=>({
        name:'Actor'+r,amount:200000-r*1000-i,
        reportCode:'A_'+b.batchIndex+'_'+i+'_'+r,
        fightId:r+1,startTime:begin+r*1000,reportRevision:null
      }));
      return {...j,rows,snapshotSha:hash(rows)};
    })};
  }
  const source=projectCompletedFreshCohort(state,manifest);
  const bPlan=planFreshBossFirstPages(source.slots,{
    jobsPerRequest:bSize,allowPartialSource:completeA!==null
  });
  return {state,batches:bPlan.batches,source};
}
function store(start,{failAt=Infinity}={}){
  let value=structuredClone(start),writes=0;
  const history=[];
  return {read:()=>structuredClone(value),update:fn=>{
    const next=fn(structuredClone(value));
    writes++;
    if(writes===failAt)throw Error('SIMULATED_REMOTE_GIT_FAILURE');
    history.push(structuredClone(next));value=structuredClone(next);
    return structuredClone(value);
  },get writes(){return writes},get history(){return history}};
}
function reply(batch,{unknownCost=false,missingAlias=false}={}){
  const aliases={};
  batch.jobs.forEach((j,i)=>{
    if(missingAlias&&i===batch.jobs.length-1)return;
    aliases['b'+i]={rankings:j.slots.map(s=>({
      name:s.name,amount:s.totalDps-100,
      startTime:s.startTime,
      report:{code:s.reportCode,fightID:s.fightId}
    }))};
  });
  return {httpStatus:200,body:{data:{
    rateLimitData:{currentRequest:unknownCost?null:
      JSON.stringify({total:batch.jobs.length+.01})},
    worldData:{encounter:aliases}
  }}};
}
test('A9 -> B9 uses independent B plan seal and durable before-HTTP transition',async()=>{
  const {state,batches}=fixture(),batch=batches[0],s=store(state);
  let calls=0;
  const result=await runOneFreshBossWave({
    store:s,batch,mode:'execute',approved:true,
    admissionPolicy:policy,attemptId:'new-B9',clock:()=>100,
    transport:async query=>{
      calls++;
      assert.equal((query.query.match(/metric:bossdps/g)||[]).length,9);
      const remote=s.read();
      assert.equal(remote.bossPageRequests['page1:0'].status,'IN_FLIGHT');
      assert.match(remote.bossPageRequests['page1:0'].bossPlanSha,/^[0-9a-f]{64}$/);
      assert.equal(remote.bossPageRequests['page1:0'].sourceCommit,code);
      assert.equal(remote.bossPageRequests['page1:0'].scopeKey,scope);
      return reply(batch);
    }
  });
  assert.equal(result.status,'RECORDED');
  assert.equal(result.verifiedSameFight,900);
  assert.equal(result.observedPoints,9.01);
  assert.equal(calls,1);
  assert.deepEqual(s.history.map(x=>x.bossPageRequests['page1:0'].status),
    ['READY','IN_FLIGHT','COMPLETED']);
  assert.equal(checkpointStats(s.read()).verifiedSlotEvidence,900);
  const resumed=store(s.read());
  const repeat=await runOneFreshBossWave({
    store:resumed,batch,mode:'execute',approved:true,
    admissionPolicy:policy,transport:async()=>{calls++;throw Error('NO_REPLAY')}
  });
  assert.equal(repeat.status,'COMPLETED');
  assert.equal(repeat.attempted,false);
  assert.equal(resumed.writes,0);
  assert.equal(calls,1);
});
test('A8 -> B9 is also legal, A9 -> B8 does not inherit the source size',async()=>{
  for(const [aSize,bSize] of [[8,9],[9,8]]){
    const {state,batches}=fixture({aSize,bSize});
    assert.equal(batches.length,bSize===9?24:32);
    const s=store(state);
    const result=await runOneFreshBossWave({
      store:s,batch:batches[0],mode:'execute',approved:true,
      admissionPolicy:policy,attemptId:'cross-batch-'+aSize+'-'+bSize,
      clock:()=>100,transport:async()=>reply(batches[0])
    });
    assert.equal(result.status,'RECORDED');
    assert.equal(result.sourceJobs,bSize);
    assert.equal(checkpointStats(s.read()).counts.COMPLETED,
      (aSize===9?24:32)+1);
  }
});
test('B9 partial-A preview does not become authorized execution',async()=>{
  const {state,batches}=fixture({completeA:4});
  const s=store(state);
  let calls=0;
  await assert.rejects(runOneFreshBossWave({
    store:s,batch:batches[0],mode:'execute',approved:true,
    admissionPolicy:policy,clock:()=>100,transport:async()=>{calls++}
  }),/BOSS_WAVE_SOURCE_BATCH_DRIFT/);
  assert.equal(s.writes,0);
  assert.equal(calls,0);
});
test('a modified B9 plan or changed A data cannot replay a charged B batch',async()=>{
  const {state,batches}=fixture();
  const s=store(state);
  await runOneFreshBossWave({
    store:s,batch:batches[0],mode:'execute',approved:true,
    admissionPolicy:policy,attemptId:'first-B9',clock:()=>100,
    transport:async()=>reply(batches[0])
  });
  let calls=0;
  const replan=fixture({bSize:8}).batches[1];
  await assert.rejects(runOneFreshBossWave({
    store:s,batch:replan,mode:'execute',approved:true,
    admissionPolicy:policy,transport:async()=>{calls++}
  }),/BOSS_WAVE_PLAN_GENERATION_DRIFT|BOSS_WAVE_SOURCE_BATCH_DRIFT|BOSS_WAVE_OUT_OF_SEQUENCE/);
  const changed=structuredClone(s.read());
  changed.sourceRequests[Object.keys(changed.sourceRequests)[0]]
    .result.jobs[0].rows[0].amount+=1;
  await assert.rejects(runOneFreshBossWave({
    store:store(changed),batch:batches[1],mode:'execute',
    approved:true,admissionPolicy:policy,
    transport:async()=>{calls++}
  }),/BOSS_WAVE_SOURCE_JOB_DRIFT/);
  assert.equal(calls,0);
});
test('uncertain B9 points prevent repeat, next B wave and any C fabrication',async()=>{
  const {state,batches}=fixture();
  const s=store(state);let calls=0;
  const output=await runOneFreshBossWave({
    store:s,batch:batches[0],mode:'execute',approved:true,
    admissionPolicy:policy,attemptId:'unknown-B9',clock:()=>100,
    transport:async()=>{calls++;return reply(batches[0],{unknownCost:true})}
  });
  assert.equal(output.status,'NEEDS_REVIEW');
  const e=s.read().bossPageRequests['page1:0'];
  assert.equal(e.result,null);
  assert.equal(e.incident.automaticRetry,false);
  const repeated=await runOneFreshBossWave({
    store:s,batch:batches[0],mode:'execute',approved:true,
    admissionPolicy:policy,transport:async()=>{calls++}
  });
  assert.equal(repeated.attempted,false);
  await assert.rejects(runOneFreshBossWave({
    store:s,batch:batches[1],mode:'execute',approved:true,
    admissionPolicy:policy,transport:async()=>{calls++}
  }),/BOSS_WAVE_OUT_OF_SEQUENCE_OR_UNSAFE/);
  assert.equal(calls,1);
});
test('remote commit failure before B9 WCL transport guarantees zero queries',async()=>{
  const {state,batches}=fixture(),s=store(state,{failAt:2});let calls=0;
  await assert.rejects(runOneFreshBossWave({
    store:s,batch:batches[0],mode:'execute',approved:true,
    attemptId:'no-B9-call',clock:()=>100,admissionPolicy:policy,
    transport:async()=>{calls++}
  }),/SIMULATED_REMOTE_GIT_FAILURE/);
  assert.equal(calls,0);
  assert.equal(s.read().bossPageRequests['page1:0'].status,'READY');
});
test('old B8 journal without plan seal remains readable for exact legacy identity',async()=>{
  const legacyScope='heroic:2026-10-22_27:latest:source';
  const legacyManifest=makeFreshDatedHeroicManifest(legacyScope);
  const aPlan=planFreshCohortBatches(legacyManifest);
  let state=installFreshCohortPlan(newCheckpoint(legacyScope,'legacy'),legacyManifest);
  state.sourceCodeCommit='7b1a075ad2663c8aa07734b7733cbe81bf9c6071';
  for(const b of aPlan.batches){
    const e=state.sourceRequests[b.key];
    e.status='COMPLETED';e.observedPoints=b.jobs.length+.01;
    e.attempt={id:'legacyA-'+b.batchIndex,kind:'TOTAL_COHORT_BATCH',
      startedAtMs:100};
    e.result={jobs:b.jobs.map((j,i)=>{
      const rows=Array.from({length:100},(_,r)=>({
        name:'Actor'+r,amount:200000-r*1000-i,
        reportCode:'L'+b.batchIndex+'_'+i+'_'+r,
        fightId:r+1,startTime:begin+r*1000,reportRevision:null
      }));
      return {...j,rows,snapshotSha:hash(rows)};
    })};
  }
  const a=projectCompletedFreshCohort(state,legacyManifest);
  const b=planFreshBossFirstPages(a.slots).batches;
  const committed=store(state);
  await runOneFreshBossWave({
    store:committed,batch:b[0],mode:'execute',approved:true,
    admissionPolicy:policy,clock:()=>100,attemptId:'legacy-B8',
    transport:async()=>reply(b[0])
  });
  const old=committed.read();delete old.bossPageRequests['page1:0'].bossPlanSha;
  const view=await runOneFreshBossWave({
    store:store(old),batch:b[0]
  });
  assert.equal(view.status,'PREVIEW');
  assert.equal(view.priorStatus,'COMPLETED');
  const next=await runOneFreshBossWave({
    store:store(old),batch:b[1]
  });
  assert.equal(next.status,'PREVIEW');
  assert.equal(next.attemptsCharged,0);
});
