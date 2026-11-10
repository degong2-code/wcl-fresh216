import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {admitSignedWclCapture}
  from '../src/adapters/wcl-signed-capture-admission.mjs';
import {canonicalCatalogJson}
  from '../src/core/environment-discovery.mjs';
import {createTrustedCapturedEvidenceVerifier}
  from '../src/core/wcl-captured-evidence-verifier.mjs';
import {buildEvidenceGatedWclPolicy}
  from '../src/core/wcl-catalog-evidence-policy.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const encode=data=>new TextEncoder().encode(JSON.stringify(data));
const wclData=()=>({
  schema:'WCL_CAPTURED_DIRECTORY_AND_ZONES_V1',
  sourceNamespace:'synthetic-retail',expansionId:99,
  directory:{data:{
    worldData:{expansions:[{id:99,name:'Synthetic Future Expansion'}]},
    gameData:{classes:[{id:8,name:'Mage',slug:'mage',
      specs:[{id:3,name:'Fire',slug:'fire'}]}]}
  }},
  zones:{data:{worldData:{zones:[{
    id:901,name:'Synthetic Raid',
    encounters:[{id:10001,name:'Boss One',journalID:300},
      {id:10002,name:'Boss Two',journalID:301}]
  }]}}}
});
const specData=()=>({
  id:63,name:'Fire',playable_class:{id:8},role:{type:'DAMAGE'}
});
const journalData=()=>({
  schema:'WOW_CLIENT_EJ_EXPORT_V1',clientBuild:'12.0.1',locale:'en_US',
  instances:[{journalInstanceID:555,isRaid:true,
    encounters:[{journalEncounterID:300},{journalEncounterID:301}]}]
});
function fixture(){
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  const other=generateKeyPairSync('ed25519');
  const expected={sourceNamespace:'synthetic-retail',expansionId:99,locale:'en_US'};
  const captures=new Map();
  function pin(ref,data,sourceKind,host,endpoint,namespace,extra={}){
    const bytes=encode(data);captures.set(ref,bytes);
    return {sourceRef:ref,sourceKind,sourceSha256:hash(bytes),
      originHost:host,endpoint,namespace,locale:expected.locale,
      capturedAtMs:10,validUntilMs:500,...extra};
  }
  const wcl=pin('capture:wcl',wclData(),'WCL_CATALOG_BUNDLE',
    'www.warcraftlogs.com','/api/v2/client','synthetic-retail');
  const spec=pin('capture:spec',specData(),'BLIZZARD_PLAYABLE_SPECIALIZATION',
    'us.api.blizzard.com','/data/wow/playable-specialization/63','static-us');
  const journal=pin('capture:journal',journalData(),'WOW_CLIENT_JOURNAL',
    'wow-client-export','EJ_GetInstanceByIndex+EJ_GetEncounterInfoByIndex',
    'synthetic-retail',{clientBuild:'12.0.1'});
  const payload={
    schema:'WCL_CAPTURE_SET_V1',captureSetId:'demo-99',
    sourceNamespace:expected.sourceNamespace,expansionId:expected.expansionId,
    locale:expected.locale,issuedAtMs:50,expiresAtMs:400,wclPin:wcl,
    sourcePins:[spec,journal],
    specCrosswalks:[{wclClassId:8,wclSpecId:3,
      blizzardClassId:8,blizzardSpecId:63,
      wclSourceSha256:wcl.sourceSha256,blizzardSourceSha256:spec.sourceSha256}]
  };
  const trustedSigner={
    keyId:'local-fixture-trust-root',
    publicKeyPem:publicKey.export({type:'spki',format:'pem'}),
    sourceNamespace:expected.sourceNamespace,
    allowedExpansionIds:[99],validFromMs:0,validUntilMs:1000
  };
  function signBundle(changed=payload){
    const canonical=canonicalCatalogJson(changed);
    const message=Buffer.from('WCL_CAPTURE_SET_V1\n'+canonical,'utf8');
    return {
      schema:'WCL_SIGNED_CAPTURE_V1',
      payload:changed,
      signature:{
        alg:'Ed25519',keyId:trustedSigner.keyId,
        valueBase64:sign(null,message,privateKey).toString('base64')
      }
    };
  }
  let readCount=0;
  async function readCapture(ref){
    readCount++;
    const item=captures.get(ref);
    return item?Uint8Array.from(item):null;
  }
  const admission=(change={})=>admitSignedWclCapture({
    signedBundle:signBundle(),trustedSigner,expected,readCapture,nowMs:100,...change
  });
  return {privateKey,publicKey,other,expected,captures,payload,wcl,spec,
    journal,trustedSigner,signBundle,admission,readCapture,
    getReadCount:()=>readCount};
}
const manifestFor=f=>({
  schema:'WCL_CLASSIFICATION_POLICY_V1',
  sourceNamespace:'synthetic-retail',expansionId:99,version:'fixture-v1',
  records:[
    {claim:{kind:'SPEC_ROLE',wclClassId:8,wclClassSlug:'mage',
      wclSpecId:3,wclSpecSlug:'fire',value:'dps'},
     evidence:{sourceKind:f.spec.sourceKind,
       sourceRef:f.spec.sourceRef,sourceSha256:f.spec.sourceSha256,
       capturedAtMs:10,validUntilMs:500}},
    {claim:{kind:'ZONE_KIND',wclZoneId:901,wclZoneName:'Synthetic Raid',value:'raid'},
     evidence:{sourceKind:f.journal.sourceKind,
       sourceRef:f.journal.sourceRef,sourceSha256:f.journal.sourceSha256,
       capturedAtMs:10,validUntilMs:500}},
    {claim:{kind:'ENCOUNTER_SUPPORT',wclZoneId:901,
      wclZoneName:'Synthetic Raid',wclEncounterId:10001,
      wclEncounterName:'Boss One',wclJournalId:300,
      value:{difficulties:[4],partitions:[0]}},
     evidence:{sourceKind:'WCL_SCOPED_ENCOUNTER_EVIDENCE',
       sourceRef:'capture:unavailable',sourceSha256:'e'.repeat(64),
       capturedAtMs:10,validUntilMs:500}}
  ]
});

test('independently anchored Ed25519 signer admits only exact signed capture bytes',async()=>{
  const f=fixture(),ready=await f.admission();
  assert.equal(ready.receipt.captureSetId,'demo-99');
  assert.equal(ready.receipt.captureCount,3);
  assert.equal(ready.receipt.signerId,'local-fixture-trust-root');
  assert.equal(ready.receipt.catalogHash,f.wcl.sourceSha256);
  assert.equal(ready.receipt.provenance,'OPERATOR_SIGNED_ONLY_NOT_UPSTREAM_AUTHENTICATED');
  assert.equal(ready.receipt.upstreamAuthenticated,false);
  assert.equal(ready.receipt.bossDpsCertified,false);
  assert.equal(f.getReadCount(),3);
  assert.deepEqual(await ready.readCapture('capture:wcl'),
    f.captures.get('capture:wcl'));
  await assert.rejects(()=>ready.readCapture('capture:unavailable'),
    /SIGNED_CAPTURE_REF_NOT_ADMITTED/);
});

test('admitted immutable snapshot passes existing role and raid verifier, not Encounter support',async()=>{
  const f=fixture(),ready=await f.admission();
  const verifyEvidence=createTrustedCapturedEvidenceVerifier(ready);
  const policy=await buildEvidenceGatedWclPolicy({
    manifest:manifestFor(f),verifyEvidence,sha256:async s=>hash(Buffer.from(s)),
    nowMs:100
  });
  assert.equal(policy.diagnostics.candidates,3);
  assert.equal(policy.diagnostics.accepted,2);
  assert.equal(policy.diagnostics.rejected,1);
  assert.equal(policy.classifySpec({id:3,slug:'fire'},{id:8,slug:'mage'}),'dps');
  assert.equal(policy.classifyZone({id:901,name:'Synthetic Raid'},{id:99}),'raid');
  assert.equal(policy.confirmEncounterSupport({
    id:10001,name:'Boss One',journalID:300
  },{id:901,name:'Synthetic Raid'},{id:99}),null);
  assert.equal(policy.diagnostics.npcRulesCertified,0);
});

test('a different public key, spoofed key ID or mutated payload fails before reading source bytes',async()=>{
  const f=fixture();
  await assert.rejects(()=>f.admission({trustedSigner:{
    ...f.trustedSigner,publicKeyPem:f.other.publicKey.export({type:'spki',format:'pem'})
  }}),/SIGNED_CAPTURE_SIGNATURE_UNTRUSTED/);
  const wrongKey=f.signBundle();wrongKey.signature.keyId='untrusted';
  await assert.rejects(()=>f.admission({signedBundle:wrongKey}),
    /SIGNED_CAPTURE_SIGNER_MISMATCH/);
  const drift=f.signBundle();drift.payload.captureSetId='altered-without-resigning';
  await assert.rejects(()=>f.admission({signedBundle:drift}),
    /SIGNED_CAPTURE_SIGNATURE_UNTRUSTED/);
  assert.equal(f.getReadCount(),0);
});

test('a public key included in signed payload is not an alternative trust root',async()=>{
  const f=fixture(),payload=structuredClone(f.payload);
  payload.publicKeyPem=f.other.publicKey.export({type:'spki',format:'pem'});
  await assert.rejects(()=>f.admission({signedBundle:f.signBundle(payload)}),
    /SIGNED_CAPTURE_PAYLOAD_SCOPE_OR_TIME_INVALID/);
  assert.equal(f.getReadCount(),0);
});

test('signed scope, locale, expansion, signer lifetime and capture-set expiry fail closed',async()=>{
  const f=fixture();
  await assert.rejects(()=>f.admission({expected:{
    sourceNamespace:'classic',expansionId:99,locale:'en_US'}}),
    /SIGNED_CAPTURE_TRUST_ROOT_INVALID/);
  await assert.rejects(()=>f.admission({expected:{
    sourceNamespace:'synthetic-retail',expansionId:100,locale:'en_US'}}),
    /SIGNED_CAPTURE_TRUST_ROOT_INVALID/);
  await assert.rejects(()=>f.admission({expected:{
    sourceNamespace:'synthetic-retail',expansionId:99,locale:'de_DE'}}),
    /SIGNED_CAPTURE_PAYLOAD_SCOPE_OR_TIME_INVALID/);
  await assert.rejects(()=>f.admission({nowMs:401}),
    /SIGNED_CAPTURE_PAYLOAD_SCOPE_OR_TIME_INVALID/);
  await assert.rejects(()=>f.admission({trustedSigner:{
    ...f.trustedSigner,validUntilMs:100
  }}),/SIGNED_CAPTURE_TRUST_ROOT_INVALID/);
  assert.equal(f.getReadCount(),0);
});

test('missing/changed capture bytes never yield a partial admission receipt',async()=>{
  const f=fixture();
  f.captures.set(f.spec.sourceRef,encode({id:63,role:{type:'HEALING'}}));
  await assert.rejects(()=>f.admission(),/SIGNED_CAPTURE_BYTES_DIGEST_MISMATCH/);
  const g=fixture();g.captures.delete(g.journal.sourceRef);
  await assert.rejects(()=>g.admission(),
    /SIGNED_CAPTURE_BYTES_UNAVAILABLE_OR_UNBOUNDED/);
});

test('snapshot is isolated from later caller storage mutation and bytes returned to consumer',async()=>{
  const f=fixture(),ready=await f.admission();
  const before=await ready.readCapture(f.spec.sourceRef);
  f.captures.set(f.spec.sourceRef,encode({role:{type:'HEALING'}}));
  const fetched=await ready.readCapture(f.spec.sourceRef);
  fetched.fill(0);
  assert.deepEqual(await ready.readCapture(f.spec.sourceRef),before);
  const p=await buildEvidenceGatedWclPolicy({
    manifest:manifestFor(f),
    verifyEvidence:createTrustedCapturedEvidenceVerifier(ready),
    sha256:s=>hash(Buffer.from(s)),nowMs:100});
  assert.equal(p.classifySpec({id:3,slug:'fire'},{id:8,slug:'mage'}),'dps');
});

test('duplicated ref, unpinned or reversed crosswalk and contradictory pins fail before any reads',async()=>{
  for(const change of [
    p=>{p.sourcePins[1].sourceRef=p.sourcePins[0].sourceRef;},
    p=>{p.specCrosswalks[0].blizzardSourceSha256='f'.repeat(64);},
    p=>{p.specCrosswalks.push({...p.specCrosswalks[0]});},
    p=>{p.sourcePins[0].endpoint='/data/wow/playable-specialization/999';},
    p=>{p.sourcePins[1].clientBuild='';}
  ]){
    const f=fixture(),payload=structuredClone(f.payload);change(payload);
    await assert.rejects(()=>f.admission({signedBundle:f.signBundle(payload)}),
      /SIGNED_CAPTURE_/);
    assert.equal(f.getReadCount(),0);
  }
});

test('canonical signing rejects RSA trust roots and malformed base64 signatures',async()=>{
  const f=fixture(),bundle=f.signBundle();
  bundle.signature.valueBase64='not-base64';
  await assert.rejects(()=>f.admission({signedBundle:bundle}),
    /SIGNED_CAPTURE_SIGNATURE_INVALID/);
  const {publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  await assert.rejects(()=>f.admission({trustedSigner:{
    ...f.trustedSigner,publicKeyPem:publicKey.export({type:'spki',format:'pem'})
  }}),/SIGNED_CAPTURE_TRUST_ROOT_INVALID|SIGNED_CAPTURE_KEY_TYPE_INVALID/);
});

test('capture limits bound every snapshot and the total',async()=>{
  const f=fixture();
  await assert.rejects(()=>f.admission({maxCaptureBytes:4,maxTotalBytes:1000}),
    /SIGNED_CAPTURE_BYTES_UNAVAILABLE_OR_UNBOUNDED/);
  const g=fixture();
  const lengths=[...g.captures.values()].map(bytes=>bytes.byteLength);
  const largest=Math.max(...lengths);
  assert.ok(lengths.reduce((a,b)=>a+b,0)>largest);
  await assert.rejects(()=>g.admission({
    maxCaptureBytes:largest,maxTotalBytes:largest
  }),/SIGNED_CAPTURE_TOTAL_BYTES_EXCEEDED/);
});

test('a signed capture set with an unknown kind or wrong provenance cannot be admitted',async()=>{
  const changes=[
    p=>{p.sourcePins[0].sourceKind='UNKNOWN_SOURCE';},
    p=>{p.wclPin.originHost='example.com';},
    p=>{p.sourcePins[0].namespace='static-eu';},
    p=>{p.sourcePins[1].namespace='classic';}
  ];
  for(const change of changes){
    const f=fixture(),payload=structuredClone(f.payload);change(payload);
    await assert.rejects(()=>f.admission({signedBundle:f.signBundle(payload)}),
      /SIGNED_CAPTURE_/);
    assert.equal(f.getReadCount(),0);
  }
});

test('captures are never downloaded: invalid signature does not invoke injected readCapture',async()=>{
  const f=fixture(),bundle=f.signBundle();
  bundle.signature.valueBase64='A'.repeat(88);
  await assert.rejects(()=>f.admission({signedBundle:bundle}),
    /SIGNED_CAPTURE_SIGNATURE_INVALID|SIGNED_CAPTURE_SIGNATURE_UNTRUSTED/);
  assert.equal(f.getReadCount(),0);
});
