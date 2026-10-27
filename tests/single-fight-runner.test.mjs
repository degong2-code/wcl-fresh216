import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {planFightFetches} from '../src/core/fetch-plan.mjs';
import {JsonCheckpointStore} from '../src/adapters/json-checkpoint-store.mjs';
import {executeOneReadyFight,runBoundedSweep} from '../src/core/single-fight-runner.mjs';
import {
  newCheckpoint,registerPlan,readyFetches,checkpointStats,
  recoverCheckpoint,stopCheckpoint,committedProofs
} from '../src/core/checkpoint.mjs';

const slot=(change={})=>({
  scopeKey:'heroic:fixture',jobKey:'Boss|Hunter|Marksmanship',
  rank:1,snapshotSha:'a'.repeat(64),status:'PENDING',
  name:'Anonymous',className:'Hunter',specName:'Marksmanship',
  totalDps:1000,reportCode:'SYNTHETIC_ONLY',fightId:12,
  encounterId:3470,difficulty:4,reportRevision:5,...change
});
function groups(twoFights=false){
  const all=[slot(),slot({
    jobKey:'Boss|Mage|Arcane',rank:8,snapshotSha:'b'.repeat(64),
    totalDps:900,className:'Mage',specName:'Arcane'
  })];
  if(twoFights)all.push(slot({
    jobKey:'Boss|Priest|Shadow',rank:12,snapshotSha:'c'.repeat(64),
    totalDps:850,className:'Priest',specName:'Shadow',fightId:13
  }));
  return planFightFetches(all).groups;
}
const actor=(id,amount,cls,spec,name)=>({
  id,amount,name,class:cls,spec
});
function response(fightId,points=17){
  const actors=[
    actor(3,1000,'Hunter','Marksmanship','ExampleHunter'),
    actor(8,900,'Mage','Arcane','ExampleMage')
  ];
  if(fightId===13)actors.push(actor(10,850,'Priest','Shadow','ExamplePriest'));
  const bossActors=actors.map(a=>({...a,amount:a.amount*.7}));
  const fight=characters=>({
    fightID:fightId,encounter:{id:3470},difficulty:4,
    roles:{dps:{characters}}
  });
  return {httpStatus:200,body:{data:{
    rateLimitData:{currentRequest:{total:points}},
    reportData:{report:{code:'SYNTHETIC_ONLY',revision:5,
      overall:{data:[fight(actors)]},boss:{data:[fight(bossActors)]}}}
  }}};
}
class MemoryStore {
  constructor(s){this.value=s;this.updates=0;}
  read(){return structuredClone(this.value);}
  update(fn){
    const old=this.read(),next=fn(old);
    assert.equal(next.version,this.value.version+1);
    this.value=structuredClone(next);
    this.updates++;
    return this.read();
  }
}
function makeStore(two=false){
  return new MemoryStore(registerPlan(newCheckpoint('heroic:fixture','RUN'),
    groups(two)));
}
test('one durable grouped Fight call fans out to two class/spec actor proofs',async()=>{
  const store=makeStore();let requests=0;
  const result=await executeOneReadyFight({
    store,clock:(()=>{let n=100;return()=>n+=10})(),attemptId:'A1',
    transport:async query=>{
      requests++;
      assert.match(query.query,/boss:rankings/);
      assert.equal(query.variables.code,'SYNTHETIC_ONLY');
      assert.equal(store.read().version,2);
      assert.equal(Object.values(store.read().entries)[0].status,'IN_FLIGHT');
      return response(12,19);
    }
  });
  assert.equal(requests,1);
  assert.equal(result.status,'COMPLETED');
  assert.equal(result.verifiedSlots,2);
  assert.equal(result.unresolvedSlots,0);
  assert.equal(result.observedPoints,19);
  assert.equal(result.wallMs,10);
  assert.equal(store.updates,2);
  assert.equal(committedProofs(store.read()).length,2);
  assert.equal(checkpointStats(store.read()).pointsTotalConfirmed,19);
  assert.equal((await executeOneReadyFight({store,transport:async()=>{throw Error('NO')}})).status,'NO_READY');
});
test('real atomic JSON store marks IN_FLIGHT before mock transport and commits',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'wcl-runner-offline-'));
  try{
    const file=path.join(root,'private-state.json'),store=new JsonCheckpointStore(file);
    store.init(registerPlan(newCheckpoint('heroic:fixture','RUN2'),groups()));
    const result=await executeOneReadyFight({
      store,attemptId:'PERSISTED-A1',clock:()=>100,
      transport:async()=>{
        const reloaded=new JsonCheckpointStore(file).read();
        assert.equal(Object.values(reloaded.entries)[0].status,'IN_FLIGHT');
        return response(12,23);
      }
    });
    assert.equal(result.status,'COMPLETED');
    assert.equal(checkpointStats(new JsonCheckpointStore(file).read()).witnessedPoints,23);
    assert.equal(fs.statSync(file).mode&0o777,0o600);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('a transport exception becomes one uncertain incident, never an automatic retry',async()=>{
  const store=makeStore();let calls=0;
  const r=await executeOneReadyFight({store,attemptId:'A1',clock:()=>100,
    transport:async()=>{calls++;throw Error('could have charged us')}});
  assert.equal(r.status,'NEEDS_REVIEW');
  assert.equal(r.incident,'TRANSPORT_OR_PROCESSING_EXCEPTION');
  assert.equal(r.observedPoints,null);
  assert.equal(checkpointStats(store.read()).pointsTotalConfirmed,null);
  await executeOneReadyFight({store,attemptId:'A2',clock:()=>110,
    transport:async()=>{calls++;return response(12)}});
  assert.equal(calls,1);
});
test('GraphQL failure can preserve partial observed cost but cannot commit proof',async()=>{
  const store=makeStore();
  const r=await executeOneReadyFight({store,attemptId:'A1',clock:()=>100,
    transport:async()=>({
      httpStatus:200,body:{errors:[{message:'synthetic partial error'}],
        data:{rateLimitData:{currentRequest:{total:32}}}}
    })});
  assert.equal(r.status,'NEEDS_REVIEW');
  assert.equal(r.incident,'UNCERTAIN_HTTP_OR_GRAPHQL');
  assert.equal(r.observedPoints,32);
  assert.equal(checkpointStats(store.read()).pointsTotalConfirmed,32);
  assert.equal(committedProofs(store.read()).length,0);
});
test('changed WCL report revision is blocked, even with 200 success',async()=>{
  const store=makeStore();
  const responseBody=response(12,11);
  responseBody.body.data.reportData.report.revision=6;
  const r=await executeOneReadyFight({store,attemptId:'A1',clock:()=>100,
    transport:async()=>responseBody});
  assert.equal(r.incident,'REPORT_IDENTITY_OR_REVISION_MISMATCH');
  assert.equal(r.verifiedSlots,0);
  assert.equal(r.observedPoints,11);
});
test('stop and cancel before beginning cost nothing and issue no request',async()=>{
  const store=makeStore();
  let calls=0;
  const cancelled=await executeOneReadyFight({store,attemptId:'A1',
    shouldCancel:()=>true,transport:async()=>{calls++;return response(12)}});
  assert.equal(cancelled.status,'CANCELLED_BEFORE_REQUEST');
  assert.equal(store.updates,0);
  store.update(stopCheckpoint);
  const stopped=await executeOneReadyFight({store,attemptId:'A2',
    transport:async()=>{calls++;return response(12)}});
  assert.equal(stopped.status,'NOT_ACTIVE');
  assert.equal(calls,0);
  assert.equal(readyFetches(store.read()).length,0);
});
test('process failure DURING evidence persist leaves uncertain IN_FLIGHT',async()=>{
  const store=makeStore(),update=store.update.bind(store);
  let writes=0;store.update=fn=>{
    writes++;if(writes===2)throw Error('simulated fsync failure');
    return update(fn);
  };
  await assert.rejects(()=>executeOneReadyFight({
    store,attemptId:'A1',clock:()=>100,transport:async()=>response(12)
  }),/simulated fsync failure/);
  assert.equal(Object.values(store.read().entries)[0].status,'IN_FLIGHT');
  store.update=update;
  store.update(recoverCheckpoint);
  assert.equal(Object.values(store.read().entries)[0].status,'NEEDS_REVIEW');
  assert.equal(readyFetches(store.read()).length,0);
  assert.equal(checkpointStats(store.read()).pointsTotalConfirmed,null);
});
test('two fights execute serially and stop after all ready attempts finish',async()=>{
  const store=makeStore(true);let calls=0;
  for(let i=0;i<2;i++){
    const r=await executeOneReadyFight({
      store,attemptId:'SERIAL-'+i,clock:()=>100,
      transport:async query=>{
        calls++;
        return response(query.variables.fightID,13);
      }
    });
    assert.equal(r.status,'COMPLETED');
  }
  assert.equal(calls,2);
  assert.equal(checkpointStats(store.read()).verifiedSlotEvidence,3);
  assert.equal(checkpointStats(store.read()).witnessedPoints,26);
  assert.equal((await executeOneReadyFight({store,transport:async()=>response(12)})).status,
    'NO_READY');
});
test('unknown actor remains PARTIAL even when HTTP and cost are fully observed',async()=>{
  const store=makeStore(),body=response(12,21);
  body.body.data.reportData.report.boss.data[0].roles.dps.characters=
    body.body.data.reportData.report.boss.data[0].roles.dps.characters.slice(0,1);
  const r=await executeOneReadyFight({store,attemptId:'A1',
    clock:()=>100,transport:async()=>body});
  assert.equal(r.status,'COMPLETED_PARTIAL');
  assert.equal(r.verifiedSlots,1);
  assert.equal(r.unresolvedSlots,1);
  assert.equal(r.observedPoints,21);
});
test('incomplete transport response results in conservative unknown charge',async()=>{
  const store=makeStore();
  const r=await executeOneReadyFight({store,attemptId:'A1',
    clock:()=>100,transport:async()=>({httpStatus:504,body:null})});
  assert.equal(r.status,'NEEDS_REVIEW');
  assert.equal(r.observedPoints,null);
  assert.equal(checkpointStats(store.read()).pointsTotalConfirmed,null);
});
test('two racing processes cannot issue the same fight twice',async()=>{
  const store=makeStore();let transportCalls=0;
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const running=executeOneReadyFight({store,attemptId:'RACE-A',clock:()=>100,
    transport:async()=>{transportCalls++;await gate;return response(12)}});
  const second=await executeOneReadyFight({store,attemptId:'RACE-B',clock:()=>100,
    transport:async()=>{transportCalls++;return response(12)}});
  assert.equal(second.status,'NO_READY');
  release();
  const first=await running;
  assert.equal(first.status,'COMPLETED');
  assert.equal(transportCalls,1);
});

test('bounded sweep runs two committed fights in order and reports durable progress',async()=>{
  const store=makeStore(true),progress=[],calls=[];
  const final=await runBoundedSweep({
    store,maxAttempts:16,clock:()=>100,
    newAttemptId:(()=>{let n=0;return()=>`SWEEP-${++n}`})(),
    transport:async q=>{
      calls.push(q.variables.fightID);
      return response(q.variables.fightID,9);
    },
    onProgress:async p=>{
      progress.push(p);
      assert.equal(
        checkpointStats(store.read()).counts.COMPLETED,p.completedFightGroups
      );
    }
  });
  assert.equal(final.status,'NO_READY');
  assert.equal(final.attempts,2);
  assert.equal(final.verifiedSlots,3);
  assert.equal(final.pointsTotalConfirmed,18);
  assert.deepEqual(calls,[12,13]);
  assert.deepEqual(progress.map(p=>p.completedFightGroups),[1,2]);
  assert.equal(progress.at(-1).readyFightGroups,0);
});
test('sweep budget does not create another run; next bounded call resumes state',async()=>{
  const store=makeStore(true);
  const runner=()=>runBoundedSweep({
    store,maxAttempts:1,newAttemptId:()=>String(store.read().version),
    clock:()=>100,transport:async q=>response(q.variables.fightID,7)
  });
  const first=await runner();
  assert.equal(first.status,'BUDGET_REACHED');
  assert.equal(first.readyFightGroups,1);
  assert.equal(first.pointsTotalConfirmed,7);
  const second=await runner();
  assert.equal(second.status,'NO_READY');
  assert.equal(second.readyFightGroups,0);
  assert.equal(second.pointsTotalConfirmed,14);
});
test('sweep stops at 504 incident without attempting remaining READY requests',async()=>{
  const store=makeStore(true),visited=[];
  const result=await runBoundedSweep({
    store,newAttemptId:()=> 'FIRST',clock:()=>100,
    transport:async q=>{visited.push(q.variables.fightID);return {
      httpStatus:504,body:null};}
  });
  assert.equal(result.status,'NEEDS_REVIEW');
  assert.equal(result.attempts,1);
  assert.equal(result.readyFightGroups,1);
  assert.equal(result.reviewFightGroups,1);
  assert.equal(result.pointsTotalConfirmed,null);
  assert.deepEqual(visited,[12]);
});
test('a cancellation between attempts preserves earlier proof and never starts another',async()=>{
  const store=makeStore(true);let cancel=false,calls=0;
  const result=await runBoundedSweep({
    store,clock:()=>100,newAttemptId:()=> 'FIRST',
    shouldCancel:()=>cancel,
    transport:async q=>{calls++;return response(q.variables.fightID)},
    onProgress:async()=>{cancel=true;}
  });
  assert.equal(result.status,'CANCELLED');
  assert.equal(result.attempts,1);
  assert.equal(result.readyFightGroups,1);
  assert.equal(calls,1);
  assert.equal(checkpointStats(store.read()).verifiedSlotEvidence,2);
});
test('a crashing UI progress callback does not roll back already durably committed work',async()=>{
  const store=makeStore();
  await assert.rejects(()=>runBoundedSweep({
    store,maxAttempts:2,clock:()=>100,
    transport:async()=>response(12),
    onProgress:async()=>{throw Error('UI callback died')}
  }),/UI callback died/);
  assert.equal(checkpointStats(store.read()).verifiedSlotEvidence,2);
  assert.equal(checkpointStats(store.read()).counts.COMPLETED,1);
  assert.equal(readyFetches(store.read()).length,0);
});

test('no READY work with existing uncertain incident must not look like completed',async()=>{
  const store=makeStore();
  const first=await runBoundedSweep({
    store,clock:()=>100,newAttemptId:()=> 'A1',
    transport:async()=>({httpStatus:429,body:null})
  });
  assert.equal(first.status,'NEEDS_REVIEW');
  assert.equal(first.readyFightGroups,0);
  const second=await runBoundedSweep({
    store,clock:()=>100,newAttemptId:()=> 'A2',
    transport:async()=>{throw Error('MUST NOT FETCH')}
  });
  assert.equal(second.status,'NEEDS_REVIEW');
  assert.equal(second.attempts,0);
  assert.equal(second.reviewFightGroups,1);
  assert.equal(second.pointsTotalConfirmed,null);
});

test('budget reservation pauses before the second operation, with no added attempt',async()=>{
 const store=makeStore(true),called=[],progress=[];
 const options={
   store,maxAttempts:8,clock:()=>1000,
   newAttemptId:(()=>{let n=0;return()=>`CAP-${++n}`})(),
   admissionPolicy:{notBeforeMs:0,maxObservedPoints:20,reservePoints:10},
   transport:async q=>{called.push(q.variables.fightID);
     return response(q.variables.fightID,14);},
   onProgress:p=>{progress.push(p)}
 };
 const first=await runBoundedSweep(options);
 assert.equal(first.status,'BUDGET_PAUSED');
 assert.equal(first.attempts,1);
 assert.equal(first.pointsTotalConfirmed,14);
 assert.equal(first.readyFightGroups,1);
 assert.deepEqual(called,[12]);
 assert.equal(progress.length,1);
 const next=await runBoundedSweep(options);
 assert.equal(next.status,'BUDGET_PAUSED');
 assert.equal(next.attempts,0);
 assert.deepEqual(called,[12]);
 assert.equal(progress.length,1);
});
test('rate not-before keeps checkpoint READY and returns remaining wait without sleeping',async()=>{
 const store=makeStore(),called=[];
 const result=await runBoundedSweep({
   store,clock:()=>1000,admissionPolicy:{
     notBeforeMs:1300,maxObservedPoints:100,reservePoints:10
   },
   transport:async x=>{called.push(x);return response(12)}
 });
 assert.equal(result.status,'RATE_WAIT');
 assert.equal(result.waitMs,300);
 assert.equal(result.attempts,0);
 assert.equal(result.readyFightGroups,1);
 assert.equal(store.updates,0);
 assert.equal(called.length,0);
});
test('overshoot is reported honestly; explicit reserve is NOT a hard WCL point cap',async()=>{
 const store=makeStore();
 const result=await runBoundedSweep({
   store,clock:()=>1000,maxAttempts:1,
   admissionPolicy:{notBeforeMs:0,maxObservedPoints:20,reservePoints:10},
   transport:async()=>response(12,23)
 });
 assert.equal(result.status,'NO_READY');
 assert.equal(result.attempts,1);
 assert.equal(result.pointsTotalConfirmed,23);
});
test('previous uncertain 504 with other READY fights stops ALL subsequent sweeps',async()=>{
 const store=makeStore(true),called=[];
 const first=await runBoundedSweep({
   store,clock:()=>1000,newAttemptId:()=> 'A1',
   transport:async q=>{called.push(q.variables.fightID);
     return {httpStatus:504,body:null};}
 });
 assert.equal(first.status,'NEEDS_REVIEW');
 assert.equal(first.readyFightGroups,1);
 const next=await runBoundedSweep({
   store,clock:()=>2000,newAttemptId:()=> 'A2',
   transport:async q=>{called.push(q.variables.fightID);
     return response(q.variables.fightID);}
 });
 assert.equal(next.status,'NEEDS_REVIEW');
 assert.equal(next.attempts,0);
 assert.equal(next.readyFightGroups,1);
 assert.deepEqual(called,[12]);
});
test('unknown points on a completed proof force a global operator check before next request',async()=>{
 const store=makeStore(true);
 const first=await runBoundedSweep({
   store,maxAttempts:1,clock:()=>1000,newAttemptId:()=> 'A1',
   transport:async q=>{const result=response(q.variables.fightID);
     delete result.body.data.rateLimitData;return result;}
 });
 assert.equal(first.attempts,1);
 assert.equal(first.status,'BUDGET_REACHED');
 assert.equal(first.pointsTotalConfirmed,null);
 const next=await runBoundedSweep({
   store,maxAttempts:2,clock:()=>2000,newAttemptId:()=> 'A2',
   transport:async()=>{throw Error('SHOULD NOT RUN');}
 });
 assert.equal(next.status,'NEEDS_REVIEW');
 assert.equal(next.attempts,0);
 assert.equal(next.pointsTotalConfirmed,null);
});
