import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {JsonCheckpointStore} from '../src/adapters/json-checkpoint-store.mjs';
import {planFightFetches} from '../src/core/fetch-plan.mjs';
import {joinFightEvidence} from '../src/core/evidence-join.mjs';
import {
  newCheckpoint,registerPlan,readyFetches,beginFetch,completeFetch,
  uncertainFailure,recoverCheckpoint,stopCheckpoint,resumeCheckpoint,
  checkpointStats,committedProofs
} from '../src/core/checkpoint.mjs';

const raw=(change={})=>({
  scopeKey:'heroic:fixture',jobKey:'Boss|Hunter|Marksmanship',rank:1,
  snapshotSha:'a'.repeat(64),status:'PENDING',name:'Anonymous',
  className:'Hunter',specName:'Marksmanship',totalDps:1000,
  reportCode:'SYNTHETIC_ONLY',fightId:12,encounterId:3470,
  difficulty:4,reportRevision:5,...change
});
const plans=()=>planFightFetches([raw(),raw({
  jobKey:'Boss|Mage|Arcane',snapshotSha:'b'.repeat(64),
  className:'Mage',specName:'Arcane',totalDps:900,rank:8
})]).groups;
const actor=(id,name,amount,spec,cls)=>({id,name,amount,spec,class:cls});
const fight=(chars)=>({
  fightID:12,encounter:{id:3470},difficulty:4,
  roles:{dps:{characters:chars}}
});
const report=()=>({
  code:'SYNTHETIC_ONLY',revision:5,
  overall:{data:[fight([
    actor(3,'ExampleHunter',1000,'Marksmanship','Hunter'),
    actor(8,'ExampleMage',900,'Arcane','Mage')
  ])]},
  boss:{data:[fight([
    actor(3,'ExampleHunter',700,'Marksmanship','Hunter'),
    actor(8,'ExampleMage',600,'Arcane','Mage')
  ])]}
});
const makeReady=()=>{
  const p=plans();
  const state=registerPlan(newCheckpoint('heroic:fixture','run_1'),p);
  return {state,group:p[0],key:readyFetches(state)[0].key};
};

test('cross-job one-fight response commits two immutable rank proofs',()=>{
  const {state,group,key}=makeReady();
  const inflight=beginFetch(state,key,'attempt-1',100);
  const joined=joinFightEvidence(group,report());
  const done=completeFetch(inflight,key,'attempt-1',joined,{points:17,wallMs:250});
  assert.equal(readyFetches(done).length,0);
  assert.equal(committedProofs(done).length,2);
  assert.equal(checkpointStats(done).witnessedPoints,17);
  assert.equal(checkpointStats(done).pointsTotalConfirmed,17);
  assert.equal(checkpointStats(done).verifiedSlotEvidence,2);
  assert.throws(()=>beginFetch(done,key,'attempt-2',500),/FETCH_NOT_READY/);
  assert.equal(committedProofs(state).length,0);
});
test('replaying an identical fetch plan never adds extra requests',()=>{
  const {state,key}=makeReady();
  const next=registerPlan(state,plans());
  assert.equal(Object.keys(next.entries).length,1);
  assert.equal(readyFetches(next)[0].key,key);
});
test('changed snapshot rank or amount must fail rather than mix proofs',()=>{
  const {state}=makeReady();
  const mutated=plans();
  mutated[0].slots[0].snapshotSha='f'.repeat(64);
  assert.throws(()=>registerPlan(state,mutated),/FETCH_PLAN_DRIFT/);
});
test('HTTP 504 or 429 is uncertain; do not automatically retry or invent zero cost',()=>{
  for(const code of ['HTTP_504','HTTP_429']){
    const {state,key}=makeReady();
    const s=beginFetch(state,key,'attempt-1',100);
    const failed=uncertainFailure(s,key,'attempt-1',{code,points:null,wallMs:50});
    const stat=checkpointStats(failed);
    assert.equal(stat.counts.NEEDS_REVIEW,1);
    assert.equal(stat.pointsTotalConfirmed,null);
    assert.equal(stat.pointsUnobserved,1);
    assert.equal(readyFetches(failed).length,0);
    assert.throws(()=>beginFetch(failed,key,'attempt-2',200),/FETCH_NOT_READY/);
  }
});
test('crash between HTTP request and response commit creates no automatic retry',()=>{
  const {state,key}=makeReady();
  const s=beginFetch(state,key,'attempt-1',100);
  const recovered=recoverCheckpoint(s);
  assert.equal(recovered.entries[key].incident.code,'INTERRUPTED_IN_FLIGHT');
  assert.equal(readyFetches(recovered).length,0);
  assert.equal(checkpointStats(recovered).pointsTotalConfirmed,null);
  assert.equal(recoverCheckpoint(recovered).version,recovered.version);
});
test('stop/resume retains unresolved incidents and allows untouched READY work only',()=>{
  const {state,key}=makeReady();
  const more=planFightFetches([raw({
    fightId:99,rank:10,jobKey:'Other|Hunter|Marksmanship'
  })]).groups;
  const registered=registerPlan(state,more);
  const s=beginFetch(registered,key,'attempt-1',100);
  const stopped=stopCheckpoint(s);
  assert.equal(stopped.status,'STOPPED');
  assert.equal(readyFetches(stopped).length,0);
  const resumed=resumeCheckpoint(stopped);
  assert.equal(readyFetches(resumed).length,1);
  assert.equal(resumed.entries[key].status,'NEEDS_REVIEW');
  assert.equal(resumed.entries[key].incident.automaticRetry,false);
});
test('partial actor proof retains missing rank without treating it as completed EXACT',()=>{
  const {state,group,key}=makeReady();
  const r=report();
  r.overall.data[0].roles.dps.characters.push(
    actor(9,'AnotherHunter',1000,'Marksmanship','Hunter'));
  const s=beginFetch(state,key,'attempt-1',100);
  const joined=joinFightEvidence(group,r);
  const completed=completeFetch(s,key,'attempt-1',joined,{points:null,wallMs:300});
  assert.equal(completed.entries[key].status,'COMPLETED_PARTIAL');
  assert.equal(committedProofs(completed).length,1);
  assert.equal(checkpointStats(completed).unresolvedSlotEvidence,1);
  assert.equal(checkpointStats(completed).pointsTotalConfirmed,null);
  assert.equal(readyFetches(completed).length,0);
});
test('wrong attempt, duplicate/missing join slots, and foreign proof are rejected',()=>{
  const {state,group,key}=makeReady();
  const s=beginFetch(state,key,'attempt-1',100);
  const joined=joinFightEvidence(group,report());
  assert.throws(()=>completeFetch(s,key,'attempt-other',joined),/ATTEMPT_NOT_CURRENT/);
  assert.throws(()=>completeFetch(s,key,'attempt-1',{verified:[],unresolved:[]}),/INCOMPLETE_JOIN_COVERAGE/);
  const bad=structuredClone(joined);bad.verified[0].proof.fightId=99;
  assert.throws(()=>completeFetch(s,key,'attempt-1',bad),/INVALID_PROOF/);
  assert.throws(()=>completeFetch(s,key,'attempt-1',joined,{points:-1}),/POINT_COST_INVALID/);
});
test('persistent JSON store survives new object / restarts and refuses overwrite',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'wcl-offline-checkpoint-'));
  try{
    const file=path.join(root,'private-checkpoint.json');
    const store=new JsonCheckpointStore(file);
    const {state,key}=makeReady();
    store.init(state);
    store.update(s=>beginFetch(s,key,'persisted-attempt',123));
    const afterRestart=new JsonCheckpointStore(file);
    assert.equal(afterRestart.read().entries[key].status,'IN_FLIGHT');
    afterRestart.update(recoverCheckpoint);
    assert.equal(afterRestart.read().entries[key].status,'NEEDS_REVIEW');
    assert.equal(readyFetches(afterRestart.read()).length,0);
    assert.throws(()=>store.init(state),/EEXIST/);
    assert.throws(()=>store.update(s=>s),/CHECKPOINT_VERSION_OR_SCOPE_DRIFT/);
    fs.mkdirSync(file+'.lock');
    assert.throws(()=>store.update(s=>stopCheckpoint(s)),/EEXIST/);
    fs.rmdirSync(file+'.lock');
    assert.equal(fs.statSync(file).mode & 0o777,0o600);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
