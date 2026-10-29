import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeJobSnapshot } from '../src/core/job-kpis.mjs';

const snap='a'.repeat(64);
const make=()=>Array.from({length:100},(_,i)=>{
  const rank=i+1,totalDps=1000+rank*13;
  const scopeKey='heroic:offline',jobKey='BossA|Hunter|Marksmanship';
  const reportCode='SYNTHETIC-ONLY',fightId=rank,encounterId=3470,difficulty=4;
  return {scopeKey,jobKey,rank,snapshotSha:snap,
    reportCode,fightId,encounterId,difficulty,totalDps,
    proof:{proofType:'EXACT_SAME_FIGHT_ACTOR',actorRef:'id:7',bossDps:rank%2?totalDps*0.5:totalDps*0.8,
      snapshotSha:snap,reportCode,fightId,encounterId,difficulty}};
});

test('fully witnessed 100 ranks produces original rank 1/30/100 & top-30/100 semantics',()=>{
  const rows=make();
  const result=summarizeJobSnapshot(rows);
  assert.equal(result.status,'EXACT100');
  assert.equal(result.verifiedRanks,100);
  assert.equal(result.totalDpsMetrics[0],rows[0].totalDps);
  assert.equal(result.totalDpsMetrics[1],rows[29].totalDps);
  assert.equal(result.totalDpsMetrics[2],rows[99].totalDps);
  assert.equal(result.bossDpsMetrics[1],rows[29].proof.bossDps);
  const sum=(arr)=>arr.reduce((a,b)=>a+b,0);
  const top30=rows.slice(0,30);
  const expectedRatio=(sum(top30.map(x=>x.totalDps))-sum(top30.map(x=>x.proof.bossDps)))/
    sum(top30.map(x=>x.totalDps));
  assert.equal(result.nonBossShare[3],Math.round(expectedRatio*1e6)/1e6);
  // Mean of individual shares is a different, invalid KPI definition.
  const meanOfRatios=top30.reduce((a,x)=>a+(x.totalDps-x.proof.bossDps)/x.totalDps,0)/30;
  assert.notEqual(result.nonBossShare[3],Math.round(meanOfRatios*1e6)/1e6);
});
test('missing a rank-31 witness does not invalidate top-30, but top-100 stays null',()=>{
  const rows=make();rows[30].proof=null;
  const x=summarizeJobSnapshot(rows);
  assert.equal(x.status,'PARTIAL');
  assert.equal(x.verifiedRanks,99);
  assert.notEqual(x.nonBossShare[3],null);
  assert.equal(x.nonBossShare[4],null);
  assert.equal(x.bossDpsMetrics[4],null);
  assert.equal(x.nonBossShare[0]!==null&&x.nonBossShare[1]!==null,true);
});
test('missing rank 30 only nulls unavailable individual and aggregate metrics',()=>{
  const rows=make();rows[29].proof=null;
  const x=summarizeJobSnapshot(rows);
  assert.equal(x.nonBossShare[1],null);
  assert.equal(x.nonBossShare[3],null);
  assert.equal(x.nonBossShare[4],null);
  assert.notEqual(x.nonBossShare[2],null);
});
test('the boss DPS labeled rank 30 belongs to total-DPS rank 30, not a boss leaderboard',()=>{
  const rows=make();
  rows[29].proof.bossDps=0;
  const x=summarizeJobSnapshot(rows);
  assert.equal(x.bossDpsMetrics[1],0);
  assert.equal(x.nonBossShare[1],1);
});
test('reject duplicate rank, snapshot drift and job mixing',()=>{
  const rows=make();rows[0].rank=2;
  assert.throws(()=>summarizeJobSnapshot(rows),/RANK_GAP_OR_DUPLICATE/);
  const drift=make();drift[50].snapshotSha='b'.repeat(64);
  assert.throws(()=>summarizeJobSnapshot(drift),/JOB_SNAPSHOT_DRIFT/);
  const mixed=make();mixed[51].jobKey='different';
  assert.throws(()=>summarizeJobSnapshot(mixed),/JOB_SNAPSHOT_DRIFT/);
});
test('reject unsourced proof, foreign fight and boss DPS beyond total',()=>{
  for (const change of [
    p=>{p.proofType='GUESSED';},
    p=>{p.fightId=999;},
    p=>{p.snapshotSha='b'.repeat(64);},
    p=>{p.bossDps=999999;}
  ]) {
    const rows=make();change(rows[0].proof);
    assert.throws(()=>summarizeJobSnapshot(rows),/PROOF_SCOPE_OR_AMOUNT_INVALID/);
  }
});
test('read-only deterministic output never mutates its source',()=>{
  const rows=make();
  const before=JSON.stringify(rows);
  assert.deepEqual(summarizeJobSnapshot([...rows].reverse()),summarizeJobSnapshot(rows));
  assert.equal(JSON.stringify(rows),before);
});
