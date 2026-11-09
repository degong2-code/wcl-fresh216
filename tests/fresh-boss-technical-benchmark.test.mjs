import test from 'node:test';
import assert from 'node:assert/strict';
import {makeFreshBossBenchmarkCases,
  summarizeFreshBossBenchmarkResponse,
  planFullBossDepth2000TechnicalCardinality,
  createBenchmarkPreflight,finishBenchmarkWave
} from '../src/core/fresh-boss-technical-benchmark.mjs';
const cases=makeFreshBossBenchmarkCases();
const productCommit='a'.repeat(40),sourceHead='b'.repeat(40);
const dataFor=c=>{
  const worldData={};
  for(const f of c.fields){
    const boss=worldData[f.encounterAlias]??{};
    boss[f.rankAlias]={rankings:Array.from({length:100},(_,i)=>({
      name:'Synthetic'+i,amount:100000-i,
      reportCode:'TEST_ONLY',fightID:i+1,startTime:1792594801000
    }))};
    worldData[f.encounterAlias]=boss;
  }
  return {data:{rateLimitData:{currentRequest:{
    total:c.fieldCount+1,application:c.fieldCount,database:c.fieldCount
  }},worldData}};
};
test('9 -> 27 -> 54 -> 108 pure query shape and all 4,320 full rank fields',()=>{
  assert.deepEqual(cases.map(c=>c.fieldCount),[9,27,54,108]);
  assert.equal(new Set(cases.map(c=>c.queryFingerprint)).size,4);
  const expected=[[480,960,240],[160,320,80],[80,160,40],[40,80,20]];
  assert.deepEqual(planFullBossDepth2000TechnicalCardinality()
    .map(p=>[p.httpRequests,p.perRequestGitCommits,
      p.fourRequestGroupGitCommits]),expected);
  for(const c of cases){
    assert.match(c.query,/metric:bossdps/);
    assert.match(c.query,/page:1/);
    assert.match(c.query,/date/,{});
    assert.equal(c.fields.length,c.fieldCount);
    assert.equal(new Set(c.fields.map(f=>
      [f.encounterAlias,f.rankAlias].join(':'))).size,c.fieldCount);
    const measured=summarizeFreshBossBenchmarkResponse(c,{
      httpStatus:200,body:dataFor(c),wallMs:100
    });
    assert.equal(measured.status,'MEASURED');
    assert.equal(measured.fields,c.fieldCount);
    assert.equal(measured.rowCount,c.fieldCount*100);
    assert.equal(measured.databasePoints,c.fieldCount);
    assert.equal(measured.details.length,c.fieldCount);
    assert.ok(measured.details.every(d=>d.sha256.length===64));
  }
});
test('same spec/boss/page has identical representative hash across all shapes',()=>{
 const measurements=cases.map(c=>summarizeFreshBossBenchmarkResponse(
   c,{httpStatus:200,body:dataFor(c),wallMs:100}));
 const first=measurements[0].details[0].sha256;
 assert.equal(measurements.every(m=>m.details[0].sha256===first),true);
});
test('invalid HTTP, unsorted ranks, missing alias fail without leaking raw identities',()=>{
 const c=cases[0];
 const fail=summarizeFreshBossBenchmarkResponse(c,{
   httpStatus:400,body:{errors:[{message:'do not log me'}]},wallMs:5
 });
 assert.equal(fail.status,'HTTP_GRAPHQL_OR_POINT_UNKNOWN');
 assert.equal(JSON.stringify(fail).includes('do not log me'),false);
 const invalid=dataFor(c);
 invalid.data.worldData.e0.r0p1.rankings[10].amount=999999;
 const bad=summarizeFreshBossBenchmarkResponse(c,{
   httpStatus:200,body:invalid,wallMs:6
 });
 assert.equal(bad.status,'RANKINGS_ROWS_INVALID');
 assert.equal(bad.details.length,0);
});
test('one grouped preflight/final receipt, uncertain results never become complete',()=>{
 const prior=createBenchmarkPreflight({cases,productCommit,sourceHead});
 assert.equal(prior.status,'IN_FLIGHT');
 assert.equal(prior.attempts.filter(a=>a.status==='IN_FLIGHT').length,4);
 const measurements=cases.map(c=>summarizeFreshBossBenchmarkResponse(
   c,{httpStatus:200,body:dataFor(c),wallMs:100}));
 const after=finishBenchmarkWave(prior,measurements);
 assert.equal(after.status,'COMPLETED');
 assert.equal(after.attempts.length,4);
 assert.ok(after.attempts.every(a=>a.status==='COMPLETED'));
 assert.equal(prior.status,'IN_FLIGHT');
 const unknown=structuredClone(measurements);
 unknown[2].status='HTTP_GRAPHQL_OR_POINT_UNKNOWN';
 const blocked=finishBenchmarkWave(prior,unknown);
 assert.equal(blocked.status,'NEEDS_REVIEW');
 assert.equal(blocked.attempts[2].status,'NEEDS_REVIEW');
 assert.throws(()=>finishBenchmarkWave(blocked,measurements),
   /BOSS_BENCH_WAVE_INVALID/);
 assert.throws(()=>createBenchmarkPreflight({
   cases,productCommit:'broken',sourceHead
 }),/BOSS_BENCH_PREFLIGHT_INVALID/);
});
