import test from 'node:test';
import assert from 'node:assert/strict';
import {makeBossPageQuery,decodeBossPage,matchCachedBossPages}
  from '../src/core/boss-page-recovery.mjs';
const scope={encounterId:100,difficulty:4,className:'Mage',specName:'Frost',
  filter:'date.1791385200000.1791817200000',partition:1};
const start=1791400000000;
const r=(name,amount,code='R1',fightID=1,more={})=>({name,amount,
  report:{code,fightID},startTime:start,...more});
const overall=()=>Array.from({length:100},(_,i)=>r('Player'+i,200-i,'R'+i,i+1));
const pages=(...rankings)=>rankings.map((x,i)=>({page:i+1,rankings:x}));
const saved=()=>Array(100).fill(null);

test('extra-page query selects official bossdps only, preserves date and scope',()=>{
  const q=makeBossPageQuery(scope,2);
  assert.match(q.query,/metric:bossdps,page:2/);
  assert.doesNotMatch(q.query,/metric:dps/);
  assert.equal(q.variables.filter,scope.filter);
  assert.equal(q.variables.partition,1);
  assert.throws(()=>makeBossPageQuery(scope,4),/BOSS_PAGE_BOUND_INVALID/);
});

test('injected GraphQL response validates date, shape, points without sending',()=>{
  const body={data:{rateLimitData:{currentRequest:{total:3.5}},worldData:{encounter:{boss:{rankings:[r('P',100)]}}}}};
  assert.equal(decodeBossPage(scope,2,200,body).observedPoints,3.5);
  assert.equal(decodeBossPage(scope,2,200,body).status,'OK');
  assert.equal(decodeBossPage(scope,2,504,body).status,'UNCERTAIN_HTTP_OR_GRAPHQL');
  const bad=structuredClone(body);bad.data.worldData.encounter.boss.rankings[0].startTime=10;
  assert.equal(decodeBossPage(scope,2,200,bad).status,'BOSS_PAGE_SHAPE_OR_SCOPE_INVALID');
});

test('same report fight name on page2 fills only unresolved and preserves saved',()=>{
  const all=overall();const v=saved();v[0]=90;
  const out=matchCachedBossPages({scope,overall:all,savedBoss:v,
    pages:pages([r('other',10)],[r('Player1',90,'R1',2),r('Player0',40,'R0',1)])});
  assert.equal(out.values[0],90);
  assert.equal(out.values[1],90);
  assert.equal(out.newMatches,1);
  assert.equal(out.reusedSaved,1);
  assert.equal(out.nextPageCandidate,3);
  assert.equal(out.readyForAutomaticDispatch,false);
  assert.equal(out.values.length,100);
});

test('different fight, same name, masked name and duplicates never match',()=>{
  const all=overall();all[2].name='Player (1)';
  const out=matchCachedBossPages({scope,overall:all,savedBoss:saved(),
    pages:pages([r('Player0',99,'DIFFERENT',1),r('Player1',81,'R1',2),r('Player1',82,'R1',2),r('Player (1)',40,'R2',3)])});
  assert.equal(out.newMatches,0);
  assert.equal(out.values[0],null);
  assert.equal(out.values[1],null);
  assert.equal(out.values[2],null);
  assert.equal(out.anonymousSkipped,1);
  assert.equal(out.conflicts>=1,true);
});

test('timestamp / revision contradictions and implausible BossDPS fail closed',()=>{
  const all=overall();all[0].reportRevision=4;
  const out=matchCachedBossPages({scope,overall:all,savedBoss:saved(),
    pages:pages([r('Player0',40,'R0',1,{reportRevision:5}),
      r('Player1',40,'R1',2,{startTime:start+3000}),
      r('Player3',201,'R3',4)])});
  assert.equal(out.newMatches,0);
  assert.equal(out.conflicts,3);
});

test('no auto page when cached page exhausted, page3 reached, or all resolved',()=>{
  const all=overall();
  assert.equal(matchCachedBossPages({scope,overall:all,savedBoss:saved(),pages:pages([])}).nextPageCandidate,null);
  assert.equal(matchCachedBossPages({scope,overall:all,savedBoss:saved(),pages:pages([r('X',10)],[r('Y',9)],[r('Z',8)])}).nextPageCandidate,null);
  const v=saved().map((_,i)=>Number(all[i].amount)/2);
  assert.equal(matchCachedBossPages({scope,overall:all,savedBoss:v,pages:pages([r('X',10)])}).nextPageCandidate,null);
});
