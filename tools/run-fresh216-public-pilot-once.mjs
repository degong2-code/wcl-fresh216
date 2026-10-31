#!/usr/bin/env node
/**
 * Fresh216 at-most-one WCL GraphQL calibration. PRIVATE wave file is local
 * ephemeral input; PUBLIC journal receives only SHA digests/aggregate counts.
 * Never dispatch on an ordinary code push, fork PR, or repeated request.
 */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {executeFresh216PublicPilot}
 from '../src/core/fresh216-public-pilot-execution.mjs';
import {createPublicPilotJournal,PILOT_JOURNAL}
 from '../src/adapters/fresh216-public-pilot-journal.mjs';

const REQUEST='experiments/fresh216-one-wave-public-pilot-20261031.json';
const SOURCE_HASH='7231c678f305dfe2a278b6a0371897044d4d0a0058cf5f6219c993a4a3fae9d2';
const ORIGINAL_SOURCE='39573a118f2a57f9dc6758936e9d73e9aa6cebf5';
const DELTA_SOURCE='d56befacce6ff8062878ed3a4edec6a55cd91b07';
const TOKEN_ENDPOINT='https://www.warcraftlogs.com/oauth/token';
const GRAPHQL_ENDPOINT='https://www.warcraftlogs.com/api/v2/client';
const need=(v,c)=>{if(!v)throw Error(c);};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).sort().join('|')===keys.slice().sort().join('|');

export function preflightFresh216PublicPilot({env,request,diff,privateWave}={}){
 need(env?.GITHUB_ACTIONS==='true'&&env?.GITHUB_EVENT_NAME==='push'&&
  env?.GITHUB_REPOSITORY===PILOT_JOURNAL.repo&&
  env?.GITHUB_REF===PILOT_JOURNAL.trustedRef&&
  env?.RUNNER_OS==='Linux','PILOT_TRUSTED_GITHUB_CONTEXT_REQUIRED');
 need(diff?.trim()==='A\t'+REQUEST,'PILOT_ONE_TIME_ADD_ONLY_REQUEST_REQUIRED');
 need(exact(request,['id','approval','maxGraphql','maxFights','sourceSha256'])&&
  request.id==='FRESH216_PUBLIC_1_WAVE_20261031'&&
  request.approval==='OWNER_PROCEED_PUBLIC_RESULTS_20261031'&&
  request.maxGraphql===1&&request.maxFights===4&&
  request.sourceSha256===SOURCE_HASH,
  'PILOT_EXPLICIT_SCOPE_INVALID');
 need(typeof env.GITHUB_TOKEN==='string'&&env.GITHUB_TOKEN.length>20&&
  typeof env.WCL_CLIENT_ID==='string'&&env.WCL_CLIENT_ID.length>0&&
  typeof env.WCL_CLIENT_SECRET==='string'&&env.WCL_CLIENT_SECRET.length>0,
  'PILOT_REQUIRED_CREDENTIAL_MISSING_NO_REQUEST');
 need(privateWave?.schema===1&&privateWave.sourceSha256===SOURCE_HASH&&
  privateWave.sourceCommit===ORIGINAL_SOURCE&&
  privateWave.deltaCommit===DELTA_SOURCE&&
  privateWave.wave?.fightGroups?.length>=1&&
  privateWave.wave.fightGroups.length<=4,
  'PILOT_PINNED_WAVE_INVALID');
 return privateWave.wave;
}

export async function executePublicPilotOnce({
 env=process.env,request,diff,privateWave,fetchImpl=fetch,clock=Date.now
}={}){
 const wave=preflightFresh216PublicPilot({env,request,diff,privateWave});
 const journal=createPublicPilotJournal({
  token:env.GITHUB_TOKEN,fetchImpl
 });
 const transport=async query=>{
   // OAuth happens only AFTER the verified, durable public IN_FLIGHT marker.
   const basic=Buffer.from(env.WCL_CLIENT_ID+':'+env.WCL_CLIENT_SECRET)
    .toString('base64');
   const oauth=await fetchImpl(TOKEN_ENDPOINT,{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(25000),
    headers:{Authorization:'Basic '+basic,
      'Content-Type':'application/x-www-form-urlencoded'},
    body:'grant_type=client_credentials'
   });
   if(oauth.status!==200)throw Error('PILOT_OAUTH_UNCERTAIN_NO_RETRY');
   const auth=await oauth.json();
   if(typeof auth?.access_token!=='string'||!auth.access_token)
    throw Error('PILOT_OAUTH_RESPONSE_INVALID');
   const res=await fetchImpl(GRAPHQL_ENDPOINT,{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(45000),
    headers:{Authorization:'Bearer '+auth.access_token,
      'Content-Type':'application/json'},
    body:JSON.stringify(query)
   });
   return {httpStatus:res.status,body:await res.json().catch(()=>null)};
 };
 return executeFresh216PublicPilot({
  env,journal,wave,sourceSha256:SOURCE_HASH,clock,transport
 });
}

if(process.argv[1]?.endsWith('/run-fresh216-public-pilot-once.mjs')){
 try{
  const e=process.env;
  const diff=execFileSync('git',[
   'diff-tree','--no-commit-id','--name-status','-r',e.GITHUB_SHA
  ],{encoding:'utf8',timeout:10000});
  const file=e.FRESH216_PRIVATE_PILOT_WAVE_FILE;
  need(typeof file==='string'&&path.isAbsolute(file)&&
   file.startsWith(path.resolve(e.RUNNER_TEMP??'/tmp')+path.sep)&&
   (fs.statSync(file).mode&0o077)===0,
   'PILOT_PRIVATE_WAVE_NOT_PROTECTED');
  const wave=JSON.parse(fs.readFileSync(file,'utf8'));
  const request=JSON.parse(fs.readFileSync(REQUEST,'utf8'));
  const result=await executePublicPilotOnce({
   env:e,request,diff,privateWave:wave
  });
  process.stdout.write('FRESH216_PUBLIC_PILOT '+JSON.stringify({
   status:result.status,attemptedGraphql:result.attemptedGraphql,
   observedPoints:result.observedPoints,verifiedSlots:result.verifiedSlots,
   unresolvedSlots:result.unresolvedSlots
  })+'\n');
  if(result.status!=='COMPLETED')process.exitCode=2;
 }catch(err){
  const msg=String(err?.message??'');
  process.stderr.write(
   (/^(PILOT_|PUBLIC_PILOT_)[A-Z0-9_]+$/.test(msg)?
    msg:'PUBLIC_PILOT_UNCERTAIN_STOP')+'\n');
  process.exitCode=1;
 }
}
