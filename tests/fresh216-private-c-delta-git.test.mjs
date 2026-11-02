import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {compressCDelta,shaBytes,shaObject,SOURCE_SHA256,BASE_UNION_SHA256}
  from '../tools/lib/fresh216-c-delta.mjs';
import {commitFresh216CandidateDelta,PRIVATE_C_CANDIDATE_BRANCH,
  PRIVATE_C_CANDIDATE_DIR} from '../tools/lib/fresh216-private-c-delta-git.mjs';

const git=(...args)=>execFileSync('git',args,{
  encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:15000
}).trim();
function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'f216-c-remote-'));
  const repo=path.join(root,'work'),remote=path.join(root,'bare.git');
  fs.mkdirSync(repo);
  git('init','--bare',remote);
  git('-C',repo,'init','-b',PRIVATE_C_CANDIDATE_BRANCH);
  git('-C',repo,'config','user.name','Synthetic');
  git('-C',repo,'config','user.email','synthetic@example.invalid');
  git('-C',repo,'remote','add','origin',
    'https://github.com/degong2-code/ai-project-lab.git');
  fs.writeFileSync(path.join(repo,'README.md'),'synthetic only');
  git('-C',repo,'add','README.md');
  git('-C',repo,'commit','-m','synthetic base');
  git('-C',repo,'push',remote,'HEAD:refs/heads/'+PRIVATE_C_CANDIDATE_BRANCH);
  const dir=path.join(repo,PRIVATE_C_CANDIDATE_DIR);
  fs.mkdirSync(dir,{recursive:true});
  const runner=(cwd,args)=>{
    if(args[0]==='push')return git('-C',cwd,'push',remote,args[2]);
    if(args[0]==='ls-remote')
      return git('--git-dir',remote,'rev-parse',
        'refs/heads/'+PRIVATE_C_CANDIDATE_BRANCH)+'\trefs/heads/'+
        PRIVATE_C_CANDIDATE_BRANCH;
    return git('-C',cwd,...args);
  };
  const make=(index,previousDeltaSha256=null)=>{
    const proof={proofType:'EXACT_SAME_FIGHT_ACTOR',
      snapshotSha:'a'.repeat(64),reportCode:'SYNTHETIC',
      fightId:11,encounterId:3470,difficulty:4,
      reportRevision:1,actorRef:'id:7',bossDps:10};
    const reportStateCommit='a'.repeat(40);
    const body={schema:1,kind:'FRESH216_C_EVIDENCE_DELTA_V1',
      sourceSha256:SOURCE_SHA256,baseUnionSha256:BASE_UNION_SHA256,
      deltaIndex:index,previousDeltaSha256,reportStateCommit,
      reportBatchSha256:'b'.repeat(64),priorityRange:[1,1],
      rows:[{jobKey:'synthetic'+index,rank:1,
        snapshotSha:proof.snapshotSha,bossDps:10,proof,
        evidence:{reportStateCommit,batchIndex:index,priority:1,
          proofSha256:shaObject(proof)}}]};
    const bytes=compressCDelta(body);
    const file=path.join(dir,'delta-'+String(index).padStart(4,'0')+'.json.br');
    fs.writeFileSync(file,bytes,{mode:0o600});
    return {status:'APPENDED',deltaIndex:index,deltaSha256:shaBytes(bytes),
      addedExactC:1,file};
  };
  return {root,repo,remote,dir,runner,make};
}
const remove=f=>fs.rmSync(f.root,{recursive:true,force:true});
test('Git stores exact binary C-delta and fresh clone readback; repeated commit reuses SHA',()=>{
  const f=fixture();
  try{
    const first=f.make(0);
    const saved=commitFresh216CandidateDelta({
      repoRoot:f.repo,appended:first,minIndex:0,gitCommand:f.runner});
    assert.equal(saved.reused,false);
    assert.equal(saved.status,'REMOTE_CONFIRMED');
    assert.equal(git('--git-dir',f.remote,'rev-parse',
      'refs/heads/'+PRIVATE_C_CANDIDATE_BRANCH),saved.commitSha);
    const restart=path.join(f.root,'restart');
    git('clone','-b',PRIVATE_C_CANDIDATE_BRANCH,f.remote,restart);
    git('-C',restart,'remote','set-url','origin',
      'https://github.com/degong2-code/ai-project-lab.git');
    const reloaded=path.join(restart,PRIVATE_C_CANDIDATE_DIR,
      'delta-0000.json.br');
    assert.deepEqual(fs.readFileSync(reloaded),fs.readFileSync(first.file));
    const reused=commitFresh216CandidateDelta({repoRoot:restart,
      appended:{...first,file:reloaded},minIndex:0,gitCommand:f.runner});
    assert.equal(reused.reused,true);
    assert.equal(reused.commitSha,saved.commitSha);
    const second=f.make(1,first.deltaSha256);
    const extended=commitFresh216CandidateDelta({
      repoRoot:f.repo,appended:second,minIndex:0,gitCommand:f.runner});
    assert.equal(extended.reused,false);
    assert.notEqual(extended.commitSha,saved.commitSha);
  }finally{remove(f);}
});
test('unrelated dirty files, stale remote and changed digest stop before private write',()=>{
  const f=fixture();
  try{
    const first=f.make(0);
    fs.writeFileSync(path.join(f.repo,'UNRELATED.txt'),'unexpected');
    assert.throws(()=>commitFresh216CandidateDelta({
      repoRoot:f.repo,appended:first,minIndex:0,gitCommand:f.runner}),
      /PRIVATE_C_REMOTE_DIRTY_STOP/);
    fs.unlinkSync(path.join(f.repo,'UNRELATED.txt'));
    assert.throws(()=>commitFresh216CandidateDelta({
      repoRoot:f.repo,appended:{...first,deltaSha256:'f'.repeat(64)},
      minIndex:0,gitCommand:f.runner}),/PRIVATE_C_REMOTE_CHAIN_DRIFT/);
    const another=path.join(f.root,'another');
    git('clone','-b',PRIVATE_C_CANDIDATE_BRANCH,f.remote,another);
    git('-C',another,'config','user.name','Other');
    git('-C',another,'config','user.email','other@example.invalid');
    fs.writeFileSync(path.join(another,'OTHER'),'concurrent');
    git('-C',another,'add','OTHER');
    git('-C',another,'commit','-m','other update');
    git('-C',another,'push','origin','HEAD:refs/heads/'+PRIVATE_C_CANDIDATE_BRANCH);
    assert.throws(()=>commitFresh216CandidateDelta({
      repoRoot:f.repo,appended:first,minIndex:0,gitCommand:f.runner}),
      /PRIVATE_C_REMOTE_STALE_HEAD/);
  }finally{remove(f);}
});
test('unknown push outcome never reports a confirmed C candidate commit',()=>{
  const f=fixture();
  try{
    const before=git('--git-dir',f.remote,'rev-parse',
      'refs/heads/'+PRIVATE_C_CANDIDATE_BRANCH);
    const first=f.make(0);
    const broken=(root,args)=>{
      if(args[0]==='push')throw Error('synthetic network loss');
      return f.runner(root,args);
    };
    assert.throws(()=>commitFresh216CandidateDelta({
      repoRoot:f.repo,appended:first,minIndex:0,gitCommand:broken}),
      /PRIVATE_C_REMOTE_GIT_UNKNOWN_STOP/);
    assert.equal(git('--git-dir',f.remote,'rev-parse',
      'refs/heads/'+PRIVATE_C_CANDIDATE_BRANCH),before);
  }finally{remove(f);}
});
