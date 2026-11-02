#!/usr/bin/env node
/**
 * Private Actions host for the reusable Fresh216 single-tick engine.
 * One owner-controlled REQUEST.json selects preview/report-one/stage-one.
 * Source and state are pinned to real private Git commits. Re-collection
 * requires a fresh request and can issue at most ONE authorized GraphQL call.
 * No public write, C append, Sheets, scheduler or per-run hardcoded report.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {JsonCheckpointStore}
  from '../src/adapters/json-checkpoint-store.mjs';
import {derivePinnedFresh216SourceSlots,makePrivateWclTransport}
  from '../src/adapters/private-fresh-cohort-host.mjs';
import {createPrivateWaveWitnessStore}
  from '../src/adapters/private-wave-witness-store.mjs';
import {createGitBackedReportStateCommitProvider}
  from '../src/adapters/private-report-state-commit.mjs';
import {persistPrivateSignedWaveStage}
  from '../src/adapters/private-signed-evidence-git-store.mjs';
import {runOneFresh216EngineTick}
  from '../src/adapters/fresh216-engine-tick.mjs';
import {makeGitDurableStore,restoreGitAdaptiveWitnesses,
  ADAPTIVE_STATE_BRANCH,ADAPTIVE_STATE_PATH}
  from './run-private-github-fresh216.mjs';
import {SOURCE_SHA256}
  from './lib/fresh216-c-delta.mjs';

const SOURCE_COMMIT='39573a118f2a57f9dc6758936e9d73e9aa6cebf5';
const SOURCE_FILE='projects/wcl-fresh216/private-source/fresh216-checkpoint.json';
const SRC_SCOPE='heroic:2026-10-22_27:latest:source';
const STAGE_BRANCH='work/fresh216-private-redacted-stage';
const sha40=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
const need=(v,c)=>{if(!v)throw Error(c)};
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{
  stdio:['ignore','pipe','pipe'],encoding:'utf8',timeout:25000
}).trim();
const file=path.resolve(fileURLToPath(import.meta.url));
const product=path.resolve(path.dirname(file),'..');
const pathInside=(base,name)=>path.join(base,name);

export function validateEngineActionRequest(request,{env=process.env,
  stateHead,stageHead,productHead,sourceHead
}={}){
  need(request?.schema===1&&
    request.kind==='FRESH216_PRIVATE_ENGINE_TICK_REQUEST_V1'&&
    ['preview','report-one','stage-one'].includes(request.mode)&&
    request.productCommit===productHead&&sha40(productHead)&&
    request.sourceCommit===sourceHead&&sourceHead===SOURCE_COMMIT&&
    request.expectedStateHead===stateHead&&sha40(stateHead)&&
    typeof request.approved==='boolean'&&
    Number.isSafeInteger(request.maxObservedPoints)&&
    request.maxObservedPoints>=1&&request.maxObservedPoints<=100&&
    Number.isSafeInteger(request.reservePoints)&&
    request.reservePoints>=1&&request.reservePoints<=100,
    'PRIVATE_ENGINE_REQUEST_INVALID_OR_STALE');
  need(env.GITHUB_ACTIONS==='true'&&
    env.GITHUB_REPOSITORY==='degong2-code/ai-project-lab'&&
    env.GITHUB_EVENT_NAME==='push'&&
    env.GITHUB_REF==='refs/heads/work/fresh216-private-actions',
    'PRIVATE_ENGINE_UNTRUSTED_ACTION_CONTEXT');
  if(request.mode==='preview')
    need(request.approved===false,
      'PRIVATE_ENGINE_PREVIEW_MUST_BE_UNAPPROVED');
  else need(request.approved===true,
    'PRIVATE_ENGINE_LIVE_APPROVAL_REQUIRED');
  if(request.mode==='stage-one')
    need(sha40(stageHead)&&request.expectedStageHead===stageHead,
      'PRIVATE_ENGINE_STAGE_HEAD_INVALID_OR_STALE');
  else need(request.expectedStageHead===null,
    'PRIVATE_ENGINE_STAGE_NOT_NEEDED');
  return request.mode;
}
export async function runPrivateEngineAction({
  requestFile,sourceRoot,stateRoot,stageRoot=null,env=process.env
}={}){
  need([requestFile,sourceRoot,stateRoot].every(v=>
    typeof v==='string'&&path.isAbsolute(v)),
    'PRIVATE_ENGINE_PATHS_INVALID');
  need(fs.existsSync(requestFile)&&
    fs.lstatSync(requestFile).isFile()&&
    !fs.lstatSync(requestFile).isSymbolicLink()&&
    fs.statSync(requestFile).size<=4096,
    'PRIVATE_ENGINE_REQUEST_FILE_UNSAFE');
  const request=JSON.parse(fs.readFileSync(requestFile,'utf8'));
  const sourceHead=git(sourceRoot,'rev-parse','HEAD');
  const stateHead=git(stateRoot,'rev-parse','HEAD');
  const productHead=git(product,'rev-parse','HEAD');
  const stageHead=stageRoot?git(stageRoot,'rev-parse','HEAD'):null;
  const mode=validateEngineActionRequest(request,{
    env,stateHead,stageHead,productHead,sourceHead
  });
  need(git(stateRoot,'symbolic-ref','--short','HEAD')===
    ADAPTIVE_STATE_BRANCH&&
    (stageRoot===null||git(stageRoot,'symbolic-ref','--short','HEAD')===
      STAGE_BRANCH)&&
    git(sourceRoot,'status','--porcelain','--untracked-files=all')===''&&
    git(product,'status','--porcelain','--untracked-files=all')===''&&
    git(stateRoot,'status','--porcelain','--untracked-files=all')===''&&
    (stageRoot===null||git(stageRoot,'status','--porcelain',
      '--untracked-files=all')===''),
    'PRIVATE_ENGINE_WORKTREE_NOT_CLEAN');
  const sourceState=JSON.parse(fs.readFileSync(
    pathInside(sourceRoot,SOURCE_FILE),'utf8'));
  const slots=derivePinnedFresh216SourceSlots({
    sourceState,expectedSourceSha256:SOURCE_SHA256,
    expectedScopeKey:SRC_SCOPE
  });
  const saved=JSON.parse(fs.readFileSync(
    pathInside(stateRoot,ADAPTIVE_STATE_PATH),'utf8'));
  need(saved?.schema===1&&saved.scopeKey===SRC_SCOPE&&
    saved.sourceSha256===SOURCE_SHA256&&
    saved.sourceCodeCommit===SOURCE_COMMIT,
    'PRIVATE_ENGINE_CHECKPOINT_SOURCE_DRIFT');
  if(mode==='preview'){
    const result=await runOneFresh216EngineTick({
      mode,slots,store:{read:()=>structuredClone(saved),
        update:()=>{throw Error('PRIVATE_ENGINE_PREVIEW_WRITE_FORBIDDEN')}}
    });
    return {...result,mode,sourceSlots:slots.length,wclCalls:0,
      remoteStateWrite:false};
  }
  const privateDir=fs.mkdtempSync(path.join(os.tmpdir(),
    'fresh216-engine-tick-'),{mode:0o700});
  // The Git checkpoint remains authoritative after ephemeral runner cleanup.
  try{
    const local=path.join(privateDir,'checkpoint.json');
    fs.writeFileSync(local,JSON.stringify(saved)+'\n',{
      flag:'wx',mode:0o600});
    const localStore=new JsonCheckpointStore(local);
    const store=makeGitDurableStore({
      localStore,stateRoot,target:'adaptive',privateWitnessDir:privateDir
    });
    const witness=createPrivateWaveWitnessStore({
      privateDir,repoRoot:product,sourceSha256:SOURCE_SHA256
    });
    if(mode==='report-one'){
      need(typeof env.WCL_CLIENT_ID==='string'&&env.WCL_CLIENT_ID&&
        typeof env.WCL_CLIENT_SECRET==='string'&&env.WCL_CLIENT_SECRET,
        'PRIVATE_ENGINE_WCL_CREDENTIALS_UNAVAILABLE');
      const transport=await makePrivateWclTransport({
        clientId:env.WCL_CLIENT_ID,clientSecret:env.WCL_CLIENT_SECRET
      });
      return await runOneFresh216EngineTick({
        mode,slots,store,approved:true,
        transport,onVerifiedWave:witness.persist,
        admissionPolicy:{notBeforeMs:0,
          maxObservedPoints:request.maxObservedPoints,
          reservePoints:request.reservePoints}
      });
    }
    need(stageRoot!==null&&typeof env.FRESH216_EVIDENCE_HMAC_KEY==='string'&&
      Buffer.byteLength(env.FRESH216_EVIDENCE_HMAC_KEY,'utf8')>=32,
      'PRIVATE_ENGINE_STAGE_SECRET_OR_WORKTREE_UNAVAILABLE');
    restoreGitAdaptiveWitnesses({
      stateRoot,privateWitnessDir:privateDir
    });
    return await runOneFresh216EngineTick({
      mode,slots,store,approved:true,
      witnessReader:witness.read,hmacKey:env.FRESH216_EVIDENCE_HMAC_KEY,
      stageRepoRoot:stageRoot,
      getReportStateCommit:createGitBackedReportStateCommitProvider({
        repoRoot:stateRoot
      }),
      stagePersist:persistPrivateSignedWaveStage
    });
  }finally{
    fs.rmSync(privateDir,{recursive:true,force:true});
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===file){
  try{
    need(process.argv.length>=5&&process.argv.length<=6,
      'PRIVATE_ENGINE_ARGS_INVALID');
    const args=process.argv.slice(2).map(v=>path.resolve(v));
    const result=await runPrivateEngineAction({
      requestFile:args[0],sourceRoot:args[1],
      stateRoot:args[2],stageRoot:args[3]??null
    });
    // Only non-sensitive aggregate progress is exposed in public logs.
    console.log(JSON.stringify({
      status:result.status,mode:result.mode??null,
      nextKind:result.nextKind??result.kind??null,
      nextReportFights:result.nextReportFights??null,
      attempted:result.attempted??false,
      verifiedSlots:result.verifiedSlots??null,
      observedPoints:result.observedPoints??null,
      privateStageCommit:result.privateStageCommit??null,
      remoteStateWrite:result.remoteStateWrite??null
    }));
    // A successfully executed runner is NOT a successfully collected
    // Report. Propagate the engine outcome to the Actions job conclusion.
    const validByMode={
      preview:['PREVIEW'],
      'report-one':['RECORDED','NO_REPORT_WAVE'],
      'stage-one':['PRIVATE_STAGE_REMOTE_CONFIRMED_PENDING_PUBLIC',
        'NO_PENDING_WAVE']
    };
    const safe=validByMode[result.mode??'preview']??[];
    if(!safe.includes(result.status)||
       result.nextKind==='NEEDS_REVIEW'||
       result.kind==='NEEDS_REVIEW'){
      console.error('PRIVATE_ENGINE_INCOMPLETE_REVIEW_REQUIRED');
      process.exitCode=2;
    }
  }catch(e){
    const code=/^PRIVATE_ENGINE_[A-Z0-9_]+$/.test(e?.message??'')?
      e.message:'PRIVATE_ENGINE_EXECUTION_REVIEW_REQUIRED';
    console.error(code);
    process.exitCode=1;
  }
}
