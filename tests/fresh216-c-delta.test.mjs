import test from 'node:test';
import assert from 'node:assert/strict';
import {brotliCompressSync,constants} from 'node:zlib';
import {
 SOURCE_SHA256,BASE_UNION_SHA256,shaObject,shaBytes,
 compressCDelta,readCDelta,verifyCProof
} from '../tools/lib/fresh216-c-delta.mjs';

const commit='a'.repeat(40);
const snap='b'.repeat(64);
const row={jobKey:'Synthetic|Class|Spec',rank:30,snapshotSha:snap,
 bossDps:900,proof:{proofType:'EXACT_SAME_FIGHT_ACTOR',
  snapshotSha:snap,reportCode:'TESTCASE',fightId:7,
  encounterId:3470,difficulty:4,reportRevision:2,
  actorRef:'id:101',bossDps:900}};
row.evidence={reportStateCommit:commit,batchIndex:0,
 priority:1,proofSha256:shaObject(row.proof)};
const payload={schema:1,kind:'FRESH216_C_EVIDENCE_DELTA_V1',
 sourceSha256:SOURCE_SHA256,baseUnionSha256:BASE_UNION_SHA256,
 deltaIndex:0,previousDeltaSha256:null,reportStateCommit:commit,
 reportBatchSha256:'c'.repeat(64),priorityRange:[1,10],rows:[row]};
test('lossless deterministic first delta and strict proof',()=>{
 const z=compressCDelta(payload);
 assert.deepEqual(readCDelta(z,{expectedIndex:0,expectedPreviousSha256:null}),payload);
 assert.equal(shaBytes(compressCDelta(payload)),shaBytes(z));
 assert(verifyCProof(row,{jobKey:row.jobKey,rank:30,snapshotSha:snap,
  reportCode:'TESTCASE',fightId:7,encounterId:3470,
  difficulty:4,reportRevision:2,totalDps:1300}));
});
test('chain, source, report attribution and repeated slot rejected',()=>{
 const z=compressCDelta(payload);
 assert.throws(()=>readCDelta(z,{expectedIndex:1}),/C_DELTA_INDEX_DRIFT/);
 assert.throws(()=>readCDelta(z,{expectedPreviousSha256:'d'.repeat(64)}),
  /C_DELTA_CHAIN_DRIFT/);
 const bad={...payload,sourceSha256:'d'.repeat(64)};
 assert.throws(()=>compressCDelta(bad),/C_DELTA_SCHEMA_INVALID/);
 const repeated={...payload,rows:[row,{...row}]};
 assert.throws(()=>compressCDelta(repeated),/C_DELTA_ROW_HASH_OR_DUPLICATE/);
 const wrong={...row,proof:{...row.proof,reportCode:'DIFFERENT'}};
 assert.throws(()=>verifyCProof(wrong,{
  jobKey:row.jobKey,rank:30,snapshotSha:snap,reportCode:'TESTCASE',
  fightId:7,encounterId:3470,difficulty:4,
  reportRevision:2,totalDps:1300
 }),/C_DELTA_EXACT_PROOF_INVALID/);
});
test('damaged compressed delta and unsupported priority fail closed',()=>{
 const zip=compressCDelta(payload);
 const damaged=Buffer.from(zip);damaged[0]^=0xff;
 assert.throws(()=>readCDelta(damaged));
 const bad={...payload,rows:[{...row,evidence:{...row.evidence,
  priority:11}}]};
 assert.throws(()=>compressCDelta(bad),/C_DELTA_ROW_HASH_OR_DUPLICATE/);
});
