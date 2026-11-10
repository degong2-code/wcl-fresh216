import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {canonicalCatalogJson} from '../src/core/environment-discovery.mjs';
import {
  governanceDigest,admitGovernedSignedWclCapture,makeGenesisCaptureHead
} from '../src/adapters/wcl-capture-trust-governance.mjs';
import {openSqliteCaptureLedger} from '../src/adapters/wcl-sqlite-capture-ledger.mjs';

const bytes=o=>new TextEncoder().encode(JSON.stringify(o));
const sha=b=>createHash('sha256').update(b).digest('hex');
const deep=o=>structuredClone(o);
function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'wcl-ledger-'));
  const dbPath=join(dir,'captured-admissions.sqlite');
  let ledger=openSqliteCaptureLedger({dbPath});
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  const expected={sourceNamespace:'synthetic-retail',expansionId:99,locale:'en_US'};
  const capture=bytes({schema:'WCL_CAPTURED_DIRECTORY_AND_ZONES_V1',
    sourceNamespace:'synthetic-retail',expansionId:99,
    directory:{data:{worldData:{expansions:[{id:99,name:'Synthetic'}]},
      gameData:{classes:[]}}},
    zones:{data:{worldData:{zones:[]}}}});
  const pin={sourceRef:'snap:wcl',sourceKind:'WCL_CATALOG_BUNDLE',
    sourceSha256:sha(capture),originHost:'www.warcraftlogs.com',
    endpoint:'/api/v2/client',namespace:'synthetic-retail',
    locale:'en_US',capturedAtMs:10,validUntilMs:900};
  const captures=new Map([[pin.sourceRef,capture]]);
  const trustedKey={keyId:'test-key-1',
    publicKeyPem:publicKey.export({type:'spki',format:'pem'}),
    status:'ACTIVE',validFromMs:0,validUntilMs:1000,allowedExpansionIds:[99,100]};
  let registry={schema:'WCL_CAPTURE_TRUST_REGISTRY_V1',
    sourceNamespace:expected.sourceNamespace,revision:1,
    activeKeyId:trustedKey.keyId,keys:[trustedKey],
    revokedCaptureSetIds:[]};
  const signBundle=({id='set-01',issuedAtMs=50,expansionId=99}={})=>{
    const payload={schema:'WCL_CAPTURE_SET_V1',
      captureSetId:id,sourceNamespace:'synthetic-retail',
      expansionId,locale:'en_US',issuedAtMs,expiresAtMs:800,
      wclPin:deep(pin),sourcePins:[],specCrosswalks:[]};
    const message=Buffer.from('WCL_CAPTURE_SET_V1\n'+canonicalCatalogJson(payload));
    return {schema:'WCL_SIGNED_CAPTURE_V1',payload,
      signature:{alg:'Ed25519',keyId:trustedKey.keyId,
        valueBase64:sign(null,message,privateKey).toString('base64')}};
  };
  const counts={reads:0};
  const readCapture=async ref=>{counts.reads++;return Uint8Array.from(captures.get(ref)??[]);};
  const admit=async ({signedBundle=signBundle(),registryOverride=registry,
    expectedOverride=expected,priorHead=null,commitHead=null}={})=>
    admitGovernedSignedWclCapture({
      signedBundle,registry:registryOverride,
      registrySha256:governanceDigest(registryOverride),
      priorHead:priorHead??ledger.readHead(expectedOverride),
      commitHead:commitHead??ledger.commitHead,
      expected:expectedOverride,readCapture,nowMs:100
    });
  const close=()=>{
    ledger.close();rmSync(dir,{recursive:true,force:true});
  };
  ledger.initializeScope(expected);
  return {dir,dbPath,expected,pin,captures,counts,signBundle,admit,
    close,registry,readHead:()=>ledger.readHead(expected),
    ledger:()=>ledger,
    reopen:()=>{ledger.close();ledger=openSqliteCaptureLedger({dbPath});},
    currentLedger:()=>ledger};
}
async function withStore(fn){const f=fixture();try{await fn(f);}finally{f.close();}}
function nextFrom(head,{id,issuedAtMs,registryRevision=1,payloadHash='b'.repeat(64)}){
  return {
    schema:'WCL_CAPTURE_GOVERNANCE_HEAD_V1',
    sourceNamespace:head.sourceNamespace,expansionId:head.expansionId,
    generation:head.generation+1,registryRevision,
    lastIssuedAtMs:issuedAtMs,lastCaptureSetId:id,
    lastPayloadSha256:payloadHash
  };
}
const direct=(ledger,head,next,{registrySha256='a'.repeat(64),signerId='key-1'}={})=>
  ledger.commitHead({expectedHeadSha256:governanceDigest(head),nextHead:next,
    nextHeadSha256:governanceDigest(next),registrySha256,signerId});

test('genesis is explicit, persisted and never reset on database reopen',()=>withStore(async f=>{
  assert.equal(existsSync(f.dbPath),true);
  assert.equal(f.readHead().generation,0);
  const again=f.ledger().initializeScope(f.expected);
  assert.equal(again.created,false);
  f.reopen();
  assert.equal(f.readHead().generation,0);
  assert.equal(f.currentLedger().initializeScope(f.expected).created,false);
}));

test('full signed governance admission commits into real SQLite and survives reopen',()=>withStore(async f=>{
  const result=await f.admit();
  assert.equal(result.governanceReceipt.commitStatus,'CONFIRMED_BY_TRUSTED_HOST_CAS');
  assert.equal(f.readHead().generation,1);
  assert.equal(f.currentLedger().readAdmission('set-01').signer_id,'test-key-1');
  assert.equal(f.currentLedger().readAdmission('set-01').head_sha256,
    result.governanceReceipt.ledgerHeadSha256);
  f.reopen();
  assert.equal(f.readHead().generation,1);
  assert.equal(f.readHead().lastCaptureSetId,'set-01');
  assert.equal(f.currentLedger().readAdmission('set-01').registry_revision,1);
}));

test('exact replay is rejected without reading captures or committing again',()=>withStore(async f=>{
  await f.admit();
  const before=f.counts.reads;
  await assert.rejects(()=>f.admit(),/GOVERNANCE_REPLAY_REVOKED_OR_SIGNER_INVALID/);
  assert.equal(f.counts.reads,before);
  assert.equal(f.readHead().generation,1);
}));

test('an old capture ID cannot return after unrelated newer admissions, even with fresh signatures',()=>withStore(async f=>{
  await f.admit();
  await f.admit({signedBundle:f.signBundle({id:'set-02',issuedAtMs:70})});
  assert.equal(f.readHead().generation,2);
  await assert.rejects(()=>f.admit({
    signedBundle:f.signBundle({id:'set-01',issuedAtMs:90})
  }),/GOVERNANCE_ATOMIC_LEDGER_COMMIT_UNCONFIRMED/);
  assert.equal(f.readHead().generation,2);
  assert.equal(f.currentLedger().readAdmission('set-01').generation,1);
  assert.equal(f.currentLedger().readAdmission('set-02').generation,2);
}));

test('global capture-ID uniqueness holds across different expansion scopes in the SAME DB',()=>withStore(async f=>{
  await f.admit();
  const other={sourceNamespace:'synthetic-retail',expansionId:100};
  const otherHead=f.currentLedger().initializeScope(other).head;
  const collision=nextFrom(otherHead,{id:'set-01',issuedAtMs:60,payloadHash:'c'.repeat(64)});
  const result=await direct(f.currentLedger(),otherHead,collision);
  assert.equal(result.committed,false);
  assert.match(result.reason,/GLOBAL_CAPTURE_ID/);
  assert.equal(f.currentLedger().readHead(other).generation,0);
}));

test('multiple separate SQLite connections serialize stale compare-and-swap',()=>withStore(async f=>{
  const second=openSqliteCaptureLedger({dbPath:f.dbPath});
  try{
    const previous=f.readHead();
    const nextA=nextFrom(previous,{id:'set-A',issuedAtMs:51});
    const nextB=nextFrom(previous,{id:'set-B',issuedAtMs:52,payloadHash:'c'.repeat(64)});
    const outcomes=await Promise.all([
      direct(f.currentLedger(),previous,nextA),
      direct(second,previous,nextB)
    ]);
    assert.equal(outcomes.filter(x=>x.committed).length,1);
    assert.equal(outcomes.filter(x=>!x.committed).length,1);
    assert.equal(f.currentLedger().readHead(f.expected).generation,1);
    assert.equal(second.readHead(f.expected).generation,1);
  }finally{second.close();}
}));

test('SQLite trigger interruption rolls back BOTH admission insert and head update',()=>withStore(async f=>{
  const fault=new DatabaseSync(f.dbPath);
  fault.exec("CREATE TRIGGER abort_head BEFORE UPDATE ON capture_heads BEGIN SELECT RAISE(ABORT,'synthetic-crash'); END;");
  fault.close();
  await assert.rejects(()=>f.admit(),/synthetic-crash/);
  assert.equal(f.readHead().generation,0);
  assert.equal(f.currentLedger().readAdmission('set-01'),null);
  const recover=new DatabaseSync(f.dbPath);
  recover.exec('DROP TRIGGER abort_head');
  recover.close();
  const admitted=await f.admit();
  assert.equal(admitted.nextHead.generation,1);
}));

test('reopen in a separate Node PROCESS reads the committed head and ID history',()=>withStore(async f=>{
  await f.admit();
  const uri=new URL('../src/adapters/wcl-sqlite-capture-ledger.mjs',import.meta.url).href;
  const code=[
    'import {openSqliteCaptureLedger} from '+JSON.stringify(uri)+';',
    'const s=openSqliteCaptureLedger({dbPath:process.argv[1]});',
    'const h=s.readHead({sourceNamespace:"synthetic-retail",expansionId:99});',
    'const a=s.readAdmission("set-01");',
    'process.stdout.write(JSON.stringify({generation:h.generation,id:a.capture_set_id}));',
    's.close();'
  ].join('\n');
  const result=spawnSync(process.execPath,['--input-type=module','-e',code,f.dbPath],
    {encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),{generation:1,id:'set-01'});
}));

test('catalog hash and signer revision are preserved as durable audit evidence',()=>withStore(async f=>{
  await f.admit();
  const row=f.currentLedger().readAdmission('set-01');
  assert.match(row.signed_payload_sha256,/^[0-9a-f]{64}$/);
  assert.equal(row.registry_sha256,governanceDigest(f.registry));
  assert.equal(row.registry_revision,1);
  assert.equal(row.source_namespace,'synthetic-retail');
  assert.equal(row.expansion_id,99);
  assert.equal(Object.hasOwn(row,'raw_capture_bytes'),false);
}));

test('same registry revision with changed hash is rejected; higher version is allowed',()=>withStore(async f=>{
  await f.admit();
  const first=f.readHead();
  const equalVersion=nextFrom(first,{id:'set-02',issuedAtMs:70,
    payloadHash:'c'.repeat(64)});
  const rejected=await direct(f.currentLedger(),first,equalVersion,{
    registrySha256:'d'.repeat(64)
  });
  assert.equal(rejected.committed,false);
  assert.equal(f.readHead().generation,1);
  const upgraded=nextFrom(first,{id:'set-02',issuedAtMs:70,
    registryRevision:2,payloadHash:'c'.repeat(64)});
  const accepted=await direct(f.currentLedger(),first,upgraded,{
    registrySha256:'d'.repeat(64)});
  assert.equal(accepted.committed,true);
  assert.equal(f.readHead().registryRevision,2);
}));

test('stale or incorrectly digested transition never advances the durable ledger',()=>withStore(async f=>{
  const head=f.readHead();
  const next=nextFrom(head,{id:'set-01',issuedAtMs:50});
  const wrong=await f.currentLedger().commitHead({
    expectedHeadSha256:'a'.repeat(64),nextHead:next,
    nextHeadSha256:governanceDigest(next),
    registrySha256:'b'.repeat(64),signerId:'key-1'
  });
  assert.equal(wrong.committed,false);
  await assert.rejects(()=>f.currentLedger().commitHead({
    expectedHeadSha256:governanceDigest(head),nextHead:next,
    nextHeadSha256:'b'.repeat(64),
    registrySha256:'b'.repeat(64),signerId:'key-1'
  }),/SQLITE_LEDGER_TRANSITION_INVALID/);
  assert.equal(f.readHead().generation,0);
}));

test('a modified head file row is detected and NEVER silently treated as genesis',()=>withStore(async f=>{
  await f.admit();
  const external=new DatabaseSync(f.dbPath);
  external.prepare('UPDATE capture_heads SET head_sha256=? WHERE source_namespace=?')
    .run('f'.repeat(64),'synthetic-retail');
  external.close();
  assert.throws(()=>f.readHead(),/SQLITE_LEDGER_HEAD_CORRUPT_OR_SCOPE_DRIFT/);
  assert.throws(()=>f.currentLedger().initializeScope(f.expected),
    /SQLITE_LEDGER_HEAD_CORRUPT_OR_SCOPE_DRIFT/);
}));

test('uninitialized scope, memory DB path and unsupported DB schema fail closed',()=>withStore(async f=>{
  assert.throws(()=>f.currentLedger().readHead({
    sourceNamespace:'synthetic-retail',expansionId:101
  }),/SQLITE_LEDGER_UNINITIALIZED_OR_MALFORMED/);
  assert.throws(()=>openSqliteCaptureLedger({dbPath:':memory:'}),
    /SQLITE_LEDGER_FILE_PATH_REQUIRED/);
  const remote=new DatabaseSync(f.dbPath);
  remote.exec('PRAGMA user_version = 99');
  remote.close();
  assert.throws(()=>openSqliteCaptureLedger({dbPath:f.dbPath}),
    /SQLITE_LEDGER_SCHEMA_UNSUPPORTED/);
  // Reopen failure intentionally leaves the fixture's handle already closed.
  const patch=new DatabaseSync(f.dbPath);
  patch.exec('PRAGMA user_version = 1');
  patch.close();
  f.reopen();
}));

test('a corrupted persisted admission row blocks new CAS without rewriting the head',()=>withStore(async f=>{
  await f.admit();
  const external=new DatabaseSync(f.dbPath);
  external.prepare('UPDATE capture_admissions SET signed_payload_sha256=? WHERE capture_set_id=?')
    .run('e'.repeat(64),'set-01');
  external.close();
  await assert.rejects(()=>f.admit({
    signedBundle:f.signBundle({id:'set-02',issuedAtMs:70})
  }),/SQLITE_LEDGER_AUDIT_CHAIN_BROKEN/);
  assert.equal(f.readHead().generation,1);
  assert.equal(f.currentLedger().readAdmission('set-02'),null);
});

test('ledger persists only compact metadata, not signed keys or raw capture bytes',()=>withStore(async f=>{
  await f.admit();
  const sql=new DatabaseSync(f.dbPath);
  const tables=sql.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all().map(x=>x.name);
  assert.deepEqual(tables,['capture_admissions','capture_heads']);
  const columns=sql.prepare('PRAGMA table_info(capture_admissions)')
    .all().map(x=>x.name);
  assert.equal(columns.includes('source_bytes'),false);
  assert.equal(columns.includes('private_key'),false);
  sql.close();
}));
