/**
 * Offline-only typed WCL roster crosswalk, for FUTURE owner-authorized evidence.
 * rankedCharacters is a REPORT-WIDE list of ranked kill characters, NOT scoped
 * to Fight 11. ReportActor.id is report-local, Character.canonicalID global.
 * No HTTP, no credential access, no mutations, no EXACT-100 promotion.
 */
import {IDENTITY_TARGET} from './fresh-one-query-identity.mjs';
import {summarizeFreshRankings} from './fresh-two-query-probe.mjs';

const isPos=v=>Number.isSafeInteger(v)&&v>0;
const normal=v=>typeof v==='string'&&v.trim()?
  v.trim().normalize('NFC').toLowerCase():null;
const report=body=>body?.data?.reportData?.report??null;
const same=(a,b,code)=>a?.code===code&&b?.code===code&&
  Number.isSafeInteger(a?.revision)&&a.revision>=0&&
  a.revision===b?.revision;

export function buildTypedRosterCrosswalkQuery(target=IDENTITY_TARGET){
  if(target.reportCode!==IDENTITY_TARGET.reportCode||
     target.fightId!==IDENTITY_TARGET.fightId)
    throw Error('TYPED_ROSTER_SCOPE_DENIED');
  return {
    query:'query WclReportRosterCrosswalk($code:String!,$fightID:Int!){ '+
      'reportData{report(code:$code){code revision '+
      'overall:rankings(fightIDs:[$fightID],playerMetric:dps) '+
      'boss:rankings(fightIDs:[$fightID],playerMetric:bossdps) '+
      'damage:table(fightIDs:[$fightID],dataType:DamageDone,viewBy:Source,translate:false) '+
      'masterData(translate:false){actors{id name server type subType petOwner}} '+
      'rankedCharacters{canonicalID id name classID server{id normalizedName}} '+
      '}}}',
    variables:{code:target.reportCode,fightID:target.fightId}
  };
}

/**
 * Public output contains only aggregates and explicit uncertainty.
 * Strong candidate means: a name unique within the Fight rankings,
 * the report-wide typed roster and the relevant local Player roster,
 * with the SAME normalized server in typed and report-local records,
 * same ranking/master class, positive unique local source id and canonicalID.
 * It NEVER proves Fight-specific rankings-to-canonical provenance or DPS parity.
 */
export function auditTypedRosterCrosswalk({
  target=IDENTITY_TARGET,rankingsBody,tableBody,masterBody,typedBody
}={}){
  const base={
    status:'NOT_COMPARABLE',rankedFightActors:0,typedReportCharacters:0,
    reportLocalPlayers:0,tableSourceRows:0,
    typedRosterMissingOrInvalid:0,typedRosterDuplicateCanonicalIds:0,
    ambiguousRankNameKeys:0,ambiguousTypedNameKeys:0,
    ambiguousLocalNameKeys:0,ambiguousLocalSourceIds:0,
    matchedTypedLocalServerCandidates:0,
    sameFightFourWayCandidates:0,
    missingTypedCharacters:0,serverMismatchCandidates:0,
    canonicalCharacterIdentity:'UNPROVEN',
    bossDpsParity:'UNPROVEN',exact100Parity:'UNPROVEN',
    tableAdopted:false,graphqlRequestsPerformed:0
  };
  const result=(status,counts={})=>({...base,...counts,status});
  const ranking=report(rankingsBody),table=report(tableBody);
  const master=report(masterBody),typed=report(typedBody);
  if(!target||target.reportCode!==IDENTITY_TARGET.reportCode||
     target.fightId!==IDENTITY_TARGET.fightId||
     !same(ranking,table,target.reportCode)||
     !same(ranking,master,target.reportCode)||
     !same(ranking,typed,target.reportCode))
    return result('REPORT_REVISION_OR_TARGET_MISMATCH');

  const rankCheck=summarizeFreshRankings(target,rankingsBody);
  if(!rankCheck.ok)return result('RANKINGS_INVALID');
  const ranks=ranking.overall?.data?.[0]?.roles?.dps?.characters;
  const bosses=ranking.boss?.data?.[0]?.roles?.dps?.characters;
  const entries=table.damage?.data?.entries;
  const actors=master.masterData?.actors;
  const chars=typed.rankedCharacters;
  if(!Array.isArray(ranks)||!Array.isArray(bosses)||
     !Array.isArray(entries)||!Array.isArray(actors)||
     !Array.isArray(chars))
    return result('REQUIRED_SOURCE_UNOBSERVED');
  const bossIds=new Set(bosses.map(c=>c.id));
  const ranked=ranks.filter(c=>bossIds.has(c.id));
  const c={rankedFightActors:ranked.length,typedReportCharacters:chars.length,
    reportLocalPlayers:actors.filter(a=>a?.type==='Player').length,
    tableSourceRows:entries.length};
  const sourceIds=new Set();
  for(const row of entries){
    if(!isPos(row?.id)||sourceIds.has(row.id))
      return result('TABLE_SOURCE_IDS_AMBIGUOUS',c);
    sourceIds.add(row.id);
  }
  const byId=new Map(),localNames=new Map(),typedNames=new Map(),
    rankNames=new Map(),canonicalIds=new Set();
  for(const a of actors){
    if(!isPos(a?.id))continue;
    const arr=byId.get(a.id)??[];
    arr.push(a);byId.set(a.id,arr);
    if(a.type==='Player'&&!isPos(a.petOwner)&&sourceIds.has(a.id)){
      const k=normal(a.name);if(!k)continue;
      const matches=localNames.get(k)??[];
      matches.push(a);localNames.set(k,matches);
    }
  }
  for(const [id,rows] of byId)
    if(sourceIds.has(id)&&rows.length!==1)c.ambiguousLocalSourceIds=
      (c.ambiguousLocalSourceIds??0)+1;

  for(const ch of chars){
    const name=normal(ch?.name);
    const server=normal(ch?.server?.normalizedName);
    if(!name||!server||!isPos(ch?.canonicalID)||!isPos(ch?.classID)||
       !isPos(ch?.server?.id)){
      c.typedRosterMissingOrInvalid=(c.typedRosterMissingOrInvalid??0)+1;
      continue;
    }
    if(canonicalIds.has(ch.canonicalID))
      c.typedRosterDuplicateCanonicalIds=(c.typedRosterDuplicateCanonicalIds??0)+1;
    canonicalIds.add(ch.canonicalID);
    const arr=typedNames.get(name)??[];
    arr.push(ch);typedNames.set(name,arr);
  }
  for(const a of ranked){
    const k=normal(a?.name);if(!k)continue;
    const arr=rankNames.get(k)??[];
    arr.push(a);rankNames.set(k,arr);
  }
  for(const [name,arr] of rankNames){
    if(arr.length!==1){c.ambiguousRankNameKeys=(c.ambiguousRankNameKeys??0)+1;continue;}
    const typedCandidates=typedNames.get(name)??[];
    const localCandidates=localNames.get(name)??[];
    if(typedCandidates.length>1){
      c.ambiguousTypedNameKeys=(c.ambiguousTypedNameKeys??0)+1;continue;
    }
    if(localCandidates.length>1){
      c.ambiguousLocalNameKeys=(c.ambiguousLocalNameKeys??0)+1;continue;
    }
    if(!typedCandidates.length){
      c.missingTypedCharacters=(c.missingTypedCharacters??0)+1;continue;
    }
    if(localCandidates.length!==1)continue;
    const ch=typedCandidates[0],local=localCandidates[0];
    if(byId.get(local.id)?.length!==1||!sourceIds.has(local.id))continue;
    const server=normal(local.server),typedServer=normal(ch.server.normalizedName);
    if(!server||server!==typedServer){
      c.serverMismatchCandidates=(c.serverMismatchCandidates??0)+1;continue;
    }
    if(normal(local.subType)!==normal(arr[0].class))continue;
    c.matchedTypedLocalServerCandidates=(c.matchedTypedLocalServerCandidates??0)+1;
    // Only count if the Fight's ranked actor uniquely names this report-wide
    // typed character and uniquely observed same-report local source.
    if(!c.typedRosterDuplicateCanonicalIds)
      c.sameFightFourWayCandidates=(c.sameFightFourWayCandidates??0)+1;
  }
  if(!c.ambiguousRankNameKeys)c.ambiguousRankNameKeys=0;
  if(!c.ambiguousTypedNameKeys)c.ambiguousTypedNameKeys=0;
  if(!c.ambiguousLocalNameKeys)c.ambiguousLocalNameKeys=0;
  return result(c.sameFightFourWayCandidates?
    'REPORT_ROSTER_FIGHT_CANDIDATES_ONLY':'NO_FOUR_WAY_CANDIDATE',c);
}
