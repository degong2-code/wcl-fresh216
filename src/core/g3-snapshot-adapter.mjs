import {createHash} from 'node:crypto';
import {planFull216} from './full-scope-plan.mjs';

/**
 * PRIVATE INPUT ONLY. Converts *already committed* G3/G4.13 snapshot
 * envelopes + their RAW A:T rows into the existing immutable 216x100 slots.
 * It does NOT read Sheets, discover active source, trust a standalone digest
 * as provenance, fetch WCL, or publish source rows.
 */
const fail=c=>{throw Error(c);};
const yes=(v,c)=>{if(!v)fail(c);};
const hash=s=>createHash('sha256').update(s,'utf8').digest('hex');
const int=n=>Number.isSafeInteger(n)&&n>0;
const validAmount=n=>typeof n==='number'&&Number.isFinite(n)&&n>0;
const sha=s=>typeof s==='string'&&/^[a-f0-9]{64}$/i.test(s);
const millis=n=>{
  if(typeof n!=='number'||!Number.isFinite(n)||n<=0)return null;
  if(n>1e12)return n;
  if(n>1e9&&n<1e11)return n*1000;
  return null;
};
const rawFingerprint=r=>{
  const f=r.report&&typeof r.report==='object'?r.report:{};
  const code=f.code||r.reportID||r.reportCode;
  const fid=Number(f.fightID||f.fightId||r.fightID||r.fightId);
  return {code,fid};
};
const rowFP=r=>{
  const f=rawFingerprint(r);
  return [Number(r.amount),String(r.name||''),
    r.characterID||r.characterId||r.actorID||r.actorId||'',
    f.code||'',f.fid||'',String(r.startTime||'')];
};
const kpi=list=>{
  const result=['','','','',''];
  if(list.length)result[0]=Math.round(list[0]*100)/100;
  if(list.length>=30){
    result[1]=Math.round(list[29]*100)/100;
    result[3]=Math.round(list.slice(0,30).reduce((a,b)=>a+b,0)/30*100)/100;
  }
  if(list.length>=100){
    result[2]=Math.round(list[99]*100)/100;
    result[4]=Math.round(list.reduce((a,b)=>a+b,0)/100*100)/100;
  }
  return result;
};
const nameMasked=n=>!String(n??'').trim()||
  String(n).trim().toLowerCase()==='anonymous'||
  /^player\s*\(\d+\)$/i.test(String(n).trim());

export function importCommittedG3Snapshots({manifest,items,allowPartial=false}={}){
  yes(manifest&&typeof manifest==='object'&&
    typeof manifest.scopeKey==='string'&&manifest.scopeKey&&
    typeof manifest.producerScope==='string'&&manifest.producerScope&&
    typeof manifest.runId==='string'&&manifest.runId.length>=8&&
    (manifest.difficulty===4||manifest.difficulty===5)&&
    /^date\.\d+\.\d+$/.test(manifest.filter??'')&&
    manifest.partitionMode==='EXPLICIT_1'&&
    Array.isArray(items)&& (allowPartial===true?
      items.length>=1&&items.length<=216:items.length===216),
    'G3_IMPORT_MANIFEST_INVALID');
  // This adapter supports the historical G3 scope, NOT a new latest-partition
  // snapshot. Extend only after a different producer schema is attested.
  yes(manifest.producerScope==='12.1|1|2026-10-08|2026-10-12|4'&&
    manifest.difficulty===4&&
    manifest.filter==='date.1791385200000.1791817200000',
    'G3_IMPORT_SCOPE_UNSUPPORTED');
  const [_,from,to]=manifest.filter.split('.').map(Number);
  yes(Number.isSafeInteger(from)&&Number.isSafeInteger(to)&&
    from<to,'G3_IMPORT_DATE_INVALID');
  const originals=new Set(),jobs=new Set(),slots=[];
  for(const item of items){
    yes(item?.status==='COMMITTED'&&
      item.envelope?.version===1&&
      item.envelope.runId===manifest.runId&&
      item.envelope.scope===manifest.producerScope&&
      int(item.envelope.rawRowNumber)&&
      item.envelope.rawRowNumber>=4&&item.envelope.rawRowNumber<=219&&
      typeof item.envelope.key==='string'&&
      sha(item.envelope.sha256)&&
      Array.isArray(item.envelope.chunks)&&
      item.envelope.chunks.length===item.envelope.chunkCount&&
      item.envelope.chunks.length>0&&
      item.envelope.chunks.every(c=>typeof c==='string'&&c.length&&
        c.length<=12000)&&
      Array.isArray(item.rawRow)&&item.rawRow.length>=20,
      'G3_IMPORT_UNCOMMITTED_OR_SHAPE');
    const json=item.envelope.chunks.join('');
    yes(hash(json)===item.envelope.sha256,'G3_IMPORT_ENVELOPE_SHA');
    let doc;try{doc=JSON.parse(json);}catch{fail('G3_IMPORT_DOCUMENT_JSON');}
    yes(doc?.version===1&&doc.scope===manifest.producerScope&&
      doc.runId===manifest.runId&&
      doc.key===item.envelope.key&&
      doc.rawRowNumber===item.envelope.rawRowNumber&&
      int(doc.encounter)&&
      doc.producer?.overallComplete===true&&
      doc.producer?.bossComplete===true&&
      doc.producer?.dateFilterVerified===true&&
      doc.producer?.pageSetComplete===true&&
      sha(doc.overallSha256)&&sha(doc.bossSha256)&&
      Array.isArray(doc.overall)&&doc.overall.length===100&&
      Array.isArray(doc.boss)&&doc.boss.length===100,
      'G3_IMPORT_DOCUMENT_DRIFT');
    yes(!originals.has(doc.rawRowNumber)&&!jobs.has(doc.key),
      'G3_IMPORT_DUPLICATE_JOB');
    originals.add(doc.rawRowNumber);jobs.add(doc.key);
    const [boss,cls,spec,...extra]=doc.key.split('|');
    yes(boss&&cls&&spec&&extra.length===0&&
      item.rawRow.slice(0,3).join('|')===doc.key,
      'G3_IMPORT_RAW_JOB_DRIFT');
    for(const [rows,digest,offset] of [
      [doc.overall,doc.overallSha256,4],[doc.boss,doc.bossSha256,9]
    ]){
      let prior=Infinity;
      const values=[];
      for(const r of rows){
        const t=millis(r?.startTime),amount=Number(r?.amount);
        const f=rawFingerprint(r);
        yes(r&&r.amount!==null&&r.amount!==''&&
          validAmount(amount)&&amount<=prior&&t!==null&&
          t>=from&&t<to&&
          typeof f.code==='string'&&f.code&&f.code.length<=128&&
          /^[\x21-\x7e]+$/.test(f.code)&&int(f.fid),
          'G3_IMPORT_ROW_OR_DATE_INVALID');
        prior=amount;values.push(amount);
      }
      // G3 source digest = SHA256(JSON.stringify(selected.map(rankFP))).
      yes(hash(JSON.stringify(rows.map(rowFP)))===digest,
        'G3_IMPORT_METRIC_SHA');
      const calc=kpi(values);
      for(let j=0;j<5;j++){
        const actual=Number(item.rawRow[offset+j]);
        yes(Number.isFinite(actual)&&Math.abs(actual-calc[j])<=0.005,
          'G3_IMPORT_RAW_KPI_MISMATCH');
      }
      const supplied=offset===4?doc.expectedRawDps:doc.expectedRawBoss;
      yes(JSON.stringify(calc)===JSON.stringify(supplied),
        'G3_IMPORT_DOCUMENT_KPI_DRIFT');
    }
    for(let i=0;i<100;i++){
      const r=doc.overall[i],f=rawFingerprint(r);
      slots.push({
        scopeKey:manifest.scopeKey,jobKey:doc.key,
        rank:i+1,snapshotSha:doc.overallSha256,
        status:'PENDING',name:String(r.name??''),
        className:cls,specName:spec,totalDps:Number(r.amount),
        reportCode:f.code,fightId:f.fid,encounterId:doc.encounter,
        difficulty:manifest.difficulty,
        reportRevision:null, // G3 source does not attest a report revision
        startTime:millis(r.startTime),filter:manifest.filter
      });
    }
  }
  yes(originals.size===items.length&&[...originals].every(n=>n>=4&&n<=219),
    'G3_IMPORT_RAW_ROWS_INCOMPLETE');
  const complete=originals.size===216;
  if(!allowPartial)yes(complete,'G3_IMPORT_RAW_ROWS_INCOMPLETE');
  const plan=complete?planFull216(slots):null;
  return {slots,summary:{
    schema:1,scopeKey:manifest.scopeKey,jobs:plan?.jobs??originals.size,
    rankSlots:plan?.rankSlots??slots.length,
    pending:plan?.pendingRankSlots??slots.length,
    full216SourceComplete:complete,
    full216DispatchEligible:complete,
    anonymous:slots.filter(s=>nameMasked(s.name)).length,
    source:'COMMITTED_G3_G413_ENVELOPES_WITH_RAW_A_T',
    shaChecks:'ENVELOPE_AND_BOTH_METRICS_AND_RAW_KPIS',
    reportRevisionStatus:'NOT_IN_G3_SNAPSHOT',
    authenticInstalledSourceIndependentlyVerified:false,
    // Historical G3 is partition 1 and dated Oct 8..12. Never claim
    // equivalence to owner-requested Oct 22..28 latest-partition trial.
    usableForDate20261022to28:false,
    sheetWrites:0,wclCalls:0
  }};
}
