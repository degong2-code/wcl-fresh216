import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {JsonCheckpointStore} from '../src/adapters/json-checkpoint-store.mjs';
import {planFightFetches} from '../src/core/fetch-plan.mjs';
import {planReportWaves} from '../src/core/report-wave-plan.mjs';
import {
 newCheckpoint,registerPlan,readyFetches,beginFetch,beginWaveFetch,
 completeWaveFetch,uncertainWaveFailure,recoverCheckpoint,
 checkpointStats,committedProofs
} from '../src/core/checkpoint.mjs';
import {joinFightEvidence} from '../src/core/evidence-join.mjs';
import {executeOneReportWave} from '../src/core/report-wave-runner.mjs';

const sha='a'.repeat(64);
const slot=(i,changes={})=>({
 scopeKey:'heroic:test',jobKey:'Nekzali|Hunter|Marksmanship',
 rank:i+1,snapshotSha:sha,status:'PENDING',name:i===0?'Anonymous':'Actor'+i,
 className:'Hunter',specName:'Marksmanship',totalDps:1000-i,
 reportCode:'SYNTHETIC_REPORT',fightId:10+i,
 encounterId:3470,difficulty:4,reportRevision:5,...changes
});
function setup(n=4){
 const entries=Array.from({length:n},(_,i)=>slot(i));
 const groups=planFightFetches(entries).groups;
 const wave=planReportWaves({groups},{maxFightsPerWave:4}).waves[0];
 const state=registerPlan(newCheckpoint('heroic:test','run-1'),groups);
 return {entries,groups,wave,state};
}
function apiBody(wave,{points=21,omit=null,duplicate=false,revision=5}={}){
 const report={code:'SYNTHETIC_REPORT',revision};
 for(let i=0;i<wave.fightGroups.length;i++){
   const g=wave.fightGroups[i],s=g.slots[0];
   const a={id:7+i,name:i===0?'Player (1)':'Actor'+(s.rank-1),
     class:'Hunter',spec:'Marksmanship',amount:s.totalDps};
   const b={...a,amount:s.totalDps-200};
   const make=chars=>({data:[{fightID:g.fightId,encounter:{id:3470},
     difficulty:4,roles:{dps:{characters:chars}}}]});
   report['o'+i]=make(duplicate&&i===0?[a,{...a,id:999}]:[a]);
   report['b'+i]=make([b]);
 }
 if(omit)delete report[omit];
 return {httpStatus:200,body:{data:{rateLimitData:{currentRequest:{total:points}},
   reportData:{report}}}};
}
function mem(state){
 let current=structuredClone(state),updates=0;
 return {read:()=>structuredClone(current),update:fn=>{
   const next=fn(structuredClone(current));
   current=next;updates++;return structuredClone(next);
 },get updates(){return updates;}};
}
test('one wave, four fights, commits all proofs atomically with one billed cost',async()=>{
 const {wave,state}=setup(),store=mem(state);
 const out=await executeOneReportWave({store,wave,
   attemptId:'WAVE-1',clock:(()=>{let t=100;return()=>t+=30;})(),
   transport:async q=>{
     assert.equal(q.query.match(/:rankings\(/g).length,8);
     return apiBody(wave);
   }});
 assert.equal(out.status,'RECORDED');assert.equal(out.attempted,true);
 assert.equal(out.fights,4);assert.equal(out.verifiedSlots,4);
 assert.equal(store.updates,2);
 assert.equal(committedProofs(store.read()).length,4);
 assert.equal(checkpointStats(store.read()).witnessedPoints,21);
 assert.equal(checkpointStats(store.read()).pointsUnobserved,0);
 assert.equal(readyFetches(store.read()).length,0);
 const attempts=Object.values(store.read().entries).map(e=>e.attempt.id);
 assert.equal(new Set(attempts).size,1);
});
test('persistent JSON checkpoint survives restart and never double-charges one wave',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wcl-wave-test-'));
 try{
   const {state,wave}=setup(),file=path.join(dir,'wave-checkpoint.json');
   const store=new JsonCheckpointStore(file);store.init(state);
   await executeOneReportWave({store,wave,attemptId:'W-1',clock:()=>100,
     transport:async()=>apiBody(wave,{points:18})});
   const after=new JsonCheckpointStore(file),s=after.read();
   assert.equal(committedProofs(s).length,4);
   assert.equal(checkpointStats(s).witnessedPoints,18);
   let calls=0;
   await assert.rejects(()=>executeOneReportWave({store:after,wave,
     attemptId:'W-2',clock:()=>200,transport:async()=>{
       calls++;return apiBody(wave);
     }}),/WAVE_CHECKPOINT_NOT_READY/);
   assert.equal(calls,0);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('partial response invalidates entire wave, not just one fight',async()=>{
 const {state,wave}=setup(),store=mem(state);
 const result=await executeOneReportWave({store,wave,
   attemptId:'W-1',clock:()=>100,
   transport:async()=>apiBody(wave,{points:24,omit:'b2'})});
 assert.equal(result.status,'NEEDS_REVIEW');
 assert.equal(result.incident,'WAVE_RANKINGS_SHAPE_INVALID');
 assert.equal(committedProofs(store.read()).length,0);
 assert.equal(checkpointStats(store.read()).counts.NEEDS_REVIEW,4);
 assert.equal(checkpointStats(store.read()).witnessedPoints,24);
 assert.equal(checkpointStats(store.read()).pointsUnobserved,0);
 assert.equal(readyFetches(store.read()).length,0);
});
test('HTTP 504 and ambiguous transport: no fabricated points or automatic retry',async()=>{
 const {state,wave}=setup(),store=mem(state);
 const res=await executeOneReportWave({store,wave,
   attemptId:'W-1',clock:()=>100,
   transport:async()=>({httpStatus:504,body:null})});
 assert.equal(res.status,'NEEDS_REVIEW');
 assert.equal(res.incident,'HTTP_OR_GRAPHQL_UNCERTAIN');
 assert.equal(checkpointStats(store.read()).pointsUnobserved,1);
 assert.equal(checkpointStats(store.read()).pointsTotalConfirmed,null);
 let calls=0;
 await assert.rejects(()=>executeOneReportWave({store,wave,attemptId:'W-2',
   clock:()=>200,transport:async()=>{calls++;return apiBody(wave);}}),
   /WAVE_CHECKPOINT_NOT_READY/);
 assert.equal(calls,0);
});
test('crash after marker leaves whole wave NEEDS_REVIEW on recovery',()=>{
 const {state,wave}=setup();
 const inflight=beginWaveFetch(state,wave,'CRASH-1',100);
 assert.equal(checkpointStats(inflight).counts.IN_FLIGHT,4);
 assert.equal(checkpointStats(inflight).pointsUnobserved,1);
 const recovered=recoverCheckpoint(inflight);
 assert.equal(checkpointStats(recovered).counts.NEEDS_REVIEW,4);
 assert.equal(checkpointStats(recovered).pointsUnobserved,1);
 assert.equal(Object.values(recovered.entries).every(e=>
   e.incident.code==='INTERRUPTED_IN_FLIGHT'&&
   e.incident.automaticRetry===false),true);
});
test('one corrupt proof blocks all four commits in pure transition',()=>{
 const {state,wave}=setup(),inflight=beginWaveFetch(state,wave,'W-1',100);
 const decoded=apiBody(wave).body.data.reportData.report;
 const joins=wave.fightGroups.map((g,i)=>joinFightEvidence(g,{
   code:decoded.code,revision:decoded.revision,
   overall:decoded['o'+i],boss:decoded['b'+i]}));
 assert.deepEqual(joins.map(x=>x.verified.length),[1,1,1,1]);
 joins[3].verified[0].proof.fightId=999;
 assert.throws(()=>completeWaveFetch(inflight,wave,'W-1',joins,{
   points:15,wallMs:50}),/INVALID_PROOF/);
 assert.equal(committedProofs(inflight).length,0);
 assert.equal(checkpointStats(inflight).counts.IN_FLIGHT,4);
});
test('partially ambiguous actors stay null while valid co-fights commit',async()=>{
 const {state,wave}=setup(),store=mem(state);
 const out=await executeOneReportWave({store,wave,attemptId:'W-1',
   clock:()=>100,transport:async()=>apiBody(wave,{duplicate:true,points:13})});
 assert.equal(out.status,'RECORDED');assert.equal(out.verifiedSlots,3);
 assert.equal(out.unresolvedSlots,1);
 assert.equal(checkpointStats(store.read()).witnessedPoints,13);
 assert.equal(checkpointStats(store.read()).counts.COMPLETED_PARTIAL,1);
});
test('stale budget or foreign in-flight attempt blocks whole wave before HTTP',async()=>{
 const {state,wave}=setup(),store=mem(state);
 let invoked=0;
 const budget=await executeOneReportWave({store,wave,attemptId:'W-1',
   clock:()=>100,
   admissionPolicy:{notBeforeMs:0,maxObservedPoints:10,reservePoints:11},
   transport:async()=>{invoked++;return apiBody(wave);}});
 assert.equal(budget.status,'BUDGET_PAUSED');
 assert.equal(store.updates,0);
 const first=readyFetches(store.read())[0].key;
 store.update(s=>beginFetch(s,first,'FOREIGN',100));
 await assert.rejects(()=>executeOneReportWave({store,wave,attemptId:'W-2',
   clock:()=>200,transport:async()=>{invoked++;return apiBody(wave);}}),
   /WAVE_CHECKPOINT_NOT_READY/);
 assert.equal(invoked,0);
});
test('incorrect wave membership and repeated attempt IDs cannot dispatch',()=>{
 const {state,wave}=setup(),wrong=structuredClone(wave);
 wrong.fightGroups[0].slots[0].totalDps=3000;
 assert.throws(()=>beginWaveFetch(state,wrong,'BAD',100),
   /WAVE_CHECKPOINT_SLOT_DRIFT/);
 const first=beginWaveFetch(state,wave,'A1',100);
 assert.throws(()=>beginWaveFetch(first,wave,'A2',120),
   /WAVE_CHECKPOINT_NOT_READY/);
 assert.throws(()=>uncertainWaveFailure(first,wave,'OTHER',{code:'HTTP_504'}),
   /WAVE_CHECKPOINT_ATTEMPT_DRIFT/);
});
