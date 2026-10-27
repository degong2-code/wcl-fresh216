#!/usr/bin/env node
/**
 * Explicit owner-approved one-GraphQL WCL typed roster witness.
 * ISOLATED DEV PUSH only, exclusive ADD-only request file, mandatory
 * offline CI PASS before this job. Atomic GitHub ref created BEFORE OAuth.
 * Neither network/HTTP error nor GraphQL semantic error triggers a retry.
 * Zero sensitive names/IDs/realms/totals/tokens in public logs.
 */
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {Buffer} from 'node:buffer';
import {IDENTITY_TARGET} from '../src/core/fresh-one-query-identity.mjs';
import {
 TYPED_ONCE_REF,TYPED_REQUEST,TYPED_APPROVAL,
 buildOneShotTypedRosterQuery,summarizeOneShotTypedRoster
} from '../src/core/fresh-typed-roster-one-shot.mjs';

const REPO='degong2-code/wcl-fresh216';
const EXPECTED_BRANCH='refs/heads/work/collector-architecture';
const REPORT_URL='https://www.warcraftlogs.com/reports/'+
  IDENTITY_TARGET.reportCode+'?fight='+IDENTITY_TARGET.fightId;
const REF_ENDPOINT='https://api.github.com/repos/'+REPO+'/git/refs';
const TOKEN_ENDPOINT='https://www.warcraftlogs.com/oauth/token';
const GRAPHQL_ENDPOINT='https://www.warcraftlogs.com/api/v2/client';
const exactKeys=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
  Object.keys(v).sort().join('|')===keys.slice().sort().join('|');

export function preflightTypedOneShot(env,req,changes){
  if(env?.GITHUB_ACTIONS!=='true'||env.GITHUB_EVENT_NAME!=='push'||
     env.GITHUB_REF!==EXPECTED_BRANCH||env.GITHUB_REPOSITORY!==REPO||
     !/^[a-f0-9]{40}$/i.test(env.GITHUB_SHA||''))
    throw Error('TYPED_ACTION_SCOPE_DENIED');
  if(changes.trim()!=='A\t'+TYPED_REQUEST)
    throw Error('TYPED_NOT_EXCLUSIVE_REQUEST_ADDITION');
  if(!exactKeys(req,['request_id','approval','public_report_url',
                      'report_code','fight_id','max_graphql']))
    throw Error('TYPED_REQUEST_FIELDS_INVALID');
  if(req.request_id!=='FRESH216_ONE_QUERY_TYPED_ROSTER_20261027'||
     req.approval!==TYPED_APPROVAL||
     req.public_report_url!==REPORT_URL||
     req.report_code!==IDENTITY_TARGET.reportCode||
     req.fight_id!==IDENTITY_TARGET.fightId||
     req.max_graphql!==1)
    throw Error('TYPED_OWNER_SCOPE_INVALID');
  for(const name of ['GITHUB_TOKEN','WCL_CLIENT_ID','WCL_CLIENT_SECRET'])
    if(typeof env[name]!=='string'||env[name].length===0)
      throw Error('TYPED_REQUIRED_SECRET_MISSING');
  return buildOneShotTypedRosterQuery();
}
export async function runTypedOneShot({
  env=process.env,request,changedFiles,fetchImpl=fetch,
  log=()=>{},clock=Date.now
}={}){
  const query=preflightTypedOneShot(env,request,changedFiles);
  const headers={
    Authorization:'Bearer '+env.GITHUB_TOKEN,
    Accept:'application/vnd.github+json',
    'X-GitHub-Api-Version':'2022-11-28',
    'Content-Type':'application/json'
  };
  let reserve;
  try{
    reserve=await fetchImpl(REF_ENDPOINT,{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
      headers,body:JSON.stringify({ref:TYPED_ONCE_REF,sha:env.GITHUB_SHA})
    });
  }catch{throw Error('TYPED_RESERVATION_OUTCOME_UNKNOWN_NO_RETRY');}
  if(reserve?.status===422)
    return {status:'TYPED_ALREADY_CONSUMED',attemptedGraphql:0};
  if(reserve?.status!==201)throw Error('TYPED_RESERVATION_DENIED');
  // Every post-reservation failure irrevocably consumes this allowance.
  let tokenResponse;
  const basic=Buffer.from(env.WCL_CLIENT_ID+':'+env.WCL_CLIENT_SECRET)
    .toString('base64');
  try{
    tokenResponse=await fetchImpl(TOKEN_ENDPOINT,{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(25000),
      headers:{
        Authorization:'Basic '+basic,
        'Content-Type':'application/x-www-form-urlencoded'
      },
      body:'grant_type=client_credentials'
    });
  }catch{throw Error('TYPED_OAUTH_OUTCOME_UNKNOWN_NO_RETRY');}
  if(tokenResponse?.status!==200)throw Error('TYPED_OAUTH_FAILED');
  const token=await tokenResponse.json().catch(()=>null);
  if(typeof token?.access_token!=='string'||token.access_token.length===0)
    throw Error('TYPED_OAUTH_TOKEN_INVALID');
  const start=clock();
  let response;
  try{
    response=await fetchImpl(GRAPHQL_ENDPOINT,{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(45000),
      headers:{
        Authorization:'Bearer '+token.access_token,
        'Content-Type':'application/json'
      },body:JSON.stringify(query)
    });
  }catch{throw Error('TYPED_GRAPHQL_OUTCOME_UNKNOWN_NO_RETRY');}
  const elapsedMs=Math.max(0,clock()-start);
  const body=await response.json().catch(()=>null);
  const result=summarizeOneShotTypedRoster({
    httpStatus:response.status,body,elapsedMs
  });
  log(result);
  return result;
}
if(process.argv[1]?.endsWith('/run-actions-wcl-typed-roster-once.mjs')){
  try{
    const diff=execFileSync('git',[
      'diff-tree','--no-commit-id','--name-status','-r',process.env.GITHUB_SHA
    ],{encoding:'utf8',timeout:10000});
    if(diff.trim()!=='A\t'+TYPED_REQUEST){
      process.stdout.write('TYPED_NOT_ADD_ONLY_REQUEST_NO_HTTP\n');
    }else{
      const request=JSON.parse(fs.readFileSync(TYPED_REQUEST,'utf8'));
      const result=await runTypedOneShot({
        env:process.env,request,changedFiles:diff,
        log:r=>process.stdout.write('REDACTED_TYPED_ROSTER_WITNESS '+
          JSON.stringify(r)+'\n')
      });
      if(result.status==='TYPED_ALREADY_CONSUMED')process.exitCode=2;
      else if(result.status==='NEEDS_REVIEW')process.exitCode=3;
    }
  }catch(e){
    const message=String(e?.message||'');
    process.stderr.write(
      (/^TYPED_[A-Z0-9_]+$/.test(message)?message:'TYPED_EXECUTION_ABORTED')+
      '\n');
    process.exitCode=1;
  }
}
