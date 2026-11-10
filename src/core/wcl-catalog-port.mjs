/**
 * Explicitly injected Warcraft Logs v2 catalog adapter (OFFLINE-safe).
 * GraphQL selections follow the published WCL Warcraft schema. No fetch, OAuth,
 * env, scheduler, NPC targets, quota admission or persistence is implemented.
 * A caller MUST provide queryGraphql and separately authorize any live I/O.
 *
 * WCL Zone offers zone-level difficulties/partitions but does not expose a
 * raid/dungeon classification, a season ID or GameSpec DPS role. Those are
 * NEVER guessed: a versioned external policy may supply classifications.
 */
const fail = code => { throw new Error(code); };
const need = (value,code) => { if (!value) fail(code); };
const positive = value => Number.isSafeInteger(value) && value>0;
const nonnegative = value => Number.isSafeInteger(value) && value>=0;
const opaque = value => typeof value==='string' && /^[\x21-\x7e]{1,64}$/.test(value);
const text = value => typeof value==='string' && value.trim().length>0 && value.length<=160;
const unique = (list,property,error) => {
  const seen=new Set();
  for (const entry of list) {
    need(!seen.has(entry[property]),error);
    seen.add(entry[property]);
  }
  return list;
};
const integerIds = (value,valid,error) => {
  need(Array.isArray(value),error);
  const numbers=value.map(x=>{
    need(valid(x),error);
    return x;
  });
  need(new Set(numbers).size===numbers.length,error);
  return numbers.slice().sort((a,b)=>a-b);
};

// No WCL GraphQL request is performed by this module by itself.
// https://www.warcraftlogs.com/v2-api-docs/warcraft/worlddata.doc.html
// https://www.warcraftlogs.com/v2-api-docs/warcraft/gamedata.doc.html
export const WCL_DIRECTORY_QUERY=`query PlatformCatalogDirectory {
  rateLimitData { currentRequest }
  worldData { expansions { id name } }
  gameData { classes { id name slug specs { id name slug } } }
}`;

// Zone-level difficulties and partitions are *not* evidence that every
// encounter supports them. The API list is not paginated; enforce a local cap.
export const WCL_EXPANSION_ZONES_QUERY=`query PlatformExpansionZones($expansionId: Int!) {
  rateLimitData { currentRequest }
  worldData { zones(expansion_id: $expansionId) {
    id name frozen
    difficulties { id name sizes }
    partitions { id name compactName default }
    encounters { id name journalID }
  } }
}`;

const cost = response => {
  let current=response?.data?.rateLimitData?.currentRequest;
  if (typeof current==='string') {
    try { current=JSON.parse(current); } catch { return null; }
  }
  return typeof current?.total==='number' && Number.isFinite(current.total) && current.total>=0 ? current.total : null;
};

/**
 * @param {object} options
 * @param {(document:string,variables:object)=>Promise<{httpStatus:number,body:object}>} options.queryGraphql
 * @param {number} options.expansionId - explicitly selected, never latest by guess
 * @param {string} options.sourceNamespace - e.g. retail; caller attests endpoint
 * @param {string} options.policyVersion - version of separately verified classifications
 * @param {(zone:object, expansion:object)=>('raid'|'dungeon'|'other'|null)} [options.classifyZone]
 * @param {(spec:object,klass:object)=>('dps'|'tank'|'healer'|null)} [options.classifySpec]
 * @param {(encounter:object,zone:object,expansion:object)=>({difficulties:number[],partitions:number[]}|null)} [options.confirmEncounterSupport]
 */
export function createWclCatalogPort({queryGraphql,expansionId,sourceNamespace,
  policyVersion='unverified',classifyZone=null,classifySpec=null,
  confirmEncounterSupport=null,maxExpansions=80,maxZones=160,
  maxClasses=64,maxEncountersPerZone=256,maxSpecsPerClass=16,
  maxResponseCharacters=2_000_000}={}) {
  need(typeof queryGraphql==='function' && positive(expansionId) &&
    opaque(sourceNamespace) && opaque(policyVersion), 'WCL_CATALOG_CONFIG_INVALID');
  for (const [value,cap] of [[maxExpansions,256],[maxZones,512],[maxClasses,128],
    [maxEncountersPerZone,512],[maxSpecsPerClass,64],[maxResponseCharacters,10_000_000]])
    need(positive(value) && value<=cap,'WCL_CATALOG_BOUNDS_INVALID');
  for (const fn of [classifyZone,classifySpec,confirmEncounterSupport])
    need(fn===null||typeof fn==='function','WCL_CATALOG_POLICY_INVALID');
  need((classifyZone===null && classifySpec===null && confirmEncounterSupport===null) ||
    policyVersion!=='unverified','WCL_CATALOG_POLICY_VERSION_REQUIRED');
  let lastDiagnostics=null;

  const queryOnce=async (document,variables) => {
    const response=await queryGraphql(document,variables);
    need(response && response.httpStatus===200 && response.body &&
      typeof response.body==='object' && !Array.isArray(response.body) &&
      (response.body.errors==null || (Array.isArray(response.body.errors)&&
        response.body.errors.length===0)),'WCL_CATALOG_GRAPHQL_UNCERTAIN');
    const length=JSON.stringify(response.body).length;
    need(length<=maxResponseCharacters,'WCL_CATALOG_RESPONSE_TOO_LARGE');
    need(response.body.data && typeof response.body.data==='object',
      'WCL_CATALOG_DATA_MISSING');
    return response.body;
  };
  const readCatalog=async()=>{
    lastDiagnostics=null; // a prior successful fetch is not this attempt's evidence
    const directory=await queryOnce(WCL_DIRECTORY_QUERY,{});
    const expansions=directory.data.worldData?.expansions;
    need(Array.isArray(expansions) && expansions.length<=maxExpansions,
      'WCL_EXPANSIONS_UNAVAILABLE_OR_UNBOUNDED');
    unique(expansions,'id','WCL_EXPANSION_DUPLICATE');
    for (const expansion of expansions)
      need(positive(expansion?.id) && text(expansion.name),'WCL_EXPANSION_INVALID');
    const expansion=expansions.find(x=>x.id===expansionId);
    need(expansion,'WCL_EXPANSION_NOT_DISCOVERED');
    const rawClasses=directory.data.gameData?.classes;
    need(rawClasses==null || (Array.isArray(rawClasses) &&
      rawClasses.length<=maxClasses),'WCL_CLASSES_UNBOUNDED');
    const classes=rawClasses??[];
    unique(classes,'id','WCL_CLASS_DUPLICATE');
    for (const klass of classes) {
      need(positive(klass?.id)&&text(klass.name)&&opaque(klass.slug),
        'WCL_CLASS_INVALID');
      need(klass.specs==null || (Array.isArray(klass.specs) &&
        klass.specs.length<=maxSpecsPerClass),'WCL_SPECS_UNBOUNDED');
      if (klass.specs) {
        unique(klass.specs,'id','WCL_SPEC_DUPLICATE');
        for(const spec of klass.specs)
          need(positive(spec?.id)&&text(spec.name)&&opaque(spec.slug),'WCL_SPEC_INVALID');
      }
    }
    const detail=await queryOnce(WCL_EXPANSION_ZONES_QUERY,{expansionId});
    const rawZones=detail.data.worldData?.zones;
    need(Array.isArray(rawZones)&&rawZones.length<=maxZones,
      'WCL_ZONES_UNAVAILABLE_OR_UNBOUNDED');
    unique(rawZones,'id','WCL_ZONE_DUPLICATE');
    let unresolvedZones=0,unresolvedRoles=0,unresolvedEncounters=0,totalSpecs=0;
    const contents=rawZones.map(zone=>{
      need(positive(zone?.id) && text(zone.name) && typeof zone.frozen==='boolean',
        'WCL_ZONE_INVALID');
      let type='unclassified';
      if (classifyZone) {
        const resolved=classifyZone(zone,expansion);
        need(['raid','dungeon','other',null].includes(resolved),
          'WCL_ZONE_CLASSIFICATION_INVALID');
        if(resolved!==null)type=resolved;
      }
      if(type==='unclassified'||type==='other')unresolvedZones++;
      const zoneDifficulties=zone.difficulties==null ? null :
        integerIds(zone.difficulties.map(d=>d?.id),positive,'WCL_ZONE_DIFFICULTY_INVALID');
      const zonePartitions=zone.partitions==null ? null :
        integerIds(zone.partitions.map(p=>p?.id),nonnegative,'WCL_ZONE_PARTITION_INVALID');
      if(zone.encounters!=null)
        need(Array.isArray(zone.encounters)&&zone.encounters.length<=maxEncountersPerZone,
          'WCL_ENCOUNTERS_UNBOUNDED');
      const encounters=zone.encounters==null?null:zone.encounters.map(e=>{
        need(positive(e?.id)&&text(e.name)&&nonnegative(e.journalID),
          'WCL_ENCOUNTER_INVALID');
        let supported=null;
        if(type==='raid'||type==='dungeon')
          supported=confirmEncounterSupport?.(e,zone,expansion)??null;
        need(supported===null || (supported && typeof supported==='object' &&
          Array.isArray(supported.difficulties) && Array.isArray(supported.partitions)),
          'WCL_ENCOUNTER_POLICY_INVALID');
        let difficulties=null,partitions=null;
        if(supported!==null) {
          // Zone metadata is the outer bound, not encounter-specific proof.
          need(zoneDifficulties!==null && zonePartitions!==null,
            'WCL_ENCOUNTER_ZONE_SUPPORT_UNKNOWN');
          difficulties=integerIds(supported.difficulties,positive,
            'WCL_ENCOUNTER_DIFFICULTY_INVALID');
          partitions=integerIds(supported.partitions,nonnegative,
            'WCL_ENCOUNTER_PARTITION_INVALID');
          need(difficulties.every(id=>zoneDifficulties.includes(id)) &&
            partitions.every(id=>zonePartitions.includes(id)),
            'WCL_ENCOUNTER_SUPPORT_OUTSIDE_ZONE');
        } else unresolvedEncounters++;
        return {id:e.id,name:e.name,difficulties,partitions};
      });
      if(encounters!==null)unique(encounters,'id','WCL_ENCOUNTER_DUPLICATE');
      return {zoneId:zone.id,name:zone.name,type,encounters};
    });
    const dpsSpecializations=[];
    for(const klass of classes) {
      for (const spec of klass.specs??[]) {
        totalSpecs++;
        const role=classifySpec?.(spec,klass)??null;
        need(['dps','healer','tank',null].includes(role),
          'WCL_SPEC_CLASSIFICATION_INVALID');
        if(role===null)unresolvedRoles++;
        if(role==='dps')dpsSpecializations.push({
          key:'wcl:'+klass.id+':'+spec.id,
          className:klass.name,specName:spec.name,role:'dps'});
      }
      if(klass.specs===null)unresolvedRoles++;
    }
    const catalog={schema:'WCL_CATALOG_PORT_V1',
      catalogKey:'wcl:'+sourceNamespace+':expansion:'+expansionId+':policy:'+policyVersion,
      contents,dpsSpecializations};
    need(catalog.catalogKey.length<=160,'WCL_CATALOG_KEY_TOO_LONG');
    lastDiagnostics=Object.freeze({
      schema:1,kind:'WCL_OFFICIAL_METADATA_ADAPTER',
      upstreamSchema:'WCL_WARCRAFT_V2_PUBLIC_DOCS',expansionId,
      expansionName:expansion.name,requestsObserved:2,
      observedPoints:[cost(directory),cost(detail)],
      zoneCount:rawZones.length,classesReturned:classes.length,
      specializationsReturned:totalSpecs,dpsRolesResolved:dpsSpecializations.length,
      unresolvedZones,unresolvedRoles,unresolvedEncounters,
      missingClasses:rawClasses==null,
      seasonId:'UNRESOLVED',npcPolicy:'UNRESOLVED',
      zoneDifficultyScope:'ZONE_LEVEL_NOT_ENCOUNTER_CERTIFICATION',
      liveMetadataVerified:false
    });
    return catalog;
  };
  return {readCatalog,getLastDiagnostics:()=>lastDiagnostics};
}
