import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {buildActorProofArchive,buildActorProofWaveManifest}
  from '../src/core/fresh216-actor-proof-archive.mjs';
import {persistPrivateSignedWaveStage,
  PRIVATE_REDACTED_STAGE_BRANCH}
  from '../src/adapters/private-signed-evidence-git-store.mjs';

const KEY='SYNTHETIC_ONLY_PRODUCTION_KEY_NOT_USED_FOR_PRIVATE_GIT_STAGE_2026';
const digest=s=>createHash('sha256').update(s).digest('hex');
const git=(...args)=>execFileSync('git',args,{
  encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:15000
}).trim();
function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fresh216-stage-git-'));
  const work=path.join(root,'work'),remote=path.join(root,'bare.git');
  fs.mkdirSync(work);
  git('init','--bare',remote);
  git('-C',work,'init','-b',PRIVATE_REDACTED_STAGE_BRANCH);
  git('-C',work,'config','user.name','Synthetic');
  git('-C',work,'config','user.email','synthetic@example.invalid');
  git('-C',work,'remote','add','origin',
    'https://github.com/degong2-code/ai-project-lab.git');
  fs.writeFileSync(path.join(work,'README.md'),'Synthetic-only baseline\n');
  git('-C',work,'add','README.md');
  git('-C',work,'commit','-m','stage baseline');
  git('-C',work,'push',remote,
    'HEAD:refs/heads/'+PRIVATE_REDACTED_STAGE_BRANCH);
  const command=(cwd,args)=>{
    if(args[0]==='push')return git('-C',cwd,'push',remote,args[2]);
    if(args[0]==='ls-remote')
      return git('--git-dir',remote,'rev-parse',
        'refs/heads/'+PRIVATE_REDACTED_STAGE_BRANCH)+'\trefs/heads/'+
        PRIVATE_REDACTED_STAGE_BRANCH;
    return git('-C',cwd,...args);
  };
  const arch=buildActorProofArchive({
    group:{scopeKey:'synthetic',reportCode:'PRIVATE-ONLY-REPORT-RAW',
      fightId:22,encounterId:3470,difficulty:4,reportRevision:2,
      slots:[{jobKey:'SyntheticJob',rank:1,snapshotSha:'a'.repeat(64),
        totalDps:1000,className:'Hunter',specName:'Marksmanship',
        startTime:1792594801000,name:'Private Person',reportRevision:2}]},
    report:{code:'PRIVATE-ONLY-REPORT-RAW',revision:2,
      overall:{data:[{fightID:22,encounter:{id:3470},difficulty:4,
        roles:{dps:{characters:[{id:7,name:'Private Person',
          class:'Hunter',spec:'Marksmanship',amount:1000}]}}}]},
      boss:{data:[{fightID:22,encounter:{id:3470},difficulty:4,
        roles:{dps:{characters:[{id:7,name:'Private Person',
          class:'Hunter',spec:'Marksmanship',amount:700}]}}}]}},
    sourceSha256:'a'.repeat(64),waveSha256:'b'.repeat(64),
    requestBodySha256:digest('synthetic request'),
    responseBodySha256:digest('synthetic response'),
    httpStatus:200,observedPoints:1,capturedAtMs:1793450000000,
    hmacKey:KEY
  });
  const archives=[arch],manifest=buildActorProofWaveManifest({
    archives,hmacKey:KEY,createdAtMs:1793450000000
  });
  const args={repoRoot:work,archives,manifest,hmacKey:KEY,
    privateReportStateCommit:'a'.repeat(40),gitCommand:command};
  return {root,work,remote,command,args};
}
const cleanup=f=>fs.rmSync(f.root,{recursive:true,force:true});
test('private Git stage only includes signed redacted artifacts, then survives fresh clone',()=>{
  const f=fixture();
  try{
    const first=persistPrivateSignedWaveStage(f.args);
    assert.equal(first.reused,false);
    assert.equal(first.files,3);
    assert.equal(first.privateStageCommit,git('--git-dir',f.remote,'rev-parse',
      'refs/heads/'+PRIVATE_REDACTED_STAGE_BRANCH));
    const paths=git('-C',f.work,'ls-tree','-r','--name-only','HEAD').split('\n');
    assert.equal(paths.length,4);
    assert.equal(paths.filter(p=>p.includes('/actor-proof/')).length,1);
    assert.equal(paths.filter(p=>p.includes('/waves/')).length,1);
    assert.equal(paths.filter(p=>p.includes('/private-public-relay/')).length,1);
    const raw=paths.map(p=>fs.readFileSync(path.join(f.work,p),'utf8')).join('');
    assert.equal(raw.includes('PRIVATE-ONLY-REPORT-RAW'),false);
    assert.equal(raw.includes('Private Person'),false);
    const restarted=path.join(f.root,'restarted');
    git('clone','-b',PRIVATE_REDACTED_STAGE_BRANCH,f.remote,restarted);
    git('-C',restarted,'remote','set-url','origin',
      'https://github.com/degong2-code/ai-project-lab.git');
    const reused=persistPrivateSignedWaveStage({
      ...f.args,repoRoot:restarted
    });
    assert.equal(reused.reused,true);
    assert.equal(reused.privateStageCommit,first.privateStageCommit);
  }finally{cleanup(f);}
});
test('incorrect HMAC and stale remote cannot publish staged private evidence',()=>{
  const f=fixture();
  try{
    assert.throws(()=>persistPrivateSignedWaveStage({
      ...f.args,hmacKey:'ANOTHER_FAKE_SECRET_NOT_THE_SIGNER_AT_ALL_2026_000000',
    }),/ACTOR_WAVE_MANIFEST_HMAC_INVALID/);
    const other=path.join(f.root,'other');
    git('clone','-b',PRIVATE_REDACTED_STAGE_BRANCH,f.remote,other);
    git('-C',other,'config','user.name','Other');
    git('-C',other,'config','user.email','other@example.invalid');
    fs.writeFileSync(path.join(other,'OTHER'),'other writer');
    git('-C',other,'add','OTHER');
    git('-C',other,'commit','-m','competing change');
    git('-C',other,'push','origin',
      'HEAD:refs/heads/'+PRIVATE_REDACTED_STAGE_BRANCH);
    assert.throws(()=>persistPrivateSignedWaveStage(f.args),
      /SIGNED_STAGE_GIT_STALE_REMOTE/);
  }finally{cleanup(f);}
});
test('unknown private stage Git push aborts without a success receipt',()=>{
  const f=fixture();
  try{
    const before=git('--git-dir',f.remote,'rev-parse',
      'refs/heads/'+PRIVATE_REDACTED_STAGE_BRANCH);
    const broken=(cwd,args)=>{
      if(args[0]==='push')throw Error('synthetic network loss');
      return f.command(cwd,args);
    };
    assert.throws(()=>persistPrivateSignedWaveStage({
      ...f.args,gitCommand:broken
    }),/SIGNED_STAGE_GIT_UNKNOWN_OUTCOME_STOP/);
    assert.equal(git('--git-dir',f.remote,'rev-parse',
      'refs/heads/'+PRIVATE_REDACTED_STAGE_BRANCH),before);
  }finally{cleanup(f);}
});
