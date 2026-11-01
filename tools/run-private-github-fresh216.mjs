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
/**
 * One existing Git-backed store, with an explicit allowlist for A-source and
 * adaptive Report-wave state. GitHub Actions runners can be ephemeral; the
 * ONLY authoritative checkpoint is the remote private Git branch.
 *
 * A writable checkout must be private; no public Actions GITHUB_TOKEN can
 * write the private repository. Never treat a read-only checkout as writable.
 */
export const ADAPTIVE_STATE_BRANCH='work/fresh216-private-adaptive-state';
export const ADAPTIVE_STATE_PATH=
  'projects/wcl-fresh216/private-adaptive/report-wave-checkpoint.json';
const stateTargets=Object.freeze({
  source:Object.freeze({branch:STATE_BRANCH,file:STATE_PATH}),
  adaptive:Object.freeze({
    branch:ADAPTIVE_STATE_BRANCH,file:ADAPTIVE_STATE_PATH
  })
});
const stateTarget=target=>{
  const spec=Object.hasOwn(stateTargets,target)?stateTargets[target]:null;
  need(spec,'PRIVATE_GITHUB_STATE_TARGET_INVALID');
  return spec;
};
const privatePath=(root,target='source')=>
  path.join(root,stateTarget(target).file);
const readRemoteHead=(run,spec)=>{
  const fields=run('ls-remote','--heads','origin',
    'refs/heads/'+spec.branch).split(/\s+/);
  need(cleanGit(fields[0])&&
    fields[1]==='refs/heads/'+spec.branch,
    'PRIVATE_GITHUB_STATE_REMOTE_REF_INVALID');
  return fields[0];
};

export function makeGitDurableStore({
  localStore,stateRoot,persist=commitState,target='source'
}={}){
  stateTarget(target);
  need(localStore&&typeof localStore.read==='function'&&
    typeof localStore.update==='function'&&
    typeof localStore.filePath==='string'&&
    path.isAbsolute(localStore.filePath)&&
    typeof stateRoot==='string'&&path.isAbsolute(stateRoot)&&
    typeof persist==='function','PRIVATE_GITHUB_STORE_INVALID');
  return {
    read:()=>localStore.read(),
    update:transition=>{
      // The existing JsonCheckpointStore has already used fsync+rename and
      // rejected concurrent writers. A failed remote push MUST throw before
      // an HTTP transport callback can observe successful store.update().
      const state=localStore.update(transition);
      persist({stateRoot,source:localStore.filePath,
        version:state.version,target});
      return state;
    }
  };
}

export function commitState({
  stateRoot,source,version,target='source',
  gitCommand=(root,args)=>git(root,...args)
}={}){
  const spec=stateTarget(target);
  need(Number.isSafeInteger(version)&&version>=0&&
    typeof stateRoot==='string'&&path.isAbsolute(stateRoot)&&
    typeof source==='string'&&path.isAbsolute(source)&&
    typeof gitCommand==='function',
    'PRIVATE_GITHUB_STATE_CONFIG_INVALID');
  let root;
  try{
    root=fs.realpathSync(stateRoot);
    need(fs.statSync(root).isDirectory()&&
      fs.lstatSync(source).isFile()&&
      !fs.lstatSync(source).isSymbolicLink(),
      'PRIVATE_GITHUB_STATE_SOURCE_UNSAFE');
    const src=fs.realpathSync(source);
    need(src!==root&&!src.startsWith(root+path.sep),
      'PRIVATE_GITHUB_STATE_SOURCE_MUST_BE_OUTSIDE_GIT');
    const state=JSON.parse(fs.readFileSync(src,'utf8'));
    need(state?.schema===1&&state.version===version&&
      typeof state.scopeKey==='string'&&state.scopeKey&&
      typeof state.runId==='string'&&state.runId,
      'PRIVATE_GITHUB_STATE_VERSION_INVALID');
  }catch(error){
    if(/^PRIVATE_GITHUB_/.test(error?.message??''))throw error;
    fail('PRIVATE_GITHUB_STATE_SOURCE_INVALID');
  }
  const run=(...args)=>{
    try{return String(gitCommand(root,args)).trim();}
    catch{fail('PRIVATE_GITHUB_STATE_WRITE_OR_VERIFY_FAILED');}
  };
  need(run('rev-parse','--show-toplevel')===root&&
    run('symbolic-ref','--short','HEAD')===spec.branch,
    'PRIVATE_GITHUB_STATE_BRANCH_DRIFT');
  need(/(?:^|[:/])degong2-code\/ai-project-lab(?:\.git)?$/.test(
    run('remote','get-url','origin')),
    'PRIVATE_GITHUB_STATE_REMOTE_MISMATCH');
  need(run('status','--porcelain','--untracked-files=all')==='',
    'PRIVATE_GITHUB_STATE_DIRTY');
  const before=run('rev-parse','HEAD');
  need(cleanGit(before)&&readRemoteHead(run,spec)===before,
    'PRIVATE_GITHUB_STATE_STALE_REMOTE');
  const dst=privatePath(root,target);
  need(!fs.existsSync(dst)||(
    fs.lstatSync(dst).isFile()&&!fs.lstatSync(dst).isSymbolicLink()),
    'PRIVATE_GITHUB_STATE_DESTINATION_UNSAFE');
  fs.mkdirSync(path.dirname(dst),{recursive:true,mode:0o700});
  fs.copyFileSync(source,dst);
  fs.chmodSync(dst,0o600);
  run('add','--',spec.file);
  // Never sweep in untracked files or unrelated changes.
  need(run('diff','--cached','--name-only')===spec.file,
    'PRIVATE_GITHUB_STATE_STAGING_DRIFT');
  run('-c','user.name=Fresh216 State',
    '-c','user.email=fresh216-state@users.noreply.github.com',
    'commit','-m','fresh216: checkpoint version '+version);
  const current=run('rev-parse','HEAD');
  need(cleanGit(current)&&run('rev-parse','HEAD^')===before,
    'PRIVATE_GITHUB_STATE_COMMIT_DRIFT');
  run('push','origin','HEAD:refs/heads/'+spec.branch);
  need(readRemoteHead(run,spec)===current,
    'PRIVATE_GITHUB_STATE_REMOTE_CONFIRMATION_FAILED');
  return current;
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
