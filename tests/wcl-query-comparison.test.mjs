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


import {assessTwoRequestComparison,fingerprintComparisonRequest}
  from '../src/core/wcl-query-comparison.mjs';

const observation=(request,overrides={})=>({
  kind:request.kind,requestFingerprint:fingerprintComparisonRequest(request),
  authFlow:'CLIENT_CREDENTIALS',httpStatus:200,graphqlErrors:false,
  reportRevision:5,elapsedMs:120,reportedTotalPoints:null,
  categoryWitness:'UNAVAILABLE',
  categoryCosts:{application:null,database:null,user:null},
  ...overrides
});

test('receipt is approval-safe and records ZERO attempts before separate authorization',()=>{
  const plan=makeTwoRequestComparisonPlan(group());
  const result=assessTwoRequestComparison(plan);
  assert.equal(result.status,'AWAITING_SEPARATE_APPROVAL');
  assert.equal(result.requestsRecorded,0);
  assert.equal(result.executionAuthorized,false);
  assert.equal(result.adoptTable,false);
  assert.equal(result.semanticVerdict,'NOT_EQUIVALENT_OR_UNPROVEN');
});

test('one rankings observation does not imply second table call or point category',()=>{
  const plan=makeTwoRequestComparisonPlan(group());
  const first=observation(plan.requests[0],{reportedTotalPoints:3});
  const result=assessTwoRequestComparison(plan,[first]);
  assert.equal(result.status,'ONLY_FIRST_REQUEST_RECORDED');
  assert.equal(result.requestsRecorded,1);
  assert.deepEqual(result.requests[0].categoryCosts,{
    application:null,database:null,user:null
  });
  assert.equal(result.costEquivalenceProven,false);
});

test('two successful request envelopes NEVER establish exact BossDPS or cost parity',()=>{
  const plan=makeTwoRequestComparisonPlan(group());
  const first=observation(plan.requests[0],{
    categoryWitness:'OFFICIAL_CATEGORY_WITNESS',
    categoryCosts:{application:2,database:2,user:0}
  });
  const second=observation(plan.requests[1],{
    authFlow:'USER_OAUTH_CODE_PKCE',
    categoryWitness:'OFFICIAL_CATEGORY_WITNESS',
    categoryCosts:{application:1,database:0,user:5},
    elapsedMs:80
  });
  const result=assessTwoRequestComparison(plan,[first,second]);
  assert.equal(result.status,'TWO_RESPONSES_RECORDED_SEMANTICS_UNPROVEN');
  assert.equal(result.requestsRecorded,2);
  assert.equal(result.requests[0].categoryCosts.database,2);
  assert.equal(result.requests[1].categoryCosts.user,5);
  assert.equal(result.adoptTable,false);
  assert.equal(result.independentActorAndBossTargetProof,false);
});

test('revision drift, HTTP failure, and GraphQL error fail closed',()=>{
  const plan=makeTwoRequestComparisonPlan(group());
  for(const patch of [
    {reportRevision:6},{httpStatus:504},{graphqlErrors:true},
    {reportRevision:null},{httpStatus:null}
  ]){
    const r=assessTwoRequestComparison(plan,[observation(plan.requests[0],patch)]);
    assert.equal(r.status,'REQUEST_OR_REVISION_NEEDS_REVIEW');
    assert.equal(r.adoptTable,false);
  }
});

test('receipt rejects reordered, third, forged scope or point class observations',()=>{
  const plan=makeTwoRequestComparisonPlan(group());
  const first=observation(plan.requests[0]);
  const second=observation(plan.requests[1]);
  for(const bad of [
    [second],[first,first],[first,second,first],
    [{...first,requestFingerprint:'b'.repeat(64)}],
    [{...first,categoryCosts:{application:0,database:0,user:0}}],
    [{...first,categoryWitness:'OFFICIAL_CATEGORY_WITNESS',
       categoryCosts:{application:-1,database:null,user:null}}],
  ]){
    assert.throws(()=>assessTwoRequestComparison(plan,bad),
      /COMPARISON_(RECEIPT_SCOPE|OBSERVATION|POINT_WITNESS)_INVALID/);
  }
  assert.throws(()=>assessTwoRequestComparison(
    {...plan,authorizedToExecute:true},[]),/COMPARISON_RECEIPT_SCOPE_INVALID/);
});

test('private raw payload, tokens and actor details are never echoed in summary',()=>{
  const plan=makeTwoRequestComparisonPlan(group());
  const first=observation(plan.requests[0],{
    token:'PRIVATE_SECRET_DO_NOT_COPY',
    reportCode:'REPORT_PRIVATE_EXAMPLE',
    actorID:3412412,
    originalRankings:{data:['PRIVATE_RAW_SENTINEL']}
  });
  const out=JSON.stringify(assessTwoRequestComparison(plan,[first]));
  for(const privateValue of [
    'PRIVATE_SECRET_DO_NOT_COPY','REPORT_PRIVATE_EXAMPLE',
    'PRIVATE_RAW_SENTINEL','NOT_A_REAL_REPORT','3412412'
  ]) assert.equal(out.includes(privateValue),false);
});
