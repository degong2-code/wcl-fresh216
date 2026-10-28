import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DATED_REQUEST,DATED_ID,DATED_APPROVAL,DATED_ONCE_REF,DATED_TARGET,
  validateDatedRequest,buildDatedDepthQuery,summarizeDatedDepth
} from '../src/core/approved-ranking-depth-date1000-trial.mjs';
import {preflightApprovedMeasurement,runApprovedMeasurement}
  from '../tools/run-actions-approved-measurement.mjs';

const env=()=>({GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'push',
  GITHUB_REF:'refs/heads/work/collector-architecture',
  GITHUB_REPOSITORY:'degong2-code/wcl-fresh216',GITHUB_SHA:'f'.repeat(40),
  GITHUB_TOKEN:'SYNTHETIC_GH',WCL_CLIENT_ID:'SYNTHETIC_ID',
  WCL_CLIENT_SECRET:'SYNTHETIC_SECRET'});
const request=()=>({request_id:DATED_ID,approval:DATED_APPROVAL,
  encounter_id:3470,difficulty:4,partition:1,
  date_start_kst:'2026-10-22',date_end_kst:'2026-10-28',
  filter:'date.1792594800000.1793199600000',
  specs:['balance','enhancement','survival'],
  total_dps_pages:[1],boss_dps_pages:[1,2,3,4,5,6,7,8,9,10],max_graphql:3});
const change='A\t'+DATED_REQUEST+'\n';
const t=1792600000000;
const row=(i,amount=2000-i,more={})=>({name:'DatedSynthetic'+i,amount,
  startTime:t+i,report:{code:'D'+i,fightID:i+1},...more});
const body=(specIndex=0)=>{
  const total=Array.from({length:100},(_,i)=>row(i,2000-i));
  const enc={t1:{rankings:total}};
  for(let p=1;p<=10;p++){
    const start=(p-1)*10,end=p*10;
    enc['b'+p]={rankings:Array.from({length:end-start},(_,j)=>{
      const i=start+j;return row(i,1500-i);
    })};
  }
  return {data:{rateLimitData:{currentRequest:{
    total:12+specIndex,application:12,database:20,user:null},
    limitPerHour:3600,pointsSpentThisHour:200,
    databaseLimitPerHour:300,databasePointsSpentThisHour:40,
    userHasRemainingPoints:null},worldData:{encounter:enc}}};
};

test('date filter is exact 22-28 KST inclusive and query requests boss pages 1..10',()=>{
  const q=buildDatedDepthQuery(DATED_TARGET.specs[0]);
  assert.equal(q.variables.filter,'date.1792594800000.1793199600000');
  assert.equal(q.variables.partition,1);
  assert.match(q.query,/metric:dps,page:1,filter:\$filter,partition:\$partition/);
  for(let p=1;p<=10;p++)
    assert.match(q.query,new RegExp('metric:bossdps,page:'+p+',filter:\\\\$filter,partition:\\\\$partition'));
  assert.doesNotMatch(q.query,/currentRequest\{/);
});
test('ten pages recover a synthetic 100/100 cohort cumulatively',()=>{
  const s=summarizeDatedDepth(DATED_TARGET.specs[0],
    {httpStatus:200,body:body(),elapsedMs:50});
  assert.equal(s.status,'RECORDED');
  assert.equal(s.totalRows,100);assert.equal(s.bossRowsByPage.length,10);
  assert.deepEqual(s.directMatchesByPage,Array(10).fill(10));
  assert.deepEqual(s.cumulativeMatches,[10,20,30,40,50,60,70,80,90,100]);
  assert.equal(s.unresolvedAfterMaxPage,0);
  assert.equal(s.top100CompleteByPage[9],true);
});
test('out-of-window rows fail closed rather than silently mixing dates',()=>{
  const b=body();b.data.worldData.encounter.b10.rankings[0].startTime=DATED_TARGET.endMs;
  const s=summarizeDatedDepth(DATED_TARGET.specs[0],
    {httpStatus:200,body:b,elapsedMs:1});
  assert.equal(s.status,'NEEDS_REVIEW');
  assert.equal(s.reason,'DATED_BOSS_P10_ROW_OR_DATE');
});
test('dated request is exact and routes through common approved runner',()=>{
  assert.equal(validateDatedRequest(request()),true);
  const q=preflightApprovedMeasurement(env(),request(),change);
  assert.equal(q.length,3);assert.equal(q.experiment.onceRef,DATED_ONCE_REF);
  assert.throws(()=>preflightApprovedMeasurement(env(),
    {...request(),date_end_kst:'2026-10-27'},change),
    /MEASUREMENT_REQUEST_SCOPE_INVALID/);
});
test('dated consumed ref prevents OAuth and WCL calls',async()=>{
  const urls=[];
  const out=await runApprovedMeasurement({env:env(),request:request(),
    changedFiles:change,fetchImpl:async(url,opts)=>{
      urls.push({url,opts});return {status:422};
    }});
  assert.equal(out.status,'MEASUREMENT_ALREADY_CONSUMED');
  assert.equal(out.graphqlRequests,0);assert.equal(urls.length,1);
  assert.equal(JSON.parse(urls[0].opts.body).ref,DATED_ONCE_REF);
});
test('common runner sends exactly three dated GraphQL requests',async()=>{
  const urls=[];let n=0;
  const fetchImpl=async url=>{
    urls.push(url);
    if(url.endsWith('/git/refs'))return {status:201};
    if(url.endsWith('/oauth/token'))
      return {status:200,json:async()=>({access_token:'SYNTH'})};
    if(url.endsWith('/api/v2/client'))
      return {status:200,json:async()=>body(n++)};
    throw Error('unexpected');
  };
  const out=await runApprovedMeasurement({env:env(),request:request(),
    changedFiles:change,fetchImpl,clock:()=>10,log:()=>{}});
  assert.equal(out.status,'RECORDED');assert.equal(out.graphqlRequests,3);
  assert.equal(out.maxBossPage,10);assert.equal(out.maxBossRank,1000);
  assert.equal(out.maxPageCoveragePct,100);assert.equal(out.unresolvedAfterMaxPage,0);
  assert.equal(urls.filter(x=>x.endsWith('/api/v2/client')).length,3);
});
