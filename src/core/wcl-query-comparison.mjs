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
