import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MEASUREMENT_REQUEST,MEASUREMENT_ID,MEASUREMENT_APPROVAL,MEASUREMENT_ONCE_REF,
  MEASUREMENT_TARGET,buildRankingDepthQuery,summarizeRankingDepth
} from '../src/core/approved-ranking-depth-trial.mjs';
import {preflightApprovedMeasurement,runApprovedMeasurement}
  from '../tools/run-actions-approved-measurement.mjs';

const env=()=>({GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'push',
  GITHUB_REF:'refs/heads/work/collector-architecture',
  GITHUB_REPOSITORY:'degong2-code/wcl-fresh216',GITHUB_SHA:'e'.repeat(40),
  GITHUB_TOKEN:'SYNTHETIC_GH',WCL_CLIENT_ID:'SYNTHETIC_ID',
  WCL_CLIENT_SECRET:'SYNTHETIC_SECRET'});
const request=()=>({request_id:MEASUREMENT_ID,approval:MEASUREMENT_APPROVAL,
  encounter_id:3470,difficulty:4,current_global:true,
  specs:['balance','enhancement','survival'],
  total_dps_pages:[1],boss_dps_pages:[1,2,3],max_graphql:3});
const change='A\t'+MEASUREMENT_REQUEST+'\n';
const row=(i,amount=1000-i,more={})=>({name:'Synthetic'+i,amount,
  startTime:1800000000000+i,report:{code:'R'+i,fightID:i+1},...more});
const body=(specIndex=0)=>{
  const total=Array.from({length:100},(_,i)=>row(i,1000-i));
  const boss=(from,to)=>Array.from({length:to-from},(_,j)=>{
    const i=from+j;return row(i,700-i);
  });
  return {data:{rateLimitData:{currentRequest:{
    total:5+specIndex,application:4,database:12,user:1+specIndex},
    limitPerHour:3600,pointsSpentThisHour:100,
    databaseLimitPerHour:300,databasePointsSpentThisHour:25,
    userHasRemainingPoints:true},
    worldData:{encounter:{t1:{rankings:total},b1:{rankings:boss(0,50)},
      b2:{rankings:boss(50,80)},b3:{rankings:boss(80,90)}}}}};
};

test('query is fixed to current global Nekzali with Total page1 and Boss pages1-3',()=>{
  const q=buildRankingDepthQuery(MEASUREMENT_TARGET.specs[0]);
  assert.equal(q.variables.id,3470);assert.equal(q.variables.difficulty,4);
  assert.match(q.query,/metric:dps,page:1/);
  for(const p of [1,2,3])assert.match(q.query,new RegExp('metric:bossdps,page:'+p));
  assert.match(q.query,/rateLimitData\{currentRequest /);
  assert.doesNotMatch(q.query,/currentRequest\{/);
  assert.doesNotMatch(q.query,/filter:|partition:/);
});
test('synthetic 100 ranks show incremental page1=50, page2=30, page3=10',()=>{
  const s=summarizeRankingDepth(MEASUREMENT_TARGET.specs[0],
    {httpStatus:200,body:body(),elapsedMs:123});
  assert.equal(s.status,'RECORDED');assert.deepEqual(s.bossRowsByPage,[50,30,10]);
  assert.deepEqual(s.directMatchesByPage,[50,30,10]);
  assert.deepEqual(s.cumulativeMatches,[50,80,90]);
  assert.deepEqual(s.coveragePct,[50,80,90]);
  assert.equal(s.unresolvedAfter3,10);assert.equal(s.reportedPointTotal,5);
});
test('same name with different fight/time and anonymous do not fill a slot',()=>{
  const b=body();b.data.worldData.encounter.b1.rankings[0].report.fightID=999;
  b.data.worldData.encounter.b1.rankings[1].startTime+=1;
  b.data.worldData.encounter.t1.rankings[2].name='Anonymous';
  const s=summarizeRankingDepth(MEASUREMENT_TARGET.specs[0],
    {httpStatus:200,body:b,elapsedMs:1});
  assert.equal(s.directMatchesByPage[0],47);
  assert.equal(s.anonymousTop100,1);
  assert.equal(s.namedNotFoundOnThreePages>=1,true);
});
test('exclusive add-only manifest and exact owner scope are mandatory',()=>{
  assert.equal(preflightApprovedMeasurement(env(),request(),change).length,3);
  for(const d of ['',change+'M\ttools/ci.mjs\n','M\t'+MEASUREMENT_REQUEST+'\n'])
    assert.throws(()=>preflightApprovedMeasurement(env(),request(),d),
      /MEASUREMENT_NOT_EXCLUSIVE_REQUEST_ADDITION/);
  for(const patch of [{max_graphql:4},{encounter_id:1},{current_global:false},
    {specs:['balance']},{approval:'OTHER'}])
    assert.throws(()=>preflightApprovedMeasurement(env(),{...request(),...patch},change),
      /MEASUREMENT_REQUEST_SCOPE_INVALID/);
});
test('consumed ref stops before OAuth and WCL',async()=>{
  const calls=[];
  const out=await runApprovedMeasurement({env:env(),request:request(),
    changedFiles:change,fetchImpl:async(url,opts)=>{
      calls.push({url,opts});return {status:422};
    }});
  assert.equal(out.status,'MEASUREMENT_ALREADY_CONSUMED');
  assert.equal(out.graphqlRequests,0);assert.equal(calls.length,1);
  assert.equal(JSON.parse(calls[0].opts.body).ref,MEASUREMENT_ONCE_REF);
});
test('accepted reservation uses one OAuth and exactly three WCL GraphQL posts',async()=>{
  const urls=[],logs=[];let n=0;
  const fetchImpl=async(url)=>{
    urls.push(url);
    if(url.endsWith('/git/refs'))return {status:201};
    if(url.endsWith('/oauth/token'))
      return {status:200,json:async()=>({access_token:'SYNTHETIC_ACCESS'})};
    if(url.endsWith('/api/v2/client')){
      const value=body(n++);return {status:200,json:async()=>value};
    }
    throw Error('unexpected');
  };
  let t=0;
  const out=await runApprovedMeasurement({env:env(),request:request(),
    changedFiles:change,fetchImpl,clock:()=>++t,log:v=>logs.push(v)});
  assert.equal(out.status,'RECORDED');assert.equal(out.graphqlRequests,3);
  assert.equal(urls.filter(u=>u.endsWith('/api/v2/client')).length,3);
  assert.equal(urls.filter(u=>u.endsWith('/oauth/token')).length,1);
  assert.deepEqual(out.cumulativeMatches,[150,240,270]);
  const printed=JSON.stringify(logs);
  for(const secret of ['SYNTHETIC_ACCESS','Synthetic0','R0'])
    assert.equal(printed.includes(secret),false);
});
test('uncertain WCL transport is never retried',async()=>{
  const urls=[];
  await assert.rejects(()=>runApprovedMeasurement({env:env(),request:request(),
    changedFiles:change,fetchImpl:async url=>{
      urls.push(url);
      if(url.endsWith('/git/refs'))return {status:201};
      if(url.endsWith('/oauth/token'))
        return {status:200,json:async()=>({access_token:'X'})};
      throw Error('network');
    }}),/MEASUREMENT_GRAPHQL_UNCERTAIN_NO_RETRY/);
  assert.equal(urls.filter(u=>u.endsWith('/api/v2/client')).length,1);
});
