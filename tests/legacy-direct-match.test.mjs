import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveConservativeDirect,resolveCollisionGuardedDirect} from '../src/core/legacy-direct-match.mjs';

const slot=(name,amount,id,code='REPORT',fight=11)=>({
  name,amount,startTime:1700000000000,report:{code,fightID:fight},
  ...(id===null?{}:{characterID:id})
});

test('distinct numeric actor IDs join boss metric one to one',()=>{
  const out=resolveConservativeDirect([slot('Twin',100,1),slot('Twin',91,2)],
    [slot('Twin',60,1),slot('Twin',40,2)]);
  assert.deepEqual(out.matched,[60,40]);
  assert.equal(out.calibrators.length,2);
});
test('homonyms without IDs cannot reuse same boss amount',()=>{
  assert.deepEqual(resolveConservativeDirect(
    [slot('Twin',100,null),slot('Twin',91,null)],
    [slot('Twin',60,null)]).matched,[null,null]);
});
test('one equal name without any actor IDs cannot prove a direct match',()=>{
  assert.deepEqual(resolveConservativeDirect(
    [slot('Twin',100,null)],[slot('Twin',60,null)]).matched,[null]);
});
test('duplicate same ID on overall side quarantines direct matches',()=>{
  assert.deepEqual(resolveConservativeDirect(
    [slot('Twin',100,1),slot('Twin',91,1)],
    [slot('Twin',60,1)]).matched,[null,null]);
});
test('duplicate same ID on boss side quarantines direct matches',()=>{
  assert.deepEqual(resolveConservativeDirect(
    [slot('Twin',100,1)],[slot('Twin',60,1),slot('Twin',40,1)]).matched,[null]);
});
test('different reports or fight IDs never match',()=>{
  assert.deepEqual(resolveConservativeDirect(
    [slot('Twin',100,1)],
    [slot('Twin',60,1,'REPORT',12),slot('Twin',45,1,'OTHER',11)]).matched,[null]);
});
test('negative, excessive, or non-finite boss DPS fails closed',()=>{
  for(const amount of [-1,100.006,'NaN']) {
    assert.deepEqual(resolveConservativeDirect(
      [slot('Twin',100,1)],[slot('Twin',amount,1)]).matched,[null]);
  }
});
test('zero boss DPS remains a valid matching witness',()=>{
  assert.deepEqual(resolveConservativeDirect(
    [slot('Twin',100,1)],[slot('Twin',0,1)]).matched,[0]);
});
test('contradictory names under one ID block direct match',()=>{
  assert.deepEqual(resolveConservativeDirect(
    [slot('Twin',100,1)],[slot('Other',60,1)]).matched,[null]);
});
test('anonymous actor with stable ID can match',()=>{
  assert.deepEqual(resolveConservativeDirect(
    [slot('anonymous',100,1)],[slot('anonymous',60,1)]).matched,[60]);
});
test('pure matcher does not depend on WCL or Sheets runtime',()=>{
  assert.equal(typeof globalThis.UrlFetchApp,'undefined');
  assert.equal(typeof globalThis.SpreadsheetApp,'undefined');
});

test('collision guard blocks name-only double attribution',()=>{
  assert.deepEqual(resolveCollisionGuardedDirect(
    [slot('Twin',100,null),slot('Twin',91,null)],
    [slot('Twin',60,null)]).matched,[null,null]);
});
test('collision guard retains unique legacy name-only direct matches',()=>{
  assert.deepEqual(resolveCollisionGuardedDirect(
    [slot('Twin',100,null),slot('Other',91,null)],
    [slot('Twin',60,null),slot('Other',40,null)]).matched,[60,40]);
});
test('collision guard blocks duplicate boss-side names',()=>{
  assert.deepEqual(resolveCollisionGuardedDirect(
    [slot('Twin',100,null)],
    [slot('Twin',60,null),slot('Twin',40,null)]).matched,[null]);
});
test('collision guard requires same report and fight',()=>{
  assert.deepEqual(resolveCollisionGuardedDirect(
    [slot('Twin',100,null)],
    [slot('Twin',60,null,'REPORT',12)]).matched,[null]);
});

test('collision guard requires same source startTime, even within same report/fight',()=>{
  const a=slot('Twin',100,null);
  const b={...slot('Twin',60,null),startTime:1700000001000};
  assert.deepEqual(resolveCollisionGuardedDirect([a],[b]).matched,[null]);
});
test('collision guard rejects a missing ranking startTime',()=>{
  const a=slot('Twin',100,null);
  delete a.startTime;
  assert.deepEqual(resolveCollisionGuardedDirect(
    [a],[slot('Twin',60,null)]).matched,[null]);
});
test('collision guard accepts identical numeric string startTimes',()=>{
  const a={...slot('Twin',100,null),startTime:'1700000000000'};
  assert.deepEqual(resolveCollisionGuardedDirect(
    [a],[slot('Twin',60,null)]).matched,[60]);
});
test('matching startTime cannot prove two same-name actors share canonical identity',()=>{
  // All stored source fields are identical in these two hypothetical worlds:
  // (1) same actor in both metric rankings, or (2) different realm homonyms.
  // Since realm/canonicalID is absent, this algorithm cannot differentiate.
  assert.deepEqual(resolveCollisionGuardedDirect(
    [slot('Twin',100,null)],[slot('Twin',60,null)]).matched,[60]);
});
