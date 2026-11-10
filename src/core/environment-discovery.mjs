/**
 * Platform-neutral, offline WCL catalog normalization and versioned profile.
 * A WclCatalogPort returns NORMALIZED metadata. This module never queries WCL,
 * discovers NPC targets, certifies a BossDPS rule, or writes to a store.
 */
const fail = code => { throw new Error(code); };
const requireIt = (ok, code) => { if (!ok) fail(code); };
const positive = n => Number.isSafeInteger(n) && n > 0;
const nonnegative = n => Number.isSafeInteger(n) && n >= 0;
const label = s => typeof s === 'string' && s.trim().length > 0 && s.trim().length <= 160;
const opaque = s => typeof s === 'string' && s.length > 0 && s.length <= 160 && /^[\x21-\x7e]+$/.test(s);
const digest = s => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const compare = (a, b) => String(a).localeCompare(String(b), 'en');
const sortedUnique = (rows, key, error) => {
  const out = rows.slice().sort((a,b) => compare(key(a),key(b)));
  for (let i=1;i<out.length;i++) requireIt(key(out[i]) !== key(out[i-1]),error);
  return out;
};
const copy = value => JSON.parse(JSON.stringify(value));

/** Canonical serialization of already-normalized records; no host APIs. */
export function canonicalCatalogJson(value) {
  const visit = v => {
    if (Array.isArray(v)) return v.map(visit);
    if (v !== null && typeof v === 'object') {
      const out = {};
      for (const key of Object.keys(v).sort()) {
        requireIt(v[key] !== undefined, 'CATALOG_UNDEFINED_VALUE');
        out[key] = visit(v[key]);
      }
      return out;
    }
    requireIt(v === null || typeof v === 'string' || typeof v === 'boolean' ||
      (typeof v === 'number' && Number.isFinite(v)), 'CATALOG_INVALID_SCALAR');
    return v;
  };
  return JSON.stringify(visit(value));
}

export function normalizeWclCatalog(raw) {
  requireIt(raw && typeof raw === 'object' && !Array.isArray(raw) &&
    raw.schema === 'WCL_CATALOG_PORT_V1' && opaque(raw.catalogKey) &&
    Array.isArray(raw.contents) && Array.isArray(raw.dpsSpecializations),
  'CATALOG_CONTRACT_INVALID');
  const contents = sortedUnique(raw.contents.map(c => {
    requireIt(c && positive(c.zoneId) && label(c.name) && opaque(c.type) &&
      (c.encounters === null || c.encounters === undefined || Array.isArray(c.encounters)),
    'CATALOG_CONTENT_INVALID');
    const encounters = c.encounters == null ? null : sortedUnique(c.encounters.map(e => {
      requireIt(e && positive(e.id) && label(e.name) &&
        (e.difficulties == null || Array.isArray(e.difficulties)) &&
        (e.partitions == null || Array.isArray(e.partitions)),
      'CATALOG_ENCOUNTER_INVALID');
      const difficulties = e.difficulties == null ? null :
        sortedUnique(e.difficulties.map(n => {
          requireIt(positive(n), 'CATALOG_DIFFICULTY_INVALID'); return n;
        }), n => n, 'CATALOG_DIFFICULTY_DUPLICATE');
      const partitions = e.partitions == null ? null :
        sortedUnique(e.partitions.map(n => {
          requireIt(nonnegative(n), 'CATALOG_PARTITION_INVALID'); return n;
        }), n => n, 'CATALOG_PARTITION_DUPLICATE');
      return {id:e.id,name:e.name.trim(),difficulties,partitions,
        status:!difficulties || !partitions ? 'UNRESOLVED' :
          difficulties.length === 0 ? 'UNSUPPORTED' : 'DISCOVERED',
        npcPolicy:{status:'UNRESOLVED',candidateGameIds:[],certifiedRules:[]}};
    }),e => e.id,'CATALOG_ENCOUNTER_DUPLICATE');
    return {zoneId:c.zoneId,name:c.name.trim(),type:c.type,
      encounters,status:encounters === null ? 'UNRESOLVED' :
        encounters.some(e=>e.status==='DISCOVERED') ? 'DISCOVERED' :
        encounters.some(e=>e.status==='UNRESOLVED') ? 'UNRESOLVED' : 'UNSUPPORTED'};
  }), c=>c.zoneId,'CATALOG_ZONE_DUPLICATE');
  const dpsSpecializations = sortedUnique(raw.dpsSpecializations.map(s => {
    requireIt(s && opaque(s.key) && label(s.className) && label(s.specName) &&
      s.role === 'dps', 'CATALOG_SPEC_INVALID');
    return {key:s.key,className:s.className.trim(),specName:s.specName.trim(),role:'dps'};
  }), s=>s.key,'CATALOG_SPEC_DUPLICATE');
  return {schema:'WCL_CATALOG_NORMALIZED_V1',catalogKey:raw.catalogKey,
    contents,dpsSpecializations};
}

const entitiesChanged = (previous, current, key) => {
  const before = new Map((previous || []).map(e=>[key(e),canonicalCatalogJson(e)]));
  const after = new Map(current.map(e=>[key(e),canonicalCatalogJson(e)]));
  return [...new Set([...before.keys(),...after.keys()])]
    .filter(id=>before.get(id)!==after.get(id)).sort(compare);
};

/**
 * @param {object} options.catalogPort.readCatalog - injected read-only adapter;
 *   must return WCL_CATALOG_PORT_V1, not an invented WCL GraphQL shape.
 * @param {Function} options.sha256 - injected async or sync SHA-256 hex function.
 */
export async function discoverEnvironment({catalogPort,sha256,observedAtMs,
  previousProfile=null}={}) {
  requireIt(catalogPort && typeof catalogPort.readCatalog === 'function' &&
    typeof sha256 === 'function' && nonnegative(observedAtMs),
  'DISCOVERY_PORT_INVALID');
  const normalized = normalizeWclCatalog(await catalogPort.readCatalog());
  const fingerprint = await sha256(canonicalCatalogJson(normalized));
  requireIt(digest(fingerprint), 'DISCOVERY_FINGERPRINT_INVALID');
  if (previousProfile != null) requireIt(previousProfile.schema===1 &&
    positive(previousProfile.version) && digest(previousProfile.sourceFingerprint) &&
    previousProfile.catalog?.schema==='WCL_CATALOG_NORMALIZED_V1',
  'DISCOVERY_PREVIOUS_PROFILE_INVALID');
  if (previousProfile?.sourceFingerprint === fingerprint) {
    requireIt(canonicalCatalogJson(previousProfile.catalog)===canonicalCatalogJson(normalized),
      'DISCOVERY_FINGERPRINT_COLLISION');
    return {profile:copy(previousProfile),reused:true,changed:{zoneIds:[],specKeys:[]}};
  }
  const unsupported = normalized.contents.flatMap(c=>c.encounters || [])
    .filter(e=>e.status!=='DISCOVERED').length;
  const supported = normalized.contents.flatMap(c=>c.encounters || [])
    .filter(e=>e.status==='DISCOVERED').length;
  const profile = {
    schema:1,profileId:'wclenv:'+fingerprint.slice(0,24),
    version:(previousProfile?.version ?? 0)+1,
    sourceFingerprint:fingerprint,observedAtMs,
    status:supported>0 && normalized.dpsSpecializations.length>0?'DISCOVERED':'UNRESOLVED',
    quality:{supportedEncounters:supported,unresolvedOrUnsupportedEncounters:unsupported,
      unknownEncounterLists:normalized.contents.filter(c=>c.encounters===null).length,
      npcRulesCertified:0},catalog:normalized
  };
  const old=previousProfile?.catalog;
  return {profile,reused:false,changed:{
    zoneIds:entitiesChanged(old?.contents,normalized.contents,x=>x.zoneId),
    specKeys:entitiesChanged(old?.dpsSpecializations,normalized.dpsSpecializations,x=>x.key)
  }};
}
