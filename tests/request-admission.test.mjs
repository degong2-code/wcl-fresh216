import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateRequestAdmission,evaluateWclHourlyQuota}
  from '../src/core/request-admission.mjs';
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


test('hourly WCL window is independent from cumulative checkpoint points',()=>{
 const s=ready();
 const quota={limitPerHour:3600,pointsSpentThisHour:3490,
   pointsResetIn:23,databaseLimitPerHour:250,
   databasePointsSpentThisHour:90};
 const r=evaluateRequestAdmission(s,{
   ...policy, maxObservedPoints:100,
   budgetBaselinePoints:0,hourlyQuota:quota
 });
 assert.equal(r.status,'ADMITTED');
 assert.equal(r.allowed,true);
 assert.equal(r.pointsInApprovedInvocation,0);
 assert.equal(evaluateWclHourlyQuota(quota,{reservePoints:20}).allowed,true);
 const near={...quota,pointsSpentThisHour:3595};
 const wait=evaluateRequestAdmission(s,{...policy,hourlyQuota:near});
 assert.equal(wait.status,'HOURLY_RATE_WAIT');
 assert.equal(wait.allowed,false);
 assert.equal(wait.waitMs,24000);
 assert.equal(wait.hourlyRemainingPoints,5);
 assert.equal(evaluateRequestAdmission(s,{
   ...policy,hourlyQuota:{...quota,pointsSpentThisHour:12}
 }).allowed,true); // new window restores available points
});
test('hourly database points are independently enforced when applicable',()=>{
 const quota={limitPerHour:3600,pointsSpentThisHour:20,
   pointsResetIn:10,databaseLimitPerHour:250,
   databasePointsSpentThisHour:246};
 const wait=evaluateWclHourlyQuota(quota,{
   reservePoints:10,databaseReservePoints:10
 });
 assert.equal(wait.allowed,false);
 assert.equal(wait.databaseRemainingPoints,4);
 assert.equal(wait.waitMs,11000);
 assert.equal(evaluateWclHourlyQuota(quota,{
   reservePoints:10,databaseReservePoints:0
 }).allowed,true);
 assert.throws(()=>evaluateWclHourlyQuota({limitPerHour:3600,
   pointsSpentThisHour:10,pointsResetIn:4},{
   reservePoints:10,databaseReservePoints:10
 }),/HOURLY_DATABASE_QUOTA_INVALID/);
});
test('quota observations fail closed; reset never authorizes retry of uncertain HTTP',()=>{
 for(const bad of [
   null,{limitPerHour:0,pointsSpentThisHour:5,pointsResetIn:5},
   {limitPerHour:3600,pointsSpentThisHour:-1,pointsResetIn:5},
   {limitPerHour:3600,pointsSpentThisHour:3,pointsResetIn:-1}
 ])assert.throws(()=>evaluateWclHourlyQuota(bad,{reservePoints:10}),
   /HOURLY_QUOTA_INVALID/);
 const current=ready(),k=Object.keys(current.entries)[0];
 const pending=beginFetch(current,k,'UNCERTAIN',1000);
 const result=evaluateRequestAdmission(pending,{
   ...policy,hourlyQuota:{limitPerHour:3600,
     pointsSpentThisHour:0,pointsResetIn:0}
 });
 assert.equal(result.status,'NEEDS_REVIEW');
});
