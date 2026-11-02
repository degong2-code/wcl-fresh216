import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {JsonCheckpointStore} from '../src/adapters/json-checkpoint-store.mjs';
import {planFightFetches} from '../src/core/fetch-plan.mjs';
import {planReportWaves} from '../src/core/report-wave-plan.mjs';
import {newCheckpoint,registerPlan,recoverCheckpoint,checkpointStats}
  from '../src/core/checkpoint.mjs';
import {executeOneReportWave} from '../src/core/report-wave-runner.mjs';
import {runOneAdaptiveStep} from '../src/core/adaptive-collector-runner.mjs';
import {createPrivateWaveWitnessStore}
  from '../src/adapters/private-wave-witness-store.mjs';
import {createGitBackedReportStateCommitProvider}
  from '../src/adapters/private-report-state-commit.mjs';
import {createFresh216EvidencePublisher}
  from '../src/adapters/fresh216-evidence-publisher.mjs';
import {buildActorProofWaveManifest,verifyActorProofArchive,
  verifyActorProofWaveManifest}
  from '../src/core/fresh216-actor-proof-archive.mjs';
import {makeGitDurableStore,commitState,restoreGitAdaptiveWitnesses,
  ADAPTIVE_STATE_PATH,ADAPTIVE_STATE_BRANCH}
  from '../tools/run-private-github-fresh216.mjs';
import {SOURCE_SHA256} from '../tools/lib/fresh216-c-delta.mjs';

const SCOPE='heroic:2026-10-22_27:latest:source';
const KEY='SYNTHETIC_INTEGRATION_HMAC_KEY_NO_EXTERNAL_CREDS_20261101';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{
  encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:15000,
  maxBuffer:32*1024*1024
}).trim();
function fixture(){
  const sourceSlots=[];
  for(let j=0;j<216;j++){
    const jobKey='synthetic-job-'+j;
    const snapshotSha=sha('snapshot:'+jobKey);
    for(let rank=1;rank<=100;rank++){
      const target=j===0&&rank===1;
      sourceSlots.push({
        scopeKey:SCOPE,jobKey,rank,snapshotSha,status:'PENDING',
        name:target?'SyntheticActor':'SyntheticOther',
        className:'Hunter',specName:'Marksmanship',
        totalDps:target?1000:2000,
        startTime:1792594801000,
        reportCode:target?'SYNTHETIC-REPORT':'SYNTH-'+j+'-'+rank,
        fightId:target?10:100000+j*100+rank,
        encounterId:3470,difficulty:4,reportRevision:5,
        filter:'date.2026-10-22.2026-10-27'
      });
    }
  }
  const group=planFightFetches([sourceSlots[0]]).groups[0];
  const wave=planReportWaves({groups:[group]}).waves[0];
  const actor={id:7,name:'SyntheticActor',class:'Hunter',
    spec:'Marksmanship',amount:1000};
  const boss={...actor,amount:700};
  const fight=a=>({fightID:10,encounter:{id:3470},difficulty:4,
    roles:{dps:{characters:[a]}}});
  const body={data:{rateLimitData:{currentRequest:{total:3.25}},
    reportData:{report:{code:'SYNTHETIC-REPORT',revision:5,
      o0:{data:[fight(actor)]},b0:{data:[fight(boss)]}}}}};
  const rawBodyBytes=Buffer.from(JSON.stringify(body));
  return {sourceSlots,group,wave,body,rawBodyBytes};
}
function setup(){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'fresh216-e2e-'));
  const root=path.join(temp,'private-worktree');
  const remote=path.join(temp,'remote.git');
  const localDir=path.join(temp,'local');
  fs.mkdirSync(root,{mode:0o700});
  fs.mkdirSync(localDir,{mode:0o700});
  execFileSync('git',['init','--bare',remote],{stdio:'ignore'});
  execFileSync('git',['-C',root,'init','-b',ADAPTIVE_STATE_BRANCH],
    {stdio:'ignore'});
  git(root,'config','user.name','Fresh216 Synthetic CI');
  git(root,'config','user.email','synthetic@example.invalid');
  git(root,'remote','add','origin',
    'https://github.com/degong2-code/ai-project-lab.git');
  fs.writeFileSync(path.join(root,'README.md'),'SYNTHETIC ONLY\n');
  git(root,'add','README.md');
  git(root,'commit','-m','synthetic initial');
  execFileSync('git',['-C',root,'push',remote,
    'HEAD:refs/heads/'+ADAPTIVE_STATE_BRANCH],{stdio:'ignore'});
  const gitCommand=(cwd,args)=>{
    if(args[0]==='push')
      return git(cwd,'push',remote,args[2]);
    if(args[0]==='ls-remote'){
      const expected=git(remote,'rev-parse',
        'refs/heads/'+ADAPTIVE_STATE_BRANCH);
      return expected+'\trefs/heads/'+ADAPTIVE_STATE_BRANCH;
    }
    return git(cwd,...args);
  };
  function newLocal(subdir,gitRoot){
    const local=path.join(temp,subdir);
    fs.mkdirSync(local,{mode:0o700});
    const privateDir=path.join(local,'private');
    const file=path.join(local,'checkpoint.json');
    const w=createPrivateWaveWitnessStore({
      privateDir,repoRoot:gitRoot,sourceSha256:SOURCE_SHA256
    });
    return {local,file,privateDir,w};
  }
  function durable(file,privateDir,gitRoot){
    const store=new JsonCheckpointStore(file);
    return {store,gitStore:makeGitDurableStore({
      localStore:store,stateRoot:gitRoot,target:'adaptive',
      privateWitnessDir:privateDir,
      persist:args=>commitState({...args,gitCommand})
    })};
  }
  function clone(subdir){
    const checkout=path.join(temp,subdir);
    execFileSync('git',['clone','-b',ADAPTIVE_STATE_BRANCH,remote,checkout],
      {stdio:'ignore'});
    git(checkout,'remote','set-url','origin',
      'https://github.com/degong2-code/ai-project-lab.git');
    return checkout;
  }
  return {temp,root,remote,gitCommand,newLocal,durable,clone};
}
function publisher(sourceSlots,{getReportStateCommit,counts}){
  const archiveStore={
    persistWave:async(archives,{createdAtMs})=>{
      counts.archiveCalls++;
      for(const a of archives)verifyActorProofArchive(a,{
        hmacKey:KEY,expectedSourceSha256:SOURCE_SHA256
      });
      const manifest=buildActorProofWaveManifest({
        archives,hmacKey:KEY,createdAtMs
      });
      const verified=verifyActorProofWaveManifest(manifest,{
        hmacKey:KEY,archives
      });
      return {waveSha256:manifest.waveSha256,
        manifestSha256:manifest.manifestSha256,
        manifestCommitSha:'d'.repeat(40),
        archiveCount:verified.archiveCount,
        verifiedSlots:verified.verifiedSlots,
        unresolvedSlots:verified.unresolvedSlots};
    }
  };
  const cDeltaAppender=async input=>{
    counts.deltaCallbackCalls++;
    counts.verifiedReportCommit=await getReportStateCommit(input);
    assert.match(counts.verifiedReportCommit,/^[a-f0-9]{40}$/);
    assert.equal(input.bridgeResult.proofRows.length,1);
    // Synthetic in-memory receipt ONLY. No actual delta file or public
    // archive is produced; the production appender remains uninvoked.
    return {status:'APPENDED',sourceSha256:SOURCE_SHA256,
      deltaIndex:999,deltaSha256:'e'.repeat(64),addedExactC:1};
  };
  return createFresh216EvidencePublisher({
    sourceSlots,expectedSourceSha256:SOURCE_SHA256,
    expectedScopeKey:SCOPE,hmacKey:KEY,archiveStore,cDeltaAppender
  });
}
test('actual runner + Brotli witness + Git checkpoint + fresh-clone restore + Git provider + publisher synthetic receipt',async()=>{
  const f=fixture(),x=setup();
  try{
    const one=x.newLocal('first',x.root);
    const {store,gitStore}=x.durable(one.file,one.privateDir,x.root);
    store.init(registerPlan(newCheckpoint(SCOPE,'SYNTHETIC-E2E'),
      [f.group]));
    commitState({stateRoot:x.root,source:one.file,
      version:1,target:'adaptive',gitCommand:x.gitCommand});
    const result=await executeOneReportWave({
      store:gitStore,wave:f.wave,
      attemptId:'SYNTHETIC-E2E-WAVE',
      clock:()=>1793450000000,
      transport:async()=>({
        httpStatus:200,body:f.body,rawBodyBytes:f.rawBodyBytes
      }),
      onVerifiedWave:input=>one.w.persist(input)
    });
    assert.equal(result.status,'RECORDED');
    assert.equal(result.verifiedSlots,1);
    assert.equal(checkpointStats(gitStore.read()).evidencePending,1);
    assert.equal(gitStore.read().version,3);
    const pendingCommit=git(x.root,'rev-parse','HEAD');
    assert.equal(pendingCommit,git(x.remote,'rev-parse',
      'refs/heads/'+ADAPTIVE_STATE_BRANCH));
    const afterClone=x.clone('restarted-checkout');
    const two=x.newLocal('second',afterClone);
    const recovered=restoreGitAdaptiveWitnesses({
      stateRoot:afterClone,privateWitnessDir:two.privateDir
    });
    assert.deepEqual(recovered,{restored:1,pending:1});
    const ref=result.witnessRef,witness=two.w.read(ref);
    assert.equal(sha(witness.responseBodyBytes),
      witness.responseBodySha256);
    fs.copyFileSync(path.join(afterClone,ADAPTIVE_STATE_PATH),two.file);
    const {gitStore:second}=x.durable(two.file,two.privateDir,afterClone);
    assert.equal(checkpointStats(second.read()).evidencePending,1);
    const provider=createGitBackedReportStateCommitProvider({
      repoRoot:afterClone,gitCommand:x.gitCommand
    });
    const counts={archiveCalls:0,deltaCallbackCalls:0};
    const publish=publisher(f.sourceSlots,{
      getReportStateCommit:provider,counts
    });
    const status=await runOneAdaptiveStep({
      slots:f.sourceSlots,store:second,mode:'execute',
      archivePublishApproved:true,witnessReader:two.w.read,
      evidencePublisher:publish
    });
    assert.equal(status.status,'COMMITTED');
    assert.equal(status.attempted,false);
    assert.equal(counts.verifiedReportCommit,pendingCommit);
    assert.equal(counts.archiveCalls,1);
    assert.equal(counts.deltaCallbackCalls,1);
    assert.equal(checkpointStats(second.read()).evidenceCommitted,1);
    assert.equal(checkpointStats(second.read()).evidencePending,0);
    assert.equal(git(x.remote,'rev-parse',
      'refs/heads/'+ADAPTIVE_STATE_BRANCH),
      git(afterClone,'rev-parse','HEAD'));
    const third=x.clone('third-checkout');
    const thirdState=JSON.parse(fs.readFileSync(
      path.join(third,ADAPTIVE_STATE_PATH),'utf8'));
    assert.equal(checkpointStats(thirdState).evidenceCommitted,1);
    assert.equal(checkpointStats(thirdState).counts.IN_FLIGHT,0);
    assert.equal(counts.deltaCallbackCalls,1);
  }finally{fs.rmSync(x.temp,{recursive:true,force:true});}
});
test('interrupted in-flight remote checkpoint recovers NEEDS_REVIEW, never auto-reissues a synthetic transport',async()=>{
  const f=fixture(),x=setup();
  try{
    const one=x.newLocal('first',x.root);
    const {store,gitStore}=x.durable(one.file,one.privateDir,x.root);
    store.init(registerPlan(newCheckpoint(SCOPE,'SYNTHETIC-CRASH'),
      [f.group]));
    commitState({stateRoot:x.root,source:one.file,
      version:1,target:'adaptive',gitCommand:x.gitCommand});
    let invoked=0;
    const failAfterMarker=makeGitDurableStore({
      localStore:store,stateRoot:x.root,target:'adaptive',
      privateWitnessDir:one.privateDir,
      persist:({version,...args})=>{
        if(version===2){
          commitState({...args,version,target:'adaptive',
            gitCommand:x.gitCommand});
          throw Error('SYNTHETIC_POWER_LOSS_AFTER_REMOTE_MARKER');
        }
        return commitState({...args,version,target:'adaptive',
          gitCommand:x.gitCommand});
      }
    });
    await assert.rejects(()=>executeOneReportWave({
      store:failAfterMarker,wave:f.wave,attemptId:'CRASH-IN-FLIGHT',
      clock:()=>1793450000000,
      transport:async()=>{invoked++;return {
        httpStatus:200,body:f.body,rawBodyBytes:f.rawBodyBytes
      };}
    }),/SYNTHETIC_POWER_LOSS_AFTER_REMOTE_MARKER/);
    assert.equal(invoked,0);
    const cloned=x.clone('crash-restart');
    const before=JSON.parse(fs.readFileSync(
      path.join(cloned,ADAPTIVE_STATE_PATH),'utf8'));
    assert.equal(checkpointStats(before).counts.IN_FLIGHT,1);
    const after=recoverCheckpoint(before);
    assert.equal(checkpointStats(after).counts.NEEDS_REVIEW,1);
    assert.equal(after.entries[Object.keys(after.entries)[0]]
      .incident.automaticRetry,false);
    const local=x.newLocal('crash-local',cloned);
    fs.writeFileSync(local.file,JSON.stringify(after)+'\n',{mode:0o600});
    commitState({stateRoot:cloned,source:local.file,
      version:after.version,target:'adaptive',gitCommand:x.gitCommand});
    const reloaded=x.clone('crash-readback');
    const reloadedState=JSON.parse(fs.readFileSync(
      path.join(reloaded,ADAPTIVE_STATE_PATH),'utf8'));
    assert.equal(checkpointStats(reloadedState).counts.NEEDS_REVIEW,1);
    assert.equal(invoked,0);
  }finally{fs.rmSync(x.temp,{recursive:true,force:true});}
});
test('restored private witness corruption fails before any archive or C callback',async()=>{
  const f=fixture(),x=setup();
  try{
    const one=x.newLocal('first',x.root);
    const {store,gitStore}=x.durable(one.file,one.privateDir,x.root);
    store.init(registerPlan(newCheckpoint(SCOPE,'SYNTHETIC-DIGEST'),
      [f.group]));
    commitState({stateRoot:x.root,source:one.file,
      version:1,target:'adaptive',gitCommand:x.gitCommand});
    const out=await executeOneReportWave({
      store:gitStore,wave:f.wave,attemptId:'SYNTHETIC-DIGEST-WAVE',
      clock:()=>1793450000000,
      transport:async()=>({
        httpStatus:200,body:f.body,rawBodyBytes:f.rawBodyBytes
      }),
      onVerifiedWave:input=>one.w.persist(input)
    });
    assert.equal(out.status,'RECORDED');
    const cloned=x.clone('tampered-checkout');
    const witnessFile=path.join(cloned,
      'projects/wcl-fresh216/private-adaptive',out.witnessRef);
    fs.writeFileSync(witnessFile,'NOT_A_VALID_BROTLI_WITNESS');
    const two=x.newLocal('second',cloned);
    assert.throws(()=>restoreGitAdaptiveWitnesses({
      stateRoot:cloned,privateWitnessDir:two.privateDir
    }),/PRIVATE_GITHUB_WITNESS_BYTES_DRIFT/);
    assert.equal(fs.readdirSync(path.join(two.privateDir,
      'report-wave-witnesses')).length,0);
  }finally{fs.rmSync(x.temp,{recursive:true,force:true});}
});
