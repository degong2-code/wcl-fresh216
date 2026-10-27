import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {buildFreshQueryPair,summarizeFreshRankings,runFreshTwoQueryProbe}
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
