import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {JsonCheckpointStore} from '../src/adapters/json-checkpoint-store.mjs';
import {newCheckpoint,checkpointStats,recoverCheckpoint,
  beginFetch,registerPlan} from '../src/core/checkpoint.mjs';
import {planFightFetches} from '../src/core/fetch-plan.mjs';
import {beginRankBatch,registerRankBatch,readyRankBatches}
  from '../src/core/rank-batch-checkpoint.mjs';
import {
 validateFreshCohortManifest,planFreshCohortBatches,
 buildFreshCohortQuery,installFreshCohortPlan,
 nextFreshCohortBatch,beginFreshCohortBatch,
 decodeFreshCohortBatch,exportVerifiedFreshCohort,
 runOneFreshCohortBatch
} from '../src/core/fresh-cohort-source.mjs';

const FILTER='date.1792594800000.1793199600000';
function manifest(){
 return {scopeKey:'heroic:dated:oct22-28',
   difficulty:4,partitionMode:'LATEST_DEFAULT',filter:FILTER,
   bosses:Array.from({length:8},(_,i)=>({
     name:'TestBoss'+i,encounterId:3470+i
   })),
   specs:Array.from({length:27},(_,i)=>({
     className:'Class'+i,specName:'Spec'+i
   }))};
}
const policy={notBeforeMs:0,maxObservedPoints:1000,reservePoints:30};
const mem=state=>{
 let value=structuredClone(state),updates=0;
 return {read:()=>structuredClone(value),update:fn=>{
   const next=fn(structuredClone(value));
   value=next;updates++;return structuredClone(next);
 },get updates(){return updates;}};
};
const makeBody=(query,{wrongDate=false,partial=false,
  invalidCost=false}={})=>{
 const data={};
 let i=0;
 while(Object.hasOwn(query.variables,'c'+i)){
   const cls=query.variables['c'+i],spec=query.variables['s'+i];
   const rows=Array.from({length:partial&&i===0?99:100},(_,rank)=>({
     name:rank===99?'Anonymous':'Actor'+rank,
     amount:100000-rank*100-i,
     startTime:(wrongDate&&i===0&&rank===0?
       1792594800000-1:1792594800000+1000+rank*1000),
     report:{code:'R_'+query.variables.id+'_'+i+'_'+rank,
       fightID:rank+1},
     className:cls,specName:spec
   }));
   data['t'+i]={rankings:rows,hasMorePages:true};
   i++;
 }
 return {httpStatus:200,body:{data:{
   rateLimitData:{currentRequest:invalidCost?null:
     JSON.stringify({total:i+0.01})},
   worldData:{encounter:data}
 }}};
};
test('exact 8x27 scope, 32 immutable requests, page1 only and no partition override',()=>{
 const m=manifest(),p=planFreshCohortBatches(m);
 assert.equal(p.totalJobs,216);assert.equal(p.requestCount,32);
 assert.equal(p.batches.map(b=>b.jobs.length).reduce((a,b)=>a+b),216);
 const q=buildFreshCohortQuery(p.batches[0]);
 assert.equal((q.query.match(/characterRankings\(/g)||[]).length,8);
 assert.match(q.query,/metric:dps,page:1,filter:\$filter/);
 assert.doesNotMatch(q.query,/partition|bossdps/);
 assert.equal(q.variables.filter,FILTER);
 assert.equal(q.variables.id,3470);
 const invalid=manifest();invalid.filter='date.1791385200000.1791817200000';
 assert.throws(()=>validateFreshCohortManifest(invalid),
   /FRESH_COHORT_MANIFEST_INVALID/);
 const duplicate=manifest();duplicate.bosses[1].encounterId=3470;
 assert.throws(()=>validateFreshCohortManifest(duplicate),
   /FRESH_COHORT_BOSS_DUPLICATE_OR_INVALID/);
});
test('default preview is read-only and execute requires owner approval+point reserve',async()=>{
 const m=manifest(),store=mem(newCheckpoint(m.scopeKey,'run-source'));
 const preview=await runOneFreshCohortBatch({store,manifest:m});
 assert.equal(preview.kind,'PLAN_REQUIRED');
 assert.equal(preview.plannedRequests,32);
 assert.equal(store.updates,0);
 await assert.rejects(()=>runOneFreshCohortBatch({
   store,manifest:m,mode:'execute',transport:async()=>({}),
   admissionPolicy:policy}),/FRESH_COHORT_PAID_EXECUTION_NOT_AUTHORIZED/);
 assert.equal(store.updates,0);
});
test('one real-shaped 8-spec batch persists 800 slots and charges once',async()=>{
 const m=manifest(),store=mem(newCheckpoint(m.scopeKey,'source-run'));
 let calls=0;
 const a=await runOneFreshCohortBatch({store,manifest:m,mode:'execute',
   approved:true,admissionPolicy:policy,clock:()=>100,
   transport:async q=>{calls++;return makeBody(q);}});
 assert.equal(a.status,'RECORDED');assert.equal(calls,1);
 assert.equal(a.completedJobsAfter,8);
 const state=store.read();
 assert.equal(state.sourceRequests[
   planFreshCohortBatches(m).batches[0].key].result.jobs.length,8);
 const stats=checkpointStats(state);
 assert.equal(stats.witnessedPoints,8.01);
 assert.equal(stats.counts.COMPLETED,1);
 assert.equal(stats.counts.READY,31);
 assert.equal(stats.verifiedSlotEvidence,0);
 assert.equal(nextFreshCohortBatch(state,m).batch.batchIndex,1);
 assert.throws(()=>exportVerifiedFreshCohort(state,m),
   /FRESH_COHORT_INCOMPLETE/);
});
test('all 216 source jobs can be captured, validated and exported using same checkpoint',async()=>{
 const m=manifest(),store=mem(newCheckpoint(m.scopeKey,'run-complete'));
 let calls=0;
 for(let i=0;i<32;i++){
   const res=await runOneFreshCohortBatch({store,manifest:m,
     mode:'execute',approved:true,admissionPolicy:policy,
     clock:()=>100+i,transport:async q=>{calls++;return makeBody(q);}});
   assert.equal(res.status,'RECORDED');
 }
 assert.equal(calls,32);
 const outcome=exportVerifiedFreshCohort(store.read(),m);
 assert.equal(outcome.summary.status,'SOURCE_COMPLETE');
 assert.equal(outcome.summary.jobs,216);
 assert.equal(outcome.summary.rankSlots,21600);
 assert.equal(outcome.summary.witnessedSourceRequests,32);
 assert.equal(outcome.slots[0].rank,1);
 assert.equal(outcome.slots[0].status,'PENDING');
 assert.equal(outcome.slots[0].reportRevision,null);
 assert.equal(outcome.slots[0].filter,FILTER);
 assert.equal(outcome.slots.filter(s=>s.name==='Anonymous').length,216);
 assert.ok(Math.abs(checkpointStats(store.read()).witnessedPoints-216.32)<1e-8);
});
test('bad row time, short top100 and absent point witness fail closed',()=>{
 const m=manifest(),b=planFreshCohortBatches(m).batches[0],q=buildFreshCohortQuery(b);
 for(const [variant,expected] of [
  [{wrongDate:true},'SOURCE_ROW_IDENTITY_OR_TIME_INVALID'],
  [{partial:true},'SOURCE_TOP100_INCOMPLETE'],
  [{invalidCost:true},'SOURCE_POINT_COST_UNOBSERVED']
 ]){
   const r=makeBody(q,variant);
   assert.equal(decodeFreshCohortBatch(b,r.httpStatus,r.body).status,expected);
 }
});
test('failed HTTP and unknown billed request are NEVER auto-retried',async()=>{
 const m=manifest(),store=mem(newCheckpoint(m.scopeKey,'run-fail'));
 let calls=0;
 const a=await runOneFreshCohortBatch({store,manifest:m,
   mode:'execute',approved:true,admissionPolicy:policy,clock:()=>100,
   transport:async()=>{calls++;return {httpStatus:504,body:null};}});
 assert.equal(a.status,'NEEDS_REVIEW');
 assert.equal(calls,1);
 assert.equal(checkpointStats(store.read()).pointsUnobserved,1);
 const b=await runOneFreshCohortBatch({store,manifest:m,
   mode:'execute',approved:true,admissionPolicy:policy,clock:()=>200,
   transport:async()=>{calls++;return {};}})
 assert.equal(b.status,'NEEDS_REVIEW');
 assert.equal(calls,1);
});
test('restart after pre-HTTP marker marks one entire source batch NEEDS_REVIEW',()=>{
 const m=manifest(),registered=installFreshCohortPlan(
   newCheckpoint(m.scopeKey,'run-crash'),m);
 const b=nextFreshCohortBatch(registered,m).batch;
 const pending=beginFreshCohortBatch(registered,b,'INFLIGHT',100);
 assert.equal(checkpointStats(pending).counts.IN_FLIGHT,1);
 const resumed=recoverCheckpoint(pending);
 assert.equal(checkpointStats(resumed).counts.NEEDS_REVIEW,1);
 assert.equal(nextFreshCohortBatch(resumed,m).kind,'NEEDS_REVIEW');
 assert.equal(resumed.sourceRequests[b.key].incident.automaticRetry,false);
});
test('durable checkpoint survives restart, cannot replay finished source batch',async()=>{
 const m=manifest(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'wcl-source-'));
 try{
   const file=path.join(dir,'source.json'),store=new JsonCheckpointStore(file);
   store.init(newCheckpoint(m.scopeKey,'run-private'));
   let calls=0;
   await runOneFreshCohortBatch({store,manifest:m,mode:'execute',
     approved:true,admissionPolicy:policy,clock:()=>100,
     transport:async q=>{calls++;return makeBody(q);}});
   const restored=new JsonCheckpointStore(file);
   const after=restored.read();
   assert.equal(checkpointStats(after).counts.COMPLETED,1);
   assert.equal(nextFreshCohortBatch(after,m).batch.batchIndex,1);
   const spent=planFreshCohortBatches(m).batches[0],entry=after.sourceRequests[spent.key];
   assert.throws(()=>beginFreshCohortBatch(after,spent,'REPLAY',200),
     /FRESH_COHORT_NOT_READY_OR_DRIFT/);
   assert.equal(entry.status,'COMPLETED');
   assert.equal(calls,1);
 }finally{fs.rmSync(dir,{force:true,recursive:true});}
});
test('source origin mismatch cannot redefine jobs after checkpoint registration',()=>{
 const m=manifest(),ready=installFreshCohortPlan(
   newCheckpoint(m.scopeKey,'run-stable'),m);
 const bad=manifest();bad.specs[0].specName='Different';
 assert.throws(()=>nextFreshCohortBatch(ready,bad),
   /FRESH_COHORT_MANIFEST_OR_REQUEST_DRIFT/);
 const b=nextFreshCohortBatch(ready,m).batch;
 const changed=structuredClone(b);
 changed.jobs[0].specName='Changed';
 assert.throws(()=>beginFreshCohortBatch(ready,changed,'X',100),
   /FRESH_COHORT_NOT_READY_OR_DRIFT/);
});
test('charged source IN_FLIGHT blocks another report attempt in same scope',()=>{
 const m=manifest(),state=installFreshCohortPlan(
   newCheckpoint(m.scopeKey,'run-mutex'),m);
 const b=nextFreshCohortBatch(state,m).batch;
 const started=beginFreshCohortBatch(state,b,'SOURCE',100);
 const s={scopeKey:m.scopeKey,jobKey:'TestBoss0|Class0|Spec0',
   rank:1,snapshotSha:'a'.repeat(64),status:'PENDING',totalDps:500,
   className:'Class0',specName:'Spec0',name:'Actor1',
   reportCode:'TEST_REPORT',fightId:5,
   encounterId:3470,difficulty:4,reportRevision:null};
 const grouped=planFightFetches([s]).groups;
 const readyReport=registerPlan(started,grouped);
 const key=Object.keys(readyReport.entries)[0];
 assert.throws(()=>beginFetch(readyReport,key,'REPORT',101),
   /SCOPE_HAS_UNRESOLVED_ATTEMPT/);
});
