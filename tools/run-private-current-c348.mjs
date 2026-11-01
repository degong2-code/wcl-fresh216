#!/usr/bin/env node
/**
 * Status/registration only, on a PRIVATE GitHub Actions controller.
 * A=immutable 21600 TotalDPS slots; C=immutable 18829+231 deltas;
 * Priority=immutable pre-delta map; existing adaptive state is the only
 * mutable checkpoint. NO WCL/OAuth/secret, archive/C/Sheets writes.
 */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {brotliDecompressSync} from 'node:zlib';
import {shaBytes,shaObject,SOURCE_SHA256,BASE_UNION_SHA256}
  from './lib/fresh216-c-delta.mjs';
import {derivePinnedFresh216SourceSlots}
  from '../src/adapters/private-fresh-cohort-host.mjs';
import {buildCurrentCRecoveryPlan}
  from '../src/adapters/fresh216-current-c-recovery.mjs';
import {
  commitState,ADAPTIVE_STATE_PATH,ADAPTIVE_STATE_BRANCH
} from './run-private-github-fresh216.mjs';

const need=(ok,code)=>{if(!ok)throw Error(code);};
const PRODUCT_COMMIT=process.env.FRESH216_APPROVED_PRODUCT_SHA;
const SOURCE_COMMIT='39573a118f2a57f9dc6758936e9d73e9aa6cebf5';
const C_COMMIT='d56befacce6ff8062878ed3a4edec6a55cd91b07';
const PRIORITY_COMMIT='811c4e67878f9b70e420fccb4ecf84301d211223';
const SCOPE='heroic:2026-10-22_27:latest:source';
const A_FILE='projects/wcl-fresh216/private-source/fresh216-checkpoint.json';
const C_FILE='projects/wcl-fresh216/derived-c-v1/union-c-v1.json.br';
const DELTA_DIR='projects/wcl-fresh216/c-deltas-v1';
const PRIORITY_FILE='projects/wcl-fresh216/recovery-priority-v1/ordered-fights-v1.json.br';
const A_BLOB='780afe4498adc07c1477021d4d41a5792972a431';
const C_BLOB='0875784cf74ad1de48165e705be1036b93824e23';
const PRIORITY_BLOB='89d43e811b3125bf13844e8c0760859856916f07';
const PRIORITY_SHA='441afb137c70bf9b70911eece8e056229a96ed242a187023c79d277098218c5a';
const PRIORITY_UNCOMPRESSED_SHA='bb7f5653cf0af5f222bac2d85be57334ced4d5b0b05bfa82ad12c23c565958af';
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{
  encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:25000
}).trim();
const productRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const [mode,sourceIn,cIn,priorityIn,stateIn]=process.argv.slice(2);
function checkoutRoot(dir,sha,code){
  need(typeof dir==='string'&&path.isAbsolute(dir),code+'_ROOT_INVALID');
  const root=fs.realpathSync(dir);
  need(git(root,'rev-parse','HEAD')===sha&&
    git(root,'status','--porcelain','--untracked-files=all')==='',
    code+'_CHECKOUT_DRIFT');
  return root;
}
async function run(){
  need(['preview','register'].includes(mode)&&
    process.env.GITHUB_ACTIONS==='true'&&
    process.env.GITHUB_REPOSITORY==='degong2-code/ai-project-lab'&&
    process.env.GITHUB_REF==='refs/heads/work/fresh216-private-actions',
    'FRESH216_RECOVERY_PRIVATE_ACTIONS_ONLY');
  need(mode!=='register'||process.env.FRESH216_REGISTER_CURRENT_C348==='true',
    'FRESH216_RECOVERY_REGISTER_NOT_AUTHORIZED');
  const sourceRoot=checkoutRoot(sourceIn,SOURCE_COMMIT,'FRESH216_RECOVERY_SOURCE');
  const cRoot=checkoutRoot(cIn,C_COMMIT,'FRESH216_RECOVERY_C');
  const priorityRoot=checkoutRoot(priorityIn,PRIORITY_COMMIT,'FRESH216_RECOVERY_PRIORITY');
  const stateRoot=fs.realpathSync(stateIn);
  need(typeof PRODUCT_COMMIT==='string'&&/^[a-f0-9]{40}$/.test(PRODUCT_COMMIT)&&
    git(productRoot,'rev-parse','HEAD')===PRODUCT_COMMIT&&
    git(productRoot,'status','--porcelain','--untracked-files=all')===''&&
    git(stateRoot,'symbolic-ref','--short','HEAD')===ADAPTIVE_STATE_BRANCH&&
    git(stateRoot,'status','--porcelain','--untracked-files=all')==='',
    'FRESH216_RECOVERY_PRODUCT_OR_STATE_DRIFT');
  need(git(sourceRoot,'rev-parse','HEAD:'+A_FILE)===A_BLOB&&
    git(cRoot,'rev-parse','HEAD:'+C_FILE)===C_BLOB&&
    git(priorityRoot,'rev-parse','HEAD:'+PRIORITY_FILE)===PRIORITY_BLOB,
    'FRESH216_RECOVERY_BLOB_DRIFT');
  const source=JSON.parse(fs.readFileSync(path.join(sourceRoot,A_FILE),'utf8'));
  need(source.schema===1&&source.version===0&&
    source.scopeKey===SCOPE&&
    shaObject(source.sourceRequests)===SOURCE_SHA256,
    'FRESH216_RECOVERY_A_SOURCE_INVALID');
  const slots=derivePinnedFresh216SourceSlots({
    sourceState:source,expectedSourceSha256:SOURCE_SHA256,
    expectedScopeKey:SCOPE
  });
  const compressedPriority=fs.readFileSync(path.join(priorityRoot,PRIORITY_FILE));
  need(shaBytes(compressedPriority)===PRIORITY_SHA,
    'FRESH216_RECOVERY_PRIORITY_SHA_DRIFT');
  const priorityPlain=brotliDecompressSync(compressedPriority);
  need(shaBytes(priorityPlain)===PRIORITY_UNCOMPRESSED_SHA,
    'FRESH216_RECOVERY_PRIORITY_PLAINTEXT_DRIFT');
  const priorityPlan=JSON.parse(priorityPlain.toString('utf8'));
  const stateFile=path.join(stateRoot,ADAPTIVE_STATE_PATH);
  need(fs.existsSync(stateFile)&&fs.lstatSync(stateFile).isFile()&&
    !fs.lstatSync(stateFile).isSymbolicLink(),
    'FRESH216_RECOVERY_ADAPTIVE_STATE_MISSING');
  const current=JSON.parse(fs.readFileSync(stateFile,'utf8'));
  need(current.schema===1&&current.status==='ACTIVE'&&
    current.sourceCodeCommit===SOURCE_COMMIT&&
    current.sourceSha256===SOURCE_SHA256&&
    current.scopeKey===SCOPE,'FRESH216_RECOVERY_CHECKPOINT_PIN_DRIFT');
  const planned=buildCurrentCRecoveryPlan({
    sourceSlots:slots,
    baseCompressedBytes:fs.readFileSync(path.join(cRoot,C_FILE)),
    deltaDirectory:path.join(cRoot,DELTA_DIR),
    priorityPlan,checkpoint:current
  });
  if(mode==='register'&&planned.created){
    const privateDir=fs.mkdtempSync(path.join(
      process.env.RUNNER_TEMP??'/tmp','fresh216-recovery-plan-'),{mode:0o700});
    try{
      const tempFile=path.join(privateDir,'checkpoint.json');
      fs.writeFileSync(tempFile,JSON.stringify(planned.state)+'\n',
        {mode:0o600,flag:'wx'});
      commitState({
        stateRoot,source:tempFile,version:planned.state.version,
        target:'adaptive'
      });
    }finally{
      fs.rmSync(privateDir,{recursive:true,force:true});
    }
  }
  const liveState=JSON.parse(fs.readFileSync(stateFile,'utf8'));
  need(JSON.stringify(liveState)===JSON.stringify(
    mode==='register'?planned.state:current),
    'FRESH216_RECOVERY_REMOTE_STATE_DRIFT');
  const local=git(stateRoot,'rev-parse','HEAD');
  const remote=git(stateRoot,'ls-remote','--heads','origin',
    'refs/heads/'+ADAPTIVE_STATE_BRANCH).trim().split(/\s+/);
  need(local===remote[0]&&
    remote[1]==='refs/heads/'+ADAPTIVE_STATE_BRANCH,
    'FRESH216_RECOVERY_REMOTE_HEAD_DRIFT');
  // Never print the private slot names, Fight IDs or report codes.
  const receipt={
    ...planned.receipt,mode,
    registered:mode==='register'&&planned.created,
    readyGroups:Object.values(liveState.entries||{}).filter(
      x=>x.status==='READY').length,
    remoteHeadConfirmed:true
  };
  console.log(JSON.stringify(receipt));
  if(process.env.GITHUB_STEP_SUMMARY){
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      '### Fresh216 C348 current-gap private preflight: PASS\n'+
      'A '+receipt.sourceSlots+' / C '+receipt.exactC+
      ' / unresolved '+receipt.missing+'; Named queued '+
      receipt.namedQueued+'; Masked excluded '+receipt.maskedQuarantined+
      '; Ready fight groups '+receipt.readyGroups+
      '; Registered now: '+receipt.registered+'\n'+
      'No WCL, OAuth, API points, public archive, C append, canonical promotion or Sheets write.\n');
  }
}
try{await run();}
catch(e){
  const code=/^FRESH216_RECOVERY_[A-Z0-9_]+$/.test(e?.message??'')?
    e.message:'FRESH216_RECOVERY_PRIVATE_PREFLIGHT_FAILED_REQUIRES_REVIEW';
  console.error(code);
  process.exitCode=1;
}
