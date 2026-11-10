import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createTrustedCapturedEvidenceVerifier}
  from '../src/core/wcl-captured-evidence-verifier.mjs';
import {buildEvidenceGatedWclPolicy}
  from '../src/core/wcl-catalog-evidence-policy.mjs';
import {canonicalCatalogJson} from '../src/core/environment-discovery.mjs';

const encode=o=>new TextEncoder().encode(JSON.stringify(o));
const shaBytes=bytes=>createHash('sha256').update(bytes).digest('hex');
const shaText=text=>createHash('sha256').update(text).digest('hex');
const scenario=()=>{
  const captures=new Map();
  const entry=(sourceRef,object,sourceKind,originHost,endpoint,namespace)=>{
    const bytes=encode(object);captures.set(sourceRef,bytes);
    return {sourceRef,sourceKind,sourceSha256:shaBytes(bytes),
      originHost,endpoint,namespace,locale:'en_US',
      capturedAtMs:10,validUntilMs:1000};
  };
  const wcl=entry('snap:wcl', {
    schema:'WCL_CAPTURED_DIRECTORY_AND_ZONES_V1',
    sourceNamespace:'synthetic-retail',expansionId:99,
    directory:{data:{
      worldData:{expansions:[{id:99,name:'Synthetic Expansion'}]},
      gameData:{classes:[{id:8,name:'Mage',slug:'mage',
        specs:[{id:3,name:'Fire',slug:'fire'}]}]}
    }},
    zones:{data:{worldData:{zones:[{id:901,name:'Synthetic Raid',
      encounters:[{id:10001,name:'First Boss',journalID:300},
        {id:10002,name:'Second Boss',journalID:301}]}]}}}
  },'WCL_CATALOG_BUNDLE','www.warcraftlogs.com','/api/v2/client','synthetic-retail');
  const spec=entry('snap:blizzard-spec-63',{
    id:63,name:'Fire',playable_class:{id:8},role:{type:'DAMAGE',name:'Damage'}
  },'BLIZZARD_PLAYABLE_SPECIALIZATION','us.api.blizzard.com',
  '/data/wow/playable-specialization/63','static-us');
  const journal=entry('snap:client-journal',{
    schema:'WOW_CLIENT_EJ_EXPORT_V1',clientBuild:'12.0.1',locale:'en_US',
    instances:[{journalInstanceID:555,isRaid:true,
      encounters:[{journalEncounterID:300},{journalEncounterID:301}]}]
  },'WOW_CLIENT_JOURNAL','wow-client-export',
  'EJ_GetInstanceByIndex+EJ_GetEncounterInfoByIndex','synthetic-retail');
  journal.clientBuild='12.0.1';
  const specBinding={wclClassId:8,wclSpecId:3,
    blizzardClassId:8,blizzardSpecId:63,
    wclSourceSha256:wcl.sourceSha256,blizzardSourceSha256:spec.sourceSha256};
  const manifest={schema:'WCL_CLASSIFICATION_POLICY_V1',
    sourceNamespace:'synthetic-retail',expansionId:99,version:'v1',
    records:[
      {claim:{kind:'SPEC_ROLE',wclClassId:8,wclClassSlug:'mage',
        wclSpecId:3,wclSpecSlug:'fire',value:'dps'},
       evidence:{sourceKind:spec.sourceKind,sourceRef:spec.sourceRef,
         sourceSha256:spec.sourceSha256,capturedAtMs:10,validUntilMs:1000}},
      {claim:{kind:'ZONE_KIND',wclZoneId:901,wclZoneName:'Synthetic Raid',
        value:'raid'},
       evidence:{sourceKind:journal.sourceKind,sourceRef:journal.sourceRef,
         sourceSha256:journal.sourceSha256,capturedAtMs:10,validUntilMs:1000}},
      {claim:{kind:'ENCOUNTER_SUPPORT',wclZoneId:901,wclZoneName:'Synthetic Raid',
        wclEncounterId:10001,wclEncounterName:'First Boss',wclJournalId:300,
        value:{difficulties:[4],partitions:[0]}},
       evidence:{sourceKind:'WCL_SCOPED_ENCOUNTER_EVIDENCE',
         sourceRef:'snap:unverified-support',sourceSha256:'f'.repeat(64),
         capturedAtMs:10,validUntilMs:1000}}
    ]
  };
  let reads=0;
  const readCapture=async ref=>{
    reads++;
    const bytes=captures.get(ref);
    if(!bytes)throw Error('MISSING_CAPTURE');
    return Uint8Array.from(bytes);
  };
  const setup=()=>({readCapture,sha256Bytes:shaBytes,sha256Text:shaText,
    wclPin:wcl,sourcePins:[spec,journal],specCrosswalks:[specBinding],
    verifiedAtMs:100});
  const getReads=()=>reads;
  const verify=(changes={})=>createTrustedCapturedEvidenceVerifier({...setup(),...changes});
  return {captures,encode,shaBytes,shaText,wcl,spec,journal,
    specBinding,manifest,setup,verify,getReads};
};

test('signed-out offline source pin and exact WCL spec crosswalk certify role; complete EJ map certifies raid',async()=>{
  const s=scenario(),v=s.verify();
  assert.equal(s.getReads(),0);
  const p=await buildEvidenceGatedWclPolicy({
    manifest:s.manifest,verifyEvidence:v,sha256:shaText,nowMs:100});
  assert.equal(p.diagnostics.candidates,3);
  assert.equal(p.diagnostics.accepted,2);
  assert.equal(p.diagnostics.rejected,1);
  assert.equal(p.diagnostics.npcRulesCertified,0);
  assert.equal(p.diagnostics.bossDpsPolicyCertified,false);
  assert.equal(p.classifySpec({id:3,slug:'fire'},{id:8,slug:'mage'}),'dps');
  assert.equal(p.classifyZone({id:901,name:'Synthetic Raid'},{id:99}),'raid');
  assert.equal(p.confirmEncounterSupport({id:10001,name:'First Boss',journalID:300},
    {id:901,name:'Synthetic Raid'},{id:99}),null);
  assert.equal(s.getReads(),4); // WCL + payload, twice; no support fetch
});

test('manifest digest alone, without a trusted capture pin, never grants a role',async()=>{
  const s=scenario();
  const p=await buildEvidenceGatedWclPolicy({manifest:s.manifest,
    verifyEvidence:s.verify({sourcePins:[s.journal],specCrosswalks:[]}),
    sha256:shaText,nowMs:100});
  assert.equal(p.diagnostics.accepted,1);
  assert.equal(p.classifySpec({id:3,slug:'fire'},{id:8,slug:'mage'}),null);
});

test('wrong WCL namespace, expansion and claim digest are UNVERIFIED without reads',async()=>{
  const s=scenario(),v=s.verify();
  const claim=s.manifest.records[0].claim;
  const base={nowMs:100,sourceKind:s.spec.sourceKind,sourceRef:s.spec.sourceRef,
    sourceSha256:s.spec.sourceSha256,claim,
    claimSha256:'a'.repeat(64),
    scope:{sourceNamespace:'synthetic-retail',expansionId:99}};
  assert.deepEqual(await v(base),{status:'UNVERIFIED'});
  assert.deepEqual(await v({...base,scope:{...base.scope,expansionId:100}}),
    {status:'UNVERIFIED'});
  assert.deepEqual(await v({...base,scope:{...base.scope,sourceNamespace:'classic'}}),
    {status:'UNVERIFIED'});
  assert.equal(s.getReads(),0);
});

test('source-byte replacement fails digest readback (no silent recertification)',async()=>{
  const s=scenario(),v=s.verify();
  s.captures.set(s.spec.sourceRef,encode({id:63,role:{type:'HEALING'}}));
  await assert.rejects(()=>buildEvidenceGatedWclPolicy({manifest:s.manifest,
    verifyEvidence:v,sha256:shaText,nowMs:100}),/CAPTURE_DIGEST_MISMATCH/);
});

test('operator-pinned crosswalk must be explicit; coincidental WCL and Blizzard IDs are insufficient',async()=>{
  const s=scenario();
  const p=await buildEvidenceGatedWclPolicy({manifest:s.manifest,
    verifyEvidence:s.verify({specCrosswalks:[]}),sha256:shaText,nowMs:100});
  assert.equal(p.diagnostics.accepted,1);
  const v=s.verify({specCrosswalks:[{...s.specBinding,blizzardSpecId:3}]});
  const claim=s.manifest.records[0].claim,scope={sourceNamespace:'synthetic-retail',expansionId:99};
  const claimSha256=shaText(canonicalCatalogJson({scope,claim}));
  await assert.rejects(()=>v({claim,scope,nowMs:100,capturedAtMs:10,validUntilMs:1000,claimSha256,
    sourceKind:s.spec.sourceKind,sourceRef:s.spec.sourceRef,
    sourceSha256:s.spec.sourceSha256}),/BLIZZARD_SPEC_ORIGIN_INVALID/);
});

test('conflicting specialization crosswalks fail constructor, not after publication',()=>{
  const s=scenario();
  const dup={...s.specBinding,wclSpecId:4};
  assert.throws(()=>s.verify({specCrosswalks:[s.specBinding,dup]}),
    /SPEC_CROSSWALK_REVERSE_CONFLICT/);
  assert.throws(()=>s.verify({specCrosswalks:[s.specBinding,s.specBinding]}),
    /SPEC_CROSSWALK_DUPLICATE/);
});

test('frozen WCL source rejects changed class slug, changed journal IDs and duplicate rows',async()=>{
  for(const mutate of [
    x=>x.directory.data.gameData.classes[0].slug='renamed-mage',
    x=>x.zones.data.worldData.zones[0].encounters[0].journalID=888,
    x=>x.zones.data.worldData.zones[0].encounters.push(
      structuredClone(x.zones.data.worldData.zones[0].encounters[0]))
  ]){
    const s=scenario();
    const snapshot=JSON.parse(new TextDecoder().decode(s.captures.get(s.wcl.sourceRef)));
    mutate(snapshot);
    s.captures.set(s.wcl.sourceRef,encode(snapshot));
    const wclPin={...s.wcl,sourceSha256:shaBytes(s.captures.get(s.wcl.sourceRef))};
    const binding={...s.specBinding,wclSourceSha256:wclPin.sourceSha256};
    const verifier=s.verify({wclPin,specCrosswalks:[binding]});
    if(snapshot.zones.data.worldData.zones[0].encounters.length>2)
      await assert.rejects(()=>buildEvidenceGatedWclPolicy({
        manifest:s.manifest,verifyEvidence:verifier,sha256:shaText,nowMs:100}),
        /WCL_CAPTURE_ENCOUNTER_DUPLICATE/);
    else{
      const result=await buildEvidenceGatedWclPolicy({
        manifest:s.manifest,verifyEvidence:verifier,sha256:shaText,nowMs:100});
      assert.ok(result.diagnostics.accepted<2);
    }
  }
});

test('partial journal, non-raid and conflicting journal IDs never certify a zone',async()=>{
  for(const mode of ['partial','nonraid','duplicate']){
    const s=scenario();
    const body=JSON.parse(new TextDecoder().decode(s.captures.get(s.journal.sourceRef)));
    if(mode==='partial')body.instances[0].encounters.pop();
    if(mode==='nonraid')body.instances[0].isRaid=false;
    if(mode==='duplicate')body.instances.push({journalInstanceID:556,isRaid:true,
      encounters:[{journalEncounterID:300}]});
    s.captures.set(s.journal.sourceRef,encode(body));
    const pin={...s.journal,sourceSha256:shaBytes(s.captures.get(s.journal.sourceRef))};
    const m=structuredClone(s.manifest);
    m.records[1].evidence.sourceSha256=pin.sourceSha256;
    const v=s.verify({sourcePins:[s.spec,pin]});
    if(mode==='duplicate')
      await assert.rejects(()=>buildEvidenceGatedWclPolicy({
        manifest:m,verifyEvidence:v,sha256:shaText,nowMs:100}),
        /EJ_ENCOUNTER_CROSS_INSTANCE_CONFLICT/);
    else{
      const p=await buildEvidenceGatedWclPolicy({manifest:m,verifyEvidence:v,
        sha256:shaText,nowMs:100});
      assert.equal(p.classifyZone({id:901,name:'Synthetic Raid'},{id:99}),null);
    }
  }
});

test('even non-raid journal is not enough to call a WCL zone a dungeon',async()=>{
  const s=scenario();
  const m=structuredClone(s.manifest);
  m.records[1].claim.value='dungeon';
  const p=await buildEvidenceGatedWclPolicy({
    manifest:m,verifyEvidence:s.verify(),sha256:shaText,nowMs:100});
  assert.equal(p.classifyZone({id:901,name:'Synthetic Raid'},{id:99}),null);
});

test('source expired or captured in future aborts before reading any bytes',async()=>{
  const s=scenario();
  await assert.rejects(()=>buildEvidenceGatedWclPolicy({
    manifest:s.manifest,verifyEvidence:s.verify({
      wclPin:{...s.wcl,validUntilMs:100}}),
    sha256:shaText,nowMs:100}),/CAPTURE_PIN_EXPIRED_OR_FUTURE/);
  assert.equal(s.getReads(),0);
});

test('unsupported raw source kinds and encounter difficulty claims remain UNVERIFIED',async()=>{
  const s=scenario();
  const m=structuredClone(s.manifest);
  m.records[0].evidence.sourceKind='WOW_CLIENT_SPECIALIZATION';
  const p=await buildEvidenceGatedWclPolicy({
    manifest:m,verifyEvidence:s.verify(),sha256:shaText,nowMs:100});
  assert.equal(p.diagnostics.accepted,1);
  assert.equal(p.confirmEncounterSupport({id:10001,name:'First Boss',journalID:300},
    {id:901,name:'Synthetic Raid'},{id:99}),null);
});

test('oversized or absent immutable bytes never count as a verified witness',async()=>{
  const s=scenario();
  await assert.rejects(()=>buildEvidenceGatedWclPolicy({
    manifest:s.manifest,verifyEvidence:s.verify({maxCaptureBytes:8}),
    sha256:shaText,nowMs:100}),/CAPTURE_BYTES_UNAVAILABLE_OR_UNBOUNDED/);
  const v=s.verify({readCapture:async()=>new Uint8Array()});
  await assert.rejects(()=>buildEvidenceGatedWclPolicy({
    manifest:s.manifest,verifyEvidence:v,sha256:shaText,nowMs:100}),
    /CAPTURE_BYTES_UNAVAILABLE_OR_UNBOUNDED/);
});

test('same WCL journalID assigned to two encounter IDs is rejected before classification',async()=>{
  const s=scenario();
  const body=JSON.parse(new TextDecoder().decode(s.captures.get(s.wcl.sourceRef)));
  body.zones.data.worldData.zones[0].encounters[1].journalID=300;
  s.captures.set(s.wcl.sourceRef,encode(body));
  const wclPin={...s.wcl,sourceSha256:shaBytes(s.captures.get(s.wcl.sourceRef))};
  const binding={...s.specBinding,wclSourceSha256:wclPin.sourceSha256};
  const v=s.verify({wclPin,specCrosswalks:[binding]});
  await assert.rejects(()=>buildEvidenceGatedWclPolicy({
    manifest:s.manifest,verifyEvidence:v,sha256:shaText,nowMs:100}),
    /WCL_CAPTURE_JOURNAL_ID_DUPLICATE/);
});

test('manifest cannot extend an externally pinned source expiry or use an earlier verifier clock',async()=>{
  const s=scenario();
  const p=await buildEvidenceGatedWclPolicy({
    manifest:s.manifest,verifyEvidence:s.verify({verifiedAtMs:50}),
    sha256:shaText,nowMs:100});
  assert.equal(p.diagnostics.accepted,0); // timestamp mismatch returns UNVERIFIED
  assert.equal(s.getReads(),0);
  const old=s.verify({sourcePins:[s.spec,{...s.journal,validUntilMs:99}]});
  const expired=await buildEvidenceGatedWclPolicy({
    manifest:s.manifest,verifyEvidence:old,sha256:shaText,nowMs:100});
  assert.equal(expired.classifyZone({id:901,name:'Synthetic Raid'},{id:99}),null);
});

test('client build drift does not certify an alleged journal raid mapping',async()=>{
  const s=scenario();
  const altered={...s.journal,clientBuild:'12.9.0'};
  const p=await buildEvidenceGatedWclPolicy({
    manifest:s.manifest,verifyEvidence:s.verify({sourcePins:[s.spec,altered]}),
    sha256:shaText,nowMs:100});
  assert.equal(p.classifyZone({id:901,name:'Synthetic Raid'},{id:99}),null);
});

test('manifest cannot forge a later expiry or different capture timestamp than trusted pins',async()=>{
  for(const mutate of [
    e=>{e.capturedAtMs=11;},
    e=>{e.validUntilMs=1200;}
  ]){
    const s=scenario(),m=structuredClone(s.manifest);
    mutate(m.records[0].evidence);
    const p=await buildEvidenceGatedWclPolicy({
      manifest:m,verifyEvidence:s.verify(),sha256:shaText,nowMs:100});
    assert.equal(p.classifySpec({id:3,slug:'fire'},{id:8,slug:'mage'}),null);
    assert.equal(p.diagnostics.accepted,1); // only journal is accepted
  }
});

test('capture verifier produces no network client, Secrets reader, or automatic requests',()=>{
  const s=scenario(),v=s.verify();
  assert.equal(typeof v,'function');
  assert.equal(s.getReads(),0);
  assert.equal('fetch' in v,false);
});
