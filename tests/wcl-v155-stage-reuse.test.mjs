import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createSealedV155CatalogPort}
  from '../src/adapters/wcl-v155-stage-reuse.mjs';
import {discoverEnvironment}
  from '../src/core/environment-discovery.mjs';
import {buildAnalysisScope}
  from '../src/core/analysis-scope.mjs';

const digest=x=>createHash('sha256').update(x).digest('hex');
const fixture=()=>{
  const a='1'.repeat(64),b='2'.repeat(64),c='3'.repeat(64),d='4'.repeat(64);
  const original_graphql_http_bodies={
    expansion_index:{request_body_sha256:a,raw_response_sha256:b,
      raw_response_bytes:296},
    all_expansion_zones:{request_body_sha256:c,raw_response_sha256:d,
      raw_response_bytes:23857}
  };
  const report={schema:'v155_season_discovery_provider_probe_v1',
    mode:'LIVE_AUTHENTICATED_BOUNDED',native_simc_calls:0,
    wcl:{requests:2,status:'ZONES_WITH_JOURNAL_IDS_RETURNED',
      zone_source_scope:'ALL_WCL_EXPANSIONS',
      original_graphql_http_bodies,
      expansions:[{id:7,name:'Fictional Expansion'},
        {id:45,name:'Different Expansion'}],
      zones:[
        {zone_id:53,zone_name:'Synthetic Raid',wcl_frozen:false,
          expansion_id:7,journal_id_fields_complete:false,
          encounters:[{wcl_encounter_id:101,name:'Boss One',
            blizzard_journal_encounter_id:0},
            {wcl_encounter_id:102,name:'Boss Two',
              blizzard_journal_encounter_id:300}]},
        {zone_id:55,zone_name:'Synthetic M+ Candidate',
          wcl_frozen:false,expansion_id:7,journal_id_fields_complete:true,
          encounters:[]},
        {zone_id:11,zone_name:'Unrelated old zone',
          wcl_frozen:true,expansion_id:45,journal_id_fields_complete:true,
          encounters:[{wcl_encounter_id:1,name:'Ancient',
            blizzard_journal_encounter_id:200}]}
      ]
    },blizzard:{requests:4}};
  const pinnedGraphql={
    expansion_index:{requestBodySha256:a,responseSha256:b,responseBytes:296},
    all_expansion_zones:{requestBodySha256:c,responseSha256:d,responseBytes:23857}
  };
  const seal=(data=report)=>{
    const reportBytes=Buffer.from(JSON.stringify(data),'utf8');
    return {reportBytes,expectedReportSha256:digest(reportBytes),
      pinnedGraphql,sourceNamespace:'retail',expansionId:7};
  };
  return {report,pinnedGraphql,seal};
};

test('already collected source is reused exactly once with ZERO network or OAuth calls',async()=>{
  const f=fixture(),opts=f.seal();
  const port=createSealedV155CatalogPort(opts);
  const one=await port.readCatalog();
  const two=await port.readCatalog();
  assert.deepEqual(one,two);
  assert.equal(one.schema,'WCL_CATALOG_PORT_V1');
  assert.equal(one.contents.length,2);
  assert.deepEqual(one.dpsSpecializations,[]);
  assert.equal(port.getLastDiagnostics().metadataRequestsPerformedHere,0);
  assert.equal(port.getLastDiagnostics().oauthRequestsPerformedHere,0);
  assert.equal(port.getLastDiagnostics().sourceGraphqlBodiesAvailable,false);
  assert.equal(port.getLastDiagnostics().sourceReportIdentityPinned,true);
});

test('the real v155 zone fields are mapped without fabricating raid class or difficulty',async()=>{
  const p=createSealedV155CatalogPort(fixture().seal());
  const z=(await p.readCatalog()).contents[0];
  assert.equal(z.zoneId,53);
  assert.equal(z.type,'unclassified');
  assert.deepEqual(z.encounters.map(e=>({
    id:e.id,difficulties:e.difficulties,partitions:e.partitions
  })),[
    {id:101,difficulties:null,partitions:null},
    {id:102,difficulties:null,partitions:null}
  ]);
  assert.equal(p.getLastDiagnostics().claims.activeRaidAndMplus,
    'SAME_BUILD_V163_JOIN_NOT_REPRODUCED');
});

test('the partial source feeds existing normalized discovery without enabling ranking scope',async()=>{
  const p=createSealedV155CatalogPort(fixture().seal());
  const {profile}=await discoverEnvironment({catalogPort:p,sha256:digest,
    observedAtMs:1800000000000});
  assert.equal(profile.status,'UNRESOLVED');
  assert.equal(profile.quality.supportedEncounters,0);
  assert.equal(profile.quality.unresolvedOrUnsupportedEncounters,2);
  assert.equal(profile.quality.npcRulesCertified,0);
  await assert.rejects(()=>buildAnalysisScope({
    profile,sha256:digest,
    selections:{startMs:1,endMs:2,depth:10}
  }),/SCOPE_ZONE_EMPTY_OR_DUPLICATE/);
});

test('the requested expansion is selected by source ID, not highest ID or name',async()=>{
  const f=fixture();
  const catalog=await createSealedV155CatalogPort({
    ...f.seal(),expansionId:45
  }).readCatalog();
  assert.deepEqual(catalog.contents.map(z=>z.zoneId),[11]);
  assert.equal(catalog.contents[0].type,'unclassified');
  assert.equal(catalog.dpsSpecializations.length,0);
});

test('a changed report fails against externally pinned raw report SHA',()=>{
  const f=fixture(),original=f.seal();
  const changed=Buffer.from(original.reportBytes);
  changed[changed.length-2]^=1;
  assert.throws(()=>createSealedV155CatalogPort({
    ...original,reportBytes:changed
  }),/V155_WCL_REPORT_SHA_MISMATCH/);
});

test('an untrusted report SHA or missing independently pinned GraphQL identities fails closed',()=>{
  const f=fixture(),base=f.seal();
  assert.throws(()=>createSealedV155CatalogPort({
    ...base,expectedReportSha256:'0'.repeat(64)
  }),/V155_WCL_REPORT_SHA_MISMATCH/);
  assert.throws(()=>createSealedV155CatalogPort({
    ...base,pinnedGraphql:undefined
  }),/V155_WCL_EXTERNAL_PINS_REQUIRED/);
});

test('a changed original request hash, response digest or exact byte length is rejected',()=>{
  const f=fixture(),base=f.seal();
  for(const field of ['requestBodySha256','responseSha256','responseBytes']){
    const pins=structuredClone(f.pinnedGraphql);
    pins.all_expansion_zones[field]=field==='responseBytes'?1:'f'.repeat(64);
    assert.throws(()=>createSealedV155CatalogPort({
      ...base,pinnedGraphql:pins
    }),/V155_WCL_SOURCE_PIN_MISMATCH/);
  }
});

test('legacy reports lacking the original two GraphQL SHA fingerprints are not retroactively certified',()=>{
  const f=fixture();
  delete f.report.wcl.original_graphql_http_bodies;
  assert.throws(()=>createSealedV155CatalogPort(f.seal()),
    /V155_WCL_EXTERNAL_PINS_REQUIRED|V155_WCL_SOURCE_PIN_MISMATCH/);
});

test('failed, partial or guessed authentication reports are rejected',()=>{
  for(const edit of [
    x=>{x.wcl.requests=1;},
    x=>{x.wcl.status='NOT_VERIFIED';},
    x=>{x.wcl.zone_source_scope='MIDNIGHT_ONLY';},
    x=>{x.mode='SYNTHETIC';}
  ]){
    const f=fixture();edit(f.report);
    assert.throws(()=>createSealedV155CatalogPort(f.seal()),
      /V155_WCL_SOURCE_REPORT_NOT_COMPLETE/);
  }
});

test('cross-expansion contamination or duplicated WCL identifiers is never accepted',()=>{
  for(const edit of [
    x=>{x.wcl.zones[0].expansion_id=999;},
    x=>{x.wcl.zones[1].zone_id=53;},
    x=>{x.wcl.zones[0].encounters[1].wcl_encounter_id=101;},
    x=>{x.wcl.expansions[1].id=7;}
  ]){
    const f=fixture();edit(f.report);
    assert.throws(()=>createSealedV155CatalogPort(f.seal()),
      /V155_WCL_ZONE_SOURCE_INVALID|V155_WCL_DUPLICATE_ZONE|V155_WCL_DUPLICATE_ENCOUNTER|V155_WCL_EXPANSIONS_INVALID/);
  }
});

test('the journal completeness summary cannot contradict the captured encounter IDs',()=>{
  const f=fixture();f.report.wcl.zones[0].journal_id_fields_complete=true;
  assert.throws(()=>createSealedV155CatalogPort(f.seal()),
    /V155_WCL_JOURNAL_SUMMARY_MISMATCH/);
});

test('readCatalog returns defensive copies; changing a caller copy never poisons the pinned cache',async()=>{
  const p=createSealedV155CatalogPort(fixture().seal());
  const first=await p.readCatalog();
  first.contents[0].name='Poisoned';
  first.contents[0].encounters[0].name='Poisoned';
  const second=await p.readCatalog();
  assert.equal(second.contents[0].name,'Synthetic Raid');
  assert.equal(second.contents[0].encounters[0].name,'Boss One');
});

test('reused source report fingerprint follows original report SHA, not a hard-coded current season',async()=>{
  const f=fixture();
  const a=createSealedV155CatalogPort(f.seal());
  const original=await discoverEnvironment({catalogPort:a,
    sha256:digest,observedAtMs:2000});
  const newer=structuredClone(f.report);
  newer.wcl.zones[0].zone_name='Different Raid Candidate';
  const next=createSealedV155CatalogPort(f.seal(newer));
  const changed=await discoverEnvironment({catalogPort:next,
    sha256:digest,observedAtMs:3000,previousProfile:original.profile});
  assert.equal(changed.reused,false);
  assert.equal(changed.profile.version,2);
  assert.notEqual(changed.profile.sourceFingerprint,original.profile.sourceFingerprint);
  assert.deepEqual(changed.changed.zoneIds,[53]);
});
