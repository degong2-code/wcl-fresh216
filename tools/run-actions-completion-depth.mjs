#!/usr/bin/env node
import {Buffer} from 'node:buffer';
import {
  COMPLETE_REQUEST,COMPLETE_ONCE_REF,COMPLETE_CORRECTION_REQUEST,
  COMPLETE_CORRECTION_ONCE_REF,COMPLETE_CORRECTION2_REQUEST,
  COMPLETE_CORRECTION2_ONCE_REF,COMPLETE_TARGET,validateCompletionRequest,
  buildRankingBatchQuery,createRankingState,initCompletionState,applyRankingBatch,
  rankingProgress,unresolvedFightGroups,buildReportBatchQuery,applyReportBatch,
  finalCompletionSummary
} from '../src/core/approved-completion-depth-trial.mjs';

const REPO='degong2-code/wcl-fresh216';
const BRANCH='refs/heads/work/collector-architecture';
const REFS='https://api.github.com/repos/'+REPO+'/git/refs';
const TOKEN='https://www.warcraftlogs.com/oauth/token';
const API='https://www.warcraftlogs.com/api/v2/client';
const safeCode=e=>/^COMPLETE_[A-Z0-9_]+$/.test(String(e?.message||''))?
  String(e.message):'COMPLETE_EXECUTION_ABORTED';

export function preflightCompletion(env,request,changedFiles){
  if(env?.GITHUB_ACTIONS!=='true'||env?.GITHUB_EVENT_NAME!=='push'||
     env?.GITHUB_REF!==BRANCH||env?.GITHUB_REPOSITORY!==REPO||
     !/^[a-f0-9]{40}$/i.test(env?.GITHUB_SHA||''))
    throw Error('COMPLETE_ACTION_SCOPE_DENIED');
  const diff=changedFiles.trim();
  const correction=diff==='A\t'+COMPLETE_CORRECTION2_REQUEST?2:
    diff==='A\t'+COMPLETE_CORRECTION_REQUEST?1:0;
  if(diff!=='A\t'+COMPLETE_REQUEST&&correction===0)
    throw Error('COMPLETE_NOT_EXCLUSIVE_REQUEST_ADDITION');
  validateCompletionRequest(request,{correction});
  for(const k of ['GITHUB_TOKEN','WCL_CLIENT_ID','WCL_CLIENT_SECRET'])
    if(typeof env?.[k]!=='string'||!env[k])throw Error('COMPLETE_REQUIRED_SECRET_MISSING');
  return {
    onceRef:correction===2?COMPLETE_CORRECTION2_ONCE_REF:
      correction===1?COMPLETE_CORRECTION_ONCE_REF:COMPLETE_ONCE_REF,
    requestPath:correction===2?COMPLETE_CORRECTION2_REQUEST:
      correction===1?COMPLETE_CORRECTION_REQUEST:COMPLETE_REQUEST
  };
}
const json=async r=>r?.json?await r.json().catch(()=>null):null;
const wclPost=async(fetchImpl,token,query,variables,clock)=>{
  const started=clock();let res;
  try{res=await fetchImpl(API,{method:'POST',redirect:'error',
    signal:AbortSignal.timeout(90000),
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({query,variables})});}
  catch{throw Error('COMPLETE_GRAPHQL_UNCERTAIN_NO_RETRY');}
  const body=await json(res),elapsedMs=Math.max(0,clock()-started);
  if(res?.status!==200||!body||Array.isArray(body.errors)&&body.errors.length)
    throw Error('COMPLETE_GRAPHQL_HTTP_OR_SCHEMA');
  return {body,elapsedMs,httpStatus:res.status};
};
export async function runCompletionExperiment({
 env=process.env,request,changedFiles,fetchImpl=fetch,clock=Date.now,log=()=>{}
}={}){
  const admitted=preflightCompletion(env,request,changedFiles);
  const ghHeaders={Authorization:'Bearer '+env.GITHUB_TOKEN,
    Accept:'application/vnd.github+json','Content-Type':'application/json',
    'X-GitHub-Api-Version':'2022-11-28'};
  let reserve;
  try{reserve=await fetchImpl(REFS,{method:'POST',headers:ghHeaders,redirect:'error',
    signal:AbortSignal.timeout(15000),
    body:JSON.stringify({ref:admitted.onceRef,sha:env.GITHUB_SHA})});}
  catch{throw Error('COMPLETE_RESERVATION_UNCERTAIN_NO_RETRY');}
  if(reserve?.status===422)return {status:'ALREADY_CONSUMED',graphqlRequests:0};
  if(reserve?.status!==201)throw Error('COMPLETE_RESERVATION_DENIED');
  const basic=Buffer.from(env.WCL_CLIENT_ID+':'+env.WCL_CLIENT_SECRET).toString('base64');
  let authRes;
  try{authRes=await fetchImpl(TOKEN,{method:'POST',redirect:'error',
    signal:AbortSignal.timeout(25000),
    headers:{Authorization:'Basic '+basic,'Content-Type':'application/x-www-form-urlencoded'},
    body:'grant_type=client_credentials'});}
  catch{throw Error('COMPLETE_OAUTH_UNCERTAIN_NO_RETRY');}
  if(authRes?.status!==200)throw Error('COMPLETE_OAUTH_FAILED');
  const auth=await json(authRes);
  if(typeof auth?.access_token!=='string'||!auth.access_token)
    throw Error('COMPLETE_OAUTH_TOKEN_INVALID');
  const token=auth.access_token;
  let graphqlRequests=0,pointTotal=0,pointComplete=true,elapsedTotal=0;
  const addCost=observed=>{
    if(typeof observed?.total==='number')pointTotal+=observed.total;else pointComplete=false;
  };
  const specs=[];
  for(const spec of COMPLETE_TARGET.specs){
    const firstQ=buildRankingBatchQuery(spec,1,{includeTotal:true});
    const first=await wclPost(fetchImpl,token,firstQ.query,firstQ.variables,clock);
    graphqlRequests++;elapsedTotal+=first.elapsedMs;
    const decoded=createRankingState(spec,first.body,1,{includeTotal:true});addCost(decoded.observed);
    const state=initCompletionState(spec,decoded.overall);
    let progress=applyRankingBatch(state,decoded.pages);
    log({kind:'RANK_BATCH',specialization:spec.key,fromPage:1,toPage:state.lastPage,
      gains:state.pageYields.slice(),sizes:state.pageSizes.slice(),progress});
    while(!progress.rankingDone){
      const next=state.lastPage+1,q=buildRankingBatchQuery(spec,next);
      const res=await wclPost(fetchImpl,token,q.query,q.variables,clock);
      graphqlRequests++;elapsedTotal+=res.elapsedMs;
      const dec=createRankingState(spec,res.body,next);addCost(dec.observed);
      const prior=state.pageYields.length;
      progress=applyRankingBatch(state,dec.pages);
      log({kind:'RANK_BATCH',specialization:spec.key,fromPage:next,toPage:state.lastPage,
        gains:state.pageYields.slice(prior),sizes:state.pageSizes.slice(prior),progress});
    }
    const rankingSummary=finalCompletionSummary(state);
    const groups=unresolvedFightGroups(state);
    let reportRequests=0,reportFights=0,namedReportRecovered=0,anonymousReportRecovered=0;
    for(let i=0;i<groups.length;i+=COMPLETE_TARGET.reportAliasCap){
      const batch=groups.slice(i,i+COMPLETE_TARGET.reportAliasCap);
      const q=buildReportBatchQuery(batch);
      const res=await wclPost(fetchImpl,token,q.query,q.variables,clock);
      graphqlRequests++;reportRequests++;reportFights+=batch.length;elapsedTotal+=res.elapsedMs;
      const applied=applyReportBatch(state,batch,res.body);addCost(applied.observed);
      namedReportRecovered+=applied.namedRecovered;
      anonymousReportRecovered+=applied.anonymousRecovered;
      log({kind:'REPORT_BATCH',specialization:spec.key,fights:batch.length,
        namedRecovered:applied.namedRecovered,anonymousRecovered:applied.anonymousRecovered,
        remaining:100-state.values.filter(v=>v!==null).length});
    }
    const final=finalCompletionSummary(state);
    specs.push({specialization:spec.key,
      rankingPagesFetched:state.lastPage,rankingMaxRank:state.lastPage*100,
      leaderboardEnded:state.leaderboardEnded,pageYields:state.pageYields,
      pageSizes:state.pageSizes,rankingResolved:rankingSummary.finalResolved,
      rankingNamedResolved:rankingSummary.namedResolved,
      rankingAnonymousTotal:rankingSummary.anonymousTotal,
      reportRequests,reportFights,namedReportRecovered,anonymousReportRecovered,
      finalResolved:final.finalResolved,finalComplete:final.finalComplete,
      unresolvedNamed:final.unresolvedNamed,unresolvedAnonymous:final.unresolvedAnonymous,
      conflicts:{ambiguous:final.ambiguous,time:final.timeConflict,implausible:final.implausible}});
    log({kind:'SPEC_FINAL',summary:specs.at(-1)});
  }
  const final={status:specs.every(s=>s.finalComplete)?'COMPLETE_300_OF_300':'PARTIAL',
    graphqlRequests,specializations:specs,
    finalResolved:specs.reduce((a,s)=>a+s.finalResolved,0),
    finalCompleteSpecs:specs.filter(s=>s.finalComplete).length,
    reportedPointTotalSum:pointComplete?Number(pointTotal.toFixed(6)):null,
    requestElapsedMsSum:elapsedTotal,rawRowsPublished:false,sheetsWrites:0};
  log({kind:'FINAL',summary:final});
  return final;
}
export async function main(){
  const fs=await import('node:fs');
  const {execFileSync}=await import('node:child_process');
  try{
    const diff=execFileSync('git',['diff-tree','--no-commit-id','--name-status',
      '-r',process.env.GITHUB_SHA],{encoding:'utf8',timeout:10000});
    const normalized=diff.trim();
    const requestPath=normalized==='A\t'+COMPLETE_REQUEST?COMPLETE_REQUEST:
      normalized==='A\t'+COMPLETE_CORRECTION_REQUEST?COMPLETE_CORRECTION_REQUEST:
      normalized==='A\t'+COMPLETE_CORRECTION2_REQUEST?COMPLETE_CORRECTION2_REQUEST:null;
    if(!requestPath){
      process.stdout.write('COMPLETE_NOT_REQUEST_ADDITION_NO_HTTP\n');return;
    }
    const request=JSON.parse(fs.readFileSync(requestPath,'utf8'));
    const r=await runCompletionExperiment({env:process.env,request,changedFiles:diff,
      log:v=>process.stdout.write('REDACTED_COMPLETION_DEPTH '+JSON.stringify(v)+'\n')});
    if(r.status==='ALREADY_CONSUMED')process.exitCode=2;
    else if(r.status!=='COMPLETE_300_OF_300')process.exitCode=3;
  }catch(e){process.stderr.write(safeCode(e)+'\n');process.exitCode=1;}
}
if(process.argv[1]?.endsWith('/run-actions-completion-depth.mjs'))await main();
