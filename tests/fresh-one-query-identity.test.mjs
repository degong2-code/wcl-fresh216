import test from 'node:test';
import assert from 'node:assert/strict';
import {
 IDENTITY_TARGET,IDENTITY_ONCE_REF,IDENTITY_REQUEST,
 IDENTITY_APPROVAL,buildIdentityWitnessQuery,summarizeIdentityWitness
} from '../src/core/fresh-one-query-identity.mjs';
import {preflightIdentityOnce,runApprovedIdentityOnce}
 from '../tools/run-actions-wcl-one-query-identity.mjs';

const env=()=>({
  GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'push',
  GITHUB_REF:'refs/heads/work/collector-architecture',
  GITHUB_REPOSITORY:'degong2-code/wcl-fresh216',
  GITHUB_SHA:'c'.repeat(40),
  GITHUB_TOKEN:'SYNTHETIC_GITHUB_TOKEN',
  WCL_CLIENT_ID:'SYNTHETIC_CLIENT_ID',
  WCL_CLIENT_SECRET:'SYNTHETIC_CLIENT_SECRET'
});
const request=()=>({
  request_id:'FRESH216_ONE_QUERY_IDENTITY_20261027',
  approval:IDENTITY_APPROVAL,
  public_report_url:'https://www.warcraftlogs.com/reports/dQbNzMkG94LqYTh1?fight=11',
  report_code:IDENTITY_TARGET.reportCode,
  fight_id:IDENTITY_TARGET.fightId,
  max_graphql:1
});
const changes='A\t'+IDENTITY_REQUEST+'\n';
const body=()=>{
  const actor=(id,amount)=>({
    id,amount,class:'Shaman',spec:'Enhancement',
    name:'PrivateSynthetic',server:'private-server'
  });
  const fight=(amount)=>({
    fightID:11,encounter:{id:3470},difficulty:5,
    roles:{dps:{characters:[actor(123456,amount)]}}
  });
  return {data:{
    rateLimitData:{
      currentRequest:{total:6,application:4,database:35,user:2},
      limitPerHour:3600,pointsSpentThisHour:300,
      databaseLimitPerHour:500,databasePointsSpentThisHour:100
    },
    reportData:{report:{
      code:IDENTITY_TARGET.reportCode,revision:4,
      overall:{data:[fight(1000)]},
      boss:{data:[fight(600)]},
      damage:{data:{entries:[
        {id:4,total:600000},{id:9,total:20000}
      ]}},
      masterData:{actors:[
        {id:4,name:'PrivateSynthetic',server:'private-server',
          type:'Player',subType:'Shaman',petOwner:null},
        {id:9,name:'PrivatePet',server:null,type:'Pet',
          subType:'Pet',petOwner:4}
      ]}
    }}
  }};
};

test('one GraphQL operation requests ALL three evidence sources and rate witness',()=>{
  const q=buildIdentityWitnessQuery();
  assert.deepEqual(q.variables,{code:'dQbNzMkG94LqYTh1',fightID:11});
  assert.match(q.query,/overall:rankings\(fightIDs:\[\$fightID\],playerMetric:dps\)/);
  assert.match(q.query,/boss:rankings\(fightIDs:\[\$fightID\],playerMetric:bossdps\)/);
  assert.match(q.query,/damage:table\(fightIDs:\[\$fightID\],dataType:DamageDone,viewBy:Source,translate:false\)/);
  assert.match(q.query,/masterData\(translate:false\)\{actors\{id name server type subType petOwner\}\}/);
  assert.equal((q.query.match(/query WclIdentityOneShot/g)||[]).length,1);
});
test('synthetic single response produces aggregate candidates without exposing identifiers',()=>{
  const r=summarizeIdentityWitness({httpStatus:200,body:body(),elapsedMs:100});
  assert.equal(r.status,'RECORDED_CANDIDATES_ONLY');
  assert.equal(r.identityStatus,'NAME_SERVER_CLASS_CANDIDATES_ONLY');
  assert.equal(r.rankedMatchedActors,1);
  assert.equal(r.tableSourceRows,2);
  assert.equal(r.masterActorRows,2);
  assert.equal(r.masterPlayerRows,1);
  assert.equal(r.masterPetRows,1);
  assert.equal(r.strongNameServerClassCandidates,1);
  assert.equal(r.directNumericIdOverlap,0);
  assert.equal(r.tableSourcesRepresentedInMaster,2);
  assert.equal(r.observed.pointTotal,6);
  assert.equal(r.bossDpsParity,'UNPROVEN');
  assert.equal(r.exact100Parity,'UNPROVEN');
  assert.equal(r.tableAdopted,false);
  const output=JSON.stringify(r);
  for(const sensitive of ['PrivateSynthetic','private-server',
    '600000','123456','dQbNzMkG94LqYTh1','PrivatePet'])
    assert.ok(!output.includes(sensitive));
});
test('no actual actor match fails closed rather than guessing from arbitrary ID',()=>{
  const mock=body();
  const player=mock.data.reportData.report.masterData.actors[0];
  player.server='different-realm';
  const r=summarizeIdentityWitness({httpStatus:200,body:mock,elapsedMs:100});
  assert.equal(r.status,'NEEDS_REVIEW');
  assert.equal(r.identityStatus,'NO_SUPPORTED_IDENTITY_BRIDGE');
  assert.equal(r.strongNameServerClassCandidates,0);
  assert.equal(r.bossDpsParity,'UNPROVEN');
});
test('GraphQL errors or report mismatch retain rate witness but never certify data',()=>{
  const error=body();error.errors=[{message:'Private actor error'}];
  const a=summarizeIdentityWitness({httpStatus:200,body:error,elapsedMs:1});
  assert.equal(a.status,'NEEDS_REVIEW');
  assert.equal(a.reason,'HTTP_OR_GRAPHQL_ERROR');
  const b=body();
  b.data.reportData.report.code='WRONG_REPORT';
  const c=summarizeIdentityWitness({httpStatus:200,body:b,elapsedMs:1});
  assert.equal(c.reason,'REPORT_SCOPE_INVALID');
  assert.ok(!JSON.stringify(a).includes('Private actor error'));
});
test('runner rejects all nonexclusive commits or missing secrets BEFORE GitHub reservation',()=>{
  for(const delta of [
    'M\ttools/ci.mjs\n',
    'M\t'+IDENTITY_REQUEST+'\n',
    changes+'M\tsrc/core/example.mjs\n',
    ''
  ])
    assert.throws(()=>preflightIdentityOnce(env(),request(),delta),
      /IDENTITY_NOT_EXCLUSIVE_ADD_REQUEST/);
  for(const wrong of [
    {GITHUB_EVENT_NAME:'pull_request'},
    {GITHUB_REF:'refs/heads/main'},
    {GITHUB_REPOSITORY:'some-other/repo'},
    {GITHUB_SHA:'notsha'}
  ])
    assert.throws(()=>preflightIdentityOnce({...env(),...wrong},
      request(),changes),/IDENTITY_ACTION_SCOPE_INVALID/);
  const missing=env();delete missing.WCL_CLIENT_SECRET;
  assert.throws(()=>preflightIdentityOnce(missing,request(),changes),
    /IDENTITY_REQUIRED_SECRET_MISSING/);
});
test('runner does not accept a changed report, Fight, scope or 2-query allowance',()=>{
  for(const change of [
    {report_code:'anyOtherCode'},
    {fight_id:12},
    {max_graphql:2},
    {approval:'OTHER'},
    {request_id:'OTHER'},
    {public_report_url:'https://www.warcraftlogs.com/reports/another?fight=11'}
  ])
    assert.throws(()=>preflightIdentityOnce(env(),{...request(),...change},
      changes),/IDENTITY_TARGET_OR_APPROVAL_INVALID/);
});
test('atomic GitHub consumed marker returns no OAuth, no GraphQL on replay',async()=>{
  const calls=[];
  const r=await runApprovedIdentityOnce({
    env:env(),request:request(),changedFiles:changes,
    fetchImpl:async(url,opts)=>{
      calls.push({url,opts});
      return {status:422};
    }
  });
  assert.equal(r.status,'ONE_TIME_IDENTITY_ALREADY_CONSUMED');
  assert.equal(r.graphqlRequests,0);
  assert.equal(calls.length,1);
  const payload=JSON.parse(calls[0].opts.body);
  assert.equal(payload.ref,IDENTITY_ONCE_REF);
});
test('one-time runner makes ONE GraphQL call and no extra WCL data requests',async()=>{
  const calls=[],logs=[];
  const fetchImpl=async(url,opts)=>{
    calls.push({url,method:opts.method,body:opts.body});
    if(url.endsWith('/git/refs'))return {status:201};
    if(url.endsWith('/oauth/token'))
      return {status:200,json:async()=>({access_token:'SYNTHETIC_TOKEN'})};
    if(url.endsWith('/api/v2/client'))
      return {status:200,json:async()=>body()};
    throw Error('Unexpected synthetic URL');
  };
  const r=await runApprovedIdentityOnce({
    env:env(),request:request(),changedFiles:changes,
    fetchImpl,log:v=>logs.push(v),clock:()=>50
  });
  assert.equal(r.status,'RECORDED_CANDIDATES_ONLY');
  assert.equal(calls.length,3);
  assert.equal(calls.filter(c=>c.url.endsWith('/api/v2/client')).length,1);
  assert.equal(JSON.parse(calls[2].body).variables.fightID,11);
  assert.equal(logs.length,1);
  assert.ok(!JSON.stringify(logs).includes('SYNTHETIC_TOKEN'));
  assert.ok(!JSON.stringify(logs).includes('PrivateSynthetic'));
});
test('uncertain post-marker GraphQL request is NEVER retried',async()=>{
  const calls=[];
  await assert.rejects(()=>runApprovedIdentityOnce({
    env:env(),request:request(),changedFiles:changes,
    fetchImpl:async(url)=>{
      calls.push(url);
      if(url.endsWith('/git/refs'))return {status:201};
      if(url.endsWith('/oauth/token'))
        return {status:200,json:async()=>({access_token:'SYNTHETIC_TOKEN'})};
      throw Error('Injected transport failure');
    }
  }),/IDENTITY_GRAPHQL_OUTCOME_UNKNOWN_NO_RETRY/);
  assert.equal(calls.length,3);
  assert.equal(calls.filter(c=>c.endsWith('/api/v2/client')).length,1);
});
