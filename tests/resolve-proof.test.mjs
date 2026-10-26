import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveExactBossDps} from '../src/core/resolve-proof.mjs';

const slot = (overrides = {}) => ({
  fightId:12, encounterId:3470, difficulty:4, totalDps:1000,
  className:'Hunter', specName:'Marksmanship', name:'Anonymous', ...overrides
});
const actor = (overrides = {}) => ({
  id:7, name:'HunterDemo', class:'Hunter', spec:'Marksmanship', amount:1000,
  ...overrides
});
const fight = (characters, extra = {}) => ({
  fightID:12, encounter:{id:3470}, difficulty:4,
  roles:{dps:{characters}}, ...extra
});
const report = (totalActors = [actor()], bossActors = [actor({amount:700})]) =>
  ({overall:{data:[fight(totalActors)]}, boss:{data:[fight(bossActors)]}});

test('same-fight actor gives exact bossDps without inference', () => {
  assert.deepEqual(resolveExactBossDps(slot(), report()),
    {bossDps:700, actorRef:'id:7', proofType:'EXACT_SAME_FIGHT_ACTOR'});
});
test('anonymous rank succeeds only with unique amount/class/spec and matching boss actor', () => {
  const r = report([actor({name:'HiddenName'})],[actor({name:'HiddenName',amount:0})]);
  assert.equal(resolveExactBossDps(slot(),r)?.bossDps,0);
});
test('same amount from two actors is ambiguous, no proof', () => {
  assert.equal(resolveExactBossDps(slot(),report([actor(),actor({id:8,name:'Other'})])),null);
});
test('wrong or duplicate boss actor cannot validate', () => {
  assert.equal(resolveExactBossDps(slot(),report([actor()],[actor({id:8,amount:700})])),null);
  assert.equal(resolveExactBossDps(slot(),report([actor()],[actor({amount:700}),actor({amount:700})])),null);
});
test('named raw ranking must match, and class/spec must match', () => {
  assert.equal(resolveExactBossDps(slot({name:'SomeoneElse'}),report()),null);
  assert.equal(resolveExactBossDps(slot({specName:'Arcane'}),report()),null);
});
test('fight ID, encounter and difficulty are independently checked in both rosters', () => {
  const r=report();
  r.boss.data[0].fightID=13;
  assert.equal(resolveExactBossDps(slot(),r),null);
  r.boss.data[0].fightID=12;
  r.overall.data[0].encounter.id=1;
  assert.equal(resolveExactBossDps(slot(),r),null);
  r.overall.data[0].encounter.id=3470;
  r.boss.data[0].difficulty=5;
  assert.equal(resolveExactBossDps(slot(),r),null);
});
test('no guessing when boss DPS is negative, greater than total, or missing', () => {
  for(const amount of [-1,1001,null,'']) {
    assert.equal(resolveExactBossDps(slot(),report([actor()],[actor({amount})])),null);
  }
});
test('null if actor lacks unique ID and real name', () => {
  assert.equal(resolveExactBossDps(slot(),report(
    [actor({id:null,name:'Anonymous'})],[actor({id:null,name:'Anonymous',amount:700})])),null);
});
test('reproduces 0.005 amount tolerance but rejects outside tolerance', () => {
  assert.equal(resolveExactBossDps(slot(),report([actor({amount:1000.004})]))?.bossDps,700);
  assert.equal(resolveExactBossDps(slot(),report([actor({amount:1000.006})])),null);
});
