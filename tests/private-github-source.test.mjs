import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {brotliCompressSync,brotliDecompressSync} from 'node:zlib';
import {
  makeGitDurableStore,commitState,restoreGitAdaptiveWitnesses,
  runGitHubPrivateSource,PRIVATE_REPO,STATE_BRANCH,STATE_PATH,
  ADAPTIVE_STATE_BRANCH,ADAPTIVE_STATE_PATH
} from '../tools/run-private-github-fresh216.mjs';

test('private bridge targets fixed private repository and checkpoint',()=>{
  assert.equal(PRIVATE_REPO,'degong2-code/ai-project-lab');
  assert.equal(STATE_BRANCH,'work/fresh216-private-source-state');
  assert.equal(STATE_PATH,'projects/wcl-fresh216/private-source/fresh216-checkpoint.json');
});

test('sync checkpoint update waits for persistence before return',()=>{
  let value={version:0},persisted=-1;
  const localStore={filePath:'/tmp/mock-checkpoint',
    read:()=>structuredClone(value),
    update:fn=>{value=fn(structuredClone(value));return structuredClone(value);}};
  const store=makeGitDurableStore({localStore,stateRoot:'/tmp/mock-state',
    persist:({version})=>{persisted=version;}});
  const next=store.update(s=>({...s,version:s.version+1}));
  assert.equal(next.version,1);
  assert.equal(persisted,1);
  assert.equal(store.read().version,1);
});

test('failed persistence aborts update, caller must not reach WCL',()=>{
  let value={version:0},sent=0;
  const localStore={filePath:'/tmp/mock-checkpoint',read:()=>value,
    update:fn=>{value=fn(value);return value;}};
  const store=makeGitDurableStore({localStore,stateRoot:'/tmp/mock-state',
    persist:()=>{throw Error('PRIVATE_GITHUB_STATE_WRITE_OR_VERIFY_FAILED');}});
  assert.throws(()=>store.update(s=>({...s,version:1})),
    /PRIVATE_GITHUB_STATE_WRITE_OR_VERIFY_FAILED/);
  if(value.version===0)sent++;
  assert.equal(sent,0);
});

test('public actions context cannot initialize or dispatch OAuth',async()=>{
  let sent=0;
  await assert.rejects(()=>runGitHubPrivateSource({
    env:{GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'degong2-code/wcl-fresh216',
      RUNNER_OS:'Linux',GITHUB_REF:'refs/heads/work/fresh216-private-actions'},
    mode:'collect',fetchImpl:()=>{sent++;throw Error('REQUEST');}
  }),/PRIVATE_GITHUB_ACTIONS_CONTEXT_INVALID/);
  assert.equal(sent,0);
});

test('invalid mode cannot reach GitHub or WCL',async()=>{
  await assert.rejects(()=>runGitHubPrivateSource({mode:'all'}),
    /PRIVATE_GITHUB_MODE_INVALID/);
});


test('Git state target is allowlisted and adaptive target is isolated',()=>{
  let passed=null;
  const localStore={filePath:'/tmp/mock-checkpoint',
    read:()=>({version:1}),update:fn=>fn({version:1})};
  const store=makeGitDurableStore({localStore,stateRoot:'/tmp/state-root',
    target:'adaptive',persist:input=>{passed=input;}});
  assert.equal(store.update(s=>({...s,version:2})).version,2);
  assert.equal(passed.target,'adaptive');
  assert.equal(passed.version,2);
  assert.throws(()=>makeGitDurableStore({
    localStore,stateRoot:'/tmp/state-root',target:'arbitrary',
    persist:()=>{}
  }),/PRIVATE_GITHUB_STATE_TARGET_INVALID/);
});

test('adaptive Git state can be remote-committed and reopened on synthetic bare remote',()=>{
  
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'fresh216-git-adaptive-'));
  const root=path.join(temp,'work'),remote=path.join(temp,'origin.git');
  const local=path.join(temp,'local-checkpoint.json');
  const branch='work/fresh216-private-adaptive-state';
  const statePath='projects/wcl-fresh216/private-adaptive/report-wave-checkpoint.json';
  const g=(args,opts={})=>execFileSync('git',args,{
    encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:15000,...opts
  }).trim();
  try{
    fs.mkdirSync(root);
    g(['init','--bare',remote]);
    g(['-C',root,'init','-b',branch]);
    g(['-C',root,'config','user.name','Synthetic Tester']);
    g(['-C',root,'config','user.email','test@example.invalid']);
    g(['-C',root,'remote','add','origin',
      'https://github.com/degong2-code/ai-project-lab.git']);
    fs.writeFileSync(path.join(root,'README.md'),'offline synthetic only\n');
    g(['-C',root,'add','README.md']);
    g(['-C',root,'commit','-m','synthetic initial commit']);
    g(['-C',root,'push',remote,'HEAD:refs/heads/'+branch]);
    const testGit=(cwd,args)=>{
      if(args[0]==='push'){
        return g(['-C',cwd,'push',remote,args[2]]);
      }
      if(args[0]==='ls-remote'){
        const remoteHead=g(['--git-dir',remote,'rev-parse',
          'refs/heads/'+branch]);
        return remoteHead+'\trefs/heads/'+branch;
      }
      return g(['-C',cwd,...args]);
    };
    const initial={schema:1,scopeKey:'synthetic:scope',
      runId:'synthetic-adaptive',version:0,status:'ACTIVE',
      entries:{},sourceRequests:{},rankRequests:{}};
    fs.writeFileSync(local,JSON.stringify(initial)+'\n',{mode:0o600});
    const committed=commitState({stateRoot:root,source:local,
      version:0,target:'adaptive',gitCommand:testGit});
    assert.match(committed,/^[a-f0-9]{40}$/);
    assert.equal(g(['--git-dir',remote,'rev-parse',
      'refs/heads/'+branch]),committed);
    assert.deepEqual(JSON.parse(fs.readFileSync(
      path.join(root,statePath),'utf8')),initial);
    const reloaded=path.join(temp,'reloaded-checkpoint.json');
    fs.copyFileSync(path.join(root,statePath),reloaded);
    const next={...JSON.parse(fs.readFileSync(reloaded,'utf8')),version:1};
    fs.writeFileSync(reloaded,JSON.stringify(next)+'\n');
    const second=commitState({stateRoot:root,source:reloaded,version:1,
      target:'adaptive',gitCommand:testGit});
    assert.notEqual(second,committed);
    assert.equal(g(['--git-dir',remote,'rev-parse',
      'refs/heads/'+branch]),second);
    assert.equal(JSON.parse(fs.readFileSync(
      path.join(root,statePath),'utf8')).version,1);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

test('remote push failure never allows a paid request after local checkpoint transition',()=>{
  
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'fresh216-git-fail-'));
  const root=path.join(temp,'work'),remote=path.join(temp,'origin.git');
  const local=path.join(temp,'local.json');
  const branch='work/fresh216-private-adaptive-state';
  const g=(args)=>execFileSync('git',args,{
    encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:15000
  }).trim();
  try{
    fs.mkdirSync(root);
    g(['init','--bare',remote]);
    g(['-C',root,'init','-b',branch]);
    g(['-C',root,'config','user.name','Tester']);
    g(['-C',root,'config','user.email','test@example.invalid']);
    g(['-C',root,'remote','add','origin',
      'https://github.com/degong2-code/ai-project-lab.git']);
    fs.writeFileSync(path.join(root,'README.md'),'offline\n');
    g(['-C',root,'add','README.md']);
    g(['-C',root,'commit','-m','synthetic bootstrap']);
    g(['-C',root,'push',remote,'HEAD:refs/heads/'+branch]);
    const remoteBefore=g(['--git-dir',remote,'rev-parse',
      'refs/heads/'+branch]);
    const state={schema:1,scopeKey:'synthetic:scope',
      runId:'synthetic',version:1,status:'ACTIVE',entries:{}};
    fs.writeFileSync(local,JSON.stringify(state)+'\n');
    const failPush=(cwd,args)=>{
      if(args[0]==='push')throw Error('SYNTHETIC_GIT_PUSH_OFFLINE');
      if(args[0]==='ls-remote')return remoteBefore+'\trefs/heads/'+branch;
      return g(['-C',cwd,...args]);
    };
    assert.throws(()=>commitState({stateRoot:root,source:local,
      version:1,target:'adaptive',gitCommand:failPush}),
      /PRIVATE_GITHUB_STATE_WRITE_OR_VERIFY_FAILED/);
    assert.equal(g(['--git-dir',remote,'rev-parse',
      'refs/heads/'+branch]),remoteBefore);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});


test('adaptive PENDING checkpoint and compressed private witness commit together and survive runner restart',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'fresh216-git-witness-'));
  const root=path.join(temp,'work'),remote=path.join(temp,'origin.git');
  const privateDir=path.join(temp,'private'),src=path.join(temp,'src.json');
  const branch=ADAPTIVE_STATE_BRANCH,ref='report-wave-witnesses/'+
    'a'.repeat(64)+'.json.br';
  const privatePath='projects/wcl-fresh216/private-adaptive/'+ref;
  const git=(args)=>execFileSync('git',args,{
    encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:15000
  }).trim();
  try{
    fs.mkdirSync(root);
    fs.mkdirSync(privateDir,{mode:0o700});
    fs.mkdirSync(path.join(privateDir,'report-wave-witnesses'),{mode:0o700});
    git(['init','--bare',remote]);
    git(['-C',root,'init','-b',branch]);
    git(['-C',root,'config','user.name','Synthetic Tester']);
    git(['-C',root,'config','user.email','synthetic@example.invalid']);
    git(['-C',root,'remote','add','origin',
      'https://github.com/degong2-code/ai-project-lab.git']);
    fs.writeFileSync(path.join(root,'README.md'),'synthetic only\n');
    git(['-C',root,'add','README.md']);
    git(['-C',root,'commit','-m','synthetic initial']);
    git(['-C',root,'push',remote,'HEAD:refs/heads/'+branch]);
    const testGit=(cwd,args)=>{
      if(args[0]==='push')return git(['-C',cwd,'push',remote,args[2]]);
      if(args[0]==='ls-remote')
        return git(['--git-dir',remote,'rev-parse',
          'refs/heads/'+branch])+'\trefs/heads/'+branch;
      return git(['-C',cwd,...args]);
    };
    const bytes=brotliCompressSync(Buffer.from('SYNTHETIC_PRIVATE_RESPONSE_NO_ACTORS'));
    const digest=createHash('sha256').update(bytes).digest('hex');
    fs.writeFileSync(path.join(privateDir,ref),bytes,{mode:0o600});
    const state={schema:1,scopeKey:'synthetic:scope',
      runId:'synthetic-remote',version:5,status:'ACTIVE',
      sourceRequests:{},rankRequests:{},
      entries:{one:{status:'COMPLETED',evidence:{
        status:'PENDING',witnessRef:ref,witnessSha256:digest
      }}}};
    fs.writeFileSync(src,JSON.stringify(state)+'\n',{mode:0o600});
    const commit=commitState({stateRoot:root,source:src,version:5,
      target:'adaptive',privateWitnessDir:privateDir,gitCommand:testGit});
    assert.equal(git(['--git-dir',remote,'rev-parse',
      'refs/heads/'+branch]),commit);
    assert.deepEqual(fs.readFileSync(path.join(root,privatePath)),bytes);
    assert.deepEqual(JSON.parse(fs.readFileSync(
      path.join(root,ADAPTIVE_STATE_PATH),'utf8')),state);
    fs.rmSync(path.join(privateDir,'report-wave-witnesses'),
      {recursive:true,force:true});
    fs.mkdirSync(path.join(privateDir,'report-wave-witnesses'),
      {mode:0o700});
    const cloned=path.join(temp,'fresh-runner-checkout');
    git(['clone','-b',branch,remote,cloned]);
    // Emulate a fresh default Git checkout which is not mode 0600.
    fs.chmodSync(path.join(cloned,privatePath),0o644);
    const restored=restoreGitAdaptiveWitnesses({
      stateRoot:cloned,privateWitnessDir:privateDir
    });
    assert.deepEqual(restored,{restored:1,pending:1});
    assert.deepEqual(fs.readFileSync(path.join(privateDir,ref)),bytes);
    assert.equal(brotliDecompressSync(fs.readFileSync(
      path.join(privateDir,ref))).toString('utf8'),
      'SYNTHETIC_PRIVATE_RESPONSE_NO_ACTORS');
    assert.deepEqual(restoreGitAdaptiveWitnesses({
      stateRoot:cloned,privateWitnessDir:privateDir
    }),{restored:0,pending:1});
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

test('missing private witness refuses PENDING checkpoint remote commit',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'fresh216-git-missing-'));
  const root=path.join(temp,'work'),remote=path.join(temp,'origin.git');
  const privateDir=path.join(temp,'private'),src=path.join(temp,'src.json');
  const branch=ADAPTIVE_STATE_BRANCH;
  const git=(args)=>execFileSync('git',args,{
    encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:15000
  }).trim();
  try{
    fs.mkdirSync(root);
    fs.mkdirSync(privateDir,{mode:0o700});
    fs.mkdirSync(path.join(privateDir,'report-wave-witnesses'),{mode:0o700});
    git(['init','--bare',remote]);
    git(['-C',root,'init','-b',branch]);
    git(['-C',root,'config','user.name','Synthetic Tester']);
    git(['-C',root,'config','user.email','synthetic@example.invalid']);
    git(['-C',root,'remote','add','origin',
      'https://github.com/degong2-code/ai-project-lab.git']);
    fs.writeFileSync(path.join(root,'README.md'),'synthetic only\n');
    git(['-C',root,'add','README.md']);
    git(['-C',root,'commit','-m','synthetic initial']);
    git(['-C',root,'push',remote,'HEAD:refs/heads/'+branch]);
    const before=git(['--git-dir',remote,'rev-parse',
      'refs/heads/'+branch]);
    const state={schema:1,scopeKey:'synthetic:scope',
      runId:'synthetic',version:3,status:'ACTIVE',
      entries:{one:{evidence:{status:'PENDING',
        witnessRef:'report-wave-witnesses/'+'b'.repeat(64)+'.json.br',
        witnessSha256:'a'.repeat(64)}}}};
    fs.writeFileSync(src,JSON.stringify(state)+'\n');
    const testGit=(cwd,args)=>{
      if(args[0]==='ls-remote')return before+'\trefs/heads/'+branch;
      if(args[0]==='push')throw Error('SHOULD_NOT_PUSH');
      return git(['-C',cwd,...args]);
    };
    assert.throws(()=>commitState({
      stateRoot:root,source:src,version:3,target:'adaptive',
      privateWitnessDir:privateDir,gitCommand:testGit
    }),/PRIVATE_GITHUB_WITNESS_FILE_UNSAFE/);
    assert.equal(git(['--git-dir',remote,'rev-parse',
      'refs/heads/'+branch]),before);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
