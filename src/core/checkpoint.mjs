/**
 * Pure durable-state contract: NO network, clock, filesystem or Google access.
 * Each fetch attempt is written BEFORE its external HTTP call.
 * After an interruption an IN_FLIGHT request is uncertain and NEVER auto-retried.
 *
 * Caller MUST atomically persist each resulting state before continuing.
 * A successfully observed HTTP response alone is not a durable checkpoint.
 */
const fail=(code)=>{throw new Error(code);};
const ok=(v,code)=>{if(!v)fail(code);};
const keyOf=(s)=>JSON.stringify([s.jobKey,s.rank,s.snapshotSha]);
const requestKey=(g)=>JSON.stringify([
  g.scopeKey,g.reportCode,g.fightId,g.encounterId,
  g.difficulty,g.reportRevision??null
]);
const idFields=(g)=>({
  scopeKey:g.scopeKey,reportCode:g.reportCode,fightId:g.fightId,
  encounterId:g.encounterId,difficulty:g.difficulty,
  reportRevision:g.reportRevision??null
});
const slotShape=(s)=>({
  jobKey:s.jobKey,rank:s.rank,snapshotSha:s.snapshotSha,
  totalDps:s.totalDps,className:s.className,specName:s.specName,
  name:s.name??''
});
const clone=(o)=>structuredClone(o);
const numCost=(v)=>v===null||(typeof v==='number'&&Number.isFinite(v)&&v>=0);

export function newCheckpoint(scopeKey,runId){
  ok(typeof scopeKey==='string'&&scopeKey&&typeof runId==='string'&&runId,'INVALID_RUN_ID');
  return {schema:1,scopeKey,runId,version:0,status:'ACTIVE',entries:{},rankRequests:{},sourceRequests:{}};
}
export function registerPlan(state,groups){
  ok(state?.schema===1&&state.status==='ACTIVE','NOT_ACTIVE');
  ok(Array.isArray(groups),'GROUPS_INVALID');
  const out=clone(state),seen=new Set(),seenRank=new Map(),jobSnapshots=new Map();
  // A ranked position must map to one immutable fight and one snapshot
  // across ALL groups, including groups checkpointed in earlier ticks.
  for(const [existingKey,entry] of Object.entries(out.entries)){
    for(const item of entry.slots){
      const rankKey=JSON.stringify([state.scopeKey,item.jobKey,item.rank]);
      ok(!seenRank.has(rankKey),'CHECKPOINT_DUPLICATE_RANK');
      seenRank.set(rankKey,existingKey);
      const jobKey=JSON.stringify([state.scopeKey,item.jobKey]);
      const prior=jobSnapshots.get(jobKey);
      ok(!prior||prior===item.snapshotSha,'CHECKPOINT_SNAPSHOT_DRIFT');
      jobSnapshots.set(jobKey,item.snapshotSha);
    }
  }
  for(const g of groups){
    ok(g?.scopeKey===state.scopeKey && g.reportCode &&
      Number.isSafeInteger(g.fightId)&&g.fightId>0 &&
      Number.isSafeInteger(g.encounterId)&&g.encounterId>0 &&
      Number.isSafeInteger(g.difficulty)&&g.difficulty>0 &&
      (g.reportRevision==null || (Number.isSafeInteger(g.reportRevision)&&g.reportRevision>=0)) &&
      Array.isArray(g.slots)&&g.slots.length>0,'GROUP_INVALID');
    const key=requestKey(g);
    ok(!seen.has(key),'DUPLICATE_FETCH_GROUP');seen.add(key);
    const slots=g.slots.map(slotShape).sort((a,b)=>
      a.jobKey.localeCompare(b.jobKey)||a.rank-b.rank);
    const fingerprints=slots.map(keyOf);
    ok(new Set(fingerprints).size===slots.length,'DUPLICATE_RANK');
    for(const item of slots){
      ok(typeof item.jobKey==='string'&&item.jobKey.length>0 &&
        Number.isInteger(item.rank)&&item.rank>=1&&item.rank<=100 &&
        /^[a-f0-9]{64}$/i.test(item.snapshotSha||'') &&
        Number.isFinite(item.totalDps)&&item.totalDps>0,'RANK_SLOT_INVALID');
      const rankKey=JSON.stringify([state.scopeKey,item.jobKey,item.rank]);
      const previousGroup=seenRank.get(rankKey);
      ok(!previousGroup||previousGroup===key,'RANK_MAPPED_TO_MULTIPLE_FIGHTS');
      seenRank.set(rankKey,key);
      const jobKey=JSON.stringify([state.scopeKey,item.jobKey]);
      const prior=jobSnapshots.get(jobKey);
      ok(!prior||prior===item.snapshotSha,'JOB_SNAPSHOT_DRIFT');
      jobSnapshots.set(jobKey,item.snapshotSha);
    }
    const old=out.entries[key];
    if(old){
      ok(JSON.stringify(old.slots)===JSON.stringify(slots),'FETCH_PLAN_DRIFT');
      continue;
    }
    out.entries[key]={
      key,identity:idFields(g),slots,status:'READY',attempt:null,
      result:null,incident:null,observedPoints:null,wallMs:null
    };
  }
  out.version++;return out;
}
export function readyFetches(state){
  ok(state?.schema===1,'CHECKPOINT_INVALID');
  if(state.status!=='ACTIVE')return [];
  return Object.values(state.entries)
    .filter(e=>e.status==='READY')
    .sort((a,b)=>b.slots.length-a.slots.length||a.key.localeCompare(b.key))
    .map(e=>({key:e.key,...clone(e.identity),slots:clone(e.slots)}));
}
export function beginFetch(state,key,attemptId,atMs){
  ok(state?.status==='ACTIVE','NOT_ACTIVE');
  const entry=state.entries?.[key];
  ok(entry,'FETCH_NOT_PLANNED');
  ok(entry.status==='READY','FETCH_NOT_READY');
  // A single scope must not admit a second billed request while the first
  // is IN_FLIGHT, or after any uncertain/unreconciled result. This protects
  // the budget even for direct callers bypassing the bounded sweep.
  const hasUnsafeAttempt=[...Object.values(state.entries),
    ...Object.values(state.rankRequests??{}),...Object.values(state.sourceRequests??{})].some(e=>
    e.status==='IN_FLIGHT'||e.status==='NEEDS_REVIEW'||
    (e.attempt && e.observedPoints===null));
  ok(!hasUnsafeAttempt,'SCOPE_HAS_UNRESOLVED_ATTEMPT');
  ok(typeof attemptId==='string'&&attemptId.length>0&&Number.isSafeInteger(atMs)&&atMs>=0,
    'INVALID_ATTEMPT');
  // Unique within this run, including completed/failed attempts.
  ok(![...Object.values(state.entries),...Object.values(state.rankRequests??{}),...Object.values(state.sourceRequests??{})]
    .some(e=>e.attempt?.id===attemptId),'DUPLICATE_ATTEMPT_ID');
  const out=clone(state);
  const target=out.entries[key];
  target.status='IN_FLIGHT';target.attempt={id:attemptId,startedAtMs:atMs};
  out.version++;return out;
}
function attempted(state,key,attemptId){
  const e=state?.entries?.[key];
  ok(e,'FETCH_NOT_PLANNED');
  ok(e.status==='IN_FLIGHT'&&e.attempt?.id===attemptId,'ATTEMPT_NOT_CURRENT');
  return e;
}
export function completeFetch(state,key,attemptId,joined,{points=null,wallMs=null}={}){
  const e=attempted(state,key,attemptId);
  ok(numCost(points),'POINT_COST_INVALID');
  ok(wallMs===null||(Number.isFinite(wallMs)&&wallMs>=0),'WALL_TIME_INVALID');
  ok(joined&&Array.isArray(joined.verified)&&Array.isArray(joined.unresolved),
    'JOIN_RESULT_INVALID');
  const expected=new Map(e.slots.map(s=>[keyOf(s),s])),covered=new Set();
  const committed=[];
  for(const row of joined.verified){
    const proof=row?.proof;
    const rk=keyOf(row);
    const original=expected.get(rk);
    ok(original&&!covered.has(rk),'PROOF_SLOT_MISMATCH');covered.add(rk);
    ok(proof?.proofType==='EXACT_SAME_FIGHT_ACTOR'&&
      typeof proof.actorRef==='string'&&proof.actorRef&&
      typeof proof.bossDps==='number'&&Number.isFinite(proof.bossDps)&&
      proof.bossDps>=0&&proof.bossDps<=original.totalDps &&
      proof.snapshotSha===original.snapshotSha &&
      proof.reportCode===e.identity.reportCode &&
      proof.fightId===e.identity.fightId &&
      proof.encounterId===e.identity.encounterId &&
      proof.difficulty===e.identity.difficulty &&
      Number.isSafeInteger(proof.reportRevision)&&proof.reportRevision>=0 &&
      (e.identity.reportRevision===null ||
       proof.reportRevision===e.identity.reportRevision),'INVALID_PROOF');
    committed.push({
      jobKey:row.jobKey,rank:row.rank,snapshotSha:row.snapshotSha,proof:clone(proof)
    });
  }
  const unresolved=[];
  for(const row of joined.unresolved){
    const rk=keyOf(row);
    ok(expected.has(rk)&&!covered.has(rk),'UNRESOLVED_SLOT_MISMATCH');
    covered.add(rk);
    unresolved.push({jobKey:row.jobKey,rank:row.rank,snapshotSha:row.snapshotSha});
  }
  ok(covered.size===expected.size,'INCOMPLETE_JOIN_COVERAGE');
  const out=clone(state),target=out.entries[key];
  target.status=unresolved.length?'COMPLETED_PARTIAL':'COMPLETED';
  target.result={verified:committed,unresolved};
  target.observedPoints=points;target.wallMs=wallMs;
  out.version++;return out;
}
export function uncertainFailure(state,key,attemptId,{code,points=null,wallMs=null}={}){
  attempted(state,key,attemptId);
  ok(typeof code==='string'&&/^[A-Z0-9_]{2,60}$/.test(code),'INCIDENT_CODE_INVALID');
  ok(numCost(points),'POINT_COST_INVALID');
  ok(wallMs===null||(Number.isFinite(wallMs)&&wallMs>=0),'WALL_TIME_INVALID');
  const out=clone(state),e=out.entries[key];
  e.status='NEEDS_REVIEW';e.incident={code,automaticRetry:false};
  e.observedPoints=points;e.wallMs=wallMs;
  out.version++;return out;
}

/**
 * A Report wave is ONE WCL request covering 1..8 already-registered fights.
 * It reuses the existing persisted checkpoint entries, not a second journal.
 * Each member has the SAME attempt id, membership and ONE request-level cost.
 * The store commits the entire returned state atomically.
 */
const waveKeys=(state,wave)=>{
  ok(state?.schema===1&&state.status==='ACTIVE'&&wave&&
    wave.scopeKey===state.scopeKey&&typeof wave.reportCode==='string'&&
    Array.isArray(wave.fightGroups)&&wave.fightGroups.length>=1&&
    wave.fightGroups.length<=8,'WAVE_CHECKPOINT_SHAPE');
  const keys=[],seen=new Set();
  for(const g of wave.fightGroups){
    ok(g.scopeKey===wave.scopeKey&&g.reportCode===wave.reportCode&&
      (g.reportRevision??null)===(wave.reportRevision??null)&&
      Array.isArray(g.slots)&&g.slots.length>0,'WAVE_CHECKPOINT_GROUP_DRIFT');
    const k=requestKey(g),entry=state.entries?.[k];
    ok(entry&&entry.status==='READY'&&!seen.has(k),'WAVE_CHECKPOINT_NOT_READY');
    seen.add(k);keys.push(k);
    const actual=entry.slots.map(s=>JSON.stringify([
      s.jobKey,s.rank,s.snapshotSha,s.totalDps,s.className,s.specName,
      s.name??''])).sort();
    const proposed=g.slots.map(s=>JSON.stringify([
      s.jobKey,s.rank,s.snapshotSha,s.totalDps,s.className,s.specName,
      s.name??''])).sort();
    ok(JSON.stringify(actual)===JSON.stringify(proposed),
      'WAVE_CHECKPOINT_SLOT_DRIFT');
  }
  return keys;
};
const waveAttempt=(state,wave,attemptId)=>{
  ok(state?.schema===1&&wave&&Array.isArray(wave.fightGroups)&&
    wave.fightGroups.length>=1&&wave.fightGroups.length<=8,
    'WAVE_CHECKPOINT_SHAPE');
  const keys=wave.fightGroups.map(requestKey);
  ok(new Set(keys).size===keys.length,'WAVE_CHECKPOINT_DUPLICATE_FIGHT');
  const canonical=keys.slice().sort();
  for(const k of keys){
    const a=state.entries?.[k]?.attempt;
    ok(state.entries[k].status==='IN_FLIGHT'&&
      a?.id===attemptId&&a.kind==='REPORT_WAVE'&&
      JSON.stringify(a.waveKeys)===JSON.stringify(canonical),
      'WAVE_CHECKPOINT_ATTEMPT_DRIFT');
  }
  return keys;
};
export function beginWaveFetch(state,wave,attemptId,atMs){
  const keys=waveKeys(state,wave);
  ok(typeof attemptId==='string'&&attemptId&&
    Number.isSafeInteger(atMs)&&atMs>=0,'INVALID_ATTEMPT');
  ok(![...Object.values(state.entries),...Object.values(state.rankRequests??{}),...Object.values(state.sourceRequests??{})].some(e=>
    e.status==='IN_FLIGHT'||e.status==='NEEDS_REVIEW'||
    (e.attempt&&e.observedPoints===null)),
    'SCOPE_HAS_UNRESOLVED_ATTEMPT');
  ok(![...Object.values(state.entries),...Object.values(state.rankRequests??{}),
    ...Object.values(state.sourceRequests??{})].some(e=>e.attempt?.id===attemptId),
    'DUPLICATE_ATTEMPT_ID');
  const out=clone(state),canonical=keys.slice().sort();
  for(const k of keys){
    out.entries[k].status='IN_FLIGHT';
    out.entries[k].attempt={id:attemptId,startedAtMs:atMs,
      kind:'REPORT_WAVE',waveKeys:canonical};
  }
  out.version++;return out;
}
export function completeWaveFetch(state,wave,attemptId,joinedByFight,{
  points=null,wallMs=null
}={}){
  const keys=waveAttempt(state,wave,attemptId);
  ok(Array.isArray(joinedByFight)&&joinedByFight.length===keys.length,
    'WAVE_CHECKPOINT_JOIN_COUNT');
  // All proof checks complete in a PRIVATE clone. A single store.update()
  // either commits every fight together, or throws without persistence.
  let result=state;
  for(let i=0;i<keys.length;i++){
    result=completeFetch(result,keys[i],attemptId,
      joinedByFight[i],{points,wallMs});
  }
  const out={...result,version:state.version+1};
  return out;
}
export function uncertainWaveFailure(state,wave,attemptId,{
  code,points=null,wallMs=null
}={}){
  const keys=waveAttempt(state,wave,attemptId);
  let result=state;
  for(const key of keys)
    result=uncertainFailure(result,key,attemptId,{code,points,wallMs});
  return {...result,version:state.version+1};
}

export function recoverCheckpoint(state){
  ok(state?.schema===1,'CHECKPOINT_INVALID');
  const out=clone(state);
  let changed=false;
  for(const e of [...Object.values(out.entries),...Object.values(out.rankRequests??{}),...Object.values(out.sourceRequests??{})]){
    if(e.status==='IN_FLIGHT'){
      e.status='NEEDS_REVIEW';
      e.incident={code:'INTERRUPTED_IN_FLIGHT',automaticRetry:false};
      changed=true;
    }
  }
  if(changed)out.version++;
  return out;
}
export function stopCheckpoint(state){
  ok(state?.schema===1,'CHECKPOINT_INVALID');
  const out=recoverCheckpoint(state);
  if(out.status!=='STOPPED'){out.status='STOPPED';out.version++;}
  return out;
}
export function resumeCheckpoint(state){
  ok(state?.schema===1&&state.status==='STOPPED','NOT_STOPPED');
  const out=clone(state);out.status='ACTIVE';out.version++;
  // NEEDS_REVIEW entries intentionally never return to READY.
  return out;
}
export function checkpointStats(state){
  ok(state?.schema===1,'CHECKPOINT_INVALID');
  const counts={READY:0,IN_FLIGHT:0,COMPLETED:0,COMPLETED_PARTIAL:0,NEEDS_REVIEW:0};
  let witnessedPoints=0,pointsUnobserved=0,proofs=0,unresolved=0;
  const billedAttempts=new Map();
  for(const e of Object.values(state.entries)){
    counts[e.status]=(counts[e.status]||0)+1;
    if(e.attempt){
      const a=e.attempt;
      const existing=billedAttempts.get(a.id);
      if(existing){
        ok(a.kind==='REPORT_WAVE'&&existing.kind==='REPORT_WAVE'&&
          JSON.stringify(a.waveKeys)===JSON.stringify(existing.waveKeys)&&
          e.observedPoints===existing.points,'CHECKPOINT_ATTEMPT_ACCOUNTING_DRIFT');
      }else billedAttempts.set(a.id,{kind:a.kind??'SINGLE',
        waveKeys:a.waveKeys??null,points:e.observedPoints});
    }
    if(e.result){proofs+=e.result.verified.length;unresolved+=e.result.unresolved.length;}
  }
  for(const e of Object.values(state.rankRequests??{})){
    counts[e.status]=(counts[e.status]||0)+1;
    if(e.attempt){
      ok(!billedAttempts.has(e.attempt.id),'CHECKPOINT_DUPLICATE_RANK_ATTEMPT');
      billedAttempts.set(e.attempt.id,{kind:'RANK_BATCH',points:e.observedPoints});
    }
    if(e.result?.verified)proofs+=e.result.verified.length;
  }
  for(const e of Object.values(state.sourceRequests??{})){
    counts[e.status]=(counts[e.status]||0)+1;
    if(e.attempt){
      ok(!billedAttempts.has(e.attempt.id),'CHECKPOINT_DUPLICATE_SOURCE_ATTEMPT');
      billedAttempts.set(e.attempt.id,{kind:'TOTAL_COHORT_BATCH',
        points:e.observedPoints});
    }
  }
  for(const a of billedAttempts.values()){
    if(a.points===null)pointsUnobserved++;
    else witnessedPoints+=a.points;
  }
  return {version:state.version,runStatus:state.status,counts,
    witnessedPoints,pointsUnobserved,pointsTotalConfirmed:pointsUnobserved===0?witnessedPoints:null,
    verifiedSlotEvidence:proofs,unresolvedSlotEvidence:unresolved};
}
export function committedProofs(state){
  ok(state?.schema===1,'CHECKPOINT_INVALID');
  return [...Object.values(state.entries).flatMap(e=>
    e.result?clone(e.result.verified):[]),
    ...Object.values(state.rankRequests??{}).flatMap(e=>
      e.result?.verified?clone(e.result.verified):[])];
}
