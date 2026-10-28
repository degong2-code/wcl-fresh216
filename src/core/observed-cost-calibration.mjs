/**
 * Observed WCL request-total calibration, OFFLINE.
 * Ranking = full request total / successful ranking pages (upper-ish mean,
 * including request overhead); Report = actual shared request total /
 * number of fights in that one wave (mean, NOT marginal saving).
 * Do not mix unsuccessful/uncertain operations, HTTP counts or public tariff.
 */
const num=n=>typeof n==='number'&&Number.isFinite(n)&&n>0;
export function calibrateAdaptiveEconomics(state,{
  minRankSamples=2,minReportWaveSamples=2
}={}){
  if(state?.schema!==1||!Number.isSafeInteger(minRankSamples)||
     minRankSamples<1||!Number.isSafeInteger(minReportWaveSamples)||
     minReportWaveSamples<1)
    throw Error('COST_CALIBRATION_INPUT_INVALID');
  let rankingPoints=0,rankingPages=0,rankSamples=0;
  for(const r of Object.values(state.rankRequests??{})){
    const validPages=r.result?.pages?.filter(p=>p.status==='OK')??[];
    if(r.status!=='COMPLETED'||!num(r.observedPoints)||!validPages.length)
      continue;
    rankingPoints+=r.observedPoints;
    rankingPages+=validPages.length;
    rankSamples++;
  }
  // Four fights in one request carry one shared attempt id and one cost.
  const waves=new Map();
  for(const e of Object.values(state.entries??{})){
    const a=e.attempt;
    if(a?.kind!=='REPORT_WAVE')continue;
    if(!waves.has(a.id))waves.set(a.id,[]);
    waves.get(a.id).push(e);
  }
  let reportPoints=0,reportFights=0,reportSamples=0;
  for(const group of waves.values()){
    const head=group[0],members=head.attempt?.waveKeys??[];
    if(!num(head.observedPoints)||group.length!==members.length||
       !group.every(e=>['COMPLETED','COMPLETED_PARTIAL'].includes(e.status)&&
        e.observedPoints===head.observedPoints&&
        JSON.stringify(e.attempt?.waveKeys)===JSON.stringify(members)))
      continue;
    reportPoints+=head.observedPoints;reportFights+=group.length;
    reportSamples++;
  }
  const rankingPointsPerPage=rankingPages?
    rankingPoints/rankingPages:null;
  const reportPointsPerFight=reportFights?
    reportPoints/reportFights:null;
  const sufficientlyMeasured=rankSamples>=minRankSamples&&
    reportSamples>=minReportWaveSamples;
  return {
    economics:sufficientlyMeasured?{
      rankingPointsPerPage,reportPointsPerFight
    }:null,
    rankSamples,rankingPages,rankingReportedPoints:rankingPoints,
    rankObservedMeanPerSuccessfulPage:rankingPointsPerPage,
    reportWaveSamples:reportSamples,reportFights,
    reportReportedPoints:reportPoints,
    reportObservedMeanPerFight:reportPointsPerFight,
    complete:sufficientlyMeasured,
    // Grouped wave cost per fight is NOT the marginal cost of one fight,
    // so planner may only treat this as an optimistic avoidance bound.
    estimateType:'OBSERVED_REQUEST_TOTAL_MEANS_NOT_MARGINAL_SAVINGS',
    publishedCostTariff:false
  };
}
