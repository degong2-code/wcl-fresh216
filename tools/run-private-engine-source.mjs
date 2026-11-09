#!/usr/bin/env node
/**
 * Reusable PRIVATE owner-pinned source tick for a fresh independent A cohort.
 * Reuses: newCheckpoint, fresh-cohort-source, JsonCheckpointStore,
 * makeGitDurableStore(target=engineSource), and existing OAuth transport.
 * One Git-witnessed GraphQL batch maximum; no public/Git C/HMAC writes.
 * A successful source request is not yet a full 21600 A snapshot.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {newCheckpoint} from '../src/core/checkpoint.mjs';
import {JsonCheckpointStore} from '../src/adapters/json-checkpoint-store.mjs';
import {makePrivateWclTransport} from '../src/adapters/private-fresh-cohort-host.mjs';
import {makeFreshDatedHeroicManifest,
  runOneFreshCohortBatch,nextFreshCohortBatch}
  from '../src/core/fresh-cohort-source.mjs';
import {runBoundedFreshCohortBatches}
  from '../src/core/fresh-cohort-bounded-runner.mjs';
import {makeGitDurableStore,commitState}
  from './run-private-github-fresh216.mjs';

// Explicit isolated targets; the previously collected 1-alias source
// never becomes the mutable 8/9-alias candidate by accident.
const RUNS=Object.freeze({
  'source-one':Object.freeze({
    branch:'work/fresh216-engine-source-20261102',
    file:'projects/wcl-fresh216/engine-source/source-checkpoint.json',
    scope:'engine-fresh:heroic:2026-10-22_27:independent-A',
    target:'engineSource'
  }),
  'source-bounded':Object.freeze({
    branch:'work/fresh216-engine-source-candidate-20261102',
    file:'projects/wcl-fresh216/engine-source-candidate/source-checkpoint.json',
    scope:'engine-fresh:heroic:2026-10-22_27:candidate-A',
    target:'engineSourceCandidate'
  })
});
const sourceRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const validSha=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
const need=(v,c)=>{if(!v)throw Error(c);};
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{
  encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:25000,
  env:{...process.env,GIT_TERMINAL_PROMPT:'0'}
}).trim();
export function validateFreshSourceTickRequest(request,{
  env=process.env,productHead,stateHead
}={}){
  need(env.GITHUB_ACTIONS==='true'&&
    env.GITHUB_REPOSITORY==='degong2-code/ai-project-lab'&&
    env.GITHUB_EVENT_NAME==='push'&&
    env.GITHUB_REF==='refs/heads/work/fresh216-private-actions',
    'FRESH_SOURCE_UNTRUSTED_CONTEXT');
  need(request?.schema===1&&
    request.kind==='FRESH216_PRIVATE_ENGINE_TICK_REQUEST_V1'&&
    Object.hasOwn(RUNS,request.mode)&&request.approved===true&&
    request.productCommit===productHead&&validSha(productHead)&&
    request.expectedFreshSourceHead===stateHead&&validSha(stateHead)&&
    (request.mode==='source-one'?
      (request.jobsPerRequest===1&&
        (request.maxRequests==null||request.maxRequests===1)):
      ([8,9].includes(request.jobsPerRequest)&&
        Number.isSafeInteger(request.maxRequests)&&
        request.maxRequests>=1&&request.maxRequests<=32))&&
    Number.isSafeInteger(request.maxObservedPoints)&&
    request.maxObservedPoints>=1&&
    request.maxObservedPoints<=(request.mode==='source-bounded'?3600:100)&&
    Number.isSafeInteger(request.reservePoints)&&
    request.reservePoints>=1&&request.reservePoints<=100&&
    request.reservePoints<=request.maxObservedPoints&&
    (request.databaseReservePoints==null||
      Number.isSafeInteger(request.databaseReservePoints)&&
      request.databaseReservePoints>=0&&request.databaseReservePoints<=100),
    'FRESH_SOURCE_REQUEST_NOT_PINNED');
  return true;
}
export async function runOnePrivateFreshSourceTick({
  requestFile,stateRoot,env=process.env
}={}){
  need(typeof requestFile==='string'&&path.isAbsolute(requestFile)&&
    typeof stateRoot==='string'&&path.isAbsolute(stateRoot),
    'FRESH_SOURCE_PATHS_INVALID');
  need(fs.existsSync(requestFile)&&fs.lstatSync(requestFile).isFile()&&
    !fs.lstatSync(requestFile).isSymbolicLink()&&
    fs.statSync(requestFile).size<4096,
    'FRESH_SOURCE_REQUEST_FILE_INVALID');
  const request=JSON.parse(fs.readFileSync(requestFile,'utf8'));
  const run=RUNS[request.mode];
  const productHead=git(sourceRoot,'rev-parse','HEAD');
  const stateHead=git(stateRoot,'rev-parse','HEAD');
  validateFreshSourceTickRequest(request,{env,productHead,stateHead});
  need(git(stateRoot,'symbolic-ref','--short','HEAD')===run.branch&&
    git(stateRoot,'status','--porcelain','--untracked-files=all')===''&&
    git(sourceRoot,'status','--porcelain','--untracked-files=all')===''&&
    /(?:^|[:/])degong2-code\/ai-project-lab(?:\.git)?$/.test(
      git(stateRoot,'remote','get-url','origin')),
    'FRESH_SOURCE_WORKTREE_INVALID');
  const savedPath=path.join(stateRoot,run.file);
  const manifest=makeFreshDatedHeroicManifest(run.scope);
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'fresh216-new-source-'));
  let remoteGitCommitMs=0,remoteGitCommits=0;
  const measuredPersist=args=>{
    const started=performance.now();
    const receipt=commitState(args);
    remoteGitCommitMs+=performance.now()-started;
    remoteGitCommits++;
    return receipt;
  };
  fs.chmodSync(temp,0o700);
  try{
    const file=path.join(temp,'state.json');
    if(fs.existsSync(savedPath)){
      fs.copyFileSync(savedPath,file);fs.chmodSync(file,0o600);
    }else{
      const initial=newCheckpoint(run.scope,
        'engine-new-source-'+productHead.slice(0,12));
      initial.sourceCodeCommit=productHead;
      new JsonCheckpointStore(file).init(initial);
      // A remote version-0 reservation is durable BEFORE the first
      // plan installation and before any potential charged request.
      measuredPersist({stateRoot,source:file,version:0,
        target:run.target});
    }
    const local=new JsonCheckpointStore(file);
    const durable=makeGitDurableStore({
      localStore:local,stateRoot,target:run.target,
      persist:measuredPersist
    });
    const before=local.read();
    need(before.scopeKey===run.scope&&before.status==='ACTIVE'&&
      before.sourceCodeCommit===productHead&&
      (!before.sourceJobsPerRequest||
        before.sourceJobsPerRequest===request.jobsPerRequest),
      'FRESH_SOURCE_STATE_DRIFT');
    const preview=await runOneFreshCohortBatch({
      store:durable,manifest,mode:'preview',
      jobsPerRequest:request.jobsPerRequest
    });
    need(preview.kind==='PLAN_REQUIRED'||preview.kind==='SOURCE_BATCH',
      'FRESH_SOURCE_NO_SAFE_NEW_REQUEST');
    need(typeof env.WCL_CLIENT_ID==='string'&&env.WCL_CLIENT_ID&&
      typeof env.WCL_CLIENT_SECRET==='string'&&env.WCL_CLIENT_SECRET,
      'FRESH_SOURCE_CREDENTIALS_UNAVAILABLE');
    const transport=await makePrivateWclTransport({
      clientId:env.WCL_CLIENT_ID,clientSecret:env.WCL_CLIENT_SECRET
    });
    // Both modes run through the same bounded coordinator; source-one
    // preserves its previous one-request contract by selecting max=1.
    // Hourly quota GET is a small WCL API request, not a source-rank
    // request. It cannot produce rank/actor evidence and is never retried
    // automatically after a network or GraphQL ambiguity.
    const quotaReader=request.mode==='source-bounded'?async()=>{
      const response=await transport({query:
        'query Fresh216HourlyQuota { rateLimitData { '+
        'limitPerHour pointsSpentThisHour pointsResetIn '+
        'databaseLimitPerHour databasePointsSpentThisHour } }',
        variables:{}});
      need(response?.httpStatus===200&&
        response.body?.errors==null&&
        response.body?.data?.rateLimitData,
        'FRESH_SOURCE_HOURLY_QUOTA_UNAVAILABLE');
      return response.body.data.rateLimitData;
    }:null;
    const receipt=await runBoundedFreshCohortBatches({
      store:durable,manifest,approved:true,
      transport,jobsPerRequest:request.jobsPerRequest,
      maxRequests:request.mode==='source-one'?1:request.maxRequests,
      quotaReader,
      admissionPolicy:{notBeforeMs:0,
        maxObservedPoints:request.maxObservedPoints,
        reservePoints:request.reservePoints,
        databaseReservePoints:request.databaseReservePoints??0}
    });
    const after=local.read();
    const status=nextFreshCohortBatch(after,manifest);
    return {
      status:request.mode==='source-one'&&receipt.recordedRequests===1?
        'RECORDED':receipt.status,
      mode:request.mode,
      attempted:receipt.attemptedRequests>0,
      attemptedRequests:receipt.attemptedRequests,
      recordedRequests:receipt.recordedRequests,
      observedPoints:receipt.observedPoints,
      completedJobs:status.completedJobs,
      nextKind:status.kind,sourceRequests:
        Object.keys(after.sourceRequests??{}).length,
      stateVersion:after.version,
      remoteGitCommits,
      remoteGitCommitMs:Math.round(remoteGitCommitMs),
      hourlyQuotaProbes:receipt.hourlyQuotaProbes,
      nextWindowWaitMs:receipt.waitMs,
      budgetBasis:receipt.budgetBasis,
      privateCheckpointBytes:fs.statSync(savedPath).size,
      sourceReady:
        status.kind==='SOURCE_COMPLETE',
      canonicalCAdded:0
    };
  }finally{fs.rmSync(temp,{force:true,recursive:true});}
}
const entry=path.resolve(fileURLToPath(import.meta.url));
if(process.argv[1]&&path.resolve(process.argv[1])===entry){
  try{
    need(process.argv.length===4,'FRESH_SOURCE_ARGS_REQUIRED');
    const result=await runOnePrivateFreshSourceTick({
      requestFile:path.resolve(process.argv[2]),
      stateRoot:path.resolve(process.argv[3])
    });
    console.log(JSON.stringify(result));
    const acceptable=result.mode==='source-bounded'?
      (['MAX_REQUESTS_REACHED','SOURCE_COMPLETE','BUDGET_PAUSED']
        .includes(result.status)&&result.recordedRequests>0)||
      result.status==='HOURLY_RATE_WAIT':
      result.status==='RECORDED'&&result.recordedRequests===1;
    if(!acceptable)process.exitCode=2;
  }catch(e){
    console.error(/^FRESH_SOURCE_[A-Z0-9_]+$/.test(e?.message??'')?
      e.message:'FRESH_SOURCE_UNCERTAIN_REVIEW_REQUIRED');
    process.exitCode=1;
  }
}
