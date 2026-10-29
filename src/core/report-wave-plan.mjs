/**
 * Pure, bounded grouping of distinct Report/Fight fetch candidates into
 * one report(code) GraphQL document per wave. No network, credentials or
 * durable cache. HTTP request count is NOT WCL API point cost.
 *
 * IMPORTANT: a wave is ONE potentially charged HTTP operation. The common
 * checkpoint.mjs now supports an atomic whole-wave IN_FLIGHT/commit operation.
 * report-wave-runner.mjs is the offline transport-injected execution boundary.
 * Never dispatch a multi-fight wave using the single-fight runner.
 */
const fail=code=>{throw Error(code);};
const ok=(condition,code)=>{if(!condition)fail(code);};
const int=n=>Number.isSafeInteger(n)&&n>0;
const validCode=s=>typeof s==='string'&&s.length>0&&s.length<=128&&/^[\x21-\x7e]+$/.test(s);
const key=g=>JSON.stringify([g.scopeKey,g.reportCode,g.reportRevision??null]);
const groupKey=g=>JSON.stringify([g.scopeKey,g.reportCode,g.reportRevision??null,
  g.fightId,g.encounterId,g.difficulty]);
const clone=o=>structuredClone(o);

export function planReportWaves(fetchPlan,{maxFightsPerWave=4}={}){
  ok(fetchPlan&&Array.isArray(fetchPlan.groups)&&int(maxFightsPerWave)&&
    maxFightsPerWave<=8,'WAVE_INPUT_INVALID');
  const buckets=new Map(),seen=new Set(),fightsPerBucket=new Map();
  for(const g of fetchPlan.groups){
    ok(g&&typeof g.scopeKey==='string'&&g.scopeKey&&validCode(g.reportCode)&&
      int(g.fightId)&&int(g.encounterId)&&int(g.difficulty)&&
      (g.reportRevision==null||
       (Number.isSafeInteger(g.reportRevision)&&g.reportRevision>=0))&&
      Array.isArray(g.slots)&&g.slots.length>0,'WAVE_GROUP_INVALID');
    const id=groupKey(g);
    ok(!seen.has(id),'WAVE_DUPLICATE_GROUP');
    seen.add(id);
    const bucket=key(g);
    if(!buckets.has(bucket)){
      buckets.set(bucket,[]);
      fightsPerBucket.set(bucket,new Set());
    }
    ok(!fightsPerBucket.get(bucket).has(g.fightId),'WAVE_FIGHT_ENCOUNTER_CONFLICT');
    fightsPerBucket.get(bucket).add(g.fightId);
    buckets.get(bucket).push(g);
  }
  const waves=[];
  for(const [bucket,groups] of [...buckets.entries()].sort((a,b)=>a[0].localeCompare(b[0]))){
    groups.sort((a,b)=>a.fightId-b.fightId||
      a.encounterId-b.encounterId||a.difficulty-b.difficulty);
    for(let i=0;i<groups.length;i+=maxFightsPerWave){
      const page=groups.slice(i,i+maxFightsPerWave);
      waves.push({
        waveId:JSON.stringify([bucket,i/maxFightsPerWave]),
        scopeKey:page[0].scopeKey,
        reportCode:page[0].reportCode,
        reportRevision:page[0].reportRevision??null,
        fightGroups:clone(page)
      });
    }
  }
  const fightGroups=fetchPlan.groups.length;
  const references=fetchPlan.pendingSlotCount??fetchPlan.pendingRankSlots??null;
  return {
    waves,distinctFightGroups:fightGroups,graphQLWaveCount:waves.length,
    queryRankingsAliases:fightGroups*2,
    httpRequestsIfExecuted:waves.length,
    separateFightHttpBaseline:fightGroups,
    // Only an HTTP count under the same single-fight query model.
    theoreticalHttpCallsCoalesced:fightGroups-waves.length,
    // The older single-fight runner cannot execute multi-fight waves.
    // The shared checkpoint now supports one atomic request spanning a wave.
    currentCheckpointCompatible:waves.every(w=>w.fightGroups.length===1),
    waveCheckpointCompatible:true,
    waveJournalRequired:false,
    readyForLiveExecution:false,
    pendingRankReferences:references,observedWclPoints:null,
    expectedWclPointSavings:null
  };
}
export function makeRankingsWaveQuery(wave){
  ok(wave&&validCode(wave.reportCode)&&Array.isArray(wave.fightGroups)&&
    wave.fightGroups.length>=1&&wave.fightGroups.length<=8,
    'WAVE_QUERY_INVALID');
  const vars={code:wave.reportCode};
  const declarations=['$code:String!'];
  const fields=['code revision'];
  for(let i=0;i<wave.fightGroups.length;i++){
    const group=wave.fightGroups[i];
    ok(group.reportCode===wave.reportCode &&
      (group.reportRevision??null)===(wave.reportRevision??null)&&
      group.scopeKey===wave.scopeKey&&int(group.fightId),
      'WAVE_QUERY_GROUP_DRIFT');
    vars['fight'+i]=group.fightId;
    declarations.push('$fight'+i+':Int!');
    fields.push('o'+i+':rankings(fightIDs:[$fight'+i+'],playerMetric:dps)');
    fields.push('b'+i+':rankings(fightIDs:[$fight'+i+'],playerMetric:bossdps)');
  }
  return {
    query:'query Fresh216Wave('+declarations.join(',')+') { '+
      'rateLimitData{currentRequest} reportData{report(code:$code){'+
      fields.join(' ')+'}}}',
    variables:vars
  };
}
export function decodeRankingsWave(wave,httpStatus,body){
  let requestCost=body?.data?.rateLimitData?.currentRequest;
  if(typeof requestCost==='string'){
    try{requestCost=JSON.parse(requestCost);}catch{requestCost=null;}
  }
  const p=requestCost?.total;
  const observedPoints=typeof p==='number'&&Number.isFinite(p)&&p>=0?p:null;
  const refuse=reason=>({status:reason,observedPoints,results:[]});
  if(!wave||!Array.isArray(wave.fightGroups)||wave.fightGroups.length===0)
    return refuse('WAVE_INVALID');
  if(httpStatus!==200 || !body || typeof body!=='object' ||
    (body.errors!=null&&(!Array.isArray(body.errors)||body.errors.length>0)))
    return refuse('HTTP_OR_GRAPHQL_UNCERTAIN');
  const report=body.data?.reportData?.report;
  if(!report||report.code!==wave.reportCode ||
    !Number.isSafeInteger(report.revision)||report.revision<0||
    (wave.reportRevision!=null&&wave.reportRevision!==report.revision))
    return refuse('WAVE_REPORT_IDENTITY_DRIFT');
  const results=[];
  for(let i=0;i<wave.fightGroups.length;i++){
    const overall=report['o'+i],boss=report['b'+i];
    if(!overall||!boss||!Array.isArray(overall.data)||!Array.isArray(boss.data))
      return refuse('WAVE_RANKINGS_SHAPE_INVALID');
    results.push({
      group:clone(wave.fightGroups[i]),
      report:{code:report.code,revision:report.revision,
        overall:clone(overall),boss:clone(boss)}
    });
  }
  return {status:'OK',observedPoints,results};
}
