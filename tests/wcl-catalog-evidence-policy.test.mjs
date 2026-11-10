import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildEvidenceGatedWclPolicy,bindEvidenceGatedWclCatalogPort}
  from '../src/core/wcl-catalog-evidence-policy.mjs';
import {WCL_DIRECTORY_QUERY} from '../src/core/wcl-catalog-port.mjs';
import {discoverEnvironment} from '../src/core/environment-discovery.mjs';
import {buildAnalysisScope} from '../src/core/analysis-scope.mjs';

const sha256=text=>createHash('sha256').update(text).digest('hex');
const witness=(sourceKind,sourceRef,letter)=>({
  sourceKind,sourceRef,sourceSha256:letter.repeat(64),
  capturedAtMs:10,validUntilMs:200
});
const manifest=()=>({schema:'WCL_CLASSIFICATION_POLICY_V1',
  sourceNamespace:'synthetic-retail',expansionId:99,version:'fixture-v1',
  records:[
    {claim:{kind:'ZONE_KIND',wclZoneId:901,wclZoneName:'Synthetic Raid',value:'raid'},
      evidence:witness('BLIZZARD_JOURNAL','blizzard:journal.901','a')},
    {claim:{kind:'SPEC_ROLE',wclClassId:8,wclClassSlug:'test-class',
      wclSpecId:3,wclSpecSlug:'alpha',value:'dps'},
      evidence:witness('BLIZZARD_PLAYABLE_SPECIALIZATION','blizzard:spec.3','b')},
    {claim:{kind:'ENCOUNTER_SUPPORT',wclZoneId:901,
      wclZoneName:'Synthetic Raid',wclEncounterId:10001,
      wclEncounterName:'First Synthetic Boss',wclJournalId:300,
      value:{difficulties:[4],partitions:[0]}},
      evidence:witness('WCL_SCOPED_ENCOUNTER_EVIDENCE','wcl:encounter.10001','c')}
  ]
});
const trusted = async({sourceSha256,claimSha256})=>({
  status:'VERIFIED',sourceSha256,claimSha256,verifiedAtMs:50});
const policy=(options={})=>buildEvidenceGatedWclPolicy({
  manifest:manifest(),verifyEvidence:trusted,sha256,nowMs:100,...options
});
const data=()=>({
  directory:{httpStatus:200,body:{data:{
    worldData:{expansions:[{id:99,name:'Synthetic Expansion'}]},
    gameData:{classes:[{id:8,name:'Test Class',slug:'test-class',
      specs:[{id:3,name:'Alpha',slug:'alpha'},{id:4,name:'Beta',slug:'beta'}]}]}
  }}},
  zones:{httpStatus:200,body:{data:{
    worldData:{zones:[{id:901,name:'Synthetic Raid',frozen:false,
      difficulties:[{id:4,name:'Heroic',sizes:[]},{id:5,name:'Mythic',sizes:[]}],
      partitions:[{id:0,name:'Initial',compactName:'I',default:true}],
      encounters:[{id:10001,name:'First Synthetic Boss',journalID:300},
        {id:10002,name:'Second Synthetic Boss',journalID:301}]}]}
  }}}
});
const portFor=(proof,{sourceNamespace='synthetic-retail',expansionId=99,
  transform=null}={})=>{
  let calls=0;
  const snapshot=data();
  return {port:bindEvidenceGatedWclCatalogPort({
    policy:proof,sourceNamespace,expansionId,
    queryGraphql:async document=>{
      calls++;
      const value=structuredClone(document===WCL_DIRECTORY_QUERY?snapshot.directory:snapshot.zones);
      if(transform)transform(value,document);
      return value;
    }
  }),getCalls:()=>calls};
};

test('approved evidence builds a policy with verified digest, exact scope and no NPC certification',async()=>{
  const p=await policy();
  assert.match(p.policyVersion,/^ev1-[a-f0-9]{48}$/);
  assert.equal(p.diagnostics.accepted,3);
  assert.equal(p.diagnostics.rejected,0);
  assert.equal(p.diagnostics.expired,0);
  assert.equal(p.diagnostics.bossDpsPolicyCertified,false);
  assert.equal(p.diagnostics.npcRulesCertified,0);
  const {port,getCalls}=portFor(p);
  assert.equal(getCalls(),0);
  const c=await port.readCatalog();
  assert.equal(getCalls(),2);
  assert.equal(c.catalogKey,'wcl:synthetic-retail:expansion:99:policy:'+p.policyVersion);
  assert.equal(c.contents[0].type,'raid');
  assert.deepEqual(c.contents[0].encounters[0].difficulties,[4]);
  assert.deepEqual(c.contents[0].encounters[0].partitions,[0]);
  assert.equal(c.contents[0].encounters[1].difficulties,null);
  assert.deepEqual(c.dpsSpecializations,[{
    key:'wcl:8:3',className:'Test Class',specName:'Alpha',role:'dps'}]);
  const diagnostic=port.getLastDiagnostics();
  assert.equal(diagnostic.dpsRolesResolved,1);
  assert.equal(diagnostic.npcPolicy,'UNRESOLVED');
});

test('verified metadata flows into versioned EnvironmentProfile and Top-N AnalysisScope',async()=>{
  const p=await policy();
  const {port}=portFor(p);
  const result=await discoverEnvironment({catalogPort:port,sha256,observedAtMs:100});
  assert.equal(result.profile.status,'DISCOVERED');
  assert.equal(result.profile.quality.npcRulesCertified,0);
  assert.equal(result.profile.quality.supportedEncounters,1);
  assert.equal(result.profile.quality.unresolvedOrUnsupportedEncounters,1);
  const selections={startMs:1000,endMs:2000,depth:10};
  const scope=await buildAnalysisScope({profile:result.profile,selections,sha256});
  assert.deepEqual(scope.zoneIds,[901]);
  assert.deepEqual(scope.encounterIds,[10001]);
  assert.deepEqual(scope.specKeys,['wcl:8:3']);
  assert.equal(scope.npcCertification,'UNRESOLVED');
  assert.equal(scope.evidencePolicy,'EXACT_SAME_REPORT_FIGHT_ACTOR_V1');
  const top100=await buildAnalysisScope({profile:result.profile,
    selections:{...selections,depth:100},sha256});
  assert.notEqual(top100.scopeHash,scope.scopeHash);
  assert.equal(top100.evidencePolicy,scope.evidencePolicy);
});

test('unverified witnesses never classify, even if manifest claims raid/DPS/support',async()=>{
  const calls=[];
  const p=await policy({verifyEvidence:async ({sourceRef})=>{
    calls.push(sourceRef);return {status:'UNVERIFIED'};}});
  assert.equal(calls.length,3);
  assert.equal(p.diagnostics.accepted,0);
  assert.equal(p.diagnostics.rejected,3);
  const {port}=portFor(p);
  const c=await port.readCatalog();
  assert.equal(c.contents[0].type,'unclassified');
  assert.equal(c.contents[0].encounters[0].difficulties,null);
  assert.equal(c.dpsSpecializations.length,0);
  const result=await discoverEnvironment({catalogPort:portFor(p).port,
    sha256,observedAtMs:101});
  assert.equal(result.profile.status,'UNRESOLVED');
});

test('expired evidence is omitted, not silently refreshed or treated as valid',async()=>{
  let calls=0;
  const p=await policy({nowMs:200,verifyEvidence:async()=>{
    calls++;throw Error('VERIFIER_MUST_NOT_BE_CALLED_FOR_EXPIRED');
  }});
  assert.equal(calls,0);
  assert.equal(p.diagnostics.expired,3);
  assert.equal(p.diagnostics.accepted,0);
  const original=await policy();
  assert.notEqual(p.policyVersion,original.policyVersion);
});

test('source hash, claim hash, and verification timestamp must be confirmed',async()=>{
  const invalid=[
    async ({claimSha256})=>({status:'VERIFIED',sourceSha256:'f'.repeat(64),
      claimSha256,verifiedAtMs:50}),
    async ({sourceSha256})=>({status:'VERIFIED',sourceSha256,
      claimSha256:'f'.repeat(64),verifiedAtMs:50}),
    async ({sourceSha256,claimSha256})=>({status:'VERIFIED',
      sourceSha256,claimSha256,verifiedAtMs:9}),
    async ({sourceSha256,claimSha256})=>({status:'VERIFIED',
      sourceSha256,claimSha256,verifiedAtMs:101}),
    async()=>({status:'VERIFIED'})
  ];
  for(const verifyEvidence of invalid)
    await assert.rejects(()=>policy({verifyEvidence}),
      /POLICY_VERIFIER_ATTESTATION_INVALID/);
});

test('policy may not be connected to an unverified namespace, expansion or spoofed object',async()=>{
  const p=await policy();
  assert.throws(()=>portFor(p,{sourceNamespace:'classic'}),
    /POLICY_CATALOG_SCOPE_MISMATCH/);
  assert.throws(()=>portFor(p,{expansionId:100}),
    /POLICY_CATALOG_SCOPE_MISMATCH/);
  assert.throws(()=>portFor({...p}),/POLICY_CATALOG_SCOPE_MISMATCH/);
  const {port,getCalls}=portFor(p);
  assert.equal(getCalls(),0); // no metadata I/O during binding
  await port.readCatalog();assert.equal(getCalls(),2);
});

test('name, class slug and journal crosswalk drift fail closed',async()=>{
  const p=await policy();
  assert.throws(()=>p.classifyZone({id:901,name:'Renamed Raid'},
    {id:99}),/POLICY_ZONE_NAME_DRIFT/);
  assert.throws(()=>p.classifySpec({id:3,slug:'wrong'},
    {id:8,slug:'test-class'}),/POLICY_SPEC_IDENTITY_DRIFT/);
  assert.throws(()=>p.confirmEncounterSupport({
    id:10001,name:'First Synthetic Boss',journalID:999
  },{id:901,name:'Synthetic Raid'},{id:99}),/POLICY_ENCOUNTER_IDENTITY_DRIFT/);
  const other=p.classifyZone({id:901,name:'Synthetic Raid'},{id:100});
  assert.equal(other,null);
});

test('duplicate or contradictory scope claims and unsupported witness classes are rejected',async()=>{
  const duplicate=manifest();duplicate.records.push(structuredClone(duplicate.records[0]));
  await assert.rejects(()=>policy({manifest:duplicate}),/POLICY_DUPLICATE_CLAIM/);
  const wrongSource=manifest();wrongSource.records[0].evidence.sourceKind='BLIZZARD_PLAYABLE_SPECIALIZATION';
  await assert.rejects(()=>policy({manifest:wrongSource}),/POLICY_EVIDENCE_SHAPE_INVALID/);
  const illegalRole=manifest();illegalRole.records[1].claim.value='caster';
  await assert.rejects(()=>policy({manifest:illegalRole}),/POLICY_SPEC_CLAIM_INVALID/);
  const invalidPartitions=manifest();invalidPartitions.records[2].claim.value.partitions=[0,0];
  await assert.rejects(()=>policy({manifest:invalidPartitions}),/POLICY_PARTITIONS_INVALID/);
});

test('changing witnessed claims or policy version changes the fingerprint and profile',async()=>{
  const a=await policy();
  const revised=manifest();
  revised.records[1].claim.value='healer';
  const b=await policy({manifest:revised});
  const versioned=manifest();versioned.version='fixture-v2';
  const c=await policy({manifest:versioned});
  assert.notEqual(a.policyVersion,b.policyVersion);
  assert.notEqual(a.policyVersion,c.policyVersion);
  const root=(await discoverEnvironment({catalogPort:portFor(a).port,
    sha256,observedAtMs:100})).profile;
  const next=await discoverEnvironment({catalogPort:portFor(b).port,
    sha256,observedAtMs:101,previousProfile:root});
  assert.equal(next.reused,false);assert.equal(next.profile.version,2);
  assert.deepEqual(next.changed.specKeys,['wcl:8:3']);
});

test('unverified independent Encounter support outside zone list is rejected by existing adapter',async()=>{
  const m=manifest();m.records[2].claim.value.difficulties=[40];
  const p=await policy({manifest:m});
  const {port}=portFor(p);
  await assert.rejects(()=>port.readCatalog(),/WCL_ENCOUNTER_SUPPORT_OUTSIDE_ZONE/);
});

test('no automatic rank request, network adapter or source credential is built',async()=>{
  let verifications=0;
  const p=await policy({verifyEvidence:async input=>{
    verifications++;return trusted(input);
  }});
  assert.equal(verifications,3);
  assert.equal(typeof p.confirmEncounterSupport,'function');
  assert.equal('fetch' in p,false);
  assert.equal('queryGraphql' in p,false);
});
