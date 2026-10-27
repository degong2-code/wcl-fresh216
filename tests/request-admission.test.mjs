import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateRequestAdmission} from '../src/core/request-admission.mjs';
import {newCheckpoint,registerPlan,beginFetch,
  uncertainFailure} from '../src/core/checkpoint.mjs';
const s={
 scopeKey:'heroic:synthetic',reportCode:'SYNTHETIC_ONLY',
 reportRevision:5,fightId:2,encounterId:3470,difficulty:4,
 slots:[{
  jobKey:'Boss|Mage|Arcane',rank:1,snapshotSha:'a'.repeat(64),
  totalDps:1000,className:'Mage',specName:'Arcane'
 }]
};
const ready=()=>registerPlan(newCheckpoint('heroic:synthetic','TEST'),[s]);
const policy={nowMs:1000,notBeforeMs:0,maxObservedPoints:25,reservePoints:10};

test('explicit reserve and witnessed budget can admit an initial request',()=>{
 const r=evaluateRequestAdmission(ready(),policy);
 assert.equal(r.status,'ADMITTED');
 assert.equal(r.allowed,true);
 assert.equal(r.pointsTotalConfirmed,0);
 assert.equal(r.witnessedPoints,0);
});
test('rate not-before defers without turning it into a failed request',()=>{
 const r=evaluateRequestAdmission(ready(),{...policy,notBeforeMs:1330});
 assert.equal(r.status,'RATE_WAIT');assert.equal(r.allowed,false);
 assert.equal(r.waitMs,330);
});
test('reservation exceeding a configured observed budget pauses before HTTP',()=>{
 const r=evaluateRequestAdmission(ready(),{...policy,maxObservedPoints:9});
 assert.equal(r.status,'BUDGET_PAUSED');assert.equal(r.allowed,false);
 assert.equal(r.waitMs,0);
});
test('an unresolved in-flight operation blocks all new admission',()=>{
 const s=ready();
 const k=Object.keys(s.entries)[0];
 const t=beginFetch(s,k,'A1',1000);
 assert.equal(evaluateRequestAdmission(t,policy).status,'NEEDS_REVIEW');
 const incident=uncertainFailure(t,k,'A1',{code:'HTTP_504',points:null});
 const result=evaluateRequestAdmission(incident,policy);
 assert.equal(result.status,'NEEDS_REVIEW');
 assert.equal(result.pointsTotalConfirmed,null);
});
test('explicit policy rejects missing reserves, guessed infinity, wrong clock',()=>{
 for(const change of [
   {reservePoints:0},{reservePoints:-1},{reservePoints:null},
   {maxObservedPoints:Infinity},{nowMs:-1},{notBeforeMs:-2}
 ]){
   assert.throws(()=>evaluateRequestAdmission(ready(),{...policy,...change}),
     /ADMISSION_POLICY_INVALID/);
 }
 assert.throws(()=>evaluateRequestAdmission(ready(),{nowMs:10}),
   /ADMISSION_POLICY_INVALID/);
});
