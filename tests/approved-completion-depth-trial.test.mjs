import test from 'node:test';
import assert from 'node:assert/strict';
import {
 COMPLETE_REQUEST,COMPLETE_ID,COMPLETE_APPROVAL,COMPLETE_ONCE_REF,
 COMPLETE_CORRECTION_REQUEST,COMPLETE_CORRECTION_ID,COMPLETE_CORRECTION_APPROVAL,
 COMPLETE_CORRECTION_ONCE_REF,COMPLETE_TARGET,
 validateCompletionRequest,buildRankingBatchQuery,createRankingState,initCompletionState,
 applyRankingBatch,rankingProgress,buildReportBatchQuery,applyReportBatch,finalCompletionSummary
} from '../src/core/approved-completion-depth-trial.mjs';
import {preflightCompletion,runCompletionExperiment}
 from '../tools/run-actions-completion-depth.mjs';

const request=()=>({request_id:COMPLETE_ID,approval:COMPLETE_APPROVAL,
 encounter_id:3470,difficulty:4,partition_mode:'LATEST_DEFAULT',
 date_start_kst:'2026-10-22',date_end_kst:'2026-10-28',
 filter:'date.1792594800000.1793199600000',
 specs:['frost_dk','retribution','shadow'],total_dps_pages:[1],
 boss_dps_mode:'UNTIL_NAMED_COMPLETE_OR_LEADERBOARD_END',
 ranking_batch_pages:10,report_fallback:'ALL_RESIDUAL_NAMED_AND_ANONYMOUS',
 report_alias_cap:4});
const env=()=>({GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'push',
 GITHUB_REF:'refs/heads/work/collector-architecture',
 GITHUB_REPOSITORY:'degong2-code/wcl-fresh216',GITHUB_SHA:'b'.repeat(40),
 GITHUB_TOKEN:'G',WCL_CLIENT_ID:'I',WCL_CLIENT_SECRET:'S'});
const change='A\t'+COMPLETE_REQUEST+'\n',t=1792600000000;
const row=(i,amount=2000-i,name='P'+i)=>({name,amount,startTime:t+i,
 report:{code:'R'+i,fightID:i+1}});
const rankBody=(spec,first,includeTotal,{matchPages=1,endAt=null,anon=0}={})=>{
 const enc={};if(includeTotal)enc.t1={rankings:Array.from({length:100},(_,i)=>
   row(i,2000-i,i<anon?'Anonymous':'P'+i))};
 for(let p=first;p<first+10;p++){
   let count=endAt===p?40:(endAt!==null&&p>endAt?0:100);
   enc['b'+p]={rankings:Array.from({length:count},(_,j)=>{
     const i=(p-1)*100+j;
     // only top100 identities can match; synthetic page 1 or selected page 11
     if(p<=matchPages&&j<100)return row(j,1500-j,j<anon?'Anonymous':'P'+j);
     if(p===11&&j===0)return row(99,1401,'P99');
     return {name:'Other'+p+'_'+j,amount:1000-j,startTime:t+1000+p*100+j,
       report:{code:'X'+p+'_'+j,fightID:9000+j}};
   })};
 }
 return {data:{rateLimitData:{currentRequest:{total:10}},worldData:{encounter:enc}}};
};
const reportBody=(groups,spec,overall)=>{
 const reportData={};
 groups.forEach((g,i)=>{
  const chars=g.indexes.map(idx=>({id:idx+1,name:'Player ('+(idx+1)+')',
    class:spec.className,spec:spec.specName,amount:overall[idx].amount}));
  const bossChars=g.indexes.map(idx=>({id:idx+1,name:'Player ('+(idx+1)+')',
    class:spec.className,spec:spec.specName,amount:overall[idx].amount-500}));
  reportData['r'+i]={overall:{data:[{fightID:g.fightId,encounter:{id:3470},
    difficulty:4,roles:{dps:{characters:chars}}}]},
    boss:{data:[{fightID:g.fightId,encounter:{id:3470},difficulty:4,
      roles:{dps:{characters:bossChars}}}]}};
 });
 return {data:{rateLimitData:{currentRequest:{total:2}},reportData}};
};

test('request has no hard rank ceiling and ranking batches are dynamic',()=>{
 assert.equal(validateCompletionRequest(request()),true);
 const q=buildRankingBatchQuery(COMPLETE_TARGET.specs[0],11);
 assert.deepEqual(q.pages,[11,12,13,14,15,16,17,18,19,20]);
 assert.doesNotMatch(q.query,/partition:/);
 assert.match(q.query,/page:20/);
});
test('ranking ends on short page, not an arbitrary rank ceiling',()=>{
 const spec=COMPLETE_TARGET.specs[0],b=rankBody(spec,1,true,{matchPages:1,endAt:4});
 const dec=createRankingState(spec,b,1,{includeTotal:true});
 const st=initCompletionState(spec,dec.overall);const p=applyRankingBatch(st,dec.pages);
 assert.equal(p.leaderboardEnded,true);assert.equal(st.lastPage,4);
});
test('anonymous can be recovered by exact total amount + class/spec + actor id',()=>{
 const spec=COMPLETE_TARGET.specs[0];
 const overall=Array.from({length:100},(_,i)=>row(i,2000-i,i===0?'Anonymous':'P'+i));
 const st=initCompletionState(spec,overall);
 st.values=Array.from({length:100},(_,i)=>i===0?null:1000);
 const groups=[{code:'R0',fightId:1,indexes:[0]}];
 const b=reportBody(groups,spec,overall);
 const a=applyReportBatch(st,groups,b);
 assert.equal(a.anonymousRecovered,1);assert.equal(st.values[0],1500);
 assert.equal(finalCompletionSummary(st).finalComplete,true);
});
test('exclusive manifest and consumed ref are enforced',async()=>{
 assert.equal(preflightCompletion(env(),request(),change).onceRef,COMPLETE_ONCE_REF);
 const calls=[];const out=await runCompletionExperiment({env:env(),request:request(),
  changedFiles:change,fetchImpl:async(url,opts)=>{calls.push({url,opts});return {status:422};}});
 assert.equal(out.status,'ALREADY_CONSUMED');assert.equal(calls.length,1);
 assert.equal(JSON.parse(calls[0].opts.body).ref,COMPLETE_ONCE_REF);
});

test('null page after a full prior page is a safe pagination-unavailable stop',()=>{
 const spec=COMPLETE_TARGET.specs[0];
 const b=rankBody(spec,1,true,{matchPages:1});
 const dec=createRankingState(spec,b,1,{includeTotal:true});
 const st=initCompletionState(spec,dec.overall);applyRankingBatch(st,dec.pages);
 const b2=rankBody(spec,11,false,{matchPages:0});
 const dec2=createRankingState(spec,b2,11);applyRankingBatch(st,dec2.pages);
 const b3=rankBody(spec,21,false,{matchPages:0});
 b3.data.worldData.encounter.b21=null;
 const dec3=createRankingState(spec,b3,21);
 const p=applyRankingBatch(st,dec3.pages);
 assert.equal(p.rankingUnavailable,true);assert.equal(p.unavailablePage,21);
 assert.equal(p.rankingDone,true);assert.equal(p.lastPage,20);
});
test('correction manifest uses a new irreversible ref',()=>{
 const correction={...request(),request_id:COMPLETE_CORRECTION_ID,
  approval:COMPLETE_CORRECTION_APPROVAL};
 const q=preflightCompletion(env(),correction,
  'A\t'+COMPLETE_CORRECTION_REQUEST+'\n');
 assert.equal(q.onceRef,COMPLETE_CORRECTION_ONCE_REF);
});
