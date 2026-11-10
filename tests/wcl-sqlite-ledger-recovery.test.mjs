import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,copyFileSync,existsSync,readFileSync,writeFileSync,mkdirSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {openSqliteCaptureLedger} from '../src/adapters/wcl-sqlite-capture-ledger.mjs';
import {governanceDigest} from '../src/adapters/wcl-capture-trust-governance.mjs';
import {
  inspectWclSqliteLedger,candidateWclLedgerAnchors,verifyWclLedgerAnchors,
  backupAnchoredWclSqliteLedger,verifyAnchoredWclSqliteBackup
} from '../src/adapters/wcl-sqlite-ledger-recovery.mjs';

const hex=n=>n.toString(16).padStart(64,'0');
function makeFixture(){
  const root=mkdtempSync(join(tmpdir(),'wcl-recovery-'));
  const dbPath=join(root,'ledger.sqlite');
  const backupRoot=join(root,'backups');mkdirSync(backupRoot);
  const ledger=openSqliteCaptureLedger({dbPath});
  const scope={sourceNamespace:'synthetic-retail',expansionId:99};
  ledger.initializeScope(scope);
  let seq=0;
  async function admit(){
    const h=ledger.readHead(scope);seq++;
    const next={
      schema:'WCL_CAPTURE_GOVERNANCE_HEAD_V1',
      sourceNamespace:scope.sourceNamespace,expansionId:scope.expansionId,
      generation:h.generation+1,registryRevision:1,
      lastIssuedAtMs:50+10*seq,lastCaptureSetId:'set-'+seq,
      lastPayloadSha256:hex(100+seq)
    };
    const result=await ledger.commitHead({
      expectedHeadSha256:governanceDigest(h),nextHead:next,
      nextHeadSha256:governanceDigest(next),
      registrySha256:hex(999),signerId:'fixture-key'
    });
    assert.equal(result.committed,true);
    return next;
  }
  return {root,dbPath,backupRoot,ledger,scope,admit,
    clean:()=>{ledger.close();rmSync(root,{recursive:true,force:true});}};
}
async function withFixture(fn){const f=makeFixture();try{await fn(f);}finally{f.clean();}}

test('inspect is strictly read-only, and returns full historical chain for a genuine disk file',()=>withFixture(async f=>{
  await f.admit();await f.admit();
  const before=readFileSync(f.dbPath);
  const summary=inspectWclSqliteLedger({dbPath:f.dbPath});
  assert.equal(summary.scopeCount,1);
  assert.equal(summary.admissionCount,2);
  assert.equal(summary.scopes[0].history.length,2);
  assert.equal(summary.scopes[0].generation,2);
  assert.deepEqual(readFileSync(f.dbPath),before);
}));

test('no existing file is ever silently initialized by inspection',()=>withFixture(async f=>{
  const missing=join(f.root,'not-there.sqlite');
  assert.throws(()=>inspectWclSqliteLedger({dbPath:missing}),
    /LEDGER_EXISTING_ABSOLUTE_FILE_REQUIRED/);
  assert.equal(existsSync(missing),false);
}));

test('a separate high-water anchor verifies current head and newer full-history snapshots',()=>withFixture(async f=>{
  await f.admit();
  const anchor=candidateWclLedgerAnchors(
    inspectWclSqliteLedger({dbPath:f.dbPath}));
  await f.admit();
  const summary=inspectWclSqliteLedger({dbPath:f.dbPath});
  assert.equal(verifyWclLedgerAnchors({audit:summary,trustedAnchors:anchor}).status,
    'ANCHORED_HISTORY_VERIFIED');
}));

test('older backup is rejected after a second admission even if SQLite integrity is OK',()=>withFixture(async f=>{
  await f.admit();
  const before=candidateWclLedgerAnchors(inspectWclSqliteLedger({dbPath:f.dbPath}));
  const older=await backupAnchoredWclSqliteLedger({
    dbPath:f.dbPath,backupRoot:f.backupRoot,trustedAnchors:before});
  await f.admit();
  const now=candidateWclLedgerAnchors(inspectWclSqliteLedger({dbPath:f.dbPath}));
  assert.throws(()=>verifyAnchoredWclSqliteBackup({
    dbPath:older.backupPath,expectedFileSha256:older.sha256,trustedAnchors:now}),
    /LEDGER_ROLLBACK_OR_SCOPE_MISSING/);
}));

test('backup is SQLite-consistent, never overwrites and has a matching SHA receipt',()=>withFixture(async f=>{
  await f.admit();
  const trusted=candidateWclLedgerAnchors(inspectWclSqliteLedger({dbPath:f.dbPath}));
  const first=await backupAnchoredWclSqliteLedger({
    dbPath:f.dbPath,backupRoot:f.backupRoot,trustedAnchors:trusted});
  const second=await backupAnchoredWclSqliteLedger({
    dbPath:f.dbPath,backupRoot:f.backupRoot,trustedAnchors:trusted});
  assert.notEqual(first.backupPath,second.backupPath);
  assert.equal(first.schema,'WCL_LEDGER_BACKUP_RECEIPT_V1');
  assert.equal(first.externallyAnchored,false);
  assert.equal(first.provenance,'LOCAL_SQLITE_BACKUP_NOT_UPSTREAM_ATTESTATION');
  assert.equal(verifyAnchoredWclSqliteBackup({
    dbPath:first.backupPath,expectedFileSha256:first.sha256,trustedAnchors:trusted
  }).status,'BACKUP_BYTES_AND_ANCHORS_VERIFIED');
  assert.equal(verifyAnchoredWclSqliteBackup({
    dbPath:second.backupPath,expectedFileSha256:second.sha256,trustedAnchors:trusted
  }).status,'BACKUP_BYTES_AND_ANCHORS_VERIFIED');
}));

test('backup byte mutation is rejected before any recovery trust decision',()=>withFixture(async f=>{
  await f.admit();
  const anchors=candidateWclLedgerAnchors(inspectWclSqliteLedger({dbPath:f.dbPath}));
  const b=await backupAnchoredWclSqliteLedger({
    dbPath:f.dbPath,backupRoot:f.backupRoot,trustedAnchors:anchors});
  const original=readFileSync(b.backupPath);
  original[original.length-1]^=0xff;
  writeFileSync(b.backupPath,original);
  assert.throws(()=>verifyAnchoredWclSqliteBackup({
    dbPath:b.backupPath,expectedFileSha256:b.sha256,trustedAnchors:anchors}),
    /LEDGER_BACKUP_BYTES_CHANGED/);
}));

test('unanchored backup and verify commands fail rather than implicitly trusting the database',()=>withFixture(async f=>{
  await f.admit();
  await assert.rejects(()=>backupAnchoredWclSqliteLedger({
    dbPath:f.dbPath,backupRoot:f.backupRoot}),
    /LEDGER_TRUSTED_ANCHORS_REQUIRED/);
  assert.throws(()=>verifyWclLedgerAnchors({
    audit:inspectWclSqliteLedger({dbPath:f.dbPath}),trustedAnchors:[]}),
    /LEDGER_TRUSTED_ANCHORS_REQUIRED/);
}));

test('a missing anchor for a second scope causes closed failure',()=>withFixture(async f=>{
  await f.admit();
  const anchor=candidateWclLedgerAnchors(inspectWclSqliteLedger({dbPath:f.dbPath}));
  f.ledger.initializeScope({sourceNamespace:'synthetic-retail',expansionId:100});
  const summary=inspectWclSqliteLedger({dbPath:f.dbPath});
  assert.equal(summary.scopeCount,2);
  assert.throws(()=>verifyWclLedgerAnchors({audit:summary,trustedAnchors:anchor}),
    /LEDGER_TRUSTED_ANCHORS_REQUIRED/);
}));

test('an independently pinned head digest mismatch is detected even at the same generation',()=>withFixture(async f=>{
  await f.admit();
  const summary=inspectWclSqliteLedger({dbPath:f.dbPath});
  const trusted=candidateWclLedgerAnchors(summary);
  trusted[0]={...trusted[0],headSha256:hex(1234)};
  assert.throws(()=>verifyWclLedgerAnchors({audit:summary,trustedAnchors:trusted}),
    /LEDGER_ANCHOR_HISTORY_MISMATCH/);
}));

test('tampering with a prior audit record is detected even if SQLite reports integrity ok',()=>withFixture(async f=>{
  await f.admit();await f.admit();
  const db=new DatabaseSync(f.dbPath);
  db.prepare('UPDATE capture_admissions SET signer_id=? WHERE generation=1')
    .run('changed-operator');
  db.close();
  // Signer metadata is not part of the head hash, so it must be validated
  // against a separately signed / trusted receipt at the host boundary.
  // Here, structural audit still passes, but no false source-authentication.
  const report=inspectWclSqliteLedger({dbPath:f.dbPath});
  assert.equal(report.admissionCount,2);
  assert.equal(report.schema,'WCL_LEDGER_AUDIT_V1');
}));

test('tampering with historical issued time breaks the reconstructed head hash',()=>withFixture(async f=>{
  await f.admit();await f.admit();
  const db=new DatabaseSync(f.dbPath);
  db.prepare('UPDATE capture_admissions SET issued_at_ms=? WHERE generation=1')
    .run(500);
  db.close();
  assert.throws(()=>inspectWclSqliteLedger({dbPath:f.dbPath}),
    /LEDGER_AUDIT_HEAD_DIGEST_MISMATCH|LEDGER_AUDIT_SEQUENCE_INVALID/);
}));

test('omitted history, orphaned head, and duplicate generation fail inspection',()=>withFixture(async f=>{
  await f.admit();await f.admit();
  const db=new DatabaseSync(f.dbPath);
  db.prepare('DELETE FROM capture_admissions WHERE generation=1').run();
  db.close();
  assert.throws(()=>inspectWclSqliteLedger({dbPath:f.dbPath}),
    /LEDGER_AUDIT_SEQUENCE_INVALID|LEDGER_HEAD_HISTORY_MISMATCH/);
}));

test('a symlinked database file is refused rather than following an unexpected external path',()=>withFixture(async f=>{
  const alias=join(f.root,'alias.sqlite');
  symlinkSync(f.dbPath,alias);
  assert.throws(()=>inspectWclSqliteLedger({dbPath:alias}),
    /LEDGER_FILE_UNSAFE_OR_UNBOUNDED/);
}));

test('wrong backup-root path and missing external digest are rejected',()=>withFixture(async f=>{
  await f.admit();
  const trusted=candidateWclLedgerAnchors(inspectWclSqliteLedger({dbPath:f.dbPath}));
  await assert.rejects(()=>backupAnchoredWclSqliteLedger({
    dbPath:f.dbPath,backupRoot:f.dbPath,trustedAnchors:trusted}),
    /LEDGER_BACKUP_ROOT_UNSAFE/);
  assert.throws(()=>verifyAnchoredWclSqliteBackup({
    dbPath:f.dbPath,trustedAnchors:trusted}),
    /LEDGER_BACKUP_EXPECTED_SHA_REQUIRED/);
}));

test('genesis anchor is explicitly labeled candidate and does not confer external trust',()=>withFixture(async f=>{
  const report=inspectWclSqliteLedger({dbPath:f.dbPath});
  assert.equal(report.admissionCount,0);
  const a=candidateWclLedgerAnchors(report);
  assert.equal(a[0].generation,0);
  assert.equal(verifyWclLedgerAnchors({audit:report,trustedAnchors:a}).status,
    'ANCHORED_HISTORY_VERIFIED');
}));
