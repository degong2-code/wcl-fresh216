import {randomUUID} from 'node:crypto';
import {
  beginRankBatch,completeRankBatch,uncertainRankBatch
} from './rank-batch-checkpoint.mjs';
import {checkpointStats} from './checkpoint.mjs';
import {evaluateRequestAdmission} from './request-admission.mjs';

const safe=v=>Number.isFinite(Number(v))?Number(v):null;
const norm=v=>String(v??'').trim().toLowerCase();
const anonymous=n=>!n||n==='anonymous'||/^player\s*\(\d+\)$/.test(n);
const rid=r=>r?.report?.code||r?.reportCode||r?.reportID||null;
const fight=r=>Number(r?.report?.fightID||r?.report?.fightId||r?.fightID||r?.fightId);
const ident=r=>{
  const c=rid(r),f=fight(r),n=norm(r?.name);
  return typeof c==='string'&&c&&Number.isSafeInteger(f)&&f>0&&
    !anonymous(n)?JSON.stringify([c,f,n]):null;
};
const first=source=>source.firstPage;
const pages=source=>Array.from({length:source.pageCount},(_,i)=>first(source)+i);
const valid=v=>v&&typeof v==='object'&&!Array.isArray(v);
const pointCost=body=>{
  let c=body?.data?.rateLimitData?.currentRequest;
  if(typeof c==='string'){try{c=JSON.parse(c);}catch{c=null;}}
  return typeof c?.total==='number'&&Number.isFinite(c.total)&&c.total>=0?
    c.total:null;
};
export function makeRankBatchQuery(source){
  if(!valid(source)||!Array.isArray(source.slots)||source.slots.length!==100||
     !Number.isSafeInteger(source.firstPage)||source.firstPage<1||
     !Number.isSafeInteger(source.pageCount)||source.pageCount<1||
     source.pageCount>10||!/^date\.\d+\.\d+$/.test(source.filter??''))
    throw Error('RANK_BATCH_QUERY_INVALID');
  const fields=pages(source).map((p,i)=>
    'b'+i+':characterRankings(difficulty:$difficulty,'+
    'className:$className,specName:$specName,metric:bossdps,'+
    'page:'+p+',filter:$filter)').join(' ');
  return {query:'query Fresh216RankBatch($id:Int!,$difficulty:Int!,'+
    '$className:String!,$specName:String!,$filter:String!){'+
    'rateLimitData{currentRequest} worldData{encounter(id:$id){'+
    fields+'}}}',
    variables:{id:source.encounterId,difficulty:source.difficulty,
      className:source.className,specName:source.specName,filter:source.filter}};
}
export function decodeRankBatch(source,httpStatus,body,previous=[]){
  const observedPoints=pointCost(body);
  const reject=reason=>({status:reason,observedPoints,result:null});
  if(httpStatus!==200||!valid(body)||body.errors!=null&&
     (!Array.isArray(body.errors)||body.errors.length))
    return reject('RANK_HTTP_OR_GRAPHQL_UNCERTAIN');
  const enc=body.data?.worldData?.encounter;
  if(!valid(enc))return reject('RANK_ENCOUNTER_INVALID');
  const [_,from,to]=source.filter.split('.').map(Number);
  const pg=[],right=new Map();
  let terminal=false;
  for(let i=0;i<source.pageCount;i++){
    const number=source.firstPage+i,obj=enc['b'+i];
    if(!valid(obj))return reject('RANK_PAGE_SHAPE_INVALID');
    const keys=Object.keys(obj);
    if(keys.length===1&&keys[0]==='error'){
      pg.push({page:number,status:'UNAVAILABLE',rowCount:null,
        newVerifiedRanks:[]});terminal=true;break;
    }
    if(!Array.isArray(obj.rankings)||obj.rankings.length>100)
      return reject('RANK_PAGE_SHAPE_INVALID');
    const rows=obj.rankings;
    for(const r of rows){
      const t=safe(r?.startTime),amount=safe(r?.amount);
      if(!valid(r)||t===null||t<from||t>=to||amount===null||
        amount<0||typeof rid(r)!=='string'||!rid(r)||
        !Number.isSafeInteger(fight(r))||fight(r)<=0)
        return reject('RANK_ROW_OR_SCOPE_INVALID');
      const k=ident(r);
      if(k){const a=right.get(k)||[];a.push({page:number,row:r});right.set(k,a);}
    }
    pg.push({page:number,status:'OK',rowCount:rows.length,newVerifiedRanks:[]});
    if(rows.length<100||obj.hasMorePages===false){terminal=true;break;}
  }
  if(pg.length===0)return reject('RANK_NO_PAGES_OBSERVED');
  const allPrior=new Set(previous.map(r=>r.rank));
  const left=new Map();
  for(const s of source.slots){
    const k=ident({report:{code:s.reportCode,fightID:s.fightId},name:s.name});
    if(k)left.set(k,(left.get(k)||0)+1);
  }
  const verified=[];
  for(const s of source.slots){
    if(allPrior.has(s.rank)||!Number.isSafeInteger(s.reportRevision))continue;
    const k=ident({report:{code:s.reportCode,fightID:s.fightId},name:s.name});
    if(!k||left.get(k)!==1)continue;
    const matches=right.get(k)||[];
    if(matches.length!==1)continue;
    const {page,row}=matches[0],value=safe(row.amount);
    if(safe(row.startTime)!==s.startTime||value===null||
       value>s.totalDps+.005||
       row.reportRevision!=null&&
        String(row.reportRevision)!==String(s.reportRevision)||
       row.className!=null&&norm(row.className)!==norm(s.className)||
       row.specName!=null&&norm(row.specName)!==norm(s.specName))continue;
    const proof={proofType:'EXACT_SAME_FIGHT_ACTOR',
      actorRef:'name:'+norm(s.name),bossDps:value,
      snapshotSha:s.snapshotSha,reportCode:s.reportCode,
      fightId:s.fightId,encounterId:s.encounterId,
      difficulty:s.difficulty,reportRevision:s.reportRevision,
      sourceStartTime:s.startTime,
      discovery:{kind:'BOSSDPS_RANKING_PAGE',page}};
    verified.push({jobKey:s.jobKey,rank:s.rank,
      snapshotSha:s.snapshotSha,proof});
    pg.find(p=>p.page===page).newVerifiedRanks.push(s.rank);
  }
  return {status:'OK',observedPoints,terminal,
    result:{pages:pg,verified}};
}
/** ONE durable ranking request, on the same shared checkpoint as Reports. */
export async function executeOneRankBatch({
  store,request,transport,clock=Date.now,attemptId=randomUUID(),
  admissionPolicy=null,shouldCancel=()=>false
}={}){
  if(!store||typeof store.read!=='function'||
     typeof store.update!=='function'||!request||
     typeof transport!=='function'||typeof clock!=='function'||
     typeof shouldCancel!=='function'||!attemptId)
    throw Error('RANK_RUNNER_CONFIG_INVALID');
  // Bind paid query to the immutable request already registered in the
  // durable checkpoint; never trust a caller-supplied resumed request body.
  const persisted=store.read().rankRequests?.[request.key];
  if(persisted?.status!=='READY')
    throw Error('RANK_REQUEST_NOT_READY');
  const source=persisted.source;
  for(const field of ['scopeKey','jobKey','snapshotSha','encounterId',
    'difficulty','className','specName','filter','firstPage','pageCount']){
    if(request[field]!==source[field])throw Error('RANK_REQUEST_IDENTITY_DRIFT');
  }
  if(JSON.stringify(request.slots)!==JSON.stringify(source.slots))
    throw Error('RANK_REQUEST_SLOT_DRIFT');
  const q=makeRankBatchQuery(source);
  if(shouldCancel())return {status:'CANCELLED_BEFORE_REQUEST',attempted:false};
  const now=clock();
  if(!Number.isSafeInteger(now)||now<0)throw Error('RANK_CLOCK_INVALID');
  if(admissionPolicy){
    const a=evaluateRequestAdmission(store.read(),{...admissionPolicy,nowMs:now});
    if(!a.allowed)return {status:a.status,attempted:false,
      waitMs:a.waitMs,pointsTotalConfirmed:a.pointsTotalConfirmed};
  }
  try{
    store.update(s=>{
      if(admissionPolicy){
        const a=evaluateRequestAdmission(s,{...admissionPolicy,nowMs:now});
        if(!a.allowed){
          const err=Error('RANK_ADMISSION_REFUSED');err.admission=a;
          throw err;
        }
      }
      return beginRankBatch(s,request.key,attemptId,now);
    });
  }catch(e){
    if(e?.admission)return {status:e.admission.status,attempted:false,
      waitMs:e.admission.waitMs,pointsTotalConfirmed:e.admission.pointsTotalConfirmed};
    if(e?.message==='SCOPE_HAS_UNRESOLVED_ATTEMPT')
      return {status:'NEEDS_REVIEW',attempted:false};
    throw e;
  }
  let outcome,points=null;
  try{
    const response=await transport(q);
    const old=Object.values(store.read().rankRequests??{})
      .filter(e=>e.source?.jobKey===request.jobKey&&e.status==='COMPLETED')
      .flatMap(e=>e.result?.verified??[]);
    const decoded=decodeRankBatch(source,response?.httpStatus,response?.body,old);
    points=decoded.observedPoints;
    outcome=decoded.status==='OK'?{result:decoded.result}:
      {code:decoded.status};
  }catch{
    outcome={code:'RANK_TRANSPORT_OR_PROCESSING_EXCEPTION'};
  }
  const end=clock(),wallMs=Number.isSafeInteger(end)&&end>=now?end-now:null;
  // Failure after successful HTTP but before durable commit leaves IN_FLIGHT.
  const s=store.update(state=>outcome.code?
    uncertainRankBatch(state,request.key,attemptId,{
      code:outcome.code,points,wallMs
    }):completeRankBatch(state,request.key,attemptId,outcome.result,{
      points,wallMs
    }));
  const stats=checkpointStats(s);
  return {status:outcome.code?'NEEDS_REVIEW':'RECORDED',
    attempted:true,verified:outcome.result?.verified?.length??0,
    pages:outcome.result?.pages?.length??0,
    observedPoints:points,wallMs,incident:outcome.code??null,
    pointsTotalConfirmed:stats.pointsTotalConfirmed};
}
