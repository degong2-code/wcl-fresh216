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
    if(!positive(a?.id)||actorIdSet.has(a.id))
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
