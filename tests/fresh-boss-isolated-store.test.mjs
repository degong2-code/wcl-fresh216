import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {newCheckpoint,checkpointStats} from '../src/core/checkpoint.mjs';
import {makeFreshDatedHeroicManifest,planFreshCohortBatches,
  installFreshCohortPlan,projectCompletedFreshCohort}
  from '../src/core/fresh-cohort-source.mjs';
import {createIsolatedBossCheckpoint,makeIsolatedBossStore}
  from '../src/core/fresh-boss-isolated-store.mjs';
import {runOneFreshBossWave}
  from '../src/core/fresh-boss-wave-journal.mjs';
const scope='boss:isolated-A-original';
const manifest=makeFreshDatedHeroicManifest(scope);
const sourceHead='a'.repeat(40);
const sourceCommit='b'.repeat(40);
const hash=o=>createHash('sha256').update(JSON.stringify(o))
  .digest('hex');
function aState({aliases=9,complete=true}={}){
  const state=installFreshCohortPlan(
    newCheckpoint(scope,'original-A'),manifest,
    {jobsPerRequest:aliases});
  state.sourceCodeCommit=sourceCommit;
  for(const b of planFreshCohortBatches(manifest,{
    jobsPerRequest:aliases
  }).batches.slice(0,complete?undefined:4)){
    const e=state.sourceRequests[b.key];e.status='COMPLETED';
    e.observedPoints=b.jobs.length+.01;
    e.attempt={id:'recorded-A'+b.batchIndex,startedAtMs:1,
      kind:'TOTAL_COHORT_BATCH'};
    e.result={jobs:b.jobs.map((j,i)=>{
      const rows=Array.from({length:100},(_,r)=>({
        name:'Actor'+r,amount:250000-1000*r-i,
        reportCode:'R_'+b.batchIndex+'_'+i+'_'+r,
        fightId:r+1,startTime:1792594801000+r*1000,
        reportRevision:null
      }));
      return {...j,rows,snapshotSha:hash(rows)};
    })};
  }
  return state;
}
function privateStore(initial,{failAt=Infinity}={}){
  let checkpoint=structuredClone(initial),writes=0;
  const historical=[];
  return {
    read:()=>structuredClone(checkpoint),
    update:fn=>{
      const result=fn(structuredClone(checkpoint));
      writes++;
      if(writes===failAt)throw Error('REMOTE_GIT_PUSH_NOT_CONFIRMED');
      checkpoint=structuredClone(result);
      historical.push(structuredClone(result));
      return structuredClone(checkpoint);
    },
    get historical(){return historical},
    get writes(){return writes}
  };
}
function okBossReply(batch){
  const encounter={};
  batch.jobs.forEach((j,i)=>{
    encounter['b'+i]={rankings:j.slots.map(s=>({
      name:s.name,amount:s.totalDps-100,
      startTime:s.startTime,
      report:{code:s.reportCode,fightID:s.fightId}
    }))};
  });
  return {httpStatus:200,body:{data:{
    rateLimitData:{currentRequest:JSON.stringify({
      total:batch.jobs.length+.01})},
    worldData:{encounter}}}};
}
test('isolated B checkpoint stores zero A rank rows and keeps original A immutable',()=>{
  const original=aState();
  const before=JSON.stringify(original);
  const initialized=createIsolatedBossCheckpoint({
    sourceState:original,sourceHead,bossJobsPerRequest:9,
    runId:'isolated-B'
  });
  const raw=JSON.stringify(initialized);
  assert.equal(initialized.version,0);
  assert.deepEqual(initialized.sourceRequests,{});
  assert.deepEqual(initialized.bossPageRequests,{});
  assert.equal(initialized.sourceCodeCommit,undefined);
  assert(!raw.includes('Actor0'));
  assert(raw.length<1500);
  assert.equal(JSON.stringify(original),before);
  const p=privateStore(initialized);
  const mounted=makeIsolatedBossStore({
    sourceState:original,sourceHead,bossJobsPerRequest:9,bossStore:p
  });
  assert.equal(mounted.batches.length,24);
  assert.equal(mounted.pin.sourceHead,sourceHead);
  assert(Math.abs(mounted.originalSourcePoints-216.24)<1e-8);
  assert.equal(Object.keys(mounted.store.read().sourceRequests).length,24);
  assert(Math.abs(checkpointStats(mounted.store.read()).witnessedPoints-216.24)<1e-8);
});
test('complete A9 + private B9: remote commit must precede HTTP and store B only',async()=>{
  const source=aState();
  const p=privateStore(createIsolatedBossCheckpoint({
    sourceState:source,sourceHead,bossJobsPerRequest:9,
    runId:'private-B9'
  }));
  const x=makeIsolatedBossStore({
    sourceState:source,sourceHead,bossJobsPerRequest:9,bossStore:p
  });
  const policy=x.bossAdmissionPolicy({
    maxBossObservedPoints:25,reservePoints:10
  });
  assert(Math.abs(policy.maxObservedPoints-(216.24+25))<1e-9);
  let http=0;
  const r=await runOneFreshBossWave({
    store:x.store,batch:x.batches[0],mode:'execute',approved:true,
    admissionPolicy:policy,clock:()=>100,attemptId:'B9-in-Git',
    transport:async query=>{
      http++;
      assert.equal((query.query.match(/metric:bossdps/g)||[]).length,9);
      assert.equal(p.historical.at(-1).bossPageRequests['page1:0']
        .status,'IN_FLIGHT');
      assert.equal(p.historical.length,2);
      return okBossReply(x.batches[0]);
    }
  });
  assert.equal(r.status,'RECORDED');
  assert.equal(r.verifiedSameFight,900);
  assert.equal(http,1);
  assert.deepEqual(p.historical.map(h=>
    h.bossPageRequests['page1:0'].status),
    ['READY','IN_FLIGHT','COMPLETED']);
  for(const persisted of p.historical){
    assert.equal(Object.keys(persisted.sourceRequests??{}).length,0);
    // B's legitimately observed SAME-FIGHT proof may contain report IDs.
    // The optimization is no copied A sourceRequests/21,600 total ranks.
    assert(!JSON.stringify(persisted).includes('sourceManifestSha'));
    assert.equal(persisted.bossSourcePin.sourceHead,sourceHead);
  }
  const reported=checkpointStats(x.store.read());
  assert(Math.abs(reported.witnessedPoints-(216.24+9.01))<1e-8);
  const replay=makeIsolatedBossStore({
    sourceState:source,sourceHead,bossJobsPerRequest:9,
    bossStore:privateStore(p.read())
  });
  const again=await runOneFreshBossWave({
    store:replay.store,batch:replay.batches[0],
    mode:'execute',approved:true,admissionPolicy:policy,
    transport:async()=>{http++;throw Error('MUST_NOT_REPLAY')}
  });
  assert.equal(again.status,'COMPLETED');
  assert.equal(again.attempted,false);
  assert.equal(http,1);
});
test('B-specific point reservation pauses a second B wave after the first charge',async()=>{
  const a=aState(),p=privateStore(createIsolatedBossCheckpoint({
    sourceState:a,sourceHead,runId:'B-budget'
  }));
  const x=makeIsolatedBossStore({
    sourceState:a,sourceHead,bossStore:p
  });
  const policy=x.bossAdmissionPolicy({
    maxBossObservedPoints:18,reservePoints:10
  });
  let calls=0;
  const first=await runOneFreshBossWave({
    store:x.store,batch:x.batches[0],mode:'execute',approved:true,
    admissionPolicy:policy,clock:()=>100,attemptId:'B-budget-one',
    transport:async()=>{calls++;return okBossReply(x.batches[0])}
  });
  assert.equal(first.status,'RECORDED');
  const second=await runOneFreshBossWave({
    store:x.store,batch:x.batches[1],mode:'execute',approved:true,
    admissionPolicy:policy,clock:()=>101,attemptId:'B-budget-two',
    transport:async()=>{calls++;throw Error('BUDGET_MUST_PAUSE')}
  });
  assert.equal(second.status,'BUDGET_PAUSED');
  assert.equal(second.attempted,false);
  assert.equal(calls,1);
  assert.equal(p.read().bossPageRequests['page1:1'].status,'READY');
});
test('unknown charge and failed remote pre-HTTP confirmation are never retried',async()=>{
  const source=aState();
  const init=createIsolatedBossCheckpoint({
    sourceState:source,sourceHead,runId:'B-crash'
  });
  const failed=privateStore(init,{failAt:2});
  const x=makeIsolatedBossStore({
    sourceState:source,sourceHead,bossStore:failed
  });
  let calls=0;
  await assert.rejects(runOneFreshBossWave({
    store:x.store,batch:x.batches[0],mode:'execute',
    approved:true,clock:()=>100,attemptId:'remote-before-http',
    admissionPolicy:x.bossAdmissionPolicy({
      maxBossObservedPoints:50,reservePoints:10
    }),transport:async()=>{calls++}
  }),/REMOTE_GIT_PUSH_NOT_CONFIRMED/);
  assert.equal(calls,0);
  assert.equal(failed.read().bossPageRequests['page1:0'].status,'READY');
  const s=privateStore(init);
  const y=makeIsolatedBossStore({
    sourceState:source,sourceHead,bossStore:s
  });
  const uncertain=await runOneFreshBossWave({
    store:y.store,batch:y.batches[0],mode:'execute',
    approved:true,clock:()=>100,attemptId:'unknown-points',
    admissionPolicy:y.bossAdmissionPolicy({
      maxBossObservedPoints:50,reservePoints:10
    }),transport:async()=>{calls++;return {httpStatus:503,body:null}}
  });
  assert.equal(uncertain.status,'NEEDS_REVIEW');
  assert.equal(s.read().bossPageRequests['page1:0'].status,'NEEDS_REVIEW');
  const repeated=await runOneFreshBossWave({
    store:y.store,batch:y.batches[0],mode:'execute',
    approved:true,admissionPolicy:y.bossAdmissionPolicy({
      maxBossObservedPoints:50,reservePoints:10
    }),transport:async()=>{calls++}
  });
  assert.equal(repeated.attempted,false);
  assert.equal(calls,1);
});
test('fail closed: incomplete A, different source HEAD, A corruption and mutated virtual A',()=>{
  const partial=aState({complete:false});
  assert.throws(()=>createIsolatedBossCheckpoint({
    sourceState:partial,sourceHead,runId:'B-must-not-start'
  }),/BOSS_ISOLATED_REQUIRES_COMPLETE_A/);
  const source=aState(),init=createIsolatedBossCheckpoint({
    sourceState:source,sourceHead,runId:'B-seal'
  });
  assert.throws(()=>makeIsolatedBossStore({
    sourceState:source,sourceHead:'c'.repeat(40),
    bossStore:privateStore(init)
  }),/BOSS_ISOLATED_B_CHECKPOINT_DRIFT/);
  assert.throws(()=>makeIsolatedBossStore({
    sourceState:source,sourceHead,bossJobsPerRequest:8,
    bossStore:privateStore(init)
  }),/BOSS_ISOLATED_B_CHECKPOINT_DRIFT/);
  const altered=structuredClone(source);
  Object.values(altered.sourceRequests)[0].result.jobs[0].rows[0]
    .amount++;
  assert.throws(()=>makeIsolatedBossStore({
    sourceState:altered,sourceHead,bossStore:privateStore(init)
  }),/FRESH_COHORT_EXPORT_DRIFT/);
  const b=privateStore(init);
  const x=makeIsolatedBossStore({
    sourceState:source,sourceHead,bossStore:b
  });
  assert.throws(()=>x.store.update(c=>{
    c.sourceRequests[Object.keys(c.sourceRequests)[0]].result.jobs[0]
      .rows[0].amount++;
    c.version++;
    return c;
  }),/BOSS_ISOLATED_MUTATED_A_OR_IDENTITY/);
  assert.equal(b.writes,0);
});
test('A8 and A9 can each feed B8 or B9 without duplicating A bytes in Git',()=>{
  for(const aAliases of [8,9]){
    const source=aState({aliases:aAliases});
    for(const bossJobsPerRequest of [8,9]){
      const raw=createIsolatedBossCheckpoint({
        sourceState:source,sourceHead,bossJobsPerRequest,
        runId:'B'+bossJobsPerRequest
      });
      const b=makeIsolatedBossStore({sourceState:source,sourceHead,
        bossJobsPerRequest,bossStore:privateStore(raw)});
      assert.equal(b.batches.length,bossJobsPerRequest===9?24:32);
      assert.equal(b.pin.sourceJobsPerRequest,aAliases);
      assert.equal(Object.keys(raw.sourceRequests).length,0);
    }
  }
});
