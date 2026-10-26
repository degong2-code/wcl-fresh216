import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveExactBossDps} from '../src/core/resolve-proof.mjs';

// Historical comparison oracle: narrowly transcribed wcl35Num_/wcl35ActorRef_/
// wcl35Roster_/wcl35Recover_ from the user's installed Code.js source.
// NO credential strings, report identifiers, proof rows, or production calls.
// It exists only to verify behavioral equivalence before replacing the legacy path.
function legacyNum(v) {
  if (typeof v === 'boolean' || v === null || v === '' || v === undefined) return null;
  const n=Number(v); return Number.isFinite(n)?n:null;
}
function legacyActorRef(r) {
  const id=r&&r.id;
  if ((typeof id==='number'||typeof id==='string')&&Number.isInteger(Number(id))&&Number(id)>0)
    return 'id:'+Number(id);
  const n=String((r&&r.name)||'').trim().toLowerCase();
  return n&&n!=='anonymous'?'name:'+n:null;
}
function legacyRoster(report,fid,encounter) {
  if (!(report&&report.overall&&report.boss))throw Error('REPORT_MISSING_METRIC');
  const lists=[];
  for (const kind of ['overall','boss']) {
    const fights=report[kind].data;
    if (!Array.isArray(fights)) throw Error('REPORT_FIGHTS_MISSING');
    const found=fights.filter(r=>Number(r.fightID)===fid);
    if (!(found.length===1 && found[0].encounter &&
      Number(found[0].encounter.id)===encounter && Number(found[0].difficulty)===4))
      throw Error('REPORT_FIGHT_NOT_VERIFIED');
    const chars=found[0].roles&&found[0].roles.dps&&found[0].roles.dps.characters;
    if (!Array.isArray(chars))throw Error('REPORT_ROSTER_MISSING');
    lists.push(chars);
  }
  return lists;
}
function legacyRecover(report,job,raw,fid) {
  const [all,boss]=legacyRoster(report,fid,job.id);
  const d=legacyNum(raw.amount);
  const hit=all.filter(a=>legacyNum(a.amount)!==null && Math.abs(Number(a.amount)-d)<=0.005);
  if (hit.length!==1)return null;
  const a=hit[0];
  if (String(a.class||'').toLowerCase()!==job.cls.toLowerCase() ||
    String(a.spec||'').toLowerCase()!==job.spec.toLowerCase())return null;
  const name=String(raw.name||'').trim().toLowerCase();
  if (name&&name!=='anonymous'&&String(a.name||'').trim().toLowerCase()!==name)return null;
  const ref=legacyActorRef(a);
  if (!ref||all.filter(x=>legacyActorRef(x)===ref).length!==1)return null;
  const candidates=boss.filter(x=>legacyActorRef(x)===ref);
  if (candidates.length!==1)return null;
  const b=candidates[0];
  if (String(b.class||'').toLowerCase()!==job.cls.toLowerCase() ||
    String(b.spec||'').toLowerCase()!==job.spec.toLowerCase())return null;
  const bd=legacyNum(b.amount);
  if (bd===null||bd<0||bd>d+0.005)return null;
  return bd;
}
const fight=(characters)=>({
  fightID:12,encounter:{id:3470},difficulty:4,roles:{dps:{characters}}
});
const actor=(id,name,amount,spec='Marksmanship')=>({
  id,name,amount,class:'Hunter',spec
});
const slot=(totalDps,name='Anonymous')=>({
  fightId:12,encounterId:3470,difficulty:4,
  className:'Hunter',specName:'Marksmanship',totalDps,name
});
const compare=(s,report,label)=>{
  const reference=legacyRecover(report,{id:s.encounterId,cls:s.className,spec:s.specName},
    {amount:s.totalDps,name:s.name},s.fightId);
  const actual=resolveExactBossDps(s,report)?.bossDps ?? null;
  assert.equal(actual,reference,label);
};

// Seeded reproducible synthetic data: no real report/actor IDs or live WCL calls.
let seed=1272026;
const pick=(n)=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
test('500 offline legacy-vs-new equivalence cases (synthetic same-fight shape)',()=>{
  let proved=0,rejected=0;
  for(let k=0;k<500;k++){
    const mode=pick(12), d=1000 + pick(1000);
    const base=actor(1,'ExampleHunter',d);
    const all=[base],boss=[actor(1,'ExampleHunter',d*0.65)];
    const s=slot(d);
    switch(mode){
      case 0:break; // valid
      case 1:all.push(actor(2,'OtherHunter',d));break; // ambiguous amount
      case 2:boss[0].id=2;break;
      case 3:boss.push(actor(1,'ExampleHunter',d*0.5));break;
      case 4:boss[0].amount=d+2;break;
      case 5:all[0].spec='Survival';break;
      case 6:s.name='NamedRankDifferent';break;
      case 7:all[0].amount=d+0.02;break;
      case 8:boss[0].amount=0;break;
      case 9:boss[0].amount=-1;break;
      case 10:all[0].id=null;boss[0].id=null;break; // unique name fallback
      case 11:all[0].id=null;all[0].name='Anonymous';break; // ambiguous actor
    }
    const report={overall:{data:[fight(all)]},boss:{data:[fight(boss)]}};
    const ref=legacyRecover(report,{id:s.encounterId,cls:s.className,spec:s.specName},
      {amount:s.totalDps,name:s.name},s.fightId);
    if(ref===null)rejected++;else proved++;
    compare(s,report,'synthetic case '+k+' mode '+mode);
  }
  assert.ok(proved>0&&rejected>0);
});
test('comparison covers named actor and numeric-string DPS precision',()=>{
  const s=slot('1000.004','EXAMPLEHUNTER');
  const r={overall:{data:[fight([actor('17','ExampleHunter',1000)])]},
    boss:{data:[fight([actor(17,'ExampleHunter','850.125')])}};
  compare(s,r,'named actor and string DPS');
});
test('strictening: malformed actor identifier with boolean type is rejected as id',()=>{
  const r={overall:{data:[fight([actor(true,'Anonymous',1000)])]},
    boss:{data:[fight([actor(true,'Anonymous',800)])}};
  assert.equal(resolveExactBossDps(slot(1000),r),null);
});
test('strictening: positive, integer fight/encounter/difficulty scope required',()=>{
  const r={overall:{data:[fight([actor(1,'ExampleHunter',1000)])]},
    boss:{data:[fight([actor(1,'ExampleHunter',800)])}};
  assert.equal(resolveExactBossDps({...slot(1000),fightId:0},r),null);
  assert.equal(resolveExactBossDps({...slot(1000),encounterId:-1},r),null);
});
