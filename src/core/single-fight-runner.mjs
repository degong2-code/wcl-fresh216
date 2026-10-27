import {randomUUID} from 'node:crypto';
import {makeRankingsQuery,decodeRankingsEnvelope}
  from '../adapters/wcl-rankings-envelope.mjs';
import {joinFightEvidence} from './evidence-join.mjs';
import {readyFetches,beginFetch,completeFetch,uncertainFailure}
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
  shouldCancel=()=>false
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

  // The update must be durable before ANY external request. A contending
  // worker fails beginFetch() and may never reach transport.
  store.update(s=>beginFetch(s,group.key,attemptId,startedAtMs));

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
    status:entry.status,
    verifiedSlots:entry.result?.verified.length??0,
    unresolvedSlots:entry.result?.unresolved.length??0,
    observedPoints:entry.observedPoints,
    wallMs:entry.wallMs,
    incident:entry.incident?.code??null
  };
}
