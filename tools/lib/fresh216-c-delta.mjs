/**
 * Fresh216 C evidence delta-only codec. Immutable base + append-only proof
 * slices. Does not refetch WCL, update Sheets, or rewrite a C union snapshot.
 * The caller supplies the immutable A slot map for exact attribution checks.
 */
import {createHash} from 'node:crypto';
import {brotliCompressSync,brotliDecompressSync,constants} from 'node:zlib';
import assert from 'node:assert/strict';

export const DELTA_SCHEMA=1;
export const DELTA_KIND='FRESH216_C_EVIDENCE_DELTA_V1';
export const SOURCE_SHA256='7231c678f305dfe2a278b6a0371897044d4d0a0058cf5f6219c993a4a3fae9d2';
export const BASE_UNION_SHA256='1f092e03f8aefe394338380ccf0d92498997a08a777144cea84a65dee1f6093a';
export const DELTA_MAX_EXPANDED_BYTES=4*1024*1024;
export const shaBytes=x=>createHash('sha256').update(x).digest('hex');
export const shaObject=x=>shaBytes(JSON.stringify(x));
export const keyOf=s=>JSON.stringify([s.jobKey,s.rank,s.snapshotSha]);
const sha=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const need=(v,c)=>{if(!v)throw Error(c)};
const integer=n=>Number.isSafeInteger(n)&&n>=0;
const exactRev=(a,b)=>a==null||b==null||a===b;

export function verifyCProof(row,slot){
 need(row?.jobKey===slot?.jobKey&&row.rank===slot.rank&&
  row.snapshotSha===slot.snapshotSha,'C_DELTA_SLOT_MISMATCH');
 const p=row.proof;
 need(p?.proofType==='EXACT_SAME_FIGHT_ACTOR'&&
  p.snapshotSha===slot.snapshotSha&&
  p.reportCode===slot.reportCode&&p.fightId===slot.fightId&&
  p.encounterId===slot.encounterId&&p.difficulty===slot.difficulty&&
  exactRev(slot.reportRevision,p.reportRevision)&&
  typeof p.actorRef==='string'&&p.actorRef.length>0&&
  typeof p.bossDps==='number'&&Number.isFinite(p.bossDps)&&
  p.bossDps>=0&&p.bossDps<=slot.totalDps+0.005&&
  row.bossDps===p.bossDps,
  'C_DELTA_EXACT_PROOF_INVALID');
 return true;
}
function validate(delta,{expectedIndex,expectedPreviousSha256}={}){
 need(delta?.schema===DELTA_SCHEMA&&delta.kind===DELTA_KIND&&
  delta.sourceSha256===SOURCE_SHA256&&
  delta.baseUnionSha256===BASE_UNION_SHA256&&
  integer(delta.deltaIndex)&&
  (delta.previousDeltaSha256===null||sha(delta.previousDeltaSha256))&&
  sha(delta.reportBatchSha256)&&
  typeof delta.reportStateCommit==='string'&&
  /^[a-f0-9]{40}$/.test(delta.reportStateCommit)&&
  Array.isArray(delta.rows)&&delta.rows.length>=1&&
  delta.rows.length<=100&&Array.isArray(delta.priorityRange)&&
  delta.priorityRange.length===2&&
  integer(delta.priorityRange[0])&&integer(delta.priorityRange[1])&&
  delta.priorityRange[0]>=1&&delta.priorityRange[1]>=delta.priorityRange[0],
  'C_DELTA_SCHEMA_INVALID');
 if(expectedIndex!==undefined)
  need(delta.deltaIndex===expectedIndex,'C_DELTA_INDEX_DRIFT');
 if(expectedPreviousSha256!==undefined)
  need(delta.previousDeltaSha256===expectedPreviousSha256,
   'C_DELTA_CHAIN_DRIFT');
 const seen=new Set();
 for(const row of delta.rows){
  const k=keyOf(row);
  need(typeof row.jobKey==='string'&&row.jobKey.length>0&&
   integer(row.rank)&&row.rank>=1&&row.rank<=100&&
   sha(row.snapshotSha)&&
   row.proof&&typeof row.proof==='object'&&
   row.bossDps===row.proof.bossDps&&
   row.evidence?.reportStateCommit===delta.reportStateCommit&&
   row.evidence?.batchIndex===delta.deltaIndex&&
   integer(row.evidence.priority)&&
   row.evidence.priority>=delta.priorityRange[0]&&
   row.evidence.priority<=delta.priorityRange[1]&&
   row.evidence.proofSha256===shaObject(row.proof)&&
   !seen.has(k),'C_DELTA_ROW_HASH_OR_DUPLICATE');
  seen.add(k);
 }
 return delta;
}
export function compressCDelta(delta){
 validate(delta);
 const bytes=Buffer.from(JSON.stringify(delta)+'\n','utf8');
 need(bytes.length<=DELTA_MAX_EXPANDED_BYTES,'C_DELTA_SIZE_LIMIT');
 return brotliCompressSync(bytes,{params:{
  [constants.BROTLI_PARAM_QUALITY]:4
 }});
}
export function readCDelta(bytes,options={}){
 need(Buffer.isBuffer(bytes)&&bytes.length>0,'C_DELTA_NOT_BYTES');
 const json=brotliDecompressSync(bytes,{maxOutputLength:DELTA_MAX_EXPANDED_BYTES});
 const delta=JSON.parse(json.toString('utf8'));
 return validate(delta,options);
}
/** Rehydrate in-memory view from base 18,829 and successive deltas.
 * No full C snapshot is persisted. All source slots are cross-verified.
 */
export function applyCDeltas({base,baseCompressedSha256,slotMap,parts}={}){
 need(base?.kind==='FRESH216_C_VERIFIED_UNION_V1'&&
  base.sourceSha256===SOURCE_SHA256&&
  baseCompressedSha256===BASE_UNION_SHA256&&
  Array.isArray(base.rows)&&base.rows.length===18829&&
  slotMap instanceof Map&&slotMap.size===21600&&
  Array.isArray(parts),'C_DELTA_BASE_INVALID');
 const union=new Map();
 for(const row of base.rows){
  const k=keyOf(row);
  need(!union.has(k),'C_DELTA_BASE_DUPLICATE');
  verifyCProof(row,slotMap.get(k));
  union.set(k,row);
 }
 let previous=null,total=0;
 for(let i=0;i<parts.length;i++){
  const bytes=parts[i],delta=readCDelta(bytes,{
   expectedIndex:i,expectedPreviousSha256:previous
  });
  for(const row of delta.rows){
   const k=keyOf(row);
   need(!union.has(k),'C_DELTA_PRIOR_PROOF_CONFLICT');
   verifyCProof(row,slotMap.get(k));
   union.set(k,row);total++;
  }
  previous=shaBytes(bytes);
 }
 return {union,applied:total,deltaCount:parts.length,
  lastDeltaSha256:previous};
}
export function countExactUy(union, jobs){
 const metrics={rank1:0,rank30:0,rank100:0,mean30:0,mean100:0};
 for(const job of jobs){
  const confirmed=new Set(job.slots.filter(s=>union.has(keyOf(s))).map(s=>s.rank));
  if(confirmed.has(1))metrics.rank1++;
  if(confirmed.has(30))metrics.rank30++;
  if(confirmed.has(100))metrics.rank100++;
  if([...Array(30)].every((_,i)=>confirmed.has(i+1)))metrics.mean30++;
  if(confirmed.size===100)metrics.mean100++;
 }
 return metrics;
}
