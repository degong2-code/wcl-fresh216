/**
 * WCL V2 SQLite host inspection and backup (NO restore, NO live APIs).
 *
 * Backups are useful only with independently retained high-water anchors.
 * Neither an unsigned receipt nor a snapshot alone proves non-rollback.
 * Read-only inspection intentionally never calls openSqliteCaptureLedger,
 * because that older adapter initializes schema on open.
 *
 * Requires Node >=22.16 for sqlite.backup().
 */
import {DatabaseSync,backup as sqliteBackup} from 'node:sqlite';
import {existsSync,lstatSync,readFileSync,mkdtempSync,rmSync,statSync,realpathSync} from 'node:fs';
import {resolve,isAbsolute,join,extname} from 'node:path';
import {createHash} from 'node:crypto';
import {governanceDigest,makeGenesisCaptureHead} from './wcl-capture-trust-governance.mjs';

const fail=code=>{throw Error(code);};
const need=(cond,code)=>{if(!cond)fail(code);};
const positive=n=>Number.isSafeInteger(n)&&n>0;
const nonnegative=n=>Number.isSafeInteger(n)&&n>=0;
const token=s=>typeof s==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9:._/-]{0,159}$/.test(s);
const digest=s=>typeof s==='string'&&/^[0-9a-f]{64}$/.test(s);
const upperBoundBytes=64*1024*1024;
const MAX_ROWS=100_000;
const neededHead=['schema','sourceNamespace','expansionId','generation',
  'registryRevision','lastIssuedAtMs','lastCaptureSetId','lastPayloadSha256'];
const exact=(value,required)=>value&&typeof value==='object'&&
  !Array.isArray(value)&&Object.keys(value).length===required.length&&
  required.every(k=>Object.hasOwn(value,k));
const hashFile=path=>{
  need(statSync(path).size<=upperBoundBytes,'LEDGER_FILE_TOO_LARGE');
  return createHash('sha256').update(readFileSync(path)).digest('hex');
};
function checkedPath(dbPath){
  need(typeof dbPath==='string'&&isAbsolute(dbPath)&&
    extname(dbPath)==='.sqlite'&&existsSync(dbPath),
    'LEDGER_EXISTING_ABSOLUTE_FILE_REQUIRED');
  const meta=lstatSync(dbPath);
  need(meta.isFile()&&!meta.isSymbolicLink()&&meta.size>0&&
    meta.size<=upperBoundBytes,
    'LEDGER_FILE_UNSAFE_OR_UNBOUNDED');
  return dbPath;
}
function rowString(row,k){need(token(row[k]),'LEDGER_AUDIT_FIELD_INVALID');}
function validateHead(head,scope){
  need(exact(head,neededHead)&&
    head.schema==='WCL_CAPTURE_GOVERNANCE_HEAD_V1'&&
    head.sourceNamespace===scope.sourceNamespace&&
    head.expansionId===scope.expansionId&&
    nonnegative(head.generation)&&nonnegative(head.registryRevision)&&
    nonnegative(head.lastIssuedAtMs),
    'LEDGER_HEAD_INVALID');
  if(head.generation===0){
    const expected=makeGenesisCaptureHead(scope);
    need(governanceDigest(head)===governanceDigest(expected),
      'LEDGER_GENESIS_INVALID');
  }else{
    need(positive(head.registryRevision)&&positive(head.lastIssuedAtMs)&&
      token(head.lastCaptureSetId)&&digest(head.lastPayloadSha256),
      'LEDGER_ADMITTED_HEAD_INVALID');
  }
}
function scanDb(db){
  need(db.prepare('PRAGMA user_version').get().user_version===1,
    'LEDGER_SCHEMA_VERSION_INVALID');
  const integrity=db.prepare('PRAGMA integrity_check').all();
  need(integrity.length===1&&integrity[0].integrity_check==='ok',
    'LEDGER_SQLITE_INTEGRITY_FAILED');
  const foreign=db.prepare('PRAGMA foreign_key_check').all();
  need(foreign.length===0,'LEDGER_FOREIGN_KEY_FAILURE');
  const heads=db.prepare('SELECT source_namespace,expansion_id,head_json,head_sha256 FROM capture_heads ORDER BY source_namespace,expansion_id').all();
  const admissions=db.prepare('SELECT capture_set_id,source_namespace,expansion_id,generation,issued_at_ms,signer_id,registry_sha256,registry_revision,signed_payload_sha256,head_sha256 FROM capture_admissions ORDER BY source_namespace,expansion_id,generation').all();
  need(heads.length<=MAX_ROWS&&admissions.length<=MAX_ROWS,
    'LEDGER_AUDIT_HISTORY_TOO_LARGE');
  const groups=new Map();
  for(const row of heads){
    need(token(row.source_namespace)&&positive(row.expansion_id)&&
      digest(row.head_sha256),'LEDGER_HEAD_ROW_INVALID');
    const k=JSON.stringify([row.source_namespace,row.expansion_id]);
    need(!groups.has(k),'LEDGER_HEAD_DUPLICATE');
    let head;
    try{head=JSON.parse(row.head_json);}catch{fail('LEDGER_HEAD_JSON_INVALID');}
    const scope={sourceNamespace:row.source_namespace,expansionId:row.expansion_id};
    validateHead(head,scope);
    need(governanceDigest(head)===row.head_sha256,
      'LEDGER_HEAD_DIGEST_MISMATCH');
    groups.set(k,{head,scope,history:[]});
  }
  const ids=new Set(),payloads=new Set(),headHashes=new Set();
  for(const row of admissions){
    rowString(row,'capture_set_id');
    rowString(row,'source_namespace');
    rowString(row,'signer_id');
    need(positive(row.expansion_id)&&positive(row.generation)&&
      positive(row.issued_at_ms)&&positive(row.registry_revision)&&
      digest(row.registry_sha256)&&digest(row.signed_payload_sha256)&&
      digest(row.head_sha256),'LEDGER_AUDIT_FIELD_INVALID');
    need(!ids.has(row.capture_set_id)&&!payloads.has(row.signed_payload_sha256)&&
      !headHashes.has(row.head_sha256),'LEDGER_AUDIT_DUPLICATE');
    ids.add(row.capture_set_id);payloads.add(row.signed_payload_sha256);
    headHashes.add(row.head_sha256);
    const g=groups.get(JSON.stringify([row.source_namespace,row.expansion_id]));
    need(g,'LEDGER_AUDIT_ORPHAN');
    const prev=g.history.at(-1);
    need(row.generation===(prev?.generation??0)+1 &&
      row.issued_at_ms>(prev?.issuedAtMs??0)&&
      row.registry_revision>=(prev?.registryRevision??0)&&
      (row.registry_revision!==(prev?.registryRevision)||
        row.registry_sha256===prev.registrySha256),
      'LEDGER_AUDIT_SEQUENCE_INVALID');
    const historical={
      schema:'WCL_CAPTURE_GOVERNANCE_HEAD_V1',
      sourceNamespace:g.scope.sourceNamespace,
      expansionId:g.scope.expansionId,generation:row.generation,
      registryRevision:row.registry_revision,lastIssuedAtMs:row.issued_at_ms,
      lastCaptureSetId:row.capture_set_id,
      lastPayloadSha256:row.signed_payload_sha256
    };
    need(governanceDigest(historical)===row.head_sha256,
      'LEDGER_AUDIT_HEAD_DIGEST_MISMATCH');
    g.history.push({
      generation:row.generation,headSha256:row.head_sha256,
      issuedAtMs:row.issued_at_ms,registryRevision:row.registry_revision,
      registrySha256:row.registry_sha256,
      captureSetId:row.capture_set_id
    });
  }
  const scopes=[...groups.values()].map(g=>{
    const prev=g.history.at(-1),h=g.head;
    need(h.generation===g.history.length &&
      (prev?prev.headSha256===governanceDigest(h):
        governanceDigest(h)===governanceDigest(makeGenesisCaptureHead(g.scope))),
      'LEDGER_HEAD_HISTORY_MISMATCH');
    return {
      ...g.scope,generation:h.generation,
      headSha256:governanceDigest(h),
      lastCaptureSetId:h.lastCaptureSetId,
      lastIssuedAtMs:h.lastIssuedAtMs,
      registryRevision:h.registryRevision,
      history:g.history
    };
  });
  return {schema:'WCL_LEDGER_AUDIT_V1',scopeCount:scopes.length,
    admissionCount:admissions.length,scopes};
}

/** Read-only audit of ALL recorded scopes + history, without creating a DB. */
export function inspectWclSqliteLedger({dbPath}={}){
  const path=checkedPath(dbPath);
  const db=new DatabaseSync(path,{readOnly:true,timeout:5000});
  try{
    db.exec('PRAGMA query_only=ON');
    return scanDb(db);
  }finally{db.close();}
}

/**
 * Candidate anchors for separate, authenticated storage. A candidate created
 * from the same DB is NOT independent. The trusted host must pin these after
 * authorized admission and keep them outside this DB / its backup domain.
 */
export function candidateWclLedgerAnchors(audit){
  need(audit?.schema==='WCL_LEDGER_AUDIT_V1',
    'LEDGER_AUDIT_REQUIRED');
  return audit.scopes.map(s=>Object.freeze({
    sourceNamespace:s.sourceNamespace,expansionId:s.expansionId,
    generation:s.generation,headSha256:s.headSha256
  }));
}

/** Require a high-water anchor for EACH scope; verify its exact historical head. */
export function verifyWclLedgerAnchors({audit,trustedAnchors}={}){
  need(audit?.schema==='WCL_LEDGER_AUDIT_V1'&&
    Array.isArray(trustedAnchors)&&trustedAnchors.length>0&&
    trustedAnchors.length===audit.scopes.length,
    'LEDGER_TRUSTED_ANCHORS_REQUIRED');
  const seen=new Set();
  for(const a of trustedAnchors){
    need(token(a?.sourceNamespace)&&positive(a.expansionId)&&
      nonnegative(a.generation)&&digest(a.headSha256),
      'LEDGER_ANCHOR_INVALID');
    const k=JSON.stringify([a.sourceNamespace,a.expansionId]);
    need(!seen.has(k),'LEDGER_ANCHOR_DUPLICATE');
    seen.add(k);
    const scope=audit.scopes.find(s=>s.sourceNamespace===a.sourceNamespace&&
      s.expansionId===a.expansionId);
    need(scope&&scope.generation>=a.generation,
      'LEDGER_ROLLBACK_OR_SCOPE_MISSING');
    const historical=a.generation===0?
      governanceDigest(makeGenesisCaptureHead(a)):
      scope.history[a.generation-1]?.headSha256;
    need(historical===a.headSha256,'LEDGER_ANCHOR_HISTORY_MISMATCH');
  }
  return {status:'ANCHORED_HISTORY_VERIFIED',
    scopeCount:audit.scopeCount,admissionCount:audit.admissionCount};
}
function readSnapshot(dbPath,trustedAnchors){
  const audit=inspectWclSqliteLedger({dbPath});
  const result=verifyWclLedgerAnchors({audit,trustedAnchors});
  return {audit,result};
}

/**
 * Online-consistent SQLite backup using the official sqlite.backup() API.
 * Requires a manually supplied existing backup root and external anchors.
 * Creates an unpredictable new subdirectory and never overwrites a backup.
 */
export async function backupAnchoredWclSqliteLedger({
  dbPath,backupRoot,trustedAnchors
}={}){
  const source=checkedPath(dbPath);
  need(typeof backupRoot==='string'&&isAbsolute(backupRoot)&&
    existsSync(backupRoot)&&lstatSync(backupRoot).isDirectory()&&
    !lstatSync(backupRoot).isSymbolicLink()&&
    realpathSync(backupRoot)!==realpathSync(source),
    'LEDGER_BACKUP_ROOT_UNSAFE');
  readSnapshot(source,trustedAnchors);
  const dir=mkdtempSync(join(backupRoot,'wcl-ledger-'),{mode:0o700});
  const target=join(dir,'admissions.sqlite');
  try{
    const sourceDb=new DatabaseSync(source,{readOnly:true,timeout:5000});
    try{await sqliteBackup(sourceDb,target);}finally{sourceDb.close();}
    const {audit}=readSnapshot(target,trustedAnchors);
    const sha256=hashFile(target);
    return Object.freeze({
      schema:'WCL_LEDGER_BACKUP_RECEIPT_V1',backupPath:target,sha256,
      scopeCount:audit.scopeCount,admissionCount:audit.admissionCount,
      anchors:candidateWclLedgerAnchors(audit),
      provenance:'LOCAL_SQLITE_BACKUP_NOT_UPSTREAM_ATTESTATION',
      externallyAnchored:false
    });
  }catch(e){
    rmSync(dir,{recursive:true,force:true});throw e;
  }
}

/** Validate a backup against an INDEPENDENT trusted file digest and anchors. */
export function verifyAnchoredWclSqliteBackup({
  dbPath,expectedFileSha256,trustedAnchors
}={}){
  need(digest(expectedFileSha256),'LEDGER_BACKUP_EXPECTED_SHA_REQUIRED');
  const path=checkedPath(dbPath);
  need(hashFile(path)===expectedFileSha256,'LEDGER_BACKUP_BYTES_CHANGED');
  const {audit,result}=readSnapshot(path,trustedAnchors);
  return {...result,status:'BACKUP_BYTES_AND_ANCHORS_VERIFIED',
    sha256:expectedFileSha256,scopeCount:audit.scopeCount,
    admissionCount:audit.admissionCount};
}
