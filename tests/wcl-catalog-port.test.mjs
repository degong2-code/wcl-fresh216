import test from 'node:test';
import assert from 'node:assert/strict';
import {createWclCatalogPort,WCL_DIRECTORY_QUERY,WCL_EXPANSION_ZONES_QUERY}
  from '../src/core/wcl-catalog-port.mjs';

const directory=()=>({httpStatus:200,body:{data:{
  rateLimitData:{currentRequest:{total:1.25}},
  worldData:{expansions:[{id:7,name:'Example Expansion'},{id:8,name:'Archive Expansion'}]},
  gameData:{classes:[
    {id:10,name:'Mage',slug:'mage',specs:[{id:3,name:'Fire',slug:'fire'},
      {id:4,name:'Frost',slug:'frost'}]},
    {id:11,name:'Warrior',slug:'warrior',specs:[{id:2,name:'Protection',slug:'protection'}]}
  ]}
}}});
const zone=()=>({httpStatus:200,body:{data:{
  rateLimitData:{currentRequest:'{"total":0.5}'},
  worldData:{zones:[
    {id:41,name:'Test Raid',frozen:false,
      difficulties:[{id:4,name:'Heroic',sizes:[]},{id:5,name:'Mythic',sizes:[20]}],
      partitions:[{id:0,name:'Original',compactName:'Original',default:true}],
      encounters:[{id:100,name:'Boss One',journalID:1},{id:101,name:'Boss Two',journalID:2}]},
    {id:42,name:'Unclassified Content',frozen:true,
      difficulties:null,partitions:null,encounters:null}
  ]}
}}});
const make=(changes={})=>{
  const captured=[];
  const transport=async(query,variables)=>{
    captured.push({query,variables});
    return captured.length===1?directory():zone();
  };
  const port=createWclCatalogPort({queryGraphql:transport,expansionId:7,
    sourceNamespace:'retail',...changes});
  return {port,captured};
};

test('official schema only: two named queries, explicit expansion, no live client',async()=>{
  assert.match(WCL_DIRECTORY_QUERY,/worldData\s*\{\s*expansions\s*\{\s*id\s+name/);
  assert.match(WCL_DIRECTORY_QUERY,/gameData\s*\{\s*classes\s*\{/);
  assert.match(WCL_EXPANSION_ZONES_QUERY,/zones\(expansion_id:\s*\$expansionId\)/);
  assert.match(WCL_EXPANSION_ZONES_QUERY,/encounters\s*\{\s*id\s+name\s+journalID/);
  assert.doesNotMatch(WCL_DIRECTORY_QUERY+WCL_EXPANSION_ZONES_QUERY, /\b(season|dpsRole|raidType)\b/);
  const {port,captured}=make();
  const result=await port.readCatalog();
  assert.equal(captured.length,2);
  assert.equal(captured[0].query,WCL_DIRECTORY_QUERY);
  assert.deepEqual(captured[0].variables,{});
  assert.equal(captured[1].query,WCL_EXPANSION_ZONES_QUERY);
  assert.deepEqual(captured[1].variables,{expansionId:7});
  assert.equal(result.schema,'WCL_CATALOG_PORT_V1');
  assert.equal(result.catalogKey,'wcl:retail:expansion:7:policy:unverified');
  assert.deepEqual(port.getLastDiagnostics().observedPoints,[1.25,0.5]);
});

test('zone type, encounter support, spec DPS role remain unresolved without independent evidence',async()=>{
  const {port}=make();
  assert.equal(port.getLastDiagnostics(),null);
  const result=await port.readCatalog();
  assert.deepEqual(result.dpsSpecializations,[]);
  assert.equal(result.contents[0].type,'unclassified');
  assert.equal(result.contents[0].encounters[0].difficulties,null);
  assert.equal(result.contents[0].encounters[0].partitions,null);
  assert.equal(result.contents[1].encounters,null);
  assert.equal(port.getLastDiagnostics().unresolvedZones,2);
  assert.equal(port.getLastDiagnostics().unresolvedRoles,3);
  assert.equal(port.getLastDiagnostics().unresolvedEncounters,2);
  assert.equal(port.getLastDiagnostics().seasonId,'UNRESOLVED');
  assert.equal(port.getLastDiagnostics().npcPolicy,'UNRESOLVED');
});

test('externally attested policies may classify supported raid, role and encounter range',async()=>{
  const {port}=make({policyVersion:'verified-fixture-1',
    classifyZone:z=>z.id===41?'raid':null,
    classifySpec:s=>s.slug==='fire'?'dps':s.slug==='protection'?'tank':null,
    confirmEncounterSupport:e=>e.id===100?{difficulties:[4],partitions:[0]}:null
  });
  const catalog=await port.readCatalog();
  assert.deepEqual(catalog.dpsSpecializations,[{
    key:'wcl:10:3',className:'Mage',specName:'Fire',role:'dps'}]);
  assert.equal(catalog.contents[0].type,'raid');
  assert.deepEqual(catalog.contents[0].encounters[0],{
    id:100,name:'Boss One',difficulties:[4],partitions:[0]});
  assert.deepEqual(catalog.contents[0].encounters[1].difficulties,null);
  assert.equal(port.getLastDiagnostics().dpsRolesResolved,1);
  assert.equal(port.getLastDiagnostics().unresolvedRoles,1);
});

test('bad policy, inconsistent encounter support and unversioned classification fail closed',async()=>{
  assert.throws(()=>make({classifySpec:()=> 'dps'}),/WCL_CATALOG_POLICY_VERSION_REQUIRED/);
  const badRole=make({policyVersion:'v1',classifySpec:()=> 'caster'});
  await assert.rejects(()=>badRole.port.readCatalog(),/WCL_SPEC_CLASSIFICATION_INVALID/);
  assert.equal(badRole.port.getLastDiagnostics(),null);
  const badDiff=make({policyVersion:'v1',classifyZone:()=> 'raid',
    confirmEncounterSupport:()=>({difficulties:[33],partitions:[0]})});
  await assert.rejects(()=>badDiff.port.readCatalog(),/WCL_ENCOUNTER_SUPPORT_OUTSIDE_ZONE/);
  const noZoneRange=make({policyVersion:'v1',classifyZone:()=> 'raid',
    confirmEncounterSupport:()=>({difficulties:[4],partitions:[0]}),
    queryGraphql:async(doc)=>{
      if(doc===WCL_DIRECTORY_QUERY)return directory();
      const result=zone();result.body.data.worldData.zones[0].difficulties=null;
      return result;
    }});
  await assert.rejects(()=>noZoneRange.port.readCatalog(),/WCL_ENCOUNTER_ZONE_SUPPORT_UNKNOWN/);
});

test('pagination is not invented, and response/result count bounds are hard failures',async()=>{
  const {port,captured}=make({maxZones:1});
  await assert.rejects(()=>port.readCatalog(),/WCL_ZONES_UNAVAILABLE_OR_UNBOUNDED/);
  assert.equal(captured.length,2);
  assert.throws(()=>make({maxZones:513}),/WCL_CATALOG_BOUNDS_INVALID/);
  const bounded=make({maxResponseCharacters:100});
  await assert.rejects(()=>bounded.port.readCatalog(),/WCL_CATALOG_RESPONSE_TOO_LARGE/);
});

test('GraphQL error, missing expansion and malformed class fail before additional effects',async()=>{
  let calls=0;
  const error=createWclCatalogPort({expansionId:7,sourceNamespace:'retail',
    queryGraphql:async()=>{calls++;return {httpStatus:200,body:{errors:[{message:'no'}]}};}});
  await assert.rejects(()=>error.readCatalog(),/WCL_CATALOG_GRAPHQL_UNCERTAIN/);
  assert.equal(calls,1);
  const badExp=make({expansionId:900});
  await assert.rejects(()=>badExp.port.readCatalog(),/WCL_EXPANSION_NOT_DISCOVERED/);
  assert.equal(badExp.captured.length,1);
  const badClass=createWclCatalogPort({expansionId:7,sourceNamespace:'retail',
    queryGraphql:async()=>{
      const body=directory();body.body.data.gameData.classes.push(body.body.data.gameData.classes[0]);
      return body;
    }});
  await assert.rejects(()=>badClass.readCatalog(),/WCL_CLASS_DUPLICATE/);
});

test('unknown costs are null, not zero; missing classes do not make up a DPS roster',async()=>{
  let calls=0;
  const {port}=make({queryGraphql:async()=>{
    calls++;
    const response=calls===1?directory():zone();
    delete response.body.data.rateLimitData;
    if(calls===1)response.body.data.gameData.classes=null;
    return response;
  }});
  const result=await port.readCatalog();
  assert.deepEqual(result.dpsSpecializations,[]);
  assert.deepEqual(port.getLastDiagnostics().observedPoints,[null,null]);
  assert.equal(port.getLastDiagnostics().missingClasses,true);
});

test('adapter never retries a second data request after an ambiguous response',async()=>{
  let calls=0;
  const port=createWclCatalogPort({expansionId:7,sourceNamespace:'retail',
    queryGraphql:async()=>{calls++;if(calls===1)return directory();throw Error('AMBIGUOUS_TRANSPORT');}});
  await assert.rejects(()=>port.readCatalog(),/AMBIGUOUS_TRANSPORT/);
  assert.equal(calls,2);
  assert.equal(port.getLastDiagnostics(),null);
});
