/**
 * Adapter from the merged public Archive-to-C bridge into the
 * existing immutable C-delta v1 codec. It creates no new C format and does
 * not perform WCL, GitHub, OAuth, Sheets or canonical-promotion I/O.
 */
import fs from 'node:fs';
import path from 'node:path';
import {brotliDecompressSync} from 'node:zlib';
import {
  SOURCE_SHA256,BASE_UNION_SHA256,shaBytes,shaObject,keyOf,
  compressCDelta,readCDelta,verifyCProof,applyCDeltas
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

const commitSha=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);

/** Load a contiguous, create-only local delta chain; no ignored extras. */
export function readFresh216CDeltaParts(deltaDirectory){
  need(typeof deltaDirectory==='string'&&path.isAbsolute(deltaDirectory)&&
    fs.existsSync(deltaDirectory)&&
    fs.lstatSync(deltaDirectory).isDirectory()&&
    !fs.lstatSync(deltaDirectory).isSymbolicLink(),
    'ARCHIVE_C_DELTA_DIRECTORY_INVALID');
  const names=fs.readdirSync(deltaDirectory);
  const expectedNames=names.filter(x=>/^delta-\d{4}\.json\.br$/.test(x))
    .sort((a,b)=>Number(a.slice(6,10))-Number(b.slice(6,10)));
  need(names.length===expectedNames.length,
    'ARCHIVE_C_DELTA_DIRECTORY_UNEXPECTED_FILE');
  const parts=[];
  let previous=null;
  for(let i=0;i<expectedNames.length;i++){
    const expected=deltaName(i),name=expectedNames[i];
    need(name===expected,'ARCHIVE_C_DELTA_CHAIN_GAP');
    const file=path.join(deltaDirectory,name),stat=fs.lstatSync(file);
    need(stat.isFile()&&!stat.isSymbolicLink(),
      'ARCHIVE_C_DELTA_PART_FILE_UNSAFE');
    const bytes=fs.readFileSync(file);
    readCDelta(bytes,{expectedIndex:i,expectedPreviousSha256:previous});
    parts.push(bytes);previous=shaBytes(bytes);
  }
  return parts;
}

/**
 * Build a private local C-delta appender over the existing immutable base
 * and append-only chain. Each append is replayed through applyCDeltas before
 * its receipt is returned. reportStateCommit must come from the caller's
 * authenticated private state store; this module never fabricates a commit.
 */
export function createFresh216ArchiveCDeltaAppender({
  sourceSlots,baseCompressedBytes,deltaDirectory,priorityByKey,
  getReportStateCommit
}={}){
  need(Array.isArray(sourceSlots)&&sourceSlots.length===21600&&
    Buffer.isBuffer(baseCompressedBytes)&&
    shaBytes(baseCompressedBytes)===BASE_UNION_SHA256&&
    priorityByKey instanceof Map&&
    typeof getReportStateCommit==='function'&&
    typeof deltaDirectory==='string'&&path.isAbsolute(deltaDirectory)&&
    fs.existsSync(deltaDirectory)&&fs.lstatSync(deltaDirectory).isDirectory()&&
    !fs.lstatSync(deltaDirectory).isSymbolicLink(),
    'ARCHIVE_C_DELTA_APPENDER_CONFIG_INVALID');
  const pinnedSlots=Object.freeze(sourceSlots.map(s=>Object.freeze({...s})));
  const slotMap=new Map();
  for(const slot of pinnedSlots){
    const key=keyOf(slot);
    need(!slotMap.has(key),'ARCHIVE_C_DELTA_SOURCE_DUPLICATE');
    slotMap.set(key,slot);
  }
  need(slotMap.size===21600,'ARCHIVE_C_DELTA_SOURCE_COUNT');
  const base=JSON.parse(brotliDecompressSync(baseCompressedBytes).toString('utf8'));
  let parts=readFresh216CDeltaParts(deltaDirectory);
  let replay=applyCDeltas({
    base,baseCompressedSha256:BASE_UNION_SHA256,slotMap,parts
  });
  let union=replay.union;
  const append=async({bridgeResult,evidence,archiveReceipt,wave,attemptId,witness}={})=>{
    need(sha(evidence?.responseBodySha256),
      'ARCHIVE_C_DELTA_RESPONSE_DIGEST_MISSING');
    const reportStateCommit=await getReportStateCommit({
      wave,attemptId,evidence,witness
    });
    need(commitSha(reportStateCommit),
      'ARCHIVE_C_DELTA_REPORT_STATE_COMMIT_INVALID');
    const built=appendFresh216ArchiveCDelta({
      bridgeResult,sourceSlots:pinnedSlots,reportStateCommit,
      reportBatchSha256:evidence.responseBodySha256,archiveReceipt,
      deltaIndex:parts.length,
      previousDeltaSha256:parts.length?shaBytes(parts.at(-1)):null,
      priorityByKey,existingUnion:union,deltaDirectory
    });
    if(built.status==='NO_NEW_PROOFS')return built;
    const bytes=fs.readFileSync(built.file);
    const decoded=readCDelta(bytes,{
      expectedIndex:parts.length,
      expectedPreviousSha256:parts.length?shaBytes(parts.at(-1)):null
    });
    const nextParts=[...parts,bytes];
    const next=applyCDeltas({
      base,baseCompressedSha256:BASE_UNION_SHA256,
      slotMap,parts:nextParts
    });
    need(next.union.size===union.size+built.addedExactC&&
      next.applied===replay.applied+built.addedExactC&&
      decoded.rows.every(row=>{
        const stored=next.union.get(keyOf(row));
        return stored&&stored.bossDps===row.bossDps&&
          JSON.stringify(stored.proof)===JSON.stringify(row.proof);
      }),
      'ARCHIVE_C_DELTA_POST_APPEND_REPLAY_FAILED');
    parts=nextParts;replay=next;union=next.union;
    return {
      status:'APPENDED',sourceSha256:SOURCE_SHA256,
      deltaIndex:built.deltaIndex,deltaSha256:built.deltaSha256,
      addedExactC:built.addedExactC,totalExactC:union.size,
      deltaCount:parts.length,applied:replay.applied
    };
  };
  append.snapshot=()=>({
    sourceSha256:SOURCE_SHA256,baseUnionSha256:BASE_UNION_SHA256,
    totalExactC:union.size,deltaCount:parts.length,
    applied:replay.applied,
    lastDeltaSha256:parts.length?shaBytes(parts.at(-1)):null
  });
  return append;
}


/**
 * Build one exact C-delta v1 payload from the already-verified PR19 bridge
 * output. priorityByKey maps immutable A slot keys to pinned recovery-plan
 * priority. existingUnion is the verified base+delta Map returned by
 * applyCDeltas; identical proofs are skipped and conflicts fail closed.
 */
export function buildFresh216ArchiveCDelta({
  bridgeResult,sourceSlots,reportStateCommit,reportBatchSha256,archiveReceipt,
  deltaIndex,previousDeltaSha256,priorityByKey,existingUnion
}={}){
  need(bridgeResult?.schema===1&&
    bridgeResult.kind==='FRESH216_PRIVATE_ARCHIVE_TO_C_PROOF_ROWS_V1'&&
    bridgeResult.sourceSha256===SOURCE_SHA256&&
    bridgeResult.totalSourceSlots===21600&&
    Array.isArray(bridgeResult.proofRows)&&
    Array.isArray(sourceSlots)&&sourceSlots.length===21600&&
    commit(reportStateCommit)&&sha(reportBatchSha256)&&
    archiveReceipt?.status==='VERIFIED'&&
    sha(archiveReceipt.waveSha256)&&sha(archiveReceipt.manifestSha256)&&
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
        proofSha256:shaObject(proofRow.proof),
        responseBodySha256:reportBatchSha256,
        archiveWaveSha256:archiveReceipt.waveSha256,
        archiveManifestSha256:archiveReceipt.manifestSha256
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
