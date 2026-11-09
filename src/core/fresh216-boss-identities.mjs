/**
 * Encounter ID is the authoritative WCL identity.
 * Frozen 2026-10-22..27 A216/B500 snapshots contain reversed labels for
 * encounters 3455 and 3497; never rewrite their jobKeys or snapshot hashes.
 * Display labels and new source manifests use this corrected map.
 */
export const FRESH216_FROZEN_A216_SCOPE =
  'engine-fresh:heroic:2026-10-22_27:candidate-A';

export const FRESH216_BOSS_IDENTITIES=Object.freeze([
  {encounterId:3470,name:'네크잘리',frozenName:'네크잘리'},
  {encounterId:3445,name:'파수꾼',frozenName:'파수꾼'},
  {encounterId:3455,name:'바쉬니크',frozenName:'탐험가'},
  {encounterId:3497,name:'길 잃은 탐험가',frozenName:'바쉬니크'},
  {encounterId:3420,name:'스조라크',frozenName:'스조라크'},
  {encounterId:3421,name:'쌍곳니',frozenName:'쌍곳니'},
  {encounterId:3429,name:'똬리',frozenName:'똬리'},
  {encounterId:3492,name:'울라텍',frozenName:'울라텍'}
].map(Object.freeze));

const byID=new Map(FRESH216_BOSS_IDENTITIES.map(b=>[b.encounterId,b]));

/** Preserve byte-compatible jobKeys for the one pinned, frozen A216 source. */
export function bossesForFreshScope(scopeKey){
  return FRESH216_BOSS_IDENTITIES.map(b=>({
    name:scopeKey===FRESH216_FROZEN_A216_SCOPE?b.frozenName:b.name,
    encounterId:b.encounterId
  }));
}

/**
 * Read-only display projection. Never use canonicalJobKey to look up frozen
 * proofs: their identity is still original jobKey + rank + snapshotSha.
 */
export function canonicalFresh216JobLabel(jobKey,encounterId){
  if(typeof jobKey!=='string'||!Number.isSafeInteger(encounterId))
    throw Error('FRESH216_CANONICAL_JOB_INVALID');
  const parts=jobKey.split('|');
  if(parts.length!==3||parts.some(x=>!x))
    throw Error('FRESH216_CANONICAL_JOB_SHAPE');
  const identity=byID.get(encounterId);
  if(!identity)return {bossDisplayName:parts[0],canonicalJobKey:jobKey,
    correctedFromFrozenLabel:false,encounterId};
  if(parts[0]!==identity.name&&parts[0]!==identity.frozenName)
    throw Error('FRESH216_CANONICAL_JOB_ENCOUNTER_MISMATCH');
  return {bossDisplayName:identity.name,
    canonicalJobKey:[identity.name,parts[1],parts[2]].join('|'),
    correctedFromFrozenLabel:parts[0]!==identity.name,encounterId};
}
