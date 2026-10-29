/**
 * Fresh216 BossDPS leaderboard page-1, eight specs per GraphQL request.
 * Pure source-boundary only: never sends HTTP, changes checkpoint or Sheets.
 * Production needs a wave-level pre-HTTP durable attempt on the SAME
 * private Git checkpoint before the first charged query.
 */
import {planFull216} from './full-scope-plan.mjs';
import {makeFreshDatedHeroicManifest,planFreshCohortBatches}
  from './fresh-cohort-source.mjs';
import {createHash} from 'node:crypto';
import {decodeRankBatch} from './rank-batch-runner.mjs';

const need=(condition,code)=>{if(!condition)throw Error(code);};
const FILTER='date.1792594800000.1793113200000';
const pointCost=body=>{
  let c=body?.data?.rateLimitData?.currentRequest;
  if(typeof c==='string'){try{c=JSON.parse(c);}catch{c=null;}}
  return typeof c?.total==='number'&&Number.isFinite(c.total)&&c.total>=0?
    c.total:null;
};
const immutableJob=(slots,job)=>{
  need(Array.isArray(slots)&&slots.length===100,
    'FRESH_BOSS_JOB_EXACT100_REQUIRED');
  const first=slots[0];
  need(slots.every((s,i)=>s.rank===i+1&&
    s.jobKey===job.jobKey&&s.className===job.className&&
    s.specName===job.specName&&s.snapshotSha===first.snapshotSha&&
    s.encounterId===job.encounterId&&s.difficulty===4&&
    s.filter===FILTER&&s.status==='PENDING'&&s.proof==null),
    'FRESH_BOSS_IMMUTABLE_JOB_DRIFT');
  return first.snapshotSha;
};

/** Canonical 32-batch plan using saved TotalDPS rows. Never re-rank. */
export function planFreshBossFirstPages(sourceSlots){
  const full=planFull216(sourceSlots);
  need(full.difficulty===4,'FRESH_BOSS_HEROIC_SCOPE_REQUIRED');
  const manifest=makeFreshDatedHeroicManifest(full.scopeKey);
  const canon=planFreshCohortBatches(manifest);
  const byJob=new Map();
  for(const s of sourceSlots){
    const rows=byJob.get(s.jobKey)??[];
    rows.push(s);byJob.set(s.jobKey,rows);
  }
  const batches=canon.batches.map(b=>({
    batchIndex:b.batchIndex,
    encounterId:b.encounterId,
    difficulty:4,filter:FILTER,partitionMode:'LATEST_DEFAULT',
    scopeKey:full.scopeKey,
    jobs:b.jobs.map(j=>{
      const slots=(byJob.get(j.jobKey)??[]).slice().sort((a,b)=>a.rank-b.rank);
      const job={...j,encounterId:b.encounterId};
      const snapshotSha=immutableJob(slots,job);
      return {...job,snapshotSha,slots};
    })
  }));
  need(batches.length===32&&batches.reduce((n,b)=>n+b.jobs.length,0)===216,
    'FRESH_BOSS_BATCH_PLAN_INCOMPLETE');
  return {sourceJobs:216,sourceRows:21600,batches,
    readyForAutomaticDispatch:false};
}

/** WCL official metric:bossdps, page 1; same date, latest/default partition. */
export function makeFreshBossFirstPageQuery(batch){
  need(batch&&batch.difficulty===4&&batch.filter===FILTER&&
    batch.partitionMode==='LATEST_DEFAULT'&&
    Number.isSafeInteger(batch.encounterId)&&batch.encounterId>0&&
    Array.isArray(batch.jobs)&&batch.jobs.length>=1&&batch.jobs.length<=8,
    'FRESH_BOSS_BATCH_INVALID');
  const defs=['$id:Int!','$difficulty:Int!','$filter:String!'];
  const variables={id:batch.encounterId,difficulty:4,filter:FILTER};
  const aliases=[];
  batch.jobs.forEach((j,i)=>{
    immutableJob(j.slots,{...j,encounterId:batch.encounterId});
    defs.push('$c'+i+':String!','$s'+i+':String!');
    variables['c'+i]=j.className;variables['s'+i]=j.specName;
    aliases.push('b'+i+':characterRankings(difficulty:$difficulty,'+
      'className:$c'+i+',specName:$s'+i+
      ',metric:bossdps,page:1,filter:$filter)');
  });
  return {query:'query Fresh216BossFirstPage('+defs.join(',')+
    '){rateLimitData{currentRequest} worldData{encounter(id:$id){'+
    aliases.join(' ')+'}}}',variables};
}

/** All-or-nothing decoding; cost witnessed ONCE for the whole GraphQL call. */
export function decodeFreshBossFirstPage(batch,httpStatus,body){
  makeFreshBossFirstPageQuery(batch);
  const points=pointCost(body);
  const fail=status=>({status,observedPoints:points,result:null});
  if(httpStatus!==200||!body||typeof body!=='object'||
    body.errors!=null&&(!Array.isArray(body.errors)||body.errors.length))
    return fail('FRESH_BOSS_HTTP_OR_GRAPHQL_UNCERTAIN');
  const encounter=body.data?.worldData?.encounter;
  if(!encounter||typeof encounter!=='object'||points===null)
    return fail('FRESH_BOSS_RESPONSE_OR_COST_UNKNOWN');
  const results=[];
  for(let i=0;i<batch.jobs.length;i++){
    const job=batch.jobs[i];
    if(!encounter['b'+i]||typeof encounter['b'+i]!=='object')
      return fail('FRESH_BOSS_ALIAS_MISSING');
    const request={
      scopeKey:batch.scopeKey,jobKey:job.jobKey,
      snapshotSha:job.snapshotSha,encounterId:batch.encounterId,
      difficulty:4,className:job.className,specName:job.specName,
      filter:FILTER,firstPage:1,pageCount:1,slots:job.slots
    };
    const projected={data:{
      rateLimitData:body.data.rateLimitData,
      worldData:{encounter:{b0:encounter['b'+i]}}
    }};
    const decoded=decodeRankBatch(request,200,projected);
    if(decoded.status!=='OK'||!decoded.result)
      return fail(decoded.status);
    // Preserve the OFFICIAL BossDPS leaderboard, even if the same-fight
    // join yields zero rows. These rows are private checkpoint data only.
    const rankings=structuredClone(encounter['b'+i].rankings);
    const amounts=rankings.map(r=>Number(r.amount));
    if(amounts.some((n,k)=>k>0&&n>amounts[k-1]))
      return fail('FRESH_BOSS_RANKING_NOT_SORTED');
    results.push({
      jobKey:job.jobKey,snapshotSha:job.snapshotSha,
      rankings,bossRankingSha:createHash('sha256')
        .update(JSON.stringify(rankings)).digest('hex'),
      rankingsStatus:rankings.length===100?'EXACT100':'PARTIAL',
      verified:decoded.result.verified,pages:decoded.result.pages,
      terminal:decoded.terminal
    });
  }
  return {status:'OK',observedPoints:points,
    result:{jobs:results,verifiedCount:results.reduce((n,r)=>n+r.verified.length,0)}};
}
