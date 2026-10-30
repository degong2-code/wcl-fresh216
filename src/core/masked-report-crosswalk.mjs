/**
 * Read-only proof boundary for A-ranked masked actors.
 *
 * Never joins a BossDPS leaderboard row to an Anonymous A slot. Only a
 * same-report, same-fight *paired* official TotalDPS and BossDPS ranking
 * response can establish actor equivalence. Existing joinFightEvidence
 * checks unique TotalDPS amount (<= .005 discrepancy), class/spec, the two
 * fight scopes, and a stable actor reference shared by both rosters.
 *
 * This module does not fetch, write, publish, or mutate a C checkpoint.
 */
import {createHash} from 'node:crypto';
import {joinFightEvidence} from './evidence-join.mjs';

const text=x=>String(x??'').trim().toLowerCase();
const masked=x=>!text(x)||text(x)==='anonymous'||/^player\s*\(\d+\)$/.test(text(x));
const stableActorRef=r=>/^id:[1-9]\d*$/.test(r)||
  /^name:player\s*\([1-9]\d*\)$/.test(r);
const sha=o=>createHash('sha256').update(JSON.stringify(o)).digest('hex');
const key=s=>JSON.stringify([s.jobKey,s.rank,s.snapshotSha]);

/**
 * @param {object} group a frozen FetchPlan fight group with source A slots
 * @param {object} report one already authenticated report with overall + boss
 * @returns {{status:string,verified:Array,unresolved:Array,reason:string}}
 *   candidate-only proof rows. Persistence requires independent private audit.
 */
export function crosswalkMaskedReportFight(group,report) {
  if(!group||!Array.isArray(group.slots)||!group.slots.length)
    throw Error('MASKED_REPORT_GROUP_INVALID');
  const pending=group.slots.filter(s=>masked(s?.name));
  const reason='OFFLINE_REPORT_DUAL_RANKINGS_ONLY';
  if(!pending.length)return {status:'NO_MASKED_SLOTS',
    verified:[],unresolved:[],reason};
  const missing=()=>pending.map(s=>({
    jobKey:s.jobKey,rank:s.rank,snapshotSha:s.snapshotSha
  }));
  if(!report||report.code!==group.reportCode||
      !Number.isSafeInteger(report.revision)||report.revision<0||
      group.reportRevision!=null&&group.reportRevision!==report.revision)
    return {status:'REPORT_IDENTITY_UNVERIFIED',verified:[],
      unresolved:missing(),reason};
  // A scoped, content-addressed receipt: a digest is NOT a substitute
  // for validating the upstream official response in the private collector.
  const evidenceSha256=sha([group.reportCode,report.revision,group.fightId,
    group.encounterId,group.difficulty,report.overall,report.boss]);
  const joined=joinFightEvidence(group,report);
  const source=new Map(pending.map(s=>[key(s),s]));
  const candidates=joined.verified.filter(v=>source.has(key(v))&&
    stableActorRef(v?.proof?.actorRef)&&
    Number.isFinite(source.get(key(v))?.startTime)&&
    source.get(key(v)).startTime>0);
  // One actor identity may not satisfy two different A ranked slots,
  // even when both share the same rounded TotalDPS.
  const actorClaims=new Map();
  for(const v of candidates){
    const ref=v.proof.actorRef;
    actorClaims.set(ref,(actorClaims.get(ref)||0)+1);
  }
  const verified=candidates.filter(v=>actorClaims.get(v.proof.actorRef)===1)
    .map(v=>({...v,proof:{...v.proof,
      discovery:{kind:'REPORT_DUAL_RANKINGS_MASKED',evidenceSha256}
    }}));
  const accepted=new Set(verified.map(key));
  return {status:verified.length===pending.length?'ALL_MASKED_VERIFIED':
      verified.length?'PARTIAL_MASKED_VERIFIED':'NO_MASKED_PROOFS',
    reason,verified,unresolved:missing().filter(s=>!accepted.has(key(s)))};
}
