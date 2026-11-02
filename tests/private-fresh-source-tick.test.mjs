import test from 'node:test';
import assert from 'node:assert/strict';
import {validateFreshSourceTickRequest}
 from '../tools/run-private-engine-source.mjs';
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
 for(const drift of [
   {...candidate,maxRequests:9},
   {...candidate,maxRequests:0},
   {...candidate,maxRequests:undefined},
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
