/**
 * Reusable single-tick Fresh216 ENGINE host. NO scheduler, journal, secret
 * source, WCL token handler or C file format. All durable state is the
 * existing private Git-backed checkpoint; each invocation does at most one
 * paid Report wave or one pending-evidence transition.
 *
 * The caller owns trusted-branch identity, role-separated tokens, admission
 * policy, and exact pinned Git checkouts. A Boolean is not an owner signature.
 */
import {prepareAdaptiveNext,runOneAdaptiveStep}
  from '../core/adaptive-collector-runner.mjs';
import {createFresh216EvidencePublisher}
  from './fresh216-evidence-publisher.mjs';
import {createPrivateStagedPublicWaveStore}
  from './private-staged-public-wave-store.mjs';
import {SOURCE_SHA256}
  from '../../tools/lib/fresh216-c-delta.mjs';

const need=(v,c)=>{if(!v)throw Error(c);};
const sha40=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
const modes=new Set(['preview','report-one','stage-one','finalize-one']);
const sanitized=next=>({
  nextKind:next.kind,
  nextReportFights:next.wave?.fightGroups?.length??0,
  pendingEvidence:next.kind==='ARCHIVE_PUBLISH',
  needsReview:next.kind==='NEEDS_REVIEW',
  // Never put report codes, actor names, slots or witness bytes in logs.
  noRawIdentifiers:true
});
function checkInput({mode,slots,store}){
  need(modes.has(mode),'ENGINE_TICK_MODE_INVALID');
  need(Array.isArray(slots)&&slots.length===21600&&
    store&&typeof store.read==='function'&&
    typeof store.update==='function','ENGINE_TICK_STORE_OR_SOURCE_INVALID');
  const state=store.read();
  need(state?.schema===1&&state.status==='ACTIVE'&&
    state.sourceSha256===SOURCE_SHA256&&
    typeof state.scopeKey==='string'&&state.scopeKey,
    'ENGINE_TICK_PINNED_A_STATE_REQUIRED');
  need(slots.every(s=>s?.scopeKey===state.scopeKey),
    'ENGINE_TICK_SCOPE_DRIFT');
  return state;
}

/**
 * mode=preview: no writes.
 * mode=report-one: exactly one existing Report-wave via durable update/WCL.
 * mode=stage-one: existing HMAC publisher + signed private Git stage, then
 *                deliberately PENDING: no public GET, Git write or C append.
 * mode=finalize-one: caller-supplied readback-only public ArchiveStore and
 *                    REMOTE-confirmed C appender; then existing checkpoint
 *                    transition to COMMITTED. Never write public Git here.
 */
export async function runOneFresh216EngineTick({
  mode='preview',slots,store,approved=false,
  transport=null,admissionPolicy=null,onVerifiedWave=null,
  witnessReader=null,hmacKey=null,stageRepoRoot=null,
  getReportStateCommit=null,stagePersist=null,
  publishedArchiveStore=null,cDeltaAppender=null
}={}){
  const state=checkInput({mode,slots,store});
  const next=prepareAdaptiveNext({slots,state});
  const outline=sanitized(next);
  if(mode==='preview')return {status:'PREVIEW',...outline,networkCalls:0};
  if(mode==='report-one'){
    if(next.kind!=='REPORT_WAVE')
      return {status:'NO_REPORT_WAVE',...outline,networkCalls:0};
    need(approved===true&&typeof transport==='function'&&
      admissionPolicy&&typeof onVerifiedWave==='function',
      'ENGINE_TICK_REPORT_NOT_AUTHORIZED');
    const result=await runOneAdaptiveStep({
      slots,store,mode:'execute',approved:true,
      rankTransport:()=>{throw Error('ENGINE_TICK_RANK_CALL_FORBIDDEN');},
      reportTransport:transport,admissionPolicy,onVerifiedWave
    });
    need(result.kind==='REPORT_WAVE','ENGINE_TICK_REPORT_RESULT_INVALID');
    return {...result,mode:'report-one'};
  }
  if(next.kind!=='ARCHIVE_PUBLISH')
    return {status:'NO_PENDING_WAVE',...outline,networkCalls:0};
  need(approved===true&&typeof witnessReader==='function'&&
    typeof hmacKey==='string'&&Buffer.byteLength(hmacKey,'utf8')>=32,
    'ENGINE_TICK_PUBLICATION_NOT_AUTHORIZED');
  let archiveStore,delta;
  let staged=null;
  if(mode==='stage-one'){
    need(typeof stageRepoRoot==='string'&&stageRepoRoot.startsWith('/')&&
      typeof getReportStateCommit==='function'&&
      typeof stagePersist==='function',
      'ENGINE_TICK_STAGE_WRITER_REQUIRED');
    archiveStore=createPrivateStagedPublicWaveStore({
      repoRoot:stageRepoRoot,hmacKey,getReportStateCommit,
      stageWriteApproved:true,cDeltaAdvanceApproved:false,
      stagePersist:async args=>{
        const receipt=await stagePersist(args);
        need(receipt?.status==='PRIVATE_SIGNED_STAGE_REMOTE_CONFIRMED'&&
          sha40(receipt.privateStageCommit)&&
          receipt.waveSha256===args.manifest.waveSha256,
          'ENGINE_TICK_STAGE_REMOTE_NOT_CONFIRMED');
        staged=receipt;
        return receipt;
      },
      // Stage-only never inspects/writes public Git. Existing publisher
      // maps the deliberately absent public Manifest to PENDING.
      publicFetch:async()=>({status:404})
    });
    delta=async()=>{throw Error('ENGINE_TICK_C_FORBIDDEN_AT_STAGE');};
  }else{
    need(typeof publishedArchiveStore?.persistWave==='function'&&
      typeof cDeltaAppender==='function',
      'ENGINE_TICK_FINALIZE_ADAPTERS_REQUIRED');
    archiveStore=publishedArchiveStore;
    delta=async input=>{
      const receipt=await cDeltaAppender(input);
      need(receipt?.status==='NO_NEW_PROOFS'||
        (receipt?.status==='APPENDED'&&
          receipt.privateCandidateRemoteConfirmed===true&&
          sha40(receipt.privateCandidateCommit)),
        'ENGINE_TICK_C_NOT_REMOTE_DURABLE');
      return receipt;
    };
  }
  const publish=createFresh216EvidencePublisher({
    sourceSlots:slots,expectedSourceSha256:SOURCE_SHA256,
    expectedScopeKey:state.scopeKey,hmacKey,archiveStore,
    cDeltaAppender:delta
  });
  const before=state.version;
  const result=await runOneAdaptiveStep({
    slots,store,mode:'execute',archivePublishApproved:true,
    witnessReader,evidencePublisher:publish
  });
  if(mode==='stage-one'){
    // A signed Stage is NOT the Archive/C checkpoint completion.
    need(result.kind==='ARCHIVE_PUBLISH'&&result.status==='PENDING'&&
      staged?.status==='PRIVATE_SIGNED_STAGE_REMOTE_CONFIRMED'&&
      store.read().version===before,
      'ENGINE_TICK_STAGE_NOT_PENDING');
    return {status:'PRIVATE_STAGE_REMOTE_CONFIRMED_PENDING_PUBLIC',
      privateStageCommit:staged.privateStageCommit,
      reused:staged.reused===true,
      waveSha256:staged.waveSha256,
      checkpointCommitted:false,wclCalls:0,cDeltaAppends:0};
  }
  if(result.status==='COMMITTED')
    return {status:'ENGINE_WAVE_COMMITTED',evidenceCommitted:true,
      wclCalls:0,checkedOutVersion:store.read().version};
  return {status:result.status,kind:result.kind,
    checkpointCommitted:false,wclCalls:0};
}
