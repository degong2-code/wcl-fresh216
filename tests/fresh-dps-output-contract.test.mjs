import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {summarizeFreshDpsJob} from '../src/core/fresh-dps-output-contract.mjs';

const scopeKey='heroic:contract-test';
const jobKey='네크잘리|Shaman|Enhancement';
const snapshotSha='a'.repeat(64);
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const base=Array.from({length:100},(_,i)=>({
  scopeKey,jobKey,rank:i+1,snapshotSha,
  status:'PENDING',name:'Actor'+(i+1),
  totalDps:200000-i*1000,
  reportCode:'Original'+(i+1),fightId:i+1,
  encounterId:3470,difficulty:4,className:'Shaman',
  specName:'Enhancement',reportRevision:null,
  startTime:1792594801000+i*1000,
  filter:'date.1792594800000.1793113200000'
}));
function fixture(){
  const totalRankSlots=structuredClone(base);
  // Official BossDPS rank1 is TotalDPS rank2. Their original fights match
  // but the two metrics' leaderboard ordering MUST NOT be conflated.
  const rankOrder=[1,0,...Array.from({length:98},(_,i)=>i+2)];
  const rankings=rankOrder.map((sourceIndex,k)=>{
    const s=totalRankSlots[sourceIndex];
    const amount=k===0?180000:k===1?140000:100000-(k-2)*100;
    return {name:s.name,amount,startTime:s.startTime,
      report:{code:s.reportCode,fightID:s.fightId}};
  });
  const bossPage={jobKey,snapshotSha,rankings,
    rankingsStatus:'EXACT100',bossRankingSha:digest(rankings)};
  const proofs=rankings.map(r=>{
    const s=totalRankSlots.find(v=>v.reportCode===r.report.code);
    return {jobKey,rank:s.rank,snapshotSha,proof:{
      proofType:'EXACT_SAME_FIGHT_ACTOR',
      actorRef:'name:'+s.name.toLowerCase(),bossDps:r.amount,
      snapshotSha,reportCode:s.reportCode,fightId:s.fightId,
      encounterId:3470,difficulty:4,reportRevision:null,
      sourceStartTime:s.startTime,
      discovery:{kind:'BOSSDPS_RANKING_PAGE',page:1}
    }};
  });
  return {totalRankSlots,bossPage,proofs};
}
test('independent BossDPS leaderboard and Total-linked BossDPS never share rank semantics',()=>{
  const f=fixture();
  const result=summarizeFreshDpsJob({
    totalRankSlots:f.totalRankSlots,bossPage:f.bossPage,
    verifiedProofs:f.proofs
  });
  assert.equal(result.status,'EXACT100');
  assert.equal(result.bossRankingStatus,'EXACT100');
  assert.equal(result.verifiedRanks,100);
  assert.equal(result.totalDpsMetrics[0],200000);
  assert.equal(result.bossRankedDpsMetrics[0],180000);
  assert.equal(result.totalRankJoinedBossDpsMetrics[0],140000);
  assert.equal(result.nonBossShare[0],0.3);
  assert.equal(result.totalRankJoinedBossDpsMetrics[1],
    f.proofs.find(p=>p.rank===30).proof.bossDps);
  assert.equal(result.bossRankedDpsMetrics[1],f.bossPage.rankings[29].amount);
  assert.equal(result.bossRankingSnapshotSha,f.bossPage.bossRankingSha);
  assert.equal(result.nonBossShare[3],Math.round(1e6*
    ((f.totalRankSlots.slice(0,30).reduce((x,s)=>x+s.totalDps,0)-
      f.proofs.filter(p=>p.rank<=30).reduce((x,p)=>x+p.proof.bossDps,0))/
      f.totalRankSlots.slice(0,30).reduce((x,s)=>x+s.totalDps,0)))/1e6);
});
test('unmatched one rank is null and topN shares are never a matched-subset mean',()=>{
  const f=fixture();
  f.proofs=f.proofs.filter(p=>p.rank!==30);
  const v=summarizeFreshDpsJob({
    totalRankSlots:f.totalRankSlots,bossPage:f.bossPage,
    verifiedProofs:f.proofs
  });
  assert.equal(v.status,'PARTIAL');
  assert.equal(v.verifiedRanks,99);
  assert.equal(v.bossRankedDpsMetrics[3]!==null,true);
  assert.equal(v.totalRankJoinedBossDpsMetrics[1],null);
  assert.equal(v.totalRankJoinedBossDpsMetrics[3],null);
  assert.equal(v.totalRankJoinedBossDpsMetrics[4],null);
  assert.equal(v.nonBossShare[1],null);
  assert.equal(v.nonBossShare[3],null);
  assert.equal(v.nonBossShare[4],null);
  assert.equal(v.nonBossShare[0],0.3);
});
test('partial independent BossDPS rankings do not fabricate 100th rank or means',()=>{
  const f=fixture();
  f.bossPage.rankings=f.bossPage.rankings.slice(0,99);
  f.bossPage.rankingsStatus='PARTIAL';
  f.bossPage.bossRankingSha=digest(f.bossPage.rankings);
  const v=summarizeFreshDpsJob({
    totalRankSlots:f.totalRankSlots,bossPage:f.bossPage,
    verifiedProofs:f.proofs
  });
  assert.equal(v.bossRankingStatus,'PARTIAL');
  assert.deepEqual(v.bossRankedDpsMetrics,[
    180000,f.bossPage.rankings[29].amount,null,
    f.bossPage.rankings.slice(0,30).reduce((n,r)=>n+r.amount,0)/30,
    null
  ]);
  assert.equal(v.totalRankJoinedBossDpsMetrics[0],140000);
});
test('null boss leaderboard does not erase verified source-linked BossDPS',()=>{
  const f=fixture();
  const v=summarizeFreshDpsJob({
    totalRankSlots:f.totalRankSlots,verifiedProofs:f.proofs});
  assert.equal(v.bossRankingStatus,'NOT_COLLECTED');
  assert.deepEqual(v.bossRankedDpsMetrics,[null,null,null,null,null]);
  assert.equal(v.nonBossShare[0],0.3);
});
test('anonymous retained at original rank but never receives invented BossDPS proof',()=>{
  const f=fixture();
  f.totalRankSlots[99].name='Anonymous';
  f.proofs=f.proofs.filter(p=>p.rank!==100);
  const v=summarizeFreshDpsJob({
    totalRankSlots:f.totalRankSlots,bossPage:f.bossPage,
    verifiedProofs:f.proofs});
  assert.equal(v.verifiedRanks,99);
  assert.equal(v.nonBossShare[2],null);
  assert.equal(v.nonBossShare[4],null);
  assert.equal(v.totalDpsMetrics[2],101000);
  assert.equal(v.bossRankedDpsMetrics[2]!==null,true);
});
test('reject different Report/Fight/time, duplicate rank, masked proof, false boss hash',()=>{
  const f=fixture();
  for(const prop of ['reportCode','fightId','sourceStartTime']){
    const bad=structuredClone(f.proofs);
    bad[0].proof[prop]=prop==='reportCode'?'SOME_OTHER_REPORT':1e14;
    assert.throws(()=>summarizeFreshDpsJob({
      totalRankSlots:f.totalRankSlots,bossPage:f.bossPage,verifiedProofs:bad
    }),/DPS_PROOF_FIGHT_ACTOR_INVALID/);
  }
  const badRank=structuredClone(f.proofs);
  badRank.push(structuredClone(badRank[0]));
  assert.throws(()=>summarizeFreshDpsJob({
    totalRankSlots:f.totalRankSlots,bossPage:f.bossPage,verifiedProofs:badRank
  }),/DPS_PROOF_RANK_OR_SNAPSHOT_DRIFT/);
  const fake=structuredClone(f.bossPage);
  fake.rankings[0].amount+=1;
  assert.throws(()=>summarizeFreshDpsJob({
    totalRankSlots:f.totalRankSlots,bossPage:fake,verifiedProofs:f.proofs
  }),/DPS_BOSS_RANKING_WITNESS_INVALID/);
  f.totalRankSlots[0].name='Anonymous';
  assert.throws(()=>summarizeFreshDpsJob({
    totalRankSlots:f.totalRankSlots,bossPage:f.bossPage,verifiedProofs:f.proofs
  }),/DPS_MASKED_OR_COLLIDING_ACTOR/);
});
test('cannot claim unique identity when two TotalDPS ranks share same report-fight-name',()=>{
  const f=fixture();
  f.totalRankSlots[1].reportCode=f.totalRankSlots[0].reportCode;
  f.totalRankSlots[1].fightId=f.totalRankSlots[0].fightId;
  f.totalRankSlots[1].name=f.totalRankSlots[0].name;
  assert.throws(()=>summarizeFreshDpsJob({
    totalRankSlots:f.totalRankSlots,bossPage:f.bossPage,
    verifiedProofs:f.proofs}),/DPS_MASKED_OR_COLLIDING_ACTOR/);
});
