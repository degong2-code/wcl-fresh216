/**
 * Persist an already verified create-only C-delta to the isolated
 * PRIVATE candidate Git branch. No WCL/Archive/canonical/Sheets I/O.
 * Git status, remote HEAD, exact file and binary blob are verified.
 * A push failure is terminal; never blindly retry an uncertain write.
 */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {readCDelta,shaBytes} from './fresh216-c-delta.mjs';
import {readFresh216CDeltaParts} from './fresh216-archive-c-delta.mjs';

export const PRIVATE_C_CANDIDATE_BRANCH='work/fresh216-private-c-delta-candidate';
export const PRIVATE_C_CANDIDATE_BASE='d56befacce6ff8062878ed3a4edec6a55cd91b07';
export const PRIVATE_C_CANDIDATE_DIR='projects/wcl-fresh216/c-deltas-v1';
const need=(x,code)=>{if(!x)throw Error(code);};
const sha=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const commit=s=>typeof s==='string'&&/^[a-f0-9]{40}$/.test(s);
const cmd=(root,args)=>execFileSync('git',['-C',root,...args],{
  encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:25000
}).trim();

export function commitFresh216CandidateDelta({
  repoRoot,appended,minIndex=231,gitCommand=cmd
}={}){
  need(typeof repoRoot==='string'&&path.isAbsolute(repoRoot)&&
    appended?.status==='APPENDED'&&
    Number.isSafeInteger(appended.deltaIndex)&&
    appended.deltaIndex>=minIndex&&
    Number.isSafeInteger(minIndex)&&minIndex>=0&&
    Number.isSafeInteger(appended.addedExactC)&&appended.addedExactC>0&&
    sha(appended.deltaSha256)&&
    typeof appended.file==='string'&&path.isAbsolute(appended.file),
    'PRIVATE_C_REMOTE_INPUT_INVALID');
  const root=fs.realpathSync(repoRoot);
  const run=(...args)=>{
    try{return String(gitCommand(root,args)).trim();}
    catch{throw Error('PRIVATE_C_REMOTE_GIT_UNKNOWN_STOP');}
  };
  need(run('rev-parse','--show-toplevel')===root&&
    run('symbolic-ref','--short','HEAD')===PRIVATE_C_CANDIDATE_BRANCH,
    'PRIVATE_C_REMOTE_BRANCH_DRIFT');
  need(/(?:^|[:/])degong2-code\/ai-project-lab(?:\.git)?$/.test(
    run('remote','get-url','origin')),
    'PRIVATE_C_REMOTE_REPOSITORY_MISMATCH');
  const remoteHead=()=>{
    const [hash,ref]=run('ls-remote','--heads','origin',
      'refs/heads/'+PRIVATE_C_CANDIDATE_BRANCH).split(/\s+/);
    need(commit(hash)&&ref==='refs/heads/'+PRIVATE_C_CANDIDATE_BRANCH,
      'PRIVATE_C_REMOTE_REF_MISSING');
    return hash;
  };
  const before=run('rev-parse','HEAD');
  need(commit(before)&&before===remoteHead(),
    'PRIVATE_C_REMOTE_STALE_HEAD');
  const filename='delta-'+String(appended.deltaIndex).padStart(4,'0')+'.json.br';
  const relative=PRIVATE_C_CANDIDATE_DIR+'/'+filename;
  const expected=path.join(root,relative);
  need(path.resolve(appended.file)===expected&&
    fs.existsSync(expected)&&fs.lstatSync(expected).isFile()&&
    !fs.lstatSync(expected).isSymbolicLink()&&
    fs.realpathSync(expected)===expected,
    'PRIVATE_C_REMOTE_FILE_UNSAFE');
  const folder=path.dirname(expected);
  need(fs.realpathSync(folder)===folder&&
    fs.lstatSync(folder).isDirectory()&&
    !fs.lstatSync(folder).isSymbolicLink(),
    'PRIVATE_C_REMOTE_FOLDER_UNSAFE');
  const parts=readFresh216CDeltaParts(folder);
  need(parts.length===appended.deltaIndex+1&&
    shaBytes(parts.at(-1))===appended.deltaSha256,
    'PRIVATE_C_REMOTE_CHAIN_DRIFT');
  const decoded=readCDelta(parts.at(-1),{
    expectedIndex:appended.deltaIndex,
    expectedPreviousSha256:appended.deltaIndex?
      shaBytes(parts[appended.deltaIndex-1]):null
  });
  need(decoded.rows.length===appended.addedExactC,
    'PRIVATE_C_REMOTE_PROOF_COUNT_DRIFT');
  const status=run('status','--porcelain','--untracked-files=all');
  const blob=()=>run('hash-object','--',relative);
  if(status===''){
    need(run('rev-parse','HEAD:'+relative)===blob(),
      'PRIVATE_C_REMOTE_EXISTING_BLOB_CONFLICT');
    return {status:'REMOTE_CONFIRMED',reused:true,
      commitSha:before,deltaIndex:appended.deltaIndex,
      deltaSha256:appended.deltaSha256};
  }
  need(status==='?? '+relative&&
    run('diff','--cached','--name-only')===''&&
    run('diff','--name-only')==='',
    'PRIVATE_C_REMOTE_DIRTY_STOP');
  run('add','--',relative);
  need(run('diff','--cached','--name-only')===relative,
    'PRIVATE_C_REMOTE_STAGING_DRIFT');
  run('-c','user.name=Fresh216 State',
    '-c','user.email=fresh216-state@users.noreply.github.com',
    'commit','-m','fresh216: append private candidate C delta '+
    appended.deltaIndex);
  const current=run('rev-parse','HEAD');
  need(commit(current)&&run('rev-parse','HEAD^')===before,
    'PRIVATE_C_REMOTE_PARENT_DRIFT');
  run('push','origin','HEAD:refs/heads/'+PRIVATE_C_CANDIDATE_BRANCH);
  need(remoteHead()===current&&
    run('rev-parse','HEAD:'+relative)===blob(),
    'PRIVATE_C_REMOTE_CONFIRMATION_FAILED_STOP');
  return {status:'REMOTE_CONFIRMED',reused:false,
    commitSha:current,deltaIndex:appended.deltaIndex,
    deltaSha256:appended.deltaSha256};
}

/**
 * Reuse the existing createFresh216ArchiveCDeltaAppender; ensure the
 * private remote commit is confirmed BEFORE a publisher can receive
 * APPENDED. Do not catch or auto-retry an uncertain Git operation.
 */
export function withPrivateCandidateGitDurability({
  localAppender,repoRoot,gitCommand=cmd
}={}){
  need(typeof localAppender==='function'&&
    typeof repoRoot==='string'&&path.isAbsolute(repoRoot)&&
    typeof gitCommand==='function',
    'PRIVATE_C_REMOTE_WRAPPER_CONFIG_INVALID');
  const wrapped=async input=>{
    const appended=await localAppender(input);
    if(appended?.status==='NO_NEW_PROOFS')return appended;
    need(appended?.status==='APPENDED',
      'PRIVATE_C_REMOTE_LOCAL_APPENDER_NOT_CONFIRMED');
    const proof=commitFresh216CandidateDelta({
      repoRoot,appended,gitCommand
    });
    need(proof.status==='REMOTE_CONFIRMED'&&
      proof.deltaIndex===appended.deltaIndex&&
      proof.deltaSha256===appended.deltaSha256,
      'PRIVATE_C_REMOTE_WRAPPER_CONFIRMATION_DRIFT');
    return {...appended,privateCandidateCommit:proof.commitSha,
      privateCandidateRemoteConfirmed:true};
  };
  if(typeof localAppender.snapshot==='function')
    wrapped.snapshot=()=>localAppender.snapshot();
  return wrapped;
}
