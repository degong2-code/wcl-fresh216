import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FRESH216_BOSS_IDENTITIES,FRESH216_FROZEN_A216_SCOPE,
  bossesForFreshScope,canonicalFresh216JobLabel
} from '../src/core/fresh216-boss-identities.mjs';
import {
  FRESH_HEROIC_BOSSES,makeFreshDatedHeroicManifest,
  validateFreshCohortManifest
} from '../src/core/fresh-cohort-source.mjs';

test('official encounter ID 3455 is Vashnik and 3497 is Lost Explorers',()=>{
  assert.equal(FRESH216_BOSS_IDENTITIES.length,8);
  assert.deepEqual(FRESH_HEROIC_BOSSES.map(x=>x.name),[
    '네크잘리','파수꾼','바쉬니크','길 잃은 탐험가',
    '스조라크','쌍곳니','똬리','울라텍'
  ]);
  assert.deepEqual(FRESH_HEROIC_BOSSES.map(x=>x.encounterId),[
    3470,3445,3455,3497,3420,3421,3429,3492
  ]);
  assert.deepEqual(bossesForFreshScope('new-2026-scope'),FRESH_HEROIC_BOSSES);
  const canonical=makeFreshDatedHeroicManifest('new-2026-scope');
  assert.equal(canonical.bosses[2].name,'바쉬니크');
  assert.equal(canonical.bosses[3].name,'길 잃은 탐험가');
  assert.match(validateFreshCohortManifest(canonical),/^[0-9a-f]{64}$/);
  const swapped=structuredClone(canonical);
  swapped.bosses[2].name='탐험가';
  assert.throws(()=>validateFreshCohortManifest(swapped),
    /FRESH_COHORT_ROSTER_NOT_ATTESTED/);
});

test('frozen A216 manifest fingerprint is BYTE-COMPATIBLE with immutable evidence',()=>{
  const old=makeFreshDatedHeroicManifest(FRESH216_FROZEN_A216_SCOPE);
  assert.equal(old.bosses[2].name,'탐험가');
  assert.equal(old.bosses[3].name,'바쉬니크');
  assert.equal(validateFreshCohortManifest(old),
    '90734a11af49d46530f984edab1fafe473c90aab18e50651e549a27285467aae');
});

test('canonical presentation corrects two frozen aliases without rewriting A/B/C proof keys',()=>{
  const a=canonicalFresh216JobLabel('탐험가|Mage|Frost',3455);
  assert.deepEqual(a,{bossDisplayName:'바쉬니크',
    canonicalJobKey:'바쉬니크|Mage|Frost',
    correctedFromFrozenLabel:true,encounterId:3455});
  const b=canonicalFresh216JobLabel('바쉬니크|Mage|Frost',3497);
  assert.equal(b.canonicalJobKey,'길 잃은 탐험가|Mage|Frost');
  assert.equal(b.correctedFromFrozenLabel,true);
  const newer=canonicalFresh216JobLabel('바쉬니크|Mage|Frost',3455);
  assert.equal(newer.correctedFromFrozenLabel,false);
  const other=canonicalFresh216JobLabel('울라텍|Shaman|Enhancement',3492);
  assert.equal(other.correctedFromFrozenLabel,false);
  assert.throws(()=>canonicalFresh216JobLabel('탐험가|Mage|Frost',3492),
    /FRESH216_CANONICAL_JOB_ENCOUNTER_MISMATCH/);
});
