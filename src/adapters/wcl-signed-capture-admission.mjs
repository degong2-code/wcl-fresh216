/**
 * Offline, operator-signed capture admission for the V2 WCL evidence pipeline.
 *
 * This adapter verifies that a bundle was approved by an independently pinned
 * Ed25519 signer and that every capture's bytes match the signed digest.
 * It does NOT verify that Blizzard/WCL actually served those bytes: only the
 * trusted capture operator can establish upstream provenance separately.
 *
 * No fs, HTTP, OAuth, secrets, Git writes, collector, or background execution.
 */
import {createHash,createPublicKey,verify as verifySignature} from 'node:crypto';
import {canonicalCatalogJson} from '../core/environment-discovery.mjs';

const fail=code=>{throw new Error(code);};
const requireIt=(v,code)=>{if(!v)fail(code);};
const positive=n=>Number.isSafeInteger(n)&&n>0;
const nonnegative=n=>Number.isSafeInteger(n)&&n>=0;
const digest=s=>typeof s==='string'&&/^[0-9a-f]{64}$/.test(s);
const identifier=s=>typeof s==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9:._/-]{0,159}$/.test(s);
const str=s=>typeof s==='string'&&s.length>0&&s.length<=200;
const hasExactly=(obj,required,optional=[])=>{
  if(!obj||typeof obj!=='object'||Array.isArray(obj))return false;
  const keys=Object.keys(obj),accepted=[...required,...optional];
  return required.every(x=>Object.hasOwn(obj,x))&&keys.every(x=>accepted.includes(x));
};
const hashBytes=b=>createHash('sha256').update(b).digest('hex');
const hex=s=>Buffer.from(s,'utf8');
const exactBase64=s=>{
  requireIt(typeof s==='string'&&/^[A-Za-z0-9+/]+={0,2}$/.test(s) &&
    s.length<=100,'SIGNED_CAPTURE_SIGNATURE_INVALID');
  const raw=Buffer.from(s,'base64');
  requireIt(raw.length===64&&raw.toString('base64')===s,
    'SIGNED_CAPTURE_SIGNATURE_INVALID');
  return raw;
};
const PIN_FIELDS=['sourceRef','sourceKind','sourceSha256','originHost',
  'endpoint','namespace','locale','capturedAtMs','validUntilMs'];
const allowedPinExtras=['clientBuild'];
const BINDING_FIELDS=['wclClassId','wclSpecId','blizzardClassId','blizzardSpecId',
  'wclSourceSha256','blizzardSourceSha256'];
const maxPinCount=128;

function validatePin(pin,{expected,nowMs,wcl=false}){
  requireIt(hasExactly(pin,PIN_FIELDS,allowedPinExtras)&&
    identifier(pin.sourceRef)&&identifier(pin.sourceKind)&&
    digest(pin.sourceSha256)&&str(pin.originHost)&&str(pin.endpoint)&&
    identifier(pin.namespace)&&identifier(pin.locale)&&
    nonnegative(pin.capturedAtMs)&&positive(pin.validUntilMs)&&
    pin.capturedAtMs<=nowMs&&pin.validUntilMs>nowMs&&
    pin.validUntilMs>pin.capturedAtMs&&pin.locale===expected.locale,
    'SIGNED_CAPTURE_PIN_INVALID');
  if(wcl){
    requireIt(pin.sourceKind==='WCL_CATALOG_BUNDLE'&&
      pin.originHost==='www.warcraftlogs.com'&&
      pin.endpoint==='/api/v2/client'&&
      pin.namespace===expected.sourceNamespace&&
      !Object.hasOwn(pin,'clientBuild'),'SIGNED_CAPTURE_WCL_PIN_INVALID');
  }else if(pin.sourceKind==='BLIZZARD_PLAYABLE_SPECIALIZATION'){
    const m=/^(us|eu|kr|tw)\.api\.blizzard\.com$/.exec(pin.originHost);
    requireIt(m && /^\/data\/wow\/playable-specialization\/[1-9][0-9]*$/.test(pin.endpoint) &&
      pin.namespace==='static-'+m[1]&&!Object.hasOwn(pin,'clientBuild'),
      'SIGNED_CAPTURE_BLIZZARD_PIN_INVALID');
  }else if(pin.sourceKind==='WOW_CLIENT_JOURNAL'){
    requireIt(pin.originHost==='wow-client-export'&&
      pin.endpoint==='EJ_GetInstanceByIndex+EJ_GetEncounterInfoByIndex'&&
      pin.namespace===expected.sourceNamespace&&
      Object.hasOwn(pin,'clientBuild')&&str(pin.clientBuild),
      'SIGNED_CAPTURE_JOURNAL_PIN_INVALID');
  }else fail('SIGNED_CAPTURE_UNSUPPORTED_SOURCE_KIND');
  return pin;
}
function validateBindings(bindings,wclPin,sourcePins){
  requireIt(Array.isArray(bindings)&&bindings.length<=maxPinCount,
    'SIGNED_CAPTURE_BINDINGS_INVALID');
  const wclKeys=new Set(),blizzardKeys=new Set();
  return bindings.map(b=>{
    requireIt(hasExactly(b,BINDING_FIELDS)&&
      positive(b.wclClassId)&&positive(b.wclSpecId)&&
      positive(b.blizzardClassId)&&positive(b.blizzardSpecId)&&
      digest(b.wclSourceSha256)&&digest(b.blizzardSourceSha256)&&
      b.wclSourceSha256===wclPin.sourceSha256,
      'SIGNED_CAPTURE_BINDING_INVALID');
    const a=b.wclClassId+':'+b.wclSpecId;
    const z=b.blizzardClassId+':'+b.blizzardSpecId;
    requireIt(!wclKeys.has(a)&&!blizzardKeys.has(z),
      'SIGNED_CAPTURE_BINDING_DUPLICATE_OR_REVERSE_CONFLICT');
    wclKeys.add(a);blizzardKeys.add(z);
    requireIt(sourcePins.some(p=>p.sourceKind==='BLIZZARD_PLAYABLE_SPECIALIZATION'&&
      p.sourceSha256===b.blizzardSourceSha256&&
      p.endpoint==='/data/wow/playable-specialization/'+b.blizzardSpecId),
      'SIGNED_CAPTURE_BINDING_UNPINNED');
    return {...b};
  });
}

/**
 * @param signedBundle {schema:'WCL_SIGNED_CAPTURE_V1',payload,signature}
 * @param trustedSigner out-of-band {keyId,publicKeyPem,sourceNamespace,
 *   allowedExpansionIds,validFromMs,validUntilMs}
 * @param expected out-of-band {sourceNamespace,expansionId,locale}
 * @param readCapture async(ref)->Uint8Array of independently acquired bytes
 * @param nowMs trusted host evaluation clock
 * @returns immutable admission receipt and cached read-only witness ports for
 *   createTrustedCapturedEvidenceVerifier. Never returns a network transport.
 */
export async function admitSignedWclCapture({
  signedBundle,trustedSigner,expected,readCapture,nowMs,
  maxCaptureBytes=500_000,maxTotalBytes=3_000_000
}={}){
  requireIt(hasExactly(signedBundle,['schema','payload','signature'])&&
    signedBundle.schema==='WCL_SIGNED_CAPTURE_V1'&&
    hasExactly(expected,['sourceNamespace','expansionId','locale'])&&
    identifier(expected.sourceNamespace)&&positive(expected.expansionId)&&
    identifier(expected.locale)&&nonnegative(nowMs)&&
    typeof readCapture==='function'&&
    positive(maxCaptureBytes)&&maxCaptureBytes<=2_000_000&&
    positive(maxTotalBytes)&&maxTotalBytes<=8_000_000&&
    maxTotalBytes>=maxCaptureBytes,'SIGNED_CAPTURE_INPUT_INVALID');
  requireIt(hasExactly(trustedSigner,['keyId','publicKeyPem','sourceNamespace',
    'allowedExpansionIds','validFromMs','validUntilMs'])&&
    identifier(trustedSigner.keyId)&&str(trustedSigner.publicKeyPem)&&
    trustedSigner.publicKeyPem.includes('BEGIN PUBLIC KEY')&&
    trustedSigner.sourceNamespace===expected.sourceNamespace&&
    Array.isArray(trustedSigner.allowedExpansionIds)&&
    trustedSigner.allowedExpansionIds.length<=100&&
    trustedSigner.allowedExpansionIds.every(positive)&&
    trustedSigner.allowedExpansionIds.includes(expected.expansionId)&&
    nonnegative(trustedSigner.validFromMs)&&
    positive(trustedSigner.validUntilMs)&&
    trustedSigner.validFromMs<=nowMs&&nowMs<trustedSigner.validUntilMs,
    'SIGNED_CAPTURE_TRUST_ROOT_INVALID');

  const payload=signedBundle.payload,signature=signedBundle.signature;
  requireIt(hasExactly(payload,['schema','captureSetId','sourceNamespace',
    'expansionId','locale','issuedAtMs','expiresAtMs','wclPin','sourcePins',
    'specCrosswalks'])&&payload.schema==='WCL_CAPTURE_SET_V1'&&
    identifier(payload.captureSetId)&&
    payload.sourceNamespace===expected.sourceNamespace&&
    payload.expansionId===expected.expansionId&&
    payload.locale===expected.locale&&
    nonnegative(payload.issuedAtMs)&&positive(payload.expiresAtMs)&&
    trustedSigner.validFromMs<=payload.issuedAtMs&&
    payload.issuedAtMs<=nowMs&&nowMs<payload.expiresAtMs&&
    payload.expiresAtMs<=trustedSigner.validUntilMs&&
    Array.isArray(payload.sourcePins)&&payload.sourcePins.length<=maxPinCount,
    'SIGNED_CAPTURE_PAYLOAD_SCOPE_OR_TIME_INVALID');
  requireIt(hasExactly(signature,['alg','keyId','valueBase64'])&&
    signature.alg==='Ed25519'&&signature.keyId===trustedSigner.keyId,
    'SIGNED_CAPTURE_SIGNER_MISMATCH');

  // Domain-separated, length-limited exact signed payload. No key supplied
  // inside this bundle can influence the trusted signing key selection.
  const canonical=canonicalCatalogJson(payload);
  requireIt(Buffer.byteLength(canonical,'utf8')<=100_000,
    'SIGNED_CAPTURE_ENVELOPE_TOO_LARGE');
  const signedMessage=hex('WCL_CAPTURE_SET_V1\n'+canonical);
  const key=createPublicKey(trustedSigner.publicKeyPem);
  requireIt(key.type==='public'&&key.asymmetricKeyType==='ed25519',
    'SIGNED_CAPTURE_KEY_TYPE_INVALID');
  requireIt(verifySignature(null,signedMessage,key,
    exactBase64(signature.valueBase64)),'SIGNED_CAPTURE_SIGNATURE_UNTRUSTED');

  // All signed metadata must be checked before reading a single capture.
  validatePin(payload.wclPin,{expected,nowMs,wcl:true});
  const seen=new Set([payload.wclPin.sourceRef]);
  const sources=payload.sourcePins.map(pin=>{
    validatePin(pin,{expected,nowMs});
    requireIt(!seen.has(pin.sourceRef),'SIGNED_CAPTURE_SOURCE_REF_DUPLICATE');
    seen.add(pin.sourceRef);
    return {...pin};
  });
  const bindings=validateBindings(payload.specCrosswalks,payload.wclPin,sources);
  const all=[payload.wclPin,...sources];
  const captures=new Map();
  let total=0;
  for(const pin of all){
    const incoming=await readCapture(pin.sourceRef);
    requireIt(incoming instanceof Uint8Array&&incoming.byteLength>0&&
      incoming.byteLength<=maxCaptureBytes,
      'SIGNED_CAPTURE_BYTES_UNAVAILABLE_OR_UNBOUNDED');
    const bytes=Buffer.from(incoming); // snapshot, not the caller's mutable array
    total+=bytes.byteLength;
    requireIt(total<=maxTotalBytes,'SIGNED_CAPTURE_TOTAL_BYTES_EXCEEDED');
    requireIt(hashBytes(bytes)===pin.sourceSha256,
      'SIGNED_CAPTURE_BYTES_DIGEST_MISMATCH');
    captures.set(pin.sourceRef,bytes);
  }
  const receipt=Object.freeze({
    schema:'WCL_CAPTURE_ADMISSION_RECEIPT_V1',
    captureSetId:payload.captureSetId,
    signerId:signature.keyId,sourceNamespace:expected.sourceNamespace,
    expansionId:expected.expansionId,locale:expected.locale,
    catalogHash:payload.wclPin.sourceSha256,
    signedPayloadSha256:hashBytes(Buffer.from(canonical,'utf8')),
    captureCount:all.length,totalBytes:total,verifiedAtMs:nowMs,
    provenance:'OPERATOR_SIGNED_ONLY_NOT_UPSTREAM_AUTHENTICATED',
    upstreamAuthenticated:false,npcCertified:false,bossDpsCertified:false
  });
  const ready=Object.freeze({
    wclPin:Object.freeze({...payload.wclPin}),
    sourcePins:Object.freeze(sources.map(x=>Object.freeze({...x}))),
    specCrosswalks:Object.freeze(bindings.map(x=>Object.freeze({...x}))),
    verifiedAtMs:nowMs,receipt,
    // Return a fresh byte copy each time so a downstream mutation cannot
    // poison the retained admitted evidence.
    readCapture:async ref=>{
      requireIt(captures.has(ref),'SIGNED_CAPTURE_REF_NOT_ADMITTED');
      return Uint8Array.from(captures.get(ref));
    },
    sha256Bytes:async bytes=>hashBytes(bytes),
    sha256Text:async value=>hashBytes(Buffer.from(value,'utf8'))
  });
  return ready;
}
