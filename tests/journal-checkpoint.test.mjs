import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {JournalCheckpointStore} from '../src/adapters/journal-checkpoint-store.mjs';
import {JsonCheckpointStore} from '../src/adapters/json-checkpoint-store.mjs';
import {planFightFetches} from '../src/core/fetch-plan.mjs';
import {
  newCheckpoint,registerPlan,readyFetches,beginFetch,completeFetch,
  recoverCheckpoint,checkpointStats
} from '../src/core/checkpoint.mjs';
import {executeOneReadyFight} from '../src/core/single-fight-runner.mjs';

const group=()=>planFightFetches([{
 scopeKey:'scope:fixture',jobKey:'Boss|Hunter|Marksmanship',rank:1,
 snapshotSha:'a'.repeat(64),status:'PENDING',className:'Hunter',
 specName:'Marksmanship',totalDps:1000,
 reportCode:'SYNTHETIC',fightId:42,encounterId:3470,difficulty:4,
 reportRevision:5,name:'Anonymous'
}]).groups;
const freshState=()=>registerPlan(newCheckpoint('scope:fixture','R'),group());
const joinedFor=e=>({
 verified:e.slots.map(s=>({
  jobKey:s.jobKey,rank:s.rank,snapshotSha:s.snapshotSha,
  proof:{proofType:'EXACT_SAME_FIGHT_ACTOR',actorRef:'id:5',
   bossDps:750,snapshotSha:s.snapshotSha,reportCode:e.identity.reportCode,
   fightId:e.identity.fightId,encounterId:e.identity.encounterId,
   difficulty:e.identity.difficulty,reportRevision:5}
 })),unresolved:[]
});
function fixture(fn){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'wcl-journal-test-'));
 try{return fn(root);}finally{fs.rmSync(root,{recursive:true,force:true});}
}
test('same checkpoint transition results as JSON store and fresh-process replay',()=>{
 fixture(root=>{
  const seed=freshState();
  const journal=new JournalCheckpointStore(path.join(root,'events-store'));
  const json=new JsonCheckpointStore(path.join(root,'state.json'));
  journal.init(seed);json.init(seed);
  const key=readyFetches(seed)[0].key;
  for(const store of [journal,json]){
   store.update(s=>beginFetch(s,key,'A1',100));
   const after=store.read();
   store.update(s=>completeFetch(s,key,'A1',joinedFor(after.entries[key]),
     {points:7,wallMs:15}));
  }
  assert.deepEqual(journal.read(),json.read());
  const restart=new JournalCheckpointStore(path.join(root,'events-store'));
  assert.deepEqual(restart.read(),json.read());
  assert.equal(checkpointStats(restart.read()).verifiedSlotEvidence,1);
  assert.equal(fs.readdirSync(path.join(root,'events-store','events')).length,2);
  assert.equal(fs.statSync(path.join(root,'events-store','base.json')).mode&0o777,0o600);
 });
});
test('durable IN_FLIGHT replay after restart cannot become an automatic retry',()=>{
 fixture(root=>{
  const store=new JournalCheckpointStore(path.join(root,'journal'));
  const seed=freshState();const key=readyFetches(seed)[0].key;
  store.init(seed);
  store.update(s=>beginFetch(s,key,'A1',100));
  const restarted=new JournalCheckpointStore(path.join(root,'journal'));
  assert.equal(restarted.read().entries[key].status,'IN_FLIGHT');
  restarted.update(recoverCheckpoint);
  const yetAnother=new JournalCheckpointStore(path.join(root,'journal'));
  assert.equal(yetAnother.read().entries[key].status,'NEEDS_REVIEW');
  assert.equal(readyFetches(yetAnother.read()).length,0);
 });
});
test('corrupted event cannot be accepted as a verified proof or a READY retry',()=>{
 fixture(root=>{
  const directory=path.join(root,'journal');
  const store=new JournalCheckpointStore(directory);
  const seed=freshState(),key=readyFetches(seed)[0].key;
  store.init(seed);store.update(s=>beginFetch(s,key,'A1',100));
  const event=path.join(directory,'events','0000000002.json');
  const record=JSON.parse(fs.readFileSync(event,'utf8'));
  record.changes[key].status='READY';
  fs.writeFileSync(event,JSON.stringify(record)+'\n');
  const reboot=new JournalCheckpointStore(directory);
  assert.throws(()=>reboot.read(),/JOURNAL_CORRUPT_OR_DRIFTED/);
 });
});
test('journal version gaps and orphan temporary event filenames fail closed',()=>{
 fixture(root=>{
  const dir=path.join(root,'journal'),store=new JournalCheckpointStore(dir);
  const seed=freshState(),key=readyFetches(seed)[0].key;
  store.init(seed);store.update(s=>beginFetch(s,key,'A1',100));
  const events=path.join(dir,'events');
  fs.renameSync(path.join(events,'0000000002.json'),
    path.join(events,'0000000003.json'));
  assert.throws(()=>new JournalCheckpointStore(dir).read(),/JOURNAL_VERSION_GAP/);
  fs.renameSync(path.join(events,'0000000003.json'),
    path.join(events,'0000000002.json'));
  fs.writeFileSync(path.join(events,'orphan.tmp'),'partial');
  assert.throws(()=>new JournalCheckpointStore(dir).read(),/JOURNAL_UNEXPECTED_EVENT_FILE/);
 });
});
test('two processes detect stale state and refuse non-atomic overwrite',()=>{
 fixture(root=>{
  const dir=path.join(root,'journal'),first=new JournalCheckpointStore(dir);
  const seed=freshState(),key=readyFetches(seed)[0].key;
  first.init(seed);first.read();
  const second=new JournalCheckpointStore(dir);
  second.update(s=>beginFetch(s,key,'SECOND',100));
  assert.throws(()=>first.update(s=>beginFetch(s,key,'FIRST',101)),
    /JOURNAL_EXTERNAL_CHANGE_REOPEN_REQUIRED/);
  assert.equal(new JournalCheckpointStore(dir).read().entries[key].attempt.id,
    'SECOND');
 });
});
test('stale lock preserves fail-closed behavior without stealing ownership',()=>{
 fixture(root=>{
  const dir=path.join(root,'journal'),store=new JournalCheckpointStore(dir);
  store.init(freshState());fs.mkdirSync(path.join(dir,'.update.lock'));
  assert.throws(()=>store.update(s=>({...s,version:s.version+1})),/EEXIST/);
  assert.equal(store.read().version,1);
  fs.rmdirSync(path.join(dir,'.update.lock'));
 });
});
test('immutable base plan cannot silently gain or drop arbitrary fight entries',()=>{
 fixture(root=>{
  const dir=path.join(root,'journal'),store=new JournalCheckpointStore(dir);
  store.init(freshState());
  assert.throws(()=>store.update(s=>{
   s.entries.another={key:'another'};s.version++;return s;
  }),/JOURNAL_PLAN_MUTATION_DISALLOWED/);
  assert.equal(new JournalCheckpointStore(dir).read().version,1);
 });
});
test('mock-transport single-fight runner works unchanged with durable journal',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'wcl-journal-runner-'));
 try{
  const directory=path.join(root,'journal');
  const store=new JournalCheckpointStore(directory);
  store.init(freshState());
  const result=await executeOneReadyFight({
    store,clock:()=>100,attemptId:'A1',
    admissionPolicy:{notBeforeMs:0,maxObservedPoints:30,reservePoints:10},
    transport:async()=>({
      httpStatus:200,
      body:{data:{
       rateLimitData:{currentRequest:{total:7}},
       reportData:{report:{code:'SYNTHETIC',revision:5,
        overall:{data:[{fightID:42,encounter:{id:3470},difficulty:4,
         roles:{dps:{characters:[{
          id:5,name:'Hunter',class:'Hunter',spec:'Marksmanship',amount:1000
         }]}}}]},
        boss:{data:[{fightID:42,encounter:{id:3470},difficulty:4,
         roles:{dps:{characters:[{
          id:5,name:'Hunter',class:'Hunter',spec:'Marksmanship',amount:750
         }]}}}]}
       }}
      }}
    })
  });
  assert.equal(result.status,'COMPLETED');
  assert.equal(result.verifiedSlots,1);
  const reopened=new JournalCheckpointStore(directory);
  assert.equal(checkpointStats(reopened.read()).witnessedPoints,7);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
