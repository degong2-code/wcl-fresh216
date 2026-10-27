import {checkpointStats} from './checkpoint.mjs';

/**
 * Pure, fail-closed request admission for ONE-Fight HTTP operations.
 * No WCL API point tariff is inferred, and no hard spending guarantee is
 * claimed: the next call may cost MORE than the caller's explicit reserve.
 *
 * Host must supply live rate observations / notBeforeMs separately.
 * This is not a token bucket or an implementation of WCL rate policies.
 * The runner cannot schedule automatic sleeping or live API traffic.
 */
const safeMs=v=>Number.isSafeInteger(v)&&v>=0;
const point=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;

export function evaluateRequestAdmission(state,{
  nowMs,notBeforeMs=0,maxObservedPoints,reservePoints
}={}){
  if(!safeMs(nowMs)||!safeMs(notBeforeMs)||
     !point(maxObservedPoints)||!point(reservePoints)||reservePoints===0)
    throw Error('ADMISSION_POLICY_INVALID');

  const stats=checkpointStats(state);
  const base={
    witnessedPoints:stats.witnessedPoints,
    pointsTotalConfirmed:stats.pointsTotalConfirmed,
    reservePoints,maxObservedPoints,
    waitMs:0
  };
  const refuse=status=>({...base,status,allowed:false});
  if(state.status!=='ACTIVE')return refuse('NOT_ACTIVE');
  // Exactly one owner is expected for a scope. If an old attempt is
  // unresolved or a charge is uncertain, don't make more paid calls.
  if(stats.counts.NEEDS_REVIEW>0||stats.counts.IN_FLIGHT>0||
     stats.pointsUnobserved>0)return refuse('NEEDS_REVIEW');
  if(stats.counts.READY===0)return refuse('NO_READY');
  if(nowMs<notBeforeMs){
    return {...refuse('RATE_WAIT'),waitMs:notBeforeMs-nowMs};
  }
  // Only an explicitly chosen *reservation* makes a provisional admission.
  // Overshoot from the next real operation is still possible and must be
  // reported as observed, not silently forced to the configured cap.
  if(stats.witnessedPoints+reservePoints>maxObservedPoints)
    return refuse('BUDGET_PAUSED');
  return {...base,status:'ADMITTED',allowed:true};
}
