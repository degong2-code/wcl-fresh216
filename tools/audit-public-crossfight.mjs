#!/usr/bin/env node
/** Readback of public-only cross-fight DPS experiment's committed summaries. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
const read=(f)=>JSON.parse(fs.readFileSync(f,'utf8'));
const root='pilot-evidence/20261030-';
const metadata=read(root+'parity-crossfight/selection-result.json');
assert.equal(metadata.status,'FINAL');
assert.equal(metadata.points,1);
assert.deepEqual(metadata.selection.map(x=>[x.fightId,x.encounterId]),[[6,3132],[10,3122]]);
let points=metadata.points,actors=0,targets=0;
const details=[];
for(const [fight,nBoss,encounter] of [[6,1,3132],[10,3,3122]]){
 const base=root+'crossfight-'+fight+'/';
 const start=[read(base+'00.start.json'),read(base+'01.start.json')];
 const done=[read(base+'00.done.json'),read(base+'01.done.json')];
 for(let i=0;i<2;i++){
  assert.equal(start[i].status,'IN_FLIGHT');
  assert.equal(done[i].status,'FINAL');
  assert.equal(start[i].querySha256,done[i].querySha256);
  assert.equal(done[i].httpStatus,200);
  assert.equal(done[i].verification,'VALID');
  assert.equal(done[i].privateDataAccess,false);
  assert.equal(done[i].rawActorDataPersisted,false);
  assert(done[i].observedPoints>0&&done[i].observedPoints<25);
  points+=done[i].observedPoints;
 }
 const ref=done[0].summary,out=done[1].summary;
 assert.equal(ref.encounterID,encounter);
 assert.equal(ref.difficulty,1);
 assert.equal(ref.bossNpcTargets,nBoss);
 assert.equal(ref.unfilteredTableVsOfficialTotal.compared,18);
 assert.equal(ref.unfilteredTableVsOfficialTotal.exact0005,18);
 assert.equal(out.bossTargetCount,nBoss);
 assert.equal(out.compared,18);
 assert.equal(out.exact0005,18);
 assert(out.maxAbsDps<0.005);
 actors+=18;targets+=nBoss;
 details.push({fight,encounterId:encounter,bossTargets:nBoss,
  dpsActors:18,exactBossDps:out.exact0005,maxAbsDps:out.maxAbsDps,
  points:done[0].observedPoints+done[1].observedPoints});
}
assert(Math.abs(points-23.8)<0.001);
console.log(JSON.stringify({result:'PUBLIC_CROSSFIGHT_RECEIPT_AUDIT_PASS',
 twoAdditionalFights:2,actorComparisons:actors,exact:actors,
 bossTargetsAcrossFights:targets,observedPoints:points,details,
 newWclCalls:0,sheetsWrites:0,privateInputsUsed:false,
 evidenceScope:'Immutable receipt readback; raw numeric records intentionally omitted from public repository'}));
