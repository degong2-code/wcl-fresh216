/**
 * Owner-approved completion-depth experiment.
 * Heroic Nek'zali, 2026-10-22..28 KST, latest/default partition.
 * Specs: Frost DK, Retribution Paladin, Shadow Priest.
 *
 * Ranking phase has NO fixed rank ceiling: fetch BossDPS 10 pages at a time
 * until every named TotalDPS top100 slot is matched OR WCL reaches the final
 * leaderboard page (<100 rows). Then use official same-fight Report rankings
 * for all residual named + anonymous slots.
 */
export const COMPLETE_REQUEST=
  'experiments/approved-nekzali-20261022-28-completion-depth.json';
export const COMPLETE_ID='FRESH216_NEKZALI_20261022_28_COMPLETION_DEPTH_20261028';
export const COMPLETE_APPROVAL='OWNER_APPROVED_20261028_NEKZALI_COMPLETION_DEPTH_ALL_REQUIRED_CALLS';
export const COMPLETE_ONCE_REF=
  'refs/heads/wcl-fresh216-approved-nekzali-20261022-28-completion-depth-consumed';
export const COMPLETE_TARGET=Object.freeze({
  encounterId:3470,difficulty:4,
  startMs:1792594800000,endMs:1793199600000,
  filter:'date.1792594800000.1793199600000',
  rankingBatchPages:10,reportAliasCap:4,
  specs:Object.freeze([
    Object.freeze({key:'frost_dk',className:'DeathKnight',specName:'Frost'}),
    Object.freeze({key:'retribution',className:'Paladin',specName:'Retribution'}),
    Object.freeze({key:'shadow',className:'Priest',specName:'Shadow'})
  ])
});
const num=v=>Number.isFinite(Number(v))?Number(v):null;
const norm=v=>String(v??'').trim().toLowerCase();
const maskedName=v=>{
  const n=norm(v);return !n||n==='anonymous'||/^player\s*\(\d+\)$/.test(n);
};
const reportCode=r=>r?.report?.code||r?.reportCode||r?.reportID||null;
const fightId=r=>Number(r?.report?.fightID||r?.report?.fightId||r?.fightID||r?.fightId);
const startTime=r=>{const n=Number(r?.startTime);return Number.isFinite(n)&&n>0?n:null;};
export const fightKey=r=>{
  const c=reportCode(r),f=fightId(r);
  return typeof c==='string'&&c&&Number.isSafeInteger(f)&&f>0?c+'|'+f:null;
};
export const rankIdentity=r=>{
  const fk=fightKey(r),n=norm(r?.name);
  return fk&&!maskedName(n)?fk+'|'+n:null;
};
const inWindow=r=>{
  const t=startTime(r);return t!==null&&t>=COMPLETE_TARGET.startMs&&t<COMPLETE_TARGET.endMs;
};
const rate=(body)=>{
  const r=body?.data?.rateLimitData??{};
  let c=r.currentRequest;
  if(typeof c==='string'){try{c=JSON.parse(c);}catch{c=null;}}
  if(!c||typeof c!=='object'||Array.isArray(c))c={};
  const pointClasses={application:null,database:null,user:null};
  for(const k of Object.keys(pointClasses)){
    const v=num(c[k]);if(v!==null&&v>=0)pointClasses[k]=v;
  }
  const total=num(c.total);
  return {total:total!==null&&total>=0?total:null,pointClasses};
};
const rankingRows=(obj,label)=>{
  if(!obj||typeof obj!=='object'||!Array.isArray(obj.rankings))
    throw Error('COMPLETE_'+label+'_SHAPE');
  const rows=obj.rankings;
  if(rows.length>100)throw Error('COMPLETE_'+label+'_TOO_MANY_ROWS');
  for(const r of rows){
    const amount=num(r?.amount);
    if(!r||amount===null||amount<0||!inWindow(r)||!fightKey(r))
      throw Error('COMPLETE_'+label+'_ROW_INVALID');
  }
  return rows;
};
export function validateCompletionRequest(request){
  const keys=['request_id','approval','encounter_id','difficulty',
    'partition_mode','date_start_kst','date_end_kst','filter','specs',
    'total_dps_pages','boss_dps_mode','ranking_batch_pages',
    'report_fallback','report_alias_cap'];
  if(!request||typeof request!=='object'||Array.isArray(request)||
     Object.keys(request).sort().join('|')!==keys.slice().sort().join('|'))
    throw Error('COMPLETE_REQUEST_FIELDS_INVALID');
  if(request.request_id!==COMPLETE_ID||request.approval!==COMPLETE_APPROVAL||
     request.encounter_id!==3470||request.difficulty!==4||
     request.partition_mode!=='LATEST_DEFAULT'||
     request.date_start_kst!=='2026-10-22'||request.date_end_kst!=='2026-10-28'||
     request.filter!==COMPLETE_TARGET.filter||
     JSON.stringify(request.specs)!==JSON.stringify(COMPLETE_TARGET.specs.map(s=>s.key))||
     JSON.stringify(request.total_dps_pages)!=='[1]'||
     request.boss_dps_mode!=='UNTIL_NAMED_COMPLETE_OR_LEADERBOARD_END'||
     request.ranking_batch_pages!==10||
     request.report_fallback!=='ALL_RESIDUAL_NAMED_AND_ANONYMOUS'||
     request.report_alias_cap!==4)
    throw Error('COMPLETE_REQUEST_SCOPE_INVALID');
  return true;
}
export function buildRankingBatchQuery(spec,firstPage,{includeTotal=false}={}){
  if(!COMPLETE_TARGET.specs.some(s=>s.key===spec?.key&&
    s.className===spec.className&&s.specName===spec.specName))
    throw Error('COMPLETE_SPEC_NOT_ALLOWLISTED');
  if(!Number.isSafeInteger(firstPage)||firstPage<1)
    throw Error('COMPLETE_PAGE_INVALID');
  const pages=Array.from({length:COMPLETE_TARGET.rankingBatchPages},(_,i)=>firstPage+i);
  const bosses=pages.map(p=>
    'b'+p+':characterRankings(difficulty:$difficulty,className:$className,'+
    'specName:$specName,metric:bossdps,page:'+p+',filter:$filter)'
  ).join(' ');
  const total=includeTotal?
    't1:characterRankings(difficulty:$difficulty,className:$className,'+
    'specName:$specName,metric:dps,page:1,filter:$filter) ':'';
  return {pages,query:
    'query Fresh216CompletionDepth($id:Int!,$difficulty:Int!,$className:String!,'+
    '$specName:String!,$filter:String!){rateLimitData{currentRequest} '+
    'worldData{encounter(id:$id){'+total+bosses+'}}}',
    variables:{id:3470,difficulty:4,className:spec.className,
      specName:spec.specName,filter:COMPLETE_TARGET.filter}};
}
export function createRankingState(spec,body,firstPage,{includeTotal=false}={}){
  const observed=rate(body);
  if(!body||typeof body!=='object'||(Array.isArray(body.errors)&&body.errors.length))
    throw Error('COMPLETE_GRAPHQL_INVALID');
  const enc=body.data?.worldData?.encounter;
  if(!enc)throw Error('COMPLETE_ENCOUNTER_MISSING');
  let overall=null;
  if(includeTotal){
    overall=rankingRows(enc.t1,'TOTAL_P1');
    if(overall.length!==100)throw Error('COMPLETE_TOTAL_NOT_100');
  }
  const pages=[];
  for(let p=firstPage;p<firstPage+COMPLETE_TARGET.rankingBatchPages;p++)
    pages.push({page:p,rows:rankingRows(enc['b'+p],'BOSS_P'+p)});
  return {spec,overall,pages,observed};
}
export function initCompletionState(spec,overall){
  if(!Array.isArray(overall)||overall.length!==100)throw Error('COMPLETE_TOTAL_NOT_100');
  const left=new Map();
  overall.forEach(r=>{const k=rankIdentity(r);if(k)left.set(k,(left.get(k)||0)+1);});
  return {spec,overall,values:Array(100).fill(null),left,
    pageYields:[],pageSizes:[],ambiguous:0,timeConflict:0,implausible:0,
    lastPage:0,leaderboardEnded:false};
}
export function applyRankingBatch(state,pages){
  if(!state||!Array.isArray(pages)||pages.length!==10)
    throw Error('COMPLETE_BATCH_INVALID');
  for(const {page,rows} of pages){
    if(page!==state.lastPage+1)throw Error('COMPLETE_PAGE_SEQUENCE');
    const byId=new Map();
    for(const r of rows){
      const k=rankIdentity(r);
      if(!k)continue;
      const list=byId.get(k)||[];list.push(r);byId.set(k,list);
    }
    let gain=0;
    for(let i=0;i<100;i++){
      if(state.values[i]!==null)continue;
      const a=state.overall[i],id=rankIdentity(a);
      if(!id)continue;
      const cand=byId.get(id)||[];
      if(state.left.get(id)!==1||cand.length>1){if(cand.length)state.ambiguous++;continue;}
      if(cand.length!==1)continue;
      const b=cand[0];
      if(startTime(a)!==startTime(b)){state.timeConflict++;continue;}
      const bd=num(b.amount),td=num(a.amount);
      if(bd===null||td===null||bd>td+0.005){state.implausible++;continue;}
      state.values[i]=bd;gain++;
    }
    state.lastPage=page;state.pageYields.push(gain);state.pageSizes.push(rows.length);
    if(rows.length<100){state.leaderboardEnded=true;break;}
  }
  return rankingProgress(state);
}
export function rankingProgress(state){
  const namedTotal=state.overall.filter(r=>rankIdentity(r)!==null).length;
  const anonymousTotal=100-namedTotal;
  let namedResolved=0;
  for(let i=0;i<100;i++)if(rankIdentity(state.overall[i])&&state.values[i]!==null)namedResolved++;
  return {namedTotal,anonymousTotal,namedResolved,
    namedUnresolved:namedTotal-namedResolved,resolved:state.values.filter(v=>v!==null).length,
    lastPage:state.lastPage,leaderboardEnded:state.leaderboardEnded,
    rankingDone:namedResolved===namedTotal||state.leaderboardEnded};
}
export function unresolvedFightGroups(state){
  const groups=new Map();
  for(let i=0;i<100;i++){
    if(state.values[i]!==null)continue;
    const fk=fightKey(state.overall[i]);
    if(!fk)continue;
    if(!groups.has(fk))groups.set(fk,{fightKey:fk,code:reportCode(state.overall[i]),
      fightId:fightId(state.overall[i]),indexes:[]});
    groups.get(fk).indexes.push(i);
  }
  return [...groups.values()];
}
export function buildReportBatchQuery(groups){
  if(!Array.isArray(groups)||groups.length<1||groups.length>COMPLETE_TARGET.reportAliasCap)
    throw Error('COMPLETE_REPORT_GROUP_COUNT');
  const decl=[],vars={},fields=[];
  groups.forEach((g,i)=>{
    const k='c'+i;decl.push('$'+k+':String!');vars[k]=g.code;
    fields.push('r'+i+':report(code:$'+k+'){overall:rankings(fightIDs:['+g.fightId+
      '],playerMetric:dps) boss:rankings(fightIDs:['+g.fightId+
      '],playerMetric:bossdps)}');
  });
  return {query:'query Fresh216CompletionReports('+decl.join(',')+
    '){rateLimitData{currentRequest} reportData{'+fields.join(' ')+'}}',variables:vars};
}
const actorRef=r=>{
  const id=Number(r?.id);
  if(Number.isSafeInteger(id)&&id>0)return 'id:'+id;
  const n=norm(r?.name);return n&&!maskedName(n)?'name:'+n:null;
};
const fightChars=(metric,fid)=>{
  const data=metric?.data;
  if(!Array.isArray(data))return null;
  const found=data.filter(x=>Number(x?.fightID)===fid);
  if(found.length!==1||Number(found[0]?.encounter?.id)!==3470||
     Number(found[0]?.difficulty)!==4)return null;
  const chars=found[0]?.roles?.dps?.characters;
  return Array.isArray(chars)?chars:null;
};
export function recoverFromReport(report,spec,raw,fid){
  const all=fightChars(report?.overall,fid),boss=fightChars(report?.boss,fid);
  if(!all||!boss)return null;
  const d=num(raw?.amount);if(d===null)return null;
  const hits=all.filter(a=>{const x=num(a?.amount);return x!==null&&Math.abs(x-d)<=0.005;});
  if(hits.length!==1)return null;
  const a=hits[0];
  if(norm(a.class)!==norm(spec.className)||norm(a.spec)!==norm(spec.specName))return null;
  if(!maskedName(raw?.name)&&norm(a.name)!==norm(raw.name))return null;
  const ref=actorRef(a);if(!ref||all.filter(x=>actorRef(x)===ref).length!==1)return null;
  const bs=boss.filter(x=>actorRef(x)===ref);
  if(bs.length!==1)return null;
  const b=bs[0],bd=num(b.amount);
  if(norm(b.class)!==norm(spec.className)||norm(b.spec)!==norm(spec.specName)||
     bd===null||bd<0||bd>d+0.005)return null;
  return bd;
}
export function applyReportBatch(state,groups,body){
  const observed=rate(body);
  if(!body||typeof body!=='object'||(Array.isArray(body.errors)&&body.errors.length)||
     !body.data?.reportData)throw Error('COMPLETE_REPORT_GRAPHQL_INVALID');
  let namedRecovered=0,anonymousRecovered=0;
  groups.forEach((g,j)=>{
    const report=body.data.reportData['r'+j];
    for(const i of g.indexes){
      if(state.values[i]!==null)continue;
      const bd=recoverFromReport(report,state.spec,state.overall[i],g.fightId);
      if(bd===null)continue;
      state.values[i]=bd;
      if(maskedName(state.overall[i]?.name))anonymousRecovered++;else namedRecovered++;
    }
  });
  return {namedRecovered,anonymousRecovered,observed};
}
export function finalCompletionSummary(state){
  const p=rankingProgress(state);
  const unresolved=state.values.reduce((a,v,i)=>{
    if(v!==null)return a;
    if(maskedName(state.overall[i]?.name))a.anonymous++;else a.named++;
    return a;
  },{named:0,anonymous:0});
  return {...p,finalResolved:state.values.filter(v=>v!==null).length,
    finalComplete:state.values.every(v=>v!==null),
    unresolvedNamed:unresolved.named,unresolvedAnonymous:unresolved.anonymous,
    pageYields:state.pageYields.slice(),pageSizes:state.pageSizes.slice(),
    ambiguous:state.ambiguous,timeConflict:state.timeConflict,implausible:state.implausible};
}
