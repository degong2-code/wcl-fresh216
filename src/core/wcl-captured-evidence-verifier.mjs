/**
 * OFFLINE verifier for independently pinned WCL + Blizzard/client captures.
 *
 * The trusted host must securely provision immutable captures and pins.
 * Neither untrusted manifest fields nor this code establish HTTP origin
 * authenticity. No HTTP, OAuth, filesystem, Secrets, or runtime activation.
 *
 * Supported now: Blizzard playable-specialization role; complete WCL zone
 * encounter-journal crosswalk to a WoW client EJ export for RAID only.
 * Encounter-specific difficulty/partition and NPC/BossDPS are NOT certified.
 */
import {canonicalCatalogJson} from './environment-discovery.mjs';

const need=(v,code)=>{if(!v)throw Error(code);};
const positive=n=>Number.isSafeInteger(n)&&n>0;
const nonnegative=n=>Number.isSafeInteger(n)&&n>=0;
const hash=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const text=s=>typeof s==='string'&&s.length>0&&s.length<=160;
const idKey=(...fields)=>JSON.stringify(fields);
const same=(a,b)=>a===b;
const possibleRole=Object.freeze({DAMAGE:'dps',TANK:'tank',HEALING:'healer'});

const copy=o=>JSON.parse(JSON.stringify(o));
const unique=(items,key,code)=>{
  need(Array.isArray(items),'CAPTURE_LIST_MISSING');
  const m=new Map();
  for(const item of items){
    const k=key(item);
    need(!m.has(k),code);
    m.set(k,item);
  }
  return m;
};
const validPin=p=>p&&text(p.sourceRef)&&text(p.sourceKind)&&
  hash(p.sourceSha256)&&text(p.originHost)&&text(p.endpoint)&&
  text(p.namespace)&&text(p.locale)&&nonnegative(p.capturedAtMs)&&
  positive(p.validUntilMs)&&p.validUntilMs>p.capturedAtMs;
const pinCopy=p=>({
  sourceRef:p.sourceRef,sourceKind:p.sourceKind,sourceSha256:p.sourceSha256,
  originHost:p.originHost,endpoint:p.endpoint,namespace:p.namespace,
  locale:p.locale,capturedAtMs:p.capturedAtMs,validUntilMs:p.validUntilMs
});
const safeParsed=bytes=>{
  let payload;
  try{
    payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  }catch{throw Error('CAPTURE_JSON_INVALID');}
  need(payload&&typeof payload==='object'&&!Array.isArray(payload),
    'CAPTURE_JSON_SHAPE_INVALID');
  return payload;
};
const checkDoc=d=>d&&typeof d==='object'&&!Array.isArray(d)&&
  !Array.isArray(d.errors)&&d.errors==null&&d.data&&typeof d.data==='object';

function validateWclCatalog(capture,pin,scope) {
  need(capture.schema==='WCL_CAPTURED_DIRECTORY_AND_ZONES_V1' &&
    capture.sourceNamespace===scope.sourceNamespace &&
    capture.expansionId===scope.expansionId &&
    checkDoc(capture.directory)&&checkDoc(capture.zones),
    'WCL_CAPTURE_SCOPE_OR_SCHEMA_DRIFT');
  const expansions=capture.directory.data.worldData?.expansions;
  const classes=capture.directory.data.gameData?.classes;
  const zones=capture.zones.data.worldData?.zones;
  need(Array.isArray(expansions)&&Array.isArray(classes)&&Array.isArray(zones) &&
    expansions.some(e=>e?.id===scope.expansionId),
    'WCL_CAPTURE_DIRECTORY_UNVERIFIED');
  unique(classes,c=>c?.id,'WCL_CAPTURE_CLASS_DUPLICATE');
  unique(zones,z=>z?.id,'WCL_CAPTURE_ZONE_DUPLICATE');
  for(const klass of classes){
    need(positive(klass?.id)&&text(klass.slug)&&Array.isArray(klass.specs),
      'WCL_CAPTURE_CLASS_INVALID');
    unique(klass.specs,s=>s?.id,'WCL_CAPTURE_SPEC_DUPLICATE');
  }
  for(const z of zones){
    need(positive(z?.id)&&text(z.name)&&Array.isArray(z.encounters),
      'WCL_CAPTURE_ZONE_INVALID');
    unique(z.encounters,e=>e?.id,'WCL_CAPTURE_ENCOUNTER_DUPLICATE');
    for(const e of z.encounters)
      need(positive(e?.id)&&text(e.name)&&positive(e.journalID),
        'WCL_CAPTURE_ENCOUNTER_INVALID');
  }
  return {classes,zones};
}
function verifySpecRole({claim,body,catalog,binding,sourcePin,wclPin}){
  if(!binding)return false;
  if(binding.wclClassId!==claim.wclClassId ||
    binding.wclSpecId!==claim.wclSpecId ||
    binding.blizzardSourceSha256!==sourcePin.sourceSha256 ||
    binding.wclSourceSha256!==wclPin.sourceSha256)
    return false;
  need(sourcePin.sourceKind==='BLIZZARD_PLAYABLE_SPECIALIZATION' &&
    /^(us|eu|kr|tw)\.api\.blizzard\.com$/.test(sourcePin.originHost) &&
    sourcePin.endpoint==='/data/wow/playable-specialization/'+binding.blizzardSpecId &&
    /^static-[a-zA-Z0-9_.-]+$/.test(sourcePin.namespace),
    'BLIZZARD_SPEC_ORIGIN_INVALID');
  const klass=catalog.classes.find(k=>k.id===claim.wclClassId);
  const spec=klass?.specs?.find(s=>s.id===claim.wclSpecId);
  if(!spec || klass.slug!==claim.wclClassSlug||
    spec.slug!==claim.wclSpecSlug)return false;
  if(body.id!==binding.blizzardSpecId||
    body.playable_class?.id!==binding.blizzardClassId ||
    !same(body.name,spec.name))return false;
  const role=possibleRole[body.role?.type];
  return role===claim.value;
}
function verifyRaidZone({claim,body,catalog,sourcePin,wclPin}){
  if(sourcePin.sourceKind!=='WOW_CLIENT_JOURNAL'||
    sourcePin.originHost!=='wow-client-export'||
    sourcePin.endpoint!=='EJ_GetInstanceByIndex+EJ_GetEncounterInfoByIndex'||
    sourcePin.namespace!==wclPin.namespace ||
    body.schema!=='WOW_CLIENT_EJ_EXPORT_V1'||
    !text(body.clientBuild)||body.locale!==sourcePin.locale||
    !Array.isArray(body.instances))return false;
  const z=catalog.zones.find(z=>z.id===claim.wclZoneId);
  if(!z || z.name!==claim.wclZoneName || z.encounters.length===0 ||
    claim.value!=='raid')return false;
  const index=new Map();
  const inst=unique(body.instances,i=>i?.journalInstanceID,
    'EJ_INSTANCE_DUPLICATE');
  for(const entry of inst.values()){
    need(positive(entry?.journalInstanceID)&&
      typeof entry.isRaid==='boolean'&&Array.isArray(entry.encounters),
      'EJ_INSTANCE_INVALID');
    unique(entry.encounters,e=>e?.journalEncounterID,
      'EJ_INSTANCE_ENCOUNTER_DUPLICATE');
    for(const e of entry.encounters){
      need(positive(e?.journalEncounterID),'EJ_ENCOUNTER_INVALID');
      need(!index.has(e.journalEncounterID),'EJ_ENCOUNTER_CROSS_INSTANCE_CONFLICT');
      index.set(e.journalEncounterID,entry);
    }
  }
  const matched=z.encounters.map(e=>index.get(e.journalID));
  return matched.every(Boolean)&&matched.every(i=>i===matched[0])&&
    matched[0].isRaid===true;
}
function normalizeBinding(b) {
  need(b&&positive(b.wclClassId)&&positive(b.wclSpecId)&&
    positive(b.blizzardClassId)&&positive(b.blizzardSpecId)&&
    hash(b.wclSourceSha256)&&hash(b.blizzardSourceSha256),
    'SPEC_CROSSWALK_INVALID');
  return {...b};
}

/**
 * Create a verifier compatible with buildEvidenceGatedWclPolicy.
 *
 * Pins and crosswalks are a SEPARATELY TRUSTED allowlist, not read from the
 * classification manifest. The host is responsible for source authentication.
 * readCapture(ref) returns exact previously captured UTF-8 bytes (Uint8Array).
 * Hashing is injected to avoid Node runtime coupling.
 */
export function createTrustedCapturedEvidenceVerifier({
  readCapture,sha256Bytes,sha256Text,wclPin,sourcePins,
  specCrosswalks=[],verifiedAtMs,maxCaptureBytes=500_000
}={}){
  need(typeof readCapture==='function'&&typeof sha256Bytes==='function'&&
    typeof sha256Text==='function'&&validPin(wclPin)&&
    wclPin.sourceKind==='WCL_CATALOG_BUNDLE'&&
    wclPin.originHost==='www.warcraftlogs.com'&&
    wclPin.endpoint==='/api/v2/client'&&
    Array.isArray(sourcePins)&&Array.isArray(specCrosswalks)&&
    sourcePins.length<=1024&&specCrosswalks.length<=1024&&
    nonnegative(verifiedAtMs)&&positive(maxCaptureBytes)&&
    maxCaptureBytes<=2_000_000,
    'CAPTURE_VERIFIER_CONFIG_INVALID');
  const wcl=pinCopy(wclPin);
  const sources=unique(sourcePins.map(p=>{
    need(validPin(p)&&p.sourceKind!=='WCL_CATALOG_BUNDLE',
      'CAPTURE_SOURCE_PIN_INVALID');return pinCopy(p);
  }),p=>p.sourceRef,'CAPTURE_SOURCE_PIN_DUPLICATE');
  const bindings=unique(specCrosswalks.map(normalizeBinding),
    b=>idKey(b.wclClassId,b.wclSpecId),'SPEC_CROSSWALK_DUPLICATE');
  // One Blizzard specialization may not be mapped to two WCL identities.
  unique([...bindings.values()],b=>idKey(b.blizzardClassId,b.blizzardSpecId),
    'SPEC_CROSSWALK_REVERSE_CONFLICT');
  async function readPinned(pin) {
    need(pin.capturedAtMs<=verifiedAtMs&&pin.validUntilMs>verifiedAtMs,
      'CAPTURE_PIN_EXPIRED_OR_FUTURE');
    const raw=await readCapture(pin.sourceRef);
    need(raw instanceof Uint8Array&&raw.byteLength>0&&
      raw.byteLength<=maxCaptureBytes,'CAPTURE_BYTES_UNAVAILABLE_OR_UNBOUNDED');
    const bytes=Uint8Array.from(raw);
    const digest=await sha256Bytes(bytes);
    need(hash(digest)&&digest===pin.sourceSha256,'CAPTURE_DIGEST_MISMATCH');
    return safeParsed(bytes);
  }
  return async function verifyEvidence({sourceKind,sourceRef,
    sourceSha256,claimSha256,claim,scope}={}){
    const unverified={status:'UNVERIFIED'};
    if(!scope||!positive(scope.expansionId)||
      scope.sourceNamespace!==wcl.namespace ||
      !hash(claimSha256)||!hash(sourceSha256)||
      !claim||!text(sourceRef)||!text(sourceKind))return unverified;
    const pin=sources.get(sourceRef);
    if(!pin || pin.sourceKind!==sourceKind ||
      pin.sourceSha256!==sourceSha256 ||
      pin.locale!==wcl.locale)return unverified;
    const calculated=await sha256Text(canonicalCatalogJson({scope,claim}));
    need(hash(calculated),'CAPTURE_CLAIM_DIGEST_INVALID');
    if(calculated!==claimSha256)return unverified;
    // No support for an encounter-specific BossDPS/difficulty inference:
    // those need a separate scoped WCL live evidence validator.
    if(!['SPEC_ROLE','ZONE_KIND'].includes(claim.kind))return unverified;
    if(claim.kind==='SPEC_ROLE' &&
      pin.sourceKind!=='BLIZZARD_PLAYABLE_SPECIALIZATION')return unverified;
    if(claim.kind==='ZONE_KIND' &&
      pin.sourceKind!=='WOW_CLIENT_JOURNAL')return unverified;
    const catalog=validateWclCatalog(await readPinned(wcl),wcl,scope);
    const body=await readPinned(pin);
    const valid=claim.kind==='SPEC_ROLE' ?
      verifySpecRole({claim,body,catalog,
        binding:bindings.get(idKey(claim.wclClassId,claim.wclSpecId)),
        sourcePin:pin,wclPin:wcl}) :
      verifyRaidZone({claim,body,catalog,sourcePin:pin,wclPin:wcl});
    if(!valid)return unverified;
    return {status:'VERIFIED',sourceSha256,claimSha256,verifiedAtMs};
  };
}
