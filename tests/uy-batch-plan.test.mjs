import test from 'node:test';
import assert from 'node:assert/strict';
import {planUyBatch} from '../src/core/uy-batch-plan.mjs';

const sha='a'.repeat(64);
const scopeKey='heroic-216-test';
const sheetName='영웅_DPS지표_V5';
function fixture(){
  const rawRows=Array.from({length:216},(_,i)=>{
    const row=Array(25).fill('');
    row[0]='Boss'+Math.floor(i/27);
    row[1]='Class'+(i%9);
    row[2]='Spec'+i;
    return row;
  });
  const formulasUY=Array.from({length:216},()=>Array(5).fill(''));
  const verifiedSnapshotByJob=new Map();
  const outputs=rawRows.map(r=>{
    const jobKey=r.slice(0,3).join('|');
    verifiedSnapshotByJob.set(jobKey,sha);
    return {jobKey,scopeKey,snapshotSha:sha,proofOrigin:'NEW_SAME_FIGHT_ACTOR',
      status:'EXACT100',nonBossShare:[0.1,0.2,0.3,0.4,0.5]};
  });
  return {sheetName,scopeKey,rawRows,formulasUY,verifiedSnapshotByJob,outputs};
}
test('all 216 verified jobs coalesce into one 216x5 write range',()=>{
  const input=fixture();
  const plan=planUyBatch(input);
  assert.equal(plan.rowCount,216);
  assert.equal(plan.proposedJobs,216);
  assert.equal(plan.changedCells,1080);
  assert.equal(plan.affectedRows,216);
  assert.equal(plan.apiRequestsIfApplied,1);
  assert.equal(plan.request.data.length,1);
  assert.equal(plan.request.data[0].range,"'영웅_DPS지표_V5'!U4:Y219");
  assert.equal(plan.request.data[0].values.length,216);
  assert.deepEqual(plan.request.data[0].values[0],[0.1,0.2,0.3,0.4,0.5]);
});
test('noncontiguous jobs produce one future batch request with two ranges',()=>{
  const input=fixture();input.outputs=[input.outputs[0],input.outputs[2]];
  const p=planUyBatch(input);
  assert.equal(p.apiRequestsIfApplied,1);
  assert.deepEqual(p.request.data.map(x=>x.range),
    ["'영웅_DPS지표_V5'!U4:Y4","'영웅_DPS지표_V5'!U6:Y6"]);
});
test('already matching U:Y is idempotent and does not schedule another write',()=>{
  const input=fixture();
  for(const r of input.rawRows)r.splice(20,5,0.1,0.2,0.3,0.4,0.5);
  const p=planUyBatch(input);
  assert.equal(p.changedCells,0);
  assert.equal(p.request,null);
  assert.equal(p.apiRequestsIfApplied,0);
  assert.equal(p.verifiedInputCells,1080);
});
test('partial null outputs preserve existing cells and cannot create guessed values',()=>{
  const input=fixture();input.outputs=[{...input.outputs[0],status:'PARTIAL',
    nonBossShare:[null,0.2,null,null,null]}];
  input.rawRows[0][20]=0.5;
  const p=planUyBatch(input);
  assert.equal(p.changedCells,1);
  assert.equal(p.retainedExistingCells,1);
  assert.deepEqual(p.request.data[0].values[0],[0.5,0.2,'','','']);
});
test('opposing existing value blocks batch instead of overwriting',()=>{
  const input=fixture();input.rawRows[10][21]=0.9;
  assert.throws(()=>planUyBatch(input),/UY_VALUE_CONFLICT/);
});
test('formula even in an unmodified U:Y cell is protected',()=>{
  const input=fixture();input.formulasUY[0][4]='=SUM(A1:A3)';
  assert.throws(()=>planUyBatch(input),/UY_FORMULA_PROTECTED/);
});
test('stale/foreign source snapshot and unapproved sheet fail closed',()=>{
  const input=fixture();
  input.verifiedSnapshotByJob.set(input.outputs[0].jobKey,'b'.repeat(64));
  assert.throws(()=>planUyBatch(input),/UY_RANK_SNAPSHOT_DRIFT/);
  const f=fixture();f.sheetName='__WCL43_G413_RAW';
  assert.throws(()=>planUyBatch(f),/UY_SHEET_NOT_APPROVED/);
});
test('numeric-only legacy proof cannot be used to publish a new actor witness',()=>{
  const input=fixture();input.outputs[0].proofOrigin='LEGACY_VALIDATED';
  assert.throws(()=>planUyBatch(input),/UY_OUTPUT_PROVENANCE_INVALID/);
});
test('duplicate ranks, unverified KPI, and incomplete EXACT100 are rejected',()=>{
  const input=fixture();input.outputs=[input.outputs[0],input.outputs[0]];
  assert.throws(()=>planUyBatch(input),/UY_OUTPUT_PROVENANCE_INVALID/);
  const missing=fixture();missing.outputs[0].nonBossShare[0]=null;
  assert.throws(()=>planUyBatch(missing),/UY_EXACT100_INCOMPLETE/);
  const invalid=fixture();invalid.outputs[0].nonBossShare[0]=1.01;
  assert.throws(()=>planUyBatch(invalid),/UY_OUTPUT_PROVENANCE_INVALID|UY_EXACT100_INCOMPLETE|UY_KPI_INVALID/);
});
test('input grid and proof summaries are not mutated; includes only U:Y ranges',()=>{
  const input=fixture();
  const before=JSON.stringify({raw:input.rawRows,outputs:input.outputs,forms:input.formulasUY});
  const p=planUyBatch(input);
  assert.equal(JSON.stringify({raw:input.rawRows,outputs:input.outputs,forms:input.formulasUY}),before);
  for(const d of p.request.data)assert.match(d.range,/!U\d+:Y\d+$/);
});
