/**
 * Approved ONE-QUERY, ONE-REPORT/FIGHT identity witness.
 * NETWORK-FREE. Only the Actions entrypoint may acquire OAuth.
 * No EXACT-100 or BossDPS equivalence assertion is allowed.
 */
import {diagnoseFreshActorNamespaces} from './fresh-actor-namespace-diagnostic.mjs';
import {observeFreshRateLimit,summarizeFreshRankings}
  from './fresh-two-query-probe.mjs';

export const IDENTITY_TARGET=Object.freeze({
  reportCode:'dQbNzMkG94LqYTh1',fightId:11
});
export const IDENTITY_REQUEST='experiments/wcl-one-query-identity-20261027.json';
export const IDENTITY_APPROVAL='OWNER_APPROVED_20261027_MAX_ONE_IDENTITY_QUERY';
export const IDENTITY_ONCE_REF=
  'refs/heads/wcl-fresh216-identity-one-query-consumed-20261027';

export function buildIdentityWitnessQuery(){
  return {
    query:'query WclIdentityOneShot($code:String!,$fightID:Int!){ '+
      'rateLimitData{currentRequest limitPerHour pointsSpentThisHour '+
      'pointsResetIn databaseLimitPerHour databasePointsSpentThisHour '+
      'userHasRemainingPoints userPointsResetIn} '+
      'reportData{report(code:$code){code revision '+
      'overall:rankings(fightIDs:[$fightID],playerMetric:dps) '+
      'boss:rankings(fightIDs:[$fightID],playerMetric:bossdps) '+
      'damage:table(fightIDs:[$fightID],dataType:DamageDone,viewBy:Source,translate:false) '+
      'masterData(translate:false){actors{id name server type subType petOwner}} '+
      '}}}',
    variables:{code:IDENTITY_TARGET.reportCode,fightID:IDENTITY_TARGET.fightId}
  };
}

const typeCount=(arr,predicate)=>arr.filter(predicate).length;
const isObject=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const nonEmptyText=v=>typeof v==='string'&&v.trim().length>0;

export function summarizeIdentityWitness({httpStatus,body,elapsedMs}={}){
  const rate=observeFreshRateLimit(body);
  const report=body?.data?.reportData?.report;
  const obs={
    httpStatus:Number.isSafeInteger(httpStatus)?httpStatus:null,
    elapsedMs:typeof elapsedMs==='number'&&Number.isFinite(elapsedMs)&&elapsedMs>=0?elapsedMs:null,
    pointTotal:rate.total,
    pointClasses:rate.pointClasses,
    applicationRemaining:rate.appRemaining,
    databaseRemaining:rate.databaseRemaining,
    userHasRemainingPoints:rate.userHasRemainingPoints
  };
  const base={
    graphqlRequests:1,status:'NEEDS_REVIEW',reason:null,
    reportRevision:Number.isSafeInteger(report?.revision)?report.revision:null,
    identityStatus:'UNVERIFIED',rankedMatchedActors:0,tableSourceRows:0,
    directNumericIdOverlap:0,masterActorRows:0,
    masterPlayerRows:0,masterPetRows:0,masterNpcRows:0,
    rankedActorsWithName:0,rankedActorsWithServerText:0,
    rankedActorsWithClass:0,tableSourcesRepresentedInMaster:0,
    strongNameServerClassCandidates:0,ambiguousIdentityKeys:0,
    namespaceEquivalent:'UNPROVEN',bossDpsParity:'UNPROVEN',
    exact100Parity:'UNPROVEN',tableAdopted:false,
    originalRawResponseRetained:false,observed:obs
  };
  const fail=(reason,details={})=>({...base,...details,reason});
  if(httpStatus!==200||!isObject(body)||
      body.errors!=null&&(!Array.isArray(body.errors)||body.errors.length>0))
    return fail('HTTP_OR_GRAPHQL_ERROR');
  if(report?.code!==IDENTITY_TARGET.reportCode||
      !Number.isSafeInteger(report?.revision)||report.revision<0)
    return fail('REPORT_SCOPE_INVALID');
  const ranking=summarizeFreshRankings(IDENTITY_TARGET,body);
  if(!ranking.ok)return fail(ranking.reason);
  const fight=report.overall.data[0];
  const rankActors=fight.roles.dps.characters;
  const tableEntries=report?.damage?.data?.entries;
  const masters=report?.masterData?.actors;
  const partial={
    rankedMatchedActors:ranking.verifiedActors,
    rankedActorsWithName:typeCount(rankActors,x=>nonEmptyText(x?.name)),
    rankedActorsWithServerText:typeCount(rankActors,x=>nonEmptyText(x?.server)),
    rankedActorsWithClass:typeCount(rankActors,x=>nonEmptyText(x?.class)),
    tableSourceRows:Array.isArray(tableEntries)?tableEntries.length:0,
    masterActorRows:Array.isArray(masters)?masters.length:0,
    masterPlayerRows:Array.isArray(masters)?typeCount(masters,x=>x?.type==='Player'):0,
    masterPetRows:Array.isArray(masters)?typeCount(masters,x=>x?.type==='Pet'):0,
    masterNpcRows:Array.isArray(masters)?typeCount(masters,x=>x?.type==='NPC'):0,
    tableSourcesRepresentedInMaster:
      Array.isArray(masters)&&Array.isArray(tableEntries)?
        tableEntries.filter(row=>masters.some(actor=>
          Number.isSafeInteger(actor?.id)&&actor.id>0&&actor.id===row?.id)).length:0
  };
  // NEVER rely on actor class/name/server as a guaranteed equivalence.
  const d=diagnoseFreshActorNamespaces({
    target:IDENTITY_TARGET,rankingsBody:body,tableBody:body,masterBody:body
  });
  const full={
    ...partial,
    directNumericIdOverlap:d.directNumericIdOverlap,
    strongNameServerClassCandidates:d.strongNameServerClassCandidates,
    ambiguousIdentityKeys:d.ambiguousIdentityKeys,
    identityStatus:d.status
  };
  if(d.status!=='NAME_SERVER_CLASS_CANDIDATES_ONLY')
    return fail('NO_VERIFIED_NAMESPACE_BRIDGE',full);
  // Only observed potential name/server/class candidates, NOT proven DPS.
  return {
    ...base,...full,status:'RECORDED_CANDIDATES_ONLY',reason:null
  };
}
