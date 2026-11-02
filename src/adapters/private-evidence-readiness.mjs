/**
 * Private Actions only: verify the *real* production adapters can be
 * instantiated against pinned A + C + private state, without invoking any
 * publish/append callbacks. No WCL, no network writes, no credentials logged.
 *
 * An archive Git write token and a remote C-delta commit path are separate
 * production requirements, NOT inferred from having a valid HMAC secret.
 */
import {createFresh216EvidencePublisher}
  from './fresh216-evidence-publisher.mjs';
import {createPublicActorProofArchiveStore}
  from './fresh216-public-actor-proof-store.mjs';
import {createGitBackedReportStateCommitProvider}
  from './private-report-state-commit.mjs';
import {deriveFresh216PriorityByKey}
  from './fresh216-priority-map.mjs';
import {PILOT_JOURNAL}
  from './fresh216-public-pilot-journal.mjs';
import {createFresh216ArchiveCDeltaAppender}
  from '../../tools/lib/fresh216-archive-c-delta.mjs';
import {runOneAdaptiveStep}
  from '../core/adaptive-collector-runner.mjs';
import {checkpointStats}
  from '../core/checkpoint.mjs';

const need=(v,c)=>{if(!v)throw Error(c);};
const SHA=/^[0-9a-f]{40}$/;
export const EVIDENCE_PUBLIC_WRITE_GATE='PUBLIC_WRITE_ROUTE_NOT_AUTHORIZED';
export const EVIDENCE_PRIVATE_C_GATE='PRIVATE_C_DELTA_REMOTE_WRITE_NOT_WIRED';

export function validateReadOnlyEvidenceGate({
  checkpoint,hmacKey,publicBranchHead,writeEnabled=false
}={}){
  need(writeEnabled===false,
    'PRIVATE_EVIDENCE_PREFLIGHT_WRITE_MODE_FORBIDDEN');
  need(typeof hmacKey==='string'&&
    Buffer.byteLength(hmacKey,'utf8')>=32,
    'PRIVATE_EVIDENCE_PREFLIGHT_HMAC_NOT_READY');
  need(typeof publicBranchHead==='string'&&
    SHA.test(publicBranchHead),
    'PRIVATE_EVIDENCE_PREFLIGHT_PUBLIC_REF_UNVERIFIED');
  need(PILOT_JOURNAL.repo==='degong2-code/wcl-fresh216'&&
    PILOT_JOURNAL.branch==='fresh216-public-evidence-pilot-20261031',
    'PRIVATE_EVIDENCE_PREFLIGHT_PUBLIC_TARGET_DRIFT');
  need(checkpoint?.schema===1&&
    checkpoint.status==='ACTIVE'&&
    checkpoint.version===1&&
    checkpoint.scopeKey==='heroic:2026-10-22_27:latest:source',
    'PRIVATE_EVIDENCE_PREFLIGHT_STATE_DRIFT');
  const stats=checkpointStats(checkpoint);
  const entries=Object.values(checkpoint.entries??{});
  need(entries.length===5&&entries.every(e=>e.status==='READY')&&
    stats.evidencePending===0&&stats.evidenceNeedsReview===0&&
    stats.counts.IN_FLIGHT===0&&stats.counts.NEEDS_REVIEW===0&&
    Object.keys(checkpoint.rankRequests??{}).length===0&&
    Object.keys(checkpoint.sourceRequests??{}).length===0&&
    checkpoint.recoveryBaseline?.cExact===21252&&
    checkpoint.recoveryBaseline?.named===9&&
    checkpoint.recoveryBaseline?.maskedQuarantined===339&&
    checkpoint.recoveryBaseline?.namedFightGroups===5,
    'PRIVATE_EVIDENCE_PREFLIGHT_READY5_DRIFT');
  return {hmacReady:true,checkpointReadyGroups:entries.length,
    publicTargetReadConfirmed:true,
    publicWriteGate:EVIDENCE_PUBLIC_WRITE_GATE,
    cRemoteWriteGate:EVIDENCE_PRIVATE_C_GATE};
}
export async function preflightRealEvidenceAdaptersReadOnly({
  sourceSlots,checkpoint,priorityPlan,baseCompressedBytes,
  deltaDirectory,stateRoot,hmacKey,publicBranchHead
}={}){
  const gate=validateReadOnlyEvidenceGate({
    checkpoint,hmacKey,publicBranchHead
  });
  need(Array.isArray(sourceSlots)&&sourceSlots.length===21600,
    'PRIVATE_EVIDENCE_PREFLIGHT_SOURCE_DRIFT');
  const priorityByKey=deriveFresh216PriorityByKey({
    priorityPlan,sourceSlots
  });
  const getReportStateCommit=createGitBackedReportStateCommitProvider({
    repoRoot:stateRoot
  });
  const append=createFresh216ArchiveCDeltaAppender({
    sourceSlots,baseCompressedBytes,deltaDirectory,priorityByKey,
    getReportStateCommit
  });
  const snapshot=append.snapshot();
  need(snapshot.totalExactC===21252&&snapshot.deltaCount===231&&
    snapshot.applied===2423&&
    snapshot.lastDeltaSha256===
      checkpoint.recoveryBaseline.lastDeltaSha256,
    'PRIVATE_EVIDENCE_PREFLIGHT_C_CHAIN_DRIFT');
  // Bind the real GitHub Archive adapter with an intentionally unusable
  // no-network token. Never use live credentials in a read-only preflight.
  let networkCalls=0;
  const archiveStore=createPublicActorProofArchiveStore({
    token:'NO_NETWORK_TEST_TOKEN_DO_NOT_USE_FOR_WRITES',
    hmacKey,
    fetchImpl:async()=>{
      networkCalls++;
      throw Error('PRIVATE_EVIDENCE_PREFLIGHT_NETWORK_FORBIDDEN');
    }
  });
  const publish=createFresh216EvidencePublisher({
    sourceSlots,expectedSourceSha256:checkpoint.sourceSha256,
    expectedScopeKey:checkpoint.scopeKey,hmacKey,
    archiveStore,cDeltaAppender:append
  });
  need(typeof publish==='function'&&networkCalls===0,
    'PRIVATE_EVIDENCE_PREFLIGHT_UNEXPECTED_SIDE_EFFECT');
  // True preview of the existing state machine. update() must never run.
  const preview=await runOneAdaptiveStep({
    slots:sourceSlots,
    store:{read:()=>checkpoint,update:()=>{
      throw Error('PRIVATE_EVIDENCE_PREFLIGHT_WRITE_FORBIDDEN');
    }},
    mode:'preview'
  });
  need(preview.status==='PREVIEW'&&preview.kind==='REPORT_WAVE'&&
    preview.nextReportFights>=1&&preview.nextReportFights<=4&&
    networkCalls===0,
    'PRIVATE_EVIDENCE_PREFLIGHT_PREVIEW_DRIFT');
  return {
    status:'FRESH216_PRIVATE_REAL_EVIDENCE_READ_ONLY_PREFLIGHT_PASS',
    sourceSlots:sourceSlots.length,cExact:snapshot.totalExactC,
    deltaParts:snapshot.deltaCount,
    readyGroups:gate.checkpointReadyGroups,
    nextPreviewKind:preview.kind,
    hmacReady:gate.hmacReady,
    realPublisherConstructed:true,
    realArchiveStoreConstructed:true,
    realCDeltaAppenderConstructed:true,
    reportStateCommitProviderConstructed:true,
    publicTargetReadConfirmed:gate.publicTargetReadConfirmed,
    publicWriteGate:gate.publicWriteGate,
    cRemoteWriteGate:gate.cRemoteWriteGate,
    networkCalls,archiveWrites:0,deltaAppends:0,
    wclCalls:0,observedPoints:0,sheetsWrites:0
  };
}
