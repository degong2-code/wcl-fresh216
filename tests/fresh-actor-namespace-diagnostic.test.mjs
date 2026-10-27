import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnoseFreshActorNamespaces as diagnose,
  auditFreshServerlessIdentity as audit}
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


test('duplicate total-DPS actor IDs are invalid even when absent from bossdps',()=>{
  const input=make();
  const arr=input.rankingsBody.data.reportData.report.overall.data[0]
    .roles.dps.characters;
  arr.push(player(999,400,'NoBossA','realm','Druid','Balance'));
  arr.push(player(999,350,'NoBossB','realm','Druid','Feral'));
  const out=diagnose(input);
  assert.equal(out.status,'RANKED_ACTOR_IDS_OR_METRICS_INVALID');
  assert.equal(out.strongNameServerClassCandidates,0);
  assert.equal(out.dpsParity,'UNPROVEN');
});

test('boss DPS exceeding total and class or spec conflict are rejected',()=>{
  for(const corrupt of [
    obj=>{obj.boss.amount=1001;},
    obj=>{obj.boss.class='Mage';},
    obj=>{obj.boss.spec='Elemental';}
  ]){
    const input=make();
    const all=input.rankingsBody.data.reportData.report.overall.data[0].roles.dps.characters[0];
    const boss=input.rankingsBody.data.reportData.report.boss.data[0].roles.dps.characters[0];
    corrupt({all,boss});
    const out=diagnose(input);
    assert.equal(out.status,'RANKED_METRICS_CONFLICT');
    assert.equal(out.strongNameServerClassCandidates,0);
  }
});

test('invalid numeric ranking metrics cannot manufacture identity candidates',()=>{
  for(const invalid of [NaN,Infinity,-1,'1000',null]){
    for(const which of ['overall','boss']){
      const input=make();
      input.rankingsBody.data.reportData.report[which].data[0]
        .roles.dps.characters[0].amount=invalid;
      const out=diagnose(input);
      assert.equal(out.status,'RANKED_ACTOR_IDS_OR_METRICS_INVALID');
      assert.equal(out.namespaceEquivalent,'UNPROVEN');
      assert.equal(out.strongNameServerClassCandidates,0);
    }
  }
});


test('nullable master ReportActor IDs do not erase unrelated valid player candidates',()=>{
  const input=make();
  input.masterBody.data.reportData.report.masterData.actors.push({
    id:null,name:'UnnamedNpc',server:null,type:'NPC',subType:'Boss',petOwner:null
  });
  const result=diagnose(input);
  assert.equal(result.status,'NAME_SERVER_CLASS_CANDIDATES_ONLY');
  assert.equal(result.strongNameServerClassCandidates,2);
  assert.equal(result.dpsParity,'UNPROVEN');
});

test('duplicate positive master ReportActor IDs still abort unambiguous attribution',()=>{
  const input=make();
  input.masterBody.data.reportData.report.masterData.actors.push({
    id:2,name:'OtherActor',server:null,type:'NPC',subType:'Boss',petOwner:null
  });
  const result=diagnose(input);
  assert.equal(result.status,'MASTER_ACTOR_IDS_AMBIGUOUS');
  assert.equal(result.strongNameServerClassCandidates,0);
});


test('serverless ranking actors produce weak unique name/class candidates only',()=>{
  const input=make();
  for(const kind of ['overall','boss'])
    for(const a of input.rankingsBody.data.reportData.report[kind]
      .data[0].roles.dps.characters)delete a.server;
  const out=audit(input);
  assert.equal(out.status,'SERVERLESS_CANDIDATES_ONLY');
  assert.equal(out.rankingActors,2);
  assert.equal(out.rankingServerStrings,0);
  assert.equal(out.serverlessNameClassCandidates,2);
  assert.equal(out.masterNullIds,0);
  assert.equal(out.masterDuplicatePositiveIds,0);
  assert.equal(out.tableSourceUniqueMasterIds,3);
  assert.equal(out.tableSourceAbsentMasterIds,0);
  assert.equal(out.identityVerified,false);
  assert.equal(out.namespaceEquivalent,'UNPROVEN');
  assert.equal(out.bossDpsParity,'UNPROVEN');
  for(const sensitive of ['SyntheticHero','example-realm','PRIVATE_SYNTHETIC_REPORT',
    '250000','1234567'])
    assert.ok(!JSON.stringify(out).includes(sensitive));
});

test('null master IDs and repeated positive IDs are distinguishable while preserving unrelated candidate counts',()=>{
  const input=make();
  for(const kind of ['overall','boss'])
    for(const a of input.rankingsBody.data.reportData.report[kind]
      .data[0].roles.dps.characters)delete a.server;
  input.masterBody.data.reportData.report.masterData.actors.push(
    {id:null,type:'NPC',name:'Anonymous',subType:'NPC',server:null},
    {id:2,type:'NPC',name:'OtherName',subType:'NPC',server:null},
    {id:0,type:'NPC',name:'BadNumeric',subType:'NPC',server:null}
  );
  const out=audit(input);
  assert.equal(out.status,'MASTER_ID_QUALITY_ISSUES_AND_UNPROVEN_CANDIDATES');
  assert.equal(out.masterNullIds,1);
  assert.equal(out.masterInvalidIds,1);
  assert.equal(out.masterDuplicatePositiveIds,1);
  assert.equal(out.tableSourceUniqueMasterIds,2);
  assert.equal(out.tableSourceAmbiguousMasterIds,1);
  assert.equal(out.tableSourceAbsentMasterIds,0);
  assert.equal(out.serverlessNameClassCandidates,1);
  assert.equal(out.identityVerified,false);
});

test('same name/class on two report-local players cannot become safe serverless match',()=>{
  const input=make();
  for(const kind of ['overall','boss'])
    for(const a of input.rankingsBody.data.reportData.report[kind]
      .data[0].roles.dps.characters)delete a.server;
  input.masterBody.data.reportData.report.masterData.actors.push(
    actor(123,'SyntheticHero','other-server','Shaman'));
  const out=audit(input);
  assert.equal(out.status,'AMBIGUOUS_SERVERLESS_NAME_CLASS_CANDIDATES');
  assert.equal(out.ambiguousNameClassKeys,1);
  assert.equal(out.serverlessNameClassCandidates,1);
  assert.equal(out.identityVerified,false);
});

test('object-shaped ranking server is counted without inferring its schema or joining realms',()=>{
  const input=make();
  input.rankingsBody.data.reportData.report.overall.data[0].roles.dps
    .characters[0].server={slug:'untrusted-realm-object'};
  const out=audit(input);
  assert.equal(out.rankingServerObjects,1);
  assert.equal(out.rankingServerStrings,1);
  assert.equal(out.namespaceEquivalent,'UNPROVEN');
  assert.equal(out.identityVerified,false);
});

test('serverless audit refuses cross-report revision, Fight, and invalid source IDs',()=>{
  const mutations=[
    inp=>{inp.masterBody.data.reportData.report.revision=99;},
    inp=>{inp.tableBody.data.reportData.report.code='WRONG';},
    inp=>{inp.rankingsBody.data.reportData.report.boss.data[0].fightID=12;},
    inp=>{inp.tableBody.data.reportData.report.damage.data.entries.push({id:2,total:1});}
  ];
  for(const mutate of mutations){
    const input=make();mutate(input);
    const out=audit(input);
    assert.equal(out.identityVerified,false);
    assert.equal(out.serverlessNameClassCandidates,0);
    assert.equal(out.exact100Parity,'UNPROVEN');
  }
});
