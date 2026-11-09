import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {makeLeanBossTableQuery,compareLeanBossTable} from
  '../tools/lib/fresh216-lean-boss-table-query.mjs';

const h=n=>createHash('sha256').update(JSON.stringify(n.toLowerCase())).digest('hex');
const targets=[
 {encounterID:3470,npcGameIDs:[259927,263050]},
 {encounterID:3455,npcGameIDs:[259181]}
];
const base=[
 {reportCode:'Zc7QygjkhaF8m43x',fightId:15,encounterId:3470,
  difficulty:4,expectedRevision:59,
  expectedActors:[{actorNameSha256:h('Alpha'),bossDps:200}]},
 {reportCode:'Zc7QygjkhaF8m43x',fightId:17,encounterId:3470,
  difficulty:4,expectedRevision:59,
  expectedActors:[{actorNameSha256:h('Bravo'),bossDps:300}]},
 {reportCode:'wMKZ1Rk3AgmvnbdN',fightId:38,encounterId:3455,
  difficulty:4,expectedRevision:28,
  expectedActors:[{actorNameSha256:h('Charlie'),bossDps:400}]}
];
const mock=(plan,{points={total:3.25,application:3.25,database:0}}={})=>{
 const reports={};
 for(const g of plan.reportIndex){
  const fs=g.fields.map(i=>{
   const f=plan.fields[i];
   return {id:f.fightId,encounterID:f.encounterId,difficulty:4,kill:true,
     startTime:1000,endTime:11000};
  });
  const r={code:g.reportCode,revision:g.reportCode===base[2].reportCode?28:59,fights:fs};
  for(const i of g.fields){
   const name=['Alpha','Bravo','Charlie'][i];
   r['t'+i]={data:{entries:[{name,total:(i+2)*1000}]}};
  }
  reports[g.reportAlias]=r;
 }
 return {data:{rateLimitData:{currentRequest:points},reportData:reports}};
};

test('one request / three independent fight tables, two report groups and no discovery',()=>{
 const plan=makeLeanBossTableQuery(base,targets);
 assert.equal(plan.requestCount,1);
 assert.equal(plan.namedTableFields,3);
 assert.equal(plan.reportGroups,2);
 assert.equal((plan.query.match(/table\(dataType:DamageDone/g)||[]).length,3);
 assert.equal((plan.query.match(/:report\(code:/g)||[]).length,2);
 assert.equal((plan.query.match(/fights\(fightIDs:/g)||[]).length,2);
 assert.match(plan.variables.expr0,/259927, 263050/);
 assert.match(plan.variables.expr2,/259181/);
 assert.doesNotMatch(plan.query,/masterData|enemyNPCs|table\(dataType:DamageDone[^)]*sourceID/);
 assert.equal(new Set(plan.fields.map(f=>f.fightId)).size,3);
 assert.match(plan.query,/rateLimitData\{currentRequest limitPerHour pointsSpentThisHour\}/);
});

test('known actor DPS, report revision, fight duration and quota verified',()=>{
 const plan=makeLeanBossTableQuery(base,targets);
 const result=compareLeanBossTable(plan,{httpStatus:200,body:mock(plan),
   wallMs:123,bytes:80000});
 assert.equal(result.status,'EXACT_PARITY_PASS');
 assert.equal(result.exact,3);
 assert.equal(result.missing,0);
 assert.equal(result.mismatch,0);
 assert.equal(result.points,3.25);
 assert.equal(result.databasePoints,0);
 assert.equal(result.bytes,80000);
});

test('revision, identity, unknown cost and missing actor fail closed',()=>{
 const plan=makeLeanBossTableQuery(base,targets);
 const revision=mock(plan);
 revision.data.reportData.r0.revision=60;
 assert.equal(compareLeanBossTable(plan,{httpStatus:200,body:revision}).issue,
   'LEAN_REPORT_REVISION_CHANGED');
 const fight=mock(plan);
 fight.data.reportData.r0.fights[0].encounterID=3497;
 assert.equal(compareLeanBossTable(plan,{httpStatus:200,body:fight}).issue,
   'LEAN_FIGHT_IDENTITY_MISMATCH');
 const missing=mock(plan);
 missing.data.reportData.r0.t0.data.entries[0].name='SomeoneElse';
 const result=compareLeanBossTable(plan,{httpStatus:200,body:missing});
 assert.equal(result.status,'NEEDS_REVIEW');
 assert.equal(result.missing,1);
 const unknown=mock(plan,{points:{}});
 assert.equal(compareLeanBossTable(plan,{httpStatus:200,body:unknown}).issue,
   'LEAN_POINTS_UNKNOWN');
 const http=compareLeanBossTable(plan,{httpStatus:502,body:mock(plan)});
 assert.equal(http.issue,'LEAN_HTTP_OR_GRAPHQL_UNCERTAIN');
});

test('cannot silently reuse invalid or duplicate encounter or report/fight',()=>{
 assert.throws(()=>makeLeanBossTableQuery([base[0],base[0]],targets),
   /LEAN_DUPLICATE_FIGHT/);
 assert.throws(()=>makeLeanBossTableQuery([base[0]],[]),
   /LEAN_TARGET_REGISTRY_MISSING/);
 assert.throws(()=>makeLeanBossTableQuery([base[0]],targets.concat(targets[0])),
   /LEAN_TARGET_REGISTRY_INVALID/);
 assert.throws(()=>makeLeanBossTableQuery([{
   ...base[0],encounterId:9999
 }],targets),/LEAN_FIGHT_SCOPE_INVALID/);
});
