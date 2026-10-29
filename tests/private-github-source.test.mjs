import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeGitDurableStore,runGitHubPrivateSource,PRIVATE_REPO,STATE_BRANCH,STATE_PATH
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
