import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LATEST_REQUEST,LATEST_ID,LATEST_APPROVAL,LATEST_ONCE_REF,LATEST_TARGET,
  validateLatestRequest,buildLatestDepthQuery,summarizeLatestDepth
} from '../src/core/approved-ranking-depth-date1000-latest-partition.mjs';
import {runApprovedMeasurement,preflightApprovedMeasurement}
  from '../tools/run-actions-approved-measurement.mjs';

const env=()=>({GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'push',
  GITHUB_REF:'refs/heads/work/collector-architecture',
  GITHUB_REPOSITORY:'degong2-code/wcl-fresh216',GITHUB_SHA:'a'.repeat(40),
  GITHUB_TOKEN:'SYNTHETIC_GH',WCL_CLIENT_ID:'SYNTHETIC_ID',
  WCL_CLIENT_SECRET:'SYNTHETIC_SECRET'});
const request=()=>({request_id:LATEST_ID,approval:LATEST_APPROVAL,
  encounter_id:3470,difficulty:4,partition_mode:'LATEST_DEFAULT',
  date_start_kst:'2026-10-22',date_end_kst:'2026-10-28',
  filter:'date.1792594800000.1793199600000',
  specs:['balance','enhancement','survival'],total_dps_pages:[1],
  boss_dps_pages:[1,2,3,4,5,6,7,8,9,10],max_graphql:3});
const change='A\t'+LATEST_REQUEST+'\n';
const t=1792600000000;
const row=(i,amount)=>({name:'Latest'+i,amount,startTime:t+i,
  report:{code:'L'+i,fightID:i+1}});
const body=()=>{
  const enc={t1:{rankings:Array.from({length:100},(_,i)=>row(i,2000-i))}};
  for(let p=1;p<=10;p++){
    const a=(p-1)*10;
    enc['b'+p]={rankings:Array.from({length:10},(_,j)=>{
      const i=a+j;return row(i,1500-i);
    })};
  }
  return {data:{rateLimitData:{currentRequest:{total:11,application:11,database:50},
    limitPerHour:3600,pointsSpentThisHour:100,databaseLimitPerHour:300,
    databasePointsSpentThisHour:10},worldData:{encounter:enc}}};
};
test('corrected query keeps date filter but omits explicit partition',()=>{
  const q=buildLatestDepthQuery(LATEST_TARGET.specs[0]);
  assert.equal(q.variables.filter,'date.1792594800000.1793199600000');
  assert.equal(Object.hasOwn(q.variables,'partition'),false);
  assert.doesNotMatch(q.query,/partition:/);
  for(let p=1;p<=10;p++)
    assert.match(q.query,new RegExp('metric:bossdps,page:'+p+',filter:\\$filter'));
});
test('latest-default response retains exact same-fight matching and labels partition mode',()=>{
  const s=summarizeLatestDepth(LATEST_TARGET.specs[0],
    {httpStatus:200,body:body(),elapsedMs:10});
  assert.equal(s.status,'RECORDED');assert.equal(s.partition,null);
  assert.equal(s.partitionMode,'LATEST_DEFAULT');
  assert.equal(s.cumulativeMatches.at(-1),100);
});
test('corrected manifest routes to a distinct immutable consumed ref',()=>{
  assert.equal(validateLatestRequest(request()),true);
  const q=preflightApprovedMeasurement(env(),request(),change);
  assert.equal(q.length,3);assert.equal(q.experiment.onceRef,LATEST_ONCE_REF);
});
test('common runner still performs at most three GraphQL POSTs for corrected trial',async()=>{
  const urls=[];let n=0;
  const out=await runApprovedMeasurement({env:env(),request:request(),
    changedFiles:change,clock:()=>++n,log:()=>{},fetchImpl:async url=>{
      urls.push(url);
      if(url.endsWith('/git/refs'))return {status:201};
      if(url.endsWith('/oauth/token'))
        return {status:200,json:async()=>({access_token:'S'})};
      if(url.endsWith('/api/v2/client'))
        return {status:200,json:async()=>body()};
      throw Error('unexpected');
    }});
  assert.equal(out.status,'RECORDED');assert.equal(out.graphqlRequests,3);
  assert.equal(out.maxBossRank,1000);
  assert.equal(urls.filter(u=>u.endsWith('/api/v2/client')).length,3);
});
