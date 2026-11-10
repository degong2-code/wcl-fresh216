/**
 * Read-only policy + injected atomic ledger for signed WCL capture governance.
 *
 * Adapts the existing offline Ed25519 admission; does not acquire captures,
 * load secrets, manage signing keys, or persist a ledger itself.
 * A trusted host MUST pin the registry hash independently and implement
 * commitHead as durable compare-and-swap, NOT a simple write.
 */
import {createHash} from 'node:crypto';
import {canonicalCatalogJson} from '../core/environment-discovery.mjs';
import {admitSignedWclCapture} from './wcl-signed-capture-admission.mjs';

const fail=code=>{throw Error(code);};
const need=(v,code)=>{if(!v)fail(code);};
const positive=n=>Number.isSafeInteger(n)&&n>0;
const nonnegative=n=>Number.isSafeInteger(n)&&n>=0;
const sha=s=>typeof s==='string'&&/^[0-9a-f]{64}$/.test(s);
const token=s=>typeof s==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9:._/-]{0,159}$/.test(s);
const object=(v,required)=>{
  if(!v||typeof v!=='object'||Array.isArray(v))return false;
  const found=Object.keys(v);
  return required.length===found.length&&required.every(k=>Object.hasOwn(v,k));
};
const hashText=s=>createHash('sha256').update(s,'utf8').digest('hex');
export const governanceDigest=value=>hashText(canonicalCatalogJson(value));
const REGISTRY=['schema','sourceNamespace','revision','activeKeyId',
  'keys','revokedCaptureSetIds'];
const KEY=['keyId','publicKeyPem','status','validFromMs','validUntilMs',
  'allowedExpansionIds'];
const HEAD=['schema','sourceNamespace','expansionId','generation',
  'registryRevision','lastIssuedAtMs','lastCaptureSetId','lastPayloadSha256'];
const RECEIPT=['schema','registrySha256','registryRevision','ledgerHeadSha256',
  'captureSetId','signerId','issuedAtMs','sourceNamespace','expansionId',
  'commitStatus','upstreamAuthenticated'];

function checkRegistry({registry,registrySha256,expected,nowMs}){
  need(sha(registrySha256)&&governanceDigest(registry)===registrySha256,
    'GOVERNANCE_REGISTRY_DIGEST_MISMATCH');
  need(object(registry,REGISTRY)&&
    registry.schema==='WCL_CAPTURE_TRUST_REGISTRY_V1'&&
    registry.sourceNamespace===expected?.sourceNamespace&&
    positive(registry.revision)&&token(registry.activeKeyId)&&
    Array.isArray(registry.keys)&&registry.keys.length>0&&
    registry.keys.length<=32&&
    Array.isArray(registry.revokedCaptureSetIds)&&
    registry.revokedCaptureSetIds.length<=4096,
    'GOVERNANCE_REGISTRY_INVALID');
  const ids=new Set(),live=[];
  for(const k of registry.keys){
    need(object(k,KEY)&&token(k.keyId)&&
      typeof k.publicKeyPem==='string'&&k.publicKeyPem.length<=4096&&
      k.publicKeyPem.includes('BEGIN PUBLIC KEY')&&
      ['ACTIVE','RETIRED','REVOKED'].includes(k.status)&&
      nonnegative(k.validFromMs)&&positive(k.validUntilMs)&&
      k.validFromMs<k.validUntilMs&&Array.isArray(k.allowedExpansionIds)&&
      k.allowedExpansionIds.length>0&&k.allowedExpansionIds.length<=128&&
      k.allowedExpansionIds.every(positive)&&
      new Set(k.allowedExpansionIds).size===k.allowedExpansionIds.length&&
      !ids.has(k.keyId),'GOVERNANCE_KEY_INVALID');
    ids.add(k.keyId);if(k.status==='ACTIVE')live.push(k);
  }
  need(live.length===1&&live[0].keyId===registry.activeKeyId,
    'GOVERNANCE_ACTIVE_KEY_AMBIGUOUS');
  need(registry.revokedCaptureSetIds.every(token)&&
    new Set(registry.revokedCaptureSetIds).size===
      registry.revokedCaptureSetIds.length,
    'GOVERNANCE_REVOCATION_LIST_INVALID');
  const active=live[0];
  need(active.validFromMs<=nowMs&&nowMs<active.validUntilMs&&
    active.allowedExpansionIds.includes(expected.expansionId),
    'GOVERNANCE_ACTIVE_KEY_NOT_AUTHORIZED');
  return active;
}
function checkPriorHead(head,expected,registry){
  need(object(head,HEAD)&&
    head.schema==='WCL_CAPTURE_GOVERNANCE_HEAD_V1'&&
    head.sourceNamespace===expected.sourceNamespace&&
    head.expansionId===expected.expansionId&&
    nonnegative(head.generation)&&nonnegative(head.registryRevision)&&
    head.registryRevision<=registry.revision&&
    nonnegative(head.lastIssuedAtMs)&&
    ((head.generation===0&&head.registryRevision===0&&
      head.lastIssuedAtMs===0&&head.lastCaptureSetId===null&&
      head.lastPayloadSha256===null)||
     (head.generation>0&&token(head.lastCaptureSetId)&&
      sha(head.lastPayloadSha256))),
    'GOVERNANCE_LEDGER_HEAD_INVALID');
}
/**
 * @param registry trusted, independently SHA-pinned registry of exactly one
 * ACTIVE signer plus zero or more RETIRED/REVOKED signers.
 * @param priorHead trusted durable ledger snapshot for this exact scope.
 * @param commitHead host-owned atomic CAS: ({expectedHeadSha256,nextHead,
 *   nextHeadSha256}) => {committed:true,headSha256:nextHeadSha256}
 *
 * CAS must atomically reject stale expectedHeadSha256; without it this module
 * CANNOT guarantee replay prevention under concurrent processes.
 */
export async function admitGovernedSignedWclCapture({
  signedBundle,registry,registrySha256,priorHead,commitHead,
  expected,readCapture,nowMs,maxCaptureBytes,maxTotalBytes
}={}){
  need(object(expected,['sourceNamespace','expansionId','locale'])&&
    token(expected.sourceNamespace)&&positive(expected.expansionId)&&
    token(expected.locale)&&nonnegative(nowMs)&&
    typeof commitHead==='function',
    'GOVERNANCE_INPUT_INVALID');
  const key=checkRegistry({registry,registrySha256,expected,nowMs});
  checkPriorHead(priorHead,expected,registry);
  const incoming=signedBundle?.payload,signature=signedBundle?.signature;
  need(signedBundle?.schema==='WCL_SIGNED_CAPTURE_V1'&&
    signature?.keyId===key.keyId&&
    incoming?.sourceNamespace===expected.sourceNamespace&&
    incoming?.expansionId===expected.expansionId&&
    token(incoming?.captureSetId)&&
    nonnegative(incoming?.issuedAtMs)&&
    incoming.issuedAtMs>priorHead.lastIssuedAtMs&&
    incoming.captureSetId!==priorHead.lastCaptureSetId&&
    !registry.revokedCaptureSetIds.includes(incoming.captureSetId),
    'GOVERNANCE_REPLAY_REVOKED_OR_SIGNER_INVALID');
  // Verify signer and every raw capture before attempting the ledger advance.
  const trustedSigner={
    keyId:key.keyId,publicKeyPem:key.publicKeyPem,
    sourceNamespace:registry.sourceNamespace,
    allowedExpansionIds:key.allowedExpansionIds,
    validFromMs:key.validFromMs,validUntilMs:key.validUntilMs
  };
  const admitted=await admitSignedWclCapture({
    signedBundle,trustedSigner,expected,readCapture,nowMs,
    ...(maxCaptureBytes===undefined?{}:{maxCaptureBytes}),
    ...(maxTotalBytes===undefined?{}:{maxTotalBytes})
  });
  const priorDigest=governanceDigest(priorHead);
  const nextHead=Object.freeze({
    schema:'WCL_CAPTURE_GOVERNANCE_HEAD_V1',
    sourceNamespace:expected.sourceNamespace,expansionId:expected.expansionId,
    generation:priorHead.generation+1,registryRevision:registry.revision,
    lastIssuedAtMs:incoming.issuedAtMs,
    lastCaptureSetId:incoming.captureSetId,
    lastPayloadSha256:admitted.receipt.signedPayloadSha256
  });
  const nextDigest=governanceDigest(nextHead);
  // This is the only side effect and MUST be implemented as trusted durable CAS.
  // A failed/missing/ambiguous acknowledgement cannot authorize the capture.
  const committed=await commitHead({
    expectedHeadSha256:priorDigest,nextHead,nextHeadSha256:nextDigest
  });
  need(committed?.committed===true&&
    committed.headSha256===nextDigest,
    'GOVERNANCE_ATOMIC_LEDGER_COMMIT_UNCONFIRMED');
  const governanceReceipt=Object.freeze({
    schema:'WCL_CAPTURE_GOVERNANCE_RECEIPT_V1',
    registrySha256,registryRevision:registry.revision,
    ledgerHeadSha256:nextDigest,
    captureSetId:incoming.captureSetId,signerId:key.keyId,
    issuedAtMs:incoming.issuedAtMs,
    sourceNamespace:expected.sourceNamespace,
    expansionId:expected.expansionId,
    commitStatus:'CONFIRMED_BY_TRUSTED_HOST_CAS',
    upstreamAuthenticated:false
  });
  return Object.freeze({...admitted,governanceReceipt,nextHead});
}

/**
 * Reassess a previous receipt against the CURRENT separately pinned registry.
 * A retired/revoked signing key or revoked set invalidates old admissions for
 * future use; it never deletes their audit history or restores source trust.
 */
export function isGovernedCaptureCurrentlyTrusted({
  governanceReceipt,registry,registrySha256,expected,nowMs
}={}){
  const key=checkRegistry({registry,registrySha256,expected,nowMs});
  need(object(governanceReceipt,RECEIPT)&&
    governanceReceipt.schema==='WCL_CAPTURE_GOVERNANCE_RECEIPT_V1',
    'GOVERNANCE_RECEIPT_INVALID');
  return governanceReceipt.registryRevision<=registry.revision&&
    governanceReceipt.sourceNamespace===expected.sourceNamespace&&
    governanceReceipt.expansionId===expected.expansionId&&
    governanceReceipt.signerId===key.keyId&&
    !registry.revokedCaptureSetIds.includes(governanceReceipt.captureSetId)&&
    governanceReceipt.commitStatus==='CONFIRMED_BY_TRUSTED_HOST_CAS'&&
    governanceReceipt.upstreamAuthenticated===false;
}

export function makeGenesisCaptureHead({sourceNamespace,expansionId}={}){
  need(token(sourceNamespace)&&positive(expansionId),'GOVERNANCE_GENESIS_SCOPE_INVALID');
  return Object.freeze({
    schema:'WCL_CAPTURE_GOVERNANCE_HEAD_V1',
    sourceNamespace,expansionId,generation:0,registryRevision:0,
    lastIssuedAtMs:0,lastCaptureSetId:null,lastPayloadSha256:null
  });
}
