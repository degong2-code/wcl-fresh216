#!/usr/bin/env node
/** Read only: independently verify public-only WCL cost experiment receipts. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
function check(base,i,kind){
 const p=base+'/'+i;
 const a=JSON.parse(fs.readFileSync(p+'.start.json','utf8'));
 const b=JSON.parse(fs.readFileSync(p+'.done.json','utf8'));
 assert.equal(a.status,'IN_FLIGHT');assert.equal(b.status,'FINAL');
 assert.equal(a.kind,kind);assert.equal(b.kind,kind);
 assert.equal(a.querySha256,b.requestSha256);
 assert.equal(b.httpStatus,200);
 assert.equal(b.verification,'VALID');
 assert.equal(b.privateData,false);
 assert.match(b.rawBodySha256,/^[a-f0-9]{64}$/);
 assert(b.points>0&&b.points<100);
 return b;
}
const wide=check('pilot-evidence/20261030-whole-report',0,'whole');
assert.equal(wide.points,36);
assert.equal(wide.shape.o.fightRecords,9);
assert.equal(wide.shape.b.fightRecords,9);
assert.equal(wide.shape.o.fight50Records,1);
assert.equal(wide.shape.b.fight50Records,1);
assert.equal(wide.shape.o.dpsActorsAll,164);
assert.equal(wide.shape.b.dpsActorsAll,164);
assert(!fs.existsSync('pilot-evidence/20261030-whole-report/1.start.json'));
assert(!fs.existsSync('pilot-evidence/20261030-whole-report/1.done.json'));
console.log(JSON.stringify({result:'PUBLIC_WCL_WIDE_READBACK_PASS',
 observedRequestPoints:36,reportedFights:9,
 combinedActorsForMetric:164,
 earlierObservedPerFightDualMetric:4,
 calculatedPerFightEquivalent:9*4,
 pointsSavedByWholeReportInThisExample:0,
 noPrivateData:true,noNewWclCalls:0,sheetsWrites:0,
 caveat:'Public LFR report, not proof of all heroic API costs or per-actor equivalence'}));
