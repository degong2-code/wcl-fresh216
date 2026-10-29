import test from 'node:test';
import assert from 'node:assert/strict';
import {planFightFetches} from '../src/core/fetch-plan.mjs';
import {joinFightEvidence} from '../src/core/evidence-join.mjs';
import {summarizeJobSnapshot} from '../src/core/job-kpis.mjs';

const hunter=(amount=1000)=>({id:7,name:'ExampleHunter',class:'Hunter',
  spec:'Marksmanship',amount});
const mage=(amount=900)=>({id:8,name:'ExampleMage',class:'Mage',
  spec:'Arcane',amount});
const slot=(changes={})=>({
  scopeKey:'heroic:snapshot1',jobKey:'BossA|Hunter|Marksmanship',rank:1,
  snapshotSha:'a'.repeat(64),name:'Anonymous',status:'PENDING',
  className:'Hunter',specName:'Marksmanship',totalDps:1000,
  reportCode:'SYNTHETIC-REPORT',reportRevision:5,
  fightId:12,encounterId:3470,difficulty:4,...changes
});
const report=(all,boss,change={})=>({
  code:'SYNTHETIC-REPORT',revision:5,
  overall:{data:[{fightID:12,encounter:{id:3470},difficulty:4,roles:{dps:{characters:all}}}]},
  boss:{data:[{fightID:12,encounter:{id:3470},difficulty:4,roles:{dps:{characters:boss}}}]},
  ...change
});

test('cross-job same-fight grouping resolves both actors from one existing report',()=>{
  const p=planFightFetches([slot(),slot({
    jobKey:'BossA|Mage|Arcane',className:'Mage',specName:'Arcane',
    rank:37,totalDps:900,snapshotSha:'b'.repeat(64)
  })]);
  assert.equal(p.distinctFightRequests,1);
  const j=joinFightEvidence(p.groups[0],report([hunter(),mage()],
    [hunter(700),mage(600)]));
  assert.equal(j.verified.length,2);
  assert.equal(j.unresolved.length,0);
  assert.equal(j.verified.find(x=>x.rank===1).proof.bossDps,700);
  assert.equal(j.verified.find(x=>x.rank===37).proof.bossDps,600);
  assert.notEqual(j.verified[0].proof.snapshotSha,j.verified[1].proof.snapshotSha);
});
test('revision change and wrong code refuse all proofs',()=>{
  const p=planFightFetches([slot()]);
  for(const change of [{revision:6},{code:'OTHER'},{revision:null}]){
    const j=joinFightEvidence(p.groups[0],report([hunter()],[hunter(700)],change));
    assert.equal(j.verified.length,0);
    assert.equal(j.unresolved.length,1);
  }
});
test('one ambiguous actor remains unresolved without blocking a different unique actor',()=>{
  const p=planFightFetches([slot(),slot({
    jobKey:'BossA|Mage|Arcane',className:'Mage',specName:'Arcane',
    rank:4,totalDps:900,snapshotSha:'b'.repeat(64)
  })]);
  const j=joinFightEvidence(p.groups[0],report([hunter(),{...hunter(),id:9},mage()],
    [hunter(700),mage(600)]));
  assert.equal(j.verified.length,1);
  assert.equal(j.verified[0].rank,4);
  assert.equal(j.unresolved[0].rank,1);
});

test('synthetic 100-rank pipeline: plan → existing fight evidence → EXACT100/U:Y',()=>{
  const rows=Array.from({length:100},(_,i)=>slot({
    rank:i+1,fightId:i+1,totalDps:3000-i*10
  }));
  const plan=planFightFetches(rows);
  assert.equal(plan.distinctFightRequests,100);
  const proofs=new Map();
  for(const group of plan.groups) {
    const total=rows.find(r=>r.fightId===group.fightId).totalDps;
    const rep=report([hunter(total)],[hunter(total*0.7)]);
    rep.overall.data[0].fightID=group.fightId;
    rep.boss.data[0].fightID=group.fightId;
    const outcome=joinFightEvidence(group,rep);
    assert.equal(outcome.verified.length,1);
    const found=outcome.verified[0];
    proofs.set(found.rank,found.proof);
  }
  const completed=summarizeJobSnapshot(rows.map(s=>({...s,proof:proofs.get(s.rank)})));
  assert.equal(completed.status,'EXACT100');
  assert.equal(completed.verifiedRanks,100);
  assert.deepEqual(completed.nonBossShare,[0.3,0.3,0.3,0.3,0.3]);
  assert.equal(completed.bossDpsMetrics[1],rows[29].totalDps*0.7);
});
