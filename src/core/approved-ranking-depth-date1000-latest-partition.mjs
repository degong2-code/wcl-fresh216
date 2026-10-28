/**
 * Corrected dated Heroic Nek'zali depth experiment.
 * Same 2026-10-22..28 KST filter and BossDPS pages1..10, but leaves
 * partition unspecified so WCL selects the latest partition by default.
 */
import {
  DATED_TARGET,summarizeDatedDepth
} from './approved-ranking-depth-date1000-trial.mjs';

export const LATEST_REQUEST=
  'experiments/approved-nekzali-20261022-28-boss1000-latest-partition.json';
export const LATEST_ID='FRESH216_NEKZALI_20261022_28_BOSS1000_LATEST_PARTITION_20261028';
export const LATEST_APPROVAL=
  'OWNER_APPROVED_20261028_NEKZALI_20261022_28_BOSS1000_LATEST_PARTITION_CORRECTION';
export const LATEST_ONCE_REF=
  'refs/heads/wcl-fresh216-approved-nekzali-20261022-28-boss1000-latest-partition-consumed';
export const LATEST_TARGET=Object.freeze({
  encounterId:3470,difficulty:4,
  startMs:DATED_TARGET.startMs,endMs:DATED_TARGET.endMs,
  filter:DATED_TARGET.filter,maxGraphql:3,
  bossPages:DATED_TARGET.bossPages,specs:DATED_TARGET.specs
});
export function validateLatestRequest(request){
  const keys=['request_id','approval','encounter_id','difficulty',
    'partition_mode','date_start_kst','date_end_kst','filter','specs',
    'total_dps_pages','boss_dps_pages','max_graphql'];
  if(!request||typeof request!=='object'||Array.isArray(request)||
     Object.keys(request).sort().join('|')!==keys.slice().sort().join('|'))
    throw Error('MEASUREMENT_REQUEST_FIELDS_INVALID');
  if(request.request_id!==LATEST_ID||request.approval!==LATEST_APPROVAL||
     request.encounter_id!==3470||request.difficulty!==4||
     request.partition_mode!=='LATEST_DEFAULT'||
     request.date_start_kst!=='2026-10-22'||request.date_end_kst!=='2026-10-28'||
     request.filter!==LATEST_TARGET.filter||request.max_graphql!==3||
     JSON.stringify(request.specs)!==JSON.stringify(LATEST_TARGET.specs.map(s=>s.key))||
     JSON.stringify(request.total_dps_pages)!=='[1]'||
     JSON.stringify(request.boss_dps_pages)!==JSON.stringify(LATEST_TARGET.bossPages))
    throw Error('MEASUREMENT_REQUEST_SCOPE_INVALID');
  return true;
}
export function buildLatestDepthQuery(spec){
  if(!LATEST_TARGET.specs.some(s=>s.key===spec?.key&&
    s.className===spec.className&&s.specName===spec.specName))
    throw Error('MEASUREMENT_SPEC_NOT_ALLOWLISTED');
  const boss=LATEST_TARGET.bossPages.map(p=>
    'b'+p+':characterRankings(difficulty:$difficulty,className:$className,'+
    'specName:$specName,metric:bossdps,page:'+p+',filter:$filter)'
  ).join(' ');
  return {
    query:'query Fresh216DatedNekzali1000Latest($id:Int!,$difficulty:Int!,'+
      '$className:String!,$specName:String!,$filter:String!){'+
      'rateLimitData{currentRequest limitPerHour pointsSpentThisHour databaseLimitPerHour databasePointsSpentThisHour userHasRemainingPoints} '+
      'worldData{encounter(id:$id){'+
      't1:characterRankings(difficulty:$difficulty,className:$className,'+
      'specName:$specName,metric:dps,page:1,filter:$filter) '+boss+'}}}',
    variables:{id:3470,difficulty:4,className:spec.className,
      specName:spec.specName,filter:LATEST_TARGET.filter}
  };
}
export function summarizeLatestDepth(spec,args){
  const out=summarizeDatedDepth(spec,args);
  return {...out,partition:null,partitionMode:'LATEST_DEFAULT'};
}
