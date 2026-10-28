import test from 'node:test';
import assert from 'node:assert/strict';
import {planAdaptive216} from '../src/core/adaptive-depth-plan.mjs';
const SHA='a'.repeat(64);
function scope({shared=false,anonymous=false}={}){
 const rows=[];
 for(let boss=0;boss<8;boss++)for(let spec=0;spec<27;spec++)
 for(let rank=1;rank<=100;rank++)rows.push({
   scopeKey:'heroic:offline',jobKey:`Boss${boss}|C${spec}|S${spec}`,
   rank,snapshotSha:SHA,status:'PENDING',
   className:'C'+spec,specName:'S'+spec,totalDps:10000-rank,
   reportCode:shared?'R'+boss:'R'+boss+'_'+spec,
   fightId:rank,encounterId:3470+boss,difficulty:4,reportRevision:2,
   name:anonymous&&boss===0&&spec===0&&rank===1?'Anonymous':'Actor'+rank
 });
 return rows;
}
function evidence(row,pages){
 return {scopeKey:row.scopeKey,jobKey:row.jobKey,
   snapshotSha:row.snapshotSha,pages};
}
function proof(row,page){
 return {proofType:'EXACT_SAME_FIGHT_ACTOR',actorRef:'id:'+row.rank,
   bossDps:row.totalDps/2,snapshotSha:row.snapshotSha,
   reportCode:row.reportCode,reportRevision:row.reportRevision,
   fightId:row.fightId,encounterId:row.encounterId,
   difficulty:row.difficulty,
   discovery:{kind:'BOSSDPS_RANKING_PAGE',page}};
}
const money={rankingPointsPerPage:1,reportPointsPerFight:4};

test('full 216-job scope proposes initial cached-evidence-first discovery without a rank ceiling',()=>{
 const p=planAdaptive216(scope(),{economics:money});
 assert.equal(p.jobs,216);assert.equal(p.rankSlots,21600);
 assert.equal(p.pendingDistinctReportFights,21600);
 assert.equal(p.rankingCandidates.length,216);
 assert.deepEqual(p.rankingCandidates[0].nextPages,[1,2,3]);
 assert.equal(p.reportNowGroups.length,0);
 assert.equal(p.readyForAutomaticDispatch,false);
});
test('cross-spec same report/fight grouping avoids 216 unnecessary ranking streams',()=>{
 const p=planAdaptive216(scope({shared:true}),{economics:money});
 assert.equal(p.pendingDistinctReportFights,800);
 assert.equal(p.rankingCandidates.length,0);
 assert.equal(p.reportNowGroups.length,800);
 assert.equal(p.reportWaveJournalRequired,false);
});
test('only attributed exact proof counts toward marginal rank-page ROI',()=>{
 const rows=scope(),row=rows[0];
 for(const rank of [1,2,3,4,5,6,7,8]){
   const s=rows[rank-1];s.status='VERIFIED';s.proof=proof(s,rank<=6?1:2);
 }
 const e=evidence(row,[
   {page:1,status:'OK',rowCount:100,newVerifiedRanks:[1,2,3,4,5,6]},
   {page:2,status:'OK',rowCount:100,newVerifiedRanks:[7,8]}
 ]);
 const p=planAdaptive216(rows,{economics:money,pageEvidence:[e],batchPages:2});
 const d=p.jobDecisions.find(x=>x.jobKey===row.jobKey);
 assert.equal(p.verifiedSlotsReused,8);
 assert.equal(d.verifiedReused,8);
 assert.equal(d.reason,'MARGINAL_RANKING_CANDIDATE');
 assert.deepEqual(d.nextPages,[3,4]);
 assert.equal(d.economy.observedGains,8);
 assert.equal(d.economy.estimatedNotActual,true);
});
test('zero recent same-fight recoveries stops further paid ranking candidates',()=>{
 const rows=scope(),row=rows[0];
 const pages=[1,2,3,4,5].map(page=>({
   page,status:'OK',rowCount:100,newVerifiedRanks:[]}));
 const p=planAdaptive216(rows,{economics:money,pageEvidence:[evidence(row,pages)]});
 const d=p.jobDecisions.find(x=>x.jobKey===row.jobKey);
 assert.equal(d.reason,'MARGINAL_STOP_FOR_REPORT');
 assert.deepEqual(d.nextPages,[]);
 assert.equal(p.reportNowGroups.filter(g=>g.slots[0].jobKey===row.jobKey).length,100);
});
test('Anonymous is never dropped and its fight is Report-ready',()=>{
 const p=planAdaptive216(scope({anonymous:true}),{economics:money});
 assert.equal(p.reportNowGroups.length,1);
 assert.equal(p.reportNowGroups[0].slots[0].name,'Anonymous');
 assert.equal(p.reportDeferredGroups.length,21599);
 assert.equal(p.rankingCandidates.length,216);
});
test('WCL terminal and short pages end ranking with no invented rank2000 cap',()=>{
 const rows=scope(),a=rows[0],b=rows[100];
 const e=[evidence(a,[
    {page:1,status:'OK',rowCount:100,newVerifiedRanks:[]},
    {page:2,status:'UNAVAILABLE',newVerifiedRanks:[]}
   ]),evidence(b,[{page:1,status:'OK',rowCount:50,newVerifiedRanks:[]}])];
 const p=planAdaptive216(rows,{economics:money,pageEvidence:e});
 for(const row of [a,b]){
   const d=p.jobDecisions.find(x=>x.jobKey===row.jobKey);
   assert.equal(d.reason,'WCL_PAGINATION_ENDED');
 }
});
test('forged page gains and inconsistent page/snapshot data are rejected',()=>{
 const rows=scope(),row=rows[0];
 const e=evidence(row,[{page:1,status:'OK',rowCount:100,newVerifiedRanks:[1]}]);
 assert.throws(()=>planAdaptive216(rows,{pageEvidence:[e],economics:money}),
   /ADAPTIVE_UNVERIFIED_PAGE_GAIN/);
 rows[0].status='VERIFIED';rows[0].proof=proof(rows[0],2);
 assert.throws(()=>planAdaptive216(rows,{pageEvidence:[e],economics:money}),
   /ADAPTIVE_UNVERIFIED_PAGE_GAIN/);
 const empty=evidence(row,[{page:1,status:'OK',rowCount:100,newVerifiedRanks:[]}]);
 assert.throws(()=>planAdaptive216(rows,{pageEvidence:[empty,empty]}),
   /ADAPTIVE_EVIDENCE_DUPLICATE_JOB/);
 assert.throws(()=>planAdaptive216(rows,{pageEvidence:[{...empty,snapshotSha:'b'.repeat(64)}]}),
   /ADAPTIVE_EVIDENCE_SNAPSHOT_OR_JOB/);
});
test('no observed cost never pretends economic savings or permits late ranking',()=>{
 const rows=scope(),row=rows[0],e=evidence(row,[
   {page:1,status:'OK',rowCount:100,newVerifiedRanks:[]}]);
 const p=planAdaptive216(rows,{pageEvidence:[e]});
 assert.equal(p.jobDecisions.find(x=>x.jobKey===row.jobKey).reason,'COST_NOT_MEASURED');
 assert.equal(p.actualPointSavings,null);
 assert.throws(()=>planAdaptive216(rows,{economics:{
  rankingPointsPerPage:0,reportPointsPerFight:4}}),/ADAPTIVE_ECONOMICS_INVALID/);
});
