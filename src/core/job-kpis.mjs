/**
 * Deterministic snapshot KPI projection. Input proofs must already have passed
 * same-fight/actor validation; this module never fetches or infers BossDPS.
 * Returns null (not estimates) for any partial Top-30/Top-100 metric.
 */
const fail = (message) => { throw new Error(message); };
const isSha = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/i.test(v);
const avg = (numbers) => numbers.reduce((a,b) => a+b,0)/numbers.length;
const round6 = (value) => Math.round(value*1e6)/1e6;

export function summarizeJobSnapshot(rankSlots) {
  if (!Array.isArray(rankSlots) || rankSlots.length !== 100) fail('EXACT100_RANKS_REQUIRED');
  const slots = [...rankSlots].sort((a,b)=>(a?.rank??0)-(b?.rank??0));
  const first=slots[0];
  if (!first || !first.jobKey || !first.scopeKey || !isSha(first.snapshotSha))
    fail('SNAPSHOT_IDENTITY');
  let verified=0;
  const values=[];
  for(let i=0;i<100;i++){
    const s=slots[i];
    if (!s || s.rank!==i+1) fail('RANK_GAP_OR_DUPLICATE');
    if (s.jobKey!==first.jobKey || s.scopeKey!==first.scopeKey ||
        s.snapshotSha!==first.snapshotSha) fail('JOB_SNAPSHOT_DRIFT');
    if (!Number.isFinite(s.totalDps) || s.totalDps<=0) fail('TOTAL_DPS_INVALID');
    if (!s.reportCode || !Number.isSafeInteger(s.fightId) || s.fightId<=0 ||
        !Number.isSafeInteger(s.encounterId) || s.encounterId<=0 ||
        !Number.isSafeInteger(s.difficulty) || s.difficulty<=0)
      fail('FIGHT_IDENTITY_MISSING');
    let boss=null;
    if (s.proof != null) {
      const p=s.proof;
      if (p.proofType!=='EXACT_SAME_FIGHT_ACTOR' || typeof p.actorRef!=='string' ||
          !p.actorRef || !Number.isFinite(p.bossDps) ||
          p.bossDps<0 || p.bossDps>s.totalDps ||
          p.snapshotSha!==s.snapshotSha || p.reportCode!==s.reportCode ||
          p.fightId!==s.fightId || p.encounterId!==s.encounterId ||
          p.difficulty!==s.difficulty)
        fail('PROOF_SCOPE_OR_AMOUNT_INVALID');
      boss=p.bossDps;verified++;
    }
    values.push({total:s.totalDps,boss});
  }
  const meanBoss=n=>values.slice(0,n).every(x=>x.boss!==null)
    ?avg(values.slice(0,n).map(x=>x.boss)):null;
  const meanTotal=n=>avg(values.slice(0,n).map(x=>x.total));
  const totalDpsMetrics=[
    values[0].total,values[29].total,values[99].total,meanTotal(30),meanTotal(100)
  ];
  const bossDpsMetrics=[
    values[0].boss,values[29].boss,values[99].boss,meanBoss(30),meanBoss(100)
  ];
  const fraction=(total,boss)=>boss===null?null:round6((total-boss)/total);
  const nonBossShare=totalDpsMetrics.map((d,i)=>fraction(d,bossDpsMetrics[i]));
  return {
    scopeKey:first.scopeKey,jobKey:first.jobKey,snapshotSha:first.snapshotSha,
    verifiedRanks:verified,status:verified===100?'EXACT100':'PARTIAL',
    totalDpsMetrics,bossDpsMetrics,nonBossShare
  };
}
