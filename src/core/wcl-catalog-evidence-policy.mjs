/**
 * Evidence-gated WCL catalog policy bridge (OFFLINE, host-neutral).
 *
 * An owner-authored manifest/URL/hash is NOT proof. Every candidate requires
 * an injected trusted verifier to attest the exact source digest AND claim
 * binding. This module does not read HTTP, Secrets, Git, WCL or Blizzard.
 *
 * The output only classifies WCL zone kind, spec role, and encounter
 * difficulty/partition support. It does NOT certify NPC gameIDs/BossDPS.
 */
import {canonicalCatalogJson} from './environment-discovery.mjs';
import {createWclCatalogPort} from './wcl-catalog-port.mjs';
const issuedPolicies=new WeakSet();

const fail=code=>{throw new Error(code);};
const ok=(v,code)=>{if(!v)fail(code);};
const id=n=>Number.isSafeInteger(n)&&n>0;
const nonnegative=n=>Number.isSafeInteger(n)&&n>=0;
const sha=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const token=s=>typeof s==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9:._/-]{0,159}$/.test(s);
const name=s=>typeof s==='string'&&s.length>0&&s.length<=160&&s.trim()===s;
const cmp=(a,b)=>String(a).localeCompare(String(b),'en');
const own=(obj,field)=>Object.hasOwn(obj,field);
const sourceFor=Object.freeze({
  ZONE_KIND:['BLIZZARD_JOURNAL','WOW_CLIENT_JOURNAL'],
  SPEC_ROLE:['BLIZZARD_PLAYABLE_SPECIALIZATION','WOW_CLIENT_SPECIALIZATION'],
  ENCOUNTER_SUPPORT:['WCL_SCOPED_ENCOUNTER_EVIDENCE']
});
const allowedZone=new Set(['raid','dungeon','other']);
const allowedRole=new Set(['dps','tank','healer']);

function uniqueIds(arr,allowZero,error){
  ok(Array.isArray(arr)&&arr.length<=64,error);
  const out=arr.slice();
  ok(out.every(allowZero?nonnegative:id)&&new Set(out).size===out.length,error);
  return out.sort((a,b)=>a-b);
}
function normalizeClaim(c){
  ok(c&&typeof c==='object'&&!Array.isArray(c)&&
    own(sourceFor,c.kind),'POLICY_CLAIM_KIND_INVALID');
  const base={kind:c.kind};
  if(c.kind==='ZONE_KIND'){
    ok(id(c.wclZoneId)&&name(c.wclZoneName)&&allowedZone.has(c.value),
      'POLICY_ZONE_CLAIM_INVALID');
    return {...base,wclZoneId:c.wclZoneId,wclZoneName:c.wclZoneName,
      value:c.value};
  }
  if(c.kind==='SPEC_ROLE'){
    ok(id(c.wclClassId)&&token(c.wclClassSlug)&&id(c.wclSpecId)&&
      token(c.wclSpecSlug)&&allowedRole.has(c.value),
    'POLICY_SPEC_CLAIM_INVALID');
    return {...base,wclClassId:c.wclClassId,wclClassSlug:c.wclClassSlug,
      wclSpecId:c.wclSpecId,wclSpecSlug:c.wclSpecSlug,value:c.value};
  }
  ok(id(c.wclZoneId)&&name(c.wclZoneName)&&id(c.wclEncounterId)&&
    name(c.wclEncounterName)&&nonnegative(c.wclJournalId)&&
    c.value&&typeof c.value==='object','POLICY_ENCOUNTER_CLAIM_INVALID');
  return {...base,wclZoneId:c.wclZoneId,wclZoneName:c.wclZoneName,
    wclEncounterId:c.wclEncounterId,wclEncounterName:c.wclEncounterName,
    wclJournalId:c.wclJournalId,
    value:{
      difficulties:uniqueIds(c.value.difficulties,false,'POLICY_DIFFICULTIES_INVALID'),
      partitions:uniqueIds(c.value.partitions,true,'POLICY_PARTITIONS_INVALID')
    }};
}
function claimKey(c){
  if(c.kind==='ZONE_KIND')return 'zone:'+c.wclZoneId;
  if(c.kind==='SPEC_ROLE')return 'spec:'+c.wclClassId+':'+c.wclSpecId;
  return 'encounter:'+c.wclZoneId+':'+c.wclEncounterId;
}
function normalizedEvidence(e,kind,nowMs){
  ok(e&&typeof e==='object'&&sourceFor[kind].includes(e.sourceKind) &&
    token(e.sourceRef)&&sha(e.sourceSha256)&&
    nonnegative(e.capturedAtMs)&&id(e.validUntilMs) &&
    e.capturedAtMs<=nowMs&&e.validUntilMs>e.capturedAtMs,
    'POLICY_EVIDENCE_SHAPE_INVALID');
  return {sourceKind:e.sourceKind,sourceRef:e.sourceRef,
    sourceSha256:e.sourceSha256,capturedAtMs:e.capturedAtMs,
    validUntilMs:e.validUntilMs};
}

/**
 * @param manifest WCL_CLASSIFICATION_POLICY_V1 of candidate claims/witness
 *        digests (not an assertion of their authenticity).
 * @param verifyEvidence an owner-trusted, independently configured callback
 *        returning {status:'VERIFIED',sourceSha256,claimSha256,verifiedAtMs}
 *        ONLY after checking actual source bytes + exact WCL identity crosswalk.
 * @param sha256 host-injected cryptographic SHA-256 of canonical UTF-8 JSON.
 * @param nowMs time for expiry and freshness decisions.
 */
export async function buildEvidenceGatedWclPolicy({
  manifest,verifyEvidence,sha256,nowMs
}={}){
  ok(manifest?.schema==='WCL_CLASSIFICATION_POLICY_V1'&&
    id(manifest.expansionId)&&token(manifest.sourceNamespace)&&
    token(manifest.version)&&Array.isArray(manifest.records)&&
    manifest.records.length<=1024&&typeof verifyEvidence==='function'&&
    typeof sha256==='function'&&nonnegative(nowMs),
  'POLICY_CONFIG_INVALID');
  const records=[],keys=new Set();
  for(const r of manifest.records){
    const claim=normalizeClaim(r?.claim),key=claimKey(claim);
    ok(!keys.has(key),'POLICY_DUPLICATE_CLAIM');
    keys.add(key);
    const evidence=normalizedEvidence(r?.evidence,claim.kind,nowMs);
    records.push({key,claim,evidence});
  }
  records.sort((a,b)=>cmp(a.key,b.key));
  const scope={sourceNamespace:manifest.sourceNamespace,
    expansionId:manifest.expansionId};
  let expired=0,rejected=0,accepted=0;
  const active=[];
  // For a changed verifier result, the resulting fingerprint also changes.
  for(const r of records){
    if(r.evidence.validUntilMs<=nowMs){expired++;continue;}
    const claimSha256=await sha256(canonicalCatalogJson({
      scope,claim:r.claim}));
    ok(sha(claimSha256),'POLICY_CLAIM_HASH_INVALID');
    // Verifier MUST be trusted by the caller. Its response is not accepted
    // based on a manifest-provided Boolean or unverified source URL alone.
    const verdict=await verifyEvidence({
      sourceKind:r.evidence.sourceKind,sourceRef:r.evidence.sourceRef,
      sourceSha256:r.evidence.sourceSha256,claimSha256,
      claim:JSON.parse(JSON.stringify(r.claim)),scope:{...scope}
    });
    if(verdict?.status==='UNVERIFIED'){rejected++;continue;}
    ok(verdict?.status==='VERIFIED' &&
      verdict.sourceSha256===r.evidence.sourceSha256 &&
      verdict.claimSha256===claimSha256 &&
      nonnegative(verdict.verifiedAtMs)&&
      verdict.verifiedAtMs>=r.evidence.capturedAtMs &&
      verdict.verifiedAtMs<=nowMs,
      'POLICY_VERIFIER_ATTESTATION_INVALID');
    active.push({key:r.key,claim:r.claim,evidence:r.evidence,
      claimSha256});
    accepted++;
  }
  const fingerprint=await sha256(canonicalCatalogJson({
    schema:1,scope,manifestVersion:manifest.version,
    active:active.map(x=>({claim:x.claim,evidence:x.evidence,
      claimSha256:x.claimSha256}))
  }));
  ok(sha(fingerprint),'POLICY_FINGERPRINT_INVALID');
  const version='ev1-'+fingerprint.slice(0,48);
  const zones=new Map(),specs=new Map(),encounters=new Map();
  for(const r of active){
    const c=r.claim;
    if(c.kind==='ZONE_KIND')zones.set(c.wclZoneId,c);
    if(c.kind==='SPEC_ROLE')specs.set(c.wclClassId+':'+c.wclSpecId,c);
    if(c.kind==='ENCOUNTER_SUPPORT')
      encounters.set(c.wclZoneId+':'+c.wclEncounterId,c);
  }
  const matchesExpansion=expansion=>id(expansion?.id)&&
    expansion.id===manifest.expansionId;
  const classifyZone=(zone,expansion)=>{
    if(!matchesExpansion(expansion))return null;
    const c=zones.get(zone?.id);if(!c)return null;
    ok(zone.name===c.wclZoneName,'POLICY_ZONE_NAME_DRIFT');
    return c.value;
  };
  const classifySpec=(spec,klass)=>{
    const c=specs.get(klass?.id+':'+spec?.id);if(!c)return null;
    ok(klass.slug===c.wclClassSlug&&spec.slug===c.wclSpecSlug,
      'POLICY_SPEC_IDENTITY_DRIFT');
    return c.value;
  };
  const confirmEncounterSupport=(encounter,zone,expansion)=>{
    if(!matchesExpansion(expansion))return null;
    const c=encounters.get(zone?.id+':'+encounter?.id);if(!c)return null;
    ok(zone.name===c.wclZoneName&&
      encounter.name===c.wclEncounterName &&
      encounter.journalID===c.wclJournalId,
      'POLICY_ENCOUNTER_IDENTITY_DRIFT');
    return {difficulties:c.value.difficulties.slice(),
      partitions:c.value.partitions.slice()};
  };
  const diagnostics=Object.freeze({
    schema:1,sourceNamespace:manifest.sourceNamespace,
    expansionId:manifest.expansionId,manifestVersion:manifest.version,
    policyFingerprint:fingerprint,policyVersion:version,
    candidates:records.length,accepted,rejected,expired,
    npcRulesCertified:0,bossDpsPolicyCertified:false,
    trustedVerifierRequired:true
  });
  const policy=Object.freeze({
    policyVersion:version,classifyZone,classifySpec,
    confirmEncounterSupport,diagnostics
  });
  issuedPolicies.add(policy);
  return policy;
}

/**
 * Only binds policies created and attested in this process, with exact WCL
 * endpoint namespace + expansion ID. Fails closed before either query.
 */
export function bindEvidenceGatedWclCatalogPort({
  policy,sourceNamespace,expansionId,queryGraphql,...bounds
}={}){
  ok(policy&&issuedPolicies.has(policy)&&
    sourceNamespace===policy.diagnostics.sourceNamespace&&
    expansionId===policy.diagnostics.expansionId,
    'POLICY_CATALOG_SCOPE_MISMATCH');
  return createWclCatalogPort({
    ...bounds,sourceNamespace,expansionId,queryGraphql,
    policyVersion:policy.policyVersion,
    classifyZone:policy.classifyZone,classifySpec:policy.classifySpec,
    confirmEncounterSupport:policy.confirmEncounterSupport
  });
}
