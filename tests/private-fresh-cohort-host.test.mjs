import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
 ensurePrivateCohortDirectory,openPrivateCohortStore,
 withPrivateCohortOwnerLease,readPrivateCohortStatus,
 createPrivateFresh216EvidenceHooks,runPrivateAdaptiveStep,
 makePrivateWclTransport
} from '../src/adapters/private-fresh-cohort-host.mjs';
import {newCheckpoint} from '../src/core/checkpoint.mjs';
import {executePrivateCohortCli,privateSourceIdentity,SCOPE}
  from '../tools/run-private-fresh216.mjs';

const FRESH_DIR=()=>fs.mkdtempSync(path.join(os.tmpdir(),'fresh216-private-'));
const base=()=>({FRESH216_PRIVATE_DIR:'',WCL_CLIENT_ID:'fixture-client',
  WCL_CLIENT_SECRET:'fixture-secret',GITHUB_ACTIONS:'false'});
const sha=()=>privateSourceIdentity(process.cwd());
const fakeWcl=({error=false}={})=>{
 const urls=[];
 const fetchImpl=async(url,opts)=>{
   urls.push(url);
   if(url.endsWith('/oauth/token')){
     return {status:200,json:async()=>({access_token:'SECRET_OAUTH_TOKEN'})};
   }
   if(!url.endsWith('/api/v2/client'))throw Error('UNEXPECTED_URL');
   if(error)return {status:504,json:async()=>null};
   const query=JSON.parse(opts.body),ranking={};
   for(let i=0;Object.hasOwn(query.variables,'c'+i);i++){
     ranking['t'+i]={rankings:Array.from({length:100},(_,rank)=>({
       name:'PRIVATE_ACTOR_'+i+'_'+rank,
       amount:100000-rank*90-i,
       startTime:1792594801000+rank*1000,
       report:{code:'PRIVATE_REPORT_'+i+'_'+rank,fightID:rank+1}
     }))};
   }
   return {status:200,json:async()=>({data:{
     rateLimitData:{currentRequest:JSON.stringify({total:8.01})},
     worldData:{encounter:ranking}
   }})};
 };
 return {fetchImpl,urls};
};
test('private root is Linux-only, absolute, outside git and mode 0700',()=>{
 const dir=FRESH_DIR();
 try{
   assert.equal(ensurePrivateCohortDirectory(dir,process.cwd()),dir);
   assert.throws(()=>ensurePrivateCohortDirectory(process.cwd(),process.cwd()),
     /PRIVATE_HOST_PUBLIC_CHECKOUT_FORBIDDEN|PRIVATE_HOST_PERMISSIONS_NOT_PRIVATE/);
   fs.chmodSync(dir,0o755);
   assert.throws(()=>ensurePrivateCohortDirectory(dir,process.cwd()),
     /PRIVATE_HOST_PERMISSIONS_NOT_PRIVATE/);
   fs.chmodSync(dir,0o700);
 }finally{fs.rmSync(dir,{force:true,recursive:true});}
});
test('source commit and scope pinned across checkpoint reloads',()=>{
 const dir=FRESH_DIR(),sourceCommit=sha();
 try{
   const s=openPrivateCohortStore({privateDir:dir,repoRoot:process.cwd(),
     scopeKey:SCOPE,sourceCommit,initialize:true});
   assert.equal(s.read().sourceCodeCommit,sourceCommit);
   const again=openPrivateCohortStore({privateDir:dir,
     repoRoot:process.cwd(),scopeKey:SCOPE,sourceCommit});
   assert.equal(again.read().runId,s.read().runId);
   assert.throws(()=>openPrivateCohortStore({privateDir:dir,
     repoRoot:process.cwd(),scopeKey:SCOPE,sourceCommit:'a'.repeat(40)}),
     /PRIVATE_HOST_CHECKPOINT_IDENTITY_DRIFT/);
 }finally{fs.rmSync(dir,{force:true,recursive:true});}
});
test('status and init never invoke OAuth or leak raw source paths',async()=>{
 const dir=FRESH_DIR(),outputs=[];
 try{
   const env={...base(),FRESH216_PRIVATE_DIR:dir};
   const poisoned=()=>{throw Error('FETCH_MUST_NOT_RUN');};
   await executePrivateCohortCli({args:['init'],env,
     fetchImpl:poisoned,write:x=>outputs.push(x)});
   const a=await executePrivateCohortCli({args:['status'],env,
     fetchImpl:poisoned,write:x=>outputs.push(x)});
   assert.equal(a.run.stage,'PLAN_REQUIRED');
   assert.equal(a.run.sourceJobsCompleted,0);
   assert.equal(outputs.length,2);
   assert.equal(outputs.join('').includes(dir),false);
   assert.equal(outputs.join('').includes('fixture-secret'),false);
 }finally{fs.rmSync(dir,{force:true,recursive:true});}
});
test('one approved request durably persists 8x100 private actors and prints sanitized receipt',async()=>{
 const dir=FRESH_DIR(),out=[];
 try{
   const env={...base(),FRESH216_PRIVATE_DIR:dir};
   await executePrivateCohortCli({args:['init'],env,write:x=>out.push(x)});
   const mocked=fakeWcl();
   const result=await executePrivateCohortCli({
     args:['collect','--max-requests','1','--max-points','20',
       '--reserve-points','10'],env,
     fetchImpl:mocked.fetchImpl,write:x=>out.push(x)
   });
   assert.equal(mocked.urls.length,2);
   assert.equal(result.run.sourceJobsCompleted,8);
   assert.equal(result.run.requestPointsObserved,8.01);
   assert.equal(result.operations.length,1);
   assert.equal(result.operations[0].status,'RECORDED');
   assert.equal(result.run.sourceRequests,32);
   assert.equal(out.join('').includes('PRIVATE_ACTOR'),false);
   assert.equal(out.join('').includes('PRIVATE_REPORT'),false);
   assert.equal(out.join('').includes('SECRET_OAUTH_TOKEN'),false);
   assert.equal(out.join('').includes(dir),false);
   const store=openPrivateCohortStore({
     privateDir:dir,repoRoot:process.cwd(),scopeKey:SCOPE,sourceCommit:sha()
   });
   const first=Object.values(store.read().sourceRequests)[0];
   assert.equal(first.status,'COMPLETED');
   assert.equal(first.result.jobs.length,8);
   assert.equal(first.result.jobs[0].rows.length,100);
   assert.equal(first.result.jobs[0].rows[0].name,'PRIVATE_ACTOR_0_0');
   assert.equal((fs.statSync(path.join(dir,'fresh216-checkpoint.json')).mode&0o077),0);
   assert.equal(readPrivateCohortStatus({
     store,scopeKey:SCOPE,sourceCommit:sha()
   }).run.nextBatchIndex,1);
 }finally{fs.rmSync(dir,{force:true,recursive:true});}
});
test('two invocations continue from next batch, NEVER replay first 8 specs',async()=>{
 const dir=FRESH_DIR();
 try{
   const env={...base(),FRESH216_PRIVATE_DIR:dir};
   await executePrivateCohortCli({args:['init'],env,write:()=>{}});
   const api1=fakeWcl();
   const a=await executePrivateCohortCli({args:['collect'],env,
     fetchImpl:api1.fetchImpl,write:()=>{}});
   assert.equal(a.run.sourceJobsCompleted,8);
   const api2=fakeWcl();
   const b=await executePrivateCohortCli({args:['collect'],env,
     fetchImpl:api2.fetchImpl,write:()=>{}});
   assert.equal(b.run.sourceJobsCompleted,16);
   assert.equal(b.run.requestPointsObserved,16.02);
   const store=openPrivateCohortStore({privateDir:dir,repoRoot:process.cwd(),
     scopeKey:SCOPE,sourceCommit:sha()});
   assert.equal(Object.values(store.read().sourceRequests)
     .filter(x=>x.status==='COMPLETED').length,2);
 }finally{fs.rmSync(dir,{force:true,recursive:true});}
});
test('point budget stops second request and does not convert PASS to source complete',async()=>{
 const dir=FRESH_DIR();
 try{
   const env={...base(),FRESH216_PRIVATE_DIR:dir},mock=fakeWcl();
   await executePrivateCohortCli({args:['init'],env,write:()=>{}});
   const result=await executePrivateCohortCli({
     args:['collect','--max-requests','2','--max-points','15',
       '--reserve-points','10'],env,fetchImpl:mock.fetchImpl,write:()=>{}
   });
   assert.equal(result.run.sourceJobsCompleted,8);
   assert.equal(result.operations.length,2);
   assert.equal(result.operations[1].status,'BUDGET_PAUSED');
   assert.equal(result.operations[1].attempted,false);
   assert.equal(mock.urls.filter(x=>x.endsWith('/api/v2/client')).length,1);
   assert.equal(result.run.stage,'SOURCE_BATCH');
   await assert.rejects(()=>executePrivateCohortCli({args:['export'],env,
     write:()=>{}}),/FRESH_COHORT_INCOMPLETE/);
   assert.equal(fs.existsSync(path.join(dir,'fresh216-total100-verified.json')),false);
 }finally{fs.rmSync(dir,{force:true,recursive:true});}
});
test('uncertain WCL request blocks all future paid requests, even OAuth',async()=>{
 const dir=FRESH_DIR();
 try{
   const env={...base(),FRESH216_PRIVATE_DIR:dir};
   await executePrivateCohortCli({args:['init'],env,write:()=>{}});
   const failure=fakeWcl({error:true});
   const first=await executePrivateCohortCli({
     args:['collect'],env,fetchImpl:failure.fetchImpl,write:()=>{}
   });
   assert.equal(first.operations[0].status,'NEEDS_REVIEW');
   assert.equal(first.run.needsReview,1);
   assert.equal(first.run.uncertainAttempts,1);
   const noFetch=()=>{throw Error('NO_OAUTH_OR_WCL_ON_UNCERTAIN_RUN');};
   const later=await executePrivateCohortCli({
     args:['collect'],env,fetchImpl:noFetch,write:()=>{}
   });
   assert.equal(later.attempted,false);
   assert.equal(later.run.stage,'NEEDS_REVIEW');
 }finally{fs.rmSync(dir,{force:true,recursive:true});}
});
test('owner lease blocks competing operation and never silently clears stale lock',async()=>{
 const dir=FRESH_DIR();
 try{
   await withPrivateCohortOwnerLease(dir,async()=>{
     await assert.rejects(()=>withPrivateCohortOwnerLease(dir,async()=>{}),
       /PRIVATE_HOST_OWNER_LOCKED_REVIEW_REQUIRED/);
   });
   fs.mkdirSync(path.join(dir,'.collector-owner-lock'),{mode:0o700});
   await assert.rejects(()=>withPrivateCohortOwnerLease(dir,async()=>{}),
     /PRIVATE_HOST_OWNER_LOCKED_REVIEW_REQUIRED/);
 }finally{fs.rmSync(dir,{force:true,recursive:true});}
});
test('GitHub Actions ephemeral workspace cannot be used for private paid source',async()=>{
 const dir=FRESH_DIR(),env={...base(),FRESH216_PRIVATE_DIR:dir,
   GITHUB_ACTIONS:'true'};
 try{
   await assert.rejects(()=>executePrivateCohortCli({
     args:['init'],env,write:()=>{}
   }),/PRIVATE_HOST_ACTIONS_VOLUME_NOT_ATTESTED/);
   assert.equal(fs.existsSync(path.join(dir,'fresh216-checkpoint.json')),false);
 }finally{fs.rmSync(dir,{force:true,recursive:true});}
});

test('private adaptive evidence hooks wire witness, archive and C-delta callbacks without executing them',()=>{
 const root=FRESH_DIR(),repo=path.join(root,'repo'),privateDir=path.join(root,'private');
 fs.mkdirSync(repo,{mode:0o700});fs.mkdirSync(privateDir,{mode:0o700});
 const scopeKey='heroic:2026-10-22_27:latest:source';
 const sourceSlots=Array.from({length:21600},(_,i)=>({
   scopeKey,jobKey:'Job'+Math.floor(i/100),rank:i%100+1,
   snapshotSha:'a'.repeat(64),totalDps:1000,
   className:'Hunter',specName:'Marksmanship',name:'Actor',
   reportCode:'R'+i,fightId:i+1,encounterId:3470,difficulty:4,
   reportRevision:null,startTime:1792594801000+i
 }));
 try{
   const hooks=createPrivateFresh216EvidenceHooks({
     privateDir,repoRoot:repo,sourceSlots,
     expectedSourceSha256:'b'.repeat(64),expectedScopeKey:scopeKey,
     hmacKey:'SYNTHETIC_PRIVATE_HMAC_KEY_LONG_ENOUGH_20261031',
     archiveStore:{persistWave:async()=>{throw Error('NOT_CALLED');}},
     cDeltaAppender:async()=>{throw Error('NOT_CALLED');}
   });
   assert.equal(typeof hooks.onVerifiedWave,'function');
   assert.equal(typeof hooks.witnessReader,'function');
   assert.equal(typeof hooks.evidencePublisher,'function');
   assert.equal(fs.existsSync(path.join(privateDir,'report-wave-witnesses')),true);
   assert.equal(fs.readdirSync(path.join(privateDir,'report-wave-witnesses')).length,0);
 }finally{fs.rmSync(root,{force:true,recursive:true});}
});

test('private WCL transport is lazy and sends the exact Report request body',async()=>{
 const calls=[],responseBytes=Buffer.from('{"data":{"ok":true}}','utf8');
 const fetchImpl=async(url,options)=>{
   calls.push({url,body:options.body});
   if(url.endsWith('/oauth/token'))
     return {status:200,json:async()=>({access_token:'SYNTHETIC_TOKEN'})};
   return {status:200,arrayBuffer:async()=>responseBytes.buffer.slice(
     responseBytes.byteOffset,responseBytes.byteOffset+responseBytes.byteLength
   )};
 };
 const transport=await makePrivateWclTransport({
   clientId:'synthetic-client',clientSecret:'synthetic-secret',
   fetchImpl,timeoutMs:5000
 });
 assert.equal(calls.length,0);
 const requestBodyText='{"query":"exact-wave-body"}';
 const out=await transport({query:'different-object'},requestBodyText);
 assert.equal(calls.length,2);
 assert.equal(calls[0].url.endsWith('/oauth/token'),true);
 assert.equal(calls[1].body,requestBodyText);
 assert.deepEqual(out.rawBodyBytes,responseBytes);
 assert.deepEqual(out.body,{data:{ok:true}});
});
test('private host runs one existing adaptive preview under the owner lease without OAuth or writes',async()=>{
 const dir=FRESH_DIR(),scopeKey='heroic:full216',sourceCommit='b'.repeat(40);
 const state=newCheckpoint(scopeKey,'adaptive-run');
 state.sourceCodeCommit=sourceCommit;
 let current=state,updates=0;
 const store={
   read:()=>structuredClone(current),
   update:fn=>{current=fn(structuredClone(current));updates++;
     return structuredClone(current);}
 };
 const slots=[];
 for(let boss=0;boss<8;boss++)for(let spec=0;spec<27;spec++)
 for(let rank=1;rank<=100;rank++)slots.push({
   scopeKey,jobKey:'Boss'+boss+'|Class'+spec+'|Spec'+spec,
   rank,snapshotSha:'a'.repeat(64),status:'PENDING',
   className:'Class'+spec,specName:'Spec'+spec,
   encounterId:3470+boss,difficulty:4,
   reportCode:'R_'+boss+'_'+spec+'_'+rank,fightId:rank,
   reportRevision:5,name:'Actor'+spec,totalDps:10000-rank-spec,
   startTime:1792600000000+rank,
   filter:'date.1792594800000.1793199600000'
 });
 try{
   const result=await runPrivateAdaptiveStep({
     privateDir:dir,repoRoot:process.cwd(),scopeKey,sourceCommit,
     slots,store
   });
   assert.equal(result.status,'PREVIEW');
   assert.equal(result.kind,'RANK_BATCH');
   assert.equal(result.nextPage,1);
   assert.equal(updates,0);
   assert.equal(fs.existsSync(path.join(dir,'.collector-owner-lock')),false);
 }finally{fs.rmSync(dir,{force:true,recursive:true});}
});
