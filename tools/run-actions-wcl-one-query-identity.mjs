#!/usr/bin/env node
/**
 * ONE newly owner-approved WCL GraphQL attempt, never a retry of 2-query run.
 * The current dev push CI performs offline tests first and ONLY an exclusive
 * add-only identity request file opens this job. GitHub atomic consumed ref is
 * reserved BEFORE OAuth; no second attempt even after ambiguity or failure.
 * Public output = aggregate safe counts/timing/rate witnesses, no raw actor IDs.
 */
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {Buffer} from 'node:buffer';
import {IDENTITY_TARGET,IDENTITY_REQUEST,IDENTITY_APPROVAL,IDENTITY_ONCE_REF,
 buildIdentityWitnessQuery,summarizeIdentityWitness}
 from '../src/core/fresh-one-query-identity.mjs';

const REPO='degong2-code/wcl-fresh216';
const BRANCH='refs/heads/work/collector-architecture';
const TOKEN_URL='https://www.warcraftlogs.com/oauth/token';
const API_URL='https://www.warcraftlogs.com/api/v2/client';
const GH_REFS='https://api.github.com/repos/'+REPO+'/git/refs';
const EXPECTED_URL='https://www.warcraftlogs.com/reports/'+
  IDENTITY_TARGET.reportCode+'?fight='+IDENTITY_TARGET.fightId;
const exactKeys=(v,keys)=>v!==null&&typeof v==='object'&&
  !Array.isArray(v)&&Object.keys(v).sort().join('|')===
  keys.slice().sort().join('|');

export function preflightIdentityOnce(env,request,changedFiles){
  if(env?.GITHUB_ACTIONS!=='true'||env?.GITHUB_EVENT_NAME!=='push'||
    env?.GITHUB_REF!==BRANCH||env?.GITHUB_REPOSITORY!==REPO||
    !/^[a-f0-9]{40}$/i.test(env?.GITHUB_SHA??''))
    throw Error('IDENTITY_ACTION_SCOPE_INVALID');
  if(changedFiles.trim()!=='A\t'+IDENTITY_REQUEST)
    throw Error('IDENTITY_NOT_EXCLUSIVE_ADD_REQUEST');
  if(!exactKeys(request,['request_id','approval','public_report_url',
    'report_code','fight_id','max_graphql']))
    throw Error('IDENTITY_REQUEST_FIELDS_INVALID');
  if(request.request_id!=='FRESH216_ONE_QUERY_IDENTITY_20261027'||
     request.approval!==IDENTITY_APPROVAL||
     request.public_report_url!==EXPECTED_URL||
     request.report_code!==IDENTITY_TARGET.reportCode||
     request.fight_id!==IDENTITY_TARGET.fightId||
     request.max_graphql!==1)
    throw Error('IDENTITY_TARGET_OR_APPROVAL_INVALID');
  for(const name of ['GITHUB_TOKEN','WCL_CLIENT_ID','WCL_CLIENT_SECRET'])
    if(typeof env?.[name]!=='string'||env[name].length===0)
      throw Error('IDENTITY_REQUIRED_SECRET_MISSING');
  return buildIdentityWitnessQuery();
}

export async function runApprovedIdentityOnce({
  env=process.env,request,changedFiles,fetchImpl=fetch,log=()=>{},
  clock=Date.now
}={}){
  const one=preflightIdentityOnce(env,request,changedFiles);
  const headers={
    Authorization:'Bearer '+env.GITHUB_TOKEN,
    Accept:'application/vnd.github+json',
    'Content-Type':'application/json',
    'X-GitHub-Api-Version':'2022-11-28'
  };
  let reserve;
  try{
    reserve=await fetchImpl(GH_REFS,{
      method:'POST',headers,redirect:'error',
      signal:AbortSignal.timeout(15000),
      body:JSON.stringify({ref:IDENTITY_ONCE_REF,sha:env.GITHUB_SHA})
    });
  }catch{throw Error('IDENTITY_RESERVATION_UNCERTAIN_NO_RETRY');}
  if(reserve?.status===422)
    return {status:'ONE_TIME_IDENTITY_ALREADY_CONSUMED',graphqlRequests:0};
  if(reserve?.status!==201)throw Error('IDENTITY_RESERVATION_REFUSED');
  // Reservation is irreversible; from here even OAuth or HTTP failures
  // permanently consume this explicitly authorized one-query allowance.
  const basic=Buffer.from(env.WCL_CLIENT_ID+':'+env.WCL_CLIENT_SECRET)
    .toString('base64');
  let oauth;
  try{oauth=await fetchImpl(TOKEN_URL,{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(25000),
    headers:{
      Authorization:'Basic '+basic,
      'Content-Type':'application/x-www-form-urlencoded'
    },
    body:'grant_type=client_credentials'
  });}
  catch{throw Error('IDENTITY_OAUTH_OUTCOME_UNKNOWN');}
  if(oauth?.status!==200)throw Error('IDENTITY_OAUTH_DENIED');
  const auth=await oauth.json().catch(()=>null);
  if(typeof auth?.access_token!=='string'||!auth.access_token)
    throw Error('IDENTITY_OAUTH_TOKEN_MISSING');
  const started=clock();
  let reply;
  try{reply=await fetchImpl(API_URL,{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(45000),
    headers:{
      Authorization:'Bearer '+auth.access_token,
      'Content-Type':'application/json'
    },
    body:JSON.stringify(one)
  });}
  catch{throw Error('IDENTITY_GRAPHQL_OUTCOME_UNKNOWN_NO_RETRY');}
  const elapsedMs=Math.max(0,clock()-started);
  const body=await reply.json().catch(()=>null);
  const result=summarizeIdentityWitness({
    httpStatus:reply.status,body,elapsedMs
  });
  // Never print report URL, private actor names/ids, GraphQL errors,
  // OAuth token, raw table damage, rate headers or private data.
  log(result);
  return result;
}

if(process.argv[1]?.endsWith('/run-actions-wcl-one-query-identity.mjs')){
  try{
    const changes=execFileSync('git',[
      'diff-tree','--no-commit-id','--name-status','-r',process.env.GITHUB_SHA
    ],{encoding:'utf8',timeout:10000});
    if(changes.trim()!=='A\t'+IDENTITY_REQUEST){
      process.stdout.write('IDENTITY_NOT_REQUEST_ADDITION_NO_HTTP\n');
    }else{
      const request=JSON.parse(fs.readFileSync(IDENTITY_REQUEST,'utf8'));
      const result=await runApprovedIdentityOnce({
        env:process.env,request,changedFiles:changes,
        log:res=>process.stdout.write('REDACTED_IDENTITY_WITNESS '+
          JSON.stringify(res)+'\n')
      });
      if(result.status==='NEEDS_REVIEW')process.exitCode=3;
      if(result.status==='ONE_TIME_IDENTITY_ALREADY_CONSUMED')
        process.exitCode=2;
    }
  }catch(error){
    const msg=String(error?.message??'');
    const safe=/^IDENTITY_[A-Z0-9_]+$/.test(msg)?msg:
      'IDENTITY_EXECUTION_ABORTED';
    process.stderr.write(safe+'\n');
    process.exitCode=1;
  }
}
