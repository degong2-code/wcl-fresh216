import {randomUUID} from 'node:crypto';
import {makeRankingsQuery,decodeRankingsEnvelope}
  from '../adapters/wcl-rankings-envelope.mjs';
import {joinFightEvidence} from './evidence-join.mjs';
import {evaluateRequestAdmission} from './request-admission.mjs';
import {readyFetches,beginFetch,completeFetch,uncertainFailure,checkpointStats}
  from './checkpoint.mjs';

/**
 * Minimal offline-first operation boundary, ONE Fight per ONE HTTP request.
 *
 * No WCL client, token, Google Sheets writer, retry loop or trigger is shipped.
 * 'transport' is caller-injected; CI supplies a synthetic local function only.
 *
 * Durability contract:
 *   1. Atomically persist IN_FLIGHT before calling transport.
 *   2. Decode and verify exact actor/fight/report identity.
 *   3. Atomically persist result or explicit uncertain incident.
 *   4. If process dies between steps, IN_FLIGHT remains until explicit
 *      recoverCheckpoint(), which never returns it to READY.
 *
 * No whole-wave operations are supported here. Cross-job same-fight references
 * still fan out through the pre-existing grouped plan and join.
 */
export async function executeOneReadyFight({
  store,transport,clock=Date.now,attemptId=randomUUID(),
  shouldCancel=()=>false,admissionPolicy=null
}={}){
  if(!store || typeof store.read!=='function' ||
    typeof store.update!=='function' ||
    typeof transport!=='function'||typeof clock!=='function'||
    typeof shouldCancel!=='function'||typeof attemptId!=='string'||
    !attemptId) throw Error('RUNNER_CONFIG_INVALID');

  const state=store.read();
  if(state.status!=='ACTIVE')return {status:'NOT_ACTIVE'};
  const group=readyFetches(state)[0];
  if(!group)return {status:'NO_READY'};
  // Preflight query and cancellation BEFORE the durable billed-attempt marker.
  const query=makeRankingsQuery(group);
  if(shouldCancel())return {status:'CANCELLED_BEFORE_REQUEST'};
  const startedAtMs=clock();
  if(!Number.isSafeInteger(startedAtMs)||startedAtMs<0)
    throw Error('RUNNER_CLOCK_INVALID');
  if(admissionPolicy!==null){
    const decision=evaluateRequestAdmission(store.read(),{
      ...admissionPolicy,nowMs:startedAtMs
    });
    if(!decision.allowed)
      return {status:decision.status,attempted:false,waitMs:decision.waitMs,
        pointsTotalConfirmed:decision.pointsTotalConfirmed};
  }

  // The admission/read above is only an optimization. Re-check budget
  // and unresolved operations INSIDE the same serialized persistence update
  // that marks this request IN_FLIGHT. Otherwise a second worker can pass
  // a stale budget check and dispatch a paid request after the first commits.
  try{
    store.update(s=>{
      if(admissionPolicy!==null){
        const decision=evaluateRequestAdmission(s,{
          ...admissionPolicy,nowMs:startedAtMs
        });
        if(!decision.allowed){
          const denied=Error('ATOMIC_ADMISSION_REFUSED');
          denied.admission=decision;
          throw denied;
        }
      }
      return beginFetch(s,group.key,attemptId,startedAtMs);
    });
  }catch(error){
    if(error?.admission){
      const d=error.admission;
      return {status:d.status,attempted:false,waitMs:d.waitMs,
        pointsTotalConfirmed:d.pointsTotalConfirmed};
    }
    if(error?.message==='SCOPE_HAS_UNRESOLVED_ATTEMPT')
      return {status:'NEEDS_REVIEW',attempted:false,waitMs:0,
        pointsTotalConfirmed:checkpointStats(store.read()).pointsTotalConfirmed};
    throw error;
  }

  let candidate,observedPoints=null;
  try{
    const response=await transport(query);
    const decoded=decodeRankingsEnvelope(
      group,response?.httpStatus,response?.body
    );
    observedPoints=decoded.observedPoints;
    if(decoded.status!=='OK'){
      candidate={code:decoded.status,points:observedPoints};
    }else{
      const joined=joinFightEvidence(group,decoded.report);
      candidate={joined,points:observedPoints};
    }
  }catch(_err){
    // Unknown transport/processing status may have consumed WCL points.
    // Never auto retry or assume zero cost; callers can inspect the incident.
    candidate={code:'TRANSPORT_OR_PROCESSING_EXCEPTION',points:observedPoints};
  }
  const endedAtMs=clock();
  const wallMs=Number.isSafeInteger(endedAtMs)&&endedAtMs>=startedAtMs
    ?endedAtMs-startedAtMs:null;
  const after=store.update(s=>{
    if(candidate.code){
      return uncertainFailure(s,group.key,attemptId,{
        code:candidate.code,points:candidate.points,wallMs
      });
    }
    return completeFetch(s,group.key,attemptId,candidate.joined,{
      points:candidate.points,wallMs
    });
  });
  const entry=after.entries[group.key];
  // Only aggregate metadata; never return or log Report IDs, actor identities,
  // token values or ranking rows.
  return {
    status:entry.status,attempted:true,
    verifiedSlots:entry.result?.verified.length??0,
    unresolvedSlots:entry.result?.unresolved.length??0,
    observedPoints:entry.observedPoints,
    wallMs:entry.wallMs,
    incident:entry.incident?.code??null
  };
}

/**
 * Bounded sequential sweep, no timers or built-in HTTP / Sheets adapters.
 * The host can schedule another sweep tick, preserving a single run's state.
 * A single uncertain request STOPs the sweep for human reconciliation even
 * if other READY fights exist. One click in a future host must own that
 * scheduling, rate gating, and end-to-end progress UI.
 */
export async function runBoundedSweep({
  store,transport,maxAttempts=16,clock=Date.now,
  newAttemptId=randomUUID,shouldCancel=()=>false,onProgress=()=>{},
  admissionPolicy=null
}={}){
  if(!store||typeof store.read!=='function'||typeof store.update!=='function'||
     typeof transport!=='function'||typeof newAttemptId!=='function'||
     typeof shouldCancel!=='function'||typeof onProgress!=='function'||
     !Number.isSafeInteger(maxAttempts)||maxAttempts<1||maxAttempts>128)
    throw Error('SWEEP_CONFIG_INVALID');
  let attempts=0,verifiedSlots=0,unresolvedSlots=0,reason='BUDGET_REACHED';
  let waitMs=0;
  // An earlier uncertain attempt requires operator reconciliation before
  // any new paid work, including untouched READY fights in the same scope.
  const starting=checkpointStats(store.read());
  if(starting.counts.NEEDS_REVIEW>0||starting.counts.IN_FLIGHT>0||
     starting.pointsUnobserved>0){
    return {status:'NEEDS_REVIEW',attempts:0,verifiedSlots:0,
      unresolvedSlots:0,readyFightGroups:starting.counts.READY,
      reviewFightGroups:starting.counts.NEEDS_REVIEW,
      pointsTotalConfirmed:starting.pointsTotalConfirmed,waitMs:0};
  }
  for(let i=0;i<maxAttempts;i++){
    if(shouldCancel()){reason='CANCELLED';break;}
    const result=await executeOneReadyFight({
      store,transport,clock,attemptId:newAttemptId(),shouldCancel,
      admissionPolicy
    });
    if(result.status==='NOT_ACTIVE'||result.status==='NO_READY'){
      reason=result.status;break;
    }
    if(result.status==='CANCELLED_BEFORE_REQUEST'){
      reason='CANCELLED';break;
    }
    if(['RATE_WAIT','BUDGET_PAUSED'].includes(result.status)||
       (result.status==='NEEDS_REVIEW'&&result.attempted===false)){
      reason=result.status;waitMs=result.waitMs??0;break;
    }
    attempts++;
    verifiedSlots+=result.verifiedSlots;
    unresolvedSlots+=result.unresolvedSlots;
    // Progress is notified AFTER the corresponding commit is durable.
    const stats=checkpointStats(store.read());
    const done=stats.counts.COMPLETED+stats.counts.COMPLETED_PARTIAL;
    const total=Object.values(stats.counts).reduce((a,b)=>a+b,0);
    await onProgress({
      attempts,verifiedSlots,unresolvedSlots,
      completedFightGroups:done,totalFightGroups:total,
      readyFightGroups:stats.counts.READY,
      reviewFightGroups:stats.counts.NEEDS_REVIEW,
      pointTotalConfirmed:stats.pointsTotalConfirmed
    });
    if(result.status==='NEEDS_REVIEW'){
      reason='NEEDS_REVIEW';
      break;
    }
  }
  const final=checkpointStats(store.read());
  if((reason==='BUDGET_REACHED'||reason==='NO_READY') &&
    final.counts.READY===0)
    reason=final.counts.NEEDS_REVIEW>0?'NEEDS_REVIEW':'NO_READY';
  return {
    status:reason,attempts,verifiedSlots,unresolvedSlots,
    readyFightGroups:final.counts.READY,
    reviewFightGroups:final.counts.NEEDS_REVIEW,
    pointsTotalConfirmed:final.pointsTotalConfirmed,waitMs
  };
}
