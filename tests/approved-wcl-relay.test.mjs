import test from 'node:test';
import assert from 'node:assert/strict';
import {REQUEST,validateRelayRequest,dispatchApprovedWclOnce}
  from '../tools/dispatch-approved-wcl-once.mjs';

const env=()=>({
  GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'push',
  GITHUB_REF:'refs/heads/work/collector-architecture',
  GITHUB_REPOSITORY:'degong2-code/wcl-fresh216',
  GITHUB_SHA:'b'.repeat(40),GITHUB_TOKEN:'SYNTHETIC_GITHUB_TOKEN'
});
const request=()=>({
  request_id:'FRESH216_CURRENT_PUBLIC_REPORT_20261027_ONCE',
  approval:'OWNER_APPROVED_20261027_MAX_TWO',
  public_report_url:'https://www.warcraftlogs.com/reports/dQbNzMkG94LqYTh1?fight=11',
  report_code:'dQbNzMkG94LqYTh1',fight_id:11
});
const delta='A\t'+REQUEST+'\n';

test('exact isolated-branch single-file addition passes structural gate',()=>{
  const p=validateRelayRequest(request(),env(),delta);
  assert.equal(p.ref,'main');
  assert.deepEqual(Object.keys(p.inputs).sort(),
    ['fight_id','public_report_url','report_code']);
  assert.equal(p.inputs.fight_id,'11');
});

test('ordinary code pushes, request modifications and mixed commits cannot dispatch',()=>{
  const invalid=[
    'M\ttools/ci.mjs\n',
    'M\t'+REQUEST+'\n',
    delta+'M\ttools/ci.mjs\n',
    'D\t'+REQUEST+'\n','',
    delta+'A\t.github/workflows/ci.yml\n'
  ];
  for(const changed of invalid)
    assert.throws(()=>validateRelayRequest(request(),env(),changed),
      /RELAY_NOT_EXACT_SINGLE_REQUEST_ADDITION/);
});

test('wrong branch, PR or repository cannot spend even with request file',()=>{
  for(const override of [
    {GITHUB_EVENT_NAME:'pull_request'},
    {GITHUB_REF:'refs/heads/main'},
    {GITHUB_REF:'refs/heads/another-branch'},
    {GITHUB_REPOSITORY:'other-owner/wcl-fresh216'},
    {GITHUB_SHA:'bad'},
    {GITHUB_ACTIONS:'false'}
  ])assert.throws(()=>validateRelayRequest(request(),{
    ...env(),...override
  },delta),/RELAY_PUSH_SCOPE_DENIED/);
});

test('unverified report scope and public URL are never silently substituted',()=>{
  for(const override of [
    {report_code:'INVALID'},
    {fight_id:0},
    {fight_id:12},
    {approval:'NO_APPROVAL'},
    {request_id:'OTHER'},
    {public_report_url:'http://www.warcraftlogs.com/reports/dQbNzMkG94LqYTh1?fight=11'},
    {public_report_url:'https://evil.example/reports/dQbNzMkG94LqYTh1?fight=11'},
    {public_report_url:'https://www.warcraftlogs.com/reports/dQbNzMkG94LqYTh1?fight=11#other=1',
      extra_key:'unexpected'}
  ])assert.throws(()=>validateRelayRequest({
    ...request(),...override
  },env(),delta),/RELAY_(REQUEST|PUBLIC)/);
});

test('atomic consumed marker precludes GitHub dispatch, zero GraphQL calls',async()=>{
  const calls=[];
  const result=await dispatchApprovedWclOnce({
    env:env(),request:request(),changedFiles:delta,
    fetchImpl:async(url,options)=>{
      calls.push({url,method:options.method});
      return {status:200};
    }
  });
  assert.equal(result.status,'PAID_PROBE_ALREADY_CONSUMED');
  assert.deepEqual(calls.map(v=>v.method),['GET']);
  assert.equal(result.dispatchRequests,0);
});

test('404 marker and accepted dispatch submits exactly once, no WCL URL transport',async()=>{
  const calls=[];
  const result=await dispatchApprovedWclOnce({
    env:env(),request:request(),changedFiles:delta,
    fetchImpl:async(url,options)=>{
      calls.push({url,method:options.method,body:options.body});
      if(options.method==='GET')return {status:404};
      if(options.method==='POST')return {status:204};
      throw Error('INVALID_TEST_FLOW');
    }
  });
  assert.equal(result.dispatchRequests,1);
  assert.equal(result.paidGraphqlRequestsVerified,0);
  assert.equal(calls.length,2);
  assert.match(calls[1].url,/actions\/workflows\/wcl-two-query-probe\.yml\/dispatches$/);
  assert.equal(JSON.parse(calls[1].body).ref,'main');
  assert.deepEqual(
    Object.keys(JSON.parse(calls[1].body).inputs).sort(),
    ['fight_id','public_report_url','report_code']);
  assert.equal(calls.filter(v=>v.url.includes('warcraftlogs.com')).length,0);
});

test('unknown network outcomes never retry or dispatch with stale marker',async()=>{
  for(const status of [401,403,500]){
    const calls=[];
    await assert.rejects(()=>dispatchApprovedWclOnce({
      env:env(),request:request(),changedFiles:delta,
      fetchImpl:async()=>{calls.push(1);return {status};}
    }),/RELAY_MARKER_STATUS_UNKNOWN_NO_DISPATCH/);
    assert.equal(calls.length,1);
  }
  const calls=[];
  await assert.rejects(()=>dispatchApprovedWclOnce({
    env:env(),request:request(),changedFiles:delta,
    fetchImpl:async(_url,opts)=>{
      calls.push(opts.method);
      if(opts.method==='GET')return {status:404};
      throw Error('synthetic uncertain POST');
    }
  }),/RELAY_DISPATCH_OUTCOME_UNKNOWN_NO_RETRY/);
  assert.deepEqual(calls,['GET','POST']);
});
