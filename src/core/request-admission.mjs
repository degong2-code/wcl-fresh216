import {checkpointStats} from './checkpoint.mjs';

/**
 * Pure, fail-closed request admission. The durable checkpoint ledger is
 * lifetime evidence, but it is NOT a WCL hourly allowance. An optional
 * budgetBaselinePoints scopes the owner cap to ONE approved invocation.
 *
 * Live quota samples must be obtained separately from WCL rateLimitData;
 * this pure function never sends HTTP and never guesses a point tariff.
 * A reserve is provisional: the next request can exceed its prediction.
 */
const safeMs=v=>Number.isSafeInteger(v)&&v>=0;
const point=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const positive=v=>point(v)&&v>0;

/**
 * Admission against WCL's authoritative current hourly window.
 * pointsResetIn is seconds (not milliseconds); both application and
 * optional database point limits reset together. No local fixed-hour
 * clock or cumulative checkpoint approximation is used.
 */
export function evaluateWclHourlyQuota(quota,{
  reservePoints,databaseReservePoints=0
}={}){
  if(!quota||!Number.isSafeInteger(quota.limitPerHour)||
     quota.limitPerHour<=0||!point(quota.pointsSpentThisHour)||
     !Number.isSafeInteger(quota.pointsResetIn)||
     quota.pointsResetIn<0||!positive(reservePoints)||
     !point(databaseReservePoints))
    throw Error('HOURLY_QUOTA_INVALID');
  if(databaseReservePoints>0&&
     (!Number.isSafeInteger(quota.databaseLimitPerHour)||
      quota.databaseLimitPerHour<=0||
      !point(quota.databasePointsSpentThisHour)))
    throw Error('HOURLY_DATABASE_QUOTA_INVALID');

  const remaining= Math.max(0,
    quota.limitPerHour-quota.pointsSpentThisHour);
  const databaseRemaining=databaseReservePoints>0?
    Math.max(0,quota.databaseLimitPerHour-
      quota.databasePointsSpentThisHour):null;
  const allowed=remaining>=reservePoints&&
    (databaseRemaining===null||
      databaseRemaining>=databaseReservePoints);
  return {
    status:allowed?'ADMITTED':'HOURLY_RATE_WAIT',allowed,
    limitPerHour:quota.limitPerHour,
    pointsSpentThisHour:quota.pointsSpentThisHour,
    remainingPoints:remaining,
    databaseRemainingPoints:databaseRemaining,
    // One-second boundary margin; the caller schedules a NEW approved
    // invocation after reset. Do not sleep or retry this paid operation.
    waitMs:allowed?0:quota.pointsResetIn*1000+1000
  };
}

export function evaluateRequestAdmission(state,{
  nowMs,notBeforeMs=0,maxObservedPoints,reservePoints,
  budgetBaselinePoints=0,hourlyQuota=null,
  databaseReservePoints=0
}={}){
  if(!safeMs(nowMs)||!safeMs(notBeforeMs)||
     !positive(maxObservedPoints)||!positive(reservePoints)||
     !point(budgetBaselinePoints)||!point(databaseReservePoints))
    throw Error('ADMISSION_POLICY_INVALID');

  const stats=checkpointStats(state);
  const delta=stats.witnessedPoints-budgetBaselinePoints;
  if(!Number.isFinite(delta)||delta< -1e-7)
    throw Error('ADMISSION_BASELINE_DRIFT');
  const usedInApproval=Math.max(0,delta);
  const base={
    witnessedPoints:stats.witnessedPoints,
    pointsTotalConfirmed:stats.pointsTotalConfirmed,
    pointsInApprovedInvocation:usedInApproval,
    budgetBaselinePoints,reservePoints,maxObservedPoints,waitMs:0
  };
  const refuse=status=>({...base,status,allowed:false});
  if(state.status!=='ACTIVE')return refuse('NOT_ACTIVE');
  // Uncertain requests must not be replayed, even after an hourly reset.
  if(stats.counts.NEEDS_REVIEW>0||stats.counts.IN_FLIGHT>0||
     stats.pointsUnobserved>0)return refuse('NEEDS_REVIEW');
  if(stats.counts.READY===0)return refuse('NO_READY');
  if(nowMs<notBeforeMs)
    return {...refuse('RATE_WAIT'),waitMs:notBeforeMs-nowMs};
  if(usedInApproval+reservePoints>maxObservedPoints+1e-8)
    return refuse('BUDGET_PAUSED');
  if(hourlyQuota!==null){
    const observed=evaluateWclHourlyQuota(hourlyQuota,{
      reservePoints,databaseReservePoints});
    if(!observed.allowed)return {
      ...refuse(observed.status),waitMs:observed.waitMs,
      hourlyRemainingPoints:observed.remainingPoints,
      databaseRemainingPoints:observed.databaseRemainingPoints
    };
  }
  return {...base,status:'ADMITTED',allowed:true};
}
