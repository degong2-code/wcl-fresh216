#!/usr/bin/env node
/**
 * Owner-approved, one-time GitHub Actions WCL probe.
 * This is NEVER imported/called by pull_request or push CI.
 *
 * No private fixture or token is embedded in the public repository or logs.
 * A GitHub ref create (atomic 201 / already-used 422) provides persistent
 * replay protection ACROSS ephemeral runners and rerun-job attempts.
 *
 * The GitHub token requires contents:write only to create ONE irreversible
 * marker branch ref. Neither a retry nor a second fixture is authorized.
 *
 * Repo Secrets: WCL_CLIENT_ID, WCL_CLIENT_SECRET, WCL_PROBE_FIXTURE_JSON.
 * WCL_PROBE_FIXTURE_JSON is the ORIGINAL rank slot's PRIVATE evidence, not
 * arbitrary placeholder inputs. The previous standalone local CLI remains
 * unchanged and refuses GitHub Actions.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Buffer} from 'node:buffer';
import {runPrivateTwoQueryProbe,validatePrivateProbeGroup}
  from '../src/core/private-two-query-probe.mjs';
import {runFreshTwoQueryProbe,buildFreshQueryPair}
  from '../src/core/fresh-two-query-probe.mjs';

const REPO='degong2-code/wcl-fresh216';
const ONCE_REF='refs/heads/wcl-fresh216-one-time-probe-consumed-20261027';
const WCL_GRAPHQL='https://www.warcraftlogs.com/api/v2/client';
const WCL_TOKEN='https://www.warcraftlogs.com/oauth/token';
const GH_REFS='https://api.github.com/repos/'+REPO+'/git/refs';

function requiredEnv(env,name){
  const value=env[name];
  if(typeof value!=='string'||value.length===0)throw Error('REQUIRED_'+name+'_MISSING');
  return value;
}
export function preflightActionsProbe(env){
  if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_EVENT_NAME!=='workflow_dispatch'||
     env.GITHUB_REF!=='refs/heads/main'||env.GITHUB_REPOSITORY!==REPO)
    throw Error('ACTIONS_DISPATCH_SCOPE_DENIED');
  if(env.WCL_PROBE_DISPATCH_PURPOSE!=='OWNER_APPROVED_20261027_MAX_TWO')
    throw Error('ACTIONS_DISPATCH_PURPOSE_DENIED');
  const fixture=JSON.parse(requiredEnv(env,'WCL_PROBE_FIXTURE_JSON'));
  const group=fixture.group??fixture;
  validatePrivateProbeGroup(group);
  requiredEnv(env,'WCL_CLIENT_ID');
  requiredEnv(env,'WCL_CLIENT_SECRET');
  requiredEnv(env,'GITHUB_TOKEN');
  if(!/^[a-f0-9]{40}$/i.test(requiredEnv(env,'GITHUB_SHA')))
    throw Error('GITHUB_SHA_INVALID');
  return group;
}
export async function reserveOneTimeAction({fetchImpl=fetch,env=process.env}={}){
  const response=await fetchImpl(GH_REFS,{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
    headers:{
      Authorization:'Bearer '+requiredEnv(env,'GITHUB_TOKEN'),
      Accept:'application/vnd.github+json',
      'Content-Type':'application/json',
      'X-GitHub-Api-Version':'2022-11-28'
    },
    body:JSON.stringify({ref:ONCE_REF,sha:env.GITHUB_SHA})
  });
  if(response?.status===201)return 'IRREVERSIBLE_RESERVATION_CREATED';
  if(response?.status===422)return 'ONE_TIME_PROBE_ALREADY_RESERVED';
  throw Error('GITHUB_ATOMIC_SPEND_RESERVATION_FAILED');
}
async function tokenFor(env,fetchImpl){
  const auth=Buffer.from(env.WCL_CLIENT_ID+':'+env.WCL_CLIENT_SECRET,'utf8')
    .toString('base64');
  let res;
  try{
    res=await fetchImpl(WCL_TOKEN,{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(25000),
      headers:{
        Authorization:'Basic '+auth,
        'Content-Type':'application/x-www-form-urlencoded'
      },body:'grant_type=client_credentials'
    });
  }catch(_e){throw Error('OAUTH_TOKEN_EXCHANGE_UNCERTAIN');}
  if(res?.status!==200)throw Error('OAUTH_TOKEN_EXCHANGE_FAILED');
  const data=await res.json().catch(()=>null);
  if(typeof data?.access_token!=='string'||!data.access_token)
    throw Error('OAUTH_TOKEN_MISSING');
  return data.access_token;
}
const transport=(token,fetchImpl)=>async query=>{
  const res=await fetchImpl(WCL_GRAPHQL,{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(45000),
    headers:{
      Authorization:'Bearer '+token,
      'Content-Type':'application/json'
    },
    body:JSON.stringify(query)
  });
  return {
    httpStatus:res.status,
    body:await res.json().catch(()=>null)
  };
};

export async function runActionsWclProbe({
  env=process.env,fetchImpl=fetch,
  // Injection is allowed only for offline synthetic tests. Live caller
  // supplies no alternate transport or existing private root.
  log=()=>{}
}={}){
  // Parse/validate all inputs BEFORE any reservation/token exchange.
  const group=preflightActionsProbe(env);
  const marker=await reserveOneTimeAction({fetchImpl,env});
  if(marker!=='IRREVERSIBLE_RESERVATION_CREATED')return {
    status:marker,graphqlRequests:0,reservationConsumed:false
  };
  // From here the one-time allowance stays consumed even if auth fails.
  // Never remove the GitHub ref automatically.
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'wcl-actions-private-'));
  let result;
  try{
    fs.chmodSync(root,0o700);
    const token=await tokenFor(env,fetchImpl);
    result=await runPrivateTwoQueryProbe({
      group,
      privateOutputDir:path.join(root,'once'),
      send:transport(token,fetchImpl),
      minAppHeadroom:100
    });
    const a=result.assessment;
    // Return ONLY non-sensitive rate/timing/shape metadata. Raw responses
    // and full ranking actors must NEVER be uploaded from this public repo.
    const safeRows=a.requests.map(r=>({
      method:r.kind,httpStatus:r.httpStatus,
      reportedTotalPoints:r.reportedTotalPoints,
      categoryWitness:r.categoryWitness,
      categoryCosts:r.categoryCosts,
      elapsedMs:r.elapsedMs,responseConsistent:r.responseConsistent
    }));
    const redacted={
      status:result.status,
      graphqlRequests:result.transportCalls,
      reason:result.failure,
      semanticVerdict:a.semanticVerdict,
      tableAdopted:false,
      costEquivalenceProven:false,
      privateRawReceiptRetained:false,
      observations:safeRows
    };
    log(redacted);
    return redacted;
  }finally{
    // GitHub-hosted runners are ephemeral; never publish raw outputs to
    // Actions logs, public artifacts or the public Git repository.
    // Real actor/target semantic parity remains deliberately UNPROVEN.
    fs.rmSync(root,{recursive:true,force:true});
  }
}
if(process.argv[1]&&process.argv[1].endsWith('/run-actions-wcl-two-query-probe.mjs')){
  const exec=process.env.WCL_PROBE_PUBLIC_REPORT_URL?
    runFreshActionsWclProbe:runActionsWclProbe;
  exec({
    log:r=>process.stdout.write('REDACTED_WCL_PROBE '+JSON.stringify(r)+'\n')
  }).then(result=>{
    if(result.status==='ONE_TIME_PROBE_ALREADY_RESERVED'){
      process.stdout.write('WCL_PROBE_REPLAY_REFUSED\n');
      process.exitCode=2;
    }else if(result.status==='NEEDS_REVIEW'){
      process.stdout.write('WCL_PROBE_NEEDS_REVIEW\n');
      process.exitCode=3;
    }
  }).catch(err=>{
    // Never print err.stack or GraphQL responses. Avoid leaking secrets
    // through network/error objects or GitHub Actions masking misses.
    const known=new Set([
      'ACTIONS_DISPATCH_SCOPE_DENIED','ACTIONS_DISPATCH_PURPOSE_DENIED',
      'GITHUB_SHA_INVALID','GITHUB_ATOMIC_SPEND_RESERVATION_FAILED',
      'OAUTH_TOKEN_EXCHANGE_UNCERTAIN','OAUTH_TOKEN_EXCHANGE_FAILED',
      'OAUTH_TOKEN_MISSING','PRIVATE_PROBE_FIXTURE_INVALID',
      'PRIVATE_PROBE_SLOT_INVALID','REPORT_QUERY_SCOPE_INVALID'
    ]);
    const msg=String(err?.message??'');
    const safe=known.has(msg)?msg:
      /^REQUIRED_(WCL_PROBE_FIXTURE_JSON|WCL_CLIENT_ID|WCL_CLIENT_SECRET|GITHUB_TOKEN|GITHUB_SHA)_MISSING$/.test(msg)
        ?msg:'PRIVATE_PROBE_PRECHECK_OR_RUNTIME_FAILED';
    process.stderr.write('WCL_PROBE_ABORTED '+safe+'\n');
    process.exitCode=1;
  });
}


/**
 * NEW MODE: currently public WCL report page -> at most two GraphQL calls.
 * There is deliberately NO pre-existing rank, DPS, SHA, or revision input.
 * Public report URL + Fight ID must agree, and #1 rankings builds the LIVE
 * same-actor reference for #2 table. Does not imply global top-100 ranking.
 */
export function preflightFreshActionsProbe(env){
  if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_EVENT_NAME!=='workflow_dispatch'||
     env.GITHUB_REF!=='refs/heads/main'||
     env.GITHUB_REPOSITORY!==REPO)
    throw Error('ACTIONS_DISPATCH_SCOPE_DENIED');
  if(env.WCL_PROBE_DISPATCH_PURPOSE!=='OWNER_APPROVED_20261027_MAX_TWO')
    throw Error('ACTIONS_DISPATCH_PURPOSE_DENIED');
  requiredEnv(env,'WCL_CLIENT_ID');
  requiredEnv(env,'WCL_CLIENT_SECRET');
  requiredEnv(env,'GITHUB_TOKEN');
  if(!/^[a-f0-9]{40}$/i.test(requiredEnv(env,'GITHUB_SHA')))
    throw Error('GITHUB_SHA_INVALID');
  const reportCode=requiredEnv(env,'WCL_PROBE_PUBLIC_REPORT_CODE');
  const fightId=Number(requiredEnv(env,'WCL_PROBE_PUBLIC_FIGHT_ID'));
  const target={reportCode,fightId};
  buildFreshQueryPair(target);
  const rawUrl=requiredEnv(env,'WCL_PROBE_PUBLIC_REPORT_URL');
  let page;
  try{page=new URL(rawUrl);}
  catch{throw Error('PUBLIC_WCL_SOURCE_URL_INVALID');}
  const supportedHosts=new Set([
    'www.warcraftlogs.com','ko.warcraftlogs.com','fresh.warcraftlogs.com'
  ]);
  const fightInUrl=page.searchParams.get('fight')||
    new URLSearchParams(page.hash.replace(/^#/,'')).get('fight');
  if(page.protocol!=='https:'||!supportedHosts.has(page.hostname)||
     page.username||page.password||
     page.pathname!=='/reports/'+reportCode||
     !fightInUrl||Number(fightInUrl)!==fightId)
    throw Error('PUBLIC_WCL_SOURCE_URL_INVALID');
  return target;
}

export async function runFreshActionsWclProbe({
  env=process.env,fetchImpl=fetch,log=()=>{}
}={}){
  const target=preflightFreshActionsProbe(env);
  const marker=await reserveOneTimeAction({fetchImpl,env});
  if(marker!=='IRREVERSIBLE_RESERVATION_CREATED')
    return {status:marker,graphqlRequests:0};
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fresh-actions-private-'));
  try{
    fs.chmodSync(root,0o700);
    const token=await tokenFor(env,fetchImpl);
    const summary=await runFreshTwoQueryProbe({
      target,privateOutputDir:path.join(root,'once'),
      send:transport(token,fetchImpl),minAppHeadroom:100
    });
    // NEVER emit private ReportCode, raw actors, table source, token, or URL.
    const publicSafe={
      status:summary.status,graphqlRequests:summary.graphqlRequests,
      reason:summary.reason,liveReferenceObserved:summary.liveReferenceObserved,
      matchedRankingsActors:summary.matchedRankingsActors,
      tableSourceRowsObserved:summary.tableSourceRowsObserved,
      tableSharedRankedSourceRowsObserved:summary.tableSharedRankedSourceRowsObserved,
      tableShapeStatus:summary.tableShapeStatus,
      sameFightTableResponseRecorded:summary.sameFightTableResponseRecorded,
      parity:summary.actorBossTargetAndDpsDenominatorParity,
      tableAdopted:false,
      observations:summary.observations
    };
    log(publicSafe);
    return publicSafe;
  }finally{
    fs.rmSync(root,{recursive:true,force:true});
  }
}
