import test from 'node:test';
import assert from 'node:assert/strict';
import {makeTwoRequestComparisonPlan}
  from '../src/core/wcl-query-comparison.mjs';
const group=()=>({
  scopeKey:'SYNTHETIC_HEROIC',reportCode:'NOT_A_REAL_REPORT',fightId:12,
  encounterId:3470,difficulty:4,reportRevision:5
});
test('query plan is exactly TWO separately billed same-fight documents',()=>{
  const p=makeTwoRequestComparisonPlan(group());
  assert.equal(p.requests.length,2);
  assert.equal(p.mode,'OFFLINE_QUERY_PLAN_ONLY');
  assert.equal(p.authorizedToExecute,false);
  assert.equal(p.actualPointUsageMeasured,false);
  for(const x of p.requests){
    assert.deepEqual(x.query.variables,{code:'NOT_A_REAL_REPORT',fightID:12});
    assert.match(x.query.query,/report\(code:\$code\)\{code revision/);
    assert.match(x.query.query,/rateLimitData\{currentRequest\}/);
    assert.doesNotMatch(x.query.query,/currentRequest\{/);
  }
});
test('rankings query distinguishes overall and boss DPS source',()=>{
  const p=makeTwoRequestComparisonPlan(group());
  const r=p.requests[0];
  assert.equal(r.documentedPointClass,'DATABASE');
  assert.match(r.query.query,/playerMetric:dps/);
  assert.match(r.query.query,/playerMetric:bossdps/);
  assert.doesNotMatch(r.query.query,/table\(/);
});
test('table query uses schema-backed DamageDone/Source enums and does not claim boss parity',()=>{
  const p=makeTwoRequestComparisonPlan(group());
  const t=p.requests[1];
  assert.equal(t.documentedPointClass,'USER_ELIGIBLE_IF_USER_OAUTH');
  assert.match(t.query.query,/table\(fightIDs:\[\$fightID\],dataType:DamageDone,\s+viewBy:Source,translate:false\)/);
  assert.doesNotMatch(t.query.query,/playerMetric:bossdps/);
  assert.ok(p.caveats.includes('TABLE_DOES_NOT_PROVE_BOSSDPS_WITHOUT_BOSS_TARGET_MAPPING_AND_PET_RULES'));
});
test('invalid or missing fight/revision scope is rejected before any query',()=>{
  for(const x of [
    {fightId:0},{difficulty:0},{encounterId:0},
    {reportCode:''},{reportRevision:-1}
  ]){
    assert.throws(()=>makeTwoRequestComparisonPlan({...group(),...x}),
      /REPORT_QUERY_SCOPE_INVALID/);
  }
});
test('repeated calls do not mutate source or invent charge observations',()=>{
  const g=Object.freeze(group());
  const p=makeTwoRequestComparisonPlan(g);
  assert.deepEqual(makeTwoRequestComparisonPlan(g),p);
  assert.equal(p.sameFight.reportRevision,5);
  assert.equal('observedPoints' in p.requests[0],false);
  assert.equal('observedPoints' in p.requests[1],false);
});
