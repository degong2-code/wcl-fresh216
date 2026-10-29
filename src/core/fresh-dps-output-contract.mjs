/**
 * Fresh216 final DPS data contract.
 *
 * THREE INDEPENDENT DATASETS:
 *   A: immutable official TotalDPS top100 by TotalDPS rank
 *   B: official BossDPS top100 by its OWN BossDPS rank
 *   C: official BossDPS for each A-ranked actor's SAME report/fight
 *
 * U:Y uses A+C only. BossDPS-ranked RAW metrics use B only.
 * This pure module does not fetch WCL, persist data or touch Sheets.
 */
import {createHash} from 'node:crypto';
import {summarizeJobSnapshot} from './job-kpis.mjs';

const need=(ok,code)=>{if(!ok)throw Error(code);};
const sha256=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const sha=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const number=x=>typeof x==='number'&&Number.isFinite(x);
const norm=x=>String(x??'').trim().toLowerCase();
const masked=x=>!norm(x)||norm(x)==='anonymous'||
  /^player\s*\(\d+\)$/.test(norm(x));
const avg=xs=>xs.reduce((n,x)=>n+x,0)/xs.length;
const five=xs=>[xs[0],xs[29],xs[99],avg(xs.slice(0,30)),avg(xs)];

/**
 * Official BossDPS leaderboard is not the same as the BossDPS of the
 * TotalDPS-ranked characters. Even an empty BossDPS page is not zero.
 * Null means exact top100 is missing; no rank substitution or estimates.
 */
function officialBossRankedMetrics(page,jobKey,snapshotSha){
  if(page===null)return {status:'NOT_COLLECTED',rankedMetrics:
    [null,null,null,null,null],rankingSha:null,rankingRows:0};
  need(page&&page.jobKey===jobKey&&page.snapshotSha===snapshotSha&&
    Array.isArray(page.rankings)&&page.rankings.length<=100&&
    page.rankingsStatus===(page.rankings.length===100?'EXACT100':'PARTIAL')&&
    sha(page.bossRankingSha)&&page.bossRankingSha===sha256(page.rankings),
    'DPS_BOSS_RANKING_WITNESS_INVALID');
  const amounts=page.rankings.map(r=>Number(r?.amount));
  need(page.rankings.every(r=>r&&r.amount!==''&&r.amount!==null)&&
    amounts.every(v=>Number.isFinite(v)&&v>=0)&&
    amounts.every((v,i)=>i===0||v<=amounts[i-1]),
    'DPS_BOSS_RANKING_AMOUNT_OR_ORDER_INVALID');
  return {status:page.rankingsStatus,
    rankedMetrics:amounts.length===100?five(amounts):
      [null,null,null,null,null],
    rankingSha:page.bossRankingSha,rankingRows:amounts.length};
}

/** Verify every attribution against the frozen TotalDPS rank identity. */
function withExactProofs(slots,proofRows){
  need(Array.isArray(proofRows),'DPS_PROOFS_INVALID');
  const index=new Map(slots.map(s=>[s.rank,s]));
  const attached=new Map();
  for(const row of proofRows){
    const s=index.get(row?.rank),p=row?.proof;
    need(s&&row.jobKey===s.jobKey&&row.snapshotSha===s.snapshotSha&&
      !attached.has(row.rank),'DPS_PROOF_RANK_OR_SNAPSHOT_DRIFT');
    need(p?.proofType==='EXACT_SAME_FIGHT_ACTOR'&&
      typeof p.actorRef==='string'&&p.actorRef.length>0&&
      number(p.bossDps)&&p.bossDps>=0&&p.bossDps<=s.totalDps&&
      p.snapshotSha===s.snapshotSha&&p.reportCode===s.reportCode&&
      p.fightId===s.fightId&&p.encounterId===s.encounterId&&
      p.difficulty===s.difficulty&&
      (p.reportRevision==null||s.reportRevision==null||
        p.reportRevision===s.reportRevision)&&
      (p.sourceStartTime==null||p.sourceStartTime===s.startTime),
      'DPS_PROOF_FIGHT_ACTOR_INVALID');
    // A global name, a different fight, or a masked name does not identify
    // the same WCL actor. The upstream decoder also proves unique name.
    if(p.discovery?.kind==='BOSSDPS_RANKING_PAGE'){
      need(!masked(s.name)&&p.actorRef==='name:'+norm(s.name)&&
        p.sourceStartTime===s.startTime,
        'DPS_RANKING_PAGE_ACTOR_INVALID');
    }
    if(s.reportRevision==null&&p.reportRevision==null)
      need(p.sourceStartTime===s.startTime,
        'DPS_REVISIONLESS_START_TIME_REQUIRED');
    attached.set(row.rank,p);
  }
  return slots.map(s=>({...s,status:attached.has(s.rank)?'VERIFIED':'PENDING',
    proof:attached.get(s.rank)??null}));
}

/**
 * Maps to one 216-row RAW output, but contains NO Sheets I/O.
 * bossRankedDpsMetrics is independent BossDPS rank 1,30,100,top30,top100.
 * totalRankJoinedBossDpsMetrics uses TotalDPS rank 1,30,100,top30,top100.
 * U:Y uses TotalDPS and totalRankJoinedBossDpsMetrics ONLY.
 */
export function summarizeFreshDpsJob({
  totalRankSlots,bossPage=null,verifiedProofs=[]
}={}){
  need(Array.isArray(totalRankSlots)&&totalRankSlots.length===100,
    'DPS_TOTAL_TOP100_REQUIRED');
  const slots=totalRankSlots.slice().sort((a,b)=>a.rank-b.rank);
  const first=slots[0];
  need(first&&sha(first.snapshotSha)&&
    slots.every((s,i)=>s.rank===i+1&&s.jobKey===first.jobKey&&
      s.scopeKey===first.scopeKey&&s.snapshotSha===first.snapshotSha),
    'DPS_TOTAL_SNAPSHOT_OR_RANK_DRIFT');
  const joined=withExactProofs(slots,verifiedProofs);
  const sourceKpis=summarizeJobSnapshot(joined);
  const independent=officialBossRankedMetrics(
    bossPage,first.jobKey,first.snapshotSha);
  return {
    schema:1,scopeKey:first.scopeKey,jobKey:first.jobKey,
    snapshotSha:first.snapshotSha,
    proofOrigin:'NEW_SAME_FIGHT_ACTOR',
    status:sourceKpis.status,verifiedRanks:sourceKpis.verifiedRanks,
    bossRankingStatus:independent.status,
    bossRankingSnapshotSha:independent.rankingSha,
    bossRankingRows:independent.rankingRows,
    totalDpsMetrics:sourceKpis.totalDpsMetrics,
    bossRankedDpsMetrics:independent.rankedMetrics,
    totalRankJoinedBossDpsMetrics:sourceKpis.bossDpsMetrics,
    nonBossShare:sourceKpis.nonBossShare
  };
}
