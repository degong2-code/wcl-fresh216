import {makeRankingsQuery} from '../adapters/wcl-rankings-envelope.mjs';

/**
 * Network-free, authorization-free, two-query comparison plan.
 *
 * WCL v2 Report schema (2026-10):
 * - report.rankings(fightIDs,playerMetric:dps|bossdps): Database Points.
 * - report.table(fightIDs,dataType:DamageDone,viewBy:Source): User-Eligible
 *   Points (ONLY under a user-authenticated authorization flow; client
 *   credentials alone do not obtain User points).
 * - rateLimitData.currentRequest is a JSON SCALAR, not a nested GraphQL
 *   object. Point categories/caps may change during the October 2026 beta.
 *
 * This merely emits query documents for a separately approved same-fight
 * experiment. It is not an HTTP client, an API point budget, or a claim
 * that table and ranking DPS have equivalent semantics.
 */
export function makeTwoRequestComparisonPlan(group) {
  const rankings=makeRankingsQuery(group); // validates fight, report, etc.
  const table={
    query:[
      'query Fresh216TableComparison($code:String!,$fightID:Int!){',
      'rateLimitData{currentRequest}',
      'reportData{report(code:$code){code revision',
      'damage:table(fightIDs:[$fightID],dataType:DamageDone,',
      'viewBy:Source,translate:false)',
      '}}}'
    ].join(' '),
    variables:{...rankings.variables}
  };
  return {
    mode:'OFFLINE_QUERY_PLAN_ONLY',
    authorizedToExecute:false,
    actualPointUsageMeasured:false,
    sameFight:{
      scopeKey:group.scopeKey??null,
      encounterId:group.encounterId,
      difficulty:group.difficulty,
      reportRevision:group.reportRevision??null
    },
    requests:[
      {
        kind:'SAME_FIGHT_RANKINGS_DPS_BOSSDPS',
        documentedPointClass:'DATABASE',
        query:rankings
      },
      {
        kind:'SAME_FIGHT_DAMAGE_DONE_TABLE',
        documentedPointClass:'USER_ELIGIBLE_IF_USER_OAUTH',
        query:table
      }
    ],
    caveats:[
      'TWO_SEPARATE_REQUESTS_REQUIRED_FOR_PER_QUERY_COST_OBSERVATION',
      'TABLE_DAMAGE_AMOUNTS_MAY_DIFFER_FROM_RANKING_DPS_DENOMINATORS',
      'TABLE_DOES_NOT_PROVE_BOSSDPS_WITHOUT_BOSS_TARGET_MAPPING_AND_PET_RULES',
      'REPORT_REVISION_AND_ACTOR_IDENTITY_MUST_MATCH_BOTH_RESPONSES',
      'POINT_SPENDING_CLASS_NEEDS_LIVE_RATE_WITNESS_IN_CURRENT_BETA'
    ]
  };
}


/**
 * Pure OFFLINE adjudication of PRIVATE, manually captured per-request metadata.
 * Observations are not WCL responses and are NOT independent proof of actor
 * equivalence or billing authenticity. This function NEVER grants execution
 * permission and deliberately cannot promote table() to EXACT BossDPS proof.
 *
 * Only order-bound redacted metadata is returned. In particular, report codes,
 * actor IDs, raw point payloads and caller-added private fields are not echoed.
 */
import {createHash} from 'node:crypto';

export function fingerprintComparisonRequest(request) {
  if(typeof request?.query?.query!=='string' ||
     typeof request?.query?.variables?.code!=='string' ||
     !Number.isSafeInteger(request.query.variables.fightID))
    throw Error('COMPARISON_REQUEST_INVALID');
  return createHash('sha256').update(JSON.stringify({
    query:request.query.query,variables:request.query.variables
  })).digest('hex');
}

const nonnegative=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const maybeCost=v=>v===null||nonnegative(v);
const maybeMs=v=>v===null||(Number.isSafeInteger(v)&&v>=0);
const maybeRevision=v=>v===null||(Number.isSafeInteger(v)&&v>=0);
const pointClasses=['application','database','user'];
const authFlows=['CLIENT_CREDENTIALS','USER_OAUTH_CODE_PKCE','UNKNOWN'];

/**
 * Caller must not pass tokens or raw WCL data. No actual HTTP is performed.
 * The result cannot certify whether independently supplied observations are
 * genuine. Request fingerprints bind metadata to the intended TWO documents.
 */
export function assessTwoRequestComparison(plan,observations=[]) {
  if(plan?.mode!=='OFFLINE_QUERY_PLAN_ONLY' ||
     plan.authorizedToExecute!==false ||
     !Array.isArray(plan.requests)||plan.requests.length!==2 ||
     plan.requests[0]?.kind!=='SAME_FIGHT_RANKINGS_DPS_BOSSDPS' ||
     plan.requests[1]?.kind!=='SAME_FIGHT_DAMAGE_DONE_TABLE' ||
     !Array.isArray(observations)||observations.length>2)
    throw Error('COMPARISON_RECEIPT_SCOPE_INVALID');
  const digests=plan.requests.map(fingerprintComparisonRequest);
  if(plan.requests[0].query.variables.code!==plan.requests[1].query.variables.code ||
     plan.requests[0].query.variables.fightID!==plan.requests[1].query.variables.fightID)
    throw Error('COMPARISON_RECEIPT_SCOPE_INVALID');

  const rows=[];
  for(let i=0;i<observations.length;i++){
    const o=observations[i];
    if(!o || o.kind!==plan.requests[i].kind ||
       o.requestFingerprint!==digests[i] ||
       !authFlows.includes(o.authFlow) ||
       !(o.httpStatus===null||(Number.isSafeInteger(o.httpStatus)&&
           o.httpStatus>=100&&o.httpStatus<=599)) ||
       !(o.graphqlErrors===null||typeof o.graphqlErrors==='boolean') ||
       !maybeRevision(o.reportRevision)||!maybeMs(o.elapsedMs)||
       !maybeCost(o.reportedTotalPoints) ||
       !['OFFICIAL_CATEGORY_WITNESS','UNAVAILABLE'].includes(o.categoryWitness))
      throw Error('COMPARISON_OBSERVATION_INVALID');
    const costs=o.categoryCosts;
    if(!costs || pointClasses.some(k=>!Object.hasOwn(costs,k)||
         !maybeCost(costs[k])) ||
       (o.categoryWitness==='UNAVAILABLE'&&
         pointClasses.some(k=>costs[k]!==null)))
      throw Error('COMPARISON_POINT_WITNESS_INVALID');
    // A successful HTTP response, no GraphQL errors and a revision witness
    // are necessary, never sufficient, for EXACT-100 semantic parity.
    const responseConsistent=o.httpStatus===200 &&
      o.graphqlErrors===false &&
      plan.sameFight?.reportRevision!=null &&
      o.reportRevision===plan.sameFight.reportRevision;
    rows.push({
      kind:o.kind,
      documentedClass:plan.requests[i].documentedPointClass,
      authFlow:o.authFlow, httpStatus:o.httpStatus,
      reportedTotalPoints:o.reportedTotalPoints,
      categoryWitness:o.categoryWitness,
      // Category values must be observed, never inferred from total points.
      categoryCosts:pointClasses.reduce((a,k)=>{
        a[k]=costs[k];return a;
      },{}),
      elapsedMs:o.elapsedMs,
      responseConsistent
    });
  }
  const failed=rows.some(r=>!r.responseConsistent);
  const status=failed?'REQUEST_OR_REVISION_NEEDS_REVIEW':
    rows.length===0?'AWAITING_SEPARATE_APPROVAL':
    rows.length===1?'ONLY_FIRST_REQUEST_RECORDED':
    'TWO_RESPONSES_RECORDED_SEMANTICS_UNPROVEN';
  return {
    mode:'OFFLINE_RECEIPT_ASSESSMENT_ONLY',
    status,requestsRecorded:rows.length,
    expectedRequests:2,
    requests:rows,
    semanticVerdict:'NOT_EQUIVALENT_OR_UNPROVEN',
    adoptTable:false,
    executionAuthorized:false,
    costEquivalenceProven:false,
    independentActorAndBossTargetProof:false,
    warnings:[
      'OBSERVATIONS_ARE_CALLER_SUPPLIED_NOT_INDEPENDENT_WCL_ATTESTATION',
      'REPORTED_TOTAL_IS_NOT_THREE_CLASS_POINT_BREAKDOWN',
      'USER_ELIGIBILITY_REQUIRES_ACTUAL_USER_OAUTH_RATE_WITNESS',
      'BOSS_TARGET_PET_AND_DPS_DENOMINATOR_PARITY_NOT_PROVEN'
    ]
  };
}
