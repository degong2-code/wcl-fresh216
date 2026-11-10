/** Immutable validated scope builder. No ranking requests or WCL credentials. */
import {canonicalCatalogJson} from './environment-discovery.mjs';
const fail = code => { throw new Error(code); };
const need = (ok,code) => { if (!ok) fail(code); };
const positive = n => Number.isSafeInteger(n)&&n>0;
const nonnegative = n => Number.isSafeInteger(n)&&n>=0;
const digest = s => typeof s==='string' && /^[a-f0-9]{64}$/.test(s);
const cmp = (a,b) => String(a).localeCompare(String(b),'en');
const selected = (a,all,name) => {
  need(a==null||Array.isArray(a),'SCOPE_'+name+'_INVALID');
  const ids=a??all;
  need(ids.length>0 && new Set(ids).size===ids.length,'SCOPE_'+name+'_EMPTY_OR_DUPLICATE');
  return ids.slice().sort(cmp);
};
const intersection = arrays => arrays.reduce((a,b)=>a.filter(x=>b.includes(x)));

export async function buildAnalysisScope({profile,selections,sha256}={}) {
  need(profile?.schema===1 && profile.catalog?.schema==='WCL_CATALOG_NORMALIZED_V1' &&
    digest(profile.sourceFingerprint) && typeof sha256==='function' &&
    selections && typeof selections==='object','SCOPE_INPUT_INVALID');
  const {catalog}=profile;
  const supportedZones=catalog.contents.filter(c=>c.encounters?.some(e=>e.status==='DISCOVERED'));
  const zoneIds=selected(selections.zoneIds,supportedZones.map(c=>c.zoneId),'ZONE');
  const zones=zoneIds.map(id=>{
    need(positive(id),'SCOPE_ZONE_ID_INVALID');
    const z=catalog.contents.find(c=>c.zoneId===id);
    need(z && z.encounters?.some(e=>e.status==='DISCOVERED'),
      'SCOPE_ZONE_NOT_DISCOVERED');return z;
  });
  const possible=zones.flatMap(z=>z.encounters.filter(e=>e.status==='DISCOVERED')
    .map(e=>({zoneId:z.zoneId,...e})));
  const chosen=selected(selections.encounterIds,possible.map(e=>e.id),'ENCOUNTER');
  const encounters=chosen.map(id=>{
    need(positive(id),'SCOPE_ENCOUNTER_ID_INVALID');
    const options=possible.filter(e=>e.id===id);
    need(options.length===1,'SCOPE_ENCOUNTER_UNSUPPORTED_OR_AMBIGUOUS');
    return options[0];
  });
  const diffs=intersection(encounters.map(e=>e.difficulties));
  need(diffs.length>0,'SCOPE_DIFFICULTY_INTERSECTION_EMPTY');
  const difficultyId=selections.difficultyId ?? (diffs.length===1?diffs[0]:null);
  need(positive(difficultyId) && diffs.includes(difficultyId),'SCOPE_DIFFICULTY_REQUIRED_OR_UNSUPPORTED');
  const parts=intersection(encounters.map(e=>e.partitions));
  const partitionId=selections.partitionId ?? (parts.length===1?parts[0]:null);
  if (parts.length===0) {
    need(selections.partitionId==null,'SCOPE_PARTITION_UNSUPPORTED');
  } else need(nonnegative(partitionId) && parts.includes(partitionId),
    'SCOPE_PARTITION_REQUIRED_OR_UNSUPPORTED');
  const specKeys=selected(selections.specKeys,catalog.dpsSpecializations.map(s=>s.key),'SPEC');
  for(const id of specKeys)need(catalog.dpsSpecializations.some(s=>s.key===id),
    'SCOPE_SPEC_NOT_DISCOVERED');
  const {startMs,endMs,depth}=selections;
  need(nonnegative(startMs)&&positive(endMs)&&startMs<endMs,'SCOPE_TIME_RANGE_INVALID');
  need(positive(depth),'SCOPE_DEPTH_INVALID');
  const immutable={schema:1,environmentProfileId:profile.profileId,
    environmentFingerprint:profile.sourceFingerprint,
    catalogKey:catalog.catalogKey,zoneIds,encounterIds:chosen,
    difficultyId,partitionId,startMs,endMs,depth,specKeys,
    evidencePolicy:'EXACT_SAME_REPORT_FIGHT_ACTOR_V1',
    npcCertification:'UNRESOLVED'};
  const scopeHash=await sha256(canonicalCatalogJson(immutable));
  need(digest(scopeHash),'SCOPE_HASH_INVALID');
  return {...immutable,scopeHash};
}
