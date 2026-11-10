import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,readFileSync,existsSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {openSqliteCaptureLedger} from '../src/adapters/wcl-sqlite-capture-ledger.mjs';
import {governanceDigest} from '../src/adapters/wcl-capture-trust-governance.mjs';
import {candidateWclLedgerAnchors,inspectWclSqliteLedger}
  from '../src/adapters/wcl-sqlite-ledger-recovery.mjs';

const script=fileURLToPath(new URL('../tools/wcl-platform-ledger-host.mjs',import.meta.url));
const ps1=readFileSync(new URL('../tools/Invoke-WclLedgerHost.ps1',import.meta.url),'utf8');
const hex=n=>n.toString(16).padStart(64,'0');
function setup(){
  const root=mkdtempSync(join(tmpdir(),'wcl-ledger-cli-'));
  const dbPath=join(root,'ledger.sqlite');
  const backupRoot=join(root,'backups');mkdirSync(backupRoot);
  const anchorPath=join(root,'out-of-band-fixture.json');
  const scope={sourceNamespace:'fixture-retail',expansionId:99};
  const ledger=openSqliteCaptureLedger({dbPath});
  ledger.initializeScope(scope);
  const emitAnchors=()=>{
    const anchors=candidateWclLedgerAnchors(inspectWclSqliteLedger({dbPath}));
    writeFileSync(anchorPath,JSON.stringify(anchors));
    return anchors;
  };
  const advance=async()=>{
    const old=ledger.readHead(scope);
    const next={schema:'WCL_CAPTURE_GOVERNANCE_HEAD_V1',
      sourceNamespace:scope.sourceNamespace,expansionId:scope.expansionId,
      generation:old.generation+1,registryRevision:1,
      lastIssuedAtMs:old.lastIssuedAtMs+50,
      lastCaptureSetId:'signed-set-'+(old.generation+1),
      lastPayloadSha256:hex(old.generation+1)};
    const r=await ledger.commitHead({
      expectedHeadSha256:governanceDigest(old),nextHead:next,
      nextHeadSha256:governanceDigest(next),
      registrySha256:hex(20),signerId:'fixture-key'
    });
    assert.equal(r.committed,true);
  };
  const invoke=(mode,...args)=>spawnSync(process.execPath,[script,mode,...args],
    {encoding:'utf8',timeout:10000});
  const close=()=>{ledger.close();rmSync(root,{recursive:true,force:true});};
  return {root,dbPath,backupRoot,anchorPath,scope,ledger,
    emitAnchors,advance,invoke,close};
}
async function withFixture(fn){const f=setup();try{await fn(f);}finally{f.close();}}

test('CLI candidate is read-only and explicitly marked not independently trusted',()=>withFixture(async f=>{
  await f.advance();
  const before=readFileSync(f.dbPath);
  const result=f.invoke('candidate','--db',f.dbPath);
  assert.equal(result.status,0,result.stderr);
  const data=JSON.parse(result.stdout);
  assert.equal(data.mode,'candidate');
  assert.equal(data.trust,'UNANCHORED_CANDIDATE_NOT_APPROVED');
  assert.equal(data.proposedAnchors[0].generation,1);
  assert.deepEqual(readFileSync(f.dbPath),before);
}));

test('status refuses missing anchors and accepts only explicit pinned history',()=>withFixture(async f=>{
  await f.advance();
  const refused=f.invoke('status','--db',f.dbPath);
  assert.notEqual(refused.status,0);
  assert.match(refused.stderr,/Usage:/);
  f.emitAnchors();
  const allowed=f.invoke('status','--db',f.dbPath,
    '--anchor-file',f.anchorPath);
  assert.equal(allowed.status,0,allowed.stderr);
  assert.equal(JSON.parse(allowed.stdout).status,'ANCHORED_HISTORY_VERIFIED');
}));

test('CLI backup and verify-backup use real SQLite bytes with independent digest argument',()=>withFixture(async f=>{
  await f.advance();f.emitAnchors();
  const b=f.invoke('backup','--db',f.dbPath,
    '--anchor-file',f.anchorPath,'--backup-root',f.backupRoot);
  assert.equal(b.status,0,b.stderr);
  const receipt=JSON.parse(b.stdout).receipt;
  assert.equal(existsSync(receipt.backupPath),true);
  const verified=f.invoke('verify-backup','--db',receipt.backupPath,
    '--anchor-file',f.anchorPath,'--sha256',receipt.sha256);
  assert.equal(verified.status,0,verified.stderr);
  assert.equal(JSON.parse(verified.stdout).status,
    'BACKUP_BYTES_AND_ANCHORS_VERIFIED');
}));

test('CLI rejects a stale snapshot against a newer independently pinned head',()=>withFixture(async f=>{
  await f.advance();f.emitAnchors();
  const b=f.invoke('backup','--db',f.dbPath,
    '--anchor-file',f.anchorPath,'--backup-root',f.backupRoot);
  assert.equal(b.status,0,b.stderr);
  const receipt=JSON.parse(b.stdout).receipt;
  await f.advance();f.emitAnchors();
  const result=f.invoke('verify-backup','--db',receipt.backupPath,
    '--anchor-file',f.anchorPath,'--sha256',receipt.sha256);
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/LEDGER_ROLLBACK_OR_SCOPE_MISSING/);
}));

test('CLI refuses a symlinked high-water anchor path',()=>withFixture(async f=>{
  await f.advance();f.emitAnchors();
  const linked=join(f.root,'anchor-link.json');
  symlinkSync(f.anchorPath,linked);
  const result=f.invoke('status','--db',f.dbPath,'--anchor-file',linked);
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/LEDGER_ANCHOR_FILE_UNSAFE/);
}));

test('CLI will not initialize an absent DB or provide a restore operation',()=>withFixture(async f=>{
  const missing=join(f.root,'missing.sqlite');
  const r=f.invoke('candidate','--db',missing);
  assert.notEqual(r.status,0);
  assert.equal(existsSync(missing),false);
  const restore=f.invoke('restore','--db',f.dbPath);
  assert.notEqual(restore.status,0);
  assert.match(restore.stderr,/Usage:/);
}));

test('PowerShell wrapper delegates directly to WSL without invoking bash, live WCL or implicit Init',()=>{
  assert.match(ps1,/ValidateSet\('Candidate','Status','Backup','VerifyBackup'\)/);
  assert.match(ps1,/wsl\.exe -d \$Distro -- node @arguments/);
  assert.match(ps1,/DbLinuxPath/);
  assert.doesNotMatch(ps1,/Invoke-Expression|Start-Process|curl|wget|Invoke-RestMethod|Start-Fresh216|Collect-Wcl/i);
});
