#!/usr/bin/env node
/** Offline independent audit of four PUBLIC WCL cost receipts. No API/secrets. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
const folder='pilot-evidence/20261030';
const tests=['identify','both_rankings','boss_rankings','damage_table'];
let cost=0;
const receipts=[];
for(let i=0;i<tests.length;i++){
 const id=String(i).padStart(2,'0'),name=tests[i];
 const a=JSON.parse(fs.readFileSync(folder+'/'+id+'.json','utf8'));
 const b=JSON.parse(fs.readFileSync(folder+'/'+id+'.result.json','utf8'));
 assert.equal(a.schema,1);assert.equal(a.status,'IN_FLIGHT');
 assert.equal(a.kind,name);assert.equal(b.kind,name);
 assert.equal(b.schema,1);assert.equal(b.status,'FINAL');
 assert.equal(a.querySha256,b.requestSha256);
 assert.equal(b.verification,'VALID');assert.equal(b.httpStatus,200);
 assert.equal(b.noPrivateDataPublished,true);
 assert.equal(typeof b.cost,'number');
 assert(b.cost>0&&b.cost<=16);
 assert.match(b.evidenceDigest,/^[a-f0-9]{64}$/);
 assert(b.elapsedMs>=0&&b.elapsedMs<=25000);
 assert(b.quota.limit>=b.quota.spent&&b.quota.reset>=0);
 cost+=b.cost;
 receipts.push({kind:name,points:b.cost,shape:b.shape,
  elapsedMs:b.elapsedMs,bodyHash:b.evidenceDigest});
}
assert.equal(cost,8);
assert.equal(receipts[0].shape.totalFights,64);
assert.equal(receipts[0].shape.selectedEncounter,3129);
assert.equal(receipts[0].shape.selectedDifficulty,1);
assert.equal(receipts[1].shape.o.characters,17);
assert.equal(receipts[1].shape.b.characters,17);
assert.equal(receipts[2].shape.b.characters,17);
assert.deepEqual(receipts[3].shape.topKeys,['data']);
assert.equal(receipts[3].shape.containsBossDpsAsExplicitField,false);
console.log(JSON.stringify({result:'PUBLIC_WCL_PILOT_INDEPENDENT_AUDIT_PASS',
 totalPoints:cost,publicOnly:true,rawBodiesPublished:false,
 scope:'One public LFR fight, not proven representative of current heroic raid',
 methods:receipts.map(({kind,points,shape,elapsedMs})=>({kind,points,shape,elapsedMs})),
 newWclCalls:0,privateDataAccess:0,sheetsWrites:0}));
