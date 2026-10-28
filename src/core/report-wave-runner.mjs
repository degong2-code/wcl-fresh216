import {randomUUID} from 'node:crypto';
import {makeRankingsWaveQuery,decodeRankingsWave} from './report-wave-plan.mjs';
import {joinFightEvidence} from './evidence-join.mjs';
import {evaluateRequestAdmission} from './request-admission.mjs';
import {beginWaveFetch,completeWaveFetch,uncertainWaveFailure,
  checkpointStats} from './checkpoint.mjs';

/**
 * One Report wave is ONE billed HTTP operation, not several fight requests.
 * No WCL client: tests inject a synthetic transport. The host supplies
 * an atomic checkpoint store and owns scheduling/rate-limit policy.
 */
export async function executeOneReportWave({
  store,wave,transport,clock=Date.now,attemptId=randomUUID(),
  admissionPolicy=null,shouldCancel=()=>false
}={}){
  if(!store||typeof store.read!=='function'||
    typeof store.update!=='function'||!wave||
    typeof transport!=='function'||typeof clock!=='function'||
    typeof attemptId!=='string'||!attemptId||
    typeof shouldCancel!=='function')
    throw Error('WAVE_RUNNER_CONFIG_INVALID');

  // Build the exact GraphQL document before marking any billed attempt.
  const query=makeRankingsWaveQuery(wave);
  if(shouldCancel())return {status:'CANCELLED_BEFORE_REQUEST',attempted:false};
  const atMs=clock();
  if(!Number.isSafeInteger(atMs)||atMs<0)throw Error('WAVE_RUNNER_CLOCK_INVALID');
  if(admissionPolicy!==null){
    const d=evaluateRequestAdmission(store.read(),{
      ...admissionPolicy,nowMs:atMs
    });
    if(!d.allowed)return {status:d.status,attempted:false,
      waitMs:d.waitMs,pointsTotalConfirmed:d.pointsTotalConfirmed};
  }
  try{
    // One atomic state transition protects ALL fights in this one HTTP call.
    store.update(state=>{
      if(admissionPolicy!==null){
        const d=evaluateRequestAdmission(state,{
          ...admissionPolicy,nowMs:atMs
        });
        if(!d.allowed){
          const e=Error('WAVE_ADMISSION_REFUSED');e.admission=d;throw e;
        }
      }
      return beginWaveFetch(state,wave,attemptId,atMs);
    });
  }catch(e){
    if(e?.admission)return {status:e.admission.status,attempted:false,
      waitMs:e.admission.waitMs,
      pointsTotalConfirmed:e.admission.pointsTotalConfirmed};
    if(e?.message==='SCOPE_HAS_UNRESOLVED_ATTEMPT')
      return {status:'NEEDS_REVIEW',attempted:false};
    throw e;
  }

  let candidate,points=null;
  try{
    const response=await transport(query);
    const decoded=decodeRankingsWave(wave,response?.httpStatus,response?.body);
    points=decoded.observedPoints;
    if(decoded.status!=='OK')candidate={code:decoded.status};
    else {
      // No partial proof commit. Every fight is resolved in memory first.
      const joined=decoded.results.map(({group,report})=>
        joinFightEvidence(group,report));
      candidate={joined};
    }
  }catch(_e){
    // The remote call might have been billed; never retry automatically.
    candidate={code:'WAVE_TRANSPORT_OR_PROCESSING_EXCEPTION'};
  }
  const finished=clock();
  const wallMs=Number.isSafeInteger(finished)&&finished>=atMs?
    finished-atMs:null;

  // The caller's store must be atomic. On a storage error, leave IN_FLIGHT;
  // operator recovery will convert it to NEEDS_REVIEW, not re-dispatch.
  const updated=store.update(state=>candidate.code?
    uncertainWaveFailure(state,wave,attemptId,{
      code:candidate.code,points,wallMs
    }):
    completeWaveFetch(state,wave,attemptId,candidate.joined,{
      points,wallMs
    })
  );
  const stats=checkpointStats(updated);
  return {status:candidate.code?'NEEDS_REVIEW':'RECORDED',
    attempted:true,fights:wave.fightGroups.length,
    verifiedSlots:candidate.joined?.reduce((n,j)=>n+j.verified.length,0)??0,
    unresolvedSlots:candidate.joined?.reduce((n,j)=>n+j.unresolved.length,0)??0,
    observedPoints:points,wallMs,
    incident:candidate.code??null,
    witnessedPointsTotal:stats.witnessedPoints,
    pointsTotalConfirmed:stats.pointsTotalConfirmed};
}
