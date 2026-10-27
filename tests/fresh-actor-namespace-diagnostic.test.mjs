import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnoseFreshActorNamespaces as diagnose}
  from '../src/core/fresh-actor-namespace-diagnostic.mjs';

const target={reportCode:'PRIVATE_SYNTHETIC_REPORT',fightId:11};
const player=(id,amount=1000,name='SyntheticHero',server='example-realm',
  klass='Shaman',spec='Enhancement')=>
  ({id,amount,name,server,class:klass,spec});
const actor=(id,name='SyntheticHero',server='example-realm',subType='Shaman')=>
  ({id,name,server,subType,type:'Player',petOwner:null});
const make=()=>{
  const fight=(characters)=>({
    fightID:11,encounter:{id:3470},difficulty:5,
    roles:{dps:{characters}}
  });
  const wrap=report=>({data:{reportData:{report:{
    code:target.reportCode,revision:7,...report
  }}}});
  return {
    target,
    rankingsBody:wrap({
      overall:{data:[fight([player(1234567),player(2345678,800,'Alt','realm2','Mage','Fire')])]},
      boss:{data:[fight([player(1234567,600),player(2345678,400,'Alt','realm2','Mage','Fire')])]}
    }),
    tableBody:wrap({damage:{data:{entries:[
      {id:2,total:250000},{id:3,total:20000},{id:900,total:10000}
    ]}}}),
    masterBody:wrap({masterData:{actors:[
      actor(2),actor(3,'Alt','realm2','Mage'),
      {id:900,name:'SummonedPet',server:null,subType:'Pet',type:'Pet',petOwner:2}
    ]}})
  };
};

test('canonical-looking ranking ID to report-local table ID remains merely candidate',()=>{
  const input=make();
  const out=diagnose(input);
  assert.deepEqual(out,{
    status:'NAME_SERVER_CLASS_CANDIDATES_ONLY',
    rankedMatchedActors:2,tableSourceRows:3,
    directNumericIdOverlap:0,localPlayerRows:2,
    strongNameServerClassCandidates:2,ambiguousIdentityKeys:0,
    namespaceEquivalent:'UNPROVEN',dpsParity:'UNPROVEN'
  });
  const serialized=JSON.stringify(out);
  for(const secret of ['SyntheticHero','example-realm','PRIVATE_SYNTHETIC_REPORT','250000','1234567'])
    assert.ok(!serialized.includes(secret));
});

test('consumed original request has no masterData, cannot retroactively recover IDs',()=>{
  const input=make();
  delete input.masterBody;
  const out=diagnose(input);
  assert.equal(out.status,'NO_SAME_REPORT_REVISION_MASTERDATA');
  assert.equal(out.directNumericIdOverlap,0);
  assert.equal(out.strongNameServerClassCandidates,0);
  assert.equal(out.dpsParity,'UNPROVEN');
});

test('masterData from different report or revision must not be merged',()=>{
  for(const changes of [
    master=>{master.code='ANOTHER_REPORT';},
    master=>{master.revision++;},
    master=>{delete master.masterData;}
  ]){
    const input=make();
    changes(input.masterBody.data.reportData.report);
    const out=diagnose(input);
    assert.equal(out.status,'NO_SAME_REPORT_REVISION_MASTERDATA');
    assert.equal(out.strongNameServerClassCandidates,0);
  }
});

test('names without matching exact realms or exact class are insufficient',()=>{
  for(const change of [
    a=>{a.server='different-realm';},
    a=>{a.server=null;},
    a=>{a.subType='Druid';}
  ]){
    const input=make();
    change(input.masterBody.data.reportData.report.masterData.actors[0]);
    const out=diagnose(input);
    assert.equal(out.strongNameServerClassCandidates,1);
    assert.equal(out.namespaceEquivalent,'UNPROVEN');
  }
});

test('colliding player identity keys are counted ambiguous, never resolved by order',()=>{
  const input=make();
  input.masterBody.data.reportData.report.masterData.actors.push(
    actor(44,'SyntheticHero','example-realm','Shaman'));
  input.tableBody.data.reportData.report.damage.data.entries.push({id:44,total:1});
  const out=diagnose(input);
  assert.equal(out.status,'AMBIGUOUS_CANDIDATE_IDENTITIES');
  assert.equal(out.ambiguousIdentityKeys,1);
  assert.equal(out.strongNameServerClassCandidates,1);
  assert.equal(out.dpsParity,'UNPROVEN');
});

test('pet and NPC are excluded from player candidates and retained as source rows',()=>{
  const input=make();
  input.masterBody.data.reportData.report.masterData.actors[0].type='Pet';
  input.masterBody.data.reportData.report.masterData.actors[0].petOwner=3;
  const out=diagnose(input);
  assert.equal(out.localPlayerRows,1);
  assert.equal(out.strongNameServerClassCandidates,1);
  assert.equal(out.tableSourceRows,3);
});

test('missing table or Fight mismatch stays unverifiable, never zero-cost success',()=>{
  for(const mutate of [
    inp=>{inp.tableBody.data.reportData.report.damage.data.entries=[];},
    inp=>{inp.rankingsBody.data.reportData.report.overall.data[0].fightID=10;},
    inp=>{inp.tableBody.data.reportData.report.revision=2;}
  ]){
    const input=make();
    mutate(input);
    const out=diagnose(input);
    assert.equal(out.dpsParity,'UNPROVEN');
    assert.equal(out.strongNameServerClassCandidates,0);
    assert.notEqual(out.status,'NAME_SERVER_CLASS_CANDIDATES_ONLY');
  }
});

test('direct numeric equality alone does not confer report-local namespace equivalence',()=>{
  const input=make();
  input.tableBody.data.reportData.report.damage.data.entries[0].id=1234567;
  const out=diagnose(input);
  assert.equal(out.directNumericIdOverlap,1);
  assert.equal(out.namespaceEquivalent,'UNPROVEN');
  assert.equal(out.dpsParity,'UNPROVEN');
});
