#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
const folders=[
 ['20261030-multiboss-filter',3.16,0,0],
 ['20261030-multiboss-gameid-filter',3,18,18]
];
const root='pilot-evidence/';
let sum=0;
for(const [name,expected,compared,exact] of folders){
 const base=root+name+'/';
 const starts=[0,1].map(i=>JSON.parse(fs.readFileSync(base+'0'+i+'.start.json','utf8')));
 const docs=[0,1].map(i=>JSON.parse(fs.readFileSync(base+'0'+i+'.done.json','utf8')));
 for(let i=0;i<2;i++){
  assert.equal(starts[i].status,'IN_FLIGHT');
  assert.equal(docs[i].status,'FINAL');
  assert.equal(starts[i].querySha256,docs[i].querySha256);
  assert.equal(docs[i].verification,'VALID');
  assert.equal(docs[i].httpStatus,200);
  assert.equal(docs[i].publicOnly,true);
  assert.equal(docs[i].rawActorsPersisted,false);
  assert.match(docs[i].bodySha256,/^[a-f0-9]{64}$/);
  assert(docs[i].observedPoints>=1&&docs[i].observedPoints<20);
 }
 assert.equal(docs[0].observedPoints,2);
 assert(Math.abs(docs[1].observedPoints-expected)<0.000001);
 const r=docs[1].result;
 assert.equal(r.bossActors,3);
 assert.equal(r.rankedPlayers,18);
 assert.equal(r.compared,compared);
 assert.equal(r.exact0005,exact);
 assert.equal(r.tableEntries,compared?24:0);
 if(compared)assert(r.maxAbsDps<0.005);
 sum+=docs[0].observedPoints+docs[1].observedPoints;
}
assert(Math.abs(sum-10.16)<0.000001);
console.log(JSON.stringify({result:'PUBLIC_MULTIBOSS_FILTER_RECEIPTS_PASS',
 reportScopedNpcIds:{compared:0,tableRows:0,filterCost:3.16},
 globalNpcGameIds:{compared:18,exact:18,filterCost:3,filteredTableMarginalCost:1},
 bothPilotsObservedPoints:sum,privateDataUsed:false,
 newWclRequests:0,sheetsWrites:0,
 scope:'Public LFR fight10, receipt-level audit; heroic parity not yet proven'}));
