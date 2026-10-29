import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {JsonCheckpointStore} from '../src/adapters/json-checkpoint-store.mjs';
import {newCheckpoint,registerPlan,beginFetch,checkpointStats,
  recoverCheckpoint,committedProofs} from '../src/core/checkpoint.mjs';
import {planFightFetches} from '../src/core/fetch-plan.mjs';
import {registerRankBatch,beginRankBatch,readyRankBatches,
  committedRankingEvidence} from '../src/core/rank-batch-checkpoint.mjs';
import {makeRankBatchQuery,decodeRankBatch,executeOneRankBatch}
  from '../src/core/rank-batch-runner.mjs';

const sha='a'.repeat(64),start=1792600000000,scopeKey='heroic:synthetic';
const slots=(anonymous=false)=>Array.from({length:100},(_,i)=>({
 scopeKey,jobKey:'Nekzali|Hunter|Marksmanship',rank:i+1,snapshotSha:sha,
 encounterId:3470,difficulty:4,className:'Hunter',specName:'Marksmanship',
 totalDps:3000-i,reportCode:'R'+i,fightId:i+1,
 startTime:start+i,reportRevision:5,
 status:'PENDING',name:anonymous&&i===0?'Anonymous':'Actor'+i
}));
const batch=(rows,firstPage=1,pageCount=1)=>({
 scopeKey,jobKey:rows[0].jobKey,snapshotSha:sha,
 encounterId:3470,difficulty:4,className:'Hunter',specName:'Marksmanship',
 filter:'date.1792594800000.1793199600000',firstPage,pageCount,slots:rows
});
const report=(s,b)=>({name:s.name,amount:b,startTime:s.startTime,
 report:{code:s.reportCode,fightID:s.fightId}});
const body=(rows,which=0)=>{
 const ranked=Array.from({length:100},(_,i)=>{
   const matching=which===0?i<50:i>=50;
   if(matching)return report(rows[i],rows[i].totalDps-100);
   return {name:'Unrelated'+which+'_'+i,amount:50,
     startTime:start+500+i,
     report:{code:'Other'+which+'_'+i,fightID:1000+i}};
 });
 return {httpStatus:200,body:{data:{
  rateLimitData:{currentRequest:{total:1.01}},
  worldData:{encounter:{b0:{rankings:ranked,hasMorePages:true}}}
 }}};
};
function mem(state){
 let value=structuredClone(state),updates=0;
 return {read:()=>structuredClone(value),update:fn=>{
   const next=fn(structuredClone(value));updates++;value=next;
   return structuredClone(value);
 },get updates(){return updates;}};
}
test('rank query requests only immutable cached-cohort Boss pages, no total or partition',()=>{
 const q=makeRankBatchQuery(batch(slots(),11,3));
 assert.match(q.query,/page:11/);assert.match(q.query,/page:13/);
 assert.doesNotMatch(q.query,/metric:dps/);
 assert.doesNotMatch(q.query,/partition/);
 assert.equal(q.variables.filter,'date.1792594800000.1793199600000');
});
test('first and second durable page batches share cost journal and evidence',async()=>{
 const rows=slots(),store=mem(registerRankBatch(
   newCheckpoint(scopeKey,'r1'),batch(rows)));
 const first=readyRankBatches(store.read())[0];
 const a=await executeOneRankBatch({store,request:first,attemptId:'RA',
   clock:()=>100,transport:async()=>body(rows,0)});
 assert.equal(a.status,'RECORDED');assert.equal(a.verified,50);
 store.update(s=>registerRankBatch(s,batch(rows,2)));
 const second=readyRankBatches(store.read())[0];
 const b=await executeOneRankBatch({store,request:second,attemptId:'RB',
   clock:()=>200,transport:async()=>body(rows,1)});
 assert.equal(b.status,'RECORDED');assert.equal(b.verified,50);
 const stats=checkpointStats(store.read());
 assert.equal(stats.witnessedPoints,2.02);
 assert.equal(stats.verifiedSlotEvidence,100);
 assert.equal(committedProofs(store.read()).length,100);
 const observations=committedRankingEvidence(store.read());
 assert.equal(observations.length,1);assert.deepEqual(
   observations[0].pages.map(x=>x.newVerifiedRanks.length),[50,50]);
});
test('unknown positive actor ID not required; same name/fight/start is unique',()=>{
 const rows=slots(),q=batch(rows);
 const result=decodeRankBatch(q,200,body(rows,0).body);
 assert.equal(result.status,'OK');assert.equal(result.result.verified.length,50);
 assert.equal(result.result.verified[0].proof.sourceStartTime,start);
 assert.equal(result.result.verified[0].proof.actorRef,'name:actor0');
});
test('Anonymous remains unresolved for same-fight Report fallback',()=>{
 const rows=slots(true),out=decodeRankBatch(batch(rows),200,body(rows,0).body);
 assert.equal(out.status,'OK');assert.equal(out.result.verified.length,49);
 assert.equal(out.result.pages[0].newVerifiedRanks.includes(1),false);
});
test('page21 error shaped response marks WCL pagination UNAVAILABLE',()=>{
 const rows=slots(),q=batch(rows,21,2);
 const res=decodeRankBatch(q,200,{data:{rateLimitData:{
  currentRequest:{total:1.01}},worldData:{encounter:{
   b0:{error:'synthetic unavailable'},b1:{rankings:[]}
 }}}});
 assert.equal(res.status,'OK');
 assert.deepEqual(res.result.pages,[{page:21,status:'UNAVAILABLE',
   rowCount:null,newVerifiedRanks:[]}]);
});
test('conflicting startTime or duplicate row cannot create exact proof',()=>{
 const rows=slots(),b=body(rows,0);
 b.body.data.worldData.encounter.b0.rankings[0].startTime++;
 const out=decodeRankBatch(batch(rows),200,b.body);
 assert.equal(out.result.verified.length,49);
 const corrupt=body(rows,0);
 corrupt.body.data.worldData.encounter.b0.rankings[99]=
   structuredClone(corrupt.body.data.worldData.encounter.b0.rankings[1]);
 const dup=decodeRankBatch(batch(rows),200,corrupt.body);
 assert.equal(dup.result.verified.some(x=>x.rank===2),false);
});
test('persisted rank request survives restart; replay fails before network',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wcl-rank-checkpoint-'));
 try{
   const rows=slots(),file=path.join(dir,'checkpoint.json');
   const store=new JsonCheckpointStore(file);
   store.init(registerRankBatch(newCheckpoint(scopeKey,'r1'),batch(rows)));
   await executeOneRankBatch({store,request:readyRankBatches(store.read())[0],
     attemptId:'R1',clock:()=>100,transport:async()=>body(rows)});
   const reloaded=new JsonCheckpointStore(file),observed=reloaded.read();
   assert.equal(committedProofs(observed).length,50);
   let calls=0;
   await assert.rejects(()=>executeOneRankBatch({
     store:reloaded,request:batch(rows),attemptId:'R2',clock:()=>200,
     transport:async()=>{calls++;return body(rows);}
   }),/RANK_REQUEST_NOT_READY|RANK_RUNNER_CONFIG_INVALID/);
   assert.equal(calls,0);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('crash after rank request marker goes to NEEDS_REVIEW without replay',()=>{
 const rows=slots(),ready=registerRankBatch(
   newCheckpoint(scopeKey,'r1'),batch(rows));
 const key=readyRankBatches(ready)[0].key;
 const marked=beginRankBatch(ready,key,'UNCERTAIN',100);
 const recovered=recoverCheckpoint(marked),stat=checkpointStats(recovered);
 assert.equal(stat.counts.NEEDS_REVIEW,1);
 assert.equal(stat.pointsUnobserved,1);
 assert.equal(stat.pointsTotalConfirmed,null);
 assert.equal(readyRankBatches(recovered).length,0);
});
test('an in-flight Report blocks ranking and vice versa in same scope',async()=>{
 const rows=slots(true),r=registerRankBatch(
   newCheckpoint(scopeKey,'r1'),batch(rows));
 const single=planFightFetches([rows[0]]).groups;
 const withReport=registerPlan(r,single);
 const ranked=beginRankBatch(withReport,readyRankBatches(withReport)[0].key,
   'RANK_FIRST',100);
 assert.throws(()=>beginFetch(ranked,Object.keys(ranked.entries)[0],
   'REPORT_SECOND',101),/SCOPE_HAS_UNRESOLVED_ATTEMPT/);
 const reportFirst=beginFetch(withReport,Object.keys(withReport.entries)[0],
   'REPORT_FIRST',100);
 const store=mem(reportFirst);let calls=0;
 const result=await executeOneRankBatch({store,
   request:readyRankBatches(reportFirst)[0],attemptId:'RANK_SECOND',
   clock:()=>101,transport:async()=>{calls++;return body(rows);}});
 assert.equal(result.status,'NEEDS_REVIEW');assert.equal(calls,0);
});
test('bad 504 response records incident and no made-up point charge',async()=>{
 const rows=slots(),store=mem(registerRankBatch(newCheckpoint(scopeKey,'r1'),batch(rows)));
 const req=readyRankBatches(store.read())[0];
 const output=await executeOneRankBatch({store,request:req,attemptId:'X',
   clock:()=>100,transport:async()=>({httpStatus:504,body:null})});
 assert.equal(output.status,'NEEDS_REVIEW');
 assert.equal(checkpointStats(store.read()).pointsUnobserved,1);
 assert.equal(committedProofs(store.read()).length,0);
});

test('resumed paid query cannot change checkpointed boss, spec or actor slots',async()=>{
 const rows=slots(),store=mem(registerRankBatch(
   newCheckpoint(scopeKey,'r1'),batch(rows)));
 const valid=readyRankBatches(store.read())[0];
 let calls=0;
 await assert.rejects(()=>executeOneRankBatch({store,
   request:{...valid,encounterId:9999},attemptId:'BAD-1',clock:()=>100,
   transport:async()=>{calls++;return body(rows);}}),
   /RANK_REQUEST_IDENTITY_DRIFT/);
 const altered=structuredClone(valid);
 altered.slots[0].name='OtherActor';
 await assert.rejects(()=>executeOneRankBatch({store,
   request:altered,attemptId:'BAD-2',clock:()=>100,
   transport:async()=>{calls++;return body(rows);}}),
   /RANK_REQUEST_SLOT_DRIFT/);
 assert.equal(calls,0);assert.equal(store.updates,0);
});

test('hasMorePages=false terminates a full 100-row page with no extra paid rank',async()=>{
 const rows=slots(),store=mem(registerRankBatch(
   newCheckpoint(scopeKey,'r1'),batch(rows)));
 const req=readyRankBatches(store.read())[0];
 const out=await executeOneRankBatch({store,request:req,attemptId:'LAST',
   clock:()=>100,transport:async()=>{
     const reply=body(rows);
     reply.body.data.worldData.encounter.b0.hasMorePages=false;
     return reply;
   }});
 assert.equal(out.status,'RECORDED');
 const observed=committedRankingEvidence(store.read())[0].pages[0];
 assert.equal(observed.rowCount,100);
 assert.equal(observed.hasMorePages,false);
 assert.throws(()=>store.update(s=>registerRankBatch(s,batch(rows,2))),
   /RANK_REQUEST_SEQUENCE_OR_SNAPSHOT_DRIFT/);
});

test('revisionless source recovers unique name/fight with exact startTime',()=>{
 const rows=slots().map(s=>({...s,reportRevision:null}));
 const d=decodeRankBatch(batch(rows),200,body(rows,0).body);
 assert.equal(d.status,'OK');
 assert.equal(d.result.verified.length,50);
 assert.equal(d.result.verified[0].proof.reportRevision,null);
 assert.equal(d.result.verified[0].proof.sourceStartTime,start);
});
