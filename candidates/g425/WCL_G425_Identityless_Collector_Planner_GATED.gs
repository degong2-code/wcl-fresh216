/**
 * WCL Fresh216 G4.25 — identityless recovery planner and opt-in collector hook.
 * NON-LIVE delivery: adding this file creates no triggers, makes no WCL requests,
 * writes no RAW/PROOF/PERF/U:Y, and does not change G4.15 by itself.
 *
 * For future approved G4.15 successor integration only: within the existing
 * G4.15 tick's try/finally, install wcl43G425WithPlanner_ around the ORIGINAL
 * G4.15 tick logic (see reference/INTEGRATION_DIFF.md).  DO NOT activate until
 * separately reviewed request and point budgets/rollback have been approved.
 *
 * This planner preserves original named-character priority (and uses same-fight named batches), adds only verifiable
 * anonymous rows with valid fight reference and positive DPS, deduplicates per
 * report+fight, and allows exactly one NEW anonymous fight per planner call.
 * The existing wcl35Recover_ remains the sole author of BossDPS values: it
 * enforces same fight/encounter/difficulty, unique DPS actor, class/spec, unique
 * actor identity in overall and one matching boss actor. No heuristic fill.
 */
const WCL43G425 = Object.freeze({
  ENABLE_IN_G415_TICK:false, // disabled; replacement is reference-only
  ALLOW_LIVE:false,
  ALLOW_PROOF_BACKFILL:false,
  EXPECTED_CURSOR:43,
  MAX_ANON_FIGHTS_PER_PLANNER_CALL:1,
  REQUIRE_STOP_ERROR:'G415_MANUAL_STOP',
  EXPECTED_TOTAL:216
});
function wcl43G425Assert_(cond,reason){if(!cond)throw Error('G425_'+reason);}
function wcl43G425IsAnon_(raw){
  return !!raw&&String(raw.name||'').trim().toLowerCase()==='anonymous'&&
    wcl35Identity_(raw)===null&&wcl35Num_(raw.amount)>0&&!!wcl35Fight_(raw);
}
/** Pure planning; legacyFn MUST be the original wcl35Groups_ captured before hook. */
function wcl43G425Groups_(overall,bossValues,attempts,legacyFn){
  wcl43G425Assert_(typeof legacyFn==='function'&&Array.isArray(overall)&&
    overall.length===100&&Array.isArray(bossValues)&&bossValues.length===100&&
    Array.isArray(attempts),'PLANNER_INPUT_INVALID');
  const standard=legacyFn(overall,bossValues,attempts);
  wcl43G425Assert_(Array.isArray(standard),'LEGACY_PLANNER_INVALID');
  const visited=new Set(attempts);
  // If a normal (identified) group already fetches this exact fight, attach its
  // anonymous sibling(s) to the SAME request. This costs zero extra aliases and
  // avoids a later pointless attempt-ledger exclusion after that fight is queried.
  // Do not create a new fight alias while legacy groups remain available.
  if(standard.length){
    const byHash=new Map(standard.map(g=>[g.hash,g]));
    overall.forEach((raw,index)=>{
      if(bossValues[index]!==null||!wcl43G425IsAnon_(raw))return;
      const f=wcl35Fight_(raw),h=wcl35Hash_('fight|'+f.code+'|'+f.fid);
      const group=byHash.get(h);
      if(group&&!visited.has(h)&&!group.indexes.includes(index))group.indexes.push(index);
    });
    return standard;
  }
  const pool=new Map();
  overall.forEach((raw,index)=>{
    if(bossValues[index]!==null||!wcl43G425IsAnon_(raw))return;
    const f=wcl35Fight_(raw),hash=wcl35Hash_('fight|'+f.code+'|'+f.fid);
    if(visited.has(hash))return;
    if(!pool.has(hash))pool.set(hash,{fight:f,hash:hash,indexes:[],g425_identityless:true});
    pool.get(hash).indexes.push(index);
  });
  const missingTop30=bossValues.slice(0,30).filter(v=>v===null).length;
  const missingTop100=bossValues.filter(v=>v===null).length;
  const priority=g=>{
    const indexes=g.indexes;
    // Preserve EXACT KPI value: focus completion of top30, rank30 and rank100,
    // but never use estimated values. Existing wcl35Recover_ remains arbiter.
    let score=indexes.length*10;
    if(missingTop30===1&&indexes.some(i=>i<30))score+=500;
    if(missingTop100===1)score+=500;
    if(indexes.includes(29))score+=100;
    if(indexes.includes(99))score+=100;
    if(indexes.some(i=>i<30))score+=40;
    return score;
  };
  return Array.from(pool.values()).sort((a,b)=>priority(b)-priority(a)||
    a.indexes[0]-b.indexes[0]).slice(0,WCL43G425.MAX_ANON_FIGHTS_PER_PLANNER_CALL);
}
/** Optional future tick-scoped hook. Never invoked by Preview or file loading. */
function wcl43G425WithPlanner_(invokeTickBody){
  wcl43G425Assert_(WCL43G425.ENABLE_IN_G415_TICK===true&&
    WCL43G425.ALLOW_LIVE===true,'LIVE_NOT_APPROVED');
  wcl43G425Assert_(typeof invokeTickBody==='function'&&
    typeof wcl35Groups_==='function','SOURCE_INVALID');
  const original=wcl35Groups_;
  wcl35Groups_=function(overall,values,attempts){
    return wcl43G425Groups_(overall,values,attempts,original);
  };
  try{return invokeTickBody();}
  finally{wcl35Groups_=original;}
}
/** Read-only consistency preview; does not arm triggers or collectors. */
function wcl43G425Preview(){
  const blockers=[],info={gate:'NB43_G425_IDENTITYLESS_COLLECTOR_PREVIEW',
    status:'BLOCKED',cursor:null,g413_status:null,g415_status:null,
    source_jobs_scanned:0,identityless_missing_slots:null,
    identityless_candidate_fights_within_jobs:null,
    groups_normal_first:true,max_new_anonymous_aliases_per_call:1,
    old_completed_partial_jobs_not_reopened:true,
    collector_hook_active:false,live_allowed:false,proof_backfill_allowed:false,
    point_savings_proven:false,full_216_runtime_improvement_proven:false,
    read_only:true,wcl_http_requests:0,sheet_writes:0,property_writes:0,triggers_changed:0,
    private_identifiers_logged:false};
  try{
    wcl43G425Assert_(typeof wcl43G418Preview==='function'&&
      typeof wcl43G413Jobs_==='function'&&typeof wcl43G413Replay_==='function'&&
      typeof wcl43G413Entry_==='function'&&typeof wcl35CacheRead_==='function'&&
      typeof wcl35Groups_==='function'&&typeof wcl43G413Names_==='function'&&
      typeof wcl43G415Receipt_==='function'&&typeof wcl43G413Read_==='function',
      'DEPENDENCY_MISSING');
    const pre=wcl43G418Preview(),s=wcl43G413Read_(),receipt=wcl43G415Receipt_();
    wcl43G425Assert_(pre&&pre.status==='PASS'&&pre.safe===true&&
      s&&s.status==='STOPPED'&&s.cursor===WCL43G425.EXPECTED_CURSOR&&
      s.error===WCL43G425.REQUIRE_STOP_ERROR&&s.inFlight===false&&
      receipt&&receipt.status==='STOPPED'&&receipt.g413RunId===s.runId&&
      WCL43G415.ALLOW_RESUME===false&&WCL43G418.ALLOW_RESUME===false,
      'STOP_IDENTITY_DRIFT');
    info.cursor=s.cursor;info.g413_status=s.status;info.g415_status=receipt.status;
    const ss=wcl43G413Safe_().ss,n=wcl43G413Names_(),jobs=wcl43G413Jobs_();
    wcl43G425Assert_(jobs.length===WCL43G425.EXPECTED_TOTAL,'JOB_COUNT_DRIFT');
    let missing=0,fights=0,unmatched=0;
    const proofSheet=ss.getSheetByName(n.proof);
    for(let i=0;i<s.cursor;i++){
      const j=jobs[i],entry=wcl43G413Entry_(ss,j),rank=wcl43G413Replay_(ss,s,j);
      const proof=wcl35CacheRead_(proofSheet,j.benchIndex,j.key);
      wcl43G425Assert_(entry&&entry.opt&&entry.raw&&proof&&
        proof.hash===entry.raw.rawSha&&proof.bossHash===entry.raw.rawBossSha&&
        entry.opt.rankingSha===proof.hash&&entry.opt.bossSha===proof.bossHash&&
        Array.isArray(proof.boss)&&proof.boss.length===100&&
        Array.isArray(proof.attempts)&&rank.overall.length===100,
        'COMMITTED_SOURCE_DRIFT');
      const present=new Set(proof.attempts),seen=new Set();
      for(let k=0;k<100;k++){
        if(proof.boss[k]!==null||!wcl43G425IsAnon_(rank.overall[k]))continue;
        missing++;
        const f=wcl35Fight_(rank.overall[k]),h=wcl35Hash_('fight|'+f.code+'|'+f.fid);
        if(present.has(h)){unmatched++;continue;}
        seen.add(h);
      }
      fights+=seen.size;
      info.source_jobs_scanned++;
    }
    info.identityless_missing_slots=missing;
    info.identityless_candidate_fights_within_jobs=fights;
    info.anonymous_slots_in_existing_attempts=unmatched;
    wcl43G425Assert_(missing===67&&fights===65&&unmatched===0,'BASELINE_PROOF_DRIFT');
    info.status='PASS';
  }catch(e){
    const reason=String(e&&e.message||e);
    blockers.push(/^G425_[A-Z0-9_]+$/.test(reason)?reason:'G425_SOURCE_OR_RUNTIME_ERROR');
  }
  info.blockers=blockers;
  Logger.log(JSON.stringify(info));return info;
}