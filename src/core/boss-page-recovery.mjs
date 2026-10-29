/**
 * Ranking-first BossDPS page boundary. Pure, OFFLINE, and single-job scoped.
 * Caller supplies immutable, source-attested TotalDPS top100 and cached
 * official BossDPS leaderboard pages. This code never makes HTTP requests.
 * A global leaderboard may omit a different fight's BossDPS parse entirely.
 */
const need=(x,code)=>{if(!x)throw Error(code);};
const pos=x=>Number.isSafeInteger(x)&&x>0;
const name=x=>typeof x==='string'?x.trim().toLowerCase():'';
const masked=x=>!name(x)||name(x)==='anonymous'||/^player\s*\(\d+\)$/.test(name(x));
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const report=r=>r?.report?.code||r?.reportCode||r?.reportID||null;
const fight=r=>r?.report?.fightID||r?.report?.fightId||r?.fightID||r?.fightId||null;
const identity=r=>{
  const c=report(r),f=Number(fight(r));
  if(typeof c!=='string'||!c||!/^[\x21-\x7e]+$/.test(c)||!pos(f)||masked(r?.name))return null;
  return JSON.stringify([c,f,name(r.name)]);
};
const time=r=>{
  const n=Number(r?.startTime);
  if(!Number.isFinite(n)||n<=0)return null;
  return n>1e12?n:n>1e9&&n<1e11?n*1000:null;
};
function validScope(s){
  need(s&&pos(s.encounterId)&&(s.difficulty===4||s.difficulty===5)&&
    typeof s.className==='string'&&s.className.trim()&&
    typeof s.specName==='string'&&s.specName.trim()&&pos(s.partition)&&
    typeof s.filter==='string'&&/^date\.\d+\.\d+$/.test(s.filter),
    'BOSS_PAGE_SCOPE_INVALID');
  const [_,from,to]=s.filter.split('.');
  const a=Number(from),b=Number(to);
  need(Number.isSafeInteger(a)&&Number.isSafeInteger(b)&&a>0&&b>a,
    'BOSS_PAGE_DATE_FILTER_INVALID');
  return {from:a,to:b};
}
const sameKnown=(a,b)=>a===undefined||a===null||a===''||b===undefined||b===null||b===''||String(a)===String(b);
const rowFitsScope=(r,s,{requireTime=false}={})=>{
  const t=time(r),{from,to}=validScope(s);
  if(requireTime&&!t)return false;
  if(t!==null&&(t<from||t>=to))return false;
  if(!sameKnown(r?.className??r?.class,s.className)||
     !sameKnown(r?.specName??r?.spec,s.specName)||
     !sameKnown(r?.encounterId,s.encounterId)||
     !sameKnown(r?.difficulty,s.difficulty)||
     !sameKnown(r?.partition,s.partition))return false;
  return true;
};
const matchingContext=(a,b,s)=>{
  if(!rowFitsScope(a,s)||!rowFitsScope(b,s,{requireTime:true}))return false;
  const ta=time(a),tb=time(b);
  if(ta!==null&&tb!==null&&ta!==tb)return false;
  if(!sameKnown(a?.reportRevision,b?.reportRevision))return false;
  return true;
};

/** Only describes the official GraphQL query for a SPECIFIC extra page.
 * A page index does not imply 100 rows, a point price, or recoverability.
 */
export function makeBossPageQuery(scope,page){
  validScope(scope);
  need(page===2||page===3,'BOSS_PAGE_BOUND_INVALID');
  return {
    query:'query Fresh216BossPage($id:Int!,$difficulty:Int!,$className:String!,$specName:String!,$filter:String!,$partition:Int!){'+
      'rateLimitData{currentRequest} worldData{encounter(id:$id){'+
      'boss:characterRankings(difficulty:$difficulty,className:$className,'+
      'specName:$specName,metric:bossdps,page:'+page+',filter:$filter,partition:$partition)'+
      '}}}',
    variables:{id:scope.encounterId,difficulty:scope.difficulty,
      className:scope.className,specName:scope.specName,
      filter:scope.filter,partition:scope.partition}
  };
}

/** Decodes an injected response from a later authorized query. Never executes it.
 * The caller must bind HTTP response to its original query/scope/page.
 */
export function decodeBossPage(scope,page,httpStatus,body){
  validScope(scope);
  need(page===2||page===3,'BOSS_PAGE_BOUND_INVALID');
  const point=body?.data?.rateLimitData?.currentRequest?.total;
  const observedPoints=finite(point)&&point>=0?point:null;
  if(httpStatus!==200||!body||typeof body!=='object'||
    (body.errors!=null&&(!Array.isArray(body.errors)||body.errors.length>0)))
    return {status:'UNCERTAIN_HTTP_OR_GRAPHQL',observedPoints,rankings:null};
  const rows=body.data?.worldData?.encounter?.boss?.rankings;
  if(!Array.isArray(rows)||rows.some(r=>!r||!finite(Number(r.amount))||
      r.amount===null||r.amount===''||Number(r.amount)<0||
      !rowFitsScope(r,scope,{requireTime:true})))
    return {status:'BOSS_PAGE_SHAPE_OR_SCOPE_INVALID',observedPoints,rankings:null};
  return {status:'OK',observedPoints,
    rankings:rows.map(r=>({...r,amount:Number(r.amount)}))};
}

/**
 * Merge only matching report+fight+UNIQUE name from already decoded pages.
 * Existing BossDPS proofs are immutable. The result is a candidate plan,
 * not a production proof or a license to dispatch the next page.
 * @param {object} args {scope,overall[100],savedBoss[100],pages:[{page,rankings}]}
 */
export function matchCachedBossPages({scope,overall,savedBoss,pages}={}){
  validScope(scope);
  need(Array.isArray(overall)&&overall.length===100&&
       Array.isArray(savedBoss)&&savedBoss.length===100&&
       Array.isArray(pages)&&pages.length>=1&&pages.length<=3,
       'BOSS_PAGE_INPUT_SHAPE');
  for(let i=0;i<100;i++){
    need(finite(Number(overall[i]?.amount))&&Number(overall[i].amount)>0&&
      (savedBoss[i]===null||(finite(savedBoss[i])&&savedBoss[i]>=0&&
        savedBoss[i]<=Number(overall[i].amount)+0.005)),
      'BOSS_PAGE_TOTAL_OR_SAVED_INVALID');
  }
  for(let i=0;i<pages.length;i++){
    const p=pages[i];
    need(p?.page===i+1&&Array.isArray(p.rankings),'BOSS_PAGE_SEQUENCE_INVALID');
    need(p.rankings.every(r=>r&&finite(Number(r.amount))&&
      r.amount!==null&&r.amount!==''&&Number(r.amount)>=0&&
      rowFitsScope(r,scope,{requireTime:true})),
      'BOSS_PAGE_CACHED_ROWS_INVALID');
  }
  const left=new Map(),right=new Map();
  for(const r of overall){const id=identity(r);if(id)left.set(id,(left.get(id)||0)+1);}
  for(const p of pages)for(const r of p.rankings){
    const id=identity(r);
    if(id){const a=right.get(id)||[];a.push(r);right.set(id,a);}
  }
  const values=savedBoss.slice();
  let newMatches=0,reusedSaved=0,anonymousSkipped=0,conflicts=0;
  for(let i=0;i<100;i++){
    const r=overall[i];
    if(values[i]!==null){reusedSaved++;continue;}
    const id=identity(r);
    if(!id){anonymousSkipped++;continue;}
    const candidates=right.get(id)||[];
    if(left.get(id)!==1||candidates.length>1){conflicts++;continue;}
    if(candidates.length!==1)continue;
    const b=candidates[0],amount=Number(b.amount);
    if(!matchingContext(r,b,scope)||amount>Number(r.amount)+0.005){conflicts++;continue;}
    values[i]=amount;newMatches++;
  }
  const pendingNamed=overall.reduce((n,r,i)=>n+(values[i]===null&&identity(r)!==null?1:0),0);
  const last=pages[pages.length-1];
  const nextPageCandidate=last.page<3 && last.rankings.length>0 && pendingNamed>0
    ?last.page+1:null;
  return {values,newMatches,reusedSaved,anonymousSkipped,
    pendingNamed,conflicts,unresolved:values.filter(v=>v===null).length,
    nextPageCandidate,readyForAutomaticDispatch:false,
    observedWclPoints:null,measuredElapsedMs:null};
}
