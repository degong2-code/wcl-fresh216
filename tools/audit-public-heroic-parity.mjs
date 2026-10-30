#!/usr/bin/env node
/** Heroic public-only WCL parity receipt audit, zero new API requests.
 * Warning: this confirms committed computations and response digests,
 * NOT a raw-record independent parity replay (raw player names not persisted).
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
const read=path=>JSON.parse(fs.readFileSync(path,'utf8'));
const d='pilot-evidence/20261030-';
const discovery=[0,1].map(i=>read(d+'heroic-discovery/0'+i+'.done.json'));
const recs=[
 [d+'heroic-parity-2/',[8.6,2]],
 [d+'heroic-multiboss-gameid-filter/',[2,3.42]]
];
assert.equal(discovery[0].status,'FINAL');
assert.equal(discovery[1].status,'FINAL');
assert.equal(discovery[0].verification,'VALID');
assert.equal(discovery[1].verification,'VALID');
assert.equal(discovery[0].observedPoints,1);
assert.equal(discovery[1].observedPoints,1);
const chosen=discovery[1].selected;
assert.equal(chosen.difficulty,4);
assert.equal(chosen.fightId,2);
assert.equal(chosen.encounterId,3470);
assert.equal(chosen.reportCode,'rPRCwg6fjc9XdQLz');
let spent=2;
for(const [folder,expected] of recs){
 const start=[0,1].map(i=>read(folder+'0'+i+'.start.json'));
 const done=[0,1].map(i=>read(folder+'0'+i+'.done.json'));
 for(let i=0;i<2;i++){
  assert.equal(start[i].status,'IN_FLIGHT');
  assert.equal(done[i].status,'FINAL');
  assert.equal(start[i].querySha256,done[i].querySha256);
  assert.equal(done[i].httpStatus,200);
  assert.equal(done[i].verification,'VALID');
  assert.match(done[i].bodySha256,/^[0-9a-f]{64}$/);
  assert(Math.abs(done[i].observedPoints-expected[i])<1e-7);
  spent+=done[i].observedPoints;
 }
 if(folder.includes('heroic-parity-2')){
  assert.equal(done[0].summary.difficulty,4);
  assert.equal(done[0].summary.bossNpcTargets,2);
  assert.equal(done[0].summary.unfilteredTableVsOfficialTotal.exact0005,12);
  assert.equal(done[0].summary.unfilteredTableVsOfficialBoss.exact0005,0);
  assert.equal(done[1].summary.compared,12);
  assert.equal(done[1].summary.exact0005,12);
  assert(done[1].summary.maxAbsDps<0.005);
 }else{
  assert.equal(done[1].result.encounterID,3470);
  assert.equal(done[1].result.bossActors,2);
  assert.equal(done[1].result.rankedPlayers,12);
  assert.equal(done[1].result.compared,12);
  assert.equal(done[1].result.exact0005,12);
  assert(done[1].result.maxAbsDps<0.005);
 }
}
assert(Math.abs(spent-18.02)<0.00001);
console.log(JSON.stringify({result:'PUBLIC_HEROIC_BOSS_TABLE_PARITY_RECEIPTS_PASS',
 publicHeroicReport:true,encounterID:3470,actorComparisons:12,
 exactPerActorFilteredTable:12,exactPerActorGameIdExpression:12,
 bossNpcTargets:2,totalObservedPoints:spent,
 noPrivateAorCData:true,noWclCallsDuringAudit:0,sheetsWrites:0,
 limitations:'Receipt-level verification on one public heroic encounter; independent raw replay and A top100 identity join remain untested'}));
