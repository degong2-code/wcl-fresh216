import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';

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
