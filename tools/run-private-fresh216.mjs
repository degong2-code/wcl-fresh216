#!/usr/bin/env node
/**
 * Runs only on an owner-provisioned private persistent Linux volume.
 * No GitHub Actions secrets/artifacts, player-name console output, or
 * implicit live WCL invocation. Defaults to status-only.
 *
 * FRESH216_PRIVATE_DIR=/absolute/private/volume/fresh216
 * node tools/run-private-fresh216.mjs init
 * node tools/run-private-fresh216.mjs status
 * node tools/run-private-fresh216.mjs collect --max-requests 1 --max-points 20 --reserve-points 10
 * node tools/run-private-fresh216.mjs export
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {
 openPrivateCohortStore,readPrivateCohortStatus,collectPrivateCohort,
 makePrivateWclTransport,exportPrivateCohort,withPrivateCohortOwnerLease
} from '../src/adapters/private-fresh-cohort-host.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const SCOPE='heroic:2026-10-22_27:latest:source';
const argsToObject=args=>{
  const allowed=['--max-requests','--max-points','--reserve-points'];
  const opts={mode:args[0]??'status'};
  if(!['init','status','collect','export'].includes(opts.mode))
    throw Error('PRIVATE_HOST_MODE_INVALID');
  for(let i=1;i<args.length;i+=2){
    const key=args[i],value=args[i+1];
    if(!allowed.includes(key)||value==null||opts[key]!==undefined)
      throw Error('PRIVATE_HOST_OPTIONS_INVALID');
    if(!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value))
      throw Error('PRIVATE_HOST_OPTIONS_INVALID');
    opts[key]=Number(value);
  }
  if(opts.mode!=='collect'&&allowed.some(k=>opts[k]!==undefined))
    throw Error('PRIVATE_HOST_OPTIONS_INVALID');
  return {mode:opts.mode,
    maxRequests:opts['--max-requests']??1,
    maxObservedPoints:opts['--max-points']??20,
    reservePoints:opts['--reserve-points']??10};
};
export function privateSourceIdentity(repoRoot=root){
  // A clean, immutable source SHA is part of the checkpoint identity.
  const git=(...a)=>execFileSync('git',['-C',repoRoot,...a],
    {encoding:'utf8',timeout:10000,stdio:['ignore','pipe','ignore']}).trim();
  let commit,dirty;
  try{
    commit=git('rev-parse','HEAD');
    dirty=git('status','--porcelain','--untracked-files=no');
  }catch{throw Error('PRIVATE_HOST_GIT_IDENTITY_UNKNOWN');}
  if(!/^[0-9a-f]{40}$/.test(commit)||dirty)
    throw Error('PRIVATE_HOST_UNVERIFIED_SOURCE_WORKTREE');
  return commit;
}
export async function executePrivateCohortCli({
 args=process.argv.slice(2),env=process.env,
 repoRoot=root,fetchImpl=fetch,write=console.log
}={}){
  const options=argsToObject(args),privateDir=env.FRESH216_PRIVATE_DIR;
  if(!privateDir)throw Error('PRIVATE_HOST_PRIVATE_DIR_NOT_SET');
  const sourceCommit=privateSourceIdentity(repoRoot);
  const store=openPrivateCohortStore({
    privateDir,repoRoot,scopeKey:SCOPE,sourceCommit,
    initialize:options.mode==='init'
  });
  if(options.mode==='init'||options.mode==='status'){
    const output=readPrivateCohortStatus({store,scopeKey:SCOPE,sourceCommit});
    write(JSON.stringify({mode:options.mode,...output}));
    return output;
  }
  return withPrivateCohortOwnerLease(privateDir,async()=>{
    if(options.mode==='export'){
      const receipt=exportPrivateCohort({
        store,scopeKey:SCOPE,sourceCommit,privateDir
      });
      write(JSON.stringify(receipt));return receipt;
    }
    // Do not request OAuth if the checkpoint is already unsafe or complete.
    const before=readPrivateCohortStatus({store,scopeKey:SCOPE,sourceCommit});
    if(['NEEDS_REVIEW','SOURCE_COMPLETE'].includes(before.run.stage)){
      write(JSON.stringify({mode:'collect',...before,
        attempted:false}));return before;
    }
    const transport=await makePrivateWclTransport({
      clientId:env.WCL_CLIENT_ID,clientSecret:env.WCL_CLIENT_SECRET,
      fetchImpl
    });
    const receipt=await collectPrivateCohort({
      store,scopeKey:SCOPE,sourceCommit,transport,approved:true,
      maxRequests:options.maxRequests,
      maxObservedPoints:options.maxObservedPoints,
      reservePoints:options.reservePoints
    });
    write(JSON.stringify({mode:'collect',...receipt}));
    return receipt;
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===
  fileURLToPath(import.meta.url)){
  try{await executePrivateCohortCli();}
  catch(e){
    const code=/^PRIVATE_[A-Z0-9_]+$/.test(e?.message??'')?
      e.message:'PRIVATE_HOST_FAILED_REQUIRES_REVIEW';
    process.stderr.write(code+'\n');
    process.exitCode=1;
  }
}
