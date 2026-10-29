#!/usr/bin/env node
/**
 * Local, read-only audit of PRIVATE exported historical G3/PROOF/RAW evidence.
 * NEVER send the input to GitHub Actions, commit it, or paste it into a chat.
 * Prints only counts, error codes, and 1-based item indices; no actor names,
 * report IDs, player DPS, Sheet IDs, source paths, or ranking snapshots.
 *
 * Usage: node tools/audit-private-evidence.mjs /absolute/private/path/records.json
 *    or: python3 tools/private-sheet-audit.py /absolute/path/sheet.xlsx | node tools/audit-private-evidence.mjs -
 * Input: {"records":[{"snapshot":{...},"proofRow":[...10],"rawRow":[...25],
 *                   "scopeKey":"...","g3StorageRow":[...32]}]}
 * g3StorageRow is optional, but missing it means source commit is UNATTESTED.
 */
import fs from 'node:fs';
import path from 'node:path';
import {auditLegacyProof} from '../src/core/legacy-proof-audit.mjs';

const fail=code=>{process.stdout.write(JSON.stringify({status:'BLOCKED',code})+'\n');process.exitCode=1;};
const arg=process.argv.slice(2);
if(arg.length!==1||(arg[0]!=='-'&&!path.isAbsolute(arg[0]))){
  fail('PRIVATE_ABSOLUTE_JSON_PATH_REQUIRED');
}else{
  let records,sourceCounts;
  try{
    let raw;
    if(arg[0]==='-')raw=fs.readFileSync(0,'utf8');
    else {
      const stat=fs.lstatSync(arg[0]);
      if(!stat.isFile()||stat.size>64*1024*1024||stat.size===0)
        throw Error('PRIVATE_INPUT_INVALID');
      raw=fs.readFileSync(arg[0],'utf8');
    }
    if(Buffer.byteLength(raw,'utf8')>64*1024*1024 || !raw)
      throw Error('PRIVATE_INPUT_INVALID');
    const input=JSON.parse(raw);
    if(!input||!Array.isArray(input.records)||input.records.length>216||
       (input.records.length===0&&!input.sourceCounts))
      throw Error('PRIVATE_INPUT_INVALID');
    if(input.sourceCounts){
      const m=input.sourceCounts;
      const fields=['sourceRows','proofRowsPresent','committedRowsWithProof',
        'missingCommitForProof','proofRowsMissing'];
      if(fields.some(k=>!Number.isSafeInteger(m[k])||m[k]<0)||
         m.sourceRows!==216||m.proofRowsPresent!==m.committedRowsWithProof+
         m.missingCommitForProof||m.sourceRows!==m.proofRowsPresent+
         m.proofRowsMissing||m.committedRowsWithProof!==input.records.length)
         throw Error('PRIVATE_INPUT_INVALID');
    }
    records=input.records;
    sourceCounts=input.sourceCounts||null;
  }catch{
    fail('PRIVATE_INPUT_UNAVAILABLE_OR_INVALID');
  }
  if(records){
    const result={status:'COMPLETE_READ_ONLY',records:records.length,
      sourceCounts,
      sourceCommitAttested:0,selfConsistentUnattested:0,
      legacyExact100:0,legacyPartial:0,verifiedSlots:0,
      errors:[],wclRequests:0,sheetsWrites:0,
      actorLevelProofPromoted:0};
    const seen=new Set();
    for(let i=0;i<records.length;i++){
      let data;
      try{
        const item=records[i];
        if(!item||typeof item!=='object')throw Error('PRIVATE_RECORD_INVALID');
        const scopeKey=item.scopeKey;
        const rowNumber=item.snapshot?.rawRowNumber;
        const identity=JSON.stringify([scopeKey,rowNumber]);
        if(seen.has(identity))throw Error('PRIVATE_DUPLICATE_SOURCE_ROW');
        seen.add(identity);
        data=auditLegacyProof(item);
      }catch(e){
        const code=typeof e?.message==='string'&&/^[A-Z][A-Z0-9_]{2,70}$/.test(e.message)
          ?e.message:'PRIVATE_AUDIT_FAILED';
        result.errors.push({index:i+1,code});
        continue;
      }
      if(data.sourceCommitAttested)result.sourceCommitAttested++;
      else result.selfConsistentUnattested++;
      if(data.classification==='LEGACY_VALIDATED_EXACT100')result.legacyExact100++;
      else result.legacyPartial++;
      result.verifiedSlots+=data.verifiedBossSlots;
    }
    result.status=(result.errors.length||(sourceCounts?.missingCommitForProof||0)>0||
      records.length===0)?'REQUIRES_REVIEW':'COMPLETE_READ_ONLY';
    process.stdout.write(JSON.stringify(result)+'\n');
    if(result.status==='REQUIRES_REVIEW')process.exitCode=1;
  }
}
