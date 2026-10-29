/**
 * Fresh216 C recovery priority for U:Y completion. Entirely OFFLINE.
 * An unverified Report actor is never a BossDPS value; all gains below
 * are conditional upper bounds if every selected same-fight proof succeeds.
 * Original A ranks are immutable; Anonymous stays missing under owner policy.
 */
import {planFull216} from './full-scope-plan.mjs';

const need=(x,code)=>{if(!x)throw Error(code);};
const masked=s=>!String(s??'').trim()||
  /^anonymous$/i.test(s.trim())||
  /^player\s*\(\d+\)$/i.test(s.trim());
const key=g=>JSON.stringify([g.scopeKey,g.reportCode,g.fightId,
  g.encounterId,g.difficulty,g.reportRevision??null]);
const slotKey=s=>JSON.stringify([s.jobKey,s.rank,s.snapshotSha]);
const compare=(a,b)=>b.score-a.score||
  b.namedReferences-a.namedReferences||a.groupKey.localeCompare(b.groupKey);
const fiveAvailable=(rows)=>[
  rows[0].status==='VERIFIED',
  rows[29].status==='VERIFIED',
  rows[99].status==='VERIFIED',
  rows.slice(0,30).every(s=>s.status==='VERIFIED'),
  rows.every(s=>s.status==='VERIFIED')
];
const fiveEligible=(rows)=>[
  !masked(rows[0].name),
  !masked(rows[29].name),
  !masked(rows[99].name),
  rows.slice(0,30).every(s=>!masked(s.name)),
  rows.every(s=>!masked(s.name))
];
const aggregate=(arr)=>arr.reduce((a,b)=>a+b,0);

/**
 * @param {Array} slots - 21600 original TotalDPS ranks, each PENDING or
 *  VERIFIED with a separately attested SAME-FIGHT BossDPS proof.
 * @param {Array<string>} spentReportFightKeys - attempted official Report
 *  fight identities from the shared private checkpoint. Never replay them.
 */
export function planFreshUyPriority(slots,{
  spentReportFightKeys=[],previewCount=12,top30TargetLimit=12
}={}){
  const full=planFull216(slots);
  need(full.difficulty===4&&
    Number.isInteger(previewCount)&&previewCount>=0&&previewCount<=50&&
    Number.isInteger(top30TargetLimit)&&top30TargetLimit>=0&&
    top30TargetLimit<=50&&Array.isArray(spentReportFightKeys)&&
    spentReportFightKeys.every(k=>typeof k==='string'&&k.length>0)&&
    new Set(spentReportFightKeys).size===spentReportFightKeys.length,
    'UY_PRIORITY_CONFIG_INVALID');
  const spent=new Set(spentReportFightKeys);
  const jobs=new Map(),pending=new Map(),groupsByRank=new Map();
  for(const s of slots){
    const rows=jobs.get(s.jobKey)??[];
    rows.push(s);jobs.set(s.jobKey,rows);
    if(s.status==='PENDING')pending.set(slotKey(s),s);
  }
  const grouped=[];
  let spentGroups=0,spentNamedSlots=0,maskedOnlyGroups=0;
  for(const g of full.groups){
    const named=g.slots.filter(s=>!masked(s.name));
    if(!named.length){maskedOnlyGroups++;continue;}
    const groupKey=key(g);
    if(spent.has(groupKey)){
      spentGroups++;spentNamedSlots+=named.length;continue;
    }
    for(const s of named){
      const k=slotKey(s);
      need(pending.has(k)&&!groupsByRank.has(k),
        'UY_PRIORITY_GROUP_DUPLICATE_OR_VERIFIED');
      groupsByRank.set(k,groupKey);
    }
    grouped.push({...g,slots:named,groupKey});
  }
  const jobTargets=new Map(),gapSummary=[],blockedByMasked={top30:0,top100:0};
  let currentCells=0,possibleAdditionalCells=0,remainingNamed=0,
    remainingMasked=0,availableNamedSingleCells=0;
  const namedTop30Targets=[];
  for(const [jobKey,unsorted] of jobs){
    const rows=unsorted.sort((a,b)=>a.rank-b.rank);
    need(rows.length===100,'UY_PRIORITY_JOB_LENGTH');
    const have=fiveAvailable(rows),eligible=fiveEligible(rows);
    currentCells+=have.filter(Boolean).length;
    for(let i=0;i<5;i++)if(!have[i]&&eligible[i])
      possibleAdditionalCells++;
    if(!eligible[3])blockedByMasked.top30++;
    if(!eligible[4])blockedByMasked.top100++;
    for(const s of rows)if(s.status==='PENDING'){
      if(masked(s.name))remainingMasked++;
      else remainingNamed++;
    }
    const names30=rows.slice(0,30).filter(s=>
      s.status==='PENDING'&&!masked(s.name));
    const names100=rows.filter(s=>
      s.status==='PENDING'&&!masked(s.name));
    const remainingGroups30=new Set(names30.map(s=>groupsByRank.get(slotKey(s))));
    const remainingGroups100=new Set(names100.map(s=>groupsByRank.get(slotKey(s))));
    const reportEligible30=eligible[3]&&
      !have[3]&&!remainingGroups30.has(undefined);
    const reportEligible100=eligible[4]&&
      !have[4]&&!remainingGroups100.has(undefined);
    const targetedSingles=[1,30,100].filter(rank=>
      rows[rank-1].status==='PENDING'&&!masked(rows[rank-1].name)&&
      groupsByRank.has(slotKey(rows[rank-1])));
    availableNamedSingleCells+=targetedSingles.length;
    jobTargets.set(jobKey,{rows,have,eligible,
      reportEligible30,reportEligible100,
      missingNamedTop30:names30.length,
      missingNamedTop100:names100.length,
      reportFightGroups30:remainingGroups30,
      reportFightGroups100:remainingGroups100,
      targetedSingles});
    if(reportEligible30)namedTop30Targets.push({
      jobKey,snapshotSha:rows[0].snapshotSha,
      missingNamedRanks:names30.length,
      distinctReportFights:remainingGroups30.size,
      missingSingleCells:targetedSingles.filter(n=>n<=30).length,
      reportFightKeys:[...remainingGroups30].sort(),
      absoluteKpiGainCeiling:1+targetedSingles.filter(n=>n<=30).length,
      authorized:false
    });
    gapSummary.push({jobKey,top30Missing:names30.length,
      top30Blocked:!eligible[3],top100Missing:names100.length,
      top100Blocked:!eligible[4]});
  }
  const scoreGroups=[];
  for(const g of grouped){
    const impacted=new Map();
    for(const s of g.slots){
      const item=impacted.get(s.jobKey)??[];
      item.push(s.rank);impacted.set(s.jobKey,item);
    }
    let immediateSingleCells=0,closureTop30=0,closureTop100=0,
      nearTop30References=0;
    for(const [jobKey,ranks] of impacted){
      const item=jobTargets.get(jobKey),included=new Set(ranks);
      immediateSingleCells+=item.targetedSingles.filter(
        r=>included.has(r)).length;
      if(item.reportEligible30&&item.reportFightGroups30.size===1&&
        item.reportFightGroups30.has(g.groupKey))closureTop30++;
      if(item.reportEligible100&&item.reportFightGroups100.size===1&&
        item.reportFightGroups100.has(g.groupKey))closureTop100++;
      if(item.reportEligible30&&item.reportFightGroups30.size<=3)
        nearTop30References+=ranks.filter(r=>r<=30).length;
    }
    const conditionalCellsUpper=
      immediateSingleCells+closureTop30+closureTop100;
    const score=conditionalCellsUpper*100+
      nearTop30References*12+Math.min(g.slots.length,10);
    scoreGroups.push({
      groupKey:g.groupKey,reportCode:g.reportCode,fightId:g.fightId,
      encounterId:g.encounterId,difficulty:g.difficulty,
      reportRevision:g.reportRevision??null,
      namedReferences:g.slots.length,distinctJobs:impacted.size,
      immediateSingleCellsUpper:immediateSingleCells,
      top30OneFightClosureUpper:closureTop30,
      top100OneFightClosureUpper:closureTop100,
      nearTop30References,conditionalCellsUpper,score,
      eligibleForAutomaticDispatch:false,
      group:g
    });
  }
  scoreGroups.sort(compare);
  namedTop30Targets.sort((a,b)=>
    a.distinctReportFights-b.distinctReportFights||
    b.absoluteKpiGainCeiling-a.absoluteKpiGainCeiling||
    a.missingNamedRanks-b.missingNamedRanks||
    a.jobKey.localeCompare(b.jobKey));
  const top30Groups=gapSummary.reduce((n,x)=>n+(x.top30Blocked?0:1),0);
  return {
    status:'READ_ONLY_UY_RECOVERY_PRIORITY_NOT_AUTHORIZED',
    scopeKey:full.scopeKey,sourceJobs:full.jobs,rankSlots:full.rankSlots,
    currentUyCells:currentCells,totalUyCells:1080,
    additionalUyCellsConditionalUpper:possibleAdditionalCells,
    maximumUyCellsUnderAnonymousExclusion:
      currentCells+possibleAdditionalCells,
    namedPendingRanks:remainingNamed,maskedPendingRanks:remainingMasked,
    namedReportFightsEligible:scoreGroups.length,
    spentReportFightsExcluded:spentGroups,
    spentNamedReferencesExcluded:spentNamedSlots,
    anonymousOnlyReportFightsExcluded:maskedOnlyGroups,
    jobsEligibleToCompleteTop30:top30Groups,
    jobsBlockedFromTop30ByMasked:blockedByMasked.top30,
    jobsBlockedFromTop100ByMasked:blockedByMasked.top100,
    namedMissingAtRanks1_30_100:availableNamedSingleCells,
    oneFightTop30ClosureCandidates:scoreGroups.filter(
      x=>x.top30OneFightClosureUpper>0).length,
    oneFightTop100ClosureCandidates:scoreGroups.filter(
      x=>x.top100OneFightClosureUpper>0).length,
    top30CompletionTargets:namedTop30Targets.slice(0,top30TargetLimit),
    fightPreview:scoreGroups.slice(0,previewCount),
    sortedFightCandidates:scoreGroups,
    guaranteedAdditionalCells:0,pointCostForecast:null,
    observedGainForecast:null,paidRequestsAuthorized:false,
    googleSheetsWritesAuthorized:false
  };
}
