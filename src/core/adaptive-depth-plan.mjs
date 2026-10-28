import {planFull216} from './full-scope-plan.mjs';
import {planReportWaves} from './report-wave-plan.mjs';

// Pure 216-job decision planner. No transport, tokens, durable writes, or auto-dispatch.
const check=(v,c)=>{if(!v)throw Error(c);};
const named=n=>typeof n==='string'&&n.trim()&&n.trim().toLowerCase()!=='anonymous'&&!/^player\s*\(\d+\)$/i.test(n.trim());
const positive=n=>typeof n==='number'&&Number.isFinite(n)&&n>0;
const jk=s=>JSON.stringify([s.scopeKey,s.jobKey]);
const fk=g=>JSON.stringify([g.scopeKey,g.reportCode,g.fightId,g.encounterId,g.difficulty,g.reportRevision??null]);

export function planAdaptive216(slots,{pageEvidence=[],economics=null,batchPages=3,recentPages=3}={}){
  check(Number.isSafeInteger(batchPages)&&batchPages>=1&&batchPages<=10&&
    Number.isSafeInteger(recentPages)&&recentPages>=1&&recentPages<=10,'ADAPTIVE_WINDOWS_INVALID');
  check(economics===null||(positive(economics?.rankingPointsPerPage)&&
    positive(economics?.reportPointsPerFight)),'ADAPTIVE_ECONOMICS_INVALID');
  const full=planFull216(slots),jobs=new Map(),evidence=new Map();
  for(const s of slots){
    const k=jk(s);
    if(!jobs.has(k))jobs.set(k,{scopeKey:s.scopeKey,jobKey:s.jobKey,
      snapshotSha:s.snapshotSha,ranks:new Map(),namedPending:0,
      anonymousPending:0,singleton:0,rankEligible:0});
    const j=jobs.get(k);j.ranks.set(s.rank,s);
    if(s.status==='PENDING'){
      if(named(s.name)){
        j.namedPending++;
        if(Number.isSafeInteger(s.reportRevision)&&s.reportRevision>=0)
          j.rankEligible++;
      }else j.anonymousPending++;
    }
  }
  for(const g of full.groups)if(g.slots.length===1&&named(g.slots[0].name))
    jobs.get(jk({scopeKey:g.scopeKey,jobKey:g.slots[0].jobKey})).singleton++;
  check(Array.isArray(pageEvidence),'ADAPTIVE_EVIDENCE_INVALID');
  for(const item of pageEvidence){
    const k=jk(item??{}),j=jobs.get(k);
    check(j&&item.snapshotSha===j.snapshotSha&&Array.isArray(item.pages),
      'ADAPTIVE_EVIDENCE_SNAPSHOT_OR_JOB');
    check(!evidence.has(k),'ADAPTIVE_EVIDENCE_DUPLICATE_JOB');
    const seen=new Set();
    item.pages.forEach((p,i)=>{
      check(p?.page===i+1&&['OK','UNAVAILABLE'].includes(p.status)&&
        Array.isArray(p.newVerifiedRanks),'ADAPTIVE_PAGE_SEQUENCE');
      check(p.status==='OK'?
        Number.isSafeInteger(p.rowCount)&&p.rowCount>=0&&p.rowCount<=100&&
          p.newVerifiedRanks.length<=p.rowCount:
        p.rowCount==null&&p.newVerifiedRanks.length===0,'ADAPTIVE_PAGE_SHAPE');
      if(i<item.pages.length-1)check(p.status==='OK'&&p.rowCount===100,
        'ADAPTIVE_AFTER_TERMINAL');
      for(const rank of p.newVerifiedRanks){
        const s=j.ranks.get(rank);
        check(Number.isInteger(rank)&&rank>=1&&rank<=100&&!seen.has(rank),
          'ADAPTIVE_DUPLICATE_RANK');
        seen.add(rank);
        check(s?.status==='VERIFIED'&&
          s.proof?.proofType==='EXACT_SAME_FIGHT_ACTOR'&&
          s.proof?.discovery?.kind==='BOSSDPS_RANKING_PAGE'&&
          s.proof?.discovery?.page===p.page,
          'ADAPTIVE_UNVERIFIED_PAGE_GAIN');
      }
    });
    evidence.set(k,item.pages);
  }
  const decisions=[],candidate=new Set();
  for(const [k,j] of [...jobs].sort((a,b)=>a[0].localeCompare(b[0]))){
    const pages=evidence.get(k)??[],last=pages.at(-1);
    let reason='REPORT_FALLBACK',nextPages=[],economy=null;
    if(!j.namedPending)reason=j.anonymousPending?'ANONYMOUS_REPORT':'ALREADY_VERIFIED';
    else if(last&&(last.status==='UNAVAILABLE'||last.rowCount<100||
      last.hasMorePages===false))
      reason='WCL_PAGINATION_ENDED';
    else if(!j.rankEligible)reason='RANK_PROOF_REVISION_UNAVAILABLE';
    else if(!j.singleton)reason='REPORT_ALREADY_SHARED';
    else if(!last){
      reason='FIRST_PAGE_CANDIDATE';
      nextPages=Array.from({length:batchPages},(_,i)=>i+1);
    }else if(!economics)reason='COST_NOT_MEASURED';
    else{
      const tail=pages.slice(-recentPages);
      const gained=tail.reduce((n,p)=>n+p.newVerifiedRanks.length,0);
      const expected=Math.min(j.namedPending,gained/tail.length*batchPages);
      // Only globally singleton pending fights can be avoided by one
      // additional named ranking match; shared fights/Anonymous are not.
      const avoidedUpper=Math.min(j.singleton,expected);
      const rankingPoints=economics.rankingPointsPerPage*batchPages;
      const savedUpper=avoidedUpper*economics.reportPointsPerFight;
      economy={observedGains:gained,recentPages:tail.length,expectedMatches:expected,
        avoidableReportFightsUpperBound:avoidedUpper,
        estimatedRankingPoints:rankingPoints,estimatedReportPointsSavedUpperBound:savedUpper,
        estimatedNotActual:true};
      if(savedUpper>rankingPoints){
        reason='MARGINAL_RANKING_CANDIDATE';
        nextPages=Array.from({length:batchPages},(_,i)=>last.page+i+1);
      }else reason='MARGINAL_STOP_FOR_REPORT';
    }
    if(nextPages.length)candidate.add(k);
    decisions.push({scopeKey:j.scopeKey,jobKey:j.jobKey,
      snapshotSha:j.snapshotSha,pendingNamed:j.namedPending,
      pendingAnonymous:j.anonymousPending,verifiedReused:100-j.namedPending-j.anonymousPending,
      lastObservedPage:last?.page??0,nextPages,reason,economy});
  }
  const reportKeys=new Set();
  const forced=g=>g.slots.some(s=>!named(s.name)||!candidate.has(jk({scopeKey:g.scopeKey,jobKey:s.jobKey})));
  for(const g of full.groups)if(forced(g))reportKeys.add(fk(g));
  // If ALL a job's pending named slots are already covered by mandatory
  // Report fetches, suppress its redundant page request.
  let changed=true;
  while(changed){
    changed=false;
    for(const d of decisions){
      const k=jk(d);if(!candidate.has(k))continue;
      const related=full.groups.filter(g=>g.scopeKey===d.scopeKey&&
        g.slots.some(s=>s.jobKey===d.jobKey));
      if(related.every(g=>reportKeys.has(fk(g)))){
        candidate.delete(k);d.nextPages=[];d.reason='COVERED_BY_REPORT';changed=true;
      }
    }
    if(changed)for(const g of full.groups)if(forced(g))reportKeys.add(fk(g));
  }
  const reportNow=[],reportDeferred=[];
  for(const g of full.groups)(reportKeys.has(fk(g))?reportNow:reportDeferred).push(g);
  const waves=planReportWaves({groups:reportNow});
  return {scopeKey:full.scopeKey,jobs:216,rankSlots:21600,
    verifiedSlotsReused:full.verifiedSlotsSkipped,pendingRankSlots:full.pendingRankSlots,
    pendingDistinctReportFights:full.pendingDistinctReportFights,
    rankingCandidates:decisions.filter(d=>d.nextPages.length),jobDecisions:decisions,
    reportNowGroups:reportNow,reportDeferredGroups:reportDeferred,
    reportWaveCandidates:waves.waves,reportWaveJournalRequired:waves.waveJournalRequired,
    readyForAutomaticDispatch:false,actualPointSavings:null};
}
