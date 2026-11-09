/**
 * Four comparable WCL BossDPS GraphQL shapes for a small bounded benchmark.
 * No HTTP, secrets, private ranks or state updates. The 2,000-deep plan
 * computes cardinality ONLY and does not authorize full collection.
 */
import {createHash} from 'node:crypto';
import {makeFreshDatedHeroicManifest,validateFreshCohortManifest}
  from './fresh-cohort-source.mjs';

const need=(ok,code)=>{if(!ok)throw Error(code);};
const hash=o=>createHash('sha256')
  .update(JSON.stringify(o)).digest('hex');
const positive=n=>Number.isSafeInteger(n)&&n>0;
const finite=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
export const BENCHMARK_SCOPE=
  'engine-fresh:heroic:2026-10-22_27:candidate-A';
const CASE_SHAPES=Object.freeze([
  {name:'baseline_9',specCount:9,pageCount:1,bossCount:1},
  {name:'wide_27',specCount:27,pageCount:1,bossCount:1},
  {name:'pages_54',specCount:27,pageCount:2,bossCount:1},
  {name:'bosses_108',specCount:27,pageCount:2,bossCount:2}
]);
function buildCase(manifest,shape){
  const bosses=manifest.bosses.slice(0,shape.bossCount);
  const specs=manifest.specs.slice(0,shape.specCount);
  const defs=['$d:Int!','$f:String!'];
  const variables={d:4,f:manifest.filter};
  for(let i=0;i<bosses.length;i++){
    defs.push('$id'+i+':Int!');
    variables['id'+i]=bosses[i].encounterId;
  }
  specs.forEach((s,i)=>{
    defs.push('$c'+i+':String!','$s'+i+':String!');
    variables['c'+i]=s.className;
    variables['s'+i]=s.specName;
  });
  const fields=[],nested=[];
  for(let b=0;b<bosses.length;b++){
    const inside=[];
    for(let s=0;s<specs.length;s++){
      for(let p=1;p<=shape.pageCount;p++){
        const alias='r'+s+'p'+p;
        inside.push(alias+':characterRankings('+
          'difficulty:$d,className:$c'+s+',specName:$s'+s+
          ',metric:bossdps,page:'+p+',filter:$f)');
        fields.push({
          encounterId:bosses[b].encounterId,
          className:specs[s].className,
          specName:specs[s].specName,page:p,
          encounterAlias:'e'+b,rankAlias:alias
        });
      }
    }
    nested.push('e'+b+':encounter(id:$id'+b+'){'+inside.join(' ')+'}');
  }
  need(fields.length===shape.specCount*shape.pageCount*shape.bossCount&&
    fields.length<=108,'BOSS_BENCH_FIELD_BOUND');
  const query='query Fresh216BossBenchmark('+defs.join(',')+
    '){rateLimitData{currentRequest} worldData{'+nested.join(' ')+'}}';
  return Object.freeze({
    name:shape.name,shape:{...shape},fieldCount:fields.length,
    query,variables,fields:Object.freeze(fields),
    queryFingerprint:hash({query,variables})
  });
}
export function makeFreshBossBenchmarkCases({
  scopeKey=BENCHMARK_SCOPE
}={}){
  need(scopeKey===BENCHMARK_SCOPE,'BOSS_BENCH_SCOPE_UNTRUSTED');
  const manifest=makeFreshDatedHeroicManifest(scopeKey);
  validateFreshCohortManifest(manifest);
  need(manifest.difficulty===4&&manifest.bosses.length===8&&
    manifest.specs.length===27&&
    manifest.filter==='date.1792594800000.1793113200000',
    'BOSS_BENCH_COHORT_DRIFT');
  return CASE_SHAPES.map(s=>buildCase(manifest,s));
}
export function summarizeFreshBossBenchmarkResponse(
  sample,{httpStatus,body,wallMs}={}
){
  need(CASE_SHAPES.some(s=>s.name===sample?.name)&&
    positive(sample?.fieldCount)&&sample.fieldCount<=108&&
    finite(wallMs),'BOSS_BENCH_SAMPLE_INVALID');
  let request=body?.data?.rateLimitData?.currentRequest;
  if(typeof request==='string'){
    try{request=JSON.parse(request);}catch{request=null;}
  }
  const points=finite(request?.total)?request.total:null;
  const databasePoints=finite(request?.database)?request.database:null;
  if(httpStatus!==200||!body||body.errors!=null&&
     (!Array.isArray(body.errors)||body.errors.length)||points===null)
    return {name:sample.name,status:'HTTP_GRAPHQL_OR_POINT_UNKNOWN',
      points,databasePoints,wallMs,fields:sample.fieldCount,
      rowCount:null,details:[]};
  const details=[];
  for(const field of sample.fields){
    const ranking=body.data?.worldData?.[field.encounterAlias]
      ?.[field.rankAlias];
    if(!Array.isArray(ranking?.rankings)||ranking.rankings.length>100)
      return {name:sample.name,status:'RANKINGS_SHAPE_INVALID',
        points,databasePoints,wallMs,fields:sample.fieldCount,
        rowCount:null,details:[]};
    let prev=Infinity;
    const rows=ranking.rankings;
    for(const row of rows){
      if(!finite(row?.amount)||row.amount>prev)
        return {name:sample.name,status:'RANKINGS_ROWS_INVALID',
          points,databasePoints,wallMs,fields:sample.fieldCount,
          rowCount:null,details:[]};
      prev=row.amount;
    }
    details.push({encounterId:field.encounterId,
      className:field.className,specName:field.specName,
      page:field.page,rows:rows.length,
      sha256:hash(rows)});
  }
  return {name:sample.name,status:'MEASURED',
    points,databasePoints,wallMs,fields:sample.fieldCount,
    rowCount:details.reduce((a,b)=>a+b.rows,0),
    perFieldPoints:points/sample.fieldCount,
    details};
}
/** Complete 8 boss / 27 spec / 20-page cardinality only. */
export function planFullBossDepth2000TechnicalCardinality(){
  const totalFields=8*27*20;
  return Object.freeze(CASE_SHAPES.map(s=>{
    const fieldsPerCall=s.specCount*s.pageCount*s.bossCount;
    need(totalFields%fieldsPerCall===0,
      'BOSS_BENCH_FULL_PLAN_NOT_DIVISIBLE');
    return Object.freeze({
      name:s.name,totalFields,fieldsPerCall,
      httpRequests:totalFields/fieldsPerCall,
      perRequestGitCommits:totalFields/fieldsPerCall*2,
      fourRequestGroupGitCommits:Math.ceil(
        totalFields/fieldsPerCall/4)*2
    });
  }));
}
/**
 * Durable grouped preflight is ONE remote Git commit for all requests.
 * Never retry any possibly attempted call on an unknown crash; the
 * matching final witness is the second remote commit.
 */
export function createBenchmarkPreflight({
  cases,productCommit,sourceHead
}={}){
  need(Array.isArray(cases)&&cases.length===4&&
    cases.every((c,i)=>c.name===CASE_SHAPES[i].name)&&
    typeof productCommit==='string'&&/^[a-f0-9]{40}$/.test(productCommit)&&
    typeof sourceHead==='string'&&/^[a-f0-9]{40}$/.test(sourceHead),
    'BOSS_BENCH_PREFLIGHT_INVALID');
  return {schema:1,status:'IN_FLIGHT',productCommit,sourceHead,
    attempts:cases.map(c=>({
      name:c.name,queryFingerprint:c.queryFingerprint,
      fields:c.fieldCount,status:'IN_FLIGHT',observedPoints:null
    }))};
}
export function finishBenchmarkWave(preflight,measurements){
  need(preflight?.schema===1&&preflight.status==='IN_FLIGHT'&&
    Array.isArray(preflight.attempts)&&
    Array.isArray(measurements)&&
    measurements.length===preflight.attempts.length,
    'BOSS_BENCH_WAVE_INVALID');
  const out=structuredClone(preflight);
  out.attempts=out.attempts.map((a,i)=>{
    const m=measurements[i];
    need(m?.name===a.name&&finite(m.points)&&
      finite(m.wallMs)&&m.fields===a.fields,
      'BOSS_BENCH_WITNESS_INVALID');
    return {...a,status:m.status==='MEASURED'?'COMPLETED':
      'NEEDS_REVIEW',observedPoints:m.points,
      observedDatabasePoints:m.databasePoints,
      wallMs:m.wallMs,rowCount:m.rowCount,
      errorCode:m.status==='MEASURED'?null:m.status};
  });
  out.status=out.attempts.every(a=>a.status==='COMPLETED')?
    'COMPLETED':'NEEDS_REVIEW';
  return out;
}
