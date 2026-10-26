import test from 'node:test';
import assert from 'node:assert/strict';
import {makeRankingsQuery,decodeRankingsEnvelope} from '../src/adapters/wcl-rankings-envelope.mjs';
import {joinFightEvidence} from '../src/core/evidence-join.mjs';

const group={
  scopeKey:'heroic:synth',reportCode:'EXAMPLE_ONLY',fightId:12,
  encounterId:3470,difficulty:4,reportRevision:5,
  slots:[{jobKey:'Boss|Hunter|Marksmanship',rank:1,
    snapshotSha:'a'.repeat(64),totalDps:1000,className:'Hunter',
    specName:'Marksmanship',name:'Anonymous'}]
};
const char=(amount)=>({id:7,name:'ExampleHunter',amount,class:'Hunter',spec:'Marksmanship'});
const fight=(amount)=>({
  fightID:12,encounter:{id:3470},difficulty:4,
  roles:{dps:{characters:[char(amount)]}}
});
const body=(opts={})=>({
  data:{
    rateLimitData:{currentRequest:{total:17}},
    reportData:{report:{
      code:'EXAMPLE_ONLY',revision:5,
      overall:{data:[fight(1000)]},boss:{data:[fight(700)]}
    }}
  },...opts
});
test('query requests exact same fight DPS and boss DPS plus report code and revision',()=>{
  const x=makeRankingsQuery(group);
  assert.deepEqual(x.variables,{code:'EXAMPLE_ONLY',fightID:12});
  assert.match(x.query,/report\(code:\$code\)\{code revision/);
  assert.match(x.query,/overall:rankings\(fightIDs:\[\$fightID\],playerMetric:dps\)/);
  assert.match(x.query,/boss:rankings\(fightIDs:\[\$fightID\],playerMetric:bossdps\)/);
  assert.match(x.query,/currentRequest\{total\}/);
  assert.equal(x.query.includes('table('),false);
});
test('valid envelope passes same-fight resolver and reports observed points',()=>{
  const e=decodeRankingsEnvelope(group,200,body());
  assert.equal(e.status,'OK');
  assert.equal(e.observedPoints,17);
  const proof=joinFightEvidence(group,e.report);
  assert.equal(proof.verified.length,1);
  assert.equal(proof.verified[0].proof.bossDps,700);
});
test('revision mismatch, missing response identity and wrong code always fail closed',()=>{
  for(const change of [
    p=>{p.data.reportData.report.revision=6;},
    p=>{delete p.data.reportData.report.revision;},
    p=>{p.data.reportData.report.code='OTHER';}
  ]){
    const b=body();change(b);
    const x=decodeRankingsEnvelope(group,200,b);
    assert.equal(x.report,null);
    assert.notEqual(x.status,'OK');
  }
});
test('partial GraphQL errors prevent proof even when report rows exist',()=>{
  const b=body({errors:[{message:'partial response charged'}]});
  const x=decodeRankingsEnvelope(group,200,b);
  assert.equal(x.status,'UNCERTAIN_HTTP_OR_GRAPHQL');
  assert.equal(x.report,null);
  assert.equal(x.observedPoints,17);
});
test('HTTP 504 or 429 has unknown cost unless explicit rate witness exists',()=>{
  for(const status of [429,504]){
    const x=decodeRankingsEnvelope(group,status,{});
    assert.equal(x.observedPoints,null);
    assert.equal(x.report,null);
  }
});
test('no rateLimitData means cost unknown, not zero',()=>{
  const b=body();delete b.data.rateLimitData;
  const x=decodeRankingsEnvelope(group,200,b);
  assert.equal(x.status,'OK');
  assert.equal(x.observedPoints,null);
});
test('invalid ranking shape and empty scope never produce evidence',()=>{
  const b=body();b.data.reportData.report.boss={notData:[]};
  assert.equal(decodeRankingsEnvelope(group,200,b).status,'RANKINGS_SHAPE_INVALID');
  assert.throws(()=>makeRankingsQuery({...group,fightId:0}),/REPORT_QUERY_SCOPE_INVALID/);
});
