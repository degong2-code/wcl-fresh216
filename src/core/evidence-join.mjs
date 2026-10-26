import {resolveExactBossDps} from './resolve-proof.mjs';

/**
 * Join one ALREADY-FETCHED report/fight response to pending ranks.
 * Does not call WCL, publish Sheets, cache, or transform missing proofs into zero.
 * Exact WCL data shape remains subject to LIVE equivalence validation.
 *
 * Expected response {code,revision,overall:{data:[...]},boss:{data:[...]}}.
 * The response must identify its own report; callers must not trust array position.
 */
export function joinFightEvidence(group, report) {
  if (!group || !Array.isArray(group.slots) || !group.slots.length)
    throw new Error('GROUP_SHAPE');
  const unresolved = group.slots.map(s=>({jobKey:s.jobKey,rank:s.rank,snapshotSha:s.snapshotSha}));
  const failClosed = (reason) => ({reason,verified:[],unresolved});
  if (!report || report.code !== group.reportCode ||
      !Number.isInteger(report.revision) || report.revision < 0)
    return failClosed('REPORT_IDENTITY_UNCONFIRMED');
  if (group.reportRevision != null && group.reportRevision !== report.revision)
    return failClosed('REPORT_REVISION_DRIFT');
  const verified=[],missing=[];
  for(const s of group.slots){
    const witness=resolveExactBossDps({
      ...s,reportCode:group.reportCode,fightId:group.fightId,
      encounterId:group.encounterId,difficulty:group.difficulty
    },report);
    if(!witness){
      missing.push({jobKey:s.jobKey,rank:s.rank,snapshotSha:s.snapshotSha});
      continue;
    }
    verified.push({
      jobKey:s.jobKey,rank:s.rank,
      proof:{
        ...witness,snapshotSha:s.snapshotSha,reportCode:group.reportCode,
        fightId:group.fightId,encounterId:group.encounterId,
        difficulty:group.difficulty,reportRevision:report.revision
      }
    });
  }
  return {reason:missing.length?'PARTIAL_ACTOR_PROOF':'EXACT_ACTOR_PROOFS',
    verified,unresolved:missing};
}
