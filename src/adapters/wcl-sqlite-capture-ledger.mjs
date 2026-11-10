/**
 * File-backed SQLite CAS and lifetime capture-set-ID uniqueness for V2.
 *
 * Concrete host storage for admitGovernedSignedWclCapture. No WCL/Blizzard
 * calls, credentials, network, or raw captures are persisted. Node >=22.13.
 * A trusted operator must mount the database on a durable, access-controlled
 * LOCAL filesystem. Never use a GitHub-hosted runner's ephemeral workspace as
 * an operational ledger or assume distributed/network-FS locking is safe.
 */
import {DatabaseSync} from 'node:sqlite';
import {isAbsolute,dirname,extname} from 'node:path';
import {existsSync} from 'node:fs';
import {
  governanceDigest,makeGenesisCaptureHead
} from './wcl-capture-trust-governance.mjs';

const fail=code=>{throw Error(code);};
const need=(v,code)=>{if(!v)fail(code);};
const positive=n=>Number.isSafeInteger(n)&&n>0;
const nonnegative=n=>Number.isSafeInteger(n)&&n>=0;
const token=s=>typeof s==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9:._/-]{0,159}$/.test(s);
const sha=s=>typeof s==='string'&&/^[0-9a-f]{64}$/.test(s);
const copy=obj=>JSON.parse(JSON.stringify(obj));
const SCHEMA=1;

function schemaSetup(db){
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  // FULL synchronous rollback journal; never substitute memory-only journal.
  const journal=db.prepare('PRAGMA journal_mode = DELETE').get();
  need(String(journal.journal_mode).toLowerCase()==='delete',
    'SQLITE_LEDGER_JOURNAL_UNSAFE');
  db.exec('PRAGMA synchronous = FULL');
  const sync=db.prepare('PRAGMA synchronous').get();
  need(Number(sync.synchronous)===2,'SQLITE_LEDGER_SYNC_UNSAFE');
  const version=db.prepare('PRAGMA user_version').get().user_version;
  need(version===0||version===SCHEMA,'SQLITE_LEDGER_SCHEMA_UNSUPPORTED');
  db.exec(`
    CREATE TABLE IF NOT EXISTS capture_heads (
      source_namespace TEXT NOT NULL,
      expansion_id INTEGER NOT NULL CHECK (expansion_id > 0),
      head_json TEXT NOT NULL,
      head_sha256 TEXT NOT NULL,
      PRIMARY KEY (source_namespace, expansion_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS capture_admissions (
      capture_set_id TEXT PRIMARY KEY NOT NULL,
      source_namespace TEXT NOT NULL,
      expansion_id INTEGER NOT NULL,
      generation INTEGER NOT NULL CHECK (generation > 0),
      issued_at_ms INTEGER NOT NULL CHECK (issued_at_ms > 0),
      signer_id TEXT NOT NULL,
      registry_sha256 TEXT NOT NULL,
      registry_revision INTEGER NOT NULL CHECK (registry_revision > 0),
      signed_payload_sha256 TEXT NOT NULL UNIQUE,
      head_sha256 TEXT NOT NULL UNIQUE,
      FOREIGN KEY (source_namespace,expansion_id)
        REFERENCES capture_heads(source_namespace,expansion_id)
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS capture_admissions_scope_generation
      ON capture_admissions(source_namespace,expansion_id,generation);
  `);
  if(version===0)db.exec('PRAGMA user_version = 1');
}

function validatedHead(row,namespace,expansionId){
  need(row && sha(row.head_sha256) &&
    typeof row.head_json==='string',
    'SQLITE_LEDGER_UNINITIALIZED_OR_MALFORMED');
  let head;
  try{head=JSON.parse(row.head_json);}catch{fail('SQLITE_LEDGER_HEAD_JSON_CORRUPT');}
  need(head && head.schema==='WCL_CAPTURE_GOVERNANCE_HEAD_V1' &&
    head.sourceNamespace===namespace &&
    head.expansionId===expansionId &&
    nonnegative(head.generation)&&nonnegative(head.registryRevision)&&
    nonnegative(head.lastIssuedAtMs)&&
    ((head.generation===0&&head.registryRevision===0&&
      head.lastIssuedAtMs===0&&head.lastCaptureSetId===null&&
      head.lastPayloadSha256===null)||
     (head.generation>0&&token(head.lastCaptureSetId)&&
      sha(head.lastPayloadSha256))) &&
    governanceDigest(head)===row.head_sha256,
    'SQLITE_LEDGER_HEAD_CORRUPT_OR_SCOPE_DRIFT');
  return head;
}

/**
 * Open a real SQLite file, never :memory: or an implicit temporary database.
 *
 * initializeScope(...) is an explicit one-time genesis write; repeated calls
 * return created:false and NEVER reset a prior generation.
 * commitHead(...) uses BEGIN IMMEDIATE and a UNIQUE capture_set_id constraint
 * shared across all scopes in THIS physical database, so a later replay with
 * a newer issuedAtMs still fails. The entire transition commits atomically.
 */
export function openSqliteCaptureLedger({dbPath}={}){
  need(typeof dbPath==='string'&&isAbsolute(dbPath)&&
    extname(dbPath)==='.sqlite'&&existsSync(dirname(dbPath))&&
    !dbPath.includes('\0'),
    'SQLITE_LEDGER_FILE_PATH_REQUIRED');
  const db=new DatabaseSync(dbPath,{timeout:5000});
  try{schemaSetup(db);}catch(e){db.close();throw e;}
  const getRow=db.prepare('SELECT head_json, head_sha256 FROM capture_heads WHERE source_namespace=? AND expansion_id=?');
  const insertGenesis=db.prepare(
    'INSERT OR IGNORE INTO capture_heads (source_namespace,expansion_id,head_json,head_sha256) VALUES (?,?,?,?)'
  );
  const getAdmission=db.prepare(
    'SELECT capture_set_id,source_namespace,expansion_id,generation,issued_at_ms,signer_id,registry_sha256,registry_revision,signed_payload_sha256,head_sha256 FROM capture_admissions WHERE capture_set_id=?'
  );
  const insertAdmission=db.prepare(
    'INSERT OR IGNORE INTO capture_admissions (capture_set_id,source_namespace,expansion_id,generation,issued_at_ms,signer_id,registry_sha256,registry_revision,signed_payload_sha256,head_sha256) VALUES (?,?,?,?,?,?,?,?,?,?)'
  );
  const updateHead=db.prepare(
    'UPDATE capture_heads SET head_json=?, head_sha256=? WHERE source_namespace=? AND expansion_id=? AND head_sha256=?'
  );
  const scope=(v)=>{
    need(token(v?.sourceNamespace)&&positive(v?.expansionId),
      'SQLITE_LEDGER_SCOPE_INVALID');
    return v;
  };
  const readHead=(expected)=>{
    const v=scope(expected);
    return copy(validatedHead(getRow.get(v.sourceNamespace,v.expansionId),
      v.sourceNamespace,v.expansionId));
  };
  const initializeScope=(expected)=>{
    const v=scope(expected),genesis=makeGenesisCaptureHead(v);
    let active=true; db.exec('BEGIN IMMEDIATE');
    try{
      const created=insertGenesis.run(v.sourceNamespace,v.expansionId,
        JSON.stringify(genesis),governanceDigest(genesis)).changes===1;
      const current=readHead(v);
      db.exec('COMMIT');active=false;
      return {created,head:current};
    }catch(e){if(active)db.exec('ROLLBACK');throw e;}
  };
  const commitHead=async ({expectedHeadSha256,nextHead,nextHeadSha256,
    registrySha256,signerId}={})=>{
    need(sha(expectedHeadSha256)&&sha(nextHeadSha256)&&
      sha(registrySha256)&&token(signerId)&&
      nextHead?.schema==='WCL_CAPTURE_GOVERNANCE_HEAD_V1'&&
      token(nextHead.sourceNamespace)&&positive(nextHead.expansionId)&&
      positive(nextHead.generation)&&positive(nextHead.registryRevision)&&
      positive(nextHead.lastIssuedAtMs)&&
      token(nextHead.lastCaptureSetId)&&sha(nextHead.lastPayloadSha256)&&
      governanceDigest(nextHead)===nextHeadSha256,
      'SQLITE_LEDGER_TRANSITION_INVALID');
    const namespace=nextHead.sourceNamespace,expansionId=nextHead.expansionId;
    let active=true;
    db.exec('BEGIN IMMEDIATE');
    try{
      const old=validatedHead(getRow.get(namespace,expansionId),
        namespace,expansionId);
      const prior=old.generation>0?getAdmission.get(old.lastCaptureSetId):null;
      need(old.generation===0||
        (prior?.head_sha256===governanceDigest(old)&&
          prior.registry_revision===old.registryRevision),
        'SQLITE_LEDGER_AUDIT_CHAIN_BROKEN');
      if(governanceDigest(old)!==expectedHeadSha256 ||
        nextHead.generation!==old.generation+1 ||
        nextHead.registryRevision<old.registryRevision ||
        (old.generation>0&&nextHead.registryRevision===old.registryRevision&&
          prior.registry_sha256!==registrySha256)||
        nextHead.lastIssuedAtMs<=old.lastIssuedAtMs ||
        nextHead.lastCaptureSetId===old.lastCaptureSetId){
        db.exec('ROLLBACK');active=false;
        return {committed:false,reason:'STALE_HEAD_OR_NONMONOTONIC'};
      }
      // PRIMARY KEY globally reserves capture IDs, not just the most recent
      // ID in a scope. Insert and head update share one SQL transaction.
      const inserted=insertAdmission.run(nextHead.lastCaptureSetId,namespace,
        expansionId,nextHead.generation,nextHead.lastIssuedAtMs,signerId,
        registrySha256,nextHead.registryRevision,nextHead.lastPayloadSha256,
        nextHeadSha256).changes;
      if(inserted!==1){
        db.exec('ROLLBACK');active=false;
        return {committed:false,reason:'GLOBAL_CAPTURE_ID_OR_DIGEST_REPLAY'};
      }
      const updated=updateHead.run(JSON.stringify(nextHead),nextHeadSha256,
        namespace,expansionId,expectedHeadSha256).changes;
      if(updated!==1){
        db.exec('ROLLBACK');active=false;
        return {committed:false,reason:'CONCURRENT_HEAD_CHANGED'};
      }
      db.exec('COMMIT');active=false;
      const recorded=readHead({sourceNamespace:namespace,expansionId});
      const history=getAdmission.get(nextHead.lastCaptureSetId);
      need(governanceDigest(recorded)===nextHeadSha256&&
        history?.head_sha256===nextHeadSha256,
        'SQLITE_LEDGER_COMMIT_READBACK_UNCONFIRMED');
      return {committed:true,headSha256:nextHeadSha256};
    }catch(e){
      if(active)db.exec('ROLLBACK');
      throw e;
    }
  };
  const readAdmission=(captureSetId)=>{
    need(token(captureSetId),'SQLITE_LEDGER_CAPTURE_ID_INVALID');
    const row=getAdmission.get(captureSetId);
    return row?Object.freeze({...row}):null;
  };
  return Object.freeze({initializeScope,readHead,commitHead,
    readAdmission,close:()=>db.close()});
}
