/**
 * Two-call named C recovery pilot: immutable TotalDPS and BossDPS snapshot,
 * single official Boss page2 followed by a DIFFERENT Report / two Fight wave.
 * No WCL requests here. Candidates never imply expected yield or point cost.
 */
import {exportVerifiedFreshCohort,makeFreshDatedHeroicManifest}
  from './fresh-cohort-source.mjs';
import {committedProofs} from './checkpoint.mjs';
import {committedRankingEvidence} from './rank-batch-checkpoint.mjs';
import {planAdaptive216} from './adaptive-depth-plan.mjs';
import {planNamedRecoveryEconomics} from './fresh-c-recovery-economics.mjs';
import {planReportWaves} from './report-wave-plan.mjs';
import {inspectFreshDpsPipeline} from './fresh-dps-pipeline.mjs';

const need=(v,code)=>{if(!v)throw Error(code);};
const slotKey=s=>JSON.stringify([s.jobKey,s.rank,s.snapshotSha]);
const count=w=>w.fightGroups.reduce((n,g)=>n+g.slots.length,0);
const noOverlap=(wave,jobKey)=>wave.fightGroups.every(g=>
  g.slots.every(s=>s.jobKey!==jobKey));
const identity=w=>JSON.stringify([w.reportCode,w.reportRevision??null,
  w.fightGroups.map(g=>g.fightId)]);

export function planFreshNamedCPilot(state){
  const summary=inspectFreshDpsPipeline(state);
  need(summary.stage==='RECOVERY_REVIEW'&&
    summary.summary?.bossJobsCompleted===216&&
    summary.summary?.sourceJobs===216&&
    summary.summary?.bossRankRows===21600,
    'C_PILOT_SOURCE_NOT_COMPLETE_OR_UNSAFE');
  need(Object.values(state.rankRequests??{}).length===0&&
    Object.values(state.entries??{}).length===0,
    'C_PILOT_HAS_PREVIOUS_PAID_RECOVERY');
  const source=exportVerifiedFreshCohort(state,
    makeFreshDatedHeroicManifest(state.scopeKey));
  const proofs=new Map();
  for(const row of committedProofs(state)){
    const k=slotKey(row);
    need(!proofs.has(k),'C_PILOT_PROOF_COLLISION');
    proofs.set(k,row.proof);
  }
  const augmented=source.slots.map(s=>{
    const p=proofs.get(slotKey(s));
    return p?{...s,status:'VERIFIED',proof:p}:s;
  });
  const adaptive=planAdaptive216(augmented,{
    pageEvidence:committedRankingEvidence(state)
  });
  const portfolio=planNamedRecoveryEconomics(adaptive,{
    pilotFights:2
  });
  const rank=portfolio.rankPilot;
  need(rank?.observedFirstPage===1&&rank.nextPage===2,
    'C_PILOT_RANK_PAGE2_NOT_AVAILABLE');
  const original=source.slots.filter(s=>s.jobKey===rank.jobKey)
    .sort((a,b)=>a.rank-b.rank);
  need(original.length===100&&original[0].snapshotSha===rank.snapshotSha,
    'C_PILOT_RANK_SOURCE_DRIFT');
  const rankRequest={
    scopeKey:state.scopeKey,jobKey:rank.jobKey,
    snapshotSha:rank.snapshotSha,firstPage:2,pageCount:1,
    encounterId:original[0].encounterId,
    difficulty:original[0].difficulty,
    className:original[0].className,specName:original[0].specName,
    filter:original[0].filter,slots:original
  };
  const waves=planReportWaves({
    groups:adaptive.reportNowGroups
  },{maxFightsPerWave:2}).waves
    .filter(w=>w.fightGroups.length===2&&noOverlap(w,rank.jobKey))
    .sort((a,b)=>count(b)-count(a)||
      identity(a).localeCompare(identity(b)));
  const reportWave=waves[0]??null;
  need(reportWave&&reportWave.fightGroups.length===2&&
    reportWave.fightGroups.every(g=>
      g.slots.every(s=>s.name&&
        !/^anonymous$|^player\s*\(\d+\)$/i.test(s.name))),
    'C_PILOT_REPORT_DISJOINT_NAMED_WAVE_MISSING');
  return {
    status:'NOT_AUTHORIZED',
    rankRequest,
    reportWave,
    summary:{
      baselineSameFight:summary.summary.sameFightProofs,
      baselineNamedMissing:summary.summary.remainingNamed,
      baselineMaskedMissing:summary.summary.remainingMasked,
      rankCandidateSingletonUpperBound:
        rank.singletonFightUpperBound,
      rankRequestPages:1,
      reportFightCount:2,
      reportPendingRankReferences:count(reportWave),
      reportQueryAliases:4,
      candidateFightOverlap:false,
      observedRank2Points:null,
      observedReportPoints:null,
      observedIncrementalProofs:null,
      userApprovalRequired:true
    }
  };
}
