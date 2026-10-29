#!/usr/bin/env node
/**
 * Single-use GitHub Actions relay, NEVER WCL access.
 * The existing offline CI runs first. A dedicated request-file ADDITION
 * as the ONLY changed file in one isolated-branch push permits exactly ONE
 * GitHub workflow_dispatch, subject to the paid workflow's separate,
 * atomic, irreversible consumed-ref guard.
 *
 * The relay has Actions:write and Contents:read only; NO WCL Secrets.
 * Does not retry ambiguous HTTP outcomes or auto-dispatch on ordinary pushes.
 */
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';

export const REQUEST='experiments/wcl-one-time-public-report-20261027.json';
const REPO='degong2-code/wcl-fresh216';
const BRANCH='refs/heads/work/collector-architecture';
const ID='FRESH216_CURRENT_PUBLIC_REPORT_20261027_ONCE';
const EXPERIMENT='wcl-two-query-probe.yml';
const GITHUB='https://api.github.com/repos/'+REPO;
const MARKER=GITHUB+'/git/ref/heads/wcl-fresh216-one-time-probe-consumed-20261027';
const DISPATCH=GITHUB+'/actions/workflows/'+EXPERIMENT+'/dispatches';

const keysMatch=(obj,keys)=>
  !!obj&&typeof obj==='object'&&!Array.isArray(obj)&&
  Object.keys(obj).sort().join('|')===keys.slice().sort().join('|');

export function validateRelayRequest(request,env,changedFiles) {
  if(env?.GITHUB_ACTIONS!=='true'||env.GITHUB_EVENT_NAME!=='push'||
     env.GITHUB_REF!==BRANCH||env.GITHUB_REPOSITORY!==REPO||
     !/^[a-f0-9]{40}$/i.test(env.GITHUB_SHA||''))
    throw Error('RELAY_PUSH_SCOPE_DENIED');
  // Crucial: the request file must be ADDED as the entire commit.
  // Re-running CI on code edits, re-adding in a mixed commit, or modifying
  // the file cannot unlock a paid workflow run.
  if(changedFiles.trim()!=='A\t'+REQUEST)
    throw Error('RELAY_NOT_EXACT_SINGLE_REQUEST_ADDITION');
  if(!keysMatch(request,['request_id','approval','public_report_url','report_code','fight_id']))
    throw Error('RELAY_REQUEST_SHAPE_INVALID');
  if(request.request_id!==ID||
     request.approval!=='OWNER_APPROVED_20261027_MAX_TWO'||
     typeof request.report_code!=='string'||
     !/^[A-Za-z0-9]{16}$/.test(request.report_code)||
     !Number.isSafeInteger(request.fight_id)||request.fight_id<=0)
    throw Error('RELAY_REQUEST_SCOPE_INVALID');
  let url;
  try{url=new URL(request.public_report_url);}
  catch{throw Error('RELAY_PUBLIC_URL_INVALID');}
  const allowed=['www.warcraftlogs.com','ko.warcraftlogs.com','fresh.warcraftlogs.com'];
  const fight=url.searchParams.get('fight')||
    new URLSearchParams(url.hash.replace(/^#/,'')).get('fight');
  if(url.protocol!=='https:'||!allowed.includes(url.hostname)||
     url.username||url.password||url.port||
     url.pathname!=='/reports/'+request.report_code||
     !/^[0-9]+$/.test(fight||'')||Number(fight)!==request.fight_id)
    throw Error('RELAY_PUBLIC_URL_INVALID');
  return {
    ref:'main',
    inputs:{
      public_report_url:request.public_report_url,
      report_code:request.report_code,
      fight_id:String(request.fight_id)
    }
  };
}

export async function dispatchApprovedWclOnce({
  env=process.env,request,changedFiles,fetchImpl=fetch
}={}) {
  const payload=validateRelayRequest(request,env,changedFiles);
  if(typeof env.GITHUB_TOKEN!=='string'||env.GITHUB_TOKEN.length<8)
    throw Error('RELAY_GITHUB_TOKEN_MISSING');
  const headers={
    Authorization:'Bearer '+env.GITHUB_TOKEN,
    Accept:'application/vnd.github+json',
    'X-GitHub-Api-Version':'2022-11-28'
  };
  // Check marker without revealing anything about WCL credentials.
  // Paid workflow ALSO checks via atomic ref creation before OAuth/GraphQL.
  let marker;
  try{marker=await fetchImpl(MARKER,{
    method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(10000)
  });}
  catch{throw Error('RELAY_MARKER_STATUS_UNKNOWN_NO_DISPATCH');}
  if(marker.status===200)return {status:'PAID_PROBE_ALREADY_CONSUMED',dispatchRequests:0};
  if(marker.status!==404)throw Error('RELAY_MARKER_STATUS_UNKNOWN_NO_DISPATCH');

  let response;
  try{
    response=await fetchImpl(DISPATCH,{
      method:'POST',headers:{...headers,'Content-Type':'application/json'},
      redirect:'error',signal:AbortSignal.timeout(15000),
      body:JSON.stringify({...payload,return_run_details:true})
    });
  }catch{throw Error('RELAY_DISPATCH_OUTCOME_UNKNOWN_NO_RETRY');}
  if(response.status!==204&&response.status!==200)
    throw Error('RELAY_GITHUB_DISPATCH_REJECTED_HTTP_'+response.status);
  let runId=null;
  if(response.status===200){
    const body=await response.json().catch(()=>null);
    const possible=body?.workflow_run_id??body?.run_id??body?.workflow_run?.id;
    if(Number.isSafeInteger(possible)&&possible>0)runId=possible;
  }
  return {status:'GITHUB_DISPATCH_ACCEPTED_NOT_WCL_EXECUTION',
    dispatchRequests:1,runId,paidGraphqlRequestsVerified:0};
}

if(process.argv[1]?.endsWith('/dispatch-approved-wcl-once.mjs')){
  try{
    const changes=execFileSync('git',[
      'diff-tree','--no-commit-id','--name-status','-r',process.env.GITHUB_SHA
    ],{encoding:'utf8',timeout:10000});
    if(changes.trim()!=='A\t'+REQUEST){
      process.stdout.write('RELAY_NOT_A_REQUEST_ADDITION_NO_DISPATCH\n');
    }else{
      const request=JSON.parse(fs.readFileSync(REQUEST,'utf8'));
      const result=await dispatchApprovedWclOnce({
        env:process.env,request,changedFiles:changes
      });
      // Never emit URL, report code, token, private actor data or WCL Secrets.
      process.stdout.write('RELAY_RESULT '+JSON.stringify(result)+'\n');
    }
  }catch(e){
    const m=String(e?.message??'');
    const safe=/^RELAY_[A-Z0-9_]+$/.test(m)?m:'RELAY_EXECUTION_ABORTED';
    process.stderr.write(safe+'\n');
    process.exitCode=1;
  }
}
