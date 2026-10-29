import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {newCheckpoint} from '../src/core/checkpoint.mjs';
import {makeFreshDatedHeroicManifest,installFreshCohortPlan,
  planFreshCohortBatches} from '../src/core/fresh-cohort-source.mjs';
import {planFreshBossThrough500}
  from '../src/core/fresh-boss-depth500.mjs';

const scope='heroic:2026-10-22_27:latest:source';
const original='7b1a075ad2663c8aa07734b7733cbe81bf9c6071';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function fixture(){
  const manifest=makeFreshDatedHeroicManifest(scope);
  const state=installFreshCohortPlan(newCheckpoint(scope,'offline-test'),manifest);
  state.sourceCodeCommit=original;
  state.bossPageRequests={};
  state.rankRequests={};
  for(const batch of planFreshCohortBatches(manifest).batches){
    const entry=state.sourceRequests[batch.key];
    entry.status='COMPLETED';
    entry.observedPoints=8;
    entry.attempt={id:'source-'+batch.batchIndex,startedAtMs:1};
    entry.result={jobs:batch.jobs.map((j,i)=>{
      const rows=Array.from({length:100},(_,r)=>({
        name:'Name'+r,amount:300000-r*10,
        reportCode:'Rpt'+batch.batchIndex+'_'+i+'_'+r,
        fightId:r+1,startTime:1792594801000+r*1000,
        reportRevision:null
      }));
      return {...j,rows,snapshotSha:hash(rows)};
    })};
    state.bossPageRequests['b'+batch.batchIndex]={
      status:'COMPLETED',scopeKey:scope,sourceCommit:original,
      observedPoints:8,attempt:{id:'boss'+batch.batchIndex,startedAtMs:1},
      result:{jobs:entry.result.jobs.map(j=>({
        jobKey:j.jobKey,snapshotSha:j.snapshotSha,
        rankings:Array.from({length:100},()=>({amount:100})),
        rankingsStatus:'EXACT100',verified:[],
        pages:[{page:1,status:'OK',rowCount:100,
          hasMorePages:true,newVerifiedRanks:[]}]
      }))}
    };
    for(const j of entry.result.jobs){
      const idx=Object.keys(state.rankRequests).length;
      state.rankRequests['r'+idx]={
        status:'COMPLETED',
        source:{scopeKey:scope,jobKey:j.jobKey,snapshotSha:j.snapshotSha,
          firstPage:2,pageCount:2},
        observedPoints:2,attempt:{id:'rank'+idx,startedAtMs:1},
        result:{pages:[2,3].map(page=>({
          page,status:'OK',rowCount:100,hasMorePages:true,
          newVerifiedRanks:page===3&&idx%3!==0?[7,9]:[]
        })),verified:[]}
      };
    }
  }
  return state;
}
test('page3 observed gain selects only nonterminal jobs and limits page4+5 requests',()=>{
  const state=fixture();
  const plan=planFreshBossThrough500(state,{maxRequests:16});
  assert.equal(plan.officialSourceRows,21600);
  assert.equal(plan.independentBossRows,21600);
  assert.equal(plan.selectedJobs,16);
  assert.equal(plan.plannedPageAliases,32);
  assert(plan.requests.every(x=>x.firstPage===4&&x.pageCount===2&&
    x.page3Gains===2&&x.slots.length===100));
  assert.equal(plan.skipNoPage3Gain,72);
  assert.equal(plan.eligibleJobs,144);
  assert.equal(plan.actualNewWclRequests,0);
  assert.equal(plan.googleSheetsWrites,0);
});
test('previous page4-5 completion and disputed attempt cannot be silently replayed',()=>{
  const state=fixture();
  const first=Object.values(state.rankRequests)[1];
  first.result.pages.push(
    {page:4,status:'OK',rowCount:100,hasMorePages:true,newVerifiedRanks:[]},
    {page:5,status:'OK',rowCount:100,hasMorePages:true,newVerifiedRanks:[]});
  assert.equal(planFreshBossThrough500(state).skipNotAtPage3,1);
  const request=Object.values(state.rankRequests)[2];
  request.status='NEEDS_REVIEW';
  assert.throws(()=>planFreshBossThrough500(state),/DEPTH500_UNRESOLVED_ATTEMPT/);
  assert.throws(()=>planFreshBossThrough500(state,{maxRequests:0}),
    /DEPTH500_MAX_REQUESTS_INVALID/);
});

test('explicit zero-gain inclusion is last-ranked and still excludes completed page5 jobs',()=>{
  const s=fixture();
  const defaultPlan=planFreshBossThrough500(s,{maxRequests:180});
  assert.equal(defaultPlan.eligibleJobs,144);
  const full=planFreshBossThrough500(s,{
    maxRequests:180,includeZeroPage3:true
  });
  assert.equal(full.eligibleJobs,216);
  assert.equal(full.selectedJobs,180);
  assert(full.requests.slice(0,144).every(x=>x.page3Gains===2));
  assert(full.requests.slice(144).every(x=>x.page3Gains===0));
  const first=Object.values(s.rankRequests)[1];
  first.result.pages.push({page:4,status:'OK',rowCount:100,
    hasMorePages:true,newVerifiedRanks:[33]});
  first.result.pages.push({page:5,status:'OK',rowCount:100,
    hasMorePages:true,newVerifiedRanks:[]});
  const next=planFreshBossThrough500(s,{
    maxRequests:180,includeZeroPage3:true
  });
  assert.equal(next.eligibleJobs,215);
  assert(!next.requests.some(x=>x.jobKey===first.source.jobKey));
});
