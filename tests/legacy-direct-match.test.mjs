import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveConservativeDirect} from '../src/core/legacy-direct-match.mjs';

const slot=(name,amount,id,code='REPORT',fight=11)=>({
  name,amount,report:{code,fightID:fight},
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
