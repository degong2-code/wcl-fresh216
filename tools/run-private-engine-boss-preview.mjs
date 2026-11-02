#!/usr/bin/env node
/**
 * READ-ONLY private GitHub Actions entrypoint for the shared BossDPS host.
 *
 * Uses only the immutable already-recorded A checkpoint. No WCL/OAuth,
 * secrets, commitState, Sheets, actor rows or paid execution are available.
 * A complete A scope is a readiness prerequisite, NOT implicit approval.
 */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {inspectFreshBossHostReadiness}
  from '../src/core/fresh-boss-host-readiness.mjs';

const need=(v,c)=>{if(!v)throw Error(c);};
const sha40=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{
  encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:15000,
  env:{...process.env,GIT_TERMINAL_PROMPT:'0'}
}).trim();

export function validatePrivateBossPreviewContext({
  env=process.env,sourceStateHead,expectedSourceHead,
  expectedScopeKey,expectedSourceCommit,bossJobsPerRequest
}={}){
  need(env.GITHUB_ACTIONS==='true'&&
    env.GITHUB_REPOSITORY==='degong2-code/ai-project-lab'&&
    env.GITHUB_EVENT_NAME==='push'&&
    env.GITHUB_REF==='refs/heads/work/fresh216-private-actions'&&
    sha40(sourceStateHead)&&sourceStateHead===expectedSourceHead&&
    typeof expectedScopeKey==='string'&&expectedScopeKey.length>0&&
    sha40(expectedSourceCommit)&&
    [8,9].includes(bossJobsPerRequest),
    'BOSS_PRIVATE_READONLY_CONTEXT_NOT_PINNED');
  return true;
}

export function runPrivateFreshBossPreview({
  sourceRoot,sourceRelativePath,expectedSourceHead,
  expectedScopeKey,expectedSourceCommit,bossJobsPerRequest=9,
  env=process.env
}={}){
  need(typeof sourceRoot==='string'&&path.isAbsolute(sourceRoot)&&
    typeof sourceRelativePath==='string'&&
    sourceRelativePath.startsWith('projects/wcl-fresh216/')&&
    !sourceRelativePath.split('/').includes('..'),
    'BOSS_PRIVATE_READONLY_PATH_INVALID');
  const root=fs.realpathSync(sourceRoot);
  const sourceHead=git(root,'rev-parse','HEAD');
  validatePrivateBossPreviewContext({
    env,sourceStateHead:sourceHead,expectedSourceHead,
    expectedScopeKey,expectedSourceCommit,bossJobsPerRequest
  });
  need(git(root,'symbolic-ref','--short','HEAD')===
      'work/fresh216-engine-source-candidate-20261102'&&
    git(root,'status','--porcelain','--untracked-files=all')===''&&
    /(?:^|[:/])degong2-code\/ai-project-lab(?:\.git)?$/.test(
      git(root,'remote','get-url','origin')),
    'BOSS_PRIVATE_READONLY_REPOSITORY_INVALID');
  const filename=path.resolve(root,sourceRelativePath);
  need(filename.startsWith(root+path.sep)&&
    fs.existsSync(filename)&&
    fs.lstatSync(filename).isFile()&&
    !fs.lstatSync(filename).isSymbolicLink()&&
    fs.statSync(filename).size>0&&
    fs.statSync(filename).size<64*1024*1024,
    'BOSS_PRIVATE_READONLY_CHECKPOINT_INVALID');
  const state=JSON.parse(fs.readFileSync(filename,'utf8'));
  const out=inspectFreshBossHostReadiness({
    sourceState:state,expectedScopeKey,expectedSourceCommit,
    bossJobsPerRequest
  });
  return {status:'BOSS_PRIVATE_SOURCE_READONLY_ATTESTED',...out,
    sourceStateHead:sourceHead};
}

const cli=path.resolve(fileURLToPath(import.meta.url));
if(process.argv[1]&&path.resolve(process.argv[1])===cli){
  try{
    need(process.argv.length===8,
      'BOSS_PRIVATE_READONLY_ARGUMENTS_REQUIRED');
    const r=runPrivateFreshBossPreview({
      sourceRoot:path.resolve(process.argv[2]),
      sourceRelativePath:process.argv[3],
      expectedSourceHead:process.argv[4],
      expectedScopeKey:process.argv[5],
      expectedSourceCommit:process.argv[6],
      bossJobsPerRequest:Number(process.argv[7])
    });
    console.log(JSON.stringify(r)); // Counts and immutable SHAs only.
  }catch(e){
    console.error(/^BOSS_PRIVATE_[A-Z0-9_]+$/.test(e?.message??'')||
      /^BOSS_HOST_[A-Z0-9_]+$/.test(e?.message??'')?
      e.message:'BOSS_PRIVATE_READONLY_ATTESTATION_FAILED');
    process.exitCode=1;
  }
}
