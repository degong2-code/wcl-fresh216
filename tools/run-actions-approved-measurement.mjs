#!/usr/bin/env node
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {Buffer} from 'node:buffer';
import {
  MEASUREMENT_REQUEST,MEASUREMENT_ID,MEASUREMENT_APPROVAL,
  MEASUREMENT_ONCE_REF,MEASUREMENT_TARGET,
  buildRankingDepthQuery,summarizeRankingDepth
} from '../src/core/approved-ranking-depth-trial.mjs';
import {
  DATED_REQUEST,DATED_ONCE_REF,DATED_TARGET,
  validateDatedRequest,buildDatedDepthQuery,summarizeDatedDepth
} from '../src/core/approved-ranking-depth-date1000-trial.mjs';
import {
  LATEST_REQUEST,LATEST_ONCE_REF,LATEST_TARGET,
  validateLatestRequest,buildLatestDepthQuery,summarizeLatestDepth
} from '../src/core/approved-ranking-depth-date1000-latest-partition.mjs';

const REPO='degong2-code/wcl-fresh216';
const BRANCH='refs/heads/work/collector-architecture';
const REFS='https://api.github.com/repos/'+REPO+'/git/refs';
const TOKEN='https://www.warcraftlogs.com/oauth/token';
const API='https://www.warcraftlogs.com/api/v2/client';
const exactKeys=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&
  Object.keys(o).sort().join('|')===keys.slice().sort().join('|');

const experimentForChange=(changedFiles)=>{
  const diff=changedFiles.trim();
  if(diff==='A\t'+MEASUREMENT_REQUEST)return {
    requestPath:MEASUREMENT_REQUEST,onceRef:MEASUREMENT_ONCE_REF,target:MEASUREMENT_TARGET,
    validate:request=>{
      const fields=['request_id','approval','encounter_id','difficulty',
        'current_global','specs','total_dps_pages','boss_dps_pages','max_graphql'];
      if(!request||typeof request!=='object'||Array.isArray(request)||
         Object.keys(request).sort().join('|')!==fields.slice().sort().join('|'))
        throw Error('MEASUREMENT_REQUEST_FIELDS_INVALID');
      if(request.request_id!==MEASUREMENT_ID||request.approval!==MEASUREMENT_APPROVAL||
         request.encounter_id!==3470||request.difficulty!==4||
         request.current_global!==true||request.max_graphql!==3||
         JSON.stringify(request.specs)!==JSON.stringify(MEASUREMENT_TARGET.specs.map(s=>s.key))||
         JSON.stringify(request.total_dps_pages)!=='[1]'||
         JSON.stringify(request.boss_dps_pages)!=='[1,2,3]')
        throw Error('MEASUREMENT_REQUEST_SCOPE_INVALID');
    },
    build:buildRankingDepthQuery,summarize:summarizeRankingDepth
  };
  if(diff==='A\t'+DATED_REQUEST)return {
    requestPath:DATED_REQUEST,onceRef:DATED_ONCE_REF,target:DATED_TARGET,
    validate:validateDatedRequest,build:buildDatedDepthQuery,summarize:summarizeDatedDepth
  };
  if(diff==='A\t'+LATEST_REQUEST)return {
    requestPath:LATEST_REQUEST,onceRef:LATEST_ONCE_REF,target:LATEST_TARGET,
    validate:validateLatestRequest,build:buildLatestDepthQuery,summarize:summarizeLatestDepth
  };
  throw Error('MEASUREMENT_NOT_EXCLUSIVE_REQUEST_ADDITION');
};
export function preflightApprovedMeasurement(env,request,changedFiles){
  if(env?.GITHUB_ACTIONS!=='true'||env?.GITHUB_EVENT_NAME!=='push'||
     env?.GITHUB_REF!==BRANCH||env?.GITHUB_REPOSITORY!==REPO||
     !/^[a-f0-9]{40}$/i.test(env?.GITHUB_SHA||''))
    throw Error('MEASUREMENT_ACTION_SCOPE_DENIED');
  const experiment=experimentForChange(changedFiles);
  experiment.validate(request);
  for(const k of ['GITHUB_TOKEN','WCL_CLIENT_ID','WCL_CLIENT_SECRET'])
    if(typeof env?.[k]!=='string'||env[k].length===0)
      throw Error('MEASUREMENT_REQUIRED_SECRET_MISSING');
  const queries=experiment.target.specs.map(experiment.build);
  queries.experiment=experiment;
  return queries;
}
export async function runApprovedMeasurement({
  env=process.env,request,changedFiles,fetchImpl=fetch,clock=Date.now,log=()=>{}
}={}){
  const queries=preflightApprovedMeasurement(env,request,changedFiles);
  const experiment=queries.experiment;
  const headers={Authorization:'Bearer '+env.GITHUB_TOKEN,
    Accept:'application/vnd.github+json','Content-Type':'application/json',
    'X-GitHub-Api-Version':'2022-11-28'};
  let reserve;
  try{reserve=await fetchImpl(REFS,{method:'POST',headers,redirect:'error',
    signal:AbortSignal.timeout(15000),
    body:JSON.stringify({ref:experiment.onceRef,sha:env.GITHUB_SHA})});}
  catch{throw Error('MEASUREMENT_RESERVATION_UNCERTAIN_NO_RETRY');}
  if(reserve?.status===422)
    return {status:'MEASUREMENT_ALREADY_CONSUMED',graphqlRequests:0};
  if(reserve?.status!==201)throw Error('MEASUREMENT_RESERVATION_DENIED');
  const basic=Buffer.from(env.WCL_CLIENT_ID+':'+env.WCL_CLIENT_SECRET).toString('base64');
  let oauth;
  try{oauth=await fetchImpl(TOKEN,{method:'POST',redirect:'error',
    signal:AbortSignal.timeout(25000),
    headers:{Authorization:'Basic '+basic,
      'Content-Type':'application/x-www-form-urlencoded'},
    body:'grant_type=client_credentials'});}
  catch{throw Error('MEASUREMENT_OAUTH_UNCERTAIN_NO_RETRY');}
  if(oauth?.status!==200)throw Error('MEASUREMENT_OAUTH_FAILED');
  const auth=await oauth.json().catch(()=>null);
  if(typeof auth?.access_token!=='string'||!auth.access_token)
    throw Error('MEASUREMENT_OAUTH_TOKEN_INVALID');

  const summaries=[];
  for(let i=0;i<queries.length;i++){
    const q=queries[i],spec=experiment.target.specs[i],started=clock();
    let reply;
    try{reply=await fetchImpl(API,{method:'POST',redirect:'error',
      signal:AbortSignal.timeout(60000),
      headers:{Authorization:'Bearer '+auth.access_token,
        'Content-Type':'application/json'},body:JSON.stringify(q)});}
    catch{throw Error('MEASUREMENT_GRAPHQL_UNCERTAIN_NO_RETRY');}
    const body=await reply.json().catch(()=>null);
    const elapsed=Math.max(0,clock()-started);
    const summary=experiment.summarize(spec,{httpStatus:reply.status,body,elapsedMs:elapsed});
    summaries.push(summary);log({kind:'SPEC',summary});
    if(summary.status==='NEEDS_REVIEW'&&summary.reason==='HTTP_OR_GRAPHQL_INVALID')
      break;
    if(summary.reportedPointTotal===null)
      break;
  }
  const completed=summaries.length;
  const totalRows=summaries.reduce((a,s)=>a+(s.totalRows||0),0);
  const pageCount=experiment.target.bossPages?.length??3;
  const pageMatches=Array.from({length:pageCount},(_,p)=>
    summaries.reduce((a,s)=>a+(s.directMatchesByPage?.[p]||0),0));
  const cumulative=pageMatches.map((_,i)=>pageMatches.slice(0,i+1).reduce((a,b)=>a+b,0));
  const final={
    status:completed===3&&summaries.every(s=>s.status==='RECORDED')?
      'RECORDED':'NEEDS_REVIEW',
    graphqlRequests:completed,specializationsCompleted:completed,
    totalRows,cumulativeMatches:cumulative,
    maxBossPage:pageCount,maxBossRank:pageCount*100,
    maxPageCoveragePct:totalRows?Number((100*cumulative.at(-1)/totalRows).toFixed(1)):null,
    unresolvedAfterMaxPage:summaries.reduce((a,s)=>a+
      (s.unresolvedAfterMaxPage??s.unresolvedAfter3??0),0),
    reportedPointTotalSum:summaries.every(s=>s.reportedPointTotal!==null)?
      summaries.reduce((a,s)=>a+s.reportedPointTotal,0):null,
    requestElapsedMsSum:summaries.reduce((a,s)=>a+(s.elapsedMs||0),0),
    scope:experiment.target.currentGlobal?'CURRENT_GLOBAL':'DATE_FILTERED',
    filter:experiment.target.filter??null,partition:experiment.target.partition??null,
    rawRankingRowsPublished:false,sheetsWrites:0
  };
  log({kind:'FINAL',summary:final});
  return final;
}
if(process.argv[1]?.endsWith('/run-actions-approved-measurement.mjs')){
  const fsMod=await import('node:fs');
  const {execFileSync:execDelegated}=await import('node:child_process');
  const diffDelegated=execDelegated('git',['diff-tree','--no-commit-id','--name-status',
    '-r',process.env.GITHUB_SHA],{encoding:'utf8',timeout:10000});
  if(
    diffDelegated.trim()==='A\texperiments/approved-nekzali-20261022-28-completion-depth.json' ||
    diffDelegated.trim()==='A\texperiments/approved-nekzali-20261022-28-completion-depth-page21-correction.json'
  ){
    const mod=await import('./run-actions-completion-depth.mjs');
    await mod.main();
  }else if(
    diffDelegated.trim()==='A\texperiments/approved-nekzali-page21-shape-probe.json'
  ){
    const mod=await import('./run-actions-page21-shape-probe.mjs');
    await mod.main();
  }else{

  try{
    const diff=execFileSync('git',['diff-tree','--no-commit-id','--name-status',
      '-r',process.env.GITHUB_SHA],{encoding:'utf8',timeout:10000});
    let experiment;
    try{experiment=experimentForChange(diff);}catch{
      process.stdout.write('MEASUREMENT_NOT_REQUEST_ADDITION_NO_HTTP\n');
      process.exit(0);
    }
    const request=JSON.parse(fs.readFileSync(experiment.requestPath,'utf8'));
    const result=await runApprovedMeasurement({env:process.env,request,
      changedFiles:diff,log:v=>process.stdout.write(
        'REDACTED_APPROVED_MEASUREMENT '+JSON.stringify(v)+'\n')});
    if(result.status==='MEASUREMENT_ALREADY_CONSUMED')process.exitCode=2;
    else if(result.status==='NEEDS_REVIEW')process.exitCode=3;
  }catch(e){
    const m=String(e?.message||'');
    process.stderr.write((/^MEASUREMENT_[A-Z0-9_]+$/.test(m)?m:
      'MEASUREMENT_EXECUTION_ABORTED')+'\n');
    process.exitCode=1;
  }
  }
}
