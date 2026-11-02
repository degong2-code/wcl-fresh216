import test from 'node:test';
import assert from 'node:assert/strict';
import {SOURCE_SHA256} from '../tools/lib/fresh216-c-delta.mjs';
import {deriveFresh216PriorityByKey}
  from '../src/adapters/fresh216-priority-map.mjs';

const slot=(jobKey,rank,reportCode,fightId)=>({
  scopeKey:'heroic:test:latest:source',jobKey,rank,
  snapshotSha:(rank===1?'a':'b').repeat(64),
  name:'Named Actor '+jobKey,totalDps:1000-rank,startTime:100000+rank,
  reportCode,reportRevision:2,fightId,encounterId:3470,difficulty:4,
  className:'Mage',specName:'Arcane'
});
function planFor(slots){
  const groups=slots.map((s,i)=>({
    priority:i+1,identity:{
      scopeKey:s.scopeKey,reportCode:s.reportCode,
      reportRevision:s.reportRevision,fightId:s.fightId,
      encounterId:s.encounterId,difficulty:s.difficulty
    },slots:[{...s}],identityCollision:false
  }));
  return {
    schema:1,kind:'FRESH216_REPORT_RECOVERY_PRIORITY_PLAN_V1',
    sourceSha256:SOURCE_SHA256,
    totals:{
      sourceSlots:slots.length,proven:0,namedMissing:slots.length,
      maskedMissing:0,fightsByReportFight:slots.length,
      fightGroupsExactIdentity:slots.length,identityAmbiguousGroups:0,
      identityAmbiguousSlots:0,safePriorityGroups:slots.length
    },
    orderedFightGroups:groups,ambiguousFightGroups:[]
  };
}
test('priority map binds exact source slot keys to contiguous fight priorities',()=>{
  const slots=[slot('job-a',1,'RPT-A',11),slot('job-b',30,'RPT-B',22)];
  const map=deriveFresh216PriorityByKey({priorityPlan:planFor(slots),sourceSlots:slots});
  assert.equal(map.size,2);
  assert.equal(map.get(JSON.stringify([slots[0].jobKey,slots[0].rank,slots[0].snapshotSha])),1);
  assert.equal(map.get(JSON.stringify([slots[1].jobKey,slots[1].rank,slots[1].snapshotSha])),2);
});
test('priority map rejects duplicate source keys and duplicate plan assignments',()=>{
  const a=slot('job-a',1,'RPT-A',11);
  assert.throws(()=>deriveFresh216PriorityByKey({
    priorityPlan:planFor([a,{...a}]),sourceSlots:[a,{...a}]
  }),/FRESH216_PRIORITY_SOURCE_SLOT_INVALID/);
  const p=planFor([a,{...a,jobKey:'job-b',reportCode:'RPT-A'}]);
  p.orderedFightGroups[1].slots[0]={...a};
  assert.throws(()=>deriveFresh216PriorityByKey({
    priorityPlan:p,sourceSlots:[a,{...a,jobKey:'job-b'}]
  }),/FRESH216_PRIORITY_SLOT_MISSING_OR_DUPLICATE/);
});
test('priority map rejects priority gaps, ambiguous groups and fight identity drift',()=>{
  const a=slot('job-a',1,'RPT-A',11),b=slot('job-b',2,'RPT-B',22);
  const gap=planFor([a,b]);gap.orderedFightGroups[1].priority=3;
  assert.throws(()=>deriveFresh216PriorityByKey({
    priorityPlan:gap,sourceSlots:[a,b]
  }),/FRESH216_PRIORITY_GROUP_INVALID/);
  const ambiguous=planFor([a]);ambiguous.ambiguousFightGroups=[{}];
  ambiguous.totals.identityAmbiguousGroups=1;
  assert.throws(()=>deriveFresh216PriorityByKey({
    priorityPlan:ambiguous,sourceSlots:[a]
  }),/FRESH216_PRIORITY_PLAN_TOTALS_INVALID/);
  const drift=planFor([a]);drift.orderedFightGroups[0].identity.fightId=99;
  assert.throws(()=>deriveFresh216PriorityByKey({
    priorityPlan:drift,sourceSlots:[a]
  }),/FRESH216_PRIORITY_FIGHT_IDENTITY_DRIFT/);
});
test('priority map refuses anonymous or report-local masked actors',()=>{
  const a=slot('job-a',1,'RPT-A',11);a.name='Player (1)';
  const p=planFor([a]);
  assert.throws(()=>deriveFresh216PriorityByKey({
    priorityPlan:p,sourceSlots:[a]
  }),/FRESH216_PRIORITY_SLOT_MISSING_OR_DUPLICATE/);
});
