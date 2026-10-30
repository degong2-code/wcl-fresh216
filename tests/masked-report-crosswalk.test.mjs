import test from 'node:test';
import assert from 'node:assert/strict';
import {crosswalkMaskedReportFight} from '../src/core/masked-report-crosswalk.mjs';
import {summarizeFreshDpsJob} from '../src/core/fresh-dps-output-contract.mjs';

const scopeKey='heroic:synthetic',jobKey='Synthetic|Hunter|Marksmanship';
const snapshotSha='a'.repeat(64);
const sourceRows=()=>Array.from({length:100},(_,i)=>({
  scopeKey,jobKey,rank:i+1,snapshotSha,name:'Named'+(i+1),
  status:'PENDING',totalDps:3000-i*10,reportCode:'OTHER'+i,
  reportRevision:9,fightId:i+100,encounterId:3470,difficulty:4,
  className:'Hunter',specName:'Marksmanship',startTime:1792594801000+i*1000
}));
function setMasked(rows,rank=1,changes={}){
  Object.assign(rows[rank-1],{name:'Anonymous',reportCode:'EXAMPLE',fightId:12,
    totalDps:1000,reportRevision:9,...changes});
  return rows[rank-1];
}
const roster=(characters)=>({
  fightID:12,encounter:{id:3470},difficulty:4,roles:{dps:{characters}}
});
const actor=(id=7,name='Player (4)',amount=1000,opts={})=>({
  id,name,amount,class:'Hunter',spec:'Marksmanship',...opts
});
const report=(overall=[actor()],boss=[actor(7,'Player (4)',700)],extra={})=>({
  code:'EXAMPLE',revision:9,overall:{data:[roster(overall)]},
  boss:{data:[roster(boss)]},...extra
});
const group=(slots)=>({
  scopeKey,reportCode:'EXAMPLE',reportRevision:9,fightId:12,
  encounterId:3470,difficulty:4,slots
});
const run=(changes={})=>{
  const rows=sourceRows(),s=setMasked(rows,1,changes);
  return {rows,s,result:crosswalkMaskedReportFight(group([s]),report())};
};
test('only paired same-fight Total and Boss actor yields masked witness',()=>{
  const {rows,result}=run();
  assert.equal(result.status,'ALL_MASKED_VERIFIED');
  assert.equal(result.verified.length,1);
  assert.equal(result.unresolved.length,0);
  assert.equal(result.verified[0].proof.actorRef,'id:7');
  assert.equal(result.verified[0].proof.bossDps,700);
  assert.equal(result.verified[0].proof.discovery.kind,
    'REPORT_DUAL_RANKINGS_MASKED');
  assert.match(result.verified[0].proof.discovery.evidenceSha256,/^[a-f0-9]{64}$/);
  const kpi=summarizeFreshDpsJob({totalRankSlots:rows,
    verifiedProofs:result.verified});
  assert.equal(kpi.verifiedRanks,1);
  assert.equal(kpi.nonBossShare[0],0.3);
  assert.equal(kpi.nonBossShare[3],null);
  assert.equal(kpi.nonBossShare[4],null);
  assert.equal(kpi.bossRankedDpsMetrics[0],null);
});
test('official stable Player(n) label can bridge when both IDs missing',()=>{
  const rows=sourceRows(),s=setMasked(rows);
  const r=report([actor(null,'Player (4)')],[actor(null,'Player (4)',700)]);
  const found=crosswalkMaskedReportFight(group([s]),r);
  assert.equal(found.verified[0].proof.actorRef,'name:player (4)');
  assert.equal(summarizeFreshDpsJob({totalRankSlots:rows,
    verifiedProofs:found.verified}).nonBossShare[0],.3);
});
test('ordinary B-ranking / empty actor identity never proves masked A rank',()=>{
  const {rows,result}=run();
  const w=structuredClone(result.verified[0]);
  for(const discovery of [
    {kind:'BOSSDPS_RANKING_PAGE',page:1},
    {kind:'REPORT_DUAL_RANKINGS_MASKED',evidenceSha256:'unverified'},
    null
  ]){
    w.proof.discovery=discovery;
    assert.throws(()=>summarizeFreshDpsJob({totalRankSlots:rows,
      verifiedProofs:[w]}),/DPS_MASKED_OR_COLLIDING_ACTOR/);
  }
  const anonymous=report([actor(null,'Anonymous')],[actor(null,'Anonymous',700)]);
  const noKey=crosswalkMaskedReportFight(group([rows[0]]),anonymous);
  assert.equal(noKey.verified.length,0);
});
test('report revision, report identity, fight, encounter and difficulty must match',()=>{
  const {s}=run();
  for(const bad of [
    report(undefined,undefined,{code:'OTHER'}),
    report(undefined,undefined,{revision:10}),
    report(undefined,undefined,{revision:null})
  ]){
    assert.equal(crosswalkMaskedReportFight(group([s]),bad).verified.length,0);
  }
  for(const mutate of [
    r=>r.overall.data[0].fightID=20,
    r=>r.boss.data[0].fightID=20,
    r=>r.overall.data[0].encounter.id=99,
    r=>r.boss.data[0].difficulty=5
  ]){
    const bad=report();mutate(bad);
    assert.equal(crosswalkMaskedReportFight(group([s]),bad).verified.length,0);
  }
});
test('wrong same-fight total, class/spec, or stable actor rejects',()=>{
  const {s}=run();
  for(const bad of [
    report([actor(7,'Player (4)',1001)]),
    report([actor(7,'Player (4)',1000,{class:'Mage'})]),
    report([actor(7,'Player (4)',1000,{spec:'Survival'})]),
    report(undefined,[actor(8,'Player (4)',700)]),
    report(undefined,[actor(7,'Player (4)',1100)])
  ]){
    assert.equal(crosswalkMaskedReportFight(group([s]),bad).verified.length,0);
  }
});
test('duplicate candidate Total DPS or Boss actor refuses guessing',()=>{
  const {s}=run();
  for(const bad of [
    report([actor(),actor(8,'Player (5)')]),
    report(undefined,[actor(7,'Player (4)',700),actor(7,'Player (4)',699)])
  ]){
    assert.equal(crosswalkMaskedReportFight(group([s]),bad).verified.length,0);
  }
});
test('two masked A ranks cannot claim same report/fight actor',()=>{
  const rows=sourceRows(),a=setMasked(rows);
  const b=setMasked(rows,2);
  const result=crosswalkMaskedReportFight(group([a,b]),report());
  assert.equal(result.verified.length,0);
  assert.equal(result.unresolved.length,2);
});
test('fixed Player(n) source label cannot silently become another actor label',()=>{
  const rows=sourceRows(),s=setMasked(rows,1,{name:'Player (3)'});
  assert.equal(crosswalkMaskedReportFight(group([s]),report()).verified.length,0);
});
test('unverified masked proof never affects U:Y even if B page contains same name',()=>{
  const rows=sourceRows();setMasked(rows);
  const summary=summarizeFreshDpsJob({totalRankSlots:rows});
  assert.equal(summary.totalDpsMetrics[0],1000);
  assert.equal(summary.bossRankedDpsMetrics[0],null);
  assert.equal(summary.nonBossShare[0],null);
});
