/**
 * Resume-safe private evidence publisher for one already-fetched Report wave.
 *
 * It consumes the immutable private witness, builds/replays public HMAC
 * archives, atomically publishes the archive wave, invokes the private
 * C-delta v1 adapter, and returns aggregate-only checkpoint receipts.
 * No WCL/OAuth transport is reachable from this module.
 */
import {createHash} from 'node:crypto';
import {makeRankingsWaveQuery,decodeRankingsWave}
  from '../core/report-wave-plan.mjs';
import {joinFightEvidence} from '../core/evidence-join.mjs';
import {crosswalkMaskedReportFight} from '../core/masked-report-crosswalk.mjs';
import {
  buildActorProofArchive,verifyActorProofArchive,
  buildActorProofWaveManifest
} from '../core/fresh216-actor-proof-archive.mjs';
import {buildFresh216CProofRowsFromActorArchives}
  from '../core/fresh216-archive-to-c.mjs';
import {SOURCE_SHA256 as C_SOURCE_SHA256}
  from '../../tools/lib/fresh216-c-delta.mjs';

const need=(v,c)=>{if(!v)throw Error(c);};
const shaBytes=v=>createHash('sha256').update(v).digest('hex');
const shaObject=v=>shaBytes(Buffer.from(JSON.stringify(v),'utf8'));
const validSha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const proofKey=v=>JSON.stringify([v.jobKey,v.rank,v.snapshotSha]);

function validateSourceSlots(sourceSlots,expectedScopeKey){
  need(Array.isArray(sourceSlots)&&sourceSlots.length===21600,
    'EVIDENCE_PUBLISHER_A_SOURCE_COUNT');
  const seen=new Set();
  for(const slot of sourceSlots){
    const key=proofKey(slot);
    need(slot?.scopeKey===expectedScopeKey&&
      typeof slot.jobKey==='string'&&slot.jobKey&&
      Number.isSafeInteger(slot.rank)&&slot.rank>=1&&slot.rank<=100&&
      validSha(slot.snapshotSha)&&
      typeof slot.className==='string'&&slot.className&&
      typeof slot.specName==='string'&&slot.specName&&
      typeof slot.totalDps==='number'&&Number.isFinite(slot.totalDps)&&
      slot.totalDps>0&&typeof slot.reportCode==='string'&&slot.reportCode&&
      Number.isSafeInteger(slot.fightId)&&slot.fightId>0&&
      Number.isSafeInteger(slot.encounterId)&&slot.encounterId>0&&
      Number.isSafeInteger(slot.difficulty)&&slot.difficulty>0&&
      Number.isFinite(slot.startTime)&&slot.startTime>0&&
      typeof slot.name==='string'&&
      (slot.reportRevision==null||
        Number.isSafeInteger(slot.reportRevision)&&slot.reportRevision>=0)&&
      !seen.has(key),
      'EVIDENCE_PUBLISHER_A_SOURCE_INVALID');
    seen.add(key);
  }
}
function privateProofRowsForWave(wave,decoded){
  const rows=[];
  let candidateVerifiedSlots=0;
  for(const {group,report} of decoded.results){
    const joined=joinFightEvidence(group,report);
    const canonical=new Map(joined.verified.map(v=>[proofKey(v),v]));
    need(canonical.size===joined.verified.length,
      'EVIDENCE_PUBLISHER_CANONICAL_DUPLICATE');
    const masked=crosswalkMaskedReportFight(group,report);
    const maskedKeys=masked.verified.map(proofKey);
    need(new Set(maskedKeys).size===maskedKeys.length&&
      maskedKeys.every(key=>canonical.has(key)),
      'EVIDENCE_PUBLISHER_MASKED_CROSSWALK_DIVERGENCE');
    candidateVerifiedSlots+=joined.verified.length;
    const identity={
      scopeKey:group.scopeKey,reportCode:group.reportCode,
      reportRevision:report.revision,fightId:group.fightId,
      encounterId:group.encounterId,difficulty:group.difficulty
    };
    for(const row of joined.verified)rows.push({...row,identity});
  }
  return {rows,candidateVerifiedSlots};
}
export function createFresh216EvidencePublisher({
  sourceSlots,expectedSourceSha256,expectedScopeKey,hmacKey,
  archiveStore,cDeltaAppender
}={}){
  need(validSha(expectedSourceSha256)&&
    expectedSourceSha256===C_SOURCE_SHA256&&
    typeof expectedScopeKey==='string'&&expectedScopeKey&&
    typeof hmacKey==='string'&&Buffer.byteLength(hmacKey,'utf8')>=32&&
    archiveStore&&typeof archiveStore.persistWave==='function'&&
    typeof cDeltaAppender==='function',
    'EVIDENCE_PUBLISHER_CONFIG_INVALID');
  validateSourceSlots(sourceSlots,expectedScopeKey);
  return async function publishFresh216Evidence({
    wave,attemptId,evidence,witness
  }={}){
    need(wave&&wave.scopeKey===expectedScopeKey&&
      typeof attemptId==='string'&&attemptId&&
      evidence?.status==='PENDING'&&evidence.attemptId===attemptId&&
      evidence.sourceSha256===expectedSourceSha256&&
      validSha(evidence.waveSha256)&&
      validSha(evidence.requestBodySha256)&&
      validSha(evidence.responseBodySha256)&&
      validSha(evidence.witnessSha256)&&
      typeof evidence.witnessRef==='string'&&
      witness?.schema===1&&witness.kind===
        'FRESH216_PRIVATE_REPORT_WAVE_WITNESS_V1'&&
      witness.attemptId===attemptId&&
      witness.sourceSha256===expectedSourceSha256&&
      witness.waveSha256===evidence.waveSha256&&
      witness.requestBodySha256===evidence.requestBodySha256&&
      witness.responseBodySha256===evidence.responseBodySha256&&
      witness.witnessSha256===evidence.witnessSha256&&
      JSON.stringify(witness.wave)===JSON.stringify(wave),
      'EVIDENCE_PUBLISHER_WITNESS_IDENTITY_DRIFT');
    const raw=Buffer.isBuffer(witness.responseBodyBytes)?
      witness.responseBodyBytes:
      witness.responseBodyBytes instanceof Uint8Array?
        Buffer.from(witness.responseBodyBytes):
        typeof witness.responseBodyBase64==='string'?
          Buffer.from(witness.responseBodyBase64,'base64'):null;
    need(raw&&raw.length>0&&shaBytes(raw)===evidence.responseBodySha256,
      'EVIDENCE_PUBLISHER_RESPONSE_BYTES_INVALID');
    const requestBodyText=witness.requestBodyText;
    need(typeof requestBodyText==='string'&&
      shaBytes(Buffer.from(requestBodyText,'utf8'))===
        evidence.requestBodySha256&&
      JSON.stringify(JSON.parse(requestBodyText))===
        JSON.stringify(makeRankingsWaveQuery(wave)),
      'EVIDENCE_PUBLISHER_REQUEST_BYTES_INVALID');
    need(shaObject(wave)===evidence.waveSha256&&
      Number.isSafeInteger(witness.capturedAtMs)&&
      Number.isFinite(witness.observedPoints)&&witness.observedPoints>=0,
      'EVIDENCE_PUBLISHER_WAVE_OR_COST_INVALID');
    let body;
    try{body=JSON.parse(raw.toString('utf8'));}
    catch{throw Error('EVIDENCE_PUBLISHER_RESPONSE_JSON_INVALID');}
    const decoded=decodeRankingsWave(wave,witness.httpStatus,body);
    need(decoded.status==='OK'&&
      decoded.observedPoints===witness.observedPoints,
      'EVIDENCE_PUBLISHER_REPORT_DECODE_INVALID');
    const {rows:privateProofRows,candidateVerifiedSlots}=
      privateProofRowsForWave(wave,decoded);
    const archives=[];
    for(const {group,report} of decoded.results){
      const archive=buildActorProofArchive({
        group,report,sourceSha256:expectedSourceSha256,
        waveSha256:evidence.waveSha256,
        requestBodySha256:evidence.requestBodySha256,
        responseBodySha256:evidence.responseBodySha256,
        httpStatus:witness.httpStatus,
        observedPoints:witness.observedPoints,
        capturedAtMs:witness.capturedAtMs,hmacKey
      });
      const replay=verifyActorProofArchive(archive,{
        hmacKey,expectedSourceSha256,
        expectedRequestBodySha256:evidence.requestBodySha256,
        expectedResponseBodySha256:evidence.responseBodySha256
      });
      const canonical=new Map(joinFightEvidence(group,report).verified
        .map(v=>[proofKey(v),v]));
      const archiveVerified=archive.outcomes.filter(o=>o.status==='VERIFIED');
      const archiveKeys=archiveVerified.map(proofKey);
      need(new Set(archiveKeys).size===archiveKeys.length&&
        archiveVerified.every(o=>{
          const source=canonical.get(proofKey(o));
          return source&&Object.is(source.proof.bossDps,o.bossDps);
        })&&
        replay.verifiedSlots===archiveVerified.length,
        'EVIDENCE_PUBLISHER_ARCHIVE_CANONICAL_DIVERGENCE');
      archives.push(archive);
    }
    const manifest=buildActorProofWaveManifest({
      archives,hmacKey,createdAtMs:witness.capturedAtMs
    });
    let stored;
    try{
      stored=await archiveStore.persistWave(archives,{
        createdAtMs:witness.capturedAtMs
      });
    }catch(error){
      if(error?.message==='PUBLIC_ACTOR_WAVE_WRITE_NOT_ATTEMPTED')
        return {status:'PENDING',code:'PUBLIC_ARCHIVE_WRITE_NOT_ATTEMPTED'};
      return {status:'NEEDS_REVIEW',code:'PUBLIC_ARCHIVE_WRITE_OR_READBACK_UNCERTAIN'};
    }
    const expectedSlots=wave.fightGroups.reduce((n,g)=>n+g.slots.length,0);
    need(stored?.waveSha256===evidence.waveSha256&&
      stored.manifestSha256===manifest.manifestSha256&&
      stored.archiveCount===wave.fightGroups.length&&
      Number.isSafeInteger(stored.verifiedSlots)&&
      Number.isSafeInteger(stored.unresolvedSlots)&&
      stored.verifiedSlots+stored.unresolvedSlots===expectedSlots&&
      stored.verifiedSlots<=candidateVerifiedSlots,
      'EVIDENCE_PUBLISHER_ARCHIVE_READBACK_DRIFT');
    const bridgeResult=buildFresh216CProofRowsFromActorArchives({
      groups:wave.fightGroups,archives,manifest,sourceSlots,
      privateProofRows,hmacKey,expectedSourceSha256,expectedScopeKey
    });
    let delta;
    try{
      delta=await cDeltaAppender({
        bridgeResult,sourceSlots,privateProofRows,archives,manifest,
        archiveReceipt:stored,wave,attemptId,evidence,witness
      });
    }catch(_error){
      return {status:'NEEDS_REVIEW',code:'PRIVATE_C_DELTA_APPEND_UNCERTAIN'};
    }
    need(delta&&['APPENDED','NO_NEW_PROOFS'].includes(delta.status)&&
      delta.sourceSha256===expectedSourceSha256&&
      Number.isSafeInteger(delta.addedExactC)&&delta.addedExactC>=0&&
      (delta.status==='NO_NEW_PROOFS'?delta.deltaSha256==null:
        Number.isSafeInteger(delta.deltaIndex)&&delta.deltaIndex>=0&&
        validSha(delta.deltaSha256)),
      'EVIDENCE_PUBLISHER_C_DELTA_RECEIPT_INVALID');
    return {
      status:'COMMITTED',
      archiveReceipt:{
        status:'VERIFIED',waveSha256:stored.waveSha256,
        manifestSha256:stored.manifestSha256,
        manifestCommitSha:stored.manifestCommitSha??null,
        archiveCount:stored.archiveCount,
        verifiedSlots:stored.verifiedSlots,
        unresolvedSlots:stored.unresolvedSlots
      },
      cDeltaReceipt:{
        status:delta.status,sourceSha256:delta.sourceSha256,
        deltaIndex:delta.deltaIndex??null,
        deltaSha256:delta.deltaSha256??null,
        addedExactC:delta.addedExactC
      }
    };
  };
}
