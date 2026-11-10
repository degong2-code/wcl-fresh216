#!/usr/bin/env node
/**
 * Local operator-facing WCL SQLite recovery diagnostics.
 * No environment bootstrap, DB initialization, secrets, networking or restore.
 *
 * The --anchor-file MUST come from a separately trusted high-water registry.
 * Reading an arbitrary same-disk JSON file does not establish provenance.
 */
import {readFileSync,statSync} from 'node:fs';
import {
  inspectWclSqliteLedger,candidateWclLedgerAnchors,verifyWclLedgerAnchors,
  backupAnchoredWclSqliteLedger,verifyAnchoredWclSqliteBackup
} from '../src/adapters/wcl-sqlite-ledger-recovery.mjs';

const fail=c=>{throw Error(c);};
const help='Usage: node tools/wcl-platform-ledger-host.mjs '+
  'candidate|status|backup|verify-backup --db /absolute/ledger.sqlite '+
  '[--anchor-file /separate/anchors.json] [--backup-root /absolute/dir] '+
  '[--sha256 <sha256>]';
const known=new Set(['--db','--anchor-file','--backup-root','--sha256']);
function args(){
  const [cmd,...rest]=process.argv.slice(2);
  if(!['candidate','status','backup','verify-backup'].includes(cmd)||
    rest.length%2)fail(help);
  const obj={};
  for(let i=0;i<rest.length;i+=2){
    if(!known.has(rest[i])||Object.hasOwn(obj,rest[i])||
      !rest[i+1]||rest[i+1].startsWith('--'))fail(help);
    obj[rest[i]]=rest[i+1];
  }
  const allowed={candidate:['--db'],status:['--db','--anchor-file'],
    backup:['--db','--anchor-file','--backup-root'],
    'verify-backup':['--db','--anchor-file','--sha256']}[cmd];
  if(Object.keys(obj).some(x=>!allowed.includes(x))||
    allowed.some(x=>!Object.hasOwn(obj,x)))fail(help);
  return {cmd,obj};
}
function anchorsFrom(path){
  const stat=statSync(path);
  if(!stat.isFile()||stat.size>100_000)fail('LEDGER_ANCHOR_FILE_UNSAFE');
  const value=JSON.parse(readFileSync(path,'utf8'));
  if(!Array.isArray(value))fail('LEDGER_ANCHOR_FILE_NOT_LIST');
  return value;
}
function sanitizedAudit(audit){
  return {scopeCount:audit.scopeCount,admissionCount:audit.admissionCount,
    scopes:audit.scopes.map(s=>({
      sourceNamespace:s.sourceNamespace,expansionId:s.expansionId,
      generation:s.generation,headSha256:s.headSha256
    }))};
}
async function main(){
  const {cmd,obj}=args();
  if(cmd==='candidate'){
    const audit=inspectWclSqliteLedger({dbPath:obj['--db']});
    return {mode:'candidate',trust:'UNANCHORED_CANDIDATE_NOT_APPROVED',
      audit:sanitizedAudit(audit),
      proposedAnchors:candidateWclLedgerAnchors(audit)};
  }
  const anchors=anchorsFrom(obj['--anchor-file']);
  if(cmd==='verify-backup'){
    const v=verifyAnchoredWclSqliteBackup({
      dbPath:obj['--db'],expectedFileSha256:obj['--sha256'],
      trustedAnchors:anchors
    });
    return {mode:cmd,...v,trust:'CALLER_SUPPLIED_ANCHORS_NOT_AUTHENTICATED_HERE'};
  }
  const audit=inspectWclSqliteLedger({dbPath:obj['--db']});
  verifyWclLedgerAnchors({audit,trustedAnchors:anchors});
  if(cmd==='status')
    return {mode:'status',status:'ANCHORED_HISTORY_VERIFIED',
      trust:'CALLER_SUPPLIED_ANCHORS_NOT_AUTHENTICATED_HERE',
      audit:sanitizedAudit(audit)};
  const receipt=await backupAnchoredWclSqliteLedger({
    dbPath:obj['--db'],backupRoot:obj['--backup-root'],
    trustedAnchors:anchors
  });
  return {mode:'backup',receipt,
    operatorAction:'PIN_RECEIPT_SHA_AND_NEW_HIGH_WATER_ANCHORS_IN_SEPARATE_TRUSTED_STORAGE'};
}
main().then(value=>process.stdout.write(JSON.stringify(value)+'\n'))
  .catch(e=>{
    process.stderr.write('WCL_LEDGER_HOST_FAILED: '+String(e.message||e)+'\n');
    process.exitCode=1;
  });
