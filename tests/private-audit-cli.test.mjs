import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const cli=path.resolve('tools/audit-private-evidence.mjs');
const run=(file)=>spawnSync(process.execPath,[cli,file],
  {encoding:'utf8',timeout:10000,env:{...process.env}});
test('private evidence runner rejects nonabsolute path without leaking a source string',()=>{
  const x=run('SECRET_REPORT_CODE.json');
  assert.equal(x.status,1);
  assert.equal(JSON.parse(x.stdout).code,'PRIVATE_ABSOLUTE_JSON_PATH_REQUIRED');
  assert.doesNotMatch(x.stdout+x.stderr,/SECRET_REPORT_CODE/);
});
test('invalid private input gives a constant error, never an embedded secret',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wcl-audit-private-'));
  try{
    const file=path.join(dir,'private.json');
    fs.writeFileSync(file,'{"records":["PRIVATE_PLAYER_NAME",SECRET_REPORT_CODE]}',{mode:0o600});
    const x=run(file);
    assert.equal(x.status,1);
    assert.equal(JSON.parse(x.stdout).code,'PRIVATE_INPUT_UNAVAILABLE_OR_INVALID');
    assert.doesNotMatch(x.stdout+x.stderr,/PRIVATE_PLAYER_NAME|SECRET_REPORT_CODE|private\.json/);
  }finally{fs.rmSync(dir,{force:true,recursive:true});}
});
test('invalid records print safe indices and error codes, never names or reports',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wcl-audit-private-'));
  try{
    const file=path.join(dir,'private.json');
    fs.writeFileSync(file,JSON.stringify({records:[{
      scopeKey:'PRIVATE_SCOPE',snapshot:{rawRowNumber:4,key:'PRIVATE_PLAYER_NAME'},
      proofRow:[],rawRow:[],reportCode:'SECRET_REPORT_CODE'
    }]}),{mode:0o600});
    const x=run(file);
    assert.equal(x.status,1);
    const result=JSON.parse(x.stdout);
    assert.equal(result.status,'REQUIRES_REVIEW');
    assert.deepEqual(result.errors,[{index:1,code:'LEGACY_INPUT_SHAPE'}]);
    assert.equal(result.wclRequests,0);
    assert.equal(result.sheetsWrites,0);
    assert.doesNotMatch(x.stdout+x.stderr,/PRIVATE_SCOPE|PRIVATE_PLAYER_NAME|SECRET_REPORT_CODE|private\.json/);
  }finally{fs.rmSync(dir,{force:true,recursive:true});}
});

test('private CLI can audit a genuine-shape synthetic committed row and disclose only counts',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wcl-audit-private-'));
  try{
    const sha=s=>createHash('sha256').update(s).digest('hex');
    const stamp=Date.parse('2026-10-09T20:00:00+09:00');
    const mk=(base,step)=>Array.from({length:100},(_,i)=>({
      amount:base-i*step,name:'PRIVATE_PLAYER_NAME_'+i,characterID:i+1,
      startTime:stamp,report:{code:'SECRET_REPORT_CODE',fightID:i+1}
    }));
    const overall=mk(5000,12),boss=mk(4000,10);
    const fingerprint=rows=>sha(JSON.stringify(rows.map(r=>[
      r.amount,r.name,r.characterID,r.report.code,r.report.fightID,
      String(r.startTime)
    ])));
    const score=rows=>rows.map(r=>r.amount);
    const round2=n=>Math.round(n*100)/100;
    const mean=arr=>arr.reduce((a,b)=>a+b,0)/arr.length;
    const metric=arr=>[round2(arr[0]),round2(arr[29]),round2(arr[99]),
      round2(mean(arr.slice(0,30))),round2(mean(arr))];
    const scope='12.1|1|2026-10-08|2026-10-12|4',job='PRIVATE_PLAYER_JOB';
    const totalHash=fingerprint(overall),bossHash=fingerprint(boss);
    const rawRow=Array(25).fill('');
    rawRow.splice(0,3,'PRIVATE','PLAYER','JOB');
    metric(score(overall)).forEach((v,i)=>rawRow[i+4]=v);
    metric(score(boss)).forEach((v,i)=>rawRow[i+9]=v);
    rawRow[14]=100;rawRow[15]=100;
    const snapshot={version:1,scope,runId:'SYNTHETIC_RUN_123',
      rawRowNumber:4,key:'PRIVATE|PLAYER|JOB',encounter:3470,
      producer:{overallComplete:true,bossComplete:true,
        dateFilterVerified:true,pageSetComplete:true},overall,boss,
      overallSha256:totalHash,bossSha256:bossHash};
    const payload=JSON.stringify(snapshot),chunks=[];
    for(let i=0;i<payload.length;i+=12000)chunks.push(payload.slice(i,i+12000));
    const row=['COMMITTED',snapshot.runId,scope,snapshot.key,4,sha(payload),
      chunks.length,''];for(let i=0;i<24;i++)row.push(chunks[i]||'');
    const values=overall.map(r=>round2(r.amount*0.7));
    const proofRow=[snapshot.key,scope,totalHash,bossHash,JSON.stringify(values),
      '[]','DONE',100,0,''];
    const file=path.join(dir,'private.json');
    fs.writeFileSync(file,JSON.stringify({records:[{
      snapshot,proofRow,rawRow,scopeKey:scope,g3StorageRow:row
    }]}),{mode:0o600});
    const x=run(file);
    assert.equal(x.status,0);
    const result=JSON.parse(x.stdout);
    assert.equal(result.status,'COMPLETE_READ_ONLY');
    assert.equal(result.sourceCommitAttested,1);
    assert.equal(result.legacyExact100,1);
    assert.equal(result.verifiedSlots,100);
    assert.equal(result.actorLevelProofPromoted,0);
    assert.doesNotMatch(x.stdout+x.stderr,/PRIVATE|SECRET_REPORT_CODE|private\.json|5000/);
  }finally{fs.rmSync(dir,{force:true,recursive:true});}
});
