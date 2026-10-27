import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {planFightFetches} from '../src/core/fetch-plan.mjs';
import {JsonCheckpointStore} from '../src/adapters/json-checkpoint-store.mjs';
import {executeOneReadyFight} from '../src/core/single-fight-runner.mjs';
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
