import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {buildFreshQueryPair,summarizeFreshRankings,runFreshTwoQueryProbe,
  observeFreshRateLimit,summarizeFreshTableSourceRows}
  from '../src/core/fresh-two-query-probe.mjs';

const target=()=>({reportCode:'PUBLIC_SYNTHETIC',fightId:17});
const a=(amount,id=9)=>({id,amount,name:'PublicTestHero',
  class:'Shaman',spec:'Enhancement'});
const f=characters=>({
  fightID:17,encounter:{id:3470},difficulty:4,
  roles:{dps:{characters}}
});
const resp=(type='rankings',opts={})=>({
  httpStatus:200,body:{data:{
    rateLimitData:{
      currentRequest:{total:4},limitPerHour:2000,
      pointsSpentThisHour:100,pointsResetIn:1800
    },
    reportData:{report:{
      code:'PUBLIC_SYNTHETIC',revision:2,
      ...(type==='rankings'?{
        overall:{data:[f([a(2000)])]},
        boss:{data:[f([a(1600)])]}
      }:{damage:{entries:[{id:9,total:123456}]}})
    }}
  }},...opts
});
const withDir=async fn=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fresh-pair-'));
  try{return await fn(path.join(root,'attempt-1'));}
  finally{fs.rmSync(root,{recursive:true,force:true});}
};

test('fresh method needs only public report code and FightID, no old snapshot',()=>{
  const qs=buildFreshQueryPair(target());
  assert.equal(qs.length,2);
  assert.equal(qs[0].variables.code,'PUBLIC_SYNTHETIC');
  assert.deepEqual(qs[1].variables,qs[0].variables);
  assert.match(qs[0].query,/overall:rankings/);
  assert.match(qs[0].query,/boss:rankings/);
  assert.match(qs[1].query,/damage:table/);
  assert.ok(!qs[0].query.includes('snapshotSha'));
  assert.ok(!qs[0].query.includes('reportRevision'));
});

test('one rankings response becomes the current same-fight actor reference',()=>{
  const s=summarizeFreshRankings(target(),resp().body);
  assert.deepEqual(s,{
    ok:true,revision:2,encounterId:3470,difficulty:4,
    verifiedActors:1,totalActors:1,bossActors:1
  });
});

test('two good mock responses record cost but NEVER certify table equivalence',async()=>{
  await withDir(async dir=>{
    const calls=[];
    const s=await runFreshTwoQueryProbe({
      target:target(),privateOutputDir:dir,
      send:async q=>{
        calls.push(q);
        const j=JSON.parse(fs.readFileSync(path.join(dir,'journal.json')));
        assert.equal(j.status,'IN_FLIGHT');
        assert.equal(j.attemptedGraphql,calls.length);
        return resp(calls.length===1?'rankings':'table');
      }
    });
    assert.equal(s.status,'RECORDED');
    assert.equal(s.graphqlRequests,2);
    assert.equal(s.matchedRankingsActors,1);
    assert.equal(s.tableAdopted,false);
    assert.equal(s.actorBossTargetAndDpsDenominatorParity,'UNPROVEN');
    assert.ok(s.observations.every(o=>o.reportedTotalPoints===4));
    assert.ok(s.observations.every(o=>o.databasePoints===null));
    assert.ok(s.observations.every(o=>o.reportRevisionMatched===true));
    assert.equal(calls.length,2);
  });
});

test('bad first WCL rankings report identity fails before second query',async()=>{
  await withDir(async dir=>{
    let calls=0;
    const s=await runFreshTwoQueryProbe({
      target:target(),privateOutputDir:dir,send:async()=>{
        calls++;const r=resp();
        r.body.data.reportData.report.code='WRONG_CODE';
        return r;
      }
    });
    assert.equal(calls,1);
    assert.equal(s.status,'NEEDS_REVIEW');
    assert.equal(s.reason,'FRESH_REPORT_CODE_MISMATCH');
  });
});

test('mismatched actor BossDPS fails closed even without prior rank-slot',async()=>{
  await withDir(async dir=>{
    let calls=0;
    const s=await runFreshTwoQueryProbe({
      target:target(),privateOutputDir:dir,send:async()=>{
        calls++;const r=resp();
        r.body.data.reportData.report.boss.data[0].roles.dps.characters[0].id=99;
        return r;
      }
    });
    assert.equal(calls,1);
    assert.equal(s.reason,'FRESH_NO_MATCHED_DPS_ACTORS');
  });
});

test('missing point observation or low app headroom stops before table',async()=>{
  for(const issue of ['missing-total','missing-budget','low-budget']){
    await withDir(async dir=>{
      let calls=0;
      const s=await runFreshTwoQueryProbe({
        target:target(),privateOutputDir:dir,send:async()=>{
          calls++;const r=resp();
          if(issue==='missing-total')delete r.body.data.rateLimitData.currentRequest;
          if(issue==='missing-budget')delete r.body.data.rateLimitData.limitPerHour;
          if(issue==='low-budget')r.body.data.rateLimitData.pointsSpentThisHour=1950;
          return r;
        }
      });
      assert.equal(calls,1);
      assert.equal(s.status,'NEEDS_REVIEW');
      assert.match(s.reason,/FRESH_(POINT_COST_UNKNOWN|APP_HEADROOM_UNKNOWN_OR_LOW)/);
    });
  }
});

test('unknown HTTP outcome never retries and same output cannot be replayed',async()=>{
  await withDir(async dir=>{
    let attempts=0;
    const opts={target:target(),privateOutputDir:dir,
      send:async()=>{attempts++;throw Error('synthetic uncertain')}};
    const s=await runFreshTwoQueryProbe(opts);
    assert.equal(attempts,1);
    assert.equal(s.reason,'UNKNOWN_PAID_ATTEMPT_NO_RETRY');
    await assert.rejects(()=>runFreshTwoQueryProbe(opts),/EEXIST/);
    assert.equal(attempts,1);
  });
});

test('second reply revision drift stops without a third query',async()=>{
  await withDir(async dir=>{
    let calls=0;
    const s=await runFreshTwoQueryProbe({
      target:target(),privateOutputDir:dir,send:async()=>{
        calls++;
        const r=resp(calls===1?'rankings':'table');
        if(calls===2)r.body.data.reportData.report.revision=9;
        return r;
      }
    });
    assert.equal(calls,2);
    assert.equal(s.status,'NEEDS_REVIEW');
    assert.equal(s.reason,'FRESH_TABLE_REVISION_OR_SHAPE_UNPROVEN');
  });
});

test('invalid public source must fail before any operation',()=>{
  for(const t of [
    {reportCode:'',fightId:17},
    {reportCode:'PUBLIC_SYNTHETIC',fightId:0},
    {reportCode:'PUBLIC_SYNTHETIC',fightId:17,
      snapshotSha:'old-not-needed'},
    {reportCode:'PUBLIC_SYNTHETIC',fightId:'17'}
  ])assert.throws(()=>buildFreshQueryPair(t),/FRESH_PUBLIC_REPORT_TARGET_INVALID/);
});

test('queries request official per-request and hourly database point witnesses',()=>{
  for(const request of buildFreshQueryPair(target())){
    assert.match(request.query,/currentRequest limitPerHour pointsSpentThisHour pointsResetIn databaseLimitPerHour databasePointsSpentThisHour userHasRemainingPoints userPointsResetIn/);
    assert.doesNotMatch(request.query,/currentRequest\\{/);
  }
});

test('direct WCL category point witnesses preserve database subset semantics',()=>{
  const body=resp().body;
  body.data.rateLimitData.currentRequest={
    total:18,application:13,database:7,user:4
  };
  body.data.rateLimitData.databaseLimitPerHour=100;
  body.data.rateLimitData.databasePointsSpentThisHour=47;
  body.data.rateLimitData.userHasRemainingPoints=false;
  const w=observeFreshRateLimit(body);
  assert.deepEqual(w,{
    total:18,pointClasses:{application:13,database:7,user:4},
    appRemaining:1900,databaseRemaining:53,
    userHasRemainingPoints:false,classWitnesses:3
  });
  // Reported total is NEVER application+database+user: database
  // is a subset of application and the minimum request cost is separate.
  assert.notEqual(w.total,
    w.pointClasses.application+w.pointClasses.database+w.pointClasses.user);
});

test('missing point classes stay null; no zero-cost inference from total',()=>{
  const w=observeFreshRateLimit(resp().body);
  assert.equal(w.total,4);
  assert.deepEqual(w.pointClasses,{
    application:null,database:null,user:null
  });
  assert.equal(w.classWitnesses,0);
  assert.equal(w.databaseRemaining,null);
  assert.equal(w.userHasRemainingPoints,null);
});

test('invalid category metadata cannot become a false point witness',()=>{
  const body=resp().body;
  body.data.rateLimitData.currentRequest={
    total:5,application:-3,database:'5',user:NaN
  };
  body.data.rateLimitData.databaseLimitPerHour='300';
  body.data.rateLimitData.databasePointsSpentThisHour=3;
  body.data.rateLimitData.userHasRemainingPoints='true';
  const w=observeFreshRateLimit(body);
  assert.deepEqual(w.pointClasses,{
    application:null,database:null,user:null
  });
  assert.equal(w.classWitnesses,0);
  assert.equal(w.databaseRemaining,null);
  assert.equal(w.userHasRemainingPoints,null);
});

test('two synthetic HTTP receipts retain distinct measured rate category classes',async()=>{
  await withDir(async dir=>{
    let requests=0;
    const s=await runFreshTwoQueryProbe({
      target:target(),privateOutputDir:dir,
      send:async()=>{
        requests++;
        const reply=resp(requests===1?'rankings':'table');
        const rate=reply.body.data.rateLimitData;
        rate.currentRequest=requests===1?
          {total:10,application:9,database:8,user:0}:
          {total:6,application:5,database:0,user:0};
        rate.databaseLimitPerHour=1000;
        rate.databasePointsSpentThisHour=requests===1?120:120;
        rate.userHasRemainingPoints=null;
        return reply;
      }
    });
    assert.equal(requests,2);
    assert.equal(s.status,'RECORDED');
    assert.equal(s.observations[0].reportedTotalPoints,10);
    assert.equal(s.observations[0].appPoints,9);
    assert.equal(s.observations[0].databasePoints,8);
    assert.equal(s.observations[0].userPoints,0);
    assert.equal(s.observations[1].reportedTotalPoints,6);
    assert.equal(s.observations[1].appPoints,5);
    assert.equal(s.observations[1].databasePoints,0);
    assert.equal(s.observations[0].databaseHeadroomObserved,880);
    assert.equal(s.observations[0].pointClassWitnessCount,3);
    assert.equal(s.tableAdopted,false);
    const disk=JSON.parse(fs.readFileSync(path.join(dir,'summary.json')));
    assert.deepEqual(disk.observations,s.observations);
  });
});

test('reject extraneous fights and inconsistent shared actor before second paid query',async()=>{
  for(const change of [
    r=>r.body.data.reportData.report.overall.data.push({
      fightID:18,encounter:{id:3470},difficulty:4,
      roles:{dps:{characters:[a(2500)]}}
    }),
    r=>r.body.data.reportData.report.boss.data.push({
      fightID:18,encounter:{id:3470},difficulty:4,
      roles:{dps:{characters:[a(1300)]}}
    }),
    r=>{
      r.body.data.reportData.report.overall.data[0].roles.dps.characters.push(a(1000,10));
      r.body.data.reportData.report.boss.data[0].roles.dps.characters.push(a(1100,10));
    },
    r=>{
      r.body.data.reportData.report.overall.data[0].roles.dps.characters.push(a(1000,10));
      r.body.data.reportData.report.boss.data[0].roles.dps.characters.push({
        ...a(800,10),spec:'Elemental'
      });
    }
  ]){
    await withDir(async dir=>{
      let calls=0;
      const summary=await runFreshTwoQueryProbe({
        target:target(),privateOutputDir:dir,send:async()=>{
          calls++;
          const r=resp();
          change(r);
          return r;
        }
      });
      assert.equal(calls,1);
      assert.equal(summary.status,'NEEDS_REVIEW');
      assert.equal(summary.graphqlRequests,1);
      assert.equal(summary.tableAdopted,false);
      assert.match(summary.reason,/FRESH_(FIGHT_SCOPE_UNVERIFIED|ACTOR_METRIC_CONFLICT)/);
    });
  }
});

test('fresh table source rows independently overlap rankings by numeric report actor ID',()=>{
  const data={
    entries:[
      {id:9,name:'PrivateActorName',total:1250},
      {id:85,name:'PrivatePetName',total:550}
    ],totalTime:10000
  };
  const result=summarizeFreshTableSourceRows(target(),resp().body,data);
  assert.deepEqual(result,{
    ok:true,reason:null,sourceRows:2,sharedRankedSourceRows:1
  });
  assert.ok(!JSON.stringify(result).includes('PrivateActorName'));
  assert.ok(!JSON.stringify(result).includes('PrivatePetName'));
  assert.ok(!JSON.stringify(result).includes('1250'));
  assert.ok(!JSON.stringify(result).includes('PUBLIC_SYNTHETIC'));
});

test('unfrozen WCL table JSON cannot masquerade as comparable source rows',async()=>{
  const malformed=[
    [{},{reason:'FRESH_TABLE_ENTRIES_UNOBSERVED'}],
    [{entries:[]},{reason:'FRESH_TABLE_ENTRIES_UNOBSERVED'}],
    [{entries:[{id:88,total:1000}]},
      {reason:'FRESH_TABLE_NO_SHARED_RANKED_SOURCE'}],
    [{entries:[{id:9,total:'500'}]},
      {reason:'FRESH_TABLE_ROWS_AMBIGUOUS'}],
    [{entries:[{id:9,total:100},{id:9,total:200}]},
      {reason:'FRESH_TABLE_ROWS_AMBIGUOUS'}]
  ];
  for(const [damage,expected] of malformed){
    await withDir(async dir=>{
      let attempts=0;
      const result=await runFreshTwoQueryProbe({
        target:target(),privateOutputDir:dir,send:async()=>{
          attempts++;
          const r=resp(attempts===1?'rankings':'table');
          if(attempts===2)r.body.data.reportData.report.damage=damage;
          return r;
        }
      });
      assert.equal(attempts,2);
      assert.equal(result.graphqlRequests,2);
      assert.equal(result.status,'NEEDS_REVIEW');
      assert.equal(result.reason,expected.reason);
      assert.equal(result.sameFightTableResponseRecorded,false);
      assert.equal(result.tableAdopted,false);
      assert.equal(result.tableShapeStatus,expected.reason);
      assert.equal(result.observations.length,2);
      assert.ok(fs.existsSync(path.join(dir,'raw-2.json')));
      assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'journal.json'))).attemptedGraphql,2);
    });
  }
});

test('two matching WCL table rows yield only structural—not semantic—evidence',async()=>{
  await withDir(async dir=>{
    let attempts=0;
    const result=await runFreshTwoQueryProbe({
      target:target(),privateOutputDir:dir,send:async()=>{
        attempts++;
        const r=resp(attempts===1?'rankings':'table');
        if(attempts===2)r.body.data.reportData.report.damage={
          entries:[{id:9,total:123456},{id:88,total:3000}]
        };
        return r;
      }
    });
    assert.equal(result.status,'RECORDED');
    assert.equal(result.tableSourceRowsObserved,2);
    assert.equal(result.tableSharedRankedSourceRowsObserved,1);
    assert.equal(result.tableShapeStatus,'SHARED_SOURCE_ROWS_OBSERVED');
    assert.equal(result.actorBossTargetAndDpsDenominatorParity,'UNPROVEN');
    assert.equal(result.tableAdopted,false);
    assert.equal(attempts,2);
  });
});
