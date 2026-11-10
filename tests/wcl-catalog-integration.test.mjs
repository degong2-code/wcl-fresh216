import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createWclCatalogPort,WCL_DIRECTORY_QUERY} from '../src/core/wcl-catalog-port.mjs';
import {discoverEnvironment} from '../src/core/environment-discovery.mjs';
import {buildAnalysisScope} from '../src/core/analysis-scope.mjs';

const sha256=text=>createHash('sha256').update(text).digest('hex');
const responses=()=>({directory:{httpStatus:200,body:{data:{
  worldData:{expansions:[{id:99,name:'Synthetic Future Expansion'}]},
  gameData:{classes:[{id:8,name:'Test Class',slug:'test-class',specs:[
    {id:3,name:'Alpha',slug:'alpha'},{id:4,name:'Beta',slug:'beta'}]}]}
}}},zones:{httpStatus:200,body:{data:{worldData:{zones:[{
  id:901,name:'Synthetic Raid',frozen:false,
  difficulties:[{id:4,name:'Heroic',sizes:[]}],
  partitions:[{id:0,name:'Initial',compactName:'I',default:true}],
  encounters:[{id:10001,name:'First Synthetic Boss',journalID:300},
    {id:10002,name:'Unverified Synthetic Boss',journalID:301}]
}]}}}}});
const make=({classified=false,policyVersion='unverified'}={})=>{
  let calls=0;
  const fixture=responses();
  const port=createWclCatalogPort({expansionId:99,sourceNamespace:'synthetic-retail',policyVersion,
    queryGraphql:async document=>{calls++;return structuredClone(document===WCL_DIRECTORY_QUERY?
      fixture.directory:fixture.zones);},
    ...(classified?{
      classifyZone:()=> 'raid',
      classifySpec:spec=>spec.id===3?'dps':'healer',
      confirmEncounterSupport:e=>e.id===10001?{difficulties:[4],partitions:[0]}:null
    }:{})});
  return {port,getCalls:()=>calls};
};

test('actual normalized port feeds zero-state profile with all unknown evidence unresolved',async()=>{
  const {port,getCalls}=make();
  const {profile}=await discoverEnvironment({catalogPort:port,sha256,observedAtMs:1000});
  assert.equal(getCalls(),2);
  assert.equal(profile.status,'UNRESOLVED');
  assert.equal(profile.quality.supportedEncounters,0);
  assert.equal(profile.quality.npcRulesCertified,0);
  assert.equal(profile.catalog.contents[0].encounters[0].status,'UNRESOLVED');
  await assert.rejects(()=>buildAnalysisScope({profile,sha256,
    selections:{startMs:1,endMs:2,depth:10}}),/SCOPE_ZONE_EMPTY_OR_DUPLICATE/);
});

test('externally classified port feeds profile and exact-depth scope with unknown encounter held',async()=>{
  const {port}=make({classified:true,policyVersion:'synthetic-scope-v1'});
  const {profile}=await discoverEnvironment({catalogPort:port,sha256,observedAtMs:1000});
  assert.equal(profile.status,'DISCOVERED');
  assert.equal(profile.quality.supportedEncounters,1);
  assert.equal(profile.quality.unresolvedOrUnsupportedEncounters,1);
  assert.equal(profile.quality.npcRulesCertified,0);
  const selected=await buildAnalysisScope({profile,sha256,selections:{
    startMs:1800000000000,endMs:1800010000000,depth:10}});
  assert.deepEqual(selected.zoneIds,[901]);
  assert.deepEqual(selected.encounterIds,[10001]);
  assert.deepEqual(selected.specKeys,['wcl:8:3']);
  assert.equal(selected.difficultyId,4);
  assert.equal(selected.partitionId,0);
  assert.equal(selected.evidencePolicy,'EXACT_SAME_REPORT_FIGHT_ACTOR_V1');
  const hundred=await buildAnalysisScope({profile,sha256,selections:{
    startMs:1800000000000,endMs:1800010000000,depth:100}});
  assert.notEqual(selected.scopeHash,hundred.scopeHash);
  assert.equal(hundred.evidencePolicy,selected.evidencePolicy);
  await assert.rejects(()=>buildAnalysisScope({profile,sha256,selections:{
    encounterIds:[10002],startMs:1,endMs:2,depth:10}}),/SCOPE_ENCOUNTER_UNSUPPORTED_OR_AMBIGUOUS/);
});

test('profile version follows metadata and policy fingerprint; same sources are reused',async()=>{
  const a=make({classified:true,policyVersion:'synthetic-scope-v1'});
  const first=(await discoverEnvironment({catalogPort:a.port,sha256,observedAtMs:1})).profile;
  const b=make({classified:true,policyVersion:'synthetic-scope-v1'});
  const repeat=await discoverEnvironment({catalogPort:b.port,sha256,observedAtMs:2,
    previousProfile:first});
  assert.equal(repeat.reused,true);
  assert.equal(repeat.profile.version,1);
  const c=make({classified:true,policyVersion:'synthetic-scope-v2'});
  const changed=await discoverEnvironment({catalogPort:c.port,sha256,observedAtMs:3,
    previousProfile:first});
  assert.equal(changed.reused,false);
  assert.equal(changed.profile.version,2);
  assert.notEqual(changed.profile.sourceFingerprint,first.sourceFingerprint);
});
