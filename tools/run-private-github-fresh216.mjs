#!/usr/bin/env node
/**
 * Private GitHub runner adapter. Reuses the existing checkpoint and
 * source collector; fast-forward pushes every transition BEFORE return.
 * A checkpoint which was not pushed must never authorize WCL transport.
 */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  openPrivateCohortStore,readPrivateCohortStatus,collectPrivateCohort,
  makePrivateWclTransport,withPrivateCohortOwnerLease
} from '../src/adapters/private-fresh-cohort-host.mjs';
import {privateSourceIdentity,SCOPE} from './run-private-fresh216.mjs';

const fail=code=>{throw Error(code);};
const need=(x,code)=>{if(!x)fail(code);};
export const PRIVATE_REPO='degong2-code/ai-project-lab';
export const STATE_BRANCH='work/fresh216-private-source-state';
export const STATE_PATH='projects/wcl-fresh216/private-source/fresh216-checkpoint.json';
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{
  stdio:['ignore','pipe','pipe'],encoding:'utf8',timeout:25000,
  env:{...process.env,GIT_TERMINAL_PROMPT:'0'}
}).trim();
const doGit=(root,...args)=>{
  try{return git(root,...args);}catch{fail('PRIVATE_GITHUB_STATE_WRITE_OR_VERIFY_FAILED');}
};
const cleanGit=value=>typeof value==='string'&&/^[0-9a-f]{40}$/.test(value);
const privatePath=root=>path.join(root,STATE_PATH);

export function makeGitDurableStore({localStore,stateRoot,persist=commitState}={}){
  need(localStore&&typeof localStore.read==='function'&&
    typeof localStore.update==='function'&&
    typeof stateRoot==='string'&&path.isAbsolute(stateRoot)&&
    typeof persist==='function','PRIVATE_GITHUB_STORE_INVALID');
  return {
    read:()=>localStore.read(),
    update:transition=>{
      const state=localStore.update(transition);
      // In-flight request cannot begin until remote commit is confirmed.
      persist({stateRoot,source:localStore.filePath,version:state.version});
      return state;
    }
  };
}

export function commitState({stateRoot,source,version}){
  need(Number.isSafeInteger(version)&&version>=0,
    'PRIVATE_GITHUB_VERSION_INVALID');
  const dst=privatePath(stateRoot);
  fs.mkdirSync(path.dirname(dst),{recursive:true,mode:0o700});
  fs.copyFileSync(source,dst);
  fs.chmodSync(dst,0o600);
  doGit(stateRoot,'add','--',STATE_PATH);
  // Git metadata contains no player, fight, report or credential.
  doGit(stateRoot,'-c','user.name=Fresh216 State',
    '-c','user.email=fresh216-state@users.noreply.github.com',
    'commit','-m','fresh216: checkpoint version '+version);
  doGit(stateRoot,'push','origin','HEAD:refs/heads/'+STATE_BRANCH);
  const current=doGit(stateRoot,'rev-parse','HEAD');
  const remote=doGit(stateRoot,'ls-remote','--heads','origin',STATE_BRANCH)
    .split(/\s+/)[0];
  need(cleanGit(current)&&current===remote,
    'PRIVATE_GITHUB_STATE_REMOTE_CONFIRMATION_FAILED');
}

export async function runGitHubPrivateSource({
  env=process.env,mode='status',fetchImpl=fetch,
  write=console.log,persist=commitState
}={}){
  need(['status','collect'].includes(mode),'PRIVATE_GITHUB_MODE_INVALID');
  need(env.GITHUB_ACTIONS==='true'&&env.GITHUB_REPOSITORY===PRIVATE_REPO&&
    env.RUNNER_OS==='Linux'&&env.GITHUB_REF===
    'refs/heads/work/fresh216-private-actions',
    'PRIVATE_GITHUB_ACTIONS_CONTEXT_INVALID');
  const productRoot=env.FRESH216_PRODUCT_ROOT;
  const stateRoot=env.FRESH216_STATE_ROOT;
  const privateDir=env.FRESH216_PRIVATE_DIR;
  const sourceCommit=env.FRESH216_EXPECTED_PRODUCT_SHA;
  need(cleanGit(sourceCommit),'PRIVATE_GITHUB_PRODUCT_SHA_MISSING');
  need([productRoot,stateRoot,privateDir].every(p=>
    typeof p==='string'&&path.isAbsolute(p)),
    'PRIVATE_GITHUB_ROOTS_INVALID');
  need(privateSourceIdentity(productRoot)===sourceCommit,
    'PRIVATE_GITHUB_PRODUCT_SHA_DRIFT');
  need(doGit(stateRoot,'rev-parse','--abbrev-ref','HEAD')===STATE_BRANCH,
    'PRIVATE_GITHUB_STATE_BRANCH_DRIFT');
  const remoteUrl=doGit(stateRoot,'remote','get-url','origin');
  need(/(?:^|[:/])degong2-code\/ai-project-lab(?:\.git)?$/.test(remoteUrl),
    'PRIVATE_GITHUB_STATE_REMOTE_MISMATCH');
  need(!doGit(stateRoot,'status','--porcelain','--untracked-files=no'),
    'PRIVATE_GITHUB_STATE_DIRTY');
  const statePath=privatePath(stateRoot);
  const hasState=fs.existsSync(statePath);
  fs.mkdirSync(privateDir,{recursive:true,mode:0o700});
  if(hasState){
    need(fs.lstatSync(statePath).isFile()&&
      !fs.lstatSync(statePath).isSymbolicLink(),
      'PRIVATE_GITHUB_CHECKPOINT_INVALID');
    fs.copyFileSync(statePath,path.join(privateDir,'fresh216-checkpoint.json'));
    fs.chmodSync(path.join(privateDir,'fresh216-checkpoint.json'),0o600);
  }
  const localStore=openPrivateCohortStore({
    privateDir,repoRoot:productRoot,scopeKey:SCOPE,
    sourceCommit,initialize:!hasState
  });
  if(!hasState)persist({stateRoot,source:localStore.filePath,version:0});
  const store=makeGitDurableStore({localStore,stateRoot,persist});
  if(mode==='status'){
    const status=readPrivateCohortStatus({store,scopeKey:SCOPE,sourceCommit});
    write(JSON.stringify({mode,...status}));return status;
  }
  return withPrivateCohortOwnerLease(privateDir,async()=>{
    const before=readPrivateCohortStatus({store,scopeKey:SCOPE,sourceCommit});
    need(!before.run.needsReview&&!before.run.inFlight,
      'PRIVATE_GITHUB_UNCERTAIN_ATTEMPT_NO_RETRY');
    need(before.run.stage!=='SOURCE_COMPLETE',
      'PRIVATE_GITHUB_SOURCE_ALREADY_COMPLETE');
    const transport=await makePrivateWclTransport({
      clientId:env.WCL_CLIENT_ID,clientSecret:env.WCL_CLIENT_SECRET,fetchImpl
    });
    const receipt=await collectPrivateCohort({
      store,scopeKey:SCOPE,sourceCommit,
      transport,approved:true,maxRequests:1,
      maxObservedPoints:20,reservePoints:10
    });
    write(JSON.stringify({mode,...receipt}));return receipt;
  });
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{await runGitHubPrivateSource({mode:process.argv[2]??'status'});}
  catch(e){
    const code=/^PRIVATE_[A-Z0-9_]+$/.test(e?.message??'')?
      e.message:'PRIVATE_GITHUB_SOURCE_FAILED_REQUIRES_REVIEW';
    process.stderr.write(code+'\n');process.exitCode=1;
  }
}
