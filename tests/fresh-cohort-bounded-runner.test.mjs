import test from 'node:test';
import assert from 'node:assert/strict';
import {newCheckpoint,checkpointStats} from '../src/core/checkpoint.mjs';
import {
  makeFreshDatedHeroicManifest,planFreshCohortBatches,
  exportVerifiedFreshCohort,nextFreshCohortBatch
} from '../src/core/fresh-cohort-source.mjs';
import {runBoundedFreshCohortBatches}
  from '../src/core/fresh-cohort-bounded-runner.mjs';

const manifest=makeFreshDatedHeroicManifest('offline:batch-restart');
const clock=()=>1792594801000;
const budget={notBeforeMs:0,maxObservedPoints:300,reservePoints:10};
function store(initial=newCheckpoint(manifest.scopeKey,'offline-bounded-run')){
  let saved=structuredClone(initial);
  const commits=[];
  return {
    read:()=>structuredClone(saved),
    update:transition=>{
      const old=saved,next=transition(structuredClone(saved));
      assert.equal(next.version,old.version+1);
      saved=structuredClone(next);
      // A real private host Git-pushes and remote-verifies at this boundary.
      commits.push(structuredClone(next));
      return structuredClone(saved);
    },
    get commits(){return commits}
  };
}
function response(query,{httpStatus=200}={}){
  if(httpStatus!==200)return {httpStatus,body:null};
  const items={},id=query.variables.id;
  let aliases=0;
  while(Object.hasOwn(query.variables,'c'+aliases)){
    const cls=query.variables['c'+aliases],spec=query.variables['s'+aliases];
    items['t'+aliases]={rankings:Array.from({length:100},(_,r)=>({
      name:'Synthetic'+r,amount:100000-r*100-aliases,
      startTime:1792594801000+r*1000,
      report:{code:'R_'+id+'_'+aliases+'_'+r,fightID:r+1},
      className:cls,specName:spec
    }))};
    aliases++;
  }
  return {httpStatus,body:{data:{
    rateLimitData:{currentRequest:JSON.stringify({total:aliases+0.01})},
    worldData:{encounter:items}
  }}};
}
test('both sizes have exactly 216 jobs, 9 aliases yield 24 calls vs 8 aliases 32',()=>{
  const a=planFreshCohortBatches(manifest,{jobsPerRequest:8});
  const b=planFreshCohortBatches(manifest,{jobsPerRequest:9});
  assert.equal(a.requestCount,32);
  assert.equal(b.requestCount,24);
  assert.equal(a.batches.reduce((v,x)=>v+x.jobs.length,0),216);
  assert.equal(b.batches.reduce((v,x)=>v+x.jobs.length,0),216);
  assert.ok(b.batches.every(x=>x.jobs.length===9));
});
test('single owner batch cap, durable attempt before each HTTP, no replay after restart',async()=>{
  const s=store();let calls=0,seenMarkers=[];
  const transport=async query=>{
    calls++;const state=s.read();
    const inFlight=Object.values(state.sourceRequests).filter(x=>x.status==='IN_FLIGHT');
    assert.equal(inFlight.length,1);
    assert.equal(inFlight[0].batch.jobs.length,9);
    assert.equal(s.commits.at(-1).sourceRequests[inFlight[0].key].status,'IN_FLIGHT');
    seenMarkers.push(state.version);
    return response(query);
  };
  const run=await runBoundedFreshCohortBatches({
    store:s,manifest,transport,approved:true,
    jobsPerRequest:9,maxRequests:2,admissionPolicy:budget,clock
  });
  assert.equal(run.status,'MAX_REQUESTS_REACHED');
  assert.equal(run.attemptedRequests,2);
  assert.equal(run.recordedRequests,2);
  assert.equal(run.observedPoints,18.02);
  assert.equal(run.completedJobs,18);
  assert.equal(run.nextBatchIndex,2);
  assert.equal(calls,2);
  assert.deepEqual(seenMarkers,[2,4]);
  assert.equal(s.commits.length,5); // register plan, begin/end per HTTP
  const resumed=store(s.read());
  const next=await runBoundedFreshCohortBatches({
    store:resumed,manifest,transport:async q=>{calls++;return response(q)},
    approved:true,jobsPerRequest:9,maxRequests:1,admissionPolicy:budget,clock
  });
  assert.equal(next.attemptedRequests,1);
  assert.equal(next.completedJobs,27);
  assert.equal(next.nextBatchIndex,3);
  assert.equal(calls,3);
  assert.equal(resumed.commits.length,2);
});
test('budget pauses before a second charged HTTP and does not change checkpoint',async()=>{
  const s=store();let calls=0;
  const receipt=await runBoundedFreshCohortBatches({
    store:s,manifest,transport:async q=>{calls++;return response(q)},
    approved:true,jobsPerRequest:9,maxRequests:5,
    admissionPolicy:{...budget,maxObservedPoints:16},clock
  });
  assert.equal(receipt.status,'BUDGET_PAUSED');
  assert.equal(receipt.attemptedRequests,1);
  assert.equal(receipt.recordedRequests,1);
  assert.equal(receipt.completedJobs,9);
  assert.equal(calls,1);
  assert.equal(s.commits.length,3);
  assert.equal(nextFreshCohortBatch(s.read(),manifest).batch.batchIndex,1);
});
test('uncertain call blocks the complete 9-alias wave and all automatic retries',async()=>{
  const s=store();let calls=0;
  const one=await runBoundedFreshCohortBatches({
    store:s,manifest,approved:true,jobsPerRequest:9,maxRequests:12,
    admissionPolicy:budget,clock,transport:async()=>{
      calls++;return response({}, {httpStatus:503});
    }
  });
  assert.equal(one.status,'NEEDS_REVIEW');
  assert.equal(one.attemptedRequests,1);
  assert.equal(one.recordedRequests,0);
  assert.equal(calls,1);
  assert.equal(checkpointStats(s.read()).counts.NEEDS_REVIEW,1);
  const before=s.commits.length;
  const second=await runBoundedFreshCohortBatches({
    store:s,manifest,approved:true,jobsPerRequest:9,maxRequests:12,
    admissionPolicy:budget,clock,transport:async()=>{calls++;throw Error('MUST_NOT_CALL')}
  });
  assert.equal(second.status,'NEEDS_REVIEW');
  assert.equal(second.attemptedRequests,0);
  assert.equal(s.commits.length,before);
  assert.equal(calls,1);
});
test('synthetic 9-alias run covers all 216 jobs, exact100 export, and refuses 8-alias drift',async()=>{
  const s=store();let calls=0;
  const result=await runBoundedFreshCohortBatches({
    store:s,manifest,approved:true,jobsPerRequest:9,maxRequests:24,
    admissionPolicy:budget,clock,
    transport:async q=>{calls++;return response(q)}
  });
  assert.equal(result.status,'SOURCE_COMPLETE');
  assert.equal(result.sourceComplete,true);
  assert.equal(result.completedJobs,216);
  assert.equal(result.recordedRequests,24);
  assert.ok(Math.abs(result.observedPoints-216.24)<1e-8);
  assert.equal(calls,24);
  const out=exportVerifiedFreshCohort(s.read(),manifest);
  assert.equal(out.slots.length,21600);
  assert.equal(out.summary.rankSlots,21600);
  assert.equal(s.commits.length,49);
  const again=await runBoundedFreshCohortBatches({
    store:s,manifest,approved:true,jobsPerRequest:9,maxRequests:5,
    admissionPolicy:budget,clock,transport:async()=>{calls++;throw Error('NO_REPLAY')}
  });
  assert.equal(again.status,'SOURCE_COMPLETE');
  assert.equal(again.attemptedRequests,0);
  assert.equal(calls,24);
  await assert.rejects(()=>runBoundedFreshCohortBatches({
    store:s,manifest,approved:true,jobsPerRequest:8,maxRequests:1,
    admissionPolicy:budget,clock,transport:async()=>{calls++;throw Error('DRIFT')}
  }),/FRESH_COHORT_BATCH_SIZE_DRIFT/);
  assert.equal(calls,24);
});


const hourly=(spent=20,reset=120)=>({
  limitPerHour:3600,pointsSpentThisHour:spent,pointsResetIn:reset,
  databaseLimitPerHour:250,databasePointsSpentThisHour:10,
  currentRequest:JSON.stringify({total:1})
});
test('checkpoint with >90 lifetime points resumes under fresh hourly allowance',async()=>{
 const s=store();
 const old=await runBoundedFreshCohortBatches({
   store:s,manifest,approved:true,
   jobsPerRequest:9,maxRequests:11,
   admissionPolicy:budget,clock,
   transport:async q=>response(q)
 });
 assert.equal(old.completedJobs,99);
 assert.ok(old.observedPoints>90);
 let probes=0,rankCalls=0;
 const next=await runBoundedFreshCohortBatches({
   store:s,manifest,approved:true,jobsPerRequest:9,
   maxRequests:3,admissionPolicy:{
     notBeforeMs:0,maxObservedPoints:25,reservePoints:10
   },clock,
   quotaReader:async()=>{probes++;return hourly(120)},
   transport:async q=>{rankCalls++;return response(q)}
 });
 assert.equal(next.status,'BUDGET_PAUSED');
 assert.equal(next.recordedRequests,2);
 assert.equal(rankCalls,2);
 assert.equal(probes,1);
 assert.equal(next.hourlyQuotaProbes,1);
 assert.equal(next.quotaProbePointsObserved,1);
 assert.ok(Math.abs(next.totalInvocationApiPointsObserved-19.02)<1e-8);
 assert.equal(next.budgetBasis,'APPROVED_INVOCATION');
 assert.ok(next.lifetimePointsBeforeInvocation>90);
 assert.equal(next.completedJobs,117);
 assert.equal(next.nextBatchIndex,13);
});
test('near-exhausted hour pauses without any rank HTTP or checkpoint write',async()=>{
 const s=store();let rankCalls=0;
 const paused=await runBoundedFreshCohortBatches({
   store:s,manifest,approved:true,jobsPerRequest:9,
   maxRequests:3,admissionPolicy:budget,clock,
   quotaReader:async()=>hourly(3597,28),
   transport:async q=>{rankCalls++;return response(q)}
 });
 assert.equal(paused.status,'HOURLY_RATE_WAIT');
 assert.equal(paused.waitMs,29000);
 assert.equal(paused.attemptedRequests,0);
 assert.equal(paused.recordedRequests,0);
 assert.equal(paused.hourlyQuotaProbes,1);
 assert.equal(rankCalls,0);
 assert.equal(s.commits.length,0);
 const fresh=await runBoundedFreshCohortBatches({
   store:s,manifest,approved:true,jobsPerRequest:9,
   maxRequests:2,admissionPolicy:budget,clock,
   quotaReader:async()=>hourly(12,3590),
   transport:async q=>{rankCalls++;return response(q)}
 });
 assert.equal(fresh.status,'MAX_REQUESTS_REACHED');
 assert.equal(fresh.recordedRequests,2);
 assert.equal(fresh.nextBatchIndex,2);
 assert.equal(fresh.hourlyQuotaProbes,1);
 assert.equal(rankCalls,2);
});
test('database-point shortage blocks only if explicitly required',async()=>{
 const s=store(),quota={
   limitPerHour:3600,pointsSpentThisHour:40,pointsResetIn:42,
   databaseLimitPerHour:250,databasePointsSpentThisHour:245,
   currentRequest:JSON.stringify({total:1})
 };
 const r=await runBoundedFreshCohortBatches({
   store:s,manifest,approved:true,jobsPerRequest:9,
   maxRequests:2,admissionPolicy:{
     ...budget,databaseReservePoints:10
   },clock,quotaReader:async()=>quota,
   transport:async()=>{throw Error('NO_SOURCE_REQUEST')}
 });
 assert.equal(r.status,'HOURLY_RATE_WAIT');
 assert.equal(r.waitMs,43000);
 assert.equal(s.commits.length,0);
});
test('failed quota probe never writes a source marker or sends data HTTP',async()=>{
 const s=store();let calls=0;
 const r=await runBoundedFreshCohortBatches({
   store:s,manifest,approved:true,jobsPerRequest:9,
   maxRequests:1,admissionPolicy:budget,clock,
   quotaReader:async()=>{throw Error('PROBE_NETWORK_UNKNOWN')},
   transport:async()=>{calls++;throw Error('MUST_NOT_SEND_SOURCE')}
 });
 assert.equal(r.status,'HOURLY_QUOTA_UNAVAILABLE');
 assert.equal(r.hourlyQuotaProbes,1);
 assert.equal(r.quotaProbePointsObserved,null);
 assert.equal(r.attemptedRequests,0);
 assert.equal(calls,0);
 assert.equal(s.commits.length,0);
});
test('hour reset never clears unknown source attempt or auto-replays HTTP',async()=>{
 const s=store();let rankCalls=0,quotaCalls=0;
 const first=await runBoundedFreshCohortBatches({
   store:s,manifest,approved:true,jobsPerRequest:9,
   maxRequests:2,admissionPolicy:budget,clock,
   quotaReader:async()=>{quotaCalls++;return hourly()},
   transport:async()=>{rankCalls++;return response({}, {httpStatus:503})}
 });
 assert.equal(first.status,'NEEDS_REVIEW');
 assert.equal(rankCalls,1);
 const second=await runBoundedFreshCohortBatches({
   store:s,manifest,approved:true,jobsPerRequest:9,
   maxRequests:2,admissionPolicy:budget,clock,
   quotaReader:async()=>{quotaCalls++;return hourly(0)},
   transport:async()=>{rankCalls++;throw Error('REPLAY')}
 });
 assert.equal(second.status,'NEEDS_REVIEW');
 assert.equal(second.attemptedRequests,0);
 assert.equal(rankCalls,1);
 assert.equal(quotaCalls,1);
});
