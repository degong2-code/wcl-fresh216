import test from 'node:test';
import assert from 'node:assert/strict';
import { planFightFetches } from '../src/core/fetch-plan.mjs';

const slot = (changes = {}) => ({
  scopeKey: 'heroic:test-window',
  jobKey: 'BossA|Hunter|Marksmanship', rank: 3,
  snapshotSha: 'a'.repeat(64), status: 'PENDING',
  className: 'Hunter', specName: 'Marksmanship',
  totalDps: 1000, reportCode: 'SYNTHETIC-REPORT-1',
  fightId: 12, encounterId: 3470, difficulty: 4,
  reportRevision: 5, ...changes
});

test('cross-job same fight is planned once but rank provenance stays separate', () => {
  const a = slot();
  const b = slot({jobKey:'BossA|Mage|Arcane', className:'Mage',
    specName:'Arcane', snapshotSha:'b'.repeat(64), rank:19, totalDps:901});
  const p = planFightFetches([a,b]);
  assert.equal(p.inputSlotCount, 2);
  assert.equal(p.distinctFightRequests, 1);
  assert.equal(p.reusedReferences, 1);
  assert.equal(p.groups[0].slots.length, 2);
  assert.notEqual(p.groups[0].slots[0].snapshotSha, p.groups[0].slots[1].snapshotSha);
  assert.equal(p.groups[0].slots[0].totalDps, 901);
  assert.equal(p.groups[0].slots[1].totalDps, 1000);
  assert.equal('bossDps' in p.groups[0], false);
});

test('distinct fightIDs never merge, even under one report', () => {
  const p = planFightFetches([slot(),slot({rank:4,fightId:13})]);
  assert.equal(p.distinctFightRequests, 2);
});

test('different revisions and different difficulty are distinct evidence targets', () => {
  const p = planFightFetches([
    slot(), slot({rank:4,reportRevision:6}),
    slot({rank:5,difficulty:5})
  ]);
  assert.equal(p.distinctFightRequests, 3);
});

test('verified slot is skipped without triggering another query candidate', () => {
  const p = planFightFetches([slot({status:'VERIFIED'}),slot({rank:4})]);
  assert.equal(p.verifiedSkipped, 1);
  assert.equal(p.pendingSlotCount, 1);
  assert.equal(p.distinctFightRequests, 1);
});

test('anonymous rank is still fetchable but never auto-proved', () => {
  const p = planFightFetches([slot({rank:1})]);
  assert.equal(p.pendingSlotCount, 1);
  assert.equal(p.groups[0].slots[0].rank, 1);
  assert.equal('verified' in p.groups[0].slots[0], false);
  assert.equal('bossDps' in p.groups[0].slots[0], false);
});

test('unknown report revision blocks durable cache assumption', () => {
  const p = planFightFetches([slot({reportRevision:null}),
    slot({rank:4,reportRevision:null})]);
  assert.equal(p.distinctFightRequests, 1);
  assert.equal(p.groups[0].durableReuseAllowed, false);
});

test('reject rank/source drift, duplicate slots and invalid DPS', () => {
  assert.throws(() => planFightFetches([slot(),slot()]), /DUPLICATE_RANK_SLOT/);
  assert.throws(() => planFightFetches([slot(),slot({rank:4,snapshotSha:'b'.repeat(64)})]), /JOB_SNAPSHOT_DRIFT/);
  assert.throws(() => planFightFetches([slot({totalDps:NaN})]), /TOTAL_DPS_INVALID/);
  assert.throws(() => planFightFetches([slot({rank:101})]), /RANK_INVALID/);
  assert.throws(() => planFightFetches([slot({status:'GUESS'})]), /SLOT_STATUS/);
});

test('does not mutate inputs or attempt WCL network access', () => {
  const a = Object.freeze(slot());
  const p = planFightFetches([a]);
  assert.equal(p.groups[0].slots[0].snapshotSha, a.snapshotSha);
  assert.equal(a.status, 'PENDING');
  assert.equal(p.distinctFightRequests, 1);
});
