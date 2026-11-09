/**
 * P0: ONE read-only integration boundary from a durable A source checkpoint
 * into the EXISTING three-family KPI contract (A independent B and exact C).
 *
 * The caller supplies only ALREADY-COMMITTED/ATTESTED BossDPS leaderboard
 * rows and exact same-fight actor proof rows. This does not fetch WCL, synthesize
 * C, publish Sheets, or claim a partial cohort is complete.
 */
import {projectCompletedFreshCohort}
  from './fresh-cohort-source.mjs';
import {summarizeFreshDpsJob}
  from './fresh-dps-output-contract.mjs';

const need=(v,c)=>{if(!v)throw Error(c);};
const jobOf=row=>row?.jobKey;

/**
 * A job's boss page is B-ranked, and its C proof rows are A-ranked.
 * These inputs are intentionally separate. A caller must read them from a
 * previously validated checkpoint/immutable witness, not untrusted web text.
 */
export function inspectFresh216EngineContract({
  sourceState,manifest,bossPages=[],proofRows=[],includeOutputs=false
}={}){
  need(sourceState&&manifest&&
    Array.isArray(bossPages)&&Array.isArray(proofRows)&&
    typeof includeOutputs==='boolean',
    'ENGINE_CONTRACT_INPUT_INVALID');
  const source=projectCompletedFreshCohort(sourceState,manifest);
  const jobs=new Map();
  for(const slot of source.slots){
    let group=jobs.get(slot.jobKey);
    if(!group){group=[];jobs.set(slot.jobKey,group);}
    group.push(slot);
  }
  const pages=new Map(),proofs=new Map();
  for(const page of bossPages){
    const key=jobOf(page);
    need(typeof key==='string'&&jobs.has(key)&&!pages.has(key),
      'ENGINE_CONTRACT_BOSS_JOB_UNKNOWN_OR_DUPLICATE');
    pages.set(key,page);
  }
  const claimed=new Set();
  for(const row of proofRows){
    const key=jobOf(row),slotKey=JSON.stringify([
      key,row?.rank,row?.snapshotSha
    ]);
    need(typeof key==='string'&&jobs.has(key)&&
      Number.isSafeInteger(row.rank)&&row.rank>=1&&row.rank<=100&&
      !claimed.has(slotKey),'ENGINE_CONTRACT_PROOF_UNKNOWN_OR_DUPLICATE');
    claimed.add(slotKey);
    if(!proofs.has(key))proofs.set(key,[]);
    proofs.get(key).push(row);
  }
  const outputs=[];
  let linked=0,bossRows=0,completeBossJobs=0,nonBossCells=0;
  for(const [key,slots] of jobs){
    // Uses the one existing exact A/B/C KPI validator. Tampering with a
    // snapshot, B rank SHA or C fight identity fails here, not downstream.
    const o=summarizeFreshDpsJob({
      totalRankSlots:slots,bossPage:pages.get(key)??null,
      verifiedProofs:proofs.get(key)??[]
    });
    outputs.push(o);
    linked+=o.verifiedRanks;
    bossRows+=o.bossRankingRows;
    if(o.bossRankingStatus==='EXACT100')completeBossJobs++;
    nonBossCells+=o.nonBossShare.filter(Number.isFinite).length;
  }
  need(outputs.length===source.summary.jobsCompleted&&
    linked<=source.summary.rankSlotsCompleted,
    'ENGINE_CONTRACT_COMPLETION_MISMATCH');
  const summary={
    scopeKey:manifest.scopeKey,
    sourceStatus:source.summary.status,
    sourceJobsCompleted:source.summary.jobsCompleted,
    sourceJobsRequired:source.summary.jobsRequired,
    sourceRankRows:source.summary.rankSlotsCompleted,
    sourceRankRowsRequired:source.summary.rankSlotsRequired,
    sourceRequestsCompleted:source.summary.requestsCompleted,
    sourceRequestsRequired:source.summary.requestsRequired,
    sourceNextBatchIndex:source.summary.nextBatchIndex,
    sourceJobsPerRequest:source.summary.jobsPerRequest,
    bossJobsExact100:completeBossJobs,
    bossRankRows:bossRows,exactSameFightRanks:linked,
    nonBossMetricCells:nonBossCells,
    unverifiedRankRows:source.summary.rankSlotsCompleted-linked,
    computedJobOutputs:outputs.length,
    totalJobsComplete:source.summary.status==='SOURCE_COMPLETE',
    endToEndComplete:source.summary.status==='SOURCE_COMPLETE'&&
      completeBossJobs===216&&linked===21600
  };
  const result={kind:summary.endToEndComplete?'ENGINE_KPI_COMPLETE':
    summary.totalJobsComplete?'B_C_EVIDENCE_PENDING':'A_SOURCE_PARTIAL',
    safeToPublish:summary.endToEndComplete,summary};
  if(includeOutputs)result.outputs=outputs;
  return result;
}
