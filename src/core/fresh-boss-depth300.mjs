/**
 * Offline, checkpoint-aware BossDPS 101..300 expansion.
 * Every job uses the original immutable date filter, TotalDPS snapshot and
 * official Boss page1. No WCL/HTTP here; a later explicit private GitHub
 * approval may activate one already journalled request at a time.
 */
import {makeFreshDatedHeroicManifest,exportVerifiedFreshCohort}
  from './fresh-cohort-source.mjs';
import {committedProofs,checkpointStats} from './checkpoint.mjs';
import {committedRankingEvidence} from './rank-batch-checkpoint.mjs';

const need=(v,c)=>{if(!v)throw Error(c);};
const masked=n=>!String(n??'').trim()||
  /^anonymous$/i.test(n.trim())||
  /^player\s*\(\d+\)$/i.test(n.trim());
const slotKey=s=>JSON.stringify([s.jobKey,s.rank,s.snapshotSha]);
const sourceCommit='7b1a075ad2663c8aa07734b7733cbe81bf9c6071';
const scopeKey='heroic:2026-10-22_27:latest:source';
const terminal=p=>p.status==='UNAVAILABLE'||p.rowCount<100||
  p.hasMorePages===false;

/** All paid ranks are additional pages; page1 is never re-requested. */
export function planFreshBossThrough300(state){
  need(state?.schema===1&&state.status==='ACTIVE'&&
    state.scopeKey===scopeKey&&state.sourceCodeCommit===sourceCommit,
    'DEPTH300_SOURCE_PIN_DRIFT');
  const stats=checkpointStats(state);
  need(!stats.counts.IN_FLIGHT&&!stats.counts.NEEDS_REVIEW&&
    !stats.pointsUnobserved,'DEPTH300_UNRESOLVED_PAID_ATTEMPT');
  const source=exportVerifiedFreshCohort(state,
    makeFreshDatedHeroicManifest(scopeKey));
  need(source.slots.length===21600&&source.summary.jobs===216,
    'DEPTH300_ORIGINAL_SOURCE_INCOMPLETE');
  const boss=Object.values(state.bossPageRequests??{});
  need(boss.length===32&&boss.every(e=>
    e.status==='COMPLETED'&&e.result?.jobs?.length>0),
    'DEPTH300_OFFICIAL_BOSS100_INCOMPLETE');
  const rankEvidence=committedRankingEvidence(state);
  need(rankEvidence.length===216,'DEPTH300_BOSS_PAGE1_EVIDENCE_INCOMPLETE');
  const proofMap=new Map();
  for(const p of committedProofs(state)){
    const k=slotKey(p),v=proofMap.get(k);
    need(!v||JSON.stringify(v)===JSON.stringify(p.proof),
      'DEPTH300_CONFLICTING_PROOF');
    proofMap.set(k,p.proof);
  }
  const byJob=new Map();
  for(const s of source.slots){
    const rows=byJob.get(s.jobKey)??[];
    rows.push(s);byJob.set(s.jobKey,rows);
  }
  const evidence=new Map(rankEvidence.map(x=>[x.jobKey,x]));
  const requests=[];
  let namedRemaining=0,maskedRemaining=0,alreadyAt300=0,
      stoppedTerminal=0,noNamedRemaining=0,plannedPages=0,
      earlierCompletedPage2=0,emptyPage2=0;
  for(const [jobKey,rows] of byJob){
    rows.sort((a,b)=>a.rank-b.rank);
    need(rows.length===100&&rows.every((r,i)=>r.rank===i+1),
      'DEPTH300_JOB_SOURCE_DRIFT');
    const proof=rows.map(s=>proofMap.has(slotKey(s)));
    const missing=rows.filter((s,i)=>!proof[i]);
    const named=missing.filter(s=>!masked(s.name));
    namedRemaining+=named.length;maskedRemaining+=missing.length-named.length;
    const e=evidence.get(jobKey),pages=e?.pages;
    need(e&&e.snapshotSha===rows[0].snapshotSha&&
      pages?.[0]?.page===1&&pages[0].status==='OK'&&
      pages[0].rowCount===100,'DEPTH300_PAGE1_WITNESS_DRIFT');
    const last=pages.at(-1);
    if(pages.some(p=>p.page===2))earlierCompletedPage2++;
    if(pages.some(p=>p.page===2&&p.newVerifiedRanks.length===0))emptyPage2++;
    if(last.page>=3){alreadyAt300++;continue;}
    if(terminal(last)){stoppedTerminal++;continue;}
    if(!named.length){noNamedRemaining++;continue;}
    const firstPage=last.page+1,pageCount=4-firstPage;
    need(firstPage===2&&pageCount===2||
      firstPage===3&&pageCount===1,
      'DEPTH300_PAGE_BOUND_INVALID');
    const first=rows[0];
    const sources={
      scopeKey,jobKey,encounterId:first.encounterId,
      difficulty:first.difficulty,className:first.className,
      specName:first.specName,snapshotSha:first.snapshotSha,
      filter:first.filter,firstPage,pageCount,slots:rows
    };
    const singles=named.filter(x=>[1,30,100].includes(x.rank)).length;
    const top30=named.filter(x=>x.rank<=30).length;
    const top100= named.length;
    // Priority only changes order, never excludes a qualifying job.
    const priority=singles*10000+(top30<=2&&top30>0?5000:0)+
      top100*10+Math.min(top30,30);
    requests.push({...sources,priority,missingNamed:named.length,
      top30MissingNamed:top30,missingSingles:singles});
    plannedPages+=pageCount;
  }
  requests.sort((a,b)=>b.priority-a.priority||
    b.missingNamed-a.missingNamed||a.jobKey.localeCompare(b.jobKey));
  need(requests.length+alreadyAt300+stoppedTerminal+noNamedRemaining===216,
    'DEPTH300_JOB_COVERAGE_INVALID');
  return {status:'OFFLINE_DEPTH300_PLAN_NOT_AUTHORIZED',
    jobs:216,originalTotalRows:21600,originalBossRows:21600,
    alreadyVerifiedSameFight:proofMap.size,
    namedRemaining,maskedRemaining,
    candidateJobs:requests.length,candidateAdditionalPages:plannedPages,
    previouslyVisitedPage2Jobs:earlierCompletedPage2,
    zeroGainPage2Jobs:emptyPage2,alreadyAt300,stoppedTerminal,
    noNamedRemaining,
    requests,
    googleSheetsWrites:0,actualNewWclCalls:0,authorizationRequired:true
  };
}
