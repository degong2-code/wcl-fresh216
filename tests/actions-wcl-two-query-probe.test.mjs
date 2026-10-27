import test from 'node:test';
import assert from 'node:assert/strict';
import {runActionsWclProbe,preflightActionsProbe, reserveOneTimeAction}
  from '../tools/run-actions-wcl-two-query-probe.mjs';

const fixture={
  scopeKey:'HEROIC_SYNTHETIC',reportCode:'NO_REAL_REPORT',
  reportRevision:5,fightId:12,encounterId:3470,difficulty:4,
  slots:[{jobKey:'BOSS|HUNTER|MARKSMANSHIP',rank:1,
    snapshotSha:'a'.repeat(64),totalDps:1000,
    className:'Hunter',specName:'Marksmanship',name:'TestHunter'}]
};
const env=()=>({
  GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'workflow_dispatch',
  GITHUB_REF:'refs/heads/main',GITHUB_REPOSITORY:'degong2-code/wcl-fresh216',
  GITHUB_SHA:'b'.repeat(40),GITHUB_TOKEN:'SYNTHETIC_GITHUB_TOKEN',
  WCL_PROBE_DISPATCH_PURPOSE:'OWNER_APPROVED_20261027_MAX_TWO',
  WCL_CLIENT_ID:'SYNTHETIC_ID',WCL_CLIENT_SECRET:'SYNTHETIC_CLIENT_SECRET',
  WCL_PROBE_FIXTURE_JSON:JSON.stringify(fixture)
});
const fight=(value)=>({
  fightID:12,encounter:{id:3470},difficulty:4,
  roles:{dps:{characters:[{
    id:3,name:'TestHunter',class:'Hunter',spec:'Marksmanship',amount:value
  }]}}
});
function fakeFetch(requests,{already=false,graphqlFailure=false}={}){
  return async(url,opts)=>{
    requests.push({url,
      body:typeof opts.body==='string'&&url.includes('api/v2/client')
        ?JSON.parse(opts.body):null});
    if(url.endsWith('/git/refs')){
      const b=JSON.parse(opts.body);
      assert.equal(b.ref,'refs/heads/wcl-fresh216-one-time-probe-consumed-20261027');
      assert.equal(b.sha,'b'.repeat(40));
      assert.equal(opts.method,'POST');
      assert.equal(opts.redirect,'error');
      return {status:already?422:201};
    }
    if(url.endsWith('/oauth/token'))return {
      status:200,json:async()=>({access_token:'SYNTHETIC_TOKEN'})
    };
    if(url.endsWith('/api/v2/client')){
      const q=JSON.parse(opts.body);
      const rankings=q.query.includes('overall:rankings(');
      return {status:graphqlFailure?503:200,json:async()=>({
        data:{
          rateLimitData:{
            currentRequest:{total:5},limitPerHour:2000,
            pointsSpentThisHour:200,pointsResetIn:300
          },
          reportData:{report:{code:'NO_REAL_REPORT',revision:5,
            ...(rankings
              ?{overall:{data:[fight(1000)]},boss:{data:[fight(700)]}}
              :{damage:{entries:[{id:3,total:100000}]}})
          }}
        }
      })};
    }
    throw Error('UNEXPECTED_TEST_ENDPOINT');
  };
}
const graphql=requests=>requests.filter(x=>x.url.endsWith('/api/v2/client'));

test('manual one-time Action uses only one Git ref, one auth and two bounded GraphQL calls',async()=>{
  const req=[],logs=[];
  const result=await runActionsWclProbe({
    env:env(),fetchImpl:fakeFetch(req),log:v=>logs.push(v)
  });
  assert.equal(result.graphqlRequests,2);
  assert.equal(result.status,'COMPLETED_QUERY');
  assert.equal(result.semanticVerdict,'NOT_EQUIVALENT_OR_UNPROVEN');
  assert.equal(result.tableAdopted,false);
  assert.equal(logs.length,1);
  assert.deepEqual(req.map(v=>v.url),[
    'https://api.github.com/repos/degong2-code/wcl-fresh216/git/refs',
    'https://www.warcraftlogs.com/oauth/token',
    'https://www.warcraftlogs.com/api/v2/client',
    'https://www.warcraftlogs.com/api/v2/client'
  ]);
  assert.match(req[2].body.query,/overall:rankings/);
  assert.match(req[3].body.query,/damage:table/);
  assert.ok(!JSON.stringify(result).includes('NO_REAL_REPORT'));
  assert.ok(!JSON.stringify(result).includes('SYNTHETIC_TOKEN'));
  assert.equal(result.observations[0].reportedTotalPoints,5);
  assert.equal(result.observations[0].categoryCosts.application,null);
});

test('preflight missing secret prevents even marker reservation or OAuth',async()=>{
  for(const name of ['WCL_CLIENT_ID','WCL_CLIENT_SECRET','WCL_PROBE_FIXTURE_JSON','GITHUB_TOKEN']){
    const e=env();delete e[name];
    const req=[];
    await assert.rejects(()=>runActionsWclProbe({env:e,fetchImpl:fakeFetch(req)}),
      new RegExp(name+'_MISSING'));
    assert.equal(req.length,0);
  }
});

test('only named repository default ref manual event can use secrets',async()=>{
  for(const patch of [
    {GITHUB_EVENT_NAME:'pull_request'},
    {GITHUB_EVENT_NAME:'push'},
    {GITHUB_REF:'refs/heads/work/collector-architecture'},
    {GITHUB_REPOSITORY:'another/repo'},
    {GITHUB_ACTIONS:'false'},
    {WCL_PROBE_DISPATCH_PURPOSE:'INCORRECT'}
  ]){
    const e={...env(),...patch};
    const req=[];
    await assert.rejects(()=>runActionsWclProbe({env:e,fetchImpl:fakeFetch(req)}),
      /ACTIONS_DISPATCH_(SCOPE|PURPOSE)_DENIED/);
    assert.equal(req.length,0);
  }
});

test('GitHub atomic ref already used refuses all WCL and OAuth calls',async()=>{
  const req=[];
  const r=await runActionsWclProbe({env:env(),fetchImpl:fakeFetch(req,{already:true})});
  assert.equal(r.status,'ONE_TIME_PROBE_ALREADY_RESERVED');
  assert.equal(r.graphqlRequests,0);
  assert.equal(req.length,1);
  assert.ok(req[0].url.endsWith('/git/refs'));
});

test('if GitHub marker fails or is inaccessible, fail closed before any OAuth',async()=>{
  const req=[];
  const bad=async(url,opts)=>{
    req.push(url);
    return {status:403};
  };
  await assert.rejects(()=>runActionsWclProbe({env:env(),fetchImpl:bad}),
    /GITHUB_ATOMIC_SPEND_RESERVATION_FAILED/);
  assert.equal(req.length,1);
});

test('response 503 is one paid attempt only and no second table request',async()=>{
  const req=[];
  const r=await runActionsWclProbe({
    env:env(),fetchImpl:fakeFetch(req,{graphqlFailure:true})
  });
  assert.equal(r.status,'NEEDS_REVIEW');
  assert.equal(r.graphqlRequests,1);
  assert.equal(graphql(req).length,1);
});

test('synthetic invalid target fixture fails before durable marker',async()=>{
  const req=[],e=env();
  e.WCL_PROBE_FIXTURE_JSON=JSON.stringify({...fixture,reportRevision:null});
  assert.throws(()=>preflightActionsProbe(e),/PRIVATE_PROBE_FIXTURE_INVALID/);
  await assert.rejects(()=>runActionsWclProbe({env:e,fetchImpl:fakeFetch(req)}),
    /PRIVATE_PROBE_FIXTURE_INVALID/);
  assert.equal(req.length,0);
});

test('reservation endpoint must receive GitHub API token in header, never logs',async()=>{
  const req=[];
  await reserveOneTimeAction({
    env:env(),fetchImpl:async(url,opts)=>{
      req.push(url);
      assert.equal(opts.headers.Authorization,'Bearer SYNTHETIC_GITHUB_TOKEN');
      assert.equal(opts.method,'POST');
      assert.equal(opts.redirect,'error');
      return {status:201};
    }
  });
  assert.equal(req.length,1);
});
