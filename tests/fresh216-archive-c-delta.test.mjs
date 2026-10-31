import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {
  SOURCE_SHA256,keyOf,readCDelta
} from '../tools/lib/fresh216-c-delta.mjs';
import {
  buildFresh216ArchiveCDelta,appendFresh216ArchiveCDelta
} from '../tools/lib/fresh216-archive-c-delta.mjs';

const sha=v=>createHash('sha256').update(v).digest('hex');
function fixture(){
  const sourceSlots=[];
  for(let job=0;job<216;job++){
    const jobKey='Job'+String(job).padStart(3,'0')+'|Hunter|Spec'+job;
    const snapshotSha=sha('snapshot:'+jobKey);
    for(let rank=1;rank<=100;rank++){
      const target=job===0&&rank===1;
      sourceSlots.push({
        scopeKey:'heroic:2026-10-22_27:latest:source',
        jobKey,rank,snapshotSha,status:'PENDING',
        totalDps:target?1000:5000-rank,
        className:'Hunter',specName:'Spec'+job,
        reportCode:target?'REPORT0':'REPORT'+job,
        fightId:target?7:job*100+rank,
        encounterId:3470,difficulty:4,reportRevision:2,
        name:target?'Player (1)':'Player ('+rank+')',
        startTime:1792594801000+rank
      });
    }
  }
  const slot=sourceSlots[0];
  const proof={
    proofType:'EXACT_SAME_FIGHT_ACTOR',snapshotSha:slot.snapshotSha,
    reportCode:slot.reportCode,fightId:slot.fightId,
    encounterId:slot.encounterId,difficulty:slot.difficulty,
    reportRevision:slot.reportRevision,actorRef:'id:7',bossDps:700
  };
  const row={jobKey:slot.jobKey,rank:slot.rank,
    snapshotSha:slot.snapshotSha,bossDps:700,proof};
  const key=keyOf(row);
  const bridgeResult={
    schema:1,kind:'FRESH216_PRIVATE_ARCHIVE_TO_C_PROOF_ROWS_V1',
    sourceSha256:SOURCE_SHA256,totalSourceSlots:21600,
    sourceSlots:1,candidateVerifiedSlots:1,verifiedSlots:1,
    unresolvedSlots:0,proofRows:[row]
  };
  const input={
    bridgeResult,sourceSlots,reportStateCommit:'a'.repeat(40),
    reportBatchSha256:'b'.repeat(64),deltaIndex:36,
    previousDeltaSha256:'c'.repeat(64),
    priorityByKey:new Map([[key,348]]),existingUnion:new Map()
  };
  return {input,row,key,slot};
}
test('PR19 bridge proof rows convert losslessly into existing C-delta v1',()=>{
  const f=fixture(),result=buildFresh216ArchiveCDelta(f.input);
  assert.equal(result.status,'READY');
  assert.equal(result.addedExactC,1);
  assert.equal(result.delta.kind,'FRESH216_C_EVIDENCE_DELTA_V1');
  assert.equal(result.delta.sourceSha256,SOURCE_SHA256);
  assert.equal(result.delta.rows[0].evidence.priority,348);
  const decoded=readCDelta(result.bytes,{
    expectedIndex:36,expectedPreviousSha256:'c'.repeat(64)
  });
  assert.deepEqual(decoded.rows,result.delta.rows);
});
test('already-present exact proof is skipped without creating a fake delta',()=>{
  const f=fixture();
  f.input.existingUnion.set(f.key,{...f.row,proof:{...f.row.proof,
    discovery:{kind:'REPORT_DUAL_RANKINGS_MASKED',evidenceSha256:'d'.repeat(64)}}});
  const result=buildFresh216ArchiveCDelta(f.input);
  assert.equal(result.status,'NO_NEW_PROOFS');
  assert.equal(result.addedExactC,0);
  assert.equal(result.delta,null);
  assert.equal(result.bytes,null);
});
test('existing proof conflict, missing priority and duplicate bridge slots fail closed',()=>{
  const f=fixture();
  f.input.existingUnion.set(f.key,{...f.row,bossDps:701});
  assert.throws(()=>buildFresh216ArchiveCDelta(f.input),
    /ARCHIVE_C_DELTA_EXISTING_PROOF_CONFLICT/);
  const missing=fixture();missing.input.priorityByKey.clear();
  assert.throws(()=>buildFresh216ArchiveCDelta(missing.input),
    /ARCHIVE_C_DELTA_PRIORITY_MISSING/);
  const duplicate=fixture();
  duplicate.input.bridgeResult.proofRows.push(duplicate.row);
  assert.throws(()=>buildFresh216ArchiveCDelta(duplicate.input),
    /ARCHIVE_C_DELTA_BRIDGE_SLOT_INVALID/);
});
test('create-only append is idempotent and never overwrites an indexed delta',()=>{
  const f=fixture(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'fresh216-c-delta-'));
  try{
    const first=appendFresh216ArchiveCDelta({
      ...f.input,deltaDirectory:dir
    });
    assert.equal(first.status,'APPENDED');
    assert.equal(first.reused,false);
    assert.equal(fs.existsSync(first.file),true);
    const second=appendFresh216ArchiveCDelta({
      ...f.input,deltaDirectory:dir
    });
    assert.equal(second.status,'APPENDED');
    assert.equal(second.reused,true);
    assert.equal(second.deltaSha256,first.deltaSha256);
    assert.equal(fs.readdirSync(dir).length,1);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
