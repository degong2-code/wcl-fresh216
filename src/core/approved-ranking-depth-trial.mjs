/**
 * Fixed, bounded current-global ranking-depth experiment.
 * Pure core: no HTTP, no OAuth, no persistence, no private output.
 */
export const MEASUREMENT_REQUEST='experiments/approved-nekzali-current-20261028.json';
export const MEASUREMENT_ID='FRESH216_NEKZALI_CURRENT_RANK_DEPTH_20261028';
export const MEASUREMENT_APPROVAL='OWNER_APPROVED_20261028_FRESH_NEKZALI_ALL_REQUIRED_WCL_CALLS';
export const MEASUREMENT_ONCE_REF='refs/heads/wcl-fresh216-approved-nekzali-current-20261028-consumed';
export const MEASUREMENT_TARGET=Object.freeze({
  encounterId:3470,difficulty:4,currentGlobal:true,maxGraphql:3,
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
    throw Error('MEASUREMENT_'+label+'_SHAPE');
  const out=obj.rankings;
  if(out.some(r=>!r||r.amount==null||r.amount===''||
    !Number.isFinite(Number(r.amount))||Number(r.amount)<0||start(r)===null))
    throw Error('MEASUREMENT_'+label+'_ROW');
  return out;
};
const rate=(body)=>{
  const r=body?.data?.rateLimitData??{};
  let c=r.currentRequest;
  if(typeof c==='string'){try{c=JSON.parse(c);}catch{c=null;}}
  if(!c||typeof c!=='object'||Array.isArray(c))c={};
  const pointClasses={application:null,database:null,user:null};
  for(const k of Object.keys(pointClasses))
    if(okNum(c[k]))pointClasses[k]=c[k];
  return {
    total:okNum(c.total)?c.total:null,pointClasses,
    appRemaining:okNum(r.limitPerHour)&&okNum(r.pointsSpentThisHour)
      ?Math.max(0,r.limitPerHour-r.pointsSpentThisHour):null,
    databaseRemaining:okNum(r.databaseLimitPerHour)&&
      okNum(r.databasePointsSpentThisHour)
      ?Math.max(0,r.databaseLimitPerHour-r.databasePointsSpentThisHour):null,
    userHasRemainingPoints:typeof r.userHasRemainingPoints==='boolean'
      ?r.userHasRemainingPoints:null
  };
};
export function buildRankingDepthQuery(spec){
  if(!MEASUREMENT_TARGET.specs.some(s=>s.key===spec?.key&&
    s.className===spec.className&&s.specName===spec.specName))
    throw Error('MEASUREMENT_SPEC_NOT_ALLOWLISTED');
  const query='query Fresh216CurrentNekzali($id:Int!,$difficulty:Int!,$className:String!,$specName:String!){'+
    'rateLimitData{currentRequest limitPerHour pointsSpentThisHour databaseLimitPerHour databasePointsSpentThisHour userHasRemainingPoints} '+
    'worldData{encounter(id:$id){'+
    't1:characterRankings(difficulty:$difficulty,className:$className,specName:$specName,metric:dps,page:1) '+
    'b1:characterRankings(difficulty:$difficulty,className:$className,specName:$specName,metric:bossdps,page:1) '+
    'b2:characterRankings(difficulty:$difficulty,className:$className,specName:$specName,metric:bossdps,page:2) '+
    'b3:characterRankings(difficulty:$difficulty,className:$className,specName:$specName,metric:bossdps,page:3)'+
    '}}}';
  return {query,variables:{id:3470,difficulty:4,
    className:spec.className,specName:spec.specName}};
}
export function summarizeRankingDepth(spec,{httpStatus,body,elapsedMs}={}){
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
    if(!enc)throw Error('MEASUREMENT_ENCOUNTER_MISSING');
    overall=rows(enc.t1,'TOTAL_P1');
    pages=[rows(enc.b1,'BOSS_P1'),rows(enc.b2,'BOSS_P2'),rows(enc.b3,'BOSS_P3')];
  }catch(e){
    return {...base,status:'NEEDS_REVIEW',
      reason:/^MEASUREMENT_[A-Z0-9_]+$/.test(String(e?.message))?
        e.message:'MEASUREMENT_RESPONSE_SHAPE_INVALID'};
  }
  const left=new Map(),right=new Map();
  for(const r of overall){const k=key(r);if(k)left.set(k,(left.get(k)||0)+1);}
  pages.forEach((page,p)=>page.forEach(r=>{
    const k=key(r);if(!k)return;
    const list=right.get(k)||[];list.push({page:p+1,row:r});right.set(k,list);
  }));
  const byPage=[0,0,0],top30ByPage=[0,0,0];
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
  const unresolved=overall.length-cumulative[2];
  const complete100=overall.length===100;
  return {...base,status:complete100?'RECORDED':'NEEDS_REVIEW',
    reason:complete100?null:'TOTAL_PAGE_NOT_EXACT100',
    currentGlobal:true,encounterId:3470,difficulty:4,
    totalRows:overall.length,bossRowsByPage:pages.map(x=>x.length),
    directMatchesByPage:byPage,cumulativeMatches:cumulative,
    coveragePct:cumulative.map(n=>overall.length?Number((100*n/overall.length).toFixed(1)):null),
    top30CumulativeMatches:top30Cumulative,
    top30CompleteByPage:top30Cumulative.map(n=>overall.length>=30&&n===30),
    top100CompleteByPage:cumulative.map(n=>complete100&&n===100),
    unresolvedAfter3:unresolved,anonymousTop100:anonymous,
    namedNotFoundOnThreePages:notFound,ambiguousKeys:ambiguous,
    timestampOrRevisionConflict:timeConflict,bossExceedsTotal:implausible};
}
