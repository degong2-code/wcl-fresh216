/**
 * Offline-only candidate identity bridge for an EXISTING WCL response set.
 * The official WCL GraphQL schema defines ReportActor.id as report-local;
 * Character.canonicalID as global; Report.rankings() and table() are
 * unfrozen JSON. Numeric equality across those JSONs is NOT an identity proof.
 *
 * Requires matched Report.code + Report.revision before using masterData.
 * This is NOT a GraphQL request builder and does not call WCL.
 * Only aggregated counts/status leave this helper. NEVER log actor names,
 * realm, IDs or raw damage, and NEVER infer DPS/BossDPS parity from it.
 */

const positive=v=>Number.isSafeInteger(v)&&v>0;
const same=(a,b)=>a?.code===b?.code&&
  Number.isSafeInteger(a?.revision)&&a.revision>=0&&
  a.revision===b?.revision;
const envelope=body=>body?.data?.reportData?.report??null;
const normalize=v=>typeof v==='string'&&v.trim()?
  v.trim().normalize('NFC').toLowerCase():null;
const identity=(name,server,klass)=>{
  const a=normalize(name),b=normalize(server),c=normalize(klass);
  return a&&b&&c?JSON.stringify([a,b,c]):null;
};

export function diagnoseFreshActorNamespaces({
  target,rankingsBody,tableBody,masterBody
}={}){
  const empty=(reason)=>({
    status:reason,rankedMatchedActors:0,tableSourceRows:0,
    directNumericIdOverlap:0,localPlayerRows:0,
    strongNameServerClassCandidates:0,ambiguousIdentityKeys:0,
    namespaceEquivalent:'UNPROVEN',dpsParity:'UNPROVEN'
  });
  const ranked=envelope(rankingsBody),table=envelope(tableBody);
  if(!target||ranked?.code!==target.reportCode||
     table?.code!==target.reportCode||!same(ranked,table))
    return empty('REPORT_OR_REVISION_NOT_COMPARABLE');
  const overall=ranked.overall?.data,boss=ranked.boss?.data;
  if(!Array.isArray(overall)||overall.length!==1||
     !Array.isArray(boss)||boss.length!==1||
     overall[0]?.fightID!==target.fightId||
     boss[0]?.fightID!==target.fightId)
    return empty('RANKED_FIGHT_SCOPE_INVALID');
  const all=overall[0]?.roles?.dps?.characters;
  const onlyBoss=boss[0]?.roles?.dps?.characters;
  const entries=table.damage?.data?.entries;
  if(!Array.isArray(all)||!Array.isArray(onlyBoss)||
     !Array.isArray(entries)||entries.length===0)
    return empty('RANKING_OR_TABLE_ROWS_UNAVAILABLE');

  const bossMap=new Map(),rankedMatched=new Map(),tableMap=new Map();
  for(const a of onlyBoss){
    if(!positive(a?.id)||bossMap.has(a.id)||
       typeof a.amount!=='number'||!Number.isFinite(a.amount)||
       a.amount<0)
      return empty('RANKED_ACTOR_IDS_OR_METRICS_INVALID');
    bossMap.set(a.id,a);
  }
  // Record EVERY total-DPS actor, including those absent from bossdps:
  // otherwise two unmatched actors sharing an ID silently pass validation.
  const totalIds=new Set();
  for(const a of all){
    if(!positive(a?.id)||totalIds.has(a.id)||
       typeof a.amount!=='number'||!Number.isFinite(a.amount)||
       a.amount<=0)
      return empty('RANKED_ACTOR_IDS_OR_METRICS_INVALID');
    totalIds.add(a.id);
    const b=bossMap.get(a.id);
    if(!b)continue;
    if(a.class!==b.class||a.spec!==b.spec||b.amount>a.amount)
      return empty('RANKED_METRICS_CONFLICT');
    rankedMatched.set(a.id,a);
  }
  for(const row of entries){
    if(!positive(row?.id)||tableMap.has(row.id))
      return empty('TABLE_SOURCE_IDS_AMBIGUOUS');
    tableMap.set(row.id,row);
  }
  const totals={
    rankedMatchedActors:rankedMatched.size,tableSourceRows:tableMap.size,
    directNumericIdOverlap:[...rankedMatched.keys()]
      .filter(id=>tableMap.has(id)).length,
    localPlayerRows:0,strongNameServerClassCandidates:0,
    ambiguousIdentityKeys:0
  };
  const result=(status)=>({
    status,...totals,namespaceEquivalent:'UNPROVEN',dpsParity:'UNPROVEN'
  });
  const master=envelope(masterBody);
  if(!master||!same(ranked,master)||master.code!==target.reportCode||
     !Array.isArray(master.masterData?.actors))
    return result('NO_SAME_REPORT_REVISION_MASTERDATA');

  const actors=master.masterData.actors;
  const actorIdSet=new Set(),playersByIdentity=new Map();
  for(const a of actors){
    // Official ReportActor.id has nullable type Int (not Int!).
    // An actor with no ID cannot be joined to a table source ID, but
    // must NOT invalidate unrelated, uniquely identified players.
    if(a?.id==null)continue;
    if(!positive(a.id)||actorIdSet.has(a.id))
      return result('MASTER_ACTOR_IDS_AMBIGUOUS');
    actorIdSet.add(a.id);
    if(a.type!=='Player'||positive(a.petOwner))continue;
    const key=identity(a.name,a.server,a.subType);
    if(!key)continue;
    const bucket=playersByIdentity.get(key)??[];
    bucket.push(a);
    playersByIdentity.set(key,bucket);
  }
  const rankByIdentity=new Map();
  for(const a of rankedMatched.values()){
    const key=identity(a.name,a.server,a.class);
    if(!key)continue;
    const bucket=rankByIdentity.get(key)??[];
    bucket.push(a);
    rankByIdentity.set(key,bucket);
  }
  for(const [key,players] of playersByIdentity){
    const rank=rankByIdentity.get(key)??[];
    if(rank.length===0)continue;
    if(players.length!==1||rank.length!==1){
      totals.ambiguousIdentityKeys++;
      continue;
    }
    if(tableMap.has(players[0].id))
      totals.strongNameServerClassCandidates++;
  }
  totals.localPlayerRows=[...playersByIdentity.values()].flat()
    .filter(a=>tableMap.has(a.id)).length;
  if(totals.ambiguousIdentityKeys>0)
    return result('AMBIGUOUS_CANDIDATE_IDENTITIES');
  if(totals.strongNameServerClassCandidates===0)
    return result('NO_SUPPORTED_IDENTITY_BRIDGE');
  return result('NAME_SERVER_CLASS_CANDIDATES_ONLY');
}

/**
 * Separate offline evidence-quality audit for serverless rankings.
 * Does NOT resolve actor identity or certify DPS. Unlike the older strict
 * candidate diagnostic, one malformed/duplicate master actor does not
 * erase the counts needed to distinguish the failure cause.
 *
 * Raw names and IDs are used only inside this function and NEVER emitted.
 * Matching name+class without realm is only a POSSIBLE collision candidate.
 */
export function auditFreshServerlessIdentity({
  target,rankingsBody,tableBody,masterBody
}={}) {
  const zero=(status)=>({
    status,rankingActors:0,rankingServerStrings:0,rankingServerObjects:0,
    masterRows:0,masterNullIds:0,masterInvalidIds:0,
    masterDuplicatePositiveIds:0,tableRows:0,
    tableSourceUniqueMasterIds:0,tableSourceAmbiguousMasterIds:0,
    tableSourceAbsentMasterIds:0,
    serverlessNameClassCandidates:0,ambiguousNameClassKeys:0,
    identityVerified:false,namespaceEquivalent:'UNPROVEN',
    bossDpsParity:'UNPROVEN',exact100Parity:'UNPROVEN'
  });
  const ranked=envelope(rankingsBody);
  const table=envelope(tableBody);
  const master=envelope(masterBody);
  if(!target||ranked?.code!==target.reportCode||
     table?.code!==target.reportCode||master?.code!==target.reportCode||
     !same(ranked,table)||!same(ranked,master))
    return zero('REPORT_OR_REVISION_NOT_COMPARABLE');
  const all=ranked.overall?.data;
  const boss=ranked.boss?.data;
  const tableRows=table.damage?.data?.entries;
  const actorRows=master.masterData?.actors;
  if(!Array.isArray(all)||all.length!==1||
     !Array.isArray(boss)||boss.length!==1||
     all[0]?.fightID!==target.fightId||
     boss[0]?.fightID!==target.fightId||
     !Array.isArray(tableRows)||!Array.isArray(actorRows))
    return zero('REQUIRED_FIGHT_OR_SOURCE_NOT_OBSERVED');
  const rankedRows=all[0]?.roles?.dps?.characters;
  const bossRows=boss[0]?.roles?.dps?.characters;
  if(!Array.isArray(rankedRows)||!Array.isArray(bossRows))
    return zero('REQUIRED_RANKING_ROSTER_NOT_OBSERVED');
  // Validate both ranking rosters BEFORE counting weak name/class hints.
  const index=(rows)=>{
    const m=new Map();
    for(const a of rows) {
      if(!positive(a?.id)||m.has(a.id)||
         typeof a.amount!=='number'||!Number.isFinite(a.amount)||
         a.amount<0)return null;
      m.set(a.id,a);
    }
    return m;
  };
  const allIDs=index(rankedRows),bossIDs=index(bossRows);
  if(!allIDs||!bossIDs)return zero('RANKED_IDS_OR_METRICS_INVALID');
  const joined=[];
  for(const [id,a] of allIDs) {
    const b=bossIDs.get(id);
    if(!b)continue;
    if(b.amount>a.amount||a.class!==b.class||a.spec!==b.spec)
      return zero('RANKED_METRICS_CONFLICT');
    joined.push(a);
  }
  const sources=new Set();
  for(const entry of tableRows) {
    if(!positive(entry?.id)||sources.has(entry.id))
      return zero('TABLE_SOURCE_IDS_AMBIGUOUS');
    sources.add(entry.id);
  }
  const res=zero('SERVERLESS_CANDIDATES_ONLY');
  res.rankingActors=joined.length;
  res.tableRows=sources.size;
  res.rankingServerStrings=joined.filter(a=>!!normalize(a.server)).length;
  res.rankingServerObjects=joined.filter(a=>
    a?.server!==null&&typeof a?.server==='object'&&!Array.isArray(a.server)).length;
  res.masterRows=actorRows.length;

  const byId=new Map();
  const byNameClass=new Map();
  for(const a of actorRows) {
    if(a?.id==null)res.masterNullIds++;
    else if(!positive(a.id))res.masterInvalidIds++;
    else {
      const bucket=byId.get(a.id)??[];
      bucket.push(a);
      byId.set(a.id,bucket);
      if(bucket.length>1)res.masterDuplicatePositiveIds++;
    }
    if(a?.type!=='Player'||positive(a.petOwner))continue;
    const name=normalize(a.name),klass=normalize(a.subType);
    if(!name||!klass)continue;
    const k=JSON.stringify([name,klass]);
    const bucket=byNameClass.get(k)??[];
    bucket.push(a);
    byNameClass.set(k,bucket);
  }
  for(const id of sources) {
    const arr=byId.get(id)??[];
    if(arr.length===1)res.tableSourceUniqueMasterIds++;
    else if(arr.length>1)res.tableSourceAmbiguousMasterIds++;
    else res.tableSourceAbsentMasterIds++;
  }
  const rankByNameClass=new Map();
  for(const a of joined) {
    const name=normalize(a.name),cls=normalize(a.class);
    if(!name||!cls)continue;
    const k=JSON.stringify([name,cls]);
    const bucket=rankByNameClass.get(k)??[];
    bucket.push(a);
    rankByNameClass.set(k,bucket);
  }
  for(const [key,ranks] of rankByNameClass) {
    const players=byNameClass.get(key)??[];
    if(!players.length)continue;
    if(ranks.length!==1||players.length!==1){
      res.ambiguousNameClassKeys++;
      continue;
    }
    const player=players[0];
    // A unique local Actor ID can be used to check table presence,
    // never to establish global Character identity without realm.
    if(positive(player.id)&&byId.get(player.id)?.length===1&&
       sources.has(player.id))
      res.serverlessNameClassCandidates++;
  }
  if(res.masterInvalidIds||res.masterDuplicatePositiveIds||
     res.tableSourceAmbiguousMasterIds||res.tableSourceAbsentMasterIds)
    res.status='MASTER_ID_QUALITY_ISSUES_AND_UNPROVEN_CANDIDATES';
  else if(res.ambiguousNameClassKeys)
    res.status='AMBIGUOUS_SERVERLESS_NAME_CLASS_CANDIDATES';
  else if(res.serverlessNameClassCandidates===0)
    res.status='NO_SERVERLESS_NAME_CLASS_CANDIDATES';
  return res;
}
