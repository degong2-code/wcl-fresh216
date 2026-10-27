/**
 * Pure, single-operation U:Y publishing planner for 216 RAW rows.
 * Does NOT call Sheets, authenticate, change RAW A:T or claim atomic CAS.
 *
 * Caller must read all RAW A:Y plus U:Y formulas immediately before planning;
 * provide the validated job->rank-snapshot provenance separately. Outputs must
 * come from the strict same-actor KPI engine, NOT numeric-only legacy imports.
 * A future adapter must lock/recheck source identities before API batchUpdate,
 * and verify the resulting cells after the write.
 */
const requireIt=(condition,code)=>{if(!condition)throw Error(code);};
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/i.test(v);
const valid=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1;
const oldNumber=value=>{
  if(typeof value==='boolean'||value==null||value==='')return null;
  const n=Number(value);
  return Number.isFinite(n)?n:null;
};
const allowed=new Set(['영웅_DPS지표_V5','신화_DPS지표_V5']);

export function planUyBatch({
  sheetName,scopeKey,rawRows,formulasUY,verifiedSnapshotByJob,outputs,
  firstDataRow=4
}={}){
  requireIt(allowed.has(sheetName),'UY_SHEET_NOT_APPROVED');
  requireIt(typeof scopeKey==='string'&&scopeKey.length>0,'UY_SCOPE_INVALID');
  requireIt(Array.isArray(rawRows)&&rawRows.length===216 &&
    Array.isArray(formulasUY)&&formulasUY.length===216 &&
    Number.isInteger(firstDataRow)&&firstDataRow>=1,'UY_RAW_GRID_INVALID');
  requireIt(verifiedSnapshotByJob instanceof Map &&
    Array.isArray(outputs),'UY_SOURCE_INPUT_INVALID');

  const byJob=new Map(),updated=[];
  for(let i=0;i<216;i++){
    const row=rawRows[i],formulas=formulasUY[i];
    requireIt(Array.isArray(row)&&row.length>=25 &&
      Array.isArray(formulas)&&formulas.length===5,'UY_GRID_ROW_INVALID');
    const key=row.slice(0,3).join('|');
    requireIt(row.slice(0,3).every(v=>typeof v==='string'&&v.trim()) &&
      !byJob.has(key),'UY_RAW_JOB_INVALID_OR_DUPLICATE');
    byJob.set(key,i);
  }

  let changedCells=0,verifiedInputCells=0,retainedExistingCells=0;
  const seen=new Set();
  for(const output of outputs){
    requireIt(output&&typeof output.jobKey==='string'&&!seen.has(output.jobKey) &&
      output.scopeKey===scopeKey && hex(output.snapshotSha) &&
      output.proofOrigin==='NEW_SAME_FIGHT_ACTOR' &&
      ['EXACT100','PARTIAL'].includes(output.status) &&
      Array.isArray(output.nonBossShare) && output.nonBossShare.length===5,
      'UY_OUTPUT_PROVENANCE_INVALID');
    seen.add(output.jobKey);
    const i=byJob.get(output.jobKey);
    requireIt(i!==undefined,'UY_JOB_NOT_IN_RAW');
    requireIt(verifiedSnapshotByJob.get(output.jobKey)===output.snapshotSha,
      'UY_RANK_SNAPSHOT_DRIFT');
    if(output.status==='EXACT100')
      requireIt(output.nonBossShare.every(valid),'UY_EXACT100_INCOMPLETE');
    const original=rawRows[i],formulas=formulasUY[i],next=original.slice(20,25);
    let touched=0;
    for(let c=0;c<5;c++){
      requireIt(formulas[c]===''||formulas[c]===null,'UY_FORMULA_PROTECTED');
      const n=output.nonBossShare[c];
      requireIt(n===null||valid(n),'UY_KPI_INVALID');
      if(n===null) {
        if(original[20+c]!==''&&original[20+c]!==null)retainedExistingCells++;
        continue;
      }
      verifiedInputCells++;
      const current=original[20+c],p=oldNumber(current);
      if(current===''||current===null){next[c]=n;touched++;changedCells++;}
      else requireIt(p!==null&&Math.abs(p-n)<=0.00006,'UY_VALUE_CONFLICT');
    }
    if(touched>0)updated.push({rowNumber:firstDataRow+i,values:next});
  }

  updated.sort((a,b)=>a.rowNumber-b.rowNumber);
  const segments=[];
  for(const change of updated){
    const last=segments.at(-1);
    if(last&&last.endRow+1===change.rowNumber){
      last.endRow++;last.values.push(change.values);
    }else{
      segments.push({startRow:change.rowNumber,endRow:change.rowNumber,
        values:[change.values]});
    }
  }
  const data=segments.map(x=>({
    range:`'${sheetName}'!U${x.startRow}:Y${x.endRow}`,
    majorDimension:'ROWS',values:x.values
  }));
  return {
    type:'GOOGLE_SHEETS_VALUES_BATCH_UPDATE_PLAN',sheetName,scopeKey,
    rowCount:216,proposedJobs:outputs.length,verifiedInputCells,
    changedCells,affectedRows:updated.length,retainedExistingCells,
    // A single future values.batchUpdate request may carry all these ranges.
    // The source snapshot/Sheets state MUST be rechecked under exclusive run
    // ownership: this pure plan is NOT an atomic compare-and-swap.
    apiRequestsIfApplied:data.length?1:0,
    request:data.length?{valueInputOption:'RAW',data}:null
  };
}
