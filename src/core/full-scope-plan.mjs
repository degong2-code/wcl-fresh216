import {planFightFetches} from './fetch-plan.mjs';

/**
 * 216-job snapshot preflight and global de-duplication, no network or I/O.
 * One difficulty = 8 encounters × 27 different class/specs × exactly 100
 * ranked slots. This validates input COVERAGE, not WCL authenticity.
 *
 * VERIFIED slots are skipped only with a concrete NEW actor-level witness.
 * Historical numeric-only PROOF cannot be silently recast as that witness.
 */
const fail=code=>{throw Error(code);};
const requireIt=(condition,code)=>{if(!condition)fail(code);};
const str=s=>typeof s==='string'&&s.length>0;
const sameProof=(s)=>{
  const p=s.proof;
  return p?.proofType==='EXACT_SAME_FIGHT_ACTOR' &&
    str(p.actorRef) && typeof p.bossDps==='number' &&
    Number.isFinite(p.bossDps) && p.bossDps>=0 && p.bossDps<=s.totalDps &&
    p.snapshotSha===s.snapshotSha && p.reportCode===s.reportCode &&
    Number.isSafeInteger(p.reportRevision) && p.reportRevision>=0 &&
    (s.reportRevision==null || s.reportRevision===p.reportRevision) &&
    p.fightId===s.fightId && p.encounterId===s.encounterId &&
    p.difficulty===s.difficulty;
};

export function planFull216(slots){
  requireIt(Array.isArray(slots),'SCOPE_INPUT_INVALID');
  requireIt(slots.length===21600,'SCOPE_EXACT_21600_REQUIRED');
  const jobs=new Map(),encounters=new Map();
  const bossByEncounter=new Map(),encounterByBoss=new Map();
  let difficulty=null,scopeKey=null;
  let missingIdentity=0;
  for(const s of slots){
    requireIt(s&&typeof s==='object'&&
      str(s.jobKey)&&str(s.scopeKey)&&
      Number.isSafeInteger(s.encounterId)&&s.encounterId>0 &&
      (s.difficulty===4||s.difficulty===5),'SCOPE_ROW_INVALID');
    if(scopeKey===null)scopeKey=s.scopeKey;
    if(difficulty===null)difficulty=s.difficulty;
    requireIt(s.scopeKey===scopeKey&&s.difficulty===difficulty,
      'SCOPE_OR_DIFFICULTY_MIXED');
    const parts=s.jobKey.split('|');
    requireIt(parts.length===3 && str(parts[0]) &&
      parts[1]===s.className&&parts[2]===s.specName,'SCOPE_JOB_CLASS_IDENTITY');
    const jobKey=s.jobKey;
    const bossName=parts[0];
    if(bossByEncounter.has(s.encounterId))
      requireIt(bossByEncounter.get(s.encounterId)===bossName,'SCOPE_BOSS_ENCOUNTER_DRIFT');
    if(encounterByBoss.has(bossName))
      requireIt(encounterByBoss.get(bossName)===s.encounterId,'SCOPE_BOSS_ENCOUNTER_DRIFT');
    bossByEncounter.set(s.encounterId,bossName);
    encounterByBoss.set(bossName,s.encounterId);
    let job=jobs.get(jobKey);
    if(!job){
      job={jobKey,encounterId:s.encounterId,snapshotSha:s.snapshotSha,
        ranks:new Set(),classSpec:parts[1]+'|'+parts[2]};
      jobs.set(jobKey,job);
      if(!encounters.has(s.encounterId))encounters.set(s.encounterId,new Set());
      requireIt(!encounters.get(s.encounterId).has(job.classSpec),
        'SCOPE_DUPLICATE_SPECIALIZATION');
      encounters.get(s.encounterId).add(job.classSpec);
    }
    requireIt(job.encounterId===s.encounterId&&job.snapshotSha===s.snapshotSha,
      'SCOPE_JOB_SNAPSHOT_OR_ENCOUNTER_DRIFT');
    requireIt(Number.isInteger(s.rank)&&s.rank>=1&&s.rank<=100 &&
      !job.ranks.has(s.rank),'SCOPE_DUPLICATE_OR_INVALID_RANK');
    job.ranks.add(s.rank);
    if(s.status==='VERIFIED')requireIt(sameProof(s),'SCOPE_UNATTESTED_VERIFIED_SLOT');
    if(s.status==='PENDING' && (!s.reportCode || !s.fightId))missingIdentity++;
  }
  requireIt(jobs.size===216&&encounters.size===8,'SCOPE_JOB_OR_ENCOUNTER_COUNT');
  for(const job of jobs.values())requireIt(job.ranks.size===100,'SCOPE_JOB_TOP100_INCOMPLETE');
  let canonicalSpecs=null;
  for(const specs of encounters.values()){
    requireIt(specs.size===27,'SCOPE_ENCOUNTER_SPECS_INCOMPLETE');
    const signature=JSON.stringify([...specs].sort());
    if(canonicalSpecs===null)canonicalSpecs=signature;
    else requireIt(signature===canonicalSpecs,'SCOPE_SPECIALIZATION_SET_DRIFT');
  }
  // Do not invent a WCL Report/Fight when a pending slot lacks one.
  requireIt(missingIdentity===0,'SCOPE_PENDING_FIGHT_UNRESOLVED');
  const plan=planFightFetches(slots);
  return {
    scopeKey,difficulty,jobs:jobs.size,encounters:encounters.size,
    rankSlots:slots.length,
    verifiedSlotsSkipped:plan.verifiedSkipped,
    pendingRankSlots:plan.pendingSlotCount,
    pendingDistinctReportFights:plan.distinctFightRequests,
    crossJobReferencesCoalesced:plan.reusedReferences,
    // No WCL point estimate. Report/Fight coalescing only reduces
    // in-memory reference count; paid request billing must be measured.
    observedWclPoints:null,expectedWclPointSavings:null,
    groups:plan.groups
  };
}
