#!/usr/bin/env node
/**
 * Future P1 PRIVATE B-one host. NO Actions job currently permits boss-one,
 * and partial A blocks before any token acquisition or Git writes.
 *
 * Mount immutable full A from the read-only source checkout, persist ONLY
 * the B journal on its own private Git branch through the existing adapter.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {JsonCheckpointStore} from '../src/adapters/json-checkpoint-store.mjs';
import {makePrivateWclTransport}
  from '../src/adapters/private-fresh-cohort-host.mjs';
import {createIsolatedBossCheckpoint,makeIsolatedBossStore}
  from '../src/core/fresh-boss-isolated-store.mjs';
import {runOneFreshBossWave}
  from '../src/core/fresh-boss-wave-journal.mjs';
import {makeGitDurableStore,commitState}
  from './run-private-github-fresh216.mjs';

const need=(x,c)=>{if(!x)throw Error(c);};
const sha40=v=>typeof v==='string'&&/^[0-9a-f]{40}$/.test(v);
const prodRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const SOURCE_BRANCH='work/fresh216-engine-source-candidate-20261102';
const STATE_BRANCH='work/fresh216-engine-boss-state-20261103';
const STATE_FILE='projects/wcl-fresh216/engine-boss/boss-checkpoint.json';
const SOURCE_FILE='projects/wcl-fresh216/engine-source-candidate/source-checkpoint.json';
const PRIVATE_REPO='degong2-code/ai-project-lab';
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{
  stdio:['ignore','pipe','pipe'],encoding:'utf8',timeout:25000,
  env:{...process.env,GIT_TERMINAL_PROMPT:'0'}
}).trim();
const clean=(root,branch)=>{
  const sha=git(root,'rev-parse','HEAD');
  const remote=git(root,'ls-remote','--heads','origin',
    'refs/heads/'+branch).split(/\s+/);
  need(git(root,'symbolic-ref','--short','HEAD')===branch&&
    git(root,'status','--porcelain','--untracked-files=all')===''&&
    remote[0]===sha&&remote[1]==='refs/heads/'+branch&&
    /(?:^|[:/])degong2-code\/ai-project-lab(?:\.git)?$/.test(
      git(root,'remote','get-url','origin')),
    'BOSS_PRIVATE_GIT_SOURCE_OR_STATE_INVALID');
};

export function validatePrivateBossOneRequest(request,{
  env=process.env,productHead,sourceHead,bossStateHead
}={}){
  need(env.GITHUB_ACTIONS==='true'&&
    env.GITHUB_EVENT_NAME==='push'&&
    env.GITHUB_REPOSITORY===PRIVATE_REPO&&
    env.GITHUB_REF==='refs/heads/work/fresh216-private-actions',
    'BOSS_PRIVATE_OWNER_CONTEXT_INVALID');
  need(request?.schema===1&&
    request.kind==='FRESH216_PRIVATE_ENGINE_TICK_REQUEST_V1'&&
    request.mode==='boss-one'&&request.approved===true&&
    sha40(productHead)&&productHead===request.productCommit&&
    sha40(sourceHead)&&sourceHead===request.expectedFreshSourceHead&&
    sha40(bossStateHead)&&bossStateHead===request.expectedBossStateHead&&
    sha40(request.expectedSourceCodeCommit)&&
    typeof request.expectedSourceScopeKey==='string'&&
    request.expectedSourceScopeKey.length>0&&
    [8,9].includes(request.bossJobsPerRequest)&&
    request.maxRequests===1&&
    Number.isSafeInteger(request.maxObservedBossPoints)&&
    request.maxObservedBossPoints>=1&&
    request.maxObservedBossPoints<=100&&
    Number.isSafeInteger(request.reservePoints)&&
    request.reservePoints>=1&&request.reservePoints<=100,
    'BOSS_PRIVATE_ONE_REQUEST_NOT_EXACTLY_PINNED');
  return true;
}

export async function runPrivateBossOne({
  requestFile,sourceRoot,stateRoot,env=process.env,
  makeTransport=makePrivateWclTransport,persist=commitState
}={}){
  need([requestFile,sourceRoot,stateRoot].every(p=>
    typeof p==='string'&&path.isAbsolute(p))&&
    typeof makeTransport==='function'&&typeof persist==='function',
    'BOSS_PRIVATE_PATHS_INVALID');
  need(fs.lstatSync(requestFile).isFile()&&
    !fs.lstatSync(requestFile).isSymbolicLink()&&
    fs.statSync(requestFile).size<4096,
    'BOSS_PRIVATE_REQUEST_FILE_INVALID');
  // Bind approval to the exact GitHub push SHA and checkout path.
  const controlRoot=path.resolve(path.dirname(requestFile),'../../..');
  need(path.relative(controlRoot,requestFile)===
      'projects/wcl-fresh216/engine/REQUEST.json'&&
    sha40(env.GITHUB_SHA)&&
    git(controlRoot,'rev-parse','HEAD')===env.GITHUB_SHA&&
    git(controlRoot,'status','--porcelain','--untracked-files=all')===''&&
    /(?:^|[:/])degong2-code\/ai-project-lab(?:\.git)?$/.test(
      git(controlRoot,'remote','get-url','origin')),
    'BOSS_PRIVATE_OWNER_REQUEST_NOT_IMMUTABLE');
  const request=JSON.parse(fs.readFileSync(requestFile,'utf8'));
  const productHead=git(prodRoot,'rev-parse','HEAD');
  const sourceHead=git(sourceRoot,'rev-parse','HEAD');
  const bossStateHead=git(stateRoot,'rev-parse','HEAD');
  validatePrivateBossOneRequest(request,{
    env,productHead,sourceHead,bossStateHead
  });
  clean(sourceRoot,SOURCE_BRANCH);
  clean(stateRoot,STATE_BRANCH);
  need(git(prodRoot,'status','--porcelain','--untracked-files=all')==='',
    'BOSS_PRIVATE_PRODUCT_WORKTREE_DIRTY');

  const sourcePath=path.join(sourceRoot,SOURCE_FILE);
  need(fs.existsSync(sourcePath)&&
    fs.lstatSync(sourcePath).isFile()&&
    !fs.lstatSync(sourcePath).isSymbolicLink()&&
    fs.statSync(sourcePath).size>0&&
    fs.statSync(sourcePath).size<64*1024*1024,
    'BOSS_PRIVATE_A_CHECKPOINT_INVALID');
  const source=JSON.parse(fs.readFileSync(sourcePath,'utf8'));
  need(source.sourceCodeCommit===request.expectedSourceCodeCommit&&
    source.scopeKey===request.expectedSourceScopeKey,
    'BOSS_PRIVATE_A_IDENTITY_DRIFT');

  // This proof must PASS before creating a B checkpoint. Current real A
  // 36/216 intentionally stops here, without WCL or any Git writes.
  const initial=createIsolatedBossCheckpoint({
    sourceState:source,sourceHead,
    bossJobsPerRequest:request.bossJobsPerRequest,
    runId:'fresh216-B-'+productHead.slice(0,12)
  });
  const bossPath=path.join(stateRoot,STATE_FILE);
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'fresh216-boss-'));
  fs.chmodSync(temp,0o700);
  try{
    const file=path.join(temp,'boss-checkpoint.json');
    if(fs.existsSync(bossPath)){
      need(fs.lstatSync(bossPath).isFile()&&
        !fs.lstatSync(bossPath).isSymbolicLink(),
        'BOSS_PRIVATE_B_FILE_UNSAFE');
      fs.copyFileSync(bossPath,file);
      fs.chmodSync(file,0o600);
    }else{
      const first=new JsonCheckpointStore(file);
      first.init(initial);
      // Remote version-zero reservation before any paid attempt.
      persist({stateRoot,source:file,version:0,target:'engineBoss'});
    }
    const local=new JsonCheckpointStore(file);
    const durableB=makeGitDurableStore({
      localStore:local,stateRoot,target:'engineBoss',persist
    });
    const mounted=makeIsolatedBossStore({
      sourceState:source,sourceHead,
      bossJobsPerRequest:request.bossJobsPerRequest,
      bossStore:durableB
    });
    const entries=local.read().bossPageRequests??{};
    need(Object.values(entries).every(e=>e.status==='COMPLETED')&&
      Object.keys(entries).length<mounted.batches.length,
      'BOSS_PRIVATE_NO_SAFE_NEW_WAVE');
    const index=Object.keys(entries).length;
    const batch=mounted.batches[index];
    const preview=await runOneFreshBossWave({
      store:mounted.store,batch,mode:'preview'
    });
    need(preview.status==='PREVIEW'&&preview.priorStatus==null&&
      preview.batchIndex===index,
      'BOSS_PRIVATE_WAVE_NOT_READY');
    need(typeof env.WCL_CLIENT_ID==='string'&&env.WCL_CLIENT_ID&&
      typeof env.WCL_CLIENT_SECRET==='string'&&env.WCL_CLIENT_SECRET,
      'BOSS_PRIVATE_CREDENTIALS_NOT_AVAILABLE');
    const transport=await makeTransport({
      clientId:env.WCL_CLIENT_ID,
      clientSecret:env.WCL_CLIENT_SECRET
    });
    const receipt=await runOneFreshBossWave({
      store:mounted.store,batch,mode:'execute',approved:true,
      transport,admissionPolicy:mounted.bossAdmissionPolicy({
        maxBossObservedPoints:request.maxObservedBossPoints,
        reservePoints:request.reservePoints
      })
    });
    const state=local.read();
    const verifiedBossPoints=Object.values(state.bossPageRequests??{})
      .filter(e=>e.observedPoints!==null)
      .reduce((n,e)=>n+e.observedPoints,0);
    return {
      status:receipt.status,
      attempted:receipt.attempted??false,
      batchIndex:index,sourceJobs:216,
      bossJobsPerRequest:request.bossJobsPerRequest,
      observedRequestPoints:receipt.observedPoints??null,
      bossObservedPoints:verifiedBossPoints,
      BCheckpointVersion:state.version,
      BCheckpointBytes:fs.statSync(file).size,
      privateAOriginalRowsCopied:0,
      sameFightProofs:receipt.verifiedSameFight??0
    };
  }finally{
    fs.rmSync(temp,{recursive:true,force:true});
  }
}

const main=path.resolve(fileURLToPath(import.meta.url));
if(process.argv[1]&&path.resolve(process.argv[1])===main){
  try{
    need(process.argv.length===5,'BOSS_PRIVATE_B_ONE_ARGS_REQUIRED');
    const out=await runPrivateBossOne({
      requestFile:path.resolve(process.argv[2]),
      sourceRoot:path.resolve(process.argv[3]),
      stateRoot:path.resolve(process.argv[4])
    });
    console.log(JSON.stringify(out));
    if(out.status!=='RECORDED'||!out.attempted)
      process.exitCode=2;
  }catch(e){
    const code=String(e?.message??'');
    console.error(/^(BOSS_PRIVATE_|BOSS_ISOLATED_|FRESH_COHORT_)/.test(code)?
      code:'BOSS_PRIVATE_UNCERTAIN_REVIEW_REQUIRED');
    process.exitCode=1;
  }
}
