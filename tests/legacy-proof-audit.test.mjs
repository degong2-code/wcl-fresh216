import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {auditLegacyProof} from '../src/core/legacy-proof-audit.mjs';

const scope='12.1|1|2026-10-08|2026-10-12|4', job='네크잘리|Hunter|Marksmanship';
const sha=t=>createHash('sha256').update(t).digest('hex');
const round2=n=>Math.round(n*100)/100;
const mean=a=>a.reduce((s,n)=>s+n,0)/a.length;
const metrics=x=>[round2(x[0]),round2(x[29]),round2(x[99]),
  round2(mean(x.slice(0,30))),round2(mean(x))];
const make=({missing=[],status='DONE',uyBlank=false}={})=>{
  const at=Date.parse('2026-10-09T20:00:00+09:00');
  const overall=Array.from({length:100},(_,i)=>({
    amount:5000-i*12,name:'Synthetic'+i,characterID:i+1,
    startTime:at,report:{code:'FAKE-REPORT-'+(i%3),fightID:i+1}
  }));
  const boss=Array.from({length:100},(_,i)=>({
    amount:4500-i*11,name:'Synthetic'+i,characterID:i+1,
    startTime:at,report:{code:'FAKE-REPORT-'+(i%3),fightID:i+1}
  }));
  const fingerprint=r=>[r.amount,r.name,r.characterID,r.report.code,r.report.fightID,String(r.startTime)];
  const totalHash=sha(JSON.stringify(overall.map(fingerprint)));
  const bossHash=sha(JSON.stringify(boss.map(fingerprint)));
  const values=overall.map((r,i)=>missing.includes(i)?null:
    Math.round(r.amount*0.7*100)/100);
  const observed=values.filter(v=>v!==null).length;
  const total=overall.map(r=>r.amount),bv=boss.map(r=>r.amount);
  const rawRow=[
    '네크잘리','Hunter','Marksmanship','meta',
    ...metrics(total),...metrics(bv),100,100,'','','',
    ...Array(5).fill('')
  ];
  // A:T must be 20 columns; U:Y is the five non-boss ratios.
  rawRow.length=25;
  const snapshot={version:1,scope,runId:'PRIVATE_FAKE_TEST_RUN',
    rawRowNumber:4,key:job,encounter:3470,capturedAt:'synthetic',
    producer:{overallComplete:true,bossComplete:true,
      dateFilterVerified:true,pageSetComplete:true},
    overall,boss,overallSha256:totalHash,bossSha256:bossHash,
    expectedRawDps:metrics(total),expectedRawBoss:metrics(bv)};
  const proofRow=[job,scope,totalHash,bossHash,JSON.stringify(values),
    JSON.stringify([]),status,observed,100-observed,'synthetic only'];
  const fraction=(n)=>{
    const target=values.slice(0,n);if(target.some(x=>x===null))return null;
    return Math.round((total.slice(0,n).reduce((a,b)=>a+b,0)-
      target.reduce((a,b)=>a+b,0))/
      total.slice(0,n).reduce((a,b)=>a+b,0)*1e6)/1e6;
  };
  const perRank=i=>values[i]===null?null:Math.round((total[i]-values[i])/total[i]*1e6)/1e6;
  const uy=[perRank(0),perRank(29),perRank(99),fraction(30),fraction(100)];
  if(!uyBlank)uy.forEach((v,i)=>{if(v!==null)rawRow[i+20]=v;});
  return {snapshot,rawRow,proofRow,scopeKey:scope,expected:uy};
};

test('synthetic source hashes + A:T + full PROOF map to legacy EXACT100 without new actor claim',()=>{
  const input=make(),a=auditLegacyProof(input);
  assert.equal(a.classification,'LEGACY_VALIDATED_EXACT100');
  assert.equal(a.verifiedBossSlots,100);
  assert.deepEqual(a.kpiUY,input.expected);
  assert.equal(a.canPromoteToNewActorProof,false);
  assert.equal(a.perRankActorIdentityAvailable,false);
  assert.equal(a.furtherWclRequests,0);
  assert.equal(a.readOnly,true);
});
test('a DONE job with 98 verified slots is exhausted, not EXACT100',()=>{
  const x=make({missing:[31,41],status:'DONE'});
  const a=auditLegacyProof(x);
  assert.equal(a.classification,'LEGACY_VALIDATED_PARTIAL');
  assert.equal(a.proofState,'DONE');
  assert.equal(a.verifiedBossSlots,98);
  assert.equal(a.kpiUY[4],null);
  assert.notEqual(a.kpiUY[3],null);
});
test('missing top-30 boss rank makes top30 U:Y unknown rather than estimated',()=>{
  const x=make({missing:[29],status:'PARTIAL'});
  const a=auditLegacyProof(x);
  assert.equal(a.kpiUY[1],null);
  assert.equal(a.kpiUY[3],null);
  assert.equal(a.kpiUY[4],null);
  assert.notEqual(a.kpiUY[2],null);
});
test('read-only audit reports pending U:Y without writing old Google Sheet',()=>{
  const x=make({uyBlank:true});const source=JSON.stringify(x);
  const a=auditLegacyProof(x);
  assert.deepEqual(a.pendingUYColumns,[21,22,23,24,25]);
  assert.equal(JSON.stringify(x),source);
});
test('deny hash drift in immutable full ranking and legacy PROOF',()=>{
  const x=make();x.snapshot.overall[3].report.fightID=999;
  assert.throws(()=>auditLegacyProof(x),/LEGACY_RANK_SNAPSHOT_HASH_DRIFT/);
  const p=make();p.proofRow[2]='f'.repeat(64);
  assert.throws(()=>auditLegacyProof(p),/LEGACY_PROOF_SNAPSHOT_HASH_DRIFT/);
});
test('deny RAW A:T metric drift or foreign job/scope',()=>{
  const x=make();x.rawRow[7]+=2;
  assert.throws(()=>auditLegacyProof(x),/LEGACY_RAW_METRIC_DRIFT/);
  const y=make();y.proofRow[0]='Different|Hunter|Marksmanship';
  assert.throws(()=>auditLegacyProof(y),/LEGACY_JOB_IDENTITY_DRIFT/);
  const z=make();z.scopeKey='other scope';
  assert.throws(()=>auditLegacyProof(z),/LEGACY_SNAPSHOT_SCOPE/);
});
test('deny stale/U:Y conflicts and claimed values that source proof lacks',()=>{
  const x=make();x.rawRow[20]=0.25;
  assert.throws(()=>auditLegacyProof(x),/LEGACY_UY_METRIC_CONFLICT/);
  const y=make({missing:[0],status:'PARTIAL'});y.rawRow[20]=0.3;
  assert.throws(()=>auditLegacyProof(y),/LEGACY_UY_METRIC_CONFLICT/);
});
test('deny tampered count/status, actorless proof value and missing producer gate',()=>{
  const x=make();x.proofRow[7]=99;
  assert.throws(()=>auditLegacyProof(x),/LEGACY_PROOF_COUNT_OR_STATE/);
  const y=make();const vals=JSON.parse(y.proofRow[4]);vals[8]=100000;
  y.proofRow[4]=JSON.stringify(vals);
  assert.throws(()=>auditLegacyProof(y),/LEGACY_BOSS_VALUE_INVALID/);
  const z=make();z.snapshot.producer.pageSetComplete=false;
  assert.throws(()=>auditLegacyProof(z),/LEGACY_SNAPSHOT_NOT_COMMITTED/);
});
test('deny malformed PROOF JSON and unknown attempted-fight digest',()=>{
  const x=make();x.proofRow[4]='not JSON';
  assert.throws(()=>auditLegacyProof(x),/LEGACY_PROOF_VECTOR_SHAPE/);
  const y=make();y.proofRow[5]='["bad-id"]';
  assert.throws(()=>auditLegacyProof(y),/LEGACY_ATTEMPTS_INVALID/);
});
test('same raw input remains unchanged on repeated comparisons',()=>{
  const x=make(),before=JSON.stringify(x);
  assert.deepEqual(auditLegacyProof(x),auditLegacyProof(x));
  assert.equal(JSON.stringify(x),before);
});
