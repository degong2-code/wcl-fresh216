import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TYPED_REQUEST,TYPED_APPROVAL,TYPED_ONCE_REF,
  buildOneShotTypedRosterQuery,summarizeOneShotTypedRoster
} from '../src/core/fresh-typed-roster-one-shot.mjs';
import {
  preflightTypedOneShot,runTypedOneShot
} from '../tools/run-actions-wcl-typed-roster-once.mjs';
const env=()=>({
  GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'push',
  GITHUB_REF:'refs/heads/work/collector-architecture',
  GITHUB_REPOSITORY:'degong2-code/wcl-fresh216',
  GITHUB_SHA:'d'.repeat(40),GITHUB_TOKEN:'SYNTHETIC_TOKEN',
  WCL_CLIENT_ID:'SYNTHETIC_ID',WCL_CLIENT_SECRET:'SYNTHETIC_SECRET'
});
const request=()=>({
  request_id:'FRESH216_ONE_QUERY_TYPED_ROSTER_20261027',
  approval:TYPED_APPROVAL,
  public_report_url:'https://www.warcraftlogs.com/reports/dQbNzMkG94LqYTh1?fight=11',
  report_code:'dQbNzMkG94LqYTh1',fight_id:11,max_graphql:1
});
const change='A\t'+TYPED_REQUEST+'\n';
const mockBody=()=>{
  const ranked=(amount)=>({
    fightID:11,encounter:{id:3470},difficulty:5,
    roles:{dps:{characters:[{
      id:123456,name:'SyntheticOne',class:'Shaman',spec:'Enhancement',
      amount,server:null
    }]}}
  });
  return {data:{
    rateLimitData:{
      currentRequest:{total:7,application:4,database:30,user:3},
      limitPerHour:3600,pointsSpentThisHour:200,
      databaseLimitPerHour:300,databasePointsSpentThisHour:40
    },
    reportData:{report:{
      code:'dQbNzMkG94LqYTh1',revision:17,
      overall:{data:[ranked(1500)]},boss:{data:[ranked(1000)]},
      damage:{data:{entries:[{id:2,total:700000}]}},
      masterData:{actors:[{
        id:2,name:'SyntheticOne',server:'synthetic-realm',
        type:'Player',subType:'Shaman',petOwner:null
      }]},
      rankedCharacters:[{
        canonicalID:123456,name:'SyntheticOne',id:987654,classID:9,
        server:{id:888,normalizedName:'synthetic-realm'}
      }]
    }}
  }};
};
test('ONE GraphQL document includes rate, rankedCharacters, table, master and fight-limited rankings',()=>{
  const q=buildOneShotTypedRosterQuery();
  assert.equal(q.query.match(/query WclReportRosterCrosswalk/g).length,1);
  for(const part of [
    'rateLimitData{currentRequest','overall:rankings(fightIDs:[$fightID]',
    'boss:rankings(fightIDs:[$fightID]',
    'damage:table(fightIDs:[$fightID]',
    'masterData(translate:false)',
    'rankedCharacters{canonicalID id name classID server{id normalizedName}}'
  ])assert.ok(q.query.includes(part),part);
  assert.deepEqual(q.variables,{code:'dQbNzMkG94LqYTh1',fightID:11});
});
test('mock WCL crosswalk outputs aggregate hints, NEVER actor IDs or names or parity',()=>{
  const summary=summarizeOneShotTypedRoster({
    httpStatus:200,body:mockBody(),elapsedMs:301
  });
  assert.equal(summary.status,'CANDIDATES_ONLY_UNPROVEN');
  assert.equal(summary.typed.sameFightFourWayCandidates,1);
  assert.equal(summary.serverless.serverlessNameClassCandidates,1);
  assert.equal(summary.observed,undefined);
  assert.equal(summary.reportedPointTotal,7);
  assert.equal(summary.pointClasses.database,30);
  assert.equal(summary.realCharacterIdentity,'UNPROVEN');
  assert.equal(summary.exact100Parity,'UNPROVEN');
  const publicJson=JSON.stringify(summary);
  for(const secret of ['SyntheticOne','synthetic-realm',
    '700000','123456','dQbNzMkG94LqYTh1'])
    assert.equal(publicJson.includes(secret),false);
});
test('server mismatch and HTTP/GraphQL errors fail closed, no identity promotion',()=>{
  let body=mockBody();
  body.data.reportData.report.rankedCharacters[0]
    .server.normalizedName='wrong-realm';
  const a=summarizeOneShotTypedRoster({httpStatus:200,body});
  assert.equal(a.status,'NEEDS_REVIEW');
  assert.equal(a.typed.sameFightFourWayCandidates,0);
  const b=summarizeOneShotTypedRoster({
    httpStatus:200,body:{...mockBody(),errors:[{message:'PrivateError'}]}
  });
  assert.equal(b.reason,'HTTP_OR_GRAPHQL_RESPONSE_INVALID');
  assert.equal(JSON.stringify(b).includes('PrivateError'),false);
  const c=summarizeOneShotTypedRoster({httpStatus:403,body:mockBody()});
  assert.equal(c.status,'NEEDS_REVIEW');
});
test('exclusive add-only owner approval is mandatory before any GitHub reservation',()=>{
  const yes=preflightTypedOneShot(env(),request(),change);
  assert.equal(yes.variables.fightID,11);
  for(const diff of [
    'M\t'+TYPED_REQUEST+'\n','M\ttools/ci.mjs\n',
    change+'M\ttools/ci.mjs\n',''
  ])
    assert.throws(()=>preflightTypedOneShot(env(),request(),diff),
      /TYPED_NOT_EXCLUSIVE_REQUEST_ADDITION/);
  for(const fields of [
    {max_graphql:2},{fight_id:12},{approval:'OTHER'},
    {report_code:'OTHER'},
    {public_report_url:'https://example.com/other'}
  ])
    assert.throws(()=>preflightTypedOneShot(env(),
      {...request(),...fields},change),/TYPED_OWNER_SCOPE_INVALID/);
  assert.throws(()=>preflightTypedOneShot(
    {...env(),GITHUB_EVENT_NAME:'pull_request'},request(),change),
    /TYPED_ACTION_SCOPE_DENIED/);
});
test('consumed marker prevents OAuth and WCL endpoint calls',async()=>{
  const calls=[];
  const out=await runTypedOneShot({
    env:env(),request:request(),changedFiles:change,
    fetchImpl:async(url,options)=>{
      calls.push({url,options});return {status:422};
    }
  });
  assert.equal(out.status,'TYPED_ALREADY_CONSUMED');
  assert.equal(out.attemptedGraphql,0);
  assert.equal(calls.length,1);
  assert.equal(JSON.parse(calls[0].options.body).ref,TYPED_ONCE_REF);
});
test('one accepted reservation allows exactly one WCL GraphQL and redacted receipt',async()=>{
  const urls=[],printed=[];
  const fetchImpl=async(url,options)=>{
    urls.push(url);
    if(url.endsWith('/git/refs'))return {status:201};
    if(url.endsWith('/oauth/token'))
      return {status:200,json:async()=>({access_token:'SYNTHETIC_ACCESS_TOKEN'})};
    if(url.endsWith('/api/v2/client'))
      return {status:200,json:async()=>mockBody()};
    throw Error('Unexpected endpoint');
  };
  const result=await runTypedOneShot({
    env:env(),request:request(),changedFiles:change,
    fetchImpl,log:value=>printed.push(value),clock:()=>100
  });
  assert.equal(result.status,'CANDIDATES_ONLY_UNPROVEN');
  assert.deepEqual(urls.map(x=>x.split('/').slice(-2).join('/')),
    ['git/refs','oauth/token','v2/client']);
  assert.equal(urls.filter(x=>x.endsWith('/api/v2/client')).length,1);
  assert.equal(printed.length,1);
  assert.equal(JSON.stringify(printed).includes('SYNTHETIC_ACCESS_TOKEN'),false);
});
test('WCL transport uncertainty never triggers an automatic retry',async()=>{
  const urls=[];
  await assert.rejects(()=>runTypedOneShot({
    env:env(),request:request(),changedFiles:change,
    fetchImpl:async url=>{
      urls.push(url);
      if(url.endsWith('/git/refs'))return {status:201};
      if(url.endsWith('/oauth/token'))
        return {status:200,json:async()=>({access_token:'SYNTHETIC_TOKEN'})};
      throw Error('Transient WCL network error');
    }
  }),/TYPED_GRAPHQL_OUTCOME_UNKNOWN_NO_RETRY/);
  assert.equal(urls.length,3);
  assert.equal(urls.filter(x=>x.endsWith('/api/v2/client')).length,1);
});
