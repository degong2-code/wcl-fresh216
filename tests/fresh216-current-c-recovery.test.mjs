import test from 'node:test';
import assert from 'node:assert/strict';
import {newCheckpoint,checkpointStats} from '../src/core/checkpoint.mjs';
import {deriveCurrentCRecovery,prepareCurrentCRecoveryCheckpoint}
  from '../src/adapters/fresh216-current-c-recovery.mjs';

const SCOPE='heroic:2026-10-22_27:latest:source';
const make=(i,name)=>({
  scopeKey:SCOPE,jobKey:'synthetic|Hunter|Marksmanship',
  rank:i,snapshotSha:'a'.repeat(64),status:'PENDING',
  totalDps:1000,className:'Hunter',specName:'Marksmanship',
  reportCode:'SYNTHETIC',reportRevision:2,fightId:120,
  encounterId:3470,difficulty:4,startTime:1792600000000,name
});
const key=x=>JSON.stringify([x.jobKey,x.rank,x.snapshotSha]);
const base=()=>({sourceSlots:[make(1,'Named A'),make(2,'Player (1)'),
  make(3,'Named B')],union:new Map(),priorityByKey:new Map()});

test('exact C difference quarantines masked actor rather than scheduling a paid request',()=>{
  const f=base();
  f.union.set(key(f.sourceSlots[2]),{proof:'synthetic'});
  f.priorityByKey.set(key(f.sourceSlots[0]),1);
  const v=deriveCurrentCRecovery(f);
  assert.equal(v.counts.sourceSlots,3);
  assert.equal(v.counts.exactC,1);
  assert.equal(v.counts.named,1);
  assert.equal(v.counts.masked,1);
  assert.equal(v.named[0].rank,1);
  assert.equal(v.anonymous[0].rank,2);
});

test('named slot without immutable Priority Map is not silently fetched',()=>{
  const f=base();
  f.union.set(key(f.sourceSlots[2]),{});
  assert.throws(()=>deriveCurrentCRecovery(f),
    /FRESH216_RECOVERY_NAMED_PRIORITY_MISSING/);
});

test('mask priority collision, duplicate ranks, and orphan C evidence fail closed',()=>{
  const f=base();
  f.union.set(key(f.sourceSlots[0]),{});
  f.union.set(key(f.sourceSlots[2]),{});
  f.priorityByKey.set(key(f.sourceSlots[1]),1);
  assert.throws(()=>deriveCurrentCRecovery(f),
    /FRESH216_RECOVERY_MASKED_PRIORITY_CONFLICT/);
  f.priorityByKey.delete(key(f.sourceSlots[1]));
  f.union.set('ORPHAN',{});
  assert.throws(()=>deriveCurrentCRecovery(f),
    /FRESH216_RECOVERY_C_SLOT_NOT_IN_SOURCE/);
});

test('existing checkpoint state machine registers once and repeated preview does not bump version',()=>{
  const f=base(),g=f.sourceSlots[0];
  const group={
    scopeKey:g.scopeKey,reportCode:g.reportCode,
    fightId:g.fightId,encounterId:g.encounterId,
    difficulty:g.difficulty,reportRevision:g.reportRevision,
    slots:[{jobKey:g.jobKey,rank:g.rank,snapshotSha:g.snapshotSha,
      totalDps:g.totalDps,className:g.className,specName:g.specName,
      name:g.name,startTime:g.startTime}]
  };
  const meta={
    sourceSha256:'1'.repeat(64),baseUnionSha256:'2'.repeat(64),
    lastDeltaSha256:'3'.repeat(64),deltaParts:231,cExact:21252,
    sourceSlots:21600,named:9,maskedQuarantined:339,
    namedFightGroups:1,namedWaves:1
  };
  const initial=newCheckpoint(SCOPE,'synthetic-id');
  const added=prepareCurrentCRecoveryCheckpoint({
    checkpoint:initial,groups:[group],baseline:meta
  });
  assert.equal(added.created,true);
  assert.equal(added.state.version,1);
  assert.equal(checkpointStats(added.state).counts.READY,1);
  const reopened=prepareCurrentCRecoveryCheckpoint({
    checkpoint:structuredClone(added.state),groups:[group],baseline:meta
  });
  assert.equal(reopened.created,false);
  assert.equal(reopened.state.version,1);
  assert.throws(()=>prepareCurrentCRecoveryCheckpoint({
    checkpoint:structuredClone(added.state),
    groups:[{...group,slots:[{...group.slots[0],rank:4}]}],
    baseline:meta
  }),/FRESH216_RECOVERY_REGISTERED_PLAN_DRIFT/);
});
