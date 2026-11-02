import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {newCheckpoint} from '../src/core/checkpoint.mjs';
import {makeFreshDatedHeroicManifest,planFreshCohortBatches,
  installFreshCohortPlan} from '../src/core/fresh-cohort-source.mjs';
import {inspectFreshBossHostReadiness}
  from '../src/core/fresh-boss-host-readiness.mjs';
import {validatePrivateBossPreviewContext}
  from '../tools/run-private-engine-boss-preview.mjs';

const scope='engine-boss-host:2026-10-22_27';
const commit='f'.repeat(40);
const manifest=makeFreshDatedHeroicManifest(scope);
const sha=o=>createHash('sha256').update(JSON.stringify(o)).digest('hex');
function stateWithCompletedA({batchesComplete=4,aAliases=9}={}){
  const s=installFreshCohortPlan(newCheckpoint(scope,'boss-readiness-test'),
    manifest,{jobsPerRequest:aAliases});
  s.sourceCodeCommit=commit;
  const batches=planFreshCohortBatches(manifest,{jobsPerRequest:aAliases})
    .batches;
  for(const b of batches.slice(0,batchesComplete)){
    const e=s.sourceRequests[b.key];
    e.status='COMPLETED';e.observedPoints=b.jobs.length+.01;
    e.attempt={id:'A-'+b.batchIndex,kind:'TOTAL_COHORT_BATCH',
      startedAtMs:1};
    e.result={jobs:b.jobs.map((j,i)=>{
      const rows=Array.from({length:100},(_,r)=>({
        name:'Actor'+r,amount:250000-r*1000-i,
        reportCode:'S_'+b.batchIndex+'_'+i+'_'+r,
        fightId:r+1,startTime:1792594801000+r*1000,
        reportRevision:null
      }));
      return {...j,rows,snapshotSha:sha(rows)};
    })};
  }
  return s;
}
const inspect=(s,extra={})=>inspectFreshBossHostReadiness({
  sourceState:s,expectedScopeKey:scope,
  expectedSourceCommit:commit,...extra
});
test('real-shaped A9 partial produces immutable B8/B9 host previews with zero authorization',()=>{
  const s=stateWithCompletedA(),original=JSON.stringify(s);
  const b8=inspect(s,{bossJobsPerRequest:8});
  const b9=inspect(s,{bossJobsPerRequest:9});
  assert.equal(b8.sourceJobsComplete,36);
  assert.equal(b8.sourceRankRows,3600);
  assert.equal(b8.nextSourceBatchIndex,4);
  assert.equal(b8.bossPreviewRequests,6);
  assert.equal(b9.bossPreviewRequests,4);
  assert.equal(b9.sourceJobsPerRequest,9);
  for(const x of [b8,b9]){
    assert.equal(x.kind,'BOSS_SOURCE_INCOMPLETE_READONLY');
    assert.equal(x.bossPreviewJobs,36);
    assert.equal(x.sourceWitnessComplete,false);
    assert.equal(x.bossPlanStableForPaidPreparation,false);
    assert.equal(x.paidDispatchAuthorized,false);
    assert.equal(x.bossRankRowsObserved,0);
    assert.equal(x.newSameFightProofsObserved,0);
    assert.equal(x.wclCalls,0);
    assert.equal(x.gitWrites,0);
    assert.equal(x.sheetsWrites,0);
  }
  assert.equal(JSON.stringify(s),original);
});
test('FULL A9 is the prerequisite for stable B8 and B9 plans, not WCL approval',()=>{
  const s=stateWithCompletedA({batchesComplete:24});
  const b9=inspect(s),b8=inspect(s,{bossJobsPerRequest:8});
  assert.equal(b9.kind,'BOSS_SOURCE_COMPLETE_READONLY');
  assert.equal(b9.bossPreviewRequests,24);
  assert.equal(b8.bossPreviewRequests,32);
  assert.equal(b9.bossPlanStableForPaidPreparation,true);
  assert.equal(b8.sourceJobsComplete,216);
  assert.equal(b9.sourceRankRows,21600);
  assert.equal(b9.nextSourceBatchIndex,null);
  assert.equal(b9.paidDispatchAuthorized,false);
});
test('an archived A8 source can feed a B9 preview without source re-planning',()=>{
  const s=stateWithCompletedA({batchesComplete:4,aAliases:8});
  const b9=inspect(s,{bossJobsPerRequest:9});
  assert.equal(b9.sourceJobsComplete,27);
  assert.equal(b9.sourceJobsPerRequest,8);
  assert.equal(b9.bossPreviewJobs,27);
  assert.equal(b9.bossPreviewRequests,3);
  assert.equal(b9.bossPlanStableForPaidPreparation,false);
});
test('source pin drift, nonexact rank, and unresolved paid A attempts fail closed',()=>{
  const s=stateWithCompletedA();
  assert.throws(()=>inspect(s,{expectedSourceCommit:'0'.repeat(40)}),
    /BOSS_HOST_SOURCE_PIN_MISMATCH/);
  assert.throws(()=>inspect(s,{expectedScopeKey:'different-scope'}),
    /BOSS_HOST_SOURCE_PIN_MISMATCH/);
  assert.throws(()=>inspect(s,{bossJobsPerRequest:10}),
    /BOSS_HOST_READONLY_INPUT_INVALID/);
  const b=Object.values(s.sourceRequests).find(x=>x.status==='COMPLETED');
  b.result.jobs[0].rows[0].amount++;
  assert.throws(()=>inspect(s),/FRESH_COHORT_EXPORT_DRIFT/);
  const unsettled=stateWithCompletedA();
  const next=Object.values(unsettled.sourceRequests)
    .find(x=>x.status==='READY');
  next.status='IN_FLIGHT';
  next.attempt={id:'unknown-WCL',kind:'TOTAL_COHORT_BATCH',
    startedAtMs:1};
  assert.throws(()=>inspect(unsettled),
    /FRESH_COHORT_PROJECTION_NOT_READY/);
});

test('private Boss host requires exact GitHub context and source branch SHA',()=>{
  const env={
    GITHUB_ACTIONS:'true',
    GITHUB_REPOSITORY:'degong2-code/ai-project-lab',
    GITHUB_EVENT_NAME:'push',
    GITHUB_REF:'refs/heads/work/fresh216-private-actions'
  };
  const input={env,sourceStateHead:'a'.repeat(40),
    expectedSourceHead:'a'.repeat(40),
    expectedSourceCommit:commit,expectedScopeKey:scope,
    bossJobsPerRequest:9
  };
  assert.equal(validatePrivateBossPreviewContext(input),true);
  for(const attempt of [
    {...input,expectedSourceHead:'b'.repeat(40)},
    {...input,bossJobsPerRequest:10},
    {...input,bossJobsPerRequest:0},
    {...input,expectedSourceCommit:'unknown'},
    {...input,env:{...env,GITHUB_ACTIONS:'false'}},
    {...input,env:{...env,GITHUB_EVENT_NAME:'workflow_dispatch'}},
    {...input,env:{...env,GITHUB_REF:'refs/heads/main'}},
    {...input,env:{...env,GITHUB_REPOSITORY:'other/private'}}
  ]){
    assert.throws(()=>validatePrivateBossPreviewContext(attempt),
      /BOSS_PRIVATE_READONLY_CONTEXT_NOT_PINNED/);
  }
});
