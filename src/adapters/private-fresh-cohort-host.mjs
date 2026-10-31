/**
 * Private, persistent WCL Fresh216 host boundary.
 *
 * This is intentionally NOT a GitHub Actions paid job. Raw actor data stays
 * in the existing JsonCheckpointStore on a private Linux volume. Nothing
 * containing player names, report IDs, tokens or absolute paths is logged.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {JsonCheckpointStore} from './json-checkpoint-store.mjs';
import {newCheckpoint,checkpointStats,recoverCheckpoint} from '../core/checkpoint.mjs';
import {makeFreshDatedHeroicManifest,runOneFreshCohortBatch,
  nextFreshCohortBatch,exportVerifiedFreshCohort
} from '../core/fresh-cohort-source.mjs';

const fail=x=>{throw Error(x);};
const need=(x,c)=>{if(!x)fail(c);};
const under=(p,base)=>p===base||p.startsWith(base+path.sep);
const sha=x=>typeof x==='string'&&/^[0-9a-f]{40}$/.test(x);
const fileName='fresh216-checkpoint.json';
const assertState=(state,scopeKey,sourceCommit)=>{
  need(state?.schema===1&&state.scopeKey===scopeKey&&
    state.sourceCodeCommit===sourceCommit,
    'PRIVATE_HOST_CHECKPOINT_IDENTITY_DRIFT');
};
const summary=(state,manifest)=>{
  const next=nextFreshCohortBatch(state,manifest);
  const stats=checkpointStats(state);
  return {stage:next.kind,sourceJobsCompleted:next.completedJobs,
    sourceJobsRequired:216,sourceRequests:
      Object.values(state.sourceRequests??{}).length,
    nextBatchIndex:next.batch?.batchIndex??null,
    requestPointsObserved:stats.witnessedPoints,
    pointsConfirmed:stats.pointsTotalConfirmed,
    uncertainAttempts:stats.pointsUnobserved,
    needsReview:stats.counts.NEEDS_REVIEW??0,
    inFlight:stats.counts.IN_FLIGHT??0};
};
/**
 * Require a private local persistent Linux directory, outside any public
 * checkout. GitHub Actions ephemeral disks must not be used as a "host".
 * No support for unverified Windows ACLs or symlinked directory roots.
 */
export function ensurePrivateCohortDirectory(privateDir,repoRoot){
  need(process.platform==='linux','PRIVATE_HOST_LINUX_VOLUME_REQUIRED');
  need(typeof privateDir==='string'&&path.isAbsolute(privateDir)&&
    typeof repoRoot==='string'&&path.isAbsolute(repoRoot),
    'PRIVATE_HOST_ABSOLUTE_ROOTS_REQUIRED');
  const repo=fs.realpathSync(repoRoot);
  need(!fs.existsSync(privateDir)||!fs.lstatSync(privateDir).isSymbolicLink(),
    'PRIVATE_HOST_SYMLINK_ROOT_FORBIDDEN');
  fs.mkdirSync(privateDir,{recursive:true,mode:0o700});
  const folder=fs.realpathSync(privateDir);
  need(!under(folder,repo)&&!under(repo,folder),
    'PRIVATE_HOST_PUBLIC_CHECKOUT_FORBIDDEN');
  need((fs.statSync(folder).mode&0o077)===0,
    'PRIVATE_HOST_PERMISSIONS_NOT_PRIVATE');
  // Refuse nesting inside other Git working trees even when repoRoot differs.
  for(let dir=folder;dir!==path.dirname(dir);dir=path.dirname(dir)){
    if(fs.existsSync(path.join(dir,'.git')))
      fail('PRIVATE_HOST_GIT_WORKTREE_FORBIDDEN');
  }
  return folder;
}
export function openPrivateCohortStore({
  privateDir,repoRoot,scopeKey,sourceCommit,initialize=false
}={}){
  need(sha(sourceCommit)&&typeof scopeKey==='string'&&scopeKey,
    'PRIVATE_HOST_SOURCE_COMMIT_INVALID');
  const folder=ensurePrivateCohortDirectory(privateDir,repoRoot);
  const checkpoint=path.join(folder,fileName);
  if(fs.existsSync(checkpoint)){
    need(!fs.lstatSync(checkpoint).isSymbolicLink(),
      'PRIVATE_HOST_SYMLINK_FILE_FORBIDDEN');
    need((fs.statSync(checkpoint).mode&0o077)===0,
      'PRIVATE_HOST_CHECKPOINT_MODE_INVALID');
  }else{
    need(initialize,'PRIVATE_HOST_REQUIRES_INIT');
    const store=new JsonCheckpointStore(checkpoint);
    const fresh=newCheckpoint(scopeKey,'fresh216-'+sourceCommit.slice(0,12));
    fresh.sourceCodeCommit=sourceCommit;
    store.init(fresh);
  }
  const store=new JsonCheckpointStore(checkpoint);
  assertState(store.read(),scopeKey,sourceCommit);
  return store;
}
/**
 * A process-wide lease prevents two collectors from interleaving paid
 * operations between the per-transition locks. A killed process leaves
 * this lease in place for manual review; never silently clear it.
 */
export async function withPrivateCohortOwnerLease(privateDir,operation){
  need(typeof operation==='function','PRIVATE_HOST_LEASE_CALLBACK_REQUIRED');
  const lease=path.join(fs.realpathSync(privateDir),'.collector-owner-lock');
  try{fs.mkdirSync(lease,{mode:0o700});}
  catch{fail('PRIVATE_HOST_OWNER_LOCKED_REVIEW_REQUIRED');}
  try{return await operation();}
  finally{fs.rmdirSync(lease);}
}

/** Obtain OAuth before starting a charged source-request checkpoint. */
export async function makePrivateWclTransport({
  clientId,clientSecret,fetchImpl=fetch,timeoutMs=45000
}={}){
  need(typeof clientId==='string'&&clientId&&
    typeof clientSecret==='string'&&clientSecret&&
    typeof fetchImpl==='function'&&Number.isSafeInteger(timeoutMs)&&
    timeoutMs>=1000&&timeoutMs<=120000,
    'PRIVATE_WCL_TRANSPORT_CONFIG_INVALID');
  const credentials=Buffer.from(clientId+':'+clientSecret).toString('base64');
  let auth;
  try{
    auth=await fetchImpl('https://www.warcraftlogs.com/oauth/token',{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(timeoutMs),
      headers:{Authorization:'Basic '+credentials,
        'Content-Type':'application/x-www-form-urlencoded'},
      body:'grant_type=client_credentials'
    });
  }catch{fail('PRIVATE_WCL_OAUTH_NETWORK_UNKNOWN');}
  need(auth?.status===200,'PRIVATE_WCL_OAUTH_REFUSED');
  const token=await auth.json().catch(()=>null);
  need(typeof token?.access_token==='string'&&token.access_token.length>0,
    'PRIVATE_WCL_OAUTH_RESPONSE_INVALID');
  return async query=>{
    let response;
    try{
      response=await fetchImpl('https://www.warcraftlogs.com/api/v2/client',{
        method:'POST',redirect:'error',signal:AbortSignal.timeout(timeoutMs),
        headers:{Authorization:'Bearer '+token.access_token,
          'Content-Type':'application/json'},
        body:JSON.stringify(query)
      });
    }catch{fail('PRIVATE_WCL_GRAPHQL_NETWORK_UNKNOWN');}
    let rawBodyBytes=null,body=null;
    if(typeof response.arrayBuffer==='function'){
      rawBodyBytes=Buffer.from(await response.arrayBuffer());
      try{body=JSON.parse(rawBodyBytes.toString('utf8'));}
      catch{/* The runner records an uncertain response; never redispatch. */}
    }else{
      // Backward-compatible transport test/adapter path. Archive-backed
      // collection rejects this path because it lacks exact Fetch bytes.
      body=await response.json().catch(()=>null);
    }
    // Exact Fetch body bytes stay in the private witness path only.
    return {httpStatus:response.status,body,
      ...(rawBodyBytes?{rawBodyBytes}:{})};
  };
}
/**
 * Exact one-request progress primitive. Full-run modes call repeatedly but
 * never dispatch a second batch if the first is uncertain or unpersisted.
 */
export async function collectPrivateCohort({
  store,scopeKey,sourceCommit,transport,
  approved=false,maxRequests=1,maxObservedPoints=20,reservePoints=10,
  clock=Date.now
}={}){
  const manifest=makeFreshDatedHeroicManifest(scopeKey);
  assertState(store.read(),scopeKey,sourceCommit);
  need(approved===true&&typeof transport==='function'&&
    Number.isSafeInteger(maxRequests)&&maxRequests>=1&&maxRequests<=32&&
    typeof maxObservedPoints==='number'&&
    Number.isFinite(maxObservedPoints)&&maxObservedPoints>0&&
    typeof reservePoints==='number'&&Number.isFinite(reservePoints)&&
    reservePoints>0,'PRIVATE_HOST_PAID_SCOPE_NOT_APPROVED');
  const receipts=[];
  for(let i=0;i<maxRequests;i++){
    const prior=store.read();assertState(prior,scopeKey,sourceCommit);
    const next=nextFreshCohortBatch(prior,manifest);
    if(next.kind==='SOURCE_COMPLETE'||next.kind==='NEEDS_REVIEW')break;
    const result=await runOneFreshCohortBatch({
      store,manifest,mode:'execute',approved:true,transport,clock,
      admissionPolicy:{notBeforeMs:0,maxObservedPoints,reservePoints},
      jobsPerRequest:8
    });
    receipts.push({status:result.status,attempted:result.attempted??false,
      sourceJobsCompleted:result.completedJobsAfter??null,
      requestPoints:result.observedRequestPoints??null,
      elapsedMs:result.wallMs??null});
    if(result.status!=='RECORDED')break;
  }
  return {receiptSchema:1,verification:'SOURCE_ONLY_NOT_BOSSDPS',
    sourceCommit,scopeKey,run:summary(store.read(),manifest),operations:receipts};
}
export function readPrivateCohortStatus({store,scopeKey,sourceCommit}={}){
  const manifest=makeFreshDatedHeroicManifest(scopeKey);
  assertState(store.read(),scopeKey,sourceCommit);
  return {receiptSchema:1,sourceCommit,scopeKey,
    run:summary(store.read(),manifest)};
}
export function exportPrivateCohort({
  store,scopeKey,sourceCommit,privateDir
}={}){
  const state=store.read();
  assertState(state,scopeKey,sourceCommit);
  const manifest=makeFreshDatedHeroicManifest(scopeKey);
  const result=exportVerifiedFreshCohort(state,manifest);
  const folder=fs.realpathSync(privateDir);
  const target=path.join(folder,'fresh216-total100-verified.json');
  need(!fs.existsSync(target),'PRIVATE_HOST_EXPORT_ALREADY_PRESENT');
  const payload=JSON.stringify({schema:1,sourceCommit,
    manifest,slots:result.slots})+'\n';
  const byteSha=createHash('sha256').update(payload).digest('hex');
  const tmp=target+'.'+byteSha.slice(0,12)+'.tmp';
  const fd=fs.openSync(tmp,'wx',0o600);
  try{fs.writeFileSync(fd,payload);fs.fsyncSync(fd);}
  finally{fs.closeSync(fd);}
  fs.renameSync(tmp,target);
  const dirfd=fs.openSync(folder,'r');
  try{fs.fsyncSync(dirfd);}finally{fs.closeSync(dirfd);}
  return {receiptSchema:1,scopeKey,sourceCommit,
    result:'PRIVATE_EXPORT_COMPLETE',jobs:216,slots:21600,
    fileSha256:byteSha,sourcePoints:result.summary.observedRequestPoints,
    rawRowsPublic:false};
}
