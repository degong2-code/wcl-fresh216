#!/usr/bin/env node
/**
 * Owner-approved ONE WCL GraphQL POST, fixed Heroic Nek'zali + first 8
 * class/spec aliases, 2026-10-22..27 KST, latest/default partition.
 * Public Actions logs contain ONLY source-shape/count/cost summary.
 * This is a calibration probe, NOT a durable source collector.
 */
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {Buffer} from 'node:buffer';
import {
  makeFreshDatedHeroicManifest,planFreshCohortBatches,
  buildFreshCohortQuery,decodeFreshCohortBatch
} from '../src/core/fresh-cohort-source.mjs';

export const REQUEST_PATH='experiments/approved-fresh216-oct22-27-nekzali-8alias-pilot.json';
export const REQUEST_ID='FRESH216_OCT22_27_NEKZALI_8_ALIAS_SOURCE_PILOT_20261028';
export const APPROVAL='OWNER_APPROVED_20261028_WCL_FRESH216_OCT22_27_CALIBRATION';
export const ONCE_REF='refs/heads/wcl-fresh216-oct22-27-nekzali-8alias-pilot-consumed';
const REPO='degong2-code/wcl-fresh216';
const BRANCH='refs/heads/work/collector-architecture';
const REFS='https://api.github.com/repos/'+REPO+'/git/refs';
const TOKEN='https://www.warcraftlogs.com/oauth/token';
const API='https://www.warcraftlogs.com/api/v2/client';
const OWN_SCOPE='heroic:2026-10-22_27:latest:source';
const manifest=makeFreshDatedHeroicManifest(OWN_SCOPE);
const batch=planFreshCohortBatches(manifest,{jobsPerRequest:8}).batches[0];
const fields=['request_id','approval','date_start_kst','date_end_kst',
 'filter','partition_mode','difficulty','encounter_id','batch_index',
 'total_dps_pages','max_graphql','raw_rows_publication'];
const errorCode=e=>/^FRESH_PILOT_[A-Z0-9_]+$/.test(e?.message||'')?
  e.message:'FRESH_PILOT_EXECUTION_ABORTED';
export function verifyFreshPilotRequest(req,changedFiles,env){
  if(env?.GITHUB_ACTIONS!=='true'||env?.GITHUB_EVENT_NAME!=='push'||
    env?.GITHUB_REF!==BRANCH||env?.GITHUB_REPOSITORY!==REPO||
    !/^[0-9a-f]{40}$/i.test(env?.GITHUB_SHA??''))
    throw Error('FRESH_PILOT_ACTION_SCOPE_DENIED');
  if(changedFiles.trim()!=='A\t'+REQUEST_PATH)
    throw Error('FRESH_PILOT_NOT_EXCLUSIVE_ADDITION');
  if(!req||typeof req!=='object'||Array.isArray(req)||
    Object.keys(req).sort().join('|')!==fields.slice().sort().join('|')||
    req.request_id!==REQUEST_ID||req.approval!==APPROVAL||
    req.date_start_kst!=='2026-10-22'||
    req.date_end_kst!=='2026-10-27'||
    req.filter!=='date.1792594800000.1793113200000'||
    req.partition_mode!=='LATEST_DEFAULT'||
    req.difficulty!==4||req.encounter_id!==3470||
    req.batch_index!==0||req.max_graphql!==1||
    req.raw_rows_publication!=='FORBIDDEN'||
    JSON.stringify(req.total_dps_pages)!=='[1]')
    throw Error('FRESH_PILOT_REQUEST_INVALID');
  for(const k of ['GITHUB_TOKEN','WCL_CLIENT_ID','WCL_CLIENT_SECRET'])
    if(typeof env?.[k]!=='string'||!env[k])
      throw Error('FRESH_PILOT_SECRET_UNAVAILABLE');
  return buildFreshCohortQuery(batch);
}
export async function runFreshPilot({
  env=process.env,req,changedFiles,fetchImpl=fetch,clock=Date.now,
  log=()=>{}
}={}){
  const query=verifyFreshPilotRequest(req,changedFiles,env);
  const ghHeaders={
    Authorization:'Bearer '+env.GITHUB_TOKEN,
    Accept:'application/vnd.github+json',
    'Content-Type':'application/json',
    'X-GitHub-Api-Version':'2022-11-28'};
  let reserve;
  try{
    reserve=await fetchImpl(REFS,{method:'POST',headers:ghHeaders,
      redirect:'error',signal:AbortSignal.timeout(15000),
      body:JSON.stringify({ref:ONCE_REF,sha:env.GITHUB_SHA})});
  }catch{throw Error('FRESH_PILOT_RESERVATION_UNCERTAIN_NO_RETRY');}
  if(reserve?.status===422)return {status:'ALREADY_CONSUMED',wclCalls:0};
  if(reserve?.status!==201)
    throw Error('FRESH_PILOT_REF_RESERVATION_DENIED');
  // The once-only marker is durable BEFORE OAuth/paid WCL requests.
  const authBasic=Buffer.from(env.WCL_CLIENT_ID+':'+env.WCL_CLIENT_SECRET).toString('base64');
  let oauth;
  try{
    oauth=await fetchImpl(TOKEN,{method:'POST',redirect:'error',
      signal:AbortSignal.timeout(25000),
      headers:{Authorization:'Basic '+authBasic,
        'Content-Type':'application/x-www-form-urlencoded'},
      body:'grant_type=client_credentials'});
  }catch{throw Error('FRESH_PILOT_OAUTH_UNCERTAIN_NO_RETRY');}
  if(oauth?.status!==200)throw Error('FRESH_PILOT_OAUTH_DENIED');
  const token=await oauth.json().catch(()=>null);
  if(typeof token?.access_token!=='string'||!token.access_token)
    throw Error('FRESH_PILOT_OAUTH_INVALID');

  const begun=clock();
  let response;
  try{
    response=await fetchImpl(API,{method:'POST',redirect:'error',
      signal:AbortSignal.timeout(60000),
      headers:{Authorization:'Bearer '+token.access_token,
        'Content-Type':'application/json'},
      body:JSON.stringify(query)});
  }catch{throw Error('FRESH_PILOT_WCL_UNCERTAIN_NO_RETRY');}
  const raw=await response.json().catch(()=>null);
  const elapsed=Math.max(0,clock()-begun);
  const decoded=decodeFreshCohortBatch(batch,response.status,raw);
  // Counts/alias scope only. NO characters, names, report codes, fights,
  // actor IDs, full WCL responses, OAuth or private checkpoint persisted.
  const encounter=raw?.data?.worldData?.encounter;
  const aliases=batch.jobs.map((j,i)=>({
    specialization:j.className+'/'+j.specName,
    rows:Array.isArray(encounter?.['t'+i]?.rankings)?
      encounter['t'+i].rankings.length:null
  }));
  const final={
    status:decoded.status==='OK'?'COMPLETE_8_OF_8':'NEEDS_REVIEW',
    reason:decoded.status==='OK'?null:decoded.status,
    windowKst:'2026-10-22..2026-10-27',
    partitionMode:'LATEST_DEFAULT',encounterId:3470,
    difficulty:4,graphqlRequests:1,
    totalJobsChecked:8,
    completeJobs:decoded.status==='OK'?8:0,
    rawSourcePersisted:false,
    observedPoints:decoded.points,elapsedMs:elapsed,
    aliases,
    rawRowsPublished:false,oauthPublished:false,sheetsWrites:0
  };
  log(final);
  return final;
}
export async function main(){
  try{
    const changed=execFileSync('git',['diff-tree','--no-commit-id',
      '--name-status','-r',process.env.GITHUB_SHA],
      {encoding:'utf8',timeout:10000});
    if(changed.trim()!=='A\t'+REQUEST_PATH){
      process.stdout.write('FRESH_PILOT_NO_EXCLUSIVE_ADDITION_NO_WCL\n');
      return;
    }
    const req=JSON.parse(fs.readFileSync(REQUEST_PATH,'utf8'));
    const result=await runFreshPilot({req,changedFiles:changed,
      log:final=>process.stdout.write('REDACTED_FRESH_COHORT_PILOT '+
        JSON.stringify(final)+'\n')});
    if(result.status==='ALREADY_CONSUMED')process.exitCode=2;
    else if(result.status!=='COMPLETE_8_OF_8')process.exitCode=3;
  }catch(e){
    process.stderr.write(errorCode(e)+'\n');process.exitCode=1;
  }
}
if(process.argv[1]?.endsWith('/run-actions-fresh-cohort-pilot.mjs'))
  await main();
