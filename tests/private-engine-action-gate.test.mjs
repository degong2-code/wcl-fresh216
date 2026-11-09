import test from 'node:test';
import assert from 'node:assert/strict';
import {validateEngineActionRequest,isSuccessfulEngineActionResult}
  from '../tools/run-private-engine-tick.mjs';

const source='39573a118f2a57f9dc6758936e9d73e9aa6cebf5';
const product='a'.repeat(40),state='b'.repeat(40),stage='c'.repeat(40);
const env={GITHUB_ACTIONS:'true',
  GITHUB_REPOSITORY:'degong2-code/ai-project-lab',
  GITHUB_EVENT_NAME:'push',
  GITHUB_REF:'refs/heads/work/fresh216-private-actions'};
const request={schema:1,
  kind:'FRESH216_PRIVATE_ENGINE_TICK_REQUEST_V1',
  mode:'preview',approved:false,
  productCommit:product,sourceCommit:source,
  expectedStateHead:state,expectedStageHead:null,
  maxObservedPoints:40,reservePoints:10};
const pins={env,stateHead:state,stageHead:null,
  productHead:product,sourceHead:source};
test('pinned owner request validates only exact permitted context',()=>{
  assert.equal(validateEngineActionRequest(request,pins),'preview');
  assert.equal(validateEngineActionRequest(
    {...request,mode:'report-one',approved:true},pins),'report-one');
  assert.equal(validateEngineActionRequest({
    ...request,mode:'stage-one',approved:true,
    expectedStageHead:stage},{...pins,stageHead:stage}),'stage-one');
  for(const bad of [
    {...request,mode:'finalize-one',approved:true},
    {...request,mode:'report-one'},
    {...request,mode:'preview',approved:true},
    {...request,expectedStateHead:'d'.repeat(40)},
    {...request,productCommit:'f'.repeat(40)},
    {...request,maxObservedPoints:10000}
  ]) assert.throws(()=>validateEngineActionRequest(bad,pins),
    /PRIVATE_ENGINE_/);
  assert.throws(()=>validateEngineActionRequest(request,{
    ...pins,env:{...env,GITHUB_EVENT_NAME:'pull_request'}
  }),/PRIVATE_ENGINE_UNTRUSTED_ACTION_CONTEXT/);
});
test('Actions only green for actual completed stage or recorded wave',()=>{
  assert.equal(isSuccessfulEngineActionResult('preview',{
    status:'PREVIEW',nextKind:'REPORT_WAVE'}),true);
  assert.equal(isSuccessfulEngineActionResult('report-one',{
    status:'RECORDED',kind:'REPORT_WAVE'}),true);
  assert.equal(isSuccessfulEngineActionResult('stage-one',{
    status:'PRIVATE_STAGE_REMOTE_CONFIRMED_PENDING_PUBLIC'}),true);
  assert.equal(isSuccessfulEngineActionResult('preview',{
    status:'PREVIEW',nextKind:'NEEDS_REVIEW'}),true);
  for(const value of [
    {mode:'report-one',status:'NEEDS_REVIEW'},
    {mode:'report-one',status:'NO_REPORT_WAVE',nextKind:'NEEDS_REVIEW'},
    {mode:'stage-one',status:'NO_PENDING_WAVE',nextKind:'NEEDS_REVIEW'},
    {mode:'stage-one',status:'PENDING'},
    {mode:'bad',status:'RECORDED'}
  ])assert.equal(isSuccessfulEngineActionResult(value.mode,value),false);
});
