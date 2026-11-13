/**
 * Read-only reuse of the EXISTING authenticated v155/v242 WCL source stage.
 *
 * Owners:
 * - simc-secondary-optimizer-runner/runner/v155_season_api_probe.py (HTTP)
 * - simc-secondary-optimizer-runner/runner/v242_authenticated_season_source_stage.py
 *   (v217-sealed report and request/response SHA metadata)
 * - simc-secondary-optimizer-runner/runner/v163_zero_seed_db2_join.py
 *   (separate same-build season/raid/M+ membership selection)
 *
 * This module makes ZERO requests, does NOT implement OAuth or a collector,
 * and cannot reproduce the original GraphQL HTTP bytes. v155/v242 keeps
 * digests/lengths but NOT raw response bodies. A caller must independently
 * pin both the exact report bytes and BOTH WCL request/response identities.
 *
 * The v155 report has zone ID/name/frozen/expansion/encounter metadata,
 * but lacks WCL class/spec listing and zone difficulty/partition scope.
 * Those fields remain explicitly UNRESOLVED in the V2 catalog.
 */
import {createHash} from 'node:crypto';

const fail=code=>{throw Error(code);};
const need=(ok,code)=>{if(!ok)fail(code);};
const positive=n=>Number.isSafeInteger(n)&&n>0;
const sha=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const text=x=>typeof x==='string'&&x.trim().length>0&&
  x.trim().length<=160;
const opaque=x=>typeof x==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9:._/-]{0,80}$/.test(x);
const own=(obj,k)=>obj&&Object.hasOwn(obj,k);
const hash=b=>createHash('sha256').update(b).digest('hex');
const duplicate=(items,fn)=>new Set(items.map(fn)).size!==items.length;
const deepCopy=x=>JSON.parse(JSON.stringify(x));
const SOURCES=['expansion_index','all_expansion_zones'];

function validatePinnedProofs(observed,expected){
  need(observed&&typeof observed==='object'&&
    expected&&typeof expected==='object'&&
    Object.keys(expected).length===2&&SOURCES.every(k=>own(expected,k)),
    'V155_WCL_EXTERNAL_PINS_REQUIRED');
  const checked={};
  for(const key of SOURCES){
    const a=observed[key],b=expected[key];
    need(a&&b&&sha(a.request_body_sha256)&&
      sha(a.raw_response_sha256)&&positive(a.raw_response_bytes)&&
      a.raw_response_bytes<=1_500_000&&
      a.request_body_sha256===b.requestBodySha256&&
      a.raw_response_sha256===b.responseSha256&&
      a.raw_response_bytes===b.responseBytes,
      'V155_WCL_SOURCE_PIN_MISMATCH');
    checked[key]={
      requestBodySha256:a.request_body_sha256,
      responseSha256:a.raw_response_sha256,
      responseBytes:a.raw_response_bytes
    };
  }
  return checked;
}
function checkedReport({reportBytes,expectedReportSha256,pinnedGraphql,sourceNamespace,expansionId}){
  need(opaque(sourceNamespace)&&positive(expansionId)&&sha(expectedReportSha256),
    'V155_WCL_REUSE_SCOPE_OR_REPORT_PIN_INVALID');
  need(reportBytes instanceof Uint8Array&&
    reportBytes.length>0&&reportBytes.length<=3_000_000,
    'V155_WCL_REPORT_BYTES_REQUIRED');
  const raw=Buffer.from(reportBytes);
  const reportHash=hash(raw);
  need(reportHash===expectedReportSha256,'V155_WCL_REPORT_SHA_MISMATCH');
  let report;
  try{report=JSON.parse(raw.toString('utf8'));}
  catch{fail('V155_WCL_REPORT_JSON_INVALID');}
  need(report?.schema==='v155_season_discovery_provider_probe_v1'&&
    report.mode==='LIVE_AUTHENTICATED_BOUNDED'&&
    report.wcl?.requests===2&&
    report.wcl.status==='ZONES_WITH_JOURNAL_IDS_RETURNED'&&
    report.wcl.zone_source_scope==='ALL_WCL_EXPANSIONS',
    'V155_WCL_SOURCE_REPORT_NOT_COMPLETE');
  const pins=validatePinnedProofs(
    report.wcl.original_graphql_http_bodies,pinnedGraphql);
  const expansions=report.wcl.expansions;
  need(Array.isArray(expansions)&&expansions.length>0&&
    expansions.length<=100&&
    expansions.every(x=>positive(x?.id)&&text(x?.name))&&
    !duplicate(expansions,x=>x.id),
    'V155_WCL_EXPANSIONS_INVALID');
  need(expansions.some(x=>x.id===expansionId),
    'V155_WCL_SELECTED_EXPANSION_NOT_IN_SOURCE');
  const zones=report.wcl.zones;
  need(Array.isArray(zones)&&zones.length>0&&zones.length<=1500,
    'V155_WCL_ZONES_INVALID');
  need(!duplicate(zones,x=>x.zone_id),'V155_WCL_DUPLICATE_ZONE');
  const expIds=new Set(expansions.map(x=>x.id));
  const contents=[];
  for(const zone of zones){
    need(positive(zone?.zone_id)&&text(zone?.zone_name)&&
      expIds.has(zone.expansion_id)&&
      (zone.wcl_frozen===true||zone.wcl_frozen===false||
        zone.wcl_frozen===null)&&
      Array.isArray(zone.encounters)&&zone.encounters.length<=80,
      'V155_WCL_ZONE_SOURCE_INVALID');
    need(!duplicate(zone.encounters,x=>x.wcl_encounter_id),
      'V155_WCL_DUPLICATE_ENCOUNTER');
    const entries=zone.encounters.map(e=>{
      need(positive(e?.wcl_encounter_id)&&text(e?.name)&&
        (e.blizzard_journal_encounter_id===null||
          Number.isSafeInteger(e.blizzard_journal_encounter_id)),
        'V155_WCL_ENCOUNTER_SOURCE_INVALID');
      // A WCL journalID of 0 is NOT a Blizzard join.
      return {id:e.wcl_encounter_id,name:e.name,
        difficulties:null,partitions:null};
    });
    const complete=zone.encounters.every(
      e=>positive(e.blizzard_journal_encounter_id));
    need(zone.journal_id_fields_complete===complete,
      'V155_WCL_JOURNAL_SUMMARY_MISMATCH');
    if(zone.expansion_id!==expansionId)continue;
    // V155's frozen=false means active CANDIDATE, not proven current raid.
    // 'raid' and 'dungeon' remain undecidable without a separately pinned
    // same-build v163 source join and a classification policy.
    contents.push({zoneId:zone.zone_id,name:zone.zone_name,
      type:'unclassified',encounters:entries});
  }
  const catalogKey='wcl:'+sourceNamespace+':v155:'+expansionId+
    ':report:'+reportHash.slice(0,32);
  need(catalogKey.length<=160,'V155_WCL_CATALOG_KEY_TOO_LONG');
  const catalog={schema:'WCL_CATALOG_PORT_V1',
    catalogKey,contents,dpsSpecializations:[]};
  const diagnostics={
    schema:'WCL_V155_STAGE_REUSE_V1',kind:'REUSED_ALREADY_COLLECTED_WCL_REPORT',
    sourceOwner:'simc-secondary-optimizer-runner/v155-v242-v217',
    sourceNamespace,expansionId,reportSha256:reportHash,
    graphqlProofs:pins,metadataRequestsPerformedHere:0,
    oauthRequestsPerformedHere:0,blizzardRequestsPerformedHere:0,
    nativeCallsPerformedHere:0,
    sourceGraphqlBodiesAvailable:false,
    sourceHttpAuthenticationReperformed:false,
    sourceReportIdentityPinned:true,
    claims:{
      zones:'EXPANSION_SCOPED_SOURCE_CANDIDATES',
      activeRaidAndMplus:'SAME_BUILD_V163_JOIN_NOT_REPRODUCED',
      zoneKind:'UNRESOLVED',
      encounterDifficulties:'UNRESOLVED',
      encounterPartitions:'UNRESOLVED',
      dpsSpecializations:'UNRESOLVED',
      npcAndBossDps:'UNRESOLVED',
      fullCurrentSeason:'UNRESOLVED'
    },
    zonesForExpansion:contents.length
  };
  return {catalog,diagnostics};
}

/**
 * Returns the existing WclCatalogPort interface without a network client.
 * All input verification happens before the port becomes usable. The
 * provided report's exact byte SHA MUST be sourced from the independently
 * trusted v217 stage receipt, not copied from an untrusted report field.
 */
export function createSealedV155CatalogPort(args={}){
  const {catalog,diagnostics}=checkedReport(args);
  return Object.freeze({
    readCatalog:async()=>deepCopy(catalog),
    getLastDiagnostics:()=>deepCopy(diagnostics)
  });
}
