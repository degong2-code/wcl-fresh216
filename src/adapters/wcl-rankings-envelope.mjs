/**
 * WCL v2 official GraphQL transport envelope, network-free.
 * The query uses Report.code and Report.revision fields from the schema.
 * report.rankings() returns JSON and is NOT frozen by the upstream API.
 * IMPORTANT: this module does not send requests, handle tokens, or promise
 * that selecting these extra fields is point-neutral.
 */
const validReportCode=(s)=>typeof s==='string'&&s.length>0&&s.length<=128&&/^[\x21-\x7E]+$/.test(s);
const isInt=(v)=>Number.isSafeInteger(v)&&v>=0;
export function makeRankingsQuery(group){
  if (!group || !validReportCode(group.reportCode) ||
      !isInt(group.fightId)||group.fightId===0 ||
      !isInt(group.encounterId)||group.encounterId===0 ||
      !isInt(group.difficulty)||group.difficulty===0 ||
      (group.reportRevision!=null&&!isInt(group.reportRevision)))
    throw Error('REPORT_QUERY_SCOPE_INVALID');
  const query=[
    'query Fresh216Report($code:String!,$fightID:Int!){',
    'rateLimitData{currentRequest{total}}',
    'reportData{report(code:$code){code revision',
    'overall:rankings(fightIDs:[$fightID],playerMetric:dps)',
    'boss:rankings(fightIDs:[$fightID],playerMetric:bossdps)',
    '}}}'
  ].join(' ');
  return {query,variables:{code:group.reportCode,fightID:group.fightId}};
}
const pointsOf=(data)=>{
  const n=data?.rateLimitData?.currentRequest?.total;
  return typeof n==='number'&&Number.isFinite(n)&&n>=0?n:null;
};
/**
 * Decode exactly one HTTPS GraphQL response. Incomplete or mismatched
 * identity must never be passed to joinFightEvidence.
 * @returns {{status:string,report:null|object,observedPoints:null|number}}
 */
export function decodeRankingsEnvelope(group,httpStatus,body){
  const data=body?.data;
  const observedPoints=pointsOf(data);
  if(httpStatus!==200 || !body || typeof body!=='object' ||
     (body.errors!=null&&(!Array.isArray(body.errors)||body.errors.length>0)))
    return {status:'UNCERTAIN_HTTP_OR_GRAPHQL',report:null,observedPoints};
  const report=data?.reportData?.report;
  if(!report||report.code!==group?.reportCode ||
     !isInt(report.revision) ||
     (group.reportRevision!=null&&report.revision!==group.reportRevision))
    return {status:'REPORT_IDENTITY_OR_REVISION_MISMATCH',report:null,observedPoints};
  if(!report.overall||!report.boss ||
     !Array.isArray(report.overall.data)||!Array.isArray(report.boss.data))
    return {status:'RANKINGS_SHAPE_INVALID',report:null,observedPoints};
  // Individual fight/actor/encounter/class checks happen in joinFightEvidence.
  return {status:'OK',report:{
    code:report.code,revision:report.revision,
    overall:report.overall,boss:report.boss
  },observedPoints};
}
