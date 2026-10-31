import {createHash,randomUUID} from 'node:crypto';
import {makeRankingsWaveQuery,decodeRankingsWave} from './report-wave-plan.mjs';
import {joinFightEvidence} from './evidence-join.mjs';
import {evaluateRequestAdmission} from './request-admission.mjs';
import {beginWaveFetch,completeWaveFetch,uncertainWaveFailure,
  checkpointStats} from './checkpoint.mjs';

const check=(v,c)=>{if(!v)throw Error(c);};
const shaBytes=v=>createHash('sha256').update(v).digest('hex');
const validSha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);

/**
 * One Report wave is ONE billed HTTP operation, not several fight requests.
 * No WCL client: tests inject a synthetic transport. The host supplies
 * an atomic checkpoint store and owns scheduling/rate-limit policy.
 */
export async function executeOneReportWave({
  store,wave,transport,clock=Date.now,attemptId=randomUUID(),
  admissionPolicy=null,shouldCancel=()=>false,onVerifiedWave=null
}={}){
  if(!store||typeof store.read!=='function'||
    typeof store.update!=='function'||!wave||
    typeof transport!=='function'||typeof clock!=='function'||
    typeof attemptId!=='string'||!attemptId||
    typeof shouldCancel!=='function'||
    (onVerifiedWave!==null&&typeof onVerifiedWave!=='function'))
    throw Error('WAVE_RUNNER_CONFIG_INVALID');

  // Build the exact GraphQL document before marking any billed attempt.
  const query=makeRankingsWaveQuery(wave);
  const requestBodyText=JSON.stringify(query);
  const requestBodySha256=shaBytes(Buffer.from(requestBodyText,'utf8'));
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

  let candidate,points=null,responseBodySha256=null;
  try{
    const response=await transport(query,requestBodyText);
    let body=response?.body;
    let rawBodyBytes=null;
    if(onVerifiedWave!==null){
      rawBodyBytes=Buffer.isBuffer(response?.rawBodyBytes)?
        response.rawBodyBytes:
        response?.rawBodyBytes instanceof Uint8Array?
          Buffer.from(response.rawBodyBytes):null;
      check(rawBodyBytes&&rawBodyBytes.length>0,
        'WAVE_RAW_RESPONSE_BYTES_REQUIRED');
      responseBodySha256=shaBytes(rawBodyBytes);
      // Parse the exact captured bytes, not a separately parsed transport copy.
      body=JSON.parse(rawBodyBytes.toString('utf8'));
    }
    const decoded=decodeRankingsWave(wave,response?.httpStatus,body);
    points=decoded.observedPoints;
    if(decoded.status!=='OK')candidate={code:decoded.status};
    else {
      // No partial proof commit. Every fight is resolved in memory first.
      const joined=decoded.results.map(({group,report})=>
        joinFightEvidence(group,report));
      let evidence=null;
      if(onVerifiedWave!==null){
        const capturedAtMs=clock();
        const receipt=await onVerifiedWave({
          wave,attemptId,query,requestBodyText,requestBodySha256,
          responseBodyBytes:Buffer.from(rawBodyBytes),
          responseBodySha256,httpStatus:response?.httpStatus,
          observedPoints:points,capturedAtMs,joinedByFight:joined,
          reports:decoded.results.map(x=>x.report)
        });
        check(receipt&&receipt.schema===1&&
          validSha(receipt.sourceSha256)&&validSha(receipt.waveSha256)&&
          typeof receipt.waveId==='string'&&receipt.waveId.length>0&&
          typeof receipt.witnessRef==='string'&&receipt.witnessRef.length>0&&
          validSha(receipt.witnessSha256),
          'WAVE_PRIVATE_WITNESS_RECEIPT_INVALID');
        evidence={
          schema:1,status:'PENDING',waveId:receipt.waveId,
          sourceSha256:receipt.sourceSha256,
          waveSha256:receipt.waveSha256,requestBodySha256,
          responseBodySha256,witnessRef:receipt.witnessRef,
          witnessSha256:receipt.witnessSha256,attemptId
        };
      }
      candidate={joined,evidence};
    }
  }catch(e){
    // The remote call might have been billed; never retry automatically.
    candidate={code:e?.message==='WAVE_RAW_RESPONSE_BYTES_REQUIRED'?
      'RAW_RESPONSE_BYTES_UNAVAILABLE':
      e?.message==='WAVE_PRIVATE_WITNESS_RECEIPT_INVALID'?
        'PRIVATE_WITNESS_RECEIPT_INVALID':
        'WAVE_TRANSPORT_OR_PROCESSING_EXCEPTION'};
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
      points,wallMs,evidence:candidate.evidence??null
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
    pointsTotalConfirmed:stats.pointsTotalConfirmed,
    requestBodySha256,responseBodySha256,
    witnessRef:candidate.evidence?.witnessRef??null};
}
