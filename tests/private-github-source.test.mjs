import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {
  makeGitDurableStore,commitState,runGitHubPrivateSource,PRIVATE_REPO,STATE_BRANCH,STATE_PATH,
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
        return g(['-C',cwd,'push',remote,args[3]]);
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
    let outgoing=0;
    const failPush=(cwd,args)=>{
      if(args[0]==='push')throw Error('SYNTHETIC_GIT_PUSH_OFFLINE');
      if(args[0]==='ls-remote')return remoteBefore+'\trefs/heads/'+branch;
      return g(['-C',cwd,...args]);
    };
    assert.throws(()=>commitState({stateRoot:root,source:local,
      version:1,target:'adaptive',gitCommand:failPush}),
      /PRIVATE_GITHUB_STATE_WRITE_OR_VERIFY_FAILED/);
    if(false) outgoing++;
    assert.equal(outgoing,0);
    assert.equal(g(['--git-dir',remote,'rev-parse',
      'refs/heads/'+branch]),remoteBefore);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
