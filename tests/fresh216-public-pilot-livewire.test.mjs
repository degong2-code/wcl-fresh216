import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
  captureExactWclResponse,preflightFresh216PublicPilot
} from '../tools/run-fresh216-public-pilot-once.mjs';
import {
  executeFresh216PublicPilot
} from '../src/core/fresh216-public-pilot-execution.mjs';
import {
  createPublicPilotJournal,makePilotReservation,PILOT_JOURNAL
} from '../src/adapters/fresh216-public-pilot-journal.mjs';
import {verifyActorProofArchive} from '../src/core/fresh216-actor-proof-archive.mjs';

const sha=x=>createHash('sha256').update(x).digest('hex');
const KEY='SYNTHETIC_HMAC_KEY_ONLY_NEVER_USE_IN_PRODUCTION_20261031';
const SOURCE='a'.repeat(64);
const env={
 GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'push',
 GITHUB_REPOSITORY:'degong2-code/wcl-fresh216',
 GITHUB_REF:'refs/heads/work/fresh216-autonomous-host-20261031',
 GITHUB_SHA:'b'.repeat(40),GITHUB_RUN_ID:'41100000001',RUNNER_OS:'Linux',
 GITHUB_TOKEN:'SYNTHETIC_GITHUB_TOKEN_WITH_ENOUGH_LENGTH',
 WCL_CLIENT_ID:'SYNTHETIC_ID',WCL_CLIENT_SECRET:'SYNTHETIC_SECRET',
 FRESH216_EVIDENCE_HMAC_KEY:KEY
};
const request={
 id:'FRESH216_PUBLIC_1_WAVE_V3_20261031',
 approval:'OWNER_PROCEED_PUBLIC_RESULTS_V3_AFTER_ZERO_WCL_20261031',
 maxGraphql:1,maxFights:4,sourceSha256:'7231c678f305dfe2a278b6a0371897044d4d0a0058cf5f6219c993a4a3fae9d2'
};
const diff='A\texperiments/fresh216-one-wave-public-pilot-v3-20261031.json\n';
const scope='heroic:2026-10-22_27:latest:source';
const slot={
 jobKey:'BossA|Hunter|Marksmanship',rank:1,snapshotSha:'c'.repeat(64),
 name:'Anonymous',totalDps:1000,className:'Hunter',specName:'Marksmanship',
 startTime:1792594801000,reportRevision:5
};
const group={
 scopeKey:scope,reportCode:'SYNTHETIC-REPORT',reportRevision:5,
 fightId:3,encounterId:3470,difficulty:4,slots:[slot]
};
const wave={scopeKey:scope,reportCode:group.reportCode,reportRevision:5,
 fightGroups:[group]};
const privateWave={
 schema:1,sourceSha256:request.sourceSha256,
 sourceCommit:'39573a118f2a57f9dc6758936e9d73e9aa6cebf5',
 deltaCommit:'d56befacce6ff8062878ed3a4edec6a55cd91b07',wave
};
const actor=(amount)=>({
 id:7,name:'Player (1)',class:'Hunter',spec:'Marksmanship',amount
});
const ranking=(amount)=>({data:[{
 fightID:3,encounter:{id:3470},difficulty:4,
 roles:{dps:{characters:[actor(amount)]}}
}]});
const body={
 data:{
  rateLimitData:{currentRequest:{total:5.25}},
  reportData:{report:{
   code:group.reportCode,revision:5,o0:ranking(1000),b0:ranking(700)
  }}
 }
};
const goodSummary={
 httpStatus:200,observedPoints:5.25,requestBodySha256:'d'.repeat(64),
 responseBodySha256:'e'.repeat(64),fightGroups:1,sourceSlots:1,
 candidateVerifiedSlots:1,verifiedSlots:1,unresolvedSlots:0,
 archiveCount:1,archiveManifestSha256:'f'.repeat(64),incident:null
};
function fakeJournal(order=[]){
 return {
  async reserve(value){order.push('reserve');return {data:value,blobSha:'1'.repeat(40),commitSha:'2'.repeat(40)};},
  async seal(reserved,summary){order.push('seal');return {
   data:{...reserved.data,status:summary.incident===null?'COMPLETED':'NEEDS_REVIEW',result:summary},
   commitSha:'3'.repeat(40)
  };}
 };
}
function fakeArchiveStore(order=[],{fail=false}={}){
 return {
  async persistWave(archives){
   order.push('archive');
   if(fail)throw Error('synthetic store failure');
   const v=archives.map(a=>verifyActorProofArchive(a,{hmacKey:KEY}));
   return {
    archiveCount:archives.length,manifestSha256:'f'.repeat(64),
    verifiedSlots:v.reduce((n,x)=>n+x.verifiedSlots,0),
    unresolvedSlots:v.reduce((n,x)=>n+x.unresolvedSlots,0)
   };
  }
 };
}
const validEnv=()=>({...env});
test('exact WCL response bytes are hashed before UTF-8 and JSON parsing',async()=>{
 const raw=Buffer.from('{"data":{"value":7}}','utf8');
 const response=new Response(raw,{status:200,headers:{'content-type':'application/json'}});
 const captured=await captureExactWclResponse(response);
 assert.equal(captured.responseBodySha256,sha(raw));
 assert.equal(captured.responseBodyByteLength,raw.length);
 assert.equal(captured.parseStatus,'JSON_OK');
 assert.deepEqual(captured.body,{data:{value:7}});
});
test('invalid UTF-8 or JSON still retains exact byte digest but is not parseable',async()=>{
 const raw=Buffer.from([0xff,0xfe,0xfd]);
 const captured=await captureExactWclResponse(new Response(raw,{status:200}));
 assert.equal(captured.responseBodySha256,sha(raw));
 assert.equal(captured.parseStatus,'INVALID_UTF8_OR_JSON');
 assert.equal(captured.body,null);
});
test('preflight requires the separate evidence HMAC key and exact pinned wave',()=>{
 assert.equal(preflightFresh216PublicPilot({
  env:validEnv(),request,diff,privateWave
 }),wave);
 for(const key of ['', 'short']){
  assert.throws(()=>preflightFresh216PublicPilot({
   env:{...env,FRESH216_EVIDENCE_HMAC_KEY:key},request,diff,privateWave
  }),/PILOT_EVIDENCE_HMAC_KEY_MISSING_OR_TOO_SHORT/);
 }
 assert.throws(()=>preflightFresh216PublicPilot({
  env:validEnv(),request,diff:'M\ttools/ci.mjs',privateWave
 }),/PILOT_ONE_TIME_ADD_ONLY_REQUEST_REQUIRED/);
});
test('paired rankings are reserved, fetched once, archived, read back, then sealed',async()=>{
 const order=[],journal=fakeJournal(order),store=fakeArchiveStore(order);
 let calls=0;
 const raw=Buffer.from(JSON.stringify(body),'utf8');
 const result=await executeFresh216PublicPilot({
  env:validEnv(),journal,wave,sourceSha256:SOURCE,
  clock:()=>1793450000000,actorArchiveStore:store,hmacKey:KEY,
  transport:async(_query,requestBodyText,{markGraphqlAttempt})=>{
   assert.equal(JSON.parse(requestBodyText).variables.code,group.reportCode);
   order.push('transport');markGraphqlAttempt();calls++;
   return {httpStatus:200,body,responseBodySha256:sha(raw)};
  }
 });
 assert.deepEqual(order,['reserve','transport','archive','seal']);
 assert.equal(calls,1);
 assert.equal(result.attemptedGraphql,1);
 assert.equal(result.status,'COMPLETED');
 assert.equal(result.verifiedSlots,1);
 assert.equal(result.unresolvedSlots,0);
 assert.equal(result.archiveCount,1);
});
test('OAuth or transport failure before GraphQL dispatch records zero GraphQL calls',async()=>{
 const order=[],journal=fakeJournal(order),store=fakeArchiveStore(order);
 const result=await executeFresh216PublicPilot({
  env:validEnv(),journal,wave,sourceSha256:SOURCE,
  clock:()=>1793450000000,actorArchiveStore:store,hmacKey:KEY,
  transport:async()=>{throw Error('synthetic OAuth failure');}
 });
 assert.equal(result.attemptedGraphql,0);
 assert.equal(result.status,'NEEDS_REVIEW');
 assert.equal(order.join(','),'reserve,seal');
});
test('missing raw response digest cannot produce an archive or COMPLETED status',async()=>{
 const order=[],journal=fakeJournal(order),store=fakeArchiveStore(order);
 const result=await executeFresh216PublicPilot({
  env:validEnv(),journal,wave,sourceSha256:SOURCE,
  clock:()=>1793450000000,actorArchiveStore:store,hmacKey:KEY,
  transport:async(_q,_b,{markGraphqlAttempt})=>{
   markGraphqlAttempt();return {httpStatus:200,body};
  }
 });
 assert.equal(result.attemptedGraphql,1);
 assert.equal(result.status,'NEEDS_REVIEW');
 assert.equal(result.archiveCount,0);
 assert.equal(order.join(','),'reserve,seal');
});
test('archive persistence failure leaves a review state and no retry',async()=>{
 const order=[],journal=fakeJournal(order),store=fakeArchiveStore(order,{fail:true});
 const raw=Buffer.from('synthetic response');
 const result=await executeFresh216PublicPilot({
  env:validEnv(),journal,wave,sourceSha256:SOURCE,
  clock:()=>1793450000000,actorArchiveStore:store,hmacKey:KEY,
  transport:async(_q,_b,{markGraphqlAttempt})=>{
   markGraphqlAttempt();return {httpStatus:200,body,responseBodySha256:sha(raw)};
  }
 });
 assert.equal(result.status,'NEEDS_REVIEW');
 assert.equal(result.archiveCount,0);
 assert.equal(order.join(','),'reserve,archive,seal');
});
test('GraphQL dispatch marker rejects a second request attempt',async()=>{
 const order=[],journal=fakeJournal(order),store=fakeArchiveStore(order);
 const result=await executeFresh216PublicPilot({
  env:validEnv(),journal,wave,sourceSha256:SOURCE,
  clock:()=>1793450000000,actorArchiveStore:store,hmacKey:KEY,
  transport:async(_q,_b,{markGraphqlAttempt})=>{
   markGraphqlAttempt();markGraphqlAttempt();
   return {httpStatus:200,body,responseBodySha256:'e'.repeat(64)};
  }
 });
 assert.equal(result.attemptedGraphql,1);
 assert.equal(result.status,'NEEDS_REVIEW');
 assert.equal(order.join(','),'reserve,seal');
});
function githubFake(){
 let content=null,puts=0,deny=false;
 const blob=x=>createHash('sha1').update('blob '+Buffer.byteLength(x)+'\0').update(x).digest('hex');
 const fetchImpl=async(_url,init={})=>{
  if((init.method??'GET')==='GET'){
   if(content===null)return {status:404};
   return {status:200,json:async()=>({
    sha:blob(content),encoding:'base64',content:Buffer.from(content).toString('base64')
   })};
  }
  puts++;
  if(deny)return {status:403};
  const req=JSON.parse(init.body);
  assert.equal(req.branch,PILOT_JOURNAL.branch);
  if(req.sha===undefined&&content!==null)return {status:422};
  if(req.sha!==undefined&&req.sha!==blob(content??''))return {status:409};
  content=Buffer.from(req.content,'base64').toString('utf8');
  return {status:req.sha===undefined?201:200,json:async()=>({
   content:{sha:blob(content)},commit:{sha:String(puts).padStart(40,'a')}
  })};
 };
 return {fetchImpl,raw:()=>content,puts:()=>puts,deny:()=>{deny=true;}};
}
test('public journal reserves once and only completes with full archive accounting',async()=>{
 const gh=githubFake();
 const journal=createPublicPilotJournal({token:env.GITHUB_TOKEN,fetchImpl:gh.fetchImpl});
 const reservation=makePilotReservation({
  env:validEnv(),waveSha256:'a'.repeat(64),sourceSha256:SOURCE,nowMs:1793450000000
 });
 const reserved=await journal.reserve(reservation);
 assert.equal(reserved.data.status,'IN_FLIGHT');
 await assert.rejects(journal.reserve(reservation),/PUBLIC_PILOT_ALREADY_RESERVED_STOP/);
 const sealed=await journal.seal(reserved,goodSummary);
 assert.equal(sealed.data.status,'COMPLETED');
 assert.equal(sealed.data.result.sourceSlots,1);
 assert.equal(gh.puts(),2);
});
test('journal rejects incomplete or malformed archive receipts',async()=>{
 const gh=githubFake();
 const journal=createPublicPilotJournal({token:env.GITHUB_TOKEN,fetchImpl:gh.fetchImpl});
 const reservation=makePilotReservation({
  env:validEnv(),waveSha256:'a'.repeat(64),sourceSha256:SOURCE,nowMs:1793450000000
 });
 const reserved=await journal.reserve(reservation);
 await assert.rejects(journal.seal(reserved,{...goodSummary,sourceSlots:2}),
  /PUBLIC_PILOT_COMPLETION_PROOF_MISSING/);
 assert.equal(JSON.parse(gh.raw()).status,'IN_FLIGHT');
});
