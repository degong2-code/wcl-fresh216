/**
 * Derive the current exact C-recovery set exclusively from immutable A +
 * verified C base/Delta chain, never from legacy pre-C priority counts.
 * No WCL, archive writes, GraphQL or Sheets.
 *
 * 339 masked names are explicitly quarantined: they are not queued for
 * paid Report-wave dispatch without an independently approved exact crosswalk.
 */
import {brotliDecompressSync} from 'node:zlib';
import {SOURCE_SHA256,BASE_UNION_SHA256,keyOf,shaBytes,applyCDeltas}
  from '../../tools/lib/fresh216-c-delta.mjs';
import {readFresh216CDeltaParts}
  from '../../tools/lib/fresh216-archive-c-delta.mjs';
import {deriveFresh216PriorityByKey}
  from './fresh216-priority-map.mjs';
import {planFightFetches} from '../core/fetch-plan.mjs';
import {planReportWaves} from '../core/report-wave-plan.mjs';
import {registerPlan,readyFetches,checkpointStats}
  from '../core/checkpoint.mjs';

const need=(v,c)=>{if(!v)throw Error(c);};
const SCOPE='heroic:2026-10-22_27:latest:source';
export const RECOVERY_BASELINE=Object.freeze({
  sourceSlots:21600,exactC:21252,missing:348,named:9,masked:339,
  deltaParts:231,applied:2423,baseRows:18829,
  sourceSha256:SOURCE_SHA256,baseUnionSha256:BASE_UNION_SHA256
});
const masked=value=>{
  const name=String(value??'').trim().toLowerCase();
  return !name||name==='anonymous'||/^player\s*\(\d+\)$/.test(name);
};
const canonicalKey=slot=>JSON.stringify([slot.jobKey,slot.rank,slot.snapshotSha]);
const groupKey=g=>JSON.stringify([
  g.scopeKey,g.reportCode,g.fightId,g.encounterId,
  g.difficulty,g.reportRevision??null
]);

export function deriveCurrentCRecovery({sourceSlots,union,priorityByKey}={}){
  need(Array.isArray(sourceSlots)&&union instanceof Map&&
    priorityByKey instanceof Map,'FRESH216_RECOVERY_INPUT_INVALID');
  const sourceKeys=new Set();
  const named=[],anonymous=[];
  for(const slot of sourceSlots){
    const key=keyOf(slot);
    need(!sourceKeys.has(key)&&
      typeof slot.jobKey==='string'&&slot.jobKey&&
      Number.isSafeInteger(slot.rank)&&slot.rank>=1&&slot.rank<=100&&
      typeof slot.snapshotSha==='string'&&/^[a-f0-9]{64}$/.test(slot.snapshotSha)&&
      slot.scopeKey===SCOPE,
      'FRESH216_RECOVERY_SOURCE_DUPLICATE_OR_SCOPE_DRIFT');
    sourceKeys.add(key);
    if(union.has(key))continue;
    if(masked(slot.name)){
      need(!priorityByKey.has(key),
        'FRESH216_RECOVERY_MASKED_PRIORITY_CONFLICT');
      anonymous.push(slot);
    }else{
      need(Number.isSafeInteger(priorityByKey.get(key))&&
        priorityByKey.get(key)>=1,
        'FRESH216_RECOVERY_NAMED_PRIORITY_MISSING');
      named.push(slot);
    }
  }
  need([...union.keys()].every(k=>sourceKeys.has(k)),
    'FRESH216_RECOVERY_C_SLOT_NOT_IN_SOURCE');
  need(sourceSlots.length===union.size+named.length+anonymous.length,
    'FRESH216_RECOVERY_TOTAL_MISMATCH');
  return {named,anonymous,counts:{
    sourceSlots:sourceSlots.length,exactC:union.size,
    missing:named.length+anonymous.length,
    named:named.length,masked:anonymous.length
  }};
}

export function prepareCurrentCRecoveryCheckpoint({
  checkpoint,groups,baseline
}={}){
  need(checkpoint?.schema===1&&checkpoint.scopeKey===SCOPE&&
    checkpoint.status==='ACTIVE'&&
    Array.isArray(groups)&&groups.length>0&&
    baseline&&typeof baseline.lastDeltaSha256==='string'&&
    /^[a-f0-9]{64}$/.test(baseline.lastDeltaSha256),
    'FRESH216_RECOVERY_CHECKPOINT_INPUT_INVALID');
  const beforeKeys=Object.keys(checkpoint.entries||{}).sort();
  const expectedKeys=groups.map(groupKey).sort();
  need(expectedKeys.length===new Set(expectedKeys).size,
    'FRESH216_RECOVERY_PLAN_DUPLICATE_GROUP');
  if(beforeKeys.length){
    need(JSON.stringify(beforeKeys)===JSON.stringify(expectedKeys)&&
      checkpoint.recoveryBaseline&&
      JSON.stringify(checkpoint.recoveryBaseline)===JSON.stringify(baseline),
      'FRESH216_RECOVERY_REGISTERED_STATE_DRIFT');
    // Pure validation uses the existing registerPlan drift contract, but
    // never commits a new version for an identical already-registered plan.
    const probe=registerPlan(checkpoint,groups);
    need(probe.version===checkpoint.version+1&&
      Object.keys(probe.entries).length===beforeKeys.length,
      'FRESH216_RECOVERY_REGISTERED_PLAN_DRIFT');
    return {state:checkpoint,created:false};
  }
  need(checkpoint.version===0&&!checkpoint.recoveryBaseline&&
    Object.keys(checkpoint.rankRequests??{}).length===0&&
    Object.keys(checkpoint.sourceRequests??{}).length===0,
    'FRESH216_RECOVERY_INITIAL_STATE_NOT_EMPTY');
  const next=registerPlan(checkpoint,groups);
  next.recoveryBaseline=baseline;
  need(Object.keys(next.entries).length===expectedKeys.length&&
    readyFetches(next).length===expectedKeys.length&&
    checkpointStats(next).counts.IN_FLIGHT===0,
    'FRESH216_RECOVERY_CHECKPOINT_POST_REGISTER_DRIFT');
  return {state:next,created:true};
}

/**
 * Accepts only the four pinned private sources A, C base, Delta chain, and
 * historical priority plan. The original C rows remain immutable.
 */
export function buildCurrentCRecoveryPlan({
  sourceSlots,baseCompressedBytes,deltaDirectory,
  priorityPlan,checkpoint
}={}){
  need(Array.isArray(sourceSlots)&&sourceSlots.length===21600&&
    Buffer.isBuffer(baseCompressedBytes)&&
    shaBytes(baseCompressedBytes)===BASE_UNION_SHA256,
    'FRESH216_RECOVERY_A_BASE_INVALID');
  const slotMap=new Map(sourceSlots.map(s=>[keyOf(s),s]));
  need(slotMap.size===sourceSlots.length,
    'FRESH216_RECOVERY_A_DUPLICATE');
  const priorityByKey=deriveFresh216PriorityByKey({
    priorityPlan,sourceSlots
  });
  const parts=readFresh216CDeltaParts(deltaDirectory);
  need(parts.length===RECOVERY_BASELINE.deltaParts,
    'FRESH216_RECOVERY_DELTA_PARTS_DRIFT');
  const base=JSON.parse(brotliDecompressSync(baseCompressedBytes).toString('utf8'));
  const replay=applyCDeltas({
    base,baseCompressedSha256:BASE_UNION_SHA256,
    slotMap,parts
  });
  const {named,anonymous,counts}=deriveCurrentCRecovery({
    sourceSlots,union:replay.union,priorityByKey
  });
  need(base.rows.length===RECOVERY_BASELINE.baseRows&&
    replay.applied===RECOVERY_BASELINE.applied&&
    replay.deltaCount===RECOVERY_BASELINE.deltaParts&&
    Object.entries(counts).every(([k,v])=>v===RECOVERY_BASELINE[k]),
    'FRESH216_RECOVERY_EXACT348_DRIFT');
  const input=named.map(slot=>({...slot,status:'PENDING'}));
  const grouped=planFightFetches(input);
  need(grouped.pendingSlotCount===RECOVERY_BASELINE.named&&
    grouped.verifiedSkipped===0&&
    grouped.distinctFightRequests>=1,
    'FRESH216_RECOVERY_NAMED_GROUP_INVALID');
  const waves=planReportWaves(grouped,{maxFightsPerWave:4});
  const missingStarts=grouped.groups.filter(g=>g.slots.some(s=>
    !Number.isFinite(s.startTime)||s.startTime<=0)).length;
  // Start time absence must not produce a callable plan.
  need(missingStarts===0,'FRESH216_RECOVERY_SOURCE_START_TIME_MISSING');
  const baseline={
    sourceSha256:SOURCE_SHA256,baseUnionSha256:BASE_UNION_SHA256,
    lastDeltaSha256:replay.lastDeltaSha256,deltaParts:replay.deltaCount,
    cExact:replay.union.size,sourceSlots:sourceSlots.length,
    named:counts.named,maskedQuarantined:counts.masked,
    namedFightGroups:grouped.distinctFightRequests,
    namedWaves:waves.graphQLWaveCount
  };
  const prepared=prepareCurrentCRecoveryCheckpoint({
    checkpoint,groups:grouped.groups,baseline
  });
  return {
    state:prepared.state,created:prepared.created,
    receipt:{
      result:'FRESH216_CURRENT_C_RECOVERY_PLAN_PASS',
      sourceSlots:counts.sourceSlots,exactC:counts.exactC,
      missing:counts.missing,namedQueued:counts.named,
      maskedQuarantined:counts.masked,
      distinctNamedFightGroups:grouped.distinctFightRequests,
      reportWavesIfApproved:waves.graphQLWaveCount,
      checkpointVersion:prepared.state.version,
      planRegistered:prepared.created,
      lastDeltaSha256:replay.lastDeltaSha256,
      graphqlCalls:0,oauthCalls:0,observedPoints:0,
      publicWrites:0,cDeltaAppends:0,canonicalPromotions:0,
      sheetsWrites:0
    }
  };
}
