import test from 'node:test';
import assert from 'node:assert/strict';
import {planFreshUyPriority} from '../src/core/fresh-c-uy-priority.mjs';

const SHA='a'.repeat(64),START=1792600000000;
const slotId=s=>JSON.stringify([s.jobKey,s.rank,s.snapshotSha]);
function source(){
  const out=[];
  for(let boss=0;boss<8;boss++)for(let spec=0;spec<27;spec++)
  for(let rank=1;rank<=100;rank++){
    const encounterId=3470+boss;
    const jobKey='Boss'+boss+'|Class'+spec+'|Spec'+spec;
    const row={scopeKey:'heroic:synthetic',jobKey,rank,
      snapshotSha:SHA,encounterId,difficulty:4,
      className:'Class'+spec,specName:'Spec'+spec,
      reportCode:'R'+boss+'_'+spec+'_'+rank,
      fightId:rank,reportRevision:5,startTime:START+rank,
      name:'Actor'+rank,totalDps:90000-rank,
      status:'VERIFIED'};
    row.proof={proofType:'EXACT_SAME_FIGHT_ACTOR',
      actorRef:'name:'+row.name.toLowerCase(),
      snapshotSha:SHA,reportCode:row.reportCode,
      fightId:row.fightId,encounterId,difficulty:4,
      reportRevision:5,sourceStartTime:row.startTime,
      bossDps:row.totalDps/2,
      discovery:{kind:'BOSSDPS_RANKING_PAGE',page:1}};
    out.push(row);
  }
  return out;
}
const mark=(row,name)=>{row.status='PENDING';row.proof=null;
  if(name!==undefined)row.name=name;};
const target=(rows,spec,rank)=>rows.find(s=>
  s.jobKey==='Boss0|Class'+spec+'|Spec'+spec&&s.rank===rank);
const groupKey=(s)=>JSON.stringify([
 s.scopeKey,s.reportCode,s.fightId,s.encounterId,
 s.difficulty,s.reportRevision??null
]);
test('verified 216x100 makes 1080 U:Y cells, zero paid work',()=>{
  const p=planFreshUyPriority(source());
  assert.equal(p.sourceJobs,216);
  assert.equal(p.rankSlots,21600);
  assert.equal(p.currentUyCells,1080);
  assert.equal(p.additionalUyCellsConditionalUpper,0);
  assert.equal(p.namedPendingRanks,0);
  assert.equal(p.sortedFightCandidates.length,0);
  assert.equal(p.paidRequestsAuthorized,false);
});
test('single ranks and top30/top100 closure are separately counted',()=>{
  const rows=source();
  const a1=target(rows,0,1),a2=target(rows,0,2);
  mark(a1);mark(a2);
  a2.reportCode=a1.reportCode;a2.fightId=a1.fightId;
  mark(target(rows,0,100),'Anonymous');
  const b30=target(rows,1,30);mark(b30);
  const p=planFreshUyPriority(rows);
  assert.equal(p.currentUyCells,1073);
  assert.equal(p.additionalUyCellsConditionalUpper,5);
  assert.equal(p.maximumUyCellsUnderAnonymousExclusion,1078);
  assert.equal(p.namedPendingRanks,3);
  assert.equal(p.maskedPendingRanks,1);
  assert.equal(p.jobsBlockedFromTop100ByMasked,1);
  assert.equal(p.namedMissingAtRanks1_30_100,2);
  assert.equal(p.oneFightTop30ClosureCandidates,2);
  assert.equal(p.oneFightTop100ClosureCandidates,1);
  assert.equal(p.fightPreview[0].conditionalCellsUpper,3);
  assert.equal(p.fightPreview[0].immediateSingleCellsUpper,1);
  assert.equal(p.fightPreview[0].top30OneFightClosureUpper,1);
  assert.equal(p.fightPreview[0].top100OneFightClosureUpper,1);
  assert.equal(p.fightPreview[1].conditionalCellsUpper,2);
  assert.equal(p.fightPreview[1].namedReferences,2);
  assert.equal(p.guaranteedAdditionalCells,0);
  assert.equal(p.pointCostForecast,null);
  assert.equal(p.top30CompletionTargets[0].distinctReportFights,1);
});
test('spent Report fight is never a paid target or closure candidate',()=>{
  const rows=source();
  const s=target(rows,0,30);mark(s);
  const p=planFreshUyPriority(rows,{
    spentReportFightKeys:[groupKey(s)]
  });
  assert.equal(p.namedPendingRanks,1);
  assert.equal(p.spentReportFightsExcluded,1);
  assert.equal(p.spentNamedReferencesExcluded,1);
  assert.equal(p.sortedFightCandidates.length,0);
  assert.equal(p.oneFightTop30ClosureCandidates,0);
  assert.equal(p.namedMissingAtRanks1_30_100,0);
  assert.equal(p.top30CompletionTargets.length,0);
  assert.equal(p.additionalUyCellsConditionalUpper,3);
});
test('two fights needed for top30: no false one-fight completion',()=>{
  const rows=source();mark(target(rows,0,1));mark(target(rows,0,2));
  const p=planFreshUyPriority(rows);
  assert.equal(p.namedPendingRanks,2);
  assert.equal(p.oneFightTop30ClosureCandidates,0);
  assert.equal(p.top30CompletionTargets[0].distinctReportFights,2);
  assert(p.fightPreview.every(x=>x.top30OneFightClosureUpper===0));
});
test('rejects invalid fixed cohort, duplicate spent keys and bad bounds',()=>{
  assert.throws(()=>planFreshUyPriority(source().slice(1)),
    /SCOPE_EXACT_21600_REQUIRED/);
  const rows=source(),s=target(rows,0,1);mark(s);
  assert.throws(()=>planFreshUyPriority(rows,{
    spentReportFightKeys:[groupKey(s),groupKey(s)]
  }),/UY_PRIORITY_CONFIG_INVALID/);
  assert.throws(()=>planFreshUyPriority(rows,{previewCount:100}),
    /UY_PRIORITY_CONFIG_INVALID/);
});
