import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTypedRosterCrosswalkQuery,auditTypedRosterCrosswalk}
  from '../src/core/fresh-typed-roster-crosswalk.mjs';
import {IDENTITY_TARGET} from '../src/core/fresh-one-query-identity.mjs';

const wrap=obj=>({data:{reportData:{report:{
  code:IDENTITY_TARGET.reportCode,revision:17,...obj
}}}});
const rank=(id,name,amount,klass='Shaman')=>({
  id,name,class:klass,spec:'Enhancement',amount
});
const fight=actors=>({
  fightID:11,encounter:{id:3470},difficulty:5,
  roles:{dps:{characters:actors}}
});
const character=(canonicalID,name,server,serverId=777)=>({
  canonicalID,id:canonicalID+100,name,classID:7,
  server:{id:serverId,normalizedName:server}
});
const local=(id,name,server='example-realm',subType='Shaman')=>({
  id,name,server,subType,type:'Player',petOwner:null
});
const data=()=>{
  const r=rank(999999,'UniqueSynthetic',1000);
  const b=rank(999999,'UniqueSynthetic',600);
  const other=rank(919191,'OtherSynthetic',1200,'Mage');
  const otherBoss=rank(919191,'OtherSynthetic',800,'Mage');
  return {
    target:IDENTITY_TARGET,
    rankingsBody:wrap({
      overall:{data:[fight([r,other])]},
      boss:{data:[fight([b,otherBoss])]}
    }),
    tableBody:wrap({damage:{data:{entries:[
      {id:12,total:100000},{id:17,total:90000},{id:20,total:20000}
    ]}}}),
    masterBody:wrap({masterData:{actors:[
      local(12,'UniqueSynthetic'),
      local(17,'OtherSynthetic','realm2','Mage'),
      {id:20,type:'Pet',name:'SummonedPet',petOwner:12,server:null}
    ]}}),
    typedBody:wrap({rankedCharacters:[
      character(123456,'UniqueSynthetic','example-realm'),
      character(231231,'OtherSynthetic','realm2'),
      character(444444,'OtherFightOnly','another-realm')
    ]})
  };
};
const audit=over=>auditTypedRosterCrosswalk(over??data());

test('typed field names verified from WCL schema and Fight scoping clearly distinct',()=>{
  const q=buildTypedRosterCrosswalkQuery();
  assert.deepEqual(q.variables,{code:IDENTITY_TARGET.reportCode,fightID:11});
  assert.match(q.query,/overall:rankings\(fightIDs:\[\$fightID\]/);
  assert.match(q.query,/boss:rankings\(fightIDs:\[\$fightID\]/);
  assert.match(q.query,/damage:table\(fightIDs:\[\$fightID\]/);
  assert.match(q.query,/rankedCharacters\{canonicalID id name classID server\{id normalizedName\}\}/);
  assert.doesNotMatch(q.query,/rankedCharacters\s*\(/);
  assert.throws(()=>buildTypedRosterCrosswalkQuery({
    reportCode:'other',fightId:11
  }),/TYPED_ROSTER_SCOPE_DENIED/);
});
test('four-way report-wide candidate is never declared globally verified',()=>{
  const x=audit();
  assert.equal(x.status,'REPORT_ROSTER_FIGHT_CANDIDATES_ONLY');
  assert.equal(x.rankedFightActors,2);
  assert.equal(x.typedReportCharacters,3);
  assert.equal(x.reportLocalPlayers,2);
  assert.equal(x.tableSourceRows,3);
  assert.equal(x.sameFightFourWayCandidates,2);
  assert.equal(x.matchedTypedLocalServerCandidates,2);
  assert.equal(x.ambiguousLocalSourceIds,0);
  assert.equal(x.canonicalCharacterIdentity,'UNPROVEN');
  assert.equal(x.bossDpsParity,'UNPROVEN');
  assert.equal(x.exact100Parity,'UNPROVEN');
  assert.equal(x.tableAdopted,false);
  assert.equal(x.graphqlRequestsPerformed,0);
  for(const s of ['UniqueSynthetic','example-realm','999999','123456',
    'dQbNzMkG94LqYTh1'])
    assert.equal(JSON.stringify(x).includes(s),false);
});
test('cross-region duplicate character name forbids weak name-only bridge',()=>{
  const input=data();
  input.typedBody.data.reportData.report.rankedCharacters.push(
    character(776655,'UniqueSynthetic','other-region-realm',888));
  const x=audit(input);
  assert.equal(x.ambiguousTypedNameKeys,1);
  assert.equal(x.sameFightFourWayCandidates,1);
  assert.equal(x.canonicalCharacterIdentity,'UNPROVEN');
});
test('same-name local players on multiple realms forbid automatic Fight source attribution',()=>{
  const input=data();
  input.masterBody.data.reportData.report.masterData.actors.push(
    local(444,'UniqueSynthetic','other-realm'));
  input.tableBody.data.reportData.report.damage.data.entries.push({
    id:444,total:100
  });
  const x=audit(input);
  assert.equal(x.ambiguousLocalNameKeys,1);
  assert.equal(x.sameFightFourWayCandidates,1);
  assert.equal(x.exact100Parity,'UNPROVEN');
});
test('server mismatch or class mismatch prevents typed mapping',()=>{
  for(const change of [
    inp=>{inp.typedBody.data.reportData.report.rankedCharacters[0]
      .server.normalizedName='other-realm';},
    inp=>{inp.masterBody.data.reportData.report.masterData.actors[0]
      .subType='Druid';},
    inp=>{inp.typedBody.data.reportData.report.rankedCharacters[0]
      .server=null;}
  ]){
    const input=data();change(input);
    const x=audit(input);
    assert.equal(x.sameFightFourWayCandidates,1);
    assert.equal(x.canonicalCharacterIdentity,'UNPROVEN');
  }
});
test('master actor duplicate table-local ID blocks that source while preserving unrelated evidence',()=>{
  const input=data();
  input.masterBody.data.reportData.report.masterData.actors.push(
    {id:12,name:'Mimic',type:'NPC',petOwner:null}
  );
  const x=audit(input);
  assert.equal(x.ambiguousLocalSourceIds,1);
  assert.equal(x.sameFightFourWayCandidates,1);
});
test('report revision or Fight ID mismatch cannot reuse a global roster',()=>{
  for(const change of [
    inp=>{inp.typedBody.data.reportData.report.revision=18;},
    inp=>{inp.masterBody.data.reportData.report.code='WRONG';},
    inp=>{inp.rankingsBody.data.reportData.report.overall.data[0].fightID=10;}
  ]){
    const input=data();change(input);
    const x=audit(input);
    assert.notEqual(x.status,'REPORT_ROSTER_FIGHT_CANDIDATES_ONLY');
    assert.equal(x.sameFightFourWayCandidates,0);
    assert.equal(x.bossDpsParity,'UNPROVEN');
  }
});
test('missing typed rankedCharacters is not interpreted as an empty successful report roster',()=>{
  const input=data();
  delete input.typedBody.data.reportData.report.rankedCharacters;
  const x=audit(input);
  assert.equal(x.status,'REQUIRED_SOURCE_UNOBSERVED');
  assert.equal(x.sameFightFourWayCandidates,0);
});
test('global character IDs duplicated in typed response cannot certify any candidate',()=>{
  const input=data();
  input.typedBody.data.reportData.report.rankedCharacters[1].canonicalID=123456;
  const x=audit(input);
  assert.equal(x.typedRosterDuplicateCanonicalIds,1);
  assert.equal(x.sameFightFourWayCandidates,0);
  assert.equal(x.canonicalCharacterIdentity,'UNPROVEN');
});


test('inactive same-name local Player elsewhere in report blocks Fight identity claim',()=>{
  const input=data();
  input.masterBody.data.reportData.report.masterData.actors.push(
    local(7777,'UniqueSynthetic','different-realm'));
  const x=audit(input);
  assert.equal(x.ambiguousLocalNameKeys,1);
  assert.equal(x.sameFightFourWayCandidates,1);
  assert.equal(x.canonicalCharacterIdentity,'UNPROVEN');
});

test('malformed duplicate typed character cannot create false unique name mapping',()=>{
  const input=data();
  input.typedBody.data.reportData.report.rankedCharacters.push({
    canonicalID:null,name:'UniqueSynthetic',classID:null,server:null
  });
  const x=audit(input);
  assert.equal(x.typedRosterMissingOrInvalid,1);
  assert.equal(x.ambiguousTypedNameKeys,1);
  assert.equal(x.sameFightFourWayCandidates,1);
  assert.equal(x.canonicalCharacterIdentity,'UNPROVEN');
});

test('single malformed typed roster entry never crashes the diagnostic',()=>{
  const input=data();
  input.typedBody.data.reportData.report.rankedCharacters[0].server=null;
  const x=audit(input);
  assert.equal(x.typedRosterMissingOrInvalid,1);
  assert.equal(x.sameFightFourWayCandidates,1);
  assert.equal(x.namespaceEquivalent===undefined,true);
  assert.equal(x.exact100Parity,'UNPROVEN');
});


test('report-wide homonym with invalid local ID prevents false Fight identity',()=>{
  const input=data();
  input.masterBody.data.reportData.report.masterData.actors.push({
    id:0,name:'UniqueSynthetic',server:'other-realm',
    type:'Player',subType:'Shaman',petOwner:null
  });
  const out=audit(input);
  assert.equal(out.ambiguousLocalNameKeys,1);
  assert.equal(out.sameFightFourWayCandidates,1);
  assert.equal(out.canonicalCharacterIdentity,'UNPROVEN');
});
