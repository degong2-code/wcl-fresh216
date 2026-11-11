/**
 * Fail-closed post-CAS admission boundary for V2 captured metadata.
 *
 * A durable SQLite commit and an independently trusted high-water anchor
 * advance are two separate transactions. This adapter deliberately refuses
 * to return usable evidence unless BOTH have been confirmed.
 *
 * The trusted anchor host is an injected, separately provisioned service:
 * - readVerifiedAnchor(scope) returns authenticated current high-water state
 * - compareAndAdvance({scope,previous,next}) atomically and durably advances it
 * Neither a local JSON file nor an untrusted self-reported receipt is a
 * production trust root. This adapter does not implement a remote anchor host.
 *
 * On anchor failure AFTER the SQLite commit, this function throws the
 * distinctive quarantine error. DO NOT retry the same bundle automatically:
 * the DB is ahead of its external anchor, and an operator must recover using
 * independently attested audit history. There is no automatic reconciliation.
 */
import {admitGovernedSignedWclCapture,governanceDigest} from './wcl-capture-trust-governance.mjs';

const need=(ok,code)=>{if(!ok)throw Error(code);};
const validSha=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
const validInt=x=>Number.isSafeInteger(x)&&x>=0;
const validScope=x=>x&&typeof x.sourceNamespace==='string'&&x.sourceNamespace.length>0&&
  Number.isSafeInteger(x.expansionId)&&x.expansionId>0;
const safeEqual=(a,b)=>a.sourceNamespace===b.sourceNamespace&&
  a.expansionId===b.expansionId&&a.generation===b.generation&&
  a.headSha256===b.headSha256;
const verifiedAnchor=(value,scope)=>{
  need(value&&validScope(value)&&safeEqual({...value,generation:0,headSha256:''},
    {...scope,generation:0,headSha256:''})&&
    validInt(value.generation)&&validSha(value.headSha256),
    'ANCHORED_ADMISSION_TRUSTED_ANCHOR_INVALID');
  return Object.freeze({
    sourceNamespace:value.sourceNamespace,expansionId:value.expansionId,
    generation:value.generation,headSha256:value.headSha256
  });
};

export async function admitWithIndependentAnchor({
  ledger,anchorHost,signedBundle,registry,registrySha256,
  expected,readCapture,nowMs,maxCaptureBytes,maxTotalBytes
}={}){
  need(ledger&&typeof ledger.readHead==='function'&&
    typeof ledger.commitHead==='function'&&
    anchorHost&&typeof anchorHost.readVerifiedAnchor==='function'&&
    typeof anchorHost.compareAndAdvance==='function'&&
    validScope(expected),'ANCHORED_ADMISSION_TRUSTED_HOST_REQUIRED');
  const scope=Object.freeze({
    sourceNamespace:expected.sourceNamespace,expansionId:expected.expansionId
  });
  // This read MUST independently authenticate and authorize the anchor.
  const anchored=verifiedAnchor(await anchorHost.readVerifiedAnchor(scope),scope);
  const priorHead=ledger.readHead(scope);
  const current=Object.freeze({
    ...scope,generation:priorHead.generation,
    headSha256:governanceDigest(priorHead)
  });
  need(safeEqual(anchored,current),
    'ANCHORED_ADMISSION_LEDGER_ANCHOR_DIVERGENCE');
  // This may durably change the ledger. Never release evidence yet.
  const accepted=await admitGovernedSignedWclCapture({
    signedBundle,registry,registrySha256,priorHead,
    commitHead:ledger.commitHead,expected,readCapture,nowMs,
    ...(maxCaptureBytes===undefined?{}:{maxCaptureBytes}),
    ...(maxTotalBytes===undefined?{}:{maxTotalBytes})
  });
  const next=Object.freeze({...scope,
    generation:accepted.nextHead.generation,
    headSha256:governanceDigest(accepted.nextHead)
  });
  let acknowledged;
  try{
    acknowledged=await anchorHost.compareAndAdvance({
      scope,previous:anchored,next
    });
  }catch{
    // Never leak captures or a promotable receipt on an anchor failure.
    throw Error('ANCHORED_ADMISSION_DB_COMMITTED_ANCHOR_UNCONFIRMED');
  }
  need(acknowledged?.committed===true&&
    validSha(acknowledged.headSha256)&&
    acknowledged.headSha256===next.headSha256&&
    acknowledged.generation===next.generation,
    'ANCHORED_ADMISSION_DB_COMMITTED_ANCHOR_UNCONFIRMED');
  // Confirmation must include a second independently authorized read-back.
  let saved;
  try{
    saved=verifiedAnchor(await anchorHost.readVerifiedAnchor(scope),scope);
  }catch{
    throw Error('ANCHORED_ADMISSION_DB_COMMITTED_ANCHOR_READBACK_FAILED');
  }
  need(safeEqual(saved,next),
    'ANCHORED_ADMISSION_DB_COMMITTED_ANCHOR_READBACK_FAILED');
  return Object.freeze({
    ...accepted,
    finalization:Object.freeze({
      schema:'WCL_CAPTURE_FINALIZATION_V1',
      status:'LEDGER_AND_INDEPENDENT_ANCHOR_CONFIRMED',
      sourceNamespace:scope.sourceNamespace,
      expansionId:scope.expansionId,
      generation:next.generation,headSha256:next.headSha256,
      upstreamAuthenticated:false
    })
  });
}
