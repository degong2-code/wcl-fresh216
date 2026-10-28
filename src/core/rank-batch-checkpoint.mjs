/**
 * Pure ranking-request transitions inside the SAME schema-1 checkpoint as
 * single-fight and grouped Report requests. No OAuth, I/O, clocks or WCL HTTP.
 * Each ranking batch is ONE potentially charged GraphQL request.
 */
const fail=c=>{throw Error(c);};
const ok=(v,c)=>{if(!v)fail(c);};
const clone=v=>structuredClone(v);
const int=v=>Number.isSafeInteger(v)&&v>0;
const token=s=>typeof s==='string'&&s.length>0;
const key=b=>JSON.stringify([b.scopeKey,b.jobKey,b.snapshotSha,b.firstPage,b.pageCount]);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const pending=state=>[...Object.values(state.entries??{}),
  ...Object.values(state.rankRequests??{})].some(e=>
  e.status==='IN_FLIGHT'||e.status==='NEEDS_REVIEW'||
  (e.attempt&&e.observedPoints===null));
const allAttempts=state=>[...Object.values(state.entries??{}),
  ...Object.values(state.rankRequests??{})].filter(e=>e.attempt).map(e=>e.attempt.id);

function source(b){
  ok(b&&token(b.scopeKey)&&token(b.jobKey)&&
    /^[a-f0-9]{64}$/i.test(b.snapshotSha??'')&&
    int(b.encounterId)&&[4,5].includes(b.difficulty)&&
    token(b.className)&&token(b.specName)&&
    /^date\.\d+\.\d+$/.test(b.filter??'')&&
    int(b.firstPage)&&int(b.pageCount)&&b.pageCount<=10&&
    Array.isArray(b.slots)&&b.slots.length===100,
    'RANK_REQUEST_SOURCE_INVALID');
  const [_,start,end]=b.filter.split('.').map(Number);
  ok(Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&end>start,
    'RANK_REQUEST_DATE_INVALID');
  ok(b.jobKey.split('|')[1]===b.className&&
    b.jobKey.split('|')[2]===b.specName,'RANK_REQUEST_JOB_INVALID');
  const ordered=b.slots.slice().sort((x,y)=>x.rank-y.rank);
  for(let i=0;i<100;i++){
    const s=ordered[i];
    ok(s?.scopeKey===b.scopeKey&&s.jobKey===b.jobKey&&
      s.snapshotSha===b.snapshotSha&&s.rank===i+1&&
      s.encounterId===b.encounterId&&s.difficulty===b.difficulty&&
      s.className===b.className&&s.specName===b.specName&&
      typeof s.totalDps==='number'&&Number.isFinite(s.totalDps)&&s.totalDps>0&&
      token(s.reportCode)&&int(s.fightId)&&
      Number.isFinite(Number(s.startTime))&&Number(s.startTime)>=start&&
      Number(s.startTime)<end&&
      (s.reportRevision==null||
       Number.isSafeInteger(s.reportRevision)&&s.reportRevision>=0),
      'RANK_REQUEST_SLOT_INVALID');
  }
  return {scopeKey:b.scopeKey,jobKey:b.jobKey,snapshotSha:b.snapshotSha,
    encounterId:b.encounterId,difficulty:b.difficulty,
    className:b.className,specName:b.specName,filter:b.filter,
    firstPage:b.firstPage,pageCount:b.pageCount,slots:ordered.map(s=>({
      rank:s.rank,scopeKey:s.scopeKey,jobKey:s.jobKey,
      snapshotSha:s.snapshotSha,encounterId:s.encounterId,
      difficulty:s.difficulty,className:s.className,specName:s.specName,
      totalDps:s.totalDps,reportCode:s.reportCode,fightId:s.fightId,
      startTime:Number(s.startTime),name:s.name??'',
      reportRevision:s.reportRevision??null
    }))};
}
const terminal=e=>e.result?.pages?.some(p=>
  p.status==='UNAVAILABLE'||p.status==='OK'&&
  (p.rowCount<100||p.hasMorePages===false));
export function registerRankBatch(state,batch){
  ok(state?.schema===1&&state.status==='ACTIVE'&&
    batch?.scopeKey===state.scopeKey,'RANK_REGISTER_STATE_INVALID');
  const b=source(batch),k=key(b);
  const existing=state.rankRequests??{};
  if(existing[k]){
    ok(same(existing[k].source,b),'RANK_REQUEST_REPLAN_DRIFT');
    return state; // no extra version or bill
  }
  const prior=Object.values(existing).filter(e=>
    e.source.jobKey===b.jobKey&&e.source.scopeKey===b.scopeKey);
  prior.sort((a,b)=>a.source.firstPage-b.source.firstPage);
  if(prior.length){
    const last=prior.at(-1);
    ok(last.status==='COMPLETED'&&!terminal(last)&&
      b.firstPage===last.source.firstPage+last.source.pageCount&&
      same(last.source.slots,b.slots),
      'RANK_REQUEST_SEQUENCE_OR_SNAPSHOT_DRIFT');
  }else ok(b.firstPage===1,'RANK_REQUEST_FIRST_PAGE_REQUIRED');
  const out=clone(state);out.rankRequests??={};
  out.rankRequests[k]={key:k,source:b,status:'READY',
    attempt:null,observedPoints:null,wallMs:null,result:null,incident:null};
  out.version++;return out;
}
export function readyRankBatches(state){
  ok(state?.schema===1,'CHECKPOINT_INVALID');
  if(state.status!=='ACTIVE')return [];
  return Object.values(state.rankRequests??{}).filter(e=>e.status==='READY')
    .sort((a,b)=>a.key.localeCompare(b.key)).map(e=>({
      key:e.key,...clone(e.source)
    }));
}
export function beginRankBatch(state,k,attemptId,atMs){
  ok(state?.schema===1&&state.status==='ACTIVE','NOT_ACTIVE');
  const e=state.rankRequests?.[k];
  ok(e&&e.status==='READY','RANK_REQUEST_NOT_READY');
  ok(token(attemptId)&&Number.isSafeInteger(atMs)&&atMs>=0,
    'INVALID_ATTEMPT');
  ok(!pending(state),'SCOPE_HAS_UNRESOLVED_ATTEMPT');
  ok(!allAttempts(state).includes(attemptId),'DUPLICATE_ATTEMPT_ID');
  const out=clone(state);
  out.rankRequests[k].status='IN_FLIGHT';
  out.rankRequests[k].attempt={id:attemptId,startedAtMs:atMs,
    kind:'RANK_BATCH'};
  out.version++;return out;
}
const checkAttempt=(state,k,attemptId)=>{
  const e=state?.rankRequests?.[k];
  ok(e?.status==='IN_FLIGHT'&&e.attempt?.id===attemptId,
    'RANK_ATTEMPT_NOT_CURRENT');
  return e;
};
const cost=(points,wallMs)=>{
  ok(points===null||typeof points==='number'&&
    Number.isFinite(points)&&points>=0,'POINT_COST_INVALID');
  ok(wallMs===null||Number.isFinite(wallMs)&&wallMs>=0,
    'WALL_TIME_INVALID');
};
export function completeRankBatch(state,k,attemptId,result,{
  points=null,wallMs=null
}={}){
  const e=checkAttempt(state,k,attemptId);
  cost(points,wallMs);
  ok(result&&Array.isArray(result.pages)&&
    result.pages.length>=1&&result.pages.length<=e.source.pageCount&&
    Array.isArray(result.verified),'RANK_RESULT_INVALID');
  const byRank=new Map(e.source.slots.map(s=>[s.rank,s]));
  const verified=new Map(),seenPages=new Set();
  for(let i=0;i<result.pages.length;i++){
    const p=result.pages[i];
    ok(p?.page===e.source.firstPage+i&&
      ['OK','UNAVAILABLE'].includes(p.status)&&
      Array.isArray(p.newVerifiedRanks),
      'RANK_RESULT_PAGE_SEQUENCE');
    ok(p.status==='OK'?
      Number.isSafeInteger(p.rowCount)&&p.rowCount>=0&&
      p.rowCount<=100&&p.newVerifiedRanks.length<=p.rowCount:
      p.rowCount==null&&p.newVerifiedRanks.length===0,
      'RANK_RESULT_ROW_COUNT');
    if(i<result.pages.length-1)
      ok(p.status==='OK'&&p.rowCount===100&&p.hasMorePages!==false,
        'RANK_RESULT_AFTER_TERMINAL');
    seenPages.add(p.page);
    for(const rank of p.newVerifiedRanks){
      ok(int(rank)&&rank<=100&&!verified.has(rank),
        'RANK_RESULT_DUPLICATE_RANK');
      verified.set(rank,p.page);
    }
  }
  ok(result.verified.length===verified.size,'RANK_RESULT_PROOF_COUNT');
  const committed=[];
  for(const row of result.verified){
    const s=byRank.get(row?.rank),p=row?.proof;
    ok(s&&row.jobKey===e.source.jobKey&&
      row.snapshotSha===e.source.snapshotSha&&
      verified.get(row.rank)===p?.discovery?.page&&
      p.discovery.kind==='BOSSDPS_RANKING_PAGE'&&
      p.proofType==='EXACT_SAME_FIGHT_ACTOR'&&token(p.actorRef)&&
      p.snapshotSha===s.snapshotSha&&
      p.reportCode===s.reportCode&&p.fightId===s.fightId&&
      p.encounterId===s.encounterId&&p.difficulty===s.difficulty&&
      p.reportRevision===s.reportRevision&&
      typeof p.bossDps==='number'&&Number.isFinite(p.bossDps)&&
      p.bossDps>=0&&p.bossDps<=s.totalDps+.005&&
      p.sourceStartTime===s.startTime,
      'RANK_RESULT_PROOF_INVALID');
    committed.push(clone(row));
  }
  const out=clone(state),target=out.rankRequests[k];
  target.status='COMPLETED';target.result={
    pages:clone(result.pages),verified:committed};
  target.observedPoints=points;target.wallMs=wallMs;
  out.version++;return out;
}
export function uncertainRankBatch(state,k,attemptId,{
  code,points=null,wallMs=null
}={}){
  checkAttempt(state,k,attemptId);cost(points,wallMs);
  ok(typeof code==='string'&&/^[A-Z0-9_]{2,60}$/.test(code),
    'INCIDENT_CODE_INVALID');
  const out=clone(state),target=out.rankRequests[k];
  target.status='NEEDS_REVIEW';
  target.incident={code,automaticRetry:false};
  target.observedPoints=points;target.wallMs=wallMs;
  out.version++;return out;
}
export function committedRankingEvidence(state){
  ok(state?.schema===1,'CHECKPOINT_INVALID');
  const groups=new Map();
  for(const e of Object.values(state.rankRequests??{})){
    if(e.status!=='COMPLETED'||!e.result)continue;
    const source=e.source,k=JSON.stringify([
      source.scopeKey,source.jobKey,source.snapshotSha]);
    if(!groups.has(k))groups.set(k,{scopeKey:source.scopeKey,
      jobKey:source.jobKey,snapshotSha:source.snapshotSha,pages:[]});
    groups.get(k).pages.push(...clone(e.result.pages));
  }
  for(const g of groups.values())g.pages.sort((a,b)=>a.page-b.page);
  return [...groups.values()];
}
