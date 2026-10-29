/**
 * Private-cohort-aware, pure planner for a bounded BossDPS page4+5 wave.
 * A and independent B page1 remain immutable. No transport or side effects.
 */
import {makeFreshDatedHeroicManifest,exportVerifiedFreshCohort}
  from './fresh-cohort-source.mjs';
import {committedProofs,checkpointStats} from './checkpoint.mjs';
import {committedRankingEvidence} from './rank-batch-checkpoint.mjs';

const ensure=(v,c)=>{if(!v)throw Error(c);};
const SCOPE='heroic:2026-10-22_27:latest:source';
const SOURCE='7b1a075ad2663c8aa07734b7733cbe81bf9c6071';
const masked=n=>!String(n??'').trim()||
  /^anonymous$/i.test(String(n).trim())||
  /^player\s*\(\d+\)$/i.test(String(n).trim());
const slotKey=s=>JSON.stringify([s.jobKey,s.rank,s.snapshotSha]);

/**
 * Select at most maxRequests page4+5 queries from jobs with an observed
 * page3 match, named gaps and a full nonterminal third page.
 * Successful page3 is an ordering proxy, NOT a page4 success guarantee.
 */
export function planFreshBossThrough500(state,{maxRequests=16,includeZeroPage3=false}={}){
  ensure(Number.isSafeInteger(maxRequests)&&maxRequests>=1&&
    maxRequests<=180,'DEPTH500_MAX_REQUESTS_INVALID');
  ensure(state?.schema===1&&state.status==='ACTIVE'&&
    state.scopeKey===SCOPE&&state.sourceCodeCommit===SOURCE,
    'DEPTH500_SOURCE_PIN_DRIFT');
  const stats=checkpointStats(state);
  ensure(!stats.counts.IN_FLIGHT&&!stats.counts.NEEDS_REVIEW&&
    !stats.pointsUnobserved,'DEPTH500_UNRESOLVED_ATTEMPT');
  const source=exportVerifiedFreshCohort(state,
    makeFreshDatedHeroicManifest(SCOPE));
  ensure(source.summary.jobs===216&&source.slots.length===21600,
    'DEPTH500_SOURCE_NOT_EXACT100');
  const boss=Object.values(state.bossPageRequests??{});
  ensure(boss.length===32&&boss.every(e=>e.status==='COMPLETED'&&
    Array.isArray(e.result?.jobs)),'DEPTH500_BOSS_PAGE1_INCOMPLETE');
  const witnesses=committedRankingEvidence(state);
  ensure(witnesses.length===216,'DEPTH500_BOSS_EVIDENCE_INCOMPLETE');
  ensure(typeof includeZeroPage3==='boolean','DEPTH500_ZERO_GAIN_CONFIG_INVALID');
  const proofKeys=new Set(committedProofs(state).map(slotKey));
  const byJob=new Map();
  for(const s of source.slots){
    if(!byJob.has(s.jobKey))byJob.set(s.jobKey,[]);
    byJob.get(s.jobKey).push(s);
  }
  const byEvidence=new Map(witnesses.map(e=>[e.jobKey,e]));
  const eligible=[];
  let eligibleNamed=0,skipNoPage3Gain=0,skipTerminal=0,
      skipNotAtPage3=0,skipNoNamed=0;
  for(const [jobKey,rows] of byJob){
    rows.sort((a,b)=>a.rank-b.rank);
    ensure(rows.length===100&&rows.every((r,i)=>r.rank===i+1),
      'DEPTH500_ORIGINAL_RANKS_CHANGED');
    const witness=byEvidence.get(jobKey);
    ensure(witness?.snapshotSha===rows[0].snapshotSha&&
      witness.pages[0]?.page===1&&witness.pages[0]?.rowCount===100,
      'DEPTH500_BOSS_EVIDENCE_DRIFT');
    const last=witness.pages.at(-1);
    if(last.page!==3){skipNotAtPage3++;continue;}
    if(last.status!=='OK'||last.rowCount!==100||
      last.hasMorePages===false){skipTerminal++;continue;}
    const named=rows.filter(s=>!proofKeys.has(slotKey(s))&&!masked(s.name));
    if(!named.length){skipNoNamed++;continue;}
    if(!Array.isArray(last.newVerifiedRanks))
      throw Error('DEPTH500_PAGE3_GAIN_SHAPE_INVALID');
    if(last.newVerifiedRanks.length===0&&!includeZeroPage3){
      skipNoPage3Gain++;continue;
    }
    const singles=named.filter(s=>[1,30,100].includes(s.rank)).length;
    const top30=named.filter(s=>s.rank<=30).length;
    const page3Gains=last.newVerifiedRanks.length;
    const first=rows[0];
    const priority=page3Gains*1000+singles*100+
      (top30>0&&top30<=2?50:0)+Math.min(named.length,100);
    eligible.push({scopeKey:SCOPE,jobKey,encounterId:first.encounterId,
      difficulty:first.difficulty,className:first.className,
      specName:first.specName,snapshotSha:first.snapshotSha,
      filter:first.filter,firstPage:4,pageCount:2,slots:rows,
      namedMissing:named.length,top30Missing:top30,
      missingSingles:singles,page3Gains,priority});
    eligibleNamed+=named.length;
  }
  ensure(byJob.size===216&&
    eligible.length+skipNoPage3Gain+skipTerminal+
    skipNotAtPage3+skipNoNamed===216,'DEPTH500_COVERAGE_DRIFT');
  eligible.sort((a,b)=>b.priority-a.priority||
    b.page3Gains-a.page3Gains||a.jobKey.localeCompare(b.jobKey));
  return {status:'OFFLINE_DEPTH500_WAVE_NOT_AUTHORIZED',
    eligibleJobs:eligible.length,eligibleNamed,includeZeroPage3,
    skipNoPage3Gain,skipTerminal,skipNotAtPage3,skipNoNamed,
    selectedJobs:Math.min(maxRequests,eligible.length),
    plannedPageAliases:Math.min(maxRequests,eligible.length)*2,
    requests:eligible.slice(0,maxRequests),
    officialSourceRows:21600,independentBossRows:21600,
    currentSameFightProofs:proofKeys.size,
    actualNewWclRequests:0,googleSheetsWrites:0};
}
