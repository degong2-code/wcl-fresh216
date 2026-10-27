import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {runPrivateTwoQueryProbe,validatePrivateProbeGroup}
  from '../src/core/private-two-query-probe.mjs';

const group=()=>({
  scopeKey:'HEROIC_SYNTHETIC',reportCode:'SYNTHETIC_ONLY',
  reportRevision:5,fightId:12,encounterId:3470,difficulty:4,
  slots:[{jobKey:'Boss|Hunter|Marksmanship',rank:12,
    snapshotSha:'a'.repeat(64),totalDps:1000,
    className:'Hunter',specName:'Marksmanship',
    name:'ExampleHunter'}]
});
const actor=(amount)=>({
  id:3,amount,name:'ExampleHunter',class:'Hunter',spec:'Marksmanship'
});
const fight=(amount)=>({
  fightID:12,encounter:{id:3470},difficulty:4,
  roles:{dps:{characters:[actor(amount)]}}
});
const response=(kind,patch={})=>({
  httpStatus:200,
  body:{data:{
    rateLimitData:{
      currentRequest:{total:11},limitPerHour:1000,
      pointsSpentThisHour:200,pointsResetIn:1200
    },
    reportData:{report:{
      code:'SYNTHETIC_ONLY',revision:5,
      ...(kind==='rankings'
        ?{overall:{data:[fight(1000)]},boss:{data:[fight(700)]}}
        :{damage:{entries:[{id:3,total:100000}],total:100000}})
    }}
  }},
  ...patch
});
const withDir=async fn=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fresh216-pair-offline-'));
  try{return await fn(root,path.join(root,'new-private-receipt'));}
  finally{fs.rmSync(root,{recursive:true,force:true});}
};

test('synthetic two-call success records both, never certifies table parity',async()=>{
  await withDir(async(root,out)=>{
    const calls=[];
    const result=await runPrivateTwoQueryProbe({
      group:group(),privateOutputDir:out,
      send:async query=>{
        calls.push(query);
        const journal=JSON.parse(fs.readFileSync(path.join(out,'journal.json')));
        assert.equal(journal.status,'IN_FLIGHT');
        assert.equal(journal.transportCalls,calls.length);
        return response(calls.length===1?'rankings':'table');
      }
    });
    assert.equal(calls.length,2);
    assert.equal(result.transportCalls,2);
    assert.equal(result.status,'COMPLETED_QUERY');
    assert.equal(result.assessment.requestsRecorded,2);
    assert.equal(result.assessment.adoptTable,false);
    assert.equal(result.assessment.semanticVerdict,'NOT_EQUIVALENT_OR_UNPROVEN');
    assert.equal(fs.existsSync(path.join(out,'response-1.json')),true);
    assert.equal(fs.existsSync(path.join(out,'response-2.json')),true);
    const journal=JSON.parse(fs.readFileSync(path.join(out,'journal.json')));
    assert.equal(journal.completion,'BOTH_QUERIES_OBSERVED');
    assert.equal(journal.observations[0].reportedTotalPoints,11);
    assert.equal(journal.observations[0].categoryCosts.database,null);
    if(process.platform!=='win32'){
      assert.equal(fs.statSync(path.join(out,'journal.json')).mode&0o777,0o600);
      assert.equal(fs.statSync(out).mode&0o777,0o700);
    }
  });
});

test('report revision drift stops BEFORE table attempt',async()=>{
  await withDir(async(root,out)=>{
    let calls=0;
    const summary=await runPrivateTwoQueryProbe({
      group:group(),privateOutputDir:out,
      send:async()=>{
        calls++;
        const r=response('rankings');
        r.body.data.reportData.report.revision=6;
        return r;
      }
    });
    assert.equal(calls,1);
    assert.equal(summary.failure,'REPORT_REVISION_OR_CODE_CHANGED');
    assert.equal(summary.reviewRequired,true);
    assert.equal(fs.existsSync(path.join(out,'response-2.json')),false);
  });
});

test('unverified actor or BossDPS stops second request',async()=>{
  await withDir(async(root,out)=>{
    let calls=0;
    const summary=await runPrivateTwoQueryProbe({
      group:group(),privateOutputDir:out,
      send:async()=>{calls++;const r=response('rankings');
        r.body.data.reportData.report.boss.data[0].roles.dps.characters[0].id=8;
        return r;}
    });
    assert.equal(calls,1);
    assert.equal(summary.failure,'RANKED_ACTOR_BOSSDPS_UNVERIFIED');
  });
});

test('unavailable point witness and headroom stop without second request',async()=>{
  await withDir(async(root,out)=>{
    let calls=0;
    const summary=await runPrivateTwoQueryProbe({
      group:group(),privateOutputDir:out,send:async()=>{
        calls++;const r=response('rankings');
        delete r.body.data.rateLimitData.pointsSpentThisHour;
        return r;
      }
    });
    assert.equal(calls,1);
    assert.equal(summary.failure,'APP_HEADROOM_UNWITNESSED_OR_LOW');
  });
});

test('timeout marks durable uncertainty and refuses replay in same directory',async()=>{
  await withDir(async(root,out)=>{
    let calls=0;
    const opts={group:group(),privateOutputDir:out,
      send:async()=>{calls++;throw Error('synthetic timeout: no response')}};
    const summary=await runPrivateTwoQueryProbe(opts);
    assert.equal(calls,1);
    assert.equal(summary.failure,'UNCERTAIN_TRANSPORT_MAY_HAVE_SPENT_POINTS');
    assert.equal(summary.transportCalls,1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(out,'journal.json'))).status,'NEEDS_REVIEW');
    await assert.rejects(()=>runPrivateTwoQueryProbe(opts),/EEXIST/);
    assert.equal(calls,1);
  });
});

test('table GraphQL error is recorded, no automatic extra or third call',async()=>{
  await withDir(async(root,out)=>{
    let calls=0;
    const summary=await runPrivateTwoQueryProbe({
      group:group(),privateOutputDir:out,send:async()=>{
        calls++;
        if(calls===1)return response('rankings');
        const r=response('table');r.body.errors=[{message:'synthetic failure'}];
        return r;
      }
    });
    assert.equal(calls,2);
    assert.equal(summary.status,'NEEDS_REVIEW');
    assert.equal(summary.failure,'HTTP_OR_GRAPHQL_ERROR');
    assert.equal(summary.assessment.status,'REQUEST_OR_REVISION_NEEDS_REVIEW');
  });
});

test('fixture must supply rank snapshot, actor class/spec and known revision',async()=>{
  for(const patch of [
    {reportRevision:null},{slots:[]},
    {slots:[{...group().slots[0],snapshotSha:'not-a-sha'}]},
    {slots:[{...group().slots[0],totalDps:-1}]}
  ]) assert.throws(()=>validatePrivateProbeGroup({...group(),...patch}),
    /PRIVATE_PROBE_(FIXTURE|SLOT)_INVALID/);
});
