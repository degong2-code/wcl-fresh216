/**
 * Read-only WCL typed roster witness. Exactly ONE future authorized
 * GraphQL request contains rankings, table, masterData, rankedCharacters
 * and a direct rate-category witness. No HTTP or private output here.
 */
import {IDENTITY_TARGET} from './fresh-one-query-identity.mjs';
import {buildTypedRosterCrosswalkQuery,auditTypedRosterCrosswalk}
  from './fresh-typed-roster-crosswalk.mjs';
import {auditFreshServerlessIdentity}
  from './fresh-actor-namespace-diagnostic.mjs';
import {observeFreshRateLimit} from './fresh-two-query-probe.mjs';

export const TYPED_ONCE_REF =
  'refs/heads/wcl-fresh216-typed-roster-one-query-consumed-20261027';
export const TYPED_REQUEST = 'experiments/wcl-one-query-typed-roster-20261027.json';
export const TYPED_APPROVAL='OWNER_APPROVED_20261027_MAX_ONE_TYPED_ROSTER_QUERY';

export function buildOneShotTypedRosterQuery(){
  const old=buildTypedRosterCrosswalkQuery();
  const rate='rateLimitData{currentRequest limitPerHour pointsSpentThisHour '+
    'databaseLimitPerHour databasePointsSpentThisHour userHasRemainingPoints} ';
  return {...old,query:old.query.replace('{ reportData{','{ '+rate+'reportData{')};
}
const nonnegative=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
export function summarizeOneShotTypedRoster({
  httpStatus,body,elapsedMs
}={}){
  const rate=observeFreshRateLimit(body);
  const response=body?.data?.reportData?.report;
  const base={
    attemptedGraphql:1,httpStatus:Number.isInteger(httpStatus)?httpStatus:null,
    elapsedMs:nonnegative(elapsedMs)?elapsedMs:null,
    reportedPointTotal:rate.total,pointClasses:rate.pointClasses,
    appHeadroomObserved:rate.appRemaining,
    databaseHeadroomObserved:rate.databaseRemaining,
    userHasRemainingPoints:rate.userHasRemainingPoints,
    reportRevision:Number.isSafeInteger(response?.revision)?response.revision:null,
    status:'NEEDS_REVIEW',reason:null,
    realCharacterIdentity:'UNPROVEN',bossDpsParity:'UNPROVEN',
    exact100Parity:'UNPROVEN',tableAdopted:false,
    privateRawResponseRetained:false,
    typed:null,serverless:null
  };
  if(httpStatus!==200||!body||!body.data||
      body.errors!=null&&(!Array.isArray(body.errors)||body.errors.length!==0))
    return {...base,reason:'HTTP_OR_GRAPHQL_RESPONSE_INVALID'};
  if(response?.code!==IDENTITY_TARGET.reportCode||
     !Number.isSafeInteger(response?.revision)||response.revision<0)
    return {...base,reason:'REPORT_SCOPE_UNVERIFIED'};
  const parts={
    target:IDENTITY_TARGET,rankingsBody:body,tableBody:body,
    masterBody:body,typedBody:body
  };
  const typed=auditTypedRosterCrosswalk(parts);
  const serverless=auditFreshServerlessIdentity(parts);
  // Only primitive numeric/status aggregate output from audited code.
  // Raw Character/ReportActor names, IDs, realms and damage never leave.
  const out={...base,typed,serverless};
  if(typed.status!=='REPORT_ROSTER_FIGHT_CANDIDATES_ONLY')
    return {...out,reason:'TYPED_ROSTER_CROSSWALK_NOT_ESTABLISHED'};
  // A candidate is NOT an independently verified Fight-character identity.
  return {...out,status:'CANDIDATES_ONLY_UNPROVEN'};
}
