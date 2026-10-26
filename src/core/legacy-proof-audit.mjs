import {createHash} from 'node:crypto';

/**
 * Read-only bridge for the original private FRESH216 G3 snapshot and 10-column
 * G4.13 PROOF ledger. NO credential use, Sheets/WCL access or file writes.
 *
 * This can prove source SHA/KPI parity, NOT invent absent per-rank actor IDs.
 * Keep real inputs and audit outputs PRIVATE. Public tests use fake IDs only.
 */
const fail = (code) => { throw Error(code); };
const need = (condition,code) => { if (!condition) fail(code); };
const sha = s => typeof s === 'string' && /^[a-f0-9]{64}$/i.test(s);
const hash = s => createHash('sha256').update(s,'utf8').digest('hex');
const legacyNumber = v => (typeof v === 'boolean' || v === null || v === '' ||
  v === undefined || !Number.isFinite(Number(v))) ? null : Number(v);
const round2 = n => Math.round(n*100)/100;
const round6 = n => Math.round(n*1e6)/1e6;
const mean = a => a.reduce((sum,n)=>sum+n,0)/a.length;
const metric = nums => [
  round2(nums[0]),round2(nums[29]),round2(nums[99]),
  round2(mean(nums.slice(0,30))),round2(mean(nums.slice(0,100)))
];

function rankFight(r) {
  const inner = r.report && typeof r.report === 'object' ? r.report : {};
  const code = inner.code || r.reportID || r.reportCode;
  const fid = Number(inner.fightID || inner.fightId || r.fightID || r.fightId);
  if (typeof code !== 'string' || !code || code.length > 128 ||
      !/^[\x21-\x7E]+$/.test(code) ||
      /^(anonymous|private|redacted|hidden|masked|unknown|null|none|unlisted)$/i.test(code) ||
      !Number.isInteger(fid) || fid <= 0 || fid > 1e9) return null;
  return {code,fid};
}
function rankFingerprint(r) {
  const ref=rankFight(r);
  return [
    legacyNumber(r.amount),String(r.name||''),
    r.characterID||r.characterId||r.actorID||r.actorId||'',
    ref?ref.code:'',ref?ref.fid:'',String(r.startTime||'')
  ];
}
function startMs(r) {
  const v=Number(r.startTime);
  if (!Number.isFinite(v) || v<=0) return null;
  if(v>1e12) return v;
  if(v>1e9 && v<1e11) return v*1000;
  return null;
}
function dates(scope) {
  const m=/^([\w.]+)\|(\d+)\|(\d{4}-\d{2}-\d{2})\|(\d{4}-\d{2}-\d{2})\|([45])$/.exec(scope||'');
  need(m,'LEGACY_SCOPE_INVALID');
  const from=Date.parse(m[3]+'T00:00:00+09:00');
  const end=Date.parse(m[4]+'T00:00:00+09:00');
  need(Number.isFinite(from)&&Number.isFinite(end)&&end>=from,'LEGACY_SCOPE_DATES_INVALID');
  // End inclusive in user scope, following day exclusive in WCL.
  const to=end+86400000;
  return {from,to};
}
function verifiedMetricRows(rows,label,scope) {
  need(Array.isArray(rows)&&rows.length===100,label+'_NOT_EXACT100_SNAPSHOT');
  const {from,to}=dates(scope);
  const selected=rows.slice().sort((a,b)=>Number(b.amount)-Number(a.amount));
  for(let i=0;i<100;i++){
    const r=selected[i],value=legacyNumber(r?.amount),ts=startMs(r||{});
    need(value!==null&&value>0,label+'_DPS_INVALID');
    need(Number.isFinite(ts)&&ts>=from&&ts<to,label+'_DATE_INVALID');
    need(i===0||Number(selected[i-1].amount)>=value,label+'_UNSORTED');
  }
  const fingerprint=hash(JSON.stringify(selected.map(rankFingerprint)));
  return {amounts:selected.map(r=>Number(r.amount)),fingerprint};
}
function parseVector(s,len,code) {
  need(typeof s==='string',code);
  let a;try{a=JSON.parse(s);}catch{fail(code);}
  need(Array.isArray(a)&&(len===undefined||a.length===len),code);
  return a;
}

/** @param {{snapshot:object,proofRow:any[],rawRow:any[],scopeKey:string}} input */
export function auditLegacyProof({snapshot,proofRow,rawRow,scopeKey}={}) {
  need(snapshot&&typeof snapshot==='object'&&Array.isArray(proofRow)&&
    proofRow.length===10&&Array.isArray(rawRow)&&rawRow.length===25,
    'LEGACY_INPUT_SHAPE');
  need(scopeKey===snapshot.scope&&typeof snapshot.runId==='string'&&
    snapshot.runId.length>=8&&snapshot.version===1,'LEGACY_SNAPSHOT_SCOPE');
  const expectedKey=rawRow.slice(0,3).join('|');
  need(expectedKey===snapshot.key&&proofRow[0]===expectedKey &&
    proofRow[1]===scopeKey,'LEGACY_JOB_IDENTITY_DRIFT');
  need(Number.isInteger(snapshot.rawRowNumber)&&snapshot.rawRowNumber>=4&&
    snapshot.rawRowNumber<=219,'LEGACY_RAW_ROW_INDEX');
  const producer=snapshot.producer;
  need(producer?.overallComplete===true&&producer?.bossComplete===true&&
    producer?.dateFilterVerified===true&&producer?.pageSetComplete===true,
    'LEGACY_SNAPSHOT_NOT_COMMITTED');
  const overall=verifiedMetricRows(snapshot.overall,'OVERALL',scopeKey);
  const bossRanks=verifiedMetricRows(snapshot.boss,'BOSS',scopeKey);
  need(sha(snapshot.overallSha256)&&sha(snapshot.bossSha256)&&
    overall.fingerprint===snapshot.overallSha256&&
    bossRanks.fingerprint===snapshot.bossSha256,'LEGACY_RANK_SNAPSHOT_HASH_DRIFT');
  need(proofRow[2]===overall.fingerprint&&proofRow[3]===bossRanks.fingerprint,
    'LEGACY_PROOF_SNAPSHOT_HASH_DRIFT');
  const expectedRaw=[...metric(overall.amounts),...metric(bossRanks.amounts)];
  const mismatches=expectedRaw.filter((v,i)=>{
    const prior=legacyNumber(rawRow[i+4]);
    return prior===null||Math.abs(prior-v)>0.005;
  });
  need(mismatches.length===0,'LEGACY_RAW_METRIC_DRIFT');
  const values=parseVector(proofRow[4],100,'LEGACY_PROOF_VECTOR_SHAPE');
  const attempted=parseVector(proofRow[5],undefined,'LEGACY_ATTEMPTS_INVALID');
  need(attempted.length<=100&&attempted.every(sha),'LEGACY_ATTEMPTS_INVALID');
  need(values.every((v,i)=>v===null||
    (typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=overall.amounts[i])),
    'LEGACY_BOSS_VALUE_INVALID');
  const observed=values.filter(v=>v!==null).length;
  need(['DONE','PARTIAL'].includes(proofRow[6]) &&
    Number(proofRow[7])===observed && Number(proofRow[8])===100-observed,
    'LEGACY_PROOF_COUNT_OR_STATE');
  const individual=i=>values[i]===null?null:
    round6((overall.amounts[i]-values[i])/overall.amounts[i]);
  const fraction=n=>{
    if(values.slice(0,n).some(x=>x===null))return null;
    const totals=overall.amounts.slice(0,n).reduce((a,b)=>a+b,0);
    const bosses=values.slice(0,n).reduce((a,b)=>a+b,0);
    return round6((totals-bosses)/totals);
  };
  const uy=[individual(0),individual(29),individual(99),fraction(30),fraction(100)];
  const pendingUY=[];
  for(let i=0;i<5;i++){
    const current=rawRow[i+20],prior=legacyNumber(current);
    if(current===''||current===null){
      if(uy[i]!==null)pendingUY.push(i+21);
    } else {
      need(uy[i]!==null&&prior!==null&&Math.abs(uy[i]-prior)<=0.00006,
        'LEGACY_UY_METRIC_CONFLICT');
    }
  }
  return {
    classification:observed===100?'LEGACY_VALIDATED_EXACT100':'LEGACY_VALIDATED_PARTIAL',
    proofState:proofRow[6],verifiedBossSlots:observed,
    snapshotHashesMatch:true,rawMetricsMatch:true,storedUYConsistent:true,
    kpiUY:uy,pendingUYColumns:pendingUY,
    perRankActorIdentityAvailable:false,canPromoteToNewActorProof:false,
    furtherWclRequests:0,readOnly:true
  };
}
