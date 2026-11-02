/**
 * PRIVATE Git adapter for the previously HMAC-verified REDACTED stage.
 * This Git branch must contain NO raw WCL responses or player identities.
 * It is separate from the source, C candidate and adaptive checkpoint.
 * If a Git push is ambiguous, fail closed; never auto retry.
 */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {preparePrivateSignedWaveStage,
  SIGNED_STAGE_INDEX_DIR}
  from './fresh216-signed-evidence-relay.mjs';

export const PRIVATE_REDACTED_STAGE_BRANCH=
  'work/fresh216-private-redacted-stage';
const need=(ok,code)=>{if(!ok)throw Error(code);};
const sha40=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
const git=(root,args)=>execFileSync('git',['-C',root,...args],{
  encoding:'utf8',stdio:['ignore','pipe','pipe'],
  timeout:25000,maxBuffer:8*1024*1024
}).trim();
const sha256=text=>createHash('sha256').update(text,'utf8').digest('hex');
const under=(target,root)=>target.startsWith(root+path.sep);
export function persistPrivateSignedWaveStage({
  repoRoot,archives,manifest,hmacKey,privateReportStateCommit,
  gitCommand=git
}={}){
  need(typeof repoRoot==='string'&&path.isAbsolute(repoRoot)&&
    typeof gitCommand==='function',
    'SIGNED_STAGE_GIT_CONFIG_INVALID');
  // This always authenticates HMAC, exact redacted shape and wave linkage
  // BEFORE creating any file or performing any Git write.
  const staged=preparePrivateSignedWaveStage({
    archives,manifest,hmacKey,privateReportStateCommit
  });
  const root=fs.realpathSync(repoRoot);
  need(fs.statSync(root).isDirectory(),'SIGNED_STAGE_GIT_ROOT_INVALID');
  const run=(...args)=>{
    try{return String(gitCommand(root,args)).trim();}
    catch{throw Error('SIGNED_STAGE_GIT_UNKNOWN_OUTCOME_STOP');}
  };
  need(run('rev-parse','--show-toplevel')===root&&
    run('symbolic-ref','--short','HEAD')===PRIVATE_REDACTED_STAGE_BRANCH,
    'SIGNED_STAGE_GIT_BRANCH_DRIFT');
  need(/(?:^|[:/])degong2-code\/ai-project-lab(?:\.git)?$/.test(
    run('remote','get-url','origin')),
    'SIGNED_STAGE_GIT_REPO_DRIFT');
  const remote=()=>{
    const [sha,ref]=run('ls-remote','--heads','origin',
      'refs/heads/'+PRIVATE_REDACTED_STAGE_BRANCH).split(/\s+/);
    need(sha40(sha)&&ref==='refs/heads/'+PRIVATE_REDACTED_STAGE_BRANCH,
      'SIGNED_STAGE_GIT_REMOTE_REF_INVALID');
    return sha;
  };
  const before=run('rev-parse','HEAD');
  need(sha40(before)&&remote()===before,
    'SIGNED_STAGE_GIT_STALE_REMOTE');
  need(run('status','--porcelain','--untracked-files=all')==='',
    'SIGNED_STAGE_GIT_DIRTY_STOP');
  const all=[...staged.files,{path:staged.indexPath,
    content:staged.indexContent,sha256:sha256(staged.indexContent)}];
  need(all.length>=2&&all.length<=10&&
    staged.indexPath.startsWith(SIGNED_STAGE_INDEX_DIR),
    'SIGNED_STAGE_GIT_FILE_SET_INVALID');
  const newPaths=[];
  for(const file of all){
    need(typeof file.path==='string'&&
      (file.path.startsWith('evidence/fresh216/actor-proof/')||
       file.path.startsWith('evidence/fresh216/waves/')||
       file.path===staged.indexPath)&&
      !file.path.includes('..')&&
      sha256(file.content)===file.sha256,
      'SIGNED_STAGE_GIT_PATH_OR_HASH_INVALID');
    const dst=path.resolve(root,file.path);
    need(under(dst,root),'SIGNED_STAGE_GIT_PATH_ESCAPE');
    const parent=path.dirname(dst);
    // Never follow a symlink in any parent component.
    let dir=root;
    for(const piece of path.relative(root,parent).split(path.sep)){
      if(!piece||piece==='.')continue;
      dir=path.join(dir,piece);
      if(fs.existsSync(dir)){
        need(fs.lstatSync(dir).isDirectory()&&
          !fs.lstatSync(dir).isSymbolicLink(),
          'SIGNED_STAGE_GIT_SYMLINK_PARENT');
      }else fs.mkdirSync(dir,{mode:0o700});
    }
    if(fs.existsSync(dst)){
      need(fs.lstatSync(dst).isFile()&&
        !fs.lstatSync(dst).isSymbolicLink()&&
        fs.readFileSync(dst,'utf8')===file.content,
        'SIGNED_STAGE_GIT_EXISTING_CONFLICT');
      need(run('cat-file','-e','HEAD:'+file.path)===''&&
        run('hash-object','--',file.path)===
          run('rev-parse','HEAD:'+file.path),
        'SIGNED_STAGE_GIT_EXISTING_NOT_TRACKED');
    }else{
      const fd=fs.openSync(dst,'wx',0o600);
      try{fs.writeFileSync(fd,file.content,'utf8');fs.fsyncSync(fd);}
      finally{fs.closeSync(fd);}
      newPaths.push(file.path);
    }
  }
  if(!newPaths.length){
    need(run('status','--porcelain','--untracked-files=all')==='',
      'SIGNED_STAGE_GIT_REPLAY_DIRTY');
    return {status:'PRIVATE_SIGNED_STAGE_REMOTE_CONFIRMED',
      reused:true,privateStageCommit:before,
      waveSha256:manifest.waveSha256,files:all.length};
  }
  const expected=newPaths.slice().sort();
  const status=run('status','--porcelain','--untracked-files=all')
    .split('\n').filter(Boolean).sort();
  need(JSON.stringify(status)===JSON.stringify(
    expected.map(p=>'?? '+p).sort()),
    'SIGNED_STAGE_GIT_UNEXPECTED_CHANGES');
  run('add','--',...newPaths);
  const stagedPaths=run('diff','--cached','--name-only')
    .split('\n').filter(Boolean).sort();
  need(JSON.stringify(stagedPaths)===JSON.stringify(expected),
    'SIGNED_STAGE_GIT_STAGING_DRIFT');
  run('-c','user.name=Fresh216 State',
    '-c','user.email=fresh216-state@users.noreply.github.com',
    'commit','-m','fresh216: stage verified redacted wave '+
      manifest.waveSha256.slice(0,12));
  const committed=run('rev-parse','HEAD');
  need(sha40(committed)&&run('rev-parse','HEAD^')===before,
    'SIGNED_STAGE_GIT_PARENT_DRIFT');
  run('push','origin','HEAD:refs/heads/'+PRIVATE_REDACTED_STAGE_BRANCH);
  need(remote()===committed,
    'SIGNED_STAGE_GIT_REMOTE_CONFIRMATION_STOP');
  for(const file of all){
    need(run('rev-parse','HEAD:'+file.path)===
      run('hash-object','--',file.path),
      'SIGNED_STAGE_GIT_BLOB_READBACK_STOP');
  }
  return {status:'PRIVATE_SIGNED_STAGE_REMOTE_CONFIRMED',
    reused:false,privateStageCommit:committed,
    waveSha256:manifest.waveSha256,files:all.length};
}
