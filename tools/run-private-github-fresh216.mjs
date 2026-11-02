#!/usr/bin/env node
/**
 * Private GitHub runner adapter. Reuses the existing checkpoint and
 * source collector; fast-forward pushes every transition BEFORE return.
 * A checkpoint which was not pushed must never authorize WCL transport.
 */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
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
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
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
  }),
  // Isolated new source cohort: same JsonCheckpointStore/remote commit
  // adapter and source schema, without touching the historic A snapshot.
  engineSource:Object.freeze({
    branch:'work/fresh216-engine-source-20261102',
    file:'projects/wcl-fresh216/engine-source/source-checkpoint.json'
  }),
  // Separate owner-pinned candidate run; NEVER reuse the 1-alias witness.
  engineSourceCandidate:Object.freeze({
    branch:'work/fresh216-engine-source-candidate-20261102',
    file:'projects/wcl-fresh216/engine-source-candidate/source-checkpoint.json'
  })
});
const stateTarget=target=>{
  const spec=Object.hasOwn(stateTargets,target)?stateTargets[target]:null;
  need(spec,'PRIVATE_GITHUB_STATE_TARGET_INVALID');
  return spec;
};
const privatePath=(root,target='source')=>
  path.join(root,stateTarget(target).file);

const WITNESS_PREFIX='projects/wcl-fresh216/private-adaptive';
const MAX_WITNESS_BYTES=16*1024*1024;
const validWitnessRef=ref=>typeof ref==='string'&&
  /^report-wave-witnesses\/[a-f0-9]{64}\.json\.br$/.test(ref);
const validDigest=digest=>typeof digest==='string'&&
  /^[a-f0-9]{64}$/.test(digest);
const under=(p,root)=>p===root||p.startsWith(root+path.sep);
const pendingWitnesses=state=>{
  const out=new Map();
  for(const entry of Object.values(state.entries??{})){
    const e=entry?.evidence;
    if(e?.status!=='PENDING')continue;
    need(validWitnessRef(e.witnessRef)&&
      validDigest(e.witnessSha256),
      'PRIVATE_GITHUB_WITNESS_METADATA_INVALID');
    const old=out.get(e.witnessRef);
    need(!old||old===e.witnessSha256,
      'PRIVATE_GITHUB_WITNESS_DUPLICATE_CONFLICT');
    out.set(e.witnessRef,e.witnessSha256);
  }
  return [...out.entries()].sort(([a],[b])=>a.localeCompare(b));
};
function witnessRoot(privateWitnessDir,repoRoot){
  need(typeof privateWitnessDir==='string'&&
    path.isAbsolute(privateWitnessDir)&&
    !fs.lstatSync(privateWitnessDir).isSymbolicLink(),
    'PRIVATE_GITHUB_WITNESS_DIRECTORY_INVALID');
  const real=fs.realpathSync(privateWitnessDir);
  need(fs.statSync(real).isDirectory()&&
    (fs.statSync(real).mode&0o077)===0&&
    !under(real,repoRoot)&&!under(repoRoot,real),
    'PRIVATE_GITHUB_WITNESS_DIRECTORY_UNSAFE');
  const folder=path.join(real,'report-wave-witnesses');
  need(fs.existsSync(folder)&&fs.statSync(folder).isDirectory()&&
    !fs.lstatSync(folder).isSymbolicLink()&&
    (fs.statSync(folder).mode&0o077)===0,
    'PRIVATE_GITHUB_WITNESS_FOLDER_UNSAFE');
  return {real,folder};
}
function witnessBytes(file,expected,{requirePrivateMode=true}={}){
  need(fs.existsSync(file)&&fs.lstatSync(file).isFile()&&
    !fs.lstatSync(file).isSymbolicLink()&&
    (!requirePrivateMode||(fs.statSync(file).mode&0o077)===0)&&
    fs.statSync(file).size>0&&
    fs.statSync(file).size<=MAX_WITNESS_BYTES,
    'PRIVATE_GITHUB_WITNESS_FILE_UNSAFE');
  const bytes=fs.readFileSync(file);
  need(sha256(bytes)===expected,
    'PRIVATE_GITHUB_WITNESS_BYTES_DRIFT');
  return bytes;
}
function writeExclusive(file,bytes){
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  const fd=fs.openSync(file,'wx',0o600);
  try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}
  finally{fs.closeSync(fd);}
  const dir=fs.openSync(path.dirname(file),'r');
  try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
}

const readRemoteHead=(run,spec)=>{
  const fields=run('ls-remote','--heads','origin',
    'refs/heads/'+spec.branch).split(/\s+/);
  need(cleanGit(fields[0])&&
    fields[1]==='refs/heads/'+spec.branch,
    'PRIVATE_GITHUB_STATE_REMOTE_REF_INVALID');
  return fields[0];
};

export function makeGitDurableStore({
  localStore,stateRoot,persist=commitState,target='source',
  privateWitnessDir=null
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
        version:state.version,target,privateWitnessDir});
      return state;
    }
  };
}

export function commitState({
  stateRoot,source,version,target='source',privateWitnessDir=null,
  gitCommand=(root,args)=>git(root,...args)
}={}){
  const spec=stateTarget(target);
  need(Number.isSafeInteger(version)&&version>=0&&
    typeof stateRoot==='string'&&path.isAbsolute(stateRoot)&&
    typeof source==='string'&&path.isAbsolute(source)&&
    typeof gitCommand==='function',
    'PRIVATE_GITHUB_STATE_CONFIG_INVALID');
  let root,validatedState;
  try{
    root=fs.realpathSync(stateRoot);
    need(fs.statSync(root).isDirectory()&&
      fs.lstatSync(source).isFile()&&
      !fs.lstatSync(source).isSymbolicLink(),
      'PRIVATE_GITHUB_STATE_SOURCE_UNSAFE');
    const src=fs.realpathSync(source);
    need(src!==root&&!src.startsWith(root+path.sep),
      'PRIVATE_GITHUB_STATE_SOURCE_MUST_BE_OUTSIDE_GIT');
    validatedState=JSON.parse(fs.readFileSync(src,'utf8'));
    need(validatedState?.schema===1&&validatedState.version===version&&
      typeof validatedState.scopeKey==='string'&&validatedState.scopeKey&&
      typeof validatedState.runId==='string'&&validatedState.runId,
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
  const staged=[spec.file];
  // Record exact, already-compressed private response witnesses in the SAME
  // private Git commit as the PENDING checkpoint transition. The format is
  // unchanged; never copy a report response or witness to public Git.
  if(target==='adaptive'){
    const witnesses=pendingWitnesses(validatedState);
    if(witnesses.length){
      const {real}=witnessRoot(privateWitnessDir,root);
      for(const [ref,digest] of witnesses){
        const input=path.join(real,ref);
        const bytes=witnessBytes(input,digest);
        const relative=WITNESS_PREFIX+'/'+ref;
        const output=path.join(root,relative);
        if(fs.existsSync(output)){
          need(fs.lstatSync(output).isFile()&&
            !fs.lstatSync(output).isSymbolicLink()&&
            sha256(fs.readFileSync(output))===digest,
            'PRIVATE_GITHUB_WITNESS_EXISTING_DRIFT');
        }else{
          const folder=path.dirname(output);
          if(fs.existsSync(folder))
            need(!fs.lstatSync(folder).isSymbolicLink(),
              'PRIVATE_GITHUB_WITNESS_GIT_FOLDER_UNSAFE');
          fs.mkdirSync(path.dirname(output),{recursive:true,mode:0o700});
          need(fs.realpathSync(path.dirname(output))===path.dirname(output),
            'PRIVATE_GITHUB_WITNESS_GIT_FOLDER_UNSAFE');
          writeExclusive(output,bytes);
        }
        staged.push(relative);
      }
    }
  }
  fs.copyFileSync(source,dst);
  fs.chmodSync(dst,0o600);
  run('add','--',...staged);
  // Never sweep unrelated paths, even if the witness set is large.
  const actual=run('diff','--cached','--name-only')
    .split('\n').filter(Boolean).sort();
  need(actual.includes(spec.file)&&
    actual.every(file=>staged.includes(file)),
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

/**
 * Restore only private PENDING witness bytes from an already checked-out
 * adaptive Git branch into the ephemeral private working directory.
 * The existing createPrivateWaveWitnessStore.read then verifies the
 * original compressed format, response bytes, wave and canonical joins.
 * This adapter performs NO Git writes, OAuth, WCL, or C publication.
 */
export function restoreGitAdaptiveWitnesses({
  stateRoot,privateWitnessDir
}={}){
  need(typeof stateRoot==='string'&&path.isAbsolute(stateRoot),
    'PRIVATE_GITHUB_RESTORE_ROOT_INVALID');
  const root=fs.realpathSync(stateRoot);
  const stateFile=privatePath(root,'adaptive');
  need(fs.existsSync(stateFile)&&
    fs.lstatSync(stateFile).isFile()&&
    !fs.lstatSync(stateFile).isSymbolicLink(),
    'PRIVATE_GITHUB_RESTORE_STATE_MISSING');
  const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));
  need(state?.schema===1&&
    typeof state.scopeKey==='string'&&
    typeof state.runId==='string',
    'PRIVATE_GITHUB_RESTORE_STATE_INVALID');
  const witnesses=pendingWitnesses(state);
  if(!witnesses.length)return {restored:0,pending:0};
  const {real}=witnessRoot(privateWitnessDir,root);
  let restored=0;
  for(const [ref,digest] of witnesses){
    const from=path.join(root,WITNESS_PREFIX,ref);
    // Git checkout restores tracked blobs with ordinary worktree modes.
    // Their SHA must be verified; the private local copy is always 0600.
    const bytes=witnessBytes(from,digest,{requirePrivateMode:false});
    const target=path.join(real,ref);
    if(fs.existsSync(target)){
      need(sha256(witnessBytes(target,digest))===digest,
        'PRIVATE_GITHUB_RESTORE_WITNESS_CONFLICT');
    }else{
      writeExclusive(target,bytes);
      restored++;
    }
  }
  return {restored,pending:witnesses.length};
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
