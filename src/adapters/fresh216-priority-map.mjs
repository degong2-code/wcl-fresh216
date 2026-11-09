import {
  SOURCE_SHA256,keyOf
} from '../../tools/lib/fresh216-c-delta.mjs';

const need=(value,code)=>{if(!value)throw Error(code);};
const same=(a,b)=>(a??null)===(b??null);
const IDENTITY_FIELDS=[
  'scopeKey','reportCode','reportRevision','fightId','encounterId','difficulty'
];
const SLOT_FIELDS=[
  'name','totalDps','startTime','className','specName'
];
const masked=name=>{
  const value=String(name??'').trim().toLowerCase();
  return !value||value==='anonymous'||/^player\s*\(\d+\)$/.test(value);
};

/**
 * Derive the only admissible priority map from the pinned recovery plan.
 * Priorities are attached to immutable A slot keys, never inferred from
 * row order or a current leaderboard. Ambiguous fight groups are rejected.
 */
export function deriveFresh216PriorityByKey({priorityPlan,sourceSlots}={}){
  need(priorityPlan?.schema===1&&
    priorityPlan.kind==='FRESH216_REPORT_RECOVERY_PRIORITY_PLAN_V1'&&
    priorityPlan.sourceSha256===SOURCE_SHA256&&
    Array.isArray(priorityPlan.orderedFightGroups)&&
    Array.isArray(priorityPlan.ambiguousFightGroups)&&
    Array.isArray(sourceSlots)&&sourceSlots.length>0,
    'FRESH216_PRIORITY_PLAN_INPUT_INVALID');
  const totals=priorityPlan.totals;
  need(totals&&totals.sourceSlots===sourceSlots.length&&
    Number.isSafeInteger(totals.namedMissing)&&totals.namedMissing>=0&&
    Number.isSafeInteger(totals.maskedMissing)&&totals.maskedMissing>=0&&
    Number.isSafeInteger(totals.proven)&&totals.proven>=0&&
    totals.proven+totals.namedMissing+totals.maskedMissing===totals.sourceSlots&&
    totals.identityAmbiguousGroups===0&&totals.identityAmbiguousSlots===0&&
    priorityPlan.ambiguousFightGroups.length===0&&
    totals.safePriorityGroups===priorityPlan.orderedFightGroups.length&&
    totals.fightsByReportFight===priorityPlan.orderedFightGroups.length&&
    totals.fightGroupsExactIdentity===priorityPlan.orderedFightGroups.length,
    'FRESH216_PRIORITY_PLAN_TOTALS_INVALID');

  const sourceByKey=new Map();
  for(const slot of sourceSlots){
    const key=keyOf(slot);
    need(typeof slot.jobKey==='string'&&slot.jobKey&&
      Number.isSafeInteger(slot.rank)&&slot.rank>=1&&slot.rank<=100&&
      typeof slot.snapshotSha==='string'&&/^[a-f0-9]{64}$/.test(slot.snapshotSha)&&
      !sourceByKey.has(key),
      'FRESH216_PRIORITY_SOURCE_SLOT_INVALID');
    sourceByKey.set(key,slot);
  }
  need(sourceByKey.size===totals.sourceSlots,
    'FRESH216_PRIORITY_SOURCE_COUNT_DRIFT');

  const priorityByKey=new Map();
  let covered=0;
  for(let i=0;i<priorityPlan.orderedFightGroups.length;i++){
    const group=priorityPlan.orderedFightGroups[i];
    const identity=group?.identity;
    need(group?.priority===i+1&&group.identityCollision===false&&
      identity&&typeof identity.scopeKey==='string'&&
      typeof identity.reportCode==='string'&&identity.reportCode&&
      Number.isSafeInteger(identity.fightId)&&identity.fightId>0&&
      Number.isSafeInteger(identity.encounterId)&&identity.encounterId>0&&
      Number.isSafeInteger(identity.difficulty)&&identity.difficulty>0&&
      Array.isArray(group.slots)&&group.slots.length>0,
      'FRESH216_PRIORITY_GROUP_INVALID');
    for(const candidate of group.slots){
      const key=keyOf(candidate),source=sourceByKey.get(key);
      need(source&&!priorityByKey.has(key)&&!masked(candidate.name),
        'FRESH216_PRIORITY_SLOT_MISSING_OR_DUPLICATE');
      for(const field of IDENTITY_FIELDS){
        need(same(source[field],identity[field])&&
          same(candidate[field],identity[field]),
          'FRESH216_PRIORITY_FIGHT_IDENTITY_DRIFT');
      }
      for(const field of SLOT_FIELDS){
        need(same(source[field],candidate[field]),
          'FRESH216_PRIORITY_SLOT_PROJECTION_DRIFT');
      }
      priorityByKey.set(key,group.priority);
      covered++;
    }
  }
  need(covered===totals.namedMissing&&
    priorityByKey.size===totals.namedMissing,
    'FRESH216_PRIORITY_COVERAGE_DRIFT');
  return priorityByKey;
}
