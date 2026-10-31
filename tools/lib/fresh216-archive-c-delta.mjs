/**
 * Adapter from the merged public Archive-to-C bridge into the
 * existing immutable C-delta v1 codec. It creates no new C format and does
 * not perform WCL, GitHub, OAuth, Sheets or canonical-promotion I/O.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  SOURCE_SHA256,BASE_UNION_SHA256,shaBytes,shaObject,keyOf,
  compressCDelta,readCDelta,verifyCProof
} from './fresh216-c-delta.mjs';

const need=(v,c)=>{if(!v)throw Error(c);};
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const commit=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
const PROOF_IDENTITY_FIELDS=[
  'proofType','snapshotSha','reportCode','fightId','encounterId',
  'difficulty','reportRevision','actorRef','bossDps','sourceStartTime'
];
const sameProof=(a,b)=>a&&b&&a.bossDps===b.bossDps&&
  PROOF_IDENTITY_FIELDS.every(k=>a.proof?.[k]===b.proof?.[k]);
const deltaName=i=>'delta-'+String(i).padStart(4,'0')+'.json.br';

/**
 * Build one exact C-delta v1 payload from the already-verified PR19 bridge
 * output. priorityByKey maps immutable A slot keys to pinned recovery-plan
 * priority. existingUnion is the verified base+delta Map returned by
 * applyCDeltas; identical proofs are skipped and conflicts fail closed.
 */
export function buildFresh216ArchiveCDelta({
  bridgeResult,sourceSlots,reportStateCommit,reportBatchSha256,
  deltaIndex,previousDeltaSha256,priorityByKey,existingUnion
}={}){
  need(bridgeResult?.schema===1&&
    bridgeResult.kind==='FRESH216_PRIVATE_ARCHIVE_TO_C_PROOF_ROWS_V1'&&
    bridgeResult.sourceSha256===SOURCE_SHA256&&
    bridgeResult.totalSourceSlots===21600&&
    Array.isArray(bridgeResult.proofRows)&&
    Array.isArray(sourceSlots)&&sourceSlots.length===21600&&
    commit(reportStateCommit)&&sha(reportBatchSha256)&&
    Number.isSafeInteger(deltaIndex)&&deltaIndex>=0&&
    (previousDeltaSha256===null||sha(previousDeltaSha256))&&
    priorityByKey instanceof Map&&existingUnion instanceof Map,
    'ARCHIVE_C_DELTA_INPUT_INVALID');
  const slotMap=new Map();
  for(const slot of sourceSlots){
    const key=keyOf(slot);
    need(!slotMap.has(key)&&typeof slot.jobKey==='string'&&
      Number.isSafeInteger(slot.rank)&&sha(slot.snapshotSha),
      'ARCHIVE_C_DELTA_A_SLOT_DUPLICATE_OR_INVALID');
    slotMap.set(key,slot);
  }
  need(slotMap.size===21600,'ARCHIVE_C_DELTA_A_SLOT_COUNT');
  const seen=new Set(),rows=[],priorities=[];
  let alreadyPresent=0;
  for(const proofRow of bridgeResult.proofRows){
    const key=keyOf(proofRow),slot=slotMap.get(key);
    need(slot&&!seen.has(key),'ARCHIVE_C_DELTA_BRIDGE_SLOT_INVALID');
    seen.add(key);
    const prior=existingUnion.get(key);
    if(prior){
      need(sameProof(prior,proofRow),
        'ARCHIVE_C_DELTA_EXISTING_PROOF_CONFLICT');
      alreadyPresent++;
      continue;
    }
    const priority=priorityByKey.get(key);
    need(Number.isSafeInteger(priority)&&priority>=1,
      'ARCHIVE_C_DELTA_PRIORITY_MISSING');
    const row={
      jobKey:proofRow.jobKey,rank:proofRow.rank,
      snapshotSha:proofRow.snapshotSha,bossDps:proofRow.bossDps,
      proof:proofRow.proof,
      evidence:{
        reportStateCommit,batchIndex:deltaIndex,priority,
        proofSha256:shaObject(proofRow.proof)
      }
    };
    verifyCProof(row,slot);
    rows.push(row);priorities.push(priority);
  }
  if(rows.length===0){
    return {
      status:'NO_NEW_PROOFS',sourceSha256:SOURCE_SHA256,
      deltaIndex:null,deltaSha256:null,addedExactC:0,
      alreadyPresent,bytes:null,delta:null
    };
  }
  rows.sort((a,b)=>a.jobKey.localeCompare(b.jobKey)||a.rank-b.rank);
  const delta={
    schema:1,kind:'FRESH216_C_EVIDENCE_DELTA_V1',
    sourceSha256:SOURCE_SHA256,baseUnionSha256:BASE_UNION_SHA256,
    deltaIndex,previousDeltaSha256,reportStateCommit,
    reportBatchSha256,
    priorityRange:[Math.min(...priorities),Math.max(...priorities)],
    rows
  };
  const bytes=compressCDelta(delta);
  const decoded=readCDelta(bytes,{
    expectedIndex:deltaIndex,
    expectedPreviousSha256:previousDeltaSha256
  });
  need(decoded.rows.length===rows.length,
    'ARCHIVE_C_DELTA_ROUNDTRIP_COUNT');
  return {
    status:'READY',sourceSha256:SOURCE_SHA256,deltaIndex,
    deltaSha256:shaBytes(bytes),addedExactC:rows.length,
    alreadyPresent,bytes,delta
  };
}

/**
 * Create-only local append to an isolated candidate checkout.
 * A repeated identical append is idempotent; a different payload at the
 * same index is a hard conflict. Git commit/push remains the host's job.
 */
export function appendFresh216ArchiveCDelta({
  deltaDirectory,...input
}={}){
  need(typeof deltaDirectory==='string'&&path.isAbsolute(deltaDirectory)&&
    fs.existsSync(deltaDirectory)&&
    fs.lstatSync(deltaDirectory).isDirectory()&&
    !fs.lstatSync(deltaDirectory).isSymbolicLink(),
    'ARCHIVE_C_DELTA_DIRECTORY_INVALID');
  const built=buildFresh216ArchiveCDelta(input);
  if(built.status==='NO_NEW_PROOFS')return built;
  const file=path.join(deltaDirectory,deltaName(built.deltaIndex));
  if(fs.existsSync(file)){
    const stat=fs.lstatSync(file);
    need(stat.isFile()&&!stat.isSymbolicLink(),
      'ARCHIVE_C_DELTA_EXISTING_FILE_UNSAFE');
    const existing=fs.readFileSync(file);
    need(shaBytes(existing)===built.deltaSha256,
      'ARCHIVE_C_DELTA_EXISTING_FILE_CONFLICT');
    readCDelta(existing,{
      expectedIndex:built.deltaIndex,
      expectedPreviousSha256:built.delta.previousDeltaSha256
    });
    return {...built,status:'APPENDED',reused:true,file};
  }
  const fd=fs.openSync(file,'wx',0o600);
  try{fs.writeFileSync(fd,built.bytes);fs.fsyncSync(fd);}
  finally{fs.closeSync(fd);}
  const readback=fs.readFileSync(file);
  need(shaBytes(readback)===built.deltaSha256,
    'ARCHIVE_C_DELTA_READBACK_SHA_MISMATCH');
  readCDelta(readback,{
    expectedIndex:built.deltaIndex,
    expectedPreviousSha256:built.delta.previousDeltaSha256
  });
  const dirfd=fs.openSync(deltaDirectory,'r');
  try{fs.fsyncSync(dirfd);}finally{fs.closeSync(dirfd);}
  return {...built,status:'APPENDED',reused:false,file};
}
