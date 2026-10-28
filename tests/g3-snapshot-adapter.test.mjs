import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {importCommittedG3Snapshots} from '../src/core/g3-snapshot-adapter.mjs';
import {prepareAdaptiveNext} from '../src/core/adaptive-collector-runner.mjs';
import {newCheckpoint} from '../src/core/checkpoint.mjs';

const digest=x=>createHash('sha256').update(x,'utf8').digest('hex');
const split=s=>s.match(/[\s\S]{1,12000}/g);
const manifest={
 scopeKey:'heroic:historical:source-review',
 producerScope:'12.1|1|2026-10-08|2026-10-12|4',
 runId:'G3_TEST_RUN_20261008',difficulty:4,
 filter:'date.1791385200000.1791817200000',
 partitionMode:'EXPLICIT_1'
};
const starts=1791385200000+3600000;
const average=a=>Math.round(a*100)/100;
const kpi=rows=>{
 const v=rows.map(r=>r.amount);
 return [average(v[0]),average(v[29]),average(v[99]),
   average(v.slice(0,30).reduce((a,b)=>a+b,0)/30),
   average(v.reduce((a,b)=>a+b,0)/100)];
};
const fp=r=>[r.amount,r.name,r.characterID||'',r.report.code,
  r.report.fightID,String(r.startTime)];
function makeFixture(){
 const items=[];
 for(let boss=0;boss<8;boss++)for(let spec=0;spec<27;spec++){
   const row=4+boss*27+spec,
     key='Boss'+boss+'|Class'+spec+'|Spec'+spec;
   const overall=Array.from({length:100},(_,i)=>({
     amount:500000-i*100-spec,name:i===0?'Anonymous':'Actor'+spec+'_'+i,
     characterID:i===0?0:i+1,
     report:{code:'Synthetic'+boss+'_'+spec+'_'+i,fightID:i+1},
     startTime:starts+i*1000
   }));
   const bossRows=overall.map((r,i)=>({...r,amount:400000-i*100-spec}));
   const os=digest(JSON.stringify(overall.map(fp)));
   const bs=digest(JSON.stringify(bossRows.map(fp)));
   const raw=Array(20).fill('');
   raw[0]='Boss'+boss;raw[1]='Class'+spec;raw[2]='Spec'+spec;
   kpi(overall).forEach((n,i)=>raw[4+i]=n);
   kpi(bossRows).forEach((n,i)=>raw[9+i]=n);
   const doc={version:1,scope:manifest.producerScope,
     runId:manifest.runId,rawRowNumber:row,key,
     encounter:3470+boss,capturedAt:'2026-10-10T00:00:00.000Z',
     producer:{overallComplete:true,bossComplete:true,
       dateFilterVerified:true,pageSetComplete:true},
     overall,boss:bossRows,overallSha256:os,bossSha256:bs,
     expectedRawDps:kpi(overall),expectedRawBoss:kpi(bossRows)};
   const json=JSON.stringify(doc);
   items.push({status:'COMMITTED',rawRow:raw,
     envelope:{version:1,runId:manifest.runId,
       key,scope:manifest.producerScope,rawRowNumber:row,
       sha256:digest(json),chunkCount:split(json).length,chunks:split(json)}});
 }
 return items;
}
const fixtures=makeFixture();
const parse=(entry)=>JSON.parse(entry.envelope.chunks.join(''));
const repack=(entry,doc)=>{
 const json=JSON.stringify(doc);
 entry.envelope.chunks=split(json);
 entry.envelope.chunkCount=entry.envelope.chunks.length;
 entry.envelope.sha256=digest(json);
};
test('imports exactly 216 committed G3 jobs and 21600 immutable source slots',()=>{
 const imported=importCommittedG3Snapshots({manifest,items:fixtures});
 assert.equal(imported.summary.jobs,216);
 assert.equal(imported.summary.rankSlots,21600);
 assert.equal(imported.summary.anonymous,216);
 assert.equal(imported.slots[0].reportRevision,null);
 assert.equal(imported.slots[0].status,'PENDING');
 assert.equal(imported.summary.usableForDate20261022to28,false);
 // Existing planner refuses to quietly reuse historical partition-1 data
 // as a source of the newer latest-partition Oct 22..28 cohort.
 const preview=prepareAdaptiveNext({slots:imported.slots,
   state:newCheckpoint(manifest.scopeKey,'private-historical')});
 assert.equal(preview.kind,'RANK_BATCH');
 assert.equal(preview.request.filter,manifest.filter);
});
test('staged, corrupted digest and source scope mismatch are rejected',()=>{
 const stage=structuredClone(fixtures);stage[0].status='STAGED';
 assert.throws(()=>importCommittedG3Snapshots({manifest,items:stage}),
   /G3_IMPORT_UNCOMMITTED_OR_SHAPE/);
 const corrupt=structuredClone(fixtures);
 corrupt[0].envelope.sha256='0'.repeat(64);
 assert.throws(()=>importCommittedG3Snapshots({manifest,items:corrupt}),
   /G3_IMPORT_ENVELOPE_SHA/);
 assert.throws(()=>importCommittedG3Snapshots({
   manifest:{...manifest,filter:'date.1792594800000.1793199600000'},
   items:fixtures}),/G3_IMPORT_SCOPE_UNSUPPORTED/);
});
test('re-hashed envelope with tampered metric still fails independent fingerprint',()=>{
 const items=structuredClone(fixtures);
 const doc=parse(items[0]);doc.overall[0].amount+=1;
 repack(items[0],doc);
 assert.throws(()=>importCommittedG3Snapshots({manifest,items}),
   /G3_IMPORT_METRIC_SHA/);
});
test('even digest-valid changed raw KPI fails owner RAW-versus-snapshot conservation',()=>{
 const items=structuredClone(fixtures);
 items[0].rawRow[4]+=10;
 assert.throws(()=>importCommittedG3Snapshots({manifest,items}),
   /G3_IMPORT_RAW_KPI_MISMATCH/);
});
test('wrong report/fight, date or duplicate RAW row cannot silently enter cohort',()=>{
 const wrong=structuredClone(fixtures);
 const doc=parse(wrong[0]);doc.overall[0].report.code='';
 repack(wrong[0],doc);
 assert.throws(()=>importCommittedG3Snapshots({manifest,items:wrong}),
   /G3_IMPORT_ROW_OR_DATE_INVALID/);
 const duplicated=structuredClone(fixtures);
 duplicated[1]=structuredClone(duplicated[0]);
 assert.throws(()=>importCommittedG3Snapshots({manifest,items:duplicated}),
   /G3_IMPORT_DUPLICATE_JOB/);
});

test('44 committed envelopes can be integrity-audited, never mistaken for 216',()=>{
 const items=fixtures.slice(0,44);
 assert.throws(()=>importCommittedG3Snapshots({manifest,items}),/G3_IMPORT_MANIFEST_INVALID/);
 const result=importCommittedG3Snapshots({manifest,items,allowPartial:true});
 assert.equal(result.summary.jobs,44);
 assert.equal(result.summary.rankSlots,4400);
 assert.equal(result.summary.full216SourceComplete,false);
 assert.equal(result.summary.full216DispatchEligible,false);
});
