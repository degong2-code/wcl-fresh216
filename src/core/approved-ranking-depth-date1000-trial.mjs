/**
 * Fixed dated Heroic Nek'zali depth experiment: TotalDPS page1,
 * BossDPS pages1..10, 2026-10-22 through 2026-10-28 KST inclusive.
 * Pure core: no HTTP, OAuth, persistence, or private output.
 */
export const DATED_REQUEST='experiments/approved-nekzali-20261022-28-boss1000.json';
export const DATED_ID='FRESH216_NEKZALI_20261022_28_BOSS1000_20261028';
export const DATED_APPROVAL='OWNER_APPROVED_20261028_NEKZALI_20261022_28_BOSS1000';
export const DATED_ONCE_REF='refs/heads/wcl-fresh216-approved-nekzali-20261022-28-boss1000-consumed';
export const DATED_TARGET=Object.freeze({
  encounterId:3470,difficulty:4,partition:1,
  startMs:1792594800000,endMs:1793199600000,
  filter:'date.1792594800000.1793199600000',
  maxGraphql:3,bossPages:Object.freeze([1,2,3,4,5,6,7,8,9,10]),
  specs:Object.freeze([
    Object.freeze({key:'balance',className:'Druid',specName:'Balance'}),
    Object.freeze({key:'enhancement',className:'Shaman',specName:'Enhancement'}),
    Object.freeze({key:'survival',className:'Hunter',specName:'Survival'})
  ])
});
const okNum=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const norm=v=>String(v??'').trim().toLowerCase();
const masked=n=>!n||n==='anonymous'||/^player\s*\(\d+\)$/.test(n);
const rep=r=>r?.report?.code||r?.reportCode||r?.reportID||null;
const fid=r=>Number(r?.report?.fightID||r?.report?.fightId||r?.fightID||r?.fightId);
const start=r=>{const n=Number(r?.startTime);return Number.isFinite(n)&&n>0?n:null;};
const key=r=>{
  const code=rep(r),fight=fid(r),name=norm(r?.name);
  if(typeof code!=='string'||!code||!/^[\x21-\x7e]+$/.test(code)||
     !Number.isSafeInteger(fight)||fight<=0||masked(name))return null;
  return JSON.stringify([code,fight,name]);
};
const sameKnown=(a,b)=>a==null||a===''||b==null||b===''||String(a)===String(b);
const exactFight=(a,b)=>{
  const x=start(a),y=start(b);
  return x!==null&&y!==null&&x===y&&
    sameKnown(a?.reportRevision,b?.reportRevision);
};
const rows=(obj,label)=>{
  if(!obj||typeof obj!=='object'||!Array.isArray(obj.rankings))
    throw Error('DATED_'+label+'_SHAPE');
  const out=obj.rankings;
  if(out.some(r=>{
    const t=start(r);
    return !r||r.amount==null||r.amount===''||
      !Number.isFinite(Number(r.amount))||Number(r.amount)<0||t===null||
      t<DATED_TARGET.startMs||t>=DATED_TARGET.endMs;
  }))throw Error('DATED_'+label+'_ROW_OR_DATE');
  return out;
};
const rate=(body)=>{
  const r=body?.data?.rateLimitData??{};
  let c=r.currentRequest;
  if(typeof c==='string'){try{c=JSON.parse(c);}catch{c=null;}}
  if(!c||typeof c!=='object'||Array.isArray(c))c={};
  const pointClasses={application:null,database:null,user:null};
  for(const k of Object.keys(pointClasses))if(okNum(c[k]))pointClasses[k]=c[k];
  return {total:okNum(c.total)?c.total:null,pointClasses,
    appRemaining:okNum(r.limitPerHour)&&okNum(r.pointsSpentThisHour)
      ?Math.max(0,r.limitPerHour-r.pointsSpentThisHour):null,
    databaseRemaining:okNum(r.databaseLimitPerHour)&&okNum(r.databasePointsSpentThisHour)
      ?Math.max(0,r.databaseLimitPerHour-r.databasePointsSpentThisHour):null,
    userHasRemainingPoints:typeof r.userHasRemainingPoints==='boolean'
      ?r.userHasRemainingPoints:null};
};
export function validateDatedRequest(request){
  const keys=['request_id','approval','encounter_id','difficulty','partition',
    'date_start_kst','date_end_kst','filter','specs','total_dps_pages',
    'boss_dps_pages','max_graphql'];
  if(!request||typeof request!=='object'||Array.isArray(request)||
     Object.keys(request).sort().join('|')!==keys.slice().sort().join('|'))
    throw Error('MEASUREMENT_REQUEST_FIELDS_INVALID');
  if(request.request_id!==DATED_ID||request.approval!==DATED_APPROVAL||
     request.encounter_id!==3470||request.difficulty!==4||request.partition!==1||
     request.date_start_kst!=='2026-10-22'||request.date_end_kst!=='2026-10-28'||
     request.filter!==DATED_TARGET.filter||request.max_graphql!==3||
     JSON.stringify(request.specs)!==JSON.stringify(DATED_TARGET.specs.map(s=>s.key))||
     JSON.stringify(request.total_dps_pages)!=='[1]'||
     JSON.stringify(request.boss_dps_pages)!==JSON.stringify(DATED_TARGET.bossPages))
    throw Error('MEASUREMENT_REQUEST_SCOPE_INVALID');
  return true;
}
export function buildDatedDepthQuery(spec){
  if(!DATED_TARGET.specs.some(s=>s.key===spec?.key&&
    s.className===spec.className&&s.specName===spec.specName))
    throw Error('MEASUREMENT_SPEC_NOT_ALLOWLISTED');
  const boss=DATED_TARGET.bossPages.map(p=>
    'b'+p+':characterRankings(difficulty:$difficulty,className:$className,'+
    'specName:$specName,metric:bossdps,page:'+p+',filter:$filter,partition:$partition)'
  ).join(' ');
  return {
    query:'query Fresh216DatedNekzali1000($id:Int!,$difficulty:Int!,$className:String!,'+
      '$specName:String!,$filter:String!,$partition:Int!){'+
      'rateLimitData{currentRequest limitPerHour pointsSpentThisHour databaseLimitPerHour databasePointsSpentThisHour userHasRemainingPoints} '+
      'worldData{encounter(id:$id){'+
      't1:characterRankings(difficulty:$difficulty,className:$className,'+
      'specName:$specName,metric:dps,page:1,filter:$filter,partition:$partition) '+
      boss+'}}}',
    variables:{id:3470,difficulty:4,className:spec.className,
      specName:spec.specName,filter:DATED_TARGET.filter,partition:1}
  };
}
export function summarizeDatedDepth(spec,{httpStatus,body,elapsedMs}={}){
  const observed=rate(body);
  const base={specialization:spec?.key??'unknown',httpStatus,
    elapsedMs:Number.isFinite(elapsedMs)&&elapsedMs>=0?elapsedMs:null,
    reportedPointTotal:observed.total,pointClasses:observed.pointClasses,
    appRemaining:observed.appRemaining,databaseRemaining:observed.databaseRemaining,
    userHasRemainingPoints:observed.userHasRemainingPoints};
  if(httpStatus!==200||!body||typeof body!=='object'||
    (body.errors!=null&&(!Array.isArray(body.errors)||body.errors.length>0)))
    return {...base,status:'NEEDS_REVIEW',reason:'HTTP_OR_GRAPHQL_INVALID'};
  let overall,pages;
  try{
    const enc=body.data?.worldData?.encounter;
    if(!enc)throw Error('DATED_ENCOUNTER_MISSING');
    overall=rows(enc.t1,'TOTAL_P1');
    pages=DATED_TARGET.bossPages.map(p=>rows(enc['b'+p],'BOSS_P'+p));
  }catch(e){
    return {...base,status:'NEEDS_REVIEW',
      reason:/^DATED_[A-Z0-9_]+$/.test(String(e?.message))?
        e.message:'DATED_RESPONSE_SHAPE_INVALID'};
  }
  const left=new Map(),right=new Map();
  for(const r of overall){const k=key(r);if(k)left.set(k,(left.get(k)||0)+1);}
  pages.forEach((page,p)=>page.forEach(r=>{
    const k=key(r);if(!k)return;
    const list=right.get(k)||[];list.push({page:p+1,row:r});right.set(k,list);
  }));
  const byPage=Array(10).fill(0),top30ByPage=Array(10).fill(0);
  let anonymous=0,ambiguous=0,timeConflict=0,implausible=0,notFound=0;
  for(let i=0;i<overall.length;i++){
    const a=overall[i],k=key(a);
    if(!k){anonymous++;continue;}
    const cand=right.get(k)||[];
    if(left.get(k)!==1||cand.length>1){ambiguous++;continue;}
    if(cand.length===0){notFound++;continue;}
    const b=cand[0].row;
    if(!exactFight(a,b)){timeConflict++;continue;}
    if(Number(b.amount)>Number(a.amount)+0.005){implausible++;continue;}
    byPage[cand[0].page-1]++;
    if(i<30)top30ByPage[cand[0].page-1]++;
  }
  const cumulative=byPage.map((_,i)=>byPage.slice(0,i+1).reduce((a,b)=>a+b,0));
  const top30Cumulative=top30ByPage.map((_,i)=>top30ByPage.slice(0,i+1).reduce((a,b)=>a+b,0));
  const unresolved=overall.length-cumulative.at(-1);
  const complete100=overall.length===100;
  return {...base,status:'RECORDED',reason:null,
    scope:'DATE_FILTERED',dateStartKst:'2026-10-22',dateEndKst:'2026-10-28',
    filter:DATED_TARGET.filter,partition:1,encounterId:3470,difficulty:4,
    totalRows:overall.length,totalTop100Complete:complete100,
    bossRowsByPage:pages.map(x=>x.length),directMatchesByPage:byPage,
    cumulativeMatches:cumulative,
    coveragePct:cumulative.map(n=>overall.length?Number((100*n/overall.length).toFixed(1)):null),
    top30CumulativeMatches:top30Cumulative,
    top30CompleteByPage:top30Cumulative.map(n=>overall.length>=30&&n===30),
    top100CompleteByPage:cumulative.map(n=>complete100&&n===100),
    unresolvedAfterMaxPage:unresolved,anonymousTop100:anonymous,
    namedNotFoundOnTenPages:notFound,ambiguousKeys:ambiguous,
    timestampOrRevisionConflict:timeConflict,bossExceedsTotal:implausible,
    lastNonEmptyBossPage:pages.reduce((m,x,i)=>x.length?i+1:m,0)};
}
