#!/usr/bin/env node
/** Pure receipt readback: NO WCL, Secrets, private source or raw player data.
 * Does NOT independently recompute numeric parity without raw report bodies.
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
const ROOT='pilot-evidence/20261030-boss-table-parity-v2';
const read=(idx,type)=>JSON.parse(fs.readFileSync(ROOT+'/'+String(idx).padStart(2,'0')+'.'+type+'.json','utf8'));
const start=[read(0,'start'),read(1,'start')],done=[read(0,'done'),read(1,'done')];
for(let i=0;i<2;i++){
 assert.equal(start[i].schema,1);
 assert.equal(start[i].status,'IN_FLIGHT');
 assert.equal(done[i].schema,1);
 assert.equal(done[i].status,'FINAL');
 assert.equal(start[i].querySha256,done[i].querySha256);
 assert.equal(done[i].httpStatus,200);
 assert.equal(done[i].verification,'VALID');
 assert.equal(done[i].privateDataAccess,false);
 assert.equal(done[i].rawActorDataPersisted,false);
 assert.match(done[i].bodySha256,/^[0-9a-f]{64}$/);
 assert(done[i].observedPoints>0&&done[i].observedPoints<=24);
}
const r=done[0].summary,t=done[1].summary;
assert.equal(r.encounterID,3129);
assert.equal(r.difficulty,1);
assert.equal(r.bossNpcTargets,1);
assert.equal(r.totalRankedDpsActors,17);
assert.equal(r.bossRankedDpsActors,17);
assert.equal(r.unfilteredTableVsOfficialTotal.compared,17);
assert.equal(r.unfilteredTableVsOfficialTotal.exact0005,17);
assert.equal(r.unfilteredTableVsOfficialBoss.exact0005,12);
assert.equal(t.bossTargetCount,1);
assert.equal(t.rosterSize,17);
assert.equal(t.compared,17);
assert.equal(t.exact0005,17);
assert(t.maxAbsDps<0.005);
const pt=done.reduce((n,v)=>n+v.observedPoints,0);
assert.equal(pt,9);
console.log(JSON.stringify({result:'PUBLIC_BOSS_TABLE_PARITY_V2_RECEIPT_READBACK_PASS',
 totalWclPoints:pt,referenceActors:17,officialTotalParities:17,
 unfilteredBossParities:12,targetFilteredBossParities:17,
 targetFilteredMaxAbsDps:t.maxAbsDps,exactTolerance:0.005,
 privatelySourcedDataUsed:false,sheetsWrites:0,newWclCalls:0,
 evidenceScope:'Receipt-only replay; no raw actor bodies retained, requires wider independent encounter validation'}));
