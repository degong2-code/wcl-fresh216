import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
  PILOT_JOURNAL,makePilotReservation,createPublicPilotJournal
} from '../src/adapters/fresh216-public-pilot-journal.mjs';
import {executeFresh216PublicPilot}
 from '../src/core/fresh216-public-pilot-execution.mjs';

const sourceSha256='a'.repeat(64),waveSha256='b'.repeat(64);
const env=()=>({
 GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'push',
 GITHUB_REPOSITORY:PILOT_JOURNAL.repo,GITHUB_REF:PILOT_JOURNAL.trustedRef,
 GITHUB_SHA:'c'.repeat(40),GITHUB_RUN_ID:'41000001'
});
const reservation=()=>makePilotReservation({
 env:env(),waveSha256,sourceSha256,nowMs:1793450000000
});
function fakeGithub(){
 let current=null,version=0,denyPut=false,badReadback=false,putCount=0;
 const blob=x=>createHash('sha1').update(x).digest('hex');
 const fetchImpl=async(url,o={})=>{
   assert.ok(url.includes('/repos/degong2-code/wcl-fresh216/contents/'));
   assert.equal(o.redirect,'error');
   const method=o.method??'GET';
   if(method==='GET'){
     if(!current)return {status:404};
     return {status:200,json:async()=>({
       sha:badReadback?'e'.repeat(40):blob(current),
       encoding:'base64',content:Buffer.from(current).toString('base64')
     })};
   }
   assert.equal(method,'PUT');
   putCount++;
   if(denyPut)return {status:403};
   const req=JSON.parse(o.body);
   assert.equal(req.branch,PILOT_JOURNAL.branch);
   if(req.sha!==undefined&&req.sha!==blob(current??''))return {status:409};
   if(req.sha===undefined&&current!==null)return {status:422};
   current=Buffer.from(req.content,'base64').toString('utf8');
   version++;
   return {status:req.sha===undefined?201:200,json:async()=>({
     content:{sha:blob(current)},commit:{sha:String(version).padStart(40,'a')}
   })};
 };
 return {
   fetchImpl,raw:()=>current,putCount:()=>putCount,
   deny:()=>denyPut=true,corruptReadback:()=>badReadback=true
 };
}
const sealedResult=()=>({
 httpStatus:200,observedPoints:9.5,
 requestBodySha256:'d'.repeat(64),responseSha256:'e'.repeat(64),
 fightGroups:1,verifiedSlots:1,unresolvedSlots:0,incident:null
});
test('one-shot GitHub reservation verified before any WCL request; no retry',async()=>{
 const gh=fakeGithub();
 const j=createPublicPilotJournal({token:'SYNTHETIC_NON_SECRET_GITHUB_TOKEN',fetchImpl:gh.fetchImpl});
 const reserved=await j.reserve(reservation());
 assert.equal(reserved.data.status,'IN_FLIGHT');
 assert.equal(JSON.parse(gh.raw()).result,null);
 await assert.rejects(j.reserve(reservation()),/PUBLIC_PILOT_ALREADY_RESERVED_STOP/);
 const sealed=await j.seal(reserved,sealedResult());
 assert.equal(sealed.data.status,'COMPLETED');
 assert.equal(sealed.data.result.observedPoints,9.5);
 assert.equal(gh.putCount(),2);
 assert.equal(gh.raw().includes('reportCode'),false);
 assert.equal(gh.raw().includes('actorRef'),false);
});
test('denied GitHub write blocks any paid operation',async()=>{
 const gh=fakeGithub();gh.deny();
 const journal=createPublicPilotJournal({token:'SYNTHETIC_NON_SECRET_GITHUB_TOKEN',fetchImpl:gh.fetchImpl});
 let calls=0;
 const wave={reportCode:'SYNTHETIC',reportRevision:1,
  scopeKey:'heroic:2026-10-22_27:latest:source',
  fightGroups:[{scopeKey:'heroic:2026-10-22_27:latest:source',
   reportCode:'SYNTHETIC',reportRevision:1,fightId:3,
   encounterId:3470,difficulty:4,slots:[{
    name:'Anonymous',rank:1,jobKey:'test',snapshotSha:'a'.repeat(64),
    totalDps:1000,className:'Hunter',specName:'Marksmanship',
    startTime:1792600000000
   }]}]
 };
 await assert.rejects(executeFresh216PublicPilot({
   env:env(),journal,wave,sourceSha256,clock:()=>1793450000000,
   transport:async()=>{calls++;return {httpStatus:200,body:{}};}
 }),/PUBLIC_PILOT_GITHUB_WRITE_UNCONFIRMED_STOP/);
 assert.equal(calls,0);
});
test('post-WCL GitHub failure leaves only IN_FLIGHT; no silent retry',async()=>{
 const gh=fakeGithub(),j=createPublicPilotJournal({
   token:'SYNTHETIC_NON_SECRET_GITHUB_TOKEN',fetchImpl:gh.fetchImpl
 });
 const reserved=await j.reserve(reservation());
 gh.deny();
 await assert.rejects(j.seal(reserved,sealedResult()),
   /PUBLIC_PILOT_GITHUB_WRITE_UNCONFIRMED_STOP/);
 assert.equal(JSON.parse(gh.raw()).status,'IN_FLIGHT');
});
test('readback mismatch refuses WCL even when remote reported commit',async()=>{
 const gh=fakeGithub(),j=createPublicPilotJournal({
   token:'SYNTHETIC_NON_SECRET_GITHUB_TOKEN',fetchImpl:gh.fetchImpl
 });
 gh.corruptReadback();
 await assert.rejects(j.reserve(reservation()),
   /PUBLIC_PILOT_READBACK_MISMATCH_STOP/);
 assert.equal(JSON.parse(gh.raw()).status,'IN_FLIGHT');
});
test('invalid context, bad summary, or attempted identifier leak are rejected',async()=>{
 assert.throws(()=>makePilotReservation({
   env:{...env(),GITHUB_EVENT_NAME:'pull_request'},
   waveSha256,sourceSha256,nowMs:1793450000000
 }),/PUBLIC_PILOT_UNTRUSTED_CONTEXT/);
 const gh=fakeGithub(),j=createPublicPilotJournal({
  token:'SYNTHETIC_NON_SECRET_GITHUB_TOKEN',fetchImpl:gh.fetchImpl
 });
 const reserved=await j.reserve(reservation());
 await assert.rejects(j.seal(reserved,{
  ...sealedResult(),reportCode:'PRIVATE_CODE'
 }),/PUBLIC_PILOT_RESULT_FIELDS/);
 assert.equal(JSON.parse(gh.raw()).status,'IN_FLIGHT');
});
test('uncertain status is durable NEEDS_REVIEW, never fabricated pass',async()=>{
 const gh=fakeGithub(),j=createPublicPilotJournal({
  token:'SYNTHETIC_NON_SECRET_GITHUB_TOKEN',fetchImpl:gh.fetchImpl
 });
 const reserved=await j.reserve(reservation());
 const out=await j.seal(reserved,{
  ...sealedResult(),incident:'HTTP_OR_GRAPHQL_UNCERTAIN',
  observedPoints:null,responseSha256:null
 });
 assert.equal(out.data.status,'NEEDS_REVIEW');
 assert.equal(JSON.parse(gh.raw()).result.observedPoints,null);
});
