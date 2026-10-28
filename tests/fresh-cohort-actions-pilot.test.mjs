import test from 'node:test';
import assert from 'node:assert/strict';
import {
 REQUEST_PATH,REQUEST_ID,APPROVAL,ONCE_REF,
 verifyFreshPilotRequest,runFreshPilot
} from '../tools/run-actions-fresh-cohort-pilot.mjs';
const diff='A\t'+REQUEST_PATH;
const env={
 GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'push',
 GITHUB_REF:'refs/heads/work/collector-architecture',
 GITHUB_REPOSITORY:'degong2-code/wcl-fresh216',
 GITHUB_SHA:'a'.repeat(40),GITHUB_TOKEN:'gh-secret-fixture',
 WCL_CLIENT_ID:'client-fixture',WCL_CLIENT_SECRET:'wcl-secret-fixture'
};
const request=()=>({
 request_id:REQUEST_ID,approval:APPROVAL,date_start_kst:'2026-10-22',
 date_end_kst:'2026-10-27',
 filter:'date.1792594800000.1793113200000',
 partition_mode:'LATEST_DEFAULT',difficulty:4,
 encounter_id:3470,batch_index:0,total_dps_pages:[1],
 max_graphql:1,raw_rows_publication:'FORBIDDEN'
});
function syntheticResponse(q,{short=false,badTime=false}={}){
 const world={};
 for(let i=0;i<8;i++){
   const rows=Array.from({length:short&&i===0?99:100},(_,r)=>({
     name:'SECRET_ACTOR_'+i+'_'+r,
     amount:100000-r*110-i,
     startTime:badTime&&i===0&&r===0?1793113200000:1792594801000+r*1000,
     report:{code:'PRIVATE_REPORT_'+i+'_'+r,fightID:r+1}
   }));
   world['t'+i]={rankings:rows};
 }
 return {data:{rateLimitData:{currentRequest:'{"total":8.01}'},
   worldData:{encounter:world}}};
}
const success=(v,json=()=>null)=>({status:v,json:async()=>json()});
function mockedFetch({taken=false,short=false,badTime=false,failWcl=false}={}){
 const calls=[];
 const fn=async(url,opts)=>{
   calls.push({url,opts});
   if(url.endsWith('/git/refs'))return success(taken?422:201);
   if(url.endsWith('/oauth/token'))return success(200,()=>({
     access_token:'secret_access_token_test'
   }));
   if(url.endsWith('/api/v2/client')){
     if(failWcl)throw Error('network timeout after charged');
     return success(200,()=>syntheticResponse(JSON.parse(opts.body),{short,badTime}));
   }
   throw Error('unexpected endpoint');
 };
 return {fn,calls};
}
test('fixed one query: exact Oct22..27 filter, 8 frozen specs, no partition',()=>{
 const q=verifyFreshPilotRequest(request(),diff,env);
 assert.equal(q.variables.id,3470);
 assert.equal(q.variables.filter,'date.1792594800000.1793113200000');
 assert.equal((q.query.match(/characterRankings\(/g)||[]).length,8);
 assert.doesNotMatch(q.query,/partition|bossdps/);
});
test('exclusive request addition and exact scope are required',()=>{
 assert.throws(()=>verifyFreshPilotRequest(request(),'M\t'+REQUEST_PATH,env),
   /FRESH_PILOT_NOT_EXCLUSIVE_ADDITION/);
 assert.throws(()=>verifyFreshPilotRequest({...request(),
   date_end_kst:'2026-10-28'},diff,env),/FRESH_PILOT_REQUEST_INVALID/);
 assert.throws(()=>verifyFreshPilotRequest(request(),diff,{
   ...env,GITHUB_EVENT_NAME:'workflow_dispatch'
 }),/FRESH_PILOT_ACTION_SCOPE_DENIED/);
 assert.throws(()=>verifyFreshPilotRequest(request(),diff,{
   ...env,WCL_CLIENT_SECRET:''
 }),/FRESH_PILOT_SECRET_UNAVAILABLE/);
});
test('one consumed marker is reserved before OAuth, then ONE paid WCL query',async()=>{
 const {fn,calls}=mockedFetch();const logs=[];
 const result=await runFreshPilot({req:request(),changedFiles:diff,
   env,fetchImpl:fn,clock:(()=>{let now=100;return()=>now+=10;})(),
   log:x=>logs.push(x)});
 assert.equal(result.status,'COMPLETE_8_OF_8');
 assert.equal(result.graphqlRequests,1);
 assert.equal(result.completeJobs,8);
 assert.equal(result.observedPoints,8.01);
 assert.equal(calls.length,3);
 assert.ok(calls[0].url.endsWith('/git/refs'));
 assert.ok(calls[1].url.endsWith('/oauth/token'));
 assert.ok(calls[2].url.endsWith('/api/v2/client'));
 assert.deepEqual(JSON.parse(calls[0].opts.body),{
   ref:ONCE_REF,sha:env.GITHUB_SHA
 });
 const displayed=JSON.stringify(logs);
 for(const forbidden of ['SECRET_ACTOR','PRIVATE_REPORT','secret_access_token_test',
   'wcl-secret-fixture','gh-secret-fixture'])
   assert.equal(displayed.includes(forbidden),false);
 assert.equal(logs[0].aliases.length,8);
 assert.ok(logs[0].aliases.every(x=>x.rows===100));
 assert.equal(logs[0].rawSourcePersisted,false);
});
test('reservation 422 is zero WCL calls, no OAuth and no replay',async()=>{
 const {fn,calls}=mockedFetch({taken:true});
 const r=await runFreshPilot({req:request(),changedFiles:diff,env,fetchImpl:fn});
 assert.equal(r.status,'ALREADY_CONSUMED');assert.equal(r.wclCalls,0);
 assert.equal(calls.length,1);
});
test('incomplete or out-of-period alias is not treated as a good source',async()=>{
 for(const config of [{short:true},{badTime:true}]){
   const {fn,calls}=mockedFetch(config);const logs=[];
   const r=await runFreshPilot({req:request(),changedFiles:diff,
     env,fetchImpl:fn,log:x=>logs.push(x)});
   assert.equal(r.status,'NEEDS_REVIEW');
   assert.equal(r.completeJobs,0);
   assert.equal(calls.filter(x=>x.url.endsWith('/api/v2/client')).length,1);
   assert.equal(logs.length,1);
   assert.equal(r.rawSourcePersisted,false);
 }
});
test('uncertain WCL HTTP is never repeated or logged verbatim',async()=>{
 const {fn,calls}=mockedFetch({failWcl:true});
 await assert.rejects(()=>runFreshPilot({
   req:request(),changedFiles:diff,env,fetchImpl:fn
 }),/FRESH_PILOT_WCL_UNCERTAIN_NO_RETRY/);
 assert.equal(calls.filter(x=>x.url.endsWith('/api/v2/client')).length,1);
});
