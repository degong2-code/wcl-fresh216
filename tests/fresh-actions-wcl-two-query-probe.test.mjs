import test from 'node:test';
import assert from 'node:assert/strict';
import {runFreshActionsWclProbe,preflightFreshActionsProbe,selectActionsProbeMode}
  from '../tools/run-actions-wcl-two-query-probe.mjs';

const env=()=>({
  GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'workflow_dispatch',
  GITHUB_REF:'refs/heads/main',GITHUB_REPOSITORY:'degong2-code/wcl-fresh216',
  GITHUB_SHA:'c'.repeat(40),GITHUB_TOKEN:'SYNTHETIC_GITHUB_ONLY',
  WCL_PROBE_DISPATCH_PURPOSE:'OWNER_APPROVED_20261027_MAX_TWO',
  WCL_PROBE_MODE:'FRESH_PUBLIC_REPORT_ONLY',
  WCL_CLIENT_ID:'FAKE_ID',WCL_CLIENT_SECRET:'FAKE_SECRET',
  WCL_PROBE_PUBLIC_REPORT_CODE:'PUBLIC_SYNTHETIC',
  WCL_PROBE_PUBLIC_FIGHT_ID:'17',
  WCL_PROBE_PUBLIC_REPORT_URL:
    'https://www.warcraftlogs.com/reports/PUBLIC_SYNTHETIC#fight=17'
});
const fight=value=>({
  fightID:17,encounter:{id:3470},difficulty:4,
  roles:{dps:{characters:[{id:19,amount:value,name:'MockHero',
    class:'Shaman',spec:'Enhancement'}]}}
});
const mockFetch=(calls,{already=false}={})=>async(url,opts)=>{
  calls.push({url,body:url.endsWith('/api/v2/client')?JSON.parse(opts.body):null});
  if(url.endsWith('/git/refs'))
    return {status:already?422:201};
  if(url.endsWith('/oauth/token'))
    return {status:200,json:async()=>({access_token:'FAKE_TOKEN'})};
  if(url.endsWith('/api/v2/client')){
    const rank=JSON.parse(opts.body).query.includes('overall:rankings');
    return {status:200,json:async()=>({data:{
      rateLimitData:{
        currentRequest:{total:5},limitPerHour:1200,
        pointsSpentThisHour:300,pointsResetIn:900
      },
      reportData:{report:{code:'PUBLIC_SYNTHETIC',revision:2,
        ...(rank?{
          overall:{data:[fight(2000)]},boss:{data:[fight(1700)]}
        }:{damage:{data:{entries:[{id:19,total:333333}]}}})
      }}
    }})};
  }
  throw Error('INVALID_MOCK_URL');
};
test('fresh Actions uses CURRENT public report URL, with no previous snapshot or revision',async()=>{
  const calls=[],logs=[],r=await runFreshActionsWclProbe({
    env:env(),fetchImpl:mockFetch(calls),log:x=>logs.push(x)
  });
  assert.equal(r.status,'RECORDED');
  assert.equal(r.graphqlRequests,2);
  assert.equal(r.matchedRankingsActors,1);
  assert.equal(r.tableAdopted,false);
  assert.equal(r.parity,'UNPROVEN');
  assert.equal(r.tableSourceRowsObserved,1);
  assert.equal(r.tableSharedRankedSourceRowsObserved,1);
  assert.equal(r.tableShapeStatus,'SHARED_SOURCE_ROWS_OBSERVED');
  assert.equal(logs.length,1);
  assert.deepEqual(calls.map(x=>x.url),[
    'https://api.github.com/repos/degong2-code/wcl-fresh216/git/refs',
    'https://www.warcraftlogs.com/oauth/token',
    'https://www.warcraftlogs.com/api/v2/client',
    'https://www.warcraftlogs.com/api/v2/client'
  ]);
  assert.ok(!JSON.stringify(logs).includes('PUBLIC_SYNTHETIC'));
  assert.ok(!JSON.stringify(logs).includes('FAKE_SECRET'));
});

test('duplicate action reservation returns without OAuth or WCL, even fresh target',async()=>{
  const calls=[];
  const r=await runFreshActionsWclProbe({
    env:env(),fetchImpl:mockFetch(calls,{already:true})
  });
  assert.equal(r.status,'ONE_TIME_PROBE_ALREADY_RESERVED');
  assert.equal(r.graphqlRequests,0);
  assert.equal(calls.length,1);
});

test('invalid public URL/source FightID denied before any Github or WCL requests',async()=>{
  const changes=[
    {WCL_PROBE_PUBLIC_REPORT_URL:'https://evil.example/reports/PUBLIC_SYNTHETIC#fight=17'},
    {WCL_PROBE_PUBLIC_REPORT_URL:'http://www.warcraftlogs.com/reports/PUBLIC_SYNTHETIC#fight=17'},
    {WCL_PROBE_PUBLIC_REPORT_URL:'https://www.warcraftlogs.com/reports/PUBLIC_SYNTHETIC#fight=42'},
    {WCL_PROBE_PUBLIC_REPORT_CODE:'OTHER'},
    {WCL_PROBE_PUBLIC_REPORT_URL:'https://www.warcraftlogs.com/reports/PUBLIC_SYNTHETIC'}
  ];
  for(const patch of changes){
    const calls=[];
    await assert.rejects(()=>runFreshActionsWclProbe({
      env:{...env(),...patch},fetchImpl:mockFetch(calls)
    }),/PUBLIC_WCL_SOURCE_URL_INVALID/);
    assert.equal(calls.length,0);
  }
});

test('without Actions secrets, fresh probe fails BEFORE any WCL point reservation',async()=>{
  for(const key of ['GITHUB_TOKEN','WCL_CLIENT_ID','WCL_CLIENT_SECRET']){
    const e=env(),calls=[];delete e[key];
    await assert.rejects(()=>runFreshActionsWclProbe({
      env:e,fetchImpl:mockFetch(calls)
    }),new RegExp('REQUIRED_'+key+'_MISSING'));
    assert.equal(calls.length,0);
  }
});

test('wrong event, repository or branch cannot run fresh WCL probe',async()=>{
  for(const change of [
    {GITHUB_EVENT_NAME:'pull_request'},
    {GITHUB_REF:'refs/heads/work/collector-architecture'},
    {GITHUB_REPOSITORY:'unrelated/repo'},
    {GITHUB_ACTIONS:'false'}
  ]){
    const calls=[];
    await assert.rejects(()=>runFreshActionsWclProbe({
      env:{...env(),...change},fetchImpl:mockFetch(calls)
    }),/ACTIONS_DISPATCH_SCOPE_DENIED/);
    assert.equal(calls.length,0);
  }
});

test('Actions paid experiment mode is explicit: no legacy fallback on missing URL',async()=>{
  const original=env();
  assert.equal(selectActionsProbeMode(original),runFreshActionsWclProbe);
  for(const mode of [undefined,'','INCORRECT']){
    const e={...original,WCL_PROBE_MODE:mode};
    assert.throws(()=>selectActionsProbeMode(e),/ACTIONS_PROBE_MODE_DENIED/);
    const calls=[];
    await assert.rejects(()=>runFreshActionsWclProbe({
      env:e,fetchImpl:mockFetch(calls)
    }),/ACTIONS_PROBE_MODE_DENIED/);
    assert.equal(calls.length,0);
  }
  const noUrl={...original,WCL_PROBE_PUBLIC_REPORT_URL:''};
  const calls=[];
  await assert.rejects(()=>runFreshActionsWclProbe({
    env:noUrl,fetchImpl:mockFetch(calls)
  }),/REQUIRED_WCL_PROBE_PUBLIC_REPORT_URL_MISSING/);
  assert.equal(calls.length,0);
});
