/**
 * ONE-WAVE, zero-side-effect WCL query candidate.
 * Reuse existing NPC gameIDs; request the minimum Report/Fight identity plus
 * the boss-filtered DamageDone Source table. No masterData, enemyNPCs, full
 * TotalDPS table, WCL transport, cache, checkpoint or C writer.
 *
 * This is deliberately a research candidate, not a proven production query.
 * Response comparison requires independently frozen official BossDPS values.
 */
import {createHash} from 'node:crypto';

const fail = code => {throw Error(code)};
const need = (condition,code) => {if(!condition)fail(code)};
const positive = n => Number.isSafeInteger(n) && n>0;
const validReport = v => typeof v==='string' && /^[A-Za-z0-9]{16}$/.test(v);
const sha = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const hashName = name => sha(String(name??'').trim().toLowerCase());
const finite = n => typeof n==='number' && Number.isFinite(n) && n>=0;
const fightKey = v => JSON.stringify([v.reportCode,v.fightId]);

export function makeLeanBossTableQuery(fights, targetRegistry,{maxTables=8}={}) {
  need(Array.isArray(fights)&&fights.length>0&&fights.length<=maxTables&&
    positive(maxTables)&&maxTables<=32, 'LEAN_INPUT_BOUNDS');
  need(Array.isArray(targetRegistry)&&targetRegistry.length>0,
    'LEAN_TARGET_REGISTRY_MISSING');
  const idMap=new Map();
  for(const t of targetRegistry) {
    need(positive(t.encounterID)&&Array.isArray(t.npcGameIDs)&&
      t.npcGameIDs.length>0&&t.npcGameIDs.every(positive)&&
      new Set(t.npcGameIDs).size===t.npcGameIDs.length&&
      !idMap.has(t.encounterID),'LEAN_TARGET_REGISTRY_INVALID');
    idMap.set(t.encounterID,t.npcGameIDs);
  }
  const defs=[],vars={},groups=new Map(),seen=new Set(),flat=[];
  for(let i=0;i<fights.length;i++) {
    const f=fights[i],ids=idMap.get(f.encounterId);
    need(f&&validReport(f.reportCode)&&positive(f.fightId)&&
      positive(f.encounterId)&&f.difficulty===4&&ids&&
      (f.expectedRevision==null||
        Number.isSafeInteger(f.expectedRevision)&&f.expectedRevision>=0),
      'LEAN_FIGHT_SCOPE_INVALID');
    const k=fightKey(f);
    need(!seen.has(k),'LEAN_DUPLICATE_FIGHT');
    seen.add(k);
    const group=groups.get(f.reportCode)??[];
    group.push({...f,index:i});
    groups.set(f.reportCode,group);
    vars['f'+i]=f.fightId;
    vars['expr'+i]='target.id IN ('+ids.join(', ')+')';
    defs.push('$f'+i+':Int!','$expr'+i+':String!');
    flat.push({reportCode:f.reportCode,fightId:f.fightId,
      encounterId:f.encounterId,expectedRevision:f.expectedRevision??null,
      index:i,npcGameIDs:ids.slice(),expectedActors:f.expectedActors??[]});
  }
  const fields=[],reportIndex=[];
  let ri=0;
  for(const [code,arr] of groups) {
    const reportAlias='r'+ri,codeVar='c'+ri;
    vars[codeVar]=code;defs.push('$'+codeVar+':String!');
    const fightVars=arr.map(f=>'$f'+f.index).join(',');
    const nested=['code revision fights(fightIDs:['+fightVars+
      ']){id encounterID difficulty kill startTime endTime}'];
    for(const f of arr)
      nested.push('t'+f.index+':table(dataType:DamageDone,'+
        'fightIDs:[$f'+f.index+'],viewBy:Source,'+
        'filterExpression:$expr'+f.index+')');
    fields.push(reportAlias+':report(code:$'+codeVar+'){'+nested.join(' ')+'}');
    reportIndex.push({reportAlias,reportCode:code,fields:arr.map(f=>f.index)});
    ri++;
  }
  const query='query Fresh216LeanBossTables('+defs.join(',')+')'+
    '{rateLimitData{currentRequest limitPerHour pointsSpentThisHour} '+
    'reportData{'+fields.join(' ')+'}}';
  need(!/masterData|enemyNPCs|playerDetails|events|totalTable/.test(query),
    'LEAN_QUERY_CONTAINS_EXPENSIVE_DISCOVERY');
  return {query,variables:vars,fields:flat,reportIndex,
    querySha256:sha({query,variables:vars}),requestCount:1,
    namedTableFields:fights.length,reportGroups:groups.size};
}

/**
 * Compare a live response against independent frozen exact actor witnesses.
 * If name, revision, encounter, duration, WCL points or DPS cannot be verified,
 * stop instead of silently accepting partial evidence. This function never
 * calls WCL or writes any persistent state.
 */
export function compareLeanBossTable(queryPlan,{httpStatus,body,wallMs,bytes}={}) {
  need(queryPlan&&Array.isArray(queryPlan.fields)&&
    Array.isArray(queryPlan.reportIndex),'LEAN_COMPARISON_PLAN_INVALID');
  const summary={status:'NEEDS_REVIEW',querySha256:queryPlan.querySha256,
    reports:queryPlan.reportGroups,fights:queryPlan.fields.length,
    targetActors:queryPlan.fields.reduce((n,f)=>n+f.expectedActors.length,0),
    exact:0,missing:0,mismatch:0,unknownPoints:false,
    points:null,appPoints:null,databasePoints:null,
    wallMs:finite(wallMs)?wallMs:null,
    bytes:Number.isSafeInteger(bytes)&&bytes>=0?bytes:null,
    issue:null};
  let cost=body?.data?.rateLimitData?.currentRequest;
  if(typeof cost==='string'){try{cost=JSON.parse(cost)}catch{cost=null}}
  if(finite(cost?.total)) {
    summary.points=cost.total;
    summary.appPoints=finite(cost.application)?cost.application:null;
    summary.databasePoints=finite(cost.database)?cost.database:null;
  }else summary.unknownPoints=true;
  const refuse=reason=>({...summary,issue:reason});
  if(httpStatus!==200||!body||Array.isArray(body.errors)&&body.errors.length>0)
    return refuse('LEAN_HTTP_OR_GRAPHQL_UNCERTAIN');
  if(summary.unknownPoints)return refuse('LEAN_POINTS_UNKNOWN');
  const reportByField=new Map();
  for(const g of queryPlan.reportIndex) {
    const r=body?.data?.reportData?.[g.reportAlias];
    if(r?.code!==g.reportCode||!Number.isSafeInteger(r?.revision)||r.revision<0)
      return refuse('LEAN_REPORT_IDENTITY_MISMATCH');
    for(const i of g.fields)reportByField.set(i,r);
  }
  for(const f of queryPlan.fields) {
    const report=reportByField.get(f.index);
    if(f.expectedRevision!=null&&report.revision!==f.expectedRevision)
      return refuse('LEAN_REPORT_REVISION_CHANGED');
    const matching=report.fights?.filter(x=>x.id===f.fightId);
    if(matching?.length!==1||matching[0].encounterID!==f.encounterId||
      matching[0].difficulty!==4||matching[0].kill!==true)
      return refuse('LEAN_FIGHT_IDENTITY_MISMATCH');
    const fight=matching[0],duration=fight.endTime-fight.startTime;
    if(!finite(duration)||duration<=0)return refuse('LEAN_FIGHT_DURATION_INVALID');
    const entries=report['t'+f.index]?.data?.entries;
    if(!Array.isArray(entries)||entries.length===0)
      return refuse('LEAN_BOSS_TABLE_MISSING');
    const byHash=new Map();
    for(const entry of entries){
      if(typeof entry.name!=='string'||!finite(Number(entry.total)))
        return refuse('LEAN_SOURCE_TABLE_ROW_INVALID');
      const h=hashName(entry.name),group=byHash.get(h)??[];
      group.push(entry);byHash.set(h,group);
    }
    for(const a of f.expectedActors){
      if(!/^[a-f0-9]{64}$/.test(a.actorNameSha256)||
        !finite(a.bossDps))return refuse('LEAN_FROZEN_ACTOR_INVALID');
      const matches=byHash.get(a.actorNameSha256)??[];
      if(matches.length!==1){summary.missing++;continue}
      const dps=Number(matches[0].total)*1000/duration;
      if(!finite(dps))return refuse('LEAN_BOSSDPS_INVALID');
      if(Math.abs(dps-a.bossDps)<=0.005)summary.exact++;
      else summary.mismatch++;
    }
  }
  summary.status=summary.missing===0&&summary.mismatch===0&&
    summary.targetActors>0?'EXACT_PARITY_PASS':'NEEDS_REVIEW';
  summary.issue=summary.status==='EXACT_PARITY_PASS'?null:'LEAN_ACTOR_PARITY_MISMATCH';
  return summary;
}
