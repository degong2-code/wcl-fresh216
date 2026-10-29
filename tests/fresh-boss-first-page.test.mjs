import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeFreshDatedHeroicManifest,planFreshCohortBatches
} from '../src/core/fresh-cohort-source.mjs';
import {
  planFreshBossFirstPages,makeFreshBossFirstPageQuery,
  decodeFreshBossFirstPage
} from '../src/core/fresh-boss-first-page.mjs';

const scopeKey='heroic:synthetic';
const filter='date.1792594800000.1793113200000';
const sha='a'.repeat(64);
const manifest=makeFreshDatedHeroicManifest(scopeKey);
function allSourceRows(){
  return planFreshCohortBatches(manifest).batches.flatMap(b=>
    b.jobs.flatMap(j=>Array.from({length:100},(_,i)=>({
      scopeKey,jobKey:j.jobKey,rank:i+1,snapshotSha:sha,
      name:(b.batchIndex===0&&i===99&&j===b.jobs[0])?'Anonymous':'Actor'+i,
      totalDps:100000-i*100,
      reportCode:'R'+b.batchIndex+'_'+j.specName+'_'+i,
      fightId:i+1,reportRevision:null,
      encounterId:b.encounterId,difficulty:4,
      className:j.className,specName:j.specName,
      startTime:1792594801000+i*1000,
      filter,status:'PENDING'
    })))
  );
}
function reply(batch){
  const encounter={};
  batch.jobs.forEach((j,i)=>{
    encounter['b'+i]={rankings:j.slots.map(s=>({
      name:s.name,amount:s.totalDps-100,
      startTime:s.startTime,
      report:{code:s.reportCode,fightID:s.fightId}
    }))};
  });
  return {data:{
    rateLimitData:{currentRequest:JSON.stringify({total:8.01})},
    worldData:{encounter}
  }};
}
test('full 216 source rows become exactly 32 immutable boss page1 groups',()=>{
  const p=planFreshBossFirstPages(allSourceRows());
  assert.equal(p.sourceJobs,216);
  assert.equal(p.sourceRows,21600);
  assert.equal(p.batches.length,32);
  assert.equal(p.batches.reduce((n,b)=>n+b.jobs.length,0),216);
  assert.equal(p.readyForAutomaticDispatch,false);
  const q=makeFreshBossFirstPageQuery(p.batches[0]);
  assert.equal((q.query.match(/characterRankings\(/g)||[]).length,8);
  assert.equal((q.query.match(/metric:bossdps/g)||[]).length,8);
  assert.doesNotMatch(q.query,/metric:dps,|partition:/);
  assert.equal(q.variables.filter,filter);
});
test('one response yields 8x100 exact BossDPS proofs and one request cost',()=>{
  const p=planFreshBossFirstPages(allSourceRows()),batch=p.batches[1];
  const res=decodeFreshBossFirstPage(batch,200,reply(batch));
  assert.equal(res.status,'OK');
  assert.equal(res.observedPoints,8.01);
  assert.equal(res.result.jobs.length,8);
  assert.equal(res.result.verifiedCount,800);
  const proof=res.result.jobs[0].verified[0].proof;
  assert.equal(proof.discovery.kind,'BOSSDPS_RANKING_PAGE');
  assert.equal(proof.discovery.page,1);
  assert.equal(proof.bossDps,99900);
  assert.equal(proof.snapshotSha,sha);
});
test('masked player remains ranked but produces no BossDPS attribution',()=>{
  const batch=planFreshBossFirstPages(allSourceRows()).batches[0];
  const res=decodeFreshBossFirstPage(batch,200,reply(batch));
  assert.equal(res.status,'OK');
  assert.equal(res.result.verifiedCount,799);
  assert.equal(res.result.jobs[0].verified.some(v=>v.rank===100),false);
});
test('all-or-nothing on missing alias, unobserved points and wrong date',()=>{
  const batch=planFreshBossFirstPages(allSourceRows()).batches[0];
  const missing=reply(batch);
  delete missing.data.worldData.encounter.b7;
  assert.equal(decodeFreshBossFirstPage(batch,200,missing).status,
    'FRESH_BOSS_ALIAS_MISSING');
  const unknown=reply(batch);
  unknown.data.rateLimitData.currentRequest=null;
  assert.equal(decodeFreshBossFirstPage(batch,200,unknown).status,
    'FRESH_BOSS_RESPONSE_OR_COST_UNKNOWN');
  const date=reply(batch);
  date.data.worldData.encounter.b0.rankings[0].startTime=1792594800000-1;
  assert.equal(decodeFreshBossFirstPage(batch,200,date).status,
    'RANK_ROW_OR_SCOPE_INVALID');
  const http=decodeFreshBossFirstPage(batch,504,reply(batch));
  assert.equal(http.status,'FRESH_BOSS_HTTP_OR_GRAPHQL_UNCERTAIN');
});
test('same name but different report/fight or wrong start cannot claim proof',()=>{
  const batch=planFreshBossFirstPages(allSourceRows()).batches[0];
  const b=reply(batch);
  b.data.worldData.encounter.b0.rankings[0].report.code='OTHER';
  b.data.worldData.encounter.b1.rankings[1].startTime++;
  const r=decodeFreshBossFirstPage(batch,200,b);
  assert.equal(r.status,'OK');
  assert.equal(r.result.verifiedCount,797);
});
