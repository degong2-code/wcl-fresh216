import {planAdaptive216} from './adaptive-depth-plan.mjs';
import {planReportWaves} from './report-wave-plan.mjs';
import {registerPlan,readyFetches,committedProofs,
  checkpointStats} from './checkpoint.mjs';
import {registerRankBatch,readyRankBatches,
  committedRankingEvidence} from './rank-batch-checkpoint.mjs';
import {executeOneRankBatch} from './rank-batch-runner.mjs';
import {executeOneReportWave} from './report-wave-runner.mjs';
import {calibrateAdaptiveEconomics} from './observed-cost-calibration.mjs';

const check=(v,c)=>{if(!v)throw Error(c);};
const id=s=>JSON.stringify([s.jobKey,s.rank,s.snapshotSha]);
const groupKey=g=>JSON.stringify([g.scopeKey,g.reportCode,g.fightId,
  g.encounterId,g.difficulty,g.reportRevision??null]);
const sameProof=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

/**
 * A deterministic, one-operation-at-a-time Full216 host boundary.
 * A real caller supplies the SAME durable store and injects authorized
 * transports. No GitHub Actions, credentials, secrets, timers, file writer or
 * WCL live activation is created here.
 */
export function prepareAdaptiveNext({slots,state,economics=null,
  batchPages=3,recentPages=3}={}){
  check(state?.schema===1&&Array.isArray(slots)&&
    slots.length===21600,'COLLECTOR_INPUT_INVALID');
  const stats=checkpointStats(state);
  if(state.status!=='ACTIVE')return {kind:'NOT_ACTIVE',stats};
  if(stats.counts.NEEDS_REVIEW||stats.counts.IN_FLIGHT||
     stats.pointsUnobserved)return {kind:'NEEDS_REVIEW',stats};
  // Requests previously registered are resumed BEFORE planning new ones.
  const readyRank=readyRankBatches(state);
  if(readyRank.length)return {kind:'RANK_BATCH',request:readyRank[0],stats,
    resumed:true};
  const readyReport=readyFetches(state);
  if(readyReport.length){
    const waves=planReportWaves({groups:readyReport}).waves;
    return {kind:'REPORT_WAVE',wave:waves[0],stats,resumed:true};
  }
  const all=new Map();
  for(const p of committedProofs(state)){
    const k=id(p);
    check(!all.has(k)||sameProof(all.get(k),p.proof),
      'COLLECTOR_PROOF_CONFLICT');
    all.set(k,p.proof);
  }
  const updated=slots.map(s=>{
    const proof=all.get(id(s));
    if(!proof)return s;
    if(s.status==='VERIFIED'){
      check(sameProof(s.proof,proof),'COLLECTOR_SOURCE_PROOF_CONFLICT');
      return s;
    }
    check(s.status==='PENDING','COLLECTOR_SLOT_STATUS_INVALID');
    return {...s,status:'VERIFIED',proof};
  });
  const calibration=calibrateAdaptiveEconomics(state);
  const plan=planAdaptive216(updated,{
    pageEvidence:committedRankingEvidence(state),
    economics:economics??calibration.economics,batchPages,recentPages
  });
  const nextRank=plan.rankingCandidates[0];
  if(nextRank){
    const jobSlots=updated.filter(s=>s.scopeKey===nextRank.scopeKey&&
      s.jobKey===nextRank.jobKey);
    check(jobSlots.length===100,'COLLECTOR_JOB_ROWS_INVALID');
    const first=jobSlots[0];
    const {encounterId,difficulty,className,specName,filter}=first;
    // Immutable date filter is provided by the owner/source manifest
    // (never silently default to current/global).
    check(typeof filter==='string'&&/^date\.\d+\.\d+$/.test(filter),
      'COLLECTOR_FILTER_MISSING');
    return {kind:'RANK_BATCH',resumed:false,calibration,stats,
      request:{scopeKey:first.scopeKey,jobKey:first.jobKey,
        snapshotSha:first.snapshotSha,encounterId,difficulty,
        className,specName,filter,
        firstPage:nextRank.nextPages[0],
        pageCount:nextRank.nextPages.length,slots:jobSlots}};
  }
  // Do not re-register a previously charged or partially completed fight.
  const unregistered=plan.reportNowGroups.filter(g=>
    !Object.hasOwn(state.entries,groupKey(g)));
  if(unregistered.length){
    const wave=planReportWaves({groups:unregistered}).waves[0];
    return {kind:'REPORT_WAVE',resumed:false,wave,stats,calibration,
      groups:unregistered};
  }
  return {kind:plan.pendingRankSlots===0?'COMPLETE':'NO_SAFE_PENDING_REQUESTS',
    remainingRanks:plan.pendingRankSlots,stats,calibration};
}
/**
 * Explicit authorized step. Preview is the default and NEVER mutates state.
 * Even in execute mode an owner-injected policy and transport are required.
 */
export async function runOneAdaptiveStep({
  slots,store,mode='preview',approved=false,
  rankTransport,reportTransport,admissionPolicy=null,
  economics=null,batchPages=3,recentPages=3,clock=Date.now
}={}){
  check(store&&typeof store.read==='function'&&
    typeof store.update==='function','COLLECTOR_STORE_REQUIRED');
  const next=prepareAdaptiveNext({slots,state:store.read(),economics,
    batchPages,recentPages});
  if(mode==='preview')return {status:'PREVIEW',kind:next.kind,
    nextPage:next.request?.firstPage??null,
    nextPageCount:next.request?.pageCount??0,
    nextReportFights:next.wave?.fightGroups?.length??0,
    remainingRanks:next.remainingRanks??null,
    calibration:next.calibration??null};
  check(mode==='execute'&&approved===true&&
    admissionPolicy&&typeof rankTransport==='function'&&
    typeof reportTransport==='function',
    'COLLECTOR_PAID_EXECUTION_NOT_AUTHORIZED');
  if(!['RANK_BATCH','REPORT_WAVE'].includes(next.kind))
    return {status:next.kind,attempted:false};
  if(next.kind==='RANK_BATCH'){
    if(!next.resumed)store.update(s=>registerRankBatch(s,next.request));
    const req=next.resumed?next.request:readyRankBatches(store.read())
      .find(r=>r.jobKey===next.request.jobKey&&
        r.firstPage===next.request.firstPage);
    check(req,'COLLECTOR_REGISTER_RANK_FAILED');
    const out=await executeOneRankBatch({store,request:req,
      transport:rankTransport,clock,admissionPolicy});
    return {kind:'RANK_BATCH',...out};
  }
  if(!next.resumed)store.update(s=>registerPlan(s,next.groups));
  const ready=readyFetches(store.read());
  const wave=planReportWaves({groups:ready}).waves[0];
  check(wave,'COLLECTOR_REGISTER_REPORT_FAILED');
  const out=await executeOneReportWave({store,wave,
    transport:reportTransport,clock,admissionPolicy});
  return {kind:'REPORT_WAVE',...out};
}
