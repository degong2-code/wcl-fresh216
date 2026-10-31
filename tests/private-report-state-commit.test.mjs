import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
  createGitBackedReportStateCommitProvider,
  PRIVATE_REPORT_STATE_BRANCH,PRIVATE_REPORT_STATE_PATH,
  PRIVATE_REPORT_STATE_REPOSITORY,PRIVATE_REPORT_STATE_SCOPE
} from '../src/adapters/private-report-state-commit.mjs';
import {SOURCE_SHA256} from '../tools/lib/fresh216-c-delta.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const key=group=>JSON.stringify([
  group.scopeKey,group.reportCode,group.fightId,group.encounterId,
  group.difficulty,group.reportRevision??null
]);
function git(root,...args){
  return execFileSync('git',['-C',root,...args],{
    encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:15000
  }).trim();
}
function fixture(){
  const groups=[501,502].map((fightId,index)=>({
    scopeKey:PRIVATE_REPORT_STATE_SCOPE,reportCode:'REPORT_FIXTURE',
    reportRevision:7,fightId,encounterId:3470,difficulty:4,
    slots:[{
      jobKey:'job-'+index,rank:index+1,snapshotSha:sha('snapshot-'+index),
      totalDps:1000-index*100,className:'Hunter',specName:'Spec',
      startTime:1792594801000+index,name:'Player '+index
    }]
  }));
  const wave={waveId:'wave-fixture-1',scopeKey:PRIVATE_REPORT_STATE_SCOPE,
    reportCode:'REPORT_FIXTURE',reportRevision:7,fightGroups:groups};
  const attemptId='attempt-fixture-1';
  const requestBodyText=JSON.stringify({
    query:'query fixture',variables:{code:'REPORT_FIXTURE'}
  });
  const responseBodyBytes=Buffer.from(JSON.stringify({data:{reportData:{
    report:{code:'REPORT_FIXTURE',revision:7,
      o0:{data:[{fightID:501}]},b0:{data:[{fightID:501}]},
      o1:{data:[{fightID:502}]},b1:{data:[{fightID:502}]}
    }
  }}}));
  const waveSha256=sha(JSON.stringify(wave));
  const requestBodySha256=sha(requestBodyText);
  const responseBodySha256=sha(responseBodyBytes);
  const witnessRef='report-wave-witnesses/'+waveSha256+'.json.br';
  const witnessSha256=sha('compressed-private-witness');
  const evidence={schema:1,status:'PENDING',waveId:wave.waveId,
    sourceSha256:SOURCE_SHA256,waveSha256,requestBodySha256,
    responseBodySha256,witnessRef,witnessSha256,attemptId};
  const joinedByFight=groups.map((group,index)=>{
    const slot=group.slots[0];
    const proof={proofType:'EXACT_SAME_FIGHT_ACTOR',
      snapshotSha:slot.snapshotSha,reportCode:group.reportCode,
      fightId:group.fightId,encounterId:group.encounterId,
      difficulty:group.difficulty,reportRevision:7,
      actorRef:'private-actor-'+index,bossDps:700-index*50};
    return {verified:[{jobKey:slot.jobKey,rank:slot.rank,
      snapshotSha:slot.snapshotSha,proof}],unresolved:[]};
  });
  const witness={schema:1,
    kind:'FRESH216_PRIVATE_REPORT_WAVE_WITNESS_V1',
    sourceSha256:SOURCE_SHA256,waveSha256,requestBodySha256,
    responseBodySha256,httpStatus:200,observedPoints:4.25,
    capturedAtMs:1793000000000,attemptId,requestBodyText,
    responseBodyBase64:responseBodyBytes.toString('base64'),
    responseBodyBytes,wave,joinedByFight,witnessRef,witnessSha256};
  const waveKeys=groups.map(key).sort();
  const entries={};
  for(let i=0;i<groups.length;i++){
    const group=groups[i],groupKey=key(group),joined=joinedByFight[i];
    entries[groupKey]={
      key:groupKey,
      identity:{scopeKey:group.scopeKey,reportCode:group.reportCode,
        fightId:group.fightId,encounterId:group.encounterId,
        difficulty:group.difficulty,reportRevision:group.reportRevision,
        revisionKnown:true},
      slots:group.slots.map(slot=>({...slot})),
      status:'COMPLETED',attempt:{id:attemptId,kind:'REPORT_WAVE',
        waveKeys},
      result:{verified:joined.verified.map(row=>({...row})),
        unresolved:[]},
      observedPoints:4.25,wallMs:250,evidence:{...evidence}
    };
  }
  const state={schema:1,scopeKey:PRIVATE_REPORT_STATE_SCOPE,
    runId:'fresh216-test-run',version:9,status:'ACTIVE',entries,
    rankRequests:{},sourceRequests:{}};
  return {wave,attemptId,evidence,witness,state};
}
function createGitFixture(state){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'fresh216-report-state-'));
  const root=path.join(temp,'repo'),remote=path.join(temp,'remote.git');
  fs.mkdirSync(root);
  execFileSync('git',['init','--bare',remote],{stdio:'ignore'});
  execFileSync('git',['-C',root,'init','-b',PRIVATE_REPORT_STATE_BRANCH],
    {stdio:'ignore'});
  git(root,'config','user.name','Fresh216 Test');
  git(root,'config','user.email','fresh216-test@example.invalid');
  git(root,'remote','add','origin',
    'https://github.com/'+PRIVATE_REPORT_STATE_REPOSITORY+'.git');
  const target=path.join(root,PRIVATE_REPORT_STATE_PATH);
  fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.writeFileSync(target,JSON.stringify(state)+'\n');
  git(root,'add','--',PRIVATE_REPORT_STATE_PATH);
  git(root,'commit','-m','test: persist report wave checkpoint');
  const stateCommit=git(root,'rev-parse','HEAD');
  execFileSync('git',['-C',root,'push',remote,
    'HEAD:refs/heads/'+PRIVATE_REPORT_STATE_BRANCH],{stdio:'ignore'});
  const gitCommand=(repoRoot,args)=>{
    if(args[0]==='ls-remote'){
      const remoteHead=execFileSync('git',['--git-dir',remote,'rev-parse',
        'refs/heads/'+PRIVATE_REPORT_STATE_BRANCH],{encoding:'utf8'}).trim();
      return remoteHead+'\trefs/heads/'+PRIVATE_REPORT_STATE_BRANCH;
    }
    return execFileSync('git',['-C',repoRoot,...args],{
      encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:15000,
      maxBuffer:32*1024*1024
    });
  };
  return {temp,root,remote,stateCommit,gitCommand};
}
const clean=fixture=>fs.rmSync(fixture.temp,{recursive:true,force:true});

test('provider returns the real remote-confirmed commit that contains the exact multi-fight pending wave',async()=>{
  const f=fixture(),repo=createGitFixture(f.state);
  try{
    // A later unrelated commit must not replace the commit that actually
    // persisted this report-state snapshot.
    fs.writeFileSync(path.join(repo.root,'unrelated.txt'),'unrelated\n');
    git(repo.root,'add','--','unrelated.txt');
    git(repo.root,'commit','-m','test: unrelated later commit');
    execFileSync('git',['-C',repo.root,'push',repo.remote,
      'HEAD:refs/heads/'+PRIVATE_REPORT_STATE_BRANCH],{stdio:'ignore'});
    const head=git(repo.root,'rev-parse','HEAD');
    const provider=createGitBackedReportStateCommitProvider({
      repoRoot:repo.root,gitCommand:repo.gitCommand
    });
    const actual=await provider({
      wave:f.wave,attemptId:f.attemptId,evidence:f.evidence,witness:f.witness
    });
    assert.equal(actual,repo.stateCommit);
    assert.notEqual(actual,head);
    assert.notEqual(actual,f.witness.witnessSha256);
    assert.match(actual,/^[a-f0-9]{40}$/);
  }finally{clean(repo);}
});
test('provider rejects dirty worktrees and wrong branches',async()=>{
  const f=fixture(),repo=createGitFixture(f.state);
  try{
    const provider=createGitBackedReportStateCommitProvider({
      repoRoot:repo.root,gitCommand:repo.gitCommand
    });
    fs.writeFileSync(path.join(repo.root,'untracked.txt'),'x');
    await assert.rejects(()=>provider({
      wave:f.wave,attemptId:f.attemptId,evidence:f.evidence,witness:f.witness
    }),/PRIVATE_REPORT_STATE_WORKTREE_DIRTY/);
    fs.unlinkSync(path.join(repo.root,'untracked.txt'));
    git(repo.root,'checkout','-b','work/fresh216-wrong-branch');
    await assert.rejects(()=>provider({
      wave:f.wave,attemptId:f.attemptId,evidence:f.evidence,witness:f.witness
    }),/PRIVATE_REPORT_STATE_BRANCH_MISMATCH/);
  }finally{clean(repo);}
});
test('provider rejects a remote ref that does not confirm the local HEAD',async()=>{
  const f=fixture(),repo=createGitFixture(f.state);
  try{
    const initial=repo.stateCommit;
    fs.writeFileSync(path.join(repo.root,'later.txt'),'later\n');
    git(repo.root,'add','--','later.txt');
    git(repo.root,'commit','-m','test: local unpushed commit');
    const provider=createGitBackedReportStateCommitProvider({
      repoRoot:repo.root,gitCommand:repo.gitCommand
    });
    await assert.rejects(()=>provider({
      wave:f.wave,attemptId:f.attemptId,evidence:f.evidence,witness:f.witness
    }),/PRIVATE_REPORT_STATE_REMOTE_HEAD_UNCONFIRMED/);
    assert.notEqual(git(repo.root,'rev-parse','HEAD'),initial);
  }finally{clean(repo);}
});
test('provider rejects witness, attempt and checkpoint proof-result drift',async()=>{
  const f=fixture(),repo=createGitFixture(f.state);
  try{
    const provider=createGitBackedReportStateCommitProvider({
      repoRoot:repo.root,gitCommand:repo.gitCommand
    });
    const badEvidence={...f.evidence,responseBodySha256:'f'.repeat(64)};
    await assert.rejects(()=>provider({
      wave:f.wave,attemptId:f.attemptId,evidence:badEvidence,witness:f.witness
    }),/PRIVATE_REPORT_STATE_WITNESS_INVALID/);
    await assert.rejects(()=>provider({
      wave:f.wave,attemptId:'different-attempt',
      evidence:f.evidence,witness:f.witness
    }),/PRIVATE_REPORT_STATE_EVIDENCE_INVALID/);
    const badState=structuredClone(f.state);
    const first=Object.values(badState.entries)[0];
    first.result.verified[0].proof.bossDps++;
    const badRepo=createGitFixture(badState);
    try{
      const badProvider=createGitBackedReportStateCommitProvider({
        repoRoot:badRepo.root,gitCommand:badRepo.gitCommand
      });
      await assert.rejects(()=>badProvider({
        wave:f.wave,attemptId:f.attemptId,
        evidence:f.evidence,witness:f.witness
      }),/PRIVATE_REPORT_STATE_RESULT_MISMATCH/);
    }finally{clean(badRepo);}
  }finally{clean(repo);}
});
