import test from 'node:test';
import assert from 'node:assert/strict';
import {newCheckpoint,checkpointStats,committedProofs}
  from '../src/core/checkpoint.mjs';
import {prepareAdaptiveNext,runOneAdaptiveStep}
  from '../src/core/adaptive-collector-runner.mjs';
import {calibrateAdaptiveEconomics}
  from '../src/core/observed-cost-calibration.mjs';

const scopeKey='heroic:full216',sha='a'.repeat(64);
function full216(shared=false){
 const out=[];
 for(let boss=0;boss<8;boss++)for(let spec=0;spec<27;spec++)
 for(let rank=1;rank<=100;rank++)out.push({
   scopeKey,jobKey:'Boss'+boss+'|Class'+spec+'|Spec'+spec,
   rank,snapshotSha:sha,status:'PENDING',
   className:'Class'+spec,specName:'Spec'+spec,
   encounterId:3470+boss,difficulty:4,
   reportCode:shared?'SHARED_'+boss:'R_'+boss+'_'+spec+'_'+rank,
   fightId:rank,reportRevision:5,
   name:'Actor'+spec,totalDps:10000-rank-spec,
   startTime:1792600000000+rank,
   filter:'date.1792594800000.1793199600000'
 });
 return out;
}
function mem(initial){
 let state=structuredClone(initial),updates=0;
 return {read:()=>structuredClone(state),update:fn=>{
   state=fn(structuredClone(state));updates++;return structuredClone(state);
 },get updates(){return updates;}};
}
const policy={notBeforeMs:0,maxObservedPoints:1000,reservePoints:30};
function reportBody(wave){
 const report={code:wave.reportCode,revision:5};
 for(let i=0;i<wave.fightGroups.length;i++){
   const g=wave.fightGroups[i];
   const characters=g.slots.map((s,j)=>({
     id:j+1,name:s.name,
     class:s.className,spec:s.specName,amount:s.totalDps
   }));
   const make=(chars)=>({data:[{fightID:g.fightId,
     encounter:{id:g.encounterId},difficulty:g.difficulty,
     roles:{dps:{characters:chars}}}]});
   report['o'+i]=make(characters);
   report['b'+i]=make(characters.map(c=>({...c,amount:c.amount-200})));
 }
 return {httpStatus:200,body:{data:{
   rateLimitData:{currentRequest:{total:17.5}},
   reportData:{report}
 }}};
}
test('preview is read-only and paid execution requires explicit authorization',async()=>{
 const slots=full216(false),store=mem(newCheckpoint(scopeKey,'run-1'));
 const view=await runOneAdaptiveStep({slots,store});
 assert.equal(view.status,'PREVIEW');assert.equal(view.kind,'RANK_BATCH');
 assert.equal(view.nextPage,1);assert.equal(view.nextPageCount,3);
 assert.equal(store.updates,0);
 await assert.rejects(()=>runOneAdaptiveStep({slots,store,mode:'execute'}),
   /COLLECTOR_PAID_EXECUTION_NOT_AUTHORIZED/);
 assert.equal(store.updates,0);
});
test('Full216 one-step ranking saves exact proof and next tick resumes without duplication',async()=>{
 const slots=full216(false),store=mem(newCheckpoint(scopeKey,'run-1'));
 let rankCalls=0;
 const result=await runOneAdaptiveStep({slots,store,mode:'execute',
  approved:true,admissionPolicy:policy,
  reportTransport:async()=>{throw Error('SHOULD_NOT_REPORT');},
  rankTransport:async(q)=>{
    rankCalls++;const s=slots.find(x=>x.className===q.variables.className&&
      x.specName===q.variables.specName&&
      x.encounterId===q.variables.id&&x.rank===1);
    const fake=Array.from({length:100},(_,i)=>({
      name:'Other'+i,amount:100,
      startTime:1792600000500+i,
      report:{code:'OTHER'+i,fightID:1000+i}
    }));
    fake[0]={name:s.name,amount:s.totalDps-100,
      startTime:s.startTime,
      report:{code:s.reportCode,fightID:s.fightId}};
    return {httpStatus:200,body:{data:{
      rateLimitData:{currentRequest:{total:3.01}},
      worldData:{encounter:{
        b0:{rankings:fake,hasMorePages:true},
        b1:{rankings:fake.slice(1).concat(fake[1]),hasMorePages:true},
        b2:{rankings:fake.slice(1).concat(fake[1]),hasMorePages:true}
      }}
    }}};
  }
 });
 assert.equal(result.kind,'RANK_BATCH');assert.equal(result.status,'RECORDED');
 assert.equal(result.verified,1);assert.equal(rankCalls,1);
 assert.equal(committedProofs(store.read()).length,1);
 assert.equal(checkpointStats(store.read()).witnessedPoints,3.01);
 const second=prepareAdaptiveNext({slots,state:store.read()});
 assert.equal(second.kind,'RANK_BATCH');
 assert.notEqual(second.request.jobKey,slots[0].jobKey);
});
test('shared fights choose one 4-fight Report wave and persist 108 actor proofs',async()=>{
 const slots=full216(true),store=mem(newCheckpoint(scopeKey,'run-2'));
 const preview=await runOneAdaptiveStep({slots,store});
 assert.equal(preview.kind,'REPORT_WAVE');assert.equal(preview.nextReportFights,4);
 let calls=0;
 const first=await runOneAdaptiveStep({slots,store,mode:'execute',
   approved:true,admissionPolicy:policy,
   rankTransport:async()=>{throw Error('SHOULD_NOT_RANK');},
   reportTransport:async q=>{
     calls++;assert.equal(q.query.match(/:rankings\(/g).length,8);
     const wave=prepareAdaptiveNext({slots,
       state:newCheckpoint(scopeKey,'unregistered')}).wave;
     return reportBody(wave);
   }});
 assert.equal(first.kind,'REPORT_WAVE');
 assert.equal(first.status,'RECORDED');assert.equal(first.fights,4);
 assert.equal(first.verifiedSlots,108);assert.equal(calls,1);
 assert.equal(committedProofs(store.read()).length,108);
 assert.equal(checkpointStats(store.read()).witnessedPoints,17.5);
 const second=prepareAdaptiveNext({slots,state:store.read()});
 assert.equal(second.kind,'REPORT_WAVE');assert.equal(second.resumed,true);
 assert.notEqual(second.wave.waveId,
   prepareAdaptiveNext({slots,state:newCheckpoint(scopeKey,'empty')}).wave.waveId);
});
test('observed rank points alone never fabricates a Report cost calibration',()=>{
 const state={schema:1,entries:{},rankRequests:{
   sample:{status:'COMPLETED',observedPoints:11.01,
     result:{pages:Array.from({length:10},(_,i)=>({
       page:i+1,status:'OK',rowCount:100,newVerifiedRanks:[]
     }))}}
 }};
 const c=calibrateAdaptiveEconomics(state);
 assert.equal(c.rankObservedMeanPerSuccessfulPage,1.101);
 assert.equal(c.reportObservedMeanPerFight,null);
 assert.equal(c.economics,null);
 assert.equal(c.complete,false);
});
