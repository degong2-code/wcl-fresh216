import test from 'node:test';
import assert from 'node:assert/strict';
import {planFull216} from '../src/core/full-scope-plan.mjs';
import {planReportWaves,makeRankingsWaveQuery,decodeRankingsWave}
  from '../src/core/report-wave-plan.mjs';

const sha = 'a'.repeat(64);
function fullSlots(){
  const slots=[];
  for(let boss=0;boss<8;boss++){
    for(let spec=0;spec<27;spec++){
      for(let rank=1;rank<=100;rank++){
        slots.push({
          scopeKey:'heroic:synthetic216',jobKey:`Boss${boss}|Class${spec}|Spec${spec}`,
          rank,snapshotSha:sha,status:'PENDING',
          className:`Class${spec}`,specName:`Spec${spec}`,
          totalDps:90000-rank*100-spec,
          reportCode:'FAKE_BOSS_REPORT_'+boss,
          fightId:rank,encounterId:3470+boss,difficulty:4,
          reportRevision:5,name:'SyntheticActor'
        });
      }
    }
  }
  return slots;
}
test('complete 216x100 scope produces one global 800-fight graph, not 21600 WCL calls',()=>{
  const plan=planFull216(fullSlots());
  assert.equal(plan.jobs,216);
  assert.equal(plan.encounters,8);
  assert.equal(plan.rankSlots,21600);
  assert.equal(plan.pendingRankSlots,21600);
  assert.equal(plan.pendingDistinctReportFights,800);
  assert.equal(plan.crossJobReferencesCoalesced,20800);
  assert.equal(plan.groups.every(g=>g.slots.length===27),true);
  assert.equal(plan.observedWclPoints,null);
  assert.equal(plan.expectedWclPointSavings,null);
});
test('bounded report waves reuse one Report body across four fights per wave',()=>{
  const graph=planFull216(fullSlots());
  const waves=planReportWaves(graph,{maxFightsPerWave:4});
  assert.equal(waves.distinctFightGroups,800);
  assert.equal(waves.graphQLWaveCount,200);
  assert.equal(waves.httpRequestsIfExecuted,200);
  assert.equal(waves.queryRankingsAliases,1600);
  assert.equal(waves.pendingRankReferences,21600);
  assert.equal(waves.theoreticalHttpCallsCoalesced,600);
  assert.equal(waves.waveJournalRequired,false);
  assert.equal(waves.waveCheckpointCompatible,true);
  assert.equal(waves.currentCheckpointCompatible,false);
  assert.equal(waves.readyForLiveExecution,false);
  assert.equal(waves.observedWclPoints,null);
  const q=makeRankingsWaveQuery(waves.waves[0]);
  assert.equal(Object.keys(q.variables).length,5);
  assert.equal(q.query.match(/:rankings\(/g).length,8);
  assert.match(q.query,/report\(code:\$code\)\{code revision/);
  assert.match(q.query,/rateLimitData\{currentRequest\}/);
  assert.doesNotMatch(q.query,/currentRequest\{/);
});
test('missing rank, duplicate rank and snapshot mixing block the entire 216-run',()=>{
  const missing=fullSlots();missing.pop();
  assert.throws(()=>planFull216(missing),/SCOPE_EXACT_21600_REQUIRED/);
  const duplicate=fullSlots();duplicate[0].rank=2;
  assert.throws(()=>planFull216(duplicate),/SCOPE_DUPLICATE_OR_INVALID_RANK/);
  const drift=fullSlots();drift[5].snapshotSha='b'.repeat(64);
  assert.throws(()=>planFull216(drift),/SCOPE_JOB_SNAPSHOT_OR_ENCOUNTER_DRIFT/);
});
test('foreign difficulty and wrong class/spec identity fail early',()=>{
  const wrong=fullSlots();wrong[100].difficulty=5;
  assert.throws(()=>planFull216(wrong),/SCOPE_OR_DIFFICULTY_MIXED/);
  const c=fullSlots();c[0].className='Mage';
  assert.throws(()=>planFull216(c),/SCOPE_JOB_CLASS_IDENTITY/);
});
test('skip verified rank only when exact same-fight source witness is supplied',()=>{
  const slots=fullSlots(),s=slots[0];
  s.status='VERIFIED';
  assert.throws(()=>planFull216(slots),/SCOPE_UNATTESTED_VERIFIED_SLOT/);
  s.proof={proofType:'EXACT_SAME_FIGHT_ACTOR',actorRef:'id:123',
    bossDps:s.totalDps*0.7,snapshotSha:s.snapshotSha,reportRevision:5,
    reportCode:s.reportCode,fightId:s.fightId,
    encounterId:s.encounterId,difficulty:s.difficulty};
  const graph=planFull216(slots);
  assert.equal(graph.verifiedSlotsSkipped,1);
  assert.equal(graph.pendingRankSlots,21599);
  assert.equal(graph.pendingDistinctReportFights,800);
});
test('do not fabricate report or fight references for unidentified pending ranks',()=>{
  const missingReport=fullSlots();missingReport[0].reportCode='';
  assert.throws(()=>planFull216(missingReport),/SCOPE_PENDING_FIGHT_UNRESOLVED/);
  const missingFight=fullSlots();missingFight[0].fightId=null;
  assert.throws(()=>planFull216(missingFight),/SCOPE_PENDING_FIGHT_UNRESOLVED/);
});
test('report revision cannot mix within a wave, and unknown revision stays separate',()=>{
  const single=planFull216(fullSlots());
  const changed=single.groups.slice(0,2).map((x,i)=>({
    ...x,reportRevision:i===0?null:5
  }));
  const waves=planReportWaves({groups:changed,pendingSlotCount:54});
  assert.equal(waves.graphQLWaveCount,2);
  assert.equal(waves.expectedWclPointSavings,null);
  assert.notEqual(waves.waves[0].reportRevision,waves.waves[1].reportRevision);
});
test('decode wave: complete response fans out safely and charges once per wave',()=>{
  const plan=planReportWaves({groups:planFull216(fullSlots()).groups.slice(0,3)});
  const wave=plan.waves[0];
  const report={code:wave.reportCode,revision:5};
  for(let i=0;i<wave.fightGroups.length;i++){
    report['o'+i]={data:[{fightID:wave.fightGroups[i].fightId}]};
    report['b'+i]={data:[{fightID:wave.fightGroups[i].fightId}]};
  }
  const body={data:{rateLimitData:{currentRequest:{total:23}},
    reportData:{report}}};
  const ok=decodeRankingsWave(wave,200,body);
  assert.equal(ok.status,'OK');
  assert.equal(ok.results.length,wave.fightGroups.length);
  assert.equal(ok.observedPoints,23); // per WAVE only
  assert.equal(ok.results.every(x=>x.report.code===wave.reportCode),true);
  const broken=structuredClone(body);delete broken.data.reportData.report.b1;
  const no=decodeRankingsWave(wave,200,broken);
  assert.equal(no.status,'WAVE_RANKINGS_SHAPE_INVALID');
  assert.deepEqual(no.results,[]);
});
test('partial GraphQL errors, changed revision and 504 never fan out apparent proof',()=>{
  const wave=planReportWaves({groups:planFull216(fullSlots()).groups.slice(0,1)}).waves[0];
  const base={data:{rateLimitData:{currentRequest:{total:17}},
    reportData:{report:{code:wave.reportCode,revision:5,o0:{data:[]},b0:{data:[]}}}}};
  for(const [status,b] of [[200,{...base,errors:[{message:'partial WCL'}]}],
    [200,{...base,data:{...base.data,reportData:{report:{...base.data.reportData.report,revision:6}}}}],
    [504,{}]]) {
    const out=decodeRankingsWave(wave,status,b);
    assert.notEqual(out.status,'OK');
    assert.equal(out.results.length,0);
    assert.equal(out.observedPoints,status===504?null:17);
  }
});
test('planner is deterministic under reordered rank input',()=>{
  const a=fullSlots(),b=[...a].reverse();
  const x=planFull216(a),y=planFull216(b);
  assert.deepEqual(x,y);
  assert.deepEqual(planReportWaves(x).waves,planReportWaves(y).waves);
});

test('all eight encounters must use the same 27-class/spec roster',()=>{
  const slots=fullSlots();
  for(let i=0;i<100;i++){
    slots[i].jobKey='Boss0|ClassNEW|SpecNEW';
    slots[i].className='ClassNEW';
    slots[i].specName='SpecNEW';
  }
  assert.throws(()=>planFull216(slots),/SCOPE_SPECIALIZATION_SET_DRIFT/);
});
test('one encounter must map to one boss label, and a boss name cannot change encounter',()=>{
  const slots=fullSlots();
  for(let i=0;i<100;i++)slots[i].jobKey='Imposter|Class0|Spec0';
  assert.throws(()=>planFull216(slots),/SCOPE_BOSS_ENCOUNTER_DRIFT/);
});
test('a verified actor witness cannot skip a new rank when the report revision differs',()=>{
  const slots=fullSlots(),row=slots[0];
  row.status='VERIFIED';
  row.proof={proofType:'EXACT_SAME_FIGHT_ACTOR',actorRef:'id:7',
    bossDps:row.totalDps*0.7,snapshotSha:row.snapshotSha,
    reportRevision:7,reportCode:row.reportCode,fightId:row.fightId,
    encounterId:row.encounterId,difficulty:row.difficulty};
  assert.throws(()=>planFull216(slots),/SCOPE_UNATTESTED_VERIFIED_SLOT/);
});

test('single-fight waves are the only format compatible with existing per-fight checkpoint',()=>{
  const full=planFull216(fullSlots());
  const plan=planReportWaves(full,{maxFightsPerWave:1});
  assert.equal(plan.graphQLWaveCount,800);
  assert.equal(plan.currentCheckpointCompatible,true);
  assert.equal(plan.waveJournalRequired,false);
  assert.equal(plan.readyForLiveExecution,false);
  assert.equal(plan.theoreticalHttpCallsCoalesced,0);
});

test('one report revision cannot map one fightID to conflicting encounters',()=>{
  const input=planFull216(fullSlots());
  const g=input.groups[0];
  const contradiction={...structuredClone(g),encounterId:g.encounterId+1};
  assert.throws(()=>planReportWaves({groups:[g,contradiction]}),
    /WAVE_FIGHT_ENCOUNTER_CONFLICT/);
});

test('WCL currentRequest JSON string retains one point witness for whole wave',()=>{
 const wave=planReportWaves({groups:planFull216(fullSlots()).groups.slice(0,1)}).waves[0];
 const report={code:wave.reportCode,revision:5,
   o0:{data:[{fightID:wave.fightGroups[0].fightId}]},
   b0:{data:[{fightID:wave.fightGroups[0].fightId}]}};
 const out=decodeRankingsWave(wave,200,{data:{
   rateLimitData:{currentRequest:'{"total":3.25}'},reportData:{report}
 }});
 assert.equal(out.status,'OK');assert.equal(out.observedPoints,3.25);
});
