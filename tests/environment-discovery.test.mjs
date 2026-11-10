import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {discoverEnvironment,normalizeWclCatalog,canonicalCatalogJson}
  from '../src/core/environment-discovery.mjs';
import {buildAnalysisScope} from '../src/core/analysis-scope.mjs';

const sha256 = text => createHash('sha256').update(text).digest('hex');
const catalog = () => ({
  schema:'WCL_CATALOG_PORT_V1',catalogKey:'synthetic-expansion-2030:season-2',
  contents:[
    {zoneId:502,name:'Trial Dungeon',type:'dungeon',encounters:[
      {id:8002,name:'Second Boss',difficulties:[5,4],partitions:[]},
      {id:8001,name:'First Boss',difficulties:[4],partitions:[]}
    ]},
    {zoneId:501,name:'Lair Prototype',type:'lair',encounters:[
      {id:8010,name:'Unknown Phase',difficulties:null,partitions:null}
    ]}
  ],
  dpsSpecializations:[
    {key:'Mage:Fire',className:'Mage',specName:'Fire',role:'dps'},
    {key:'Rogue:Outlaw',className:'Rogue',specName:'Outlaw',role:'dps'}
  ]
});
const create = (metadata=catalog(),previousProfile=null)=>discoverEnvironment({
  catalogPort:{readCatalog:async()=>structuredClone(metadata)},sha256,
  observedAtMs:1800000000000,previousProfile
});

test('zero-state discovery makes a versioned profile without legacy encounter IDs',async()=>{
  const {profile,reused,changed}=await create();
  assert.equal(reused,false);assert.equal(profile.version,1);
  assert.equal(profile.status,'DISCOVERED');
  assert.deepEqual(profile.catalog.contents.map(z=>z.zoneId),[501,502]);
  assert.deepEqual(profile.catalog.contents[1].encounters.map(e=>e.id),[8001,8002]);
  assert.equal(profile.quality.supportedEncounters,2);
  assert.equal(profile.quality.unresolvedOrUnsupportedEncounters,1);
  assert.equal(profile.quality.npcRulesCertified,0);
  assert.deepEqual(changed.zoneIds,[501,502]);
  for(const zone of profile.catalog.contents)for(const e of zone.encounters??[]){
    assert.equal(e.npcPolicy.status,'UNRESOLVED');
    assert.deepEqual(e.npcPolicy.certifiedRules,[]);
  }
});

test('equivalent catalog order and duplicate-safe canonicalization allow reuse',async()=>{
  const first=(await create()).profile;
  const reordered=catalog();
  reordered.contents.reverse();reordered.contents[0].encounters.reverse();
  reordered.dpsSpecializations.reverse();
  const next=await create(reordered,first);
  assert.equal(next.reused,true);assert.deepEqual(next.profile,first);
  assert.deepEqual(next.changed,{zoneIds:[],specKeys:[]});
  assert.equal(canonicalCatalogJson({b:1,a:2}),canonicalCatalogJson({a:2,b:1}));
});

test('changed catalog versions only affected zones and maintains stable unchanged labels',async()=>{
  const prior=(await create()).profile;
  const changed=catalog(); changed.contents[0].encounters[1].name='First Boss (changed)';
  const next=await create(changed,prior);
  assert.equal(next.profile.version,2);
  assert.deepEqual(next.changed.zoneIds,[502]);
  assert.deepEqual(next.changed.specKeys,[]);
  assert.notEqual(next.profile.sourceFingerprint,prior.sourceFingerprint);
});

test('missing metadata stays unresolved instead of guessing a difficulty or boss rule',async()=>{
  const partial=catalog();
  partial.contents=[{zoneId:77,name:'Unknown Content',type:'other'}];
  partial.dpsSpecializations=[];
  const {profile}=await create(partial);
  assert.equal(profile.status,'UNRESOLVED');
  assert.equal(profile.quality.unknownEncounterLists,1);
  assert.equal(profile.catalog.contents[0].encounters,null);
  await assert.rejects(()=>buildAnalysisScope({profile,sha256,selections:{
    startMs:1,endMs:2,depth:10}}),/SCOPE_ZONE_EMPTY_OR_DUPLICATE/);
});

test('duplicates, invalid source metadata, and a dishonest digest fail closed',async()=>{
  const duplicated=catalog(); duplicated.contents.push(structuredClone(duplicated.contents[0]));
  await assert.rejects(()=>create(duplicated),/CATALOG_ZONE_DUPLICATE/);
  const duplicatedEncounter=catalog();
  duplicatedEncounter.contents[0].encounters.push(structuredClone(duplicatedEncounter.contents[0].encounters[0]));
  assert.throws(()=>normalizeWclCatalog(duplicatedEncounter),/CATALOG_ENCOUNTER_DUPLICATE/);
  const invalid=catalog();invalid.dpsSpecializations[0].role='healer';
  assert.throws(()=>normalizeWclCatalog(invalid),/CATALOG_SPEC_INVALID/);
  await assert.rejects(()=>discoverEnvironment({catalogPort:{readCatalog:async()=>catalog()},
    sha256:()=> 'not-a-sha',observedAtMs:1}),/DISCOVERY_FINGERPRINT_INVALID/);
  const sameHashDifferentCatalog=(await create()).profile;
  sameHashDifferentCatalog.catalog.contents=[];
  await assert.rejects(()=>create(catalog(),sameHashDifferentCatalog),/DISCOVERY_FINGERPRINT_COLLISION/);
});

test('scope defaults only to supported encounters and discovered DPS specializations',async()=>{
  const profile=(await create()).profile;
  const scope=await buildAnalysisScope({profile,sha256,selections:{
    startMs:1800000000000,endMs:1800090000000,depth:10}});
  assert.deepEqual(scope.zoneIds,[502]);
  assert.deepEqual(scope.encounterIds,[8001,8002]);
  assert.deepEqual(scope.specKeys,['Mage:Fire','Rogue:Outlaw']);
  assert.equal(scope.difficultyId,4);assert.equal(scope.partitionId,null);
  assert.equal(scope.depth,10);
  assert.equal(scope.npcCertification,'UNRESOLVED');
  assert.equal(scope.evidencePolicy,'EXACT_SAME_REPORT_FIGHT_ACTOR_V1');
  const repeat=await buildAnalysisScope({profile,sha256,selections:{
    startMs:1800000000000,endMs:1800090000000,depth:10,
    specKeys:['Rogue:Outlaw','Mage:Fire']}});
  assert.equal(scope.scopeHash,repeat.scopeHash);
});

test('Top-10 vs Top-100 changes rank coverage, not proof policy',async()=>{
  const profile=(await create()).profile;
  const args={profile,sha256,selections:{startMs:1,endMs:2,depth:10}};
  const a=await buildAnalysisScope(args);
  const b=await buildAnalysisScope({...args,selections:{...args.selections,depth:100}});
  assert.notEqual(a.scopeHash,b.scopeHash);
  assert.equal(a.evidencePolicy,b.evidencePolicy);
});

test('unsupported and ambiguous selections fail closed',async()=>{
  const profile=(await create()).profile;
  const base={profile,sha256,selections:{startMs:1,endMs:2,depth:10}};
  const invalid=[
    [{zoneIds:[501]},'SCOPE_ZONE_NOT_DISCOVERED'],
    [{encounterIds:[8010]},'SCOPE_ENCOUNTER_UNSUPPORTED_OR_AMBIGUOUS'],
    [{difficultyId:5},'SCOPE_DIFFICULTY_REQUIRED_OR_UNSUPPORTED'],
    [{partitionId:0},'SCOPE_PARTITION_UNSUPPORTED'],
    [{specKeys:['Missing:Spec']},'SCOPE_SPEC_NOT_DISCOVERED'],
    [{depth:0},'SCOPE_DEPTH_INVALID'],
    [{zoneIds:[502,502]},'SCOPE_ZONE_EMPTY_OR_DUPLICATE'],
    [{startMs:5,endMs:2},'SCOPE_TIME_RANGE_INVALID']
  ];
  for(const [change,reason] of invalid){
    await assert.rejects(()=>buildAnalysisScope({...base,selections:{...base.selections,...change}}),new RegExp(reason));
  }
});

test('multiple possible difficulty or partition options require explicit selection',async()=>{
  const m=catalog(); m.contents=[{zoneId:99,name:'Raid',type:'raid',encounters:[
    {id:91,name:'Boss',difficulties:[4,5],partitions:[0,1]}
  ]}];
  const profile=(await create(m)).profile;
  await assert.rejects(()=>buildAnalysisScope({profile,sha256,
    selections:{startMs:1,endMs:2,depth:30}}),/SCOPE_DIFFICULTY_REQUIRED_OR_UNSUPPORTED/);
  await assert.rejects(()=>buildAnalysisScope({profile,sha256,
    selections:{startMs:1,endMs:2,depth:30,difficultyId:4}}),/SCOPE_PARTITION_REQUIRED_OR_UNSUPPORTED/);
  const valid=await buildAnalysisScope({profile,sha256,
    selections:{startMs:1,endMs:2,depth:30,difficultyId:4,partitionId:0}});
  assert.equal(valid.partitionId,0);assert.equal(valid.difficultyId,4);
});

test('injected catalog port called once, no network/IO/credential access by core',async()=>{
  let calls=0;
  const result=await discoverEnvironment({catalogPort:{readCatalog:async()=>{
    calls++;return catalog();}},sha256,observedAtMs:0});
  assert.equal(calls,1);
  assert.equal(result.profile.observedAtMs,0);
});
