import test from 'node:test';
import assert from 'node:assert/strict';
import {validateFreshSourceTickRequest}
 from '../tools/run-private-engine-source.mjs';
import {createHash} from 'node:crypto';
import {newCheckpoint} from '../src/core/checkpoint.mjs';
import * as currentSource from '../src/core/fresh-cohort-source.mjs';
import {attestFreshCohortExecutionCompatibility}
  from '../src/core/fresh-cohort-execution-compat.mjs';

const env={GITHUB_ACTIONS:'true',
 GITHUB_REPOSITORY:'degong2-code/ai-project-lab',
 GITHUB_EVENT_NAME:'push',
 GITHUB_REF:'refs/heads/work/fresh216-private-actions'};
const stateHead='c89bc6a5130fb2f81fd5a98445ab187725b099ae';
const productHead='a'.repeat(40);
const request={
 schema:1,kind:'FRESH216_PRIVATE_ENGINE_TICK_REQUEST_V1',
 mode:'source-one',approved:true,productCommit:productHead,
 expectedFreshSourceHead:stateHead,jobsPerRequest:1,
 maxObservedPoints:40,reservePoints:10
};
test('fresh A source one-job request must pin both product and private state',()=>{
 assert.equal(validateFreshSourceTickRequest(request,{
   env,productHead,stateHead
 }),true);
 for(const drift of [
   {...request,approved:false},
   {...request,mode:'report-one'},
   {...request,productCommit:'f'.repeat(40)},
   {...request,expectedFreshSourceHead:'f'.repeat(40)},
   {...request,jobsPerRequest:9},
   {...request,maxObservedPoints:200},
   {...request,reservePoints:0}
 ])assert.throws(()=>validateFreshSourceTickRequest(drift,{
   env,productHead,stateHead
 }),/FRESH_SOURCE_/);
 assert.throws(()=>validateFreshSourceTickRequest(request,{
   env:{...env,GITHUB_EVENT_NAME:'workflow_dispatch'},
   productHead,stateHead
 }),/FRESH_SOURCE_UNTRUSTED_CONTEXT/);
});

test('candidate 9-alias bounded request is an isolated explicitly capped operation',()=>{
 const candidate={
   ...request,mode:'source-bounded',jobsPerRequest:9,
   maxRequests:8,expectedFreshSourceHead:stateHead
 };
 assert.equal(validateFreshSourceTickRequest(candidate,{
   env,productHead,stateHead
 }),true);
 assert.equal(validateFreshSourceTickRequest({
   ...candidate,maxRequests:24,maxObservedPoints:3600,reservePoints:15,
   databaseReservePoints:10
 },{env,productHead,stateHead}),true);
 for(const drift of [
   {...candidate,maxRequests:33},
   {...candidate,maxRequests:0},
   {...candidate,maxRequests:undefined},
   {...candidate,maxObservedPoints:3601},
   {...candidate,databaseReservePoints:-1},
   {...candidate,reservePoints:101},
   {...candidate,jobsPerRequest:10},
   {...candidate,jobsPerRequest:1},
   {...candidate,approved:false},
   {...candidate,expectedFreshSourceHead:'d'.repeat(40)},
   {...candidate,productCommit:'d'.repeat(40)},
   {...request,maxRequests:2}
 ])assert.throws(()=>validateFreshSourceTickRequest(drift,{
   env,productHead,stateHead
 }),/FRESH_SOURCE_/);
});


const origin='0d2c3de4d34ea7dccdba3d4f9a4326d8c0e34179';
const scope='engine-fresh:heroic:2026-10-22_27:candidate-A';
const hash=o=>createHash('sha256').update(JSON.stringify(o)).digest('hex');
function oneCommittedBatch(){
 const manifest=currentSource.makeFreshDatedHeroicManifest(scope);
 const empty=newCheckpoint(scope,'offline-a-origin');
 empty.sourceCodeCommit=origin;
 const initial=currentSource.installFreshCohortPlan(empty,manifest,{
   jobsPerRequest:9
 });
 const batch=currentSource.nextFreshCohortBatch(initial,manifest).batch;
 const pending=currentSource.beginFreshCohortBatch(initial,batch,
   'SAFE_INFLIGHT',1792600000000);
 const jobs=batch.jobs.map(j=>{
   const rows=Array.from({length:100},(_,i)=>({
     name:'Synthetic'+i,amount:100000-i,reportCode:'TEST_REP',
     fightId:i+1,startTime:1792600000000,reportRevision:null
   }));
   return {...j,rows,snapshotSha:hash(rows)};
 });
 return currentSource.finishFreshCohortBatch(pending,batch,
   'SAFE_INFLIGHT',{jobs},{points:9.01,wallMs:100});
}
test('compatible original A90 execution pin only on explicitly owner-gated bounded mode',()=>{
 const bound={...request,mode:'source-bounded',jobsPerRequest:9,
   maxRequests:14,compatibleSourceOriginCommit:origin};
 assert.equal(validateFreshSourceTickRequest(bound,{
   env,productHead,stateHead
 }),true);
 for(const invalid of [
   {...bound,compatibleSourceOriginCommit:'f'.repeat(40)},
   {...bound,mode:'source-one',jobsPerRequest:1,maxRequests:1},
   {...bound,approved:false},
   {...bound,expectedFreshSourceHead:'f'.repeat(40)},
   {...bound,productCommit:'f'.repeat(40)}
 ])assert.throws(()=>validateFreshSourceTickRequest(invalid,{
   env,productHead,stateHead
 }),/FRESH_SOURCE_/);
});
test('read-only A origin/paid-path/plan attestation accepts exact 900-row source',()=>{
 const state=oneCommittedBatch();
 const before=hash(state);
 const r=attestFreshCohortExecutionCompatibility({
   sourceState:state,originCore:currentSource,
   successorCore:currentSource,
   expectedScopeKey:scope,expectedOriginCommit:origin
 });
 assert.equal(r.status,'FRESH_SOURCE_ORIGIN_COMPATIBILITY_PASS');
 assert.equal(r.sourceJobs,9);
 assert.equal(r.sourceRows,900);
 assert.equal(r.nextBatchIndex,1);
 assert.equal(r.paidPathFunctionsCompared,11);
 assert.equal(r.verifiedSnapshotRows,900);
 assert.match(r.queryPlanSha256,/^[a-f0-9]{64}$/);
 assert.equal(r.ownerApproved,false);
 assert.equal(r.wclCalls,0);
 assert.equal(r.gitWrites,0);
 assert.equal(hash(state),before);
});
test('attestor rejects provenance, altered code, changed hash and in-flight replay',()=>{
 const sourceState=oneCommittedBatch();
 const attrs={sourceState,originCore:currentSource,
   successorCore:currentSource,expectedScopeKey:scope,
   expectedOriginCommit:origin};
 const invalidOrigin=structuredClone(sourceState);
 invalidOrigin.sourceCodeCommit='f'.repeat(40);
 assert.throws(()=>attestFreshCohortExecutionCompatibility({
   ...attrs,sourceState:invalidOrigin
 }),/FRESH_SOURCE_COMPAT_ORIGIN_INVALID/);
 assert.throws(()=>attestFreshCohortExecutionCompatibility({
   ...attrs,originCore:{...currentSource,
     buildFreshCohortQuery:()=>({query:'altered',variables:{}})}
 }),/FRESH_SOURCE_COMPAT_PAID_FUNCTION_DRIFT/);
 const modified=structuredClone(sourceState);
 const first=Object.values(modified.sourceRequests).find(e=>e.status==='COMPLETED');
 first.result.jobs[0].rows[0].amount=1;
 assert.throws(()=>attestFreshCohortExecutionCompatibility({
   ...attrs,sourceState:modified
 }),/FRESH_COHORT_EXPORT_DRIFT|FRESH_COHORT_STORED_ROW_DRIFT/);
 const pending=structuredClone(sourceState);
 const second=Object.values(pending.sourceRequests).find(e=>e.status==='READY');
 second.status='IN_FLIGHT';second.attempt={id:'UNKNOWN',startedAtMs:12};
 assert.throws(()=>attestFreshCohortExecutionCompatibility({
   ...attrs,sourceState:pending
 }),/FRESH_SOURCE_COMPAT_NEXT_BATCH_NOT_READY/);
});
