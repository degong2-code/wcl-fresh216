/**
 * Read-only provider for the authentic Git commit containing one completed
 * Report-wave checkpoint. The private checkpoint must already have been
 * durably committed and confirmed on its remote branch before this callback.
 *
 * This module never writes Git, calls WCL/OAuth, publishes archives, appends C,
 * or writes Sheets. It refuses a dirty, detached, stale or non-private store.
 */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {SOURCE_SHA256} from '../../tools/lib/fresh216-c-delta.mjs';

export const PRIVATE_REPORT_STATE_REPOSITORY='degong2-code/ai-project-lab';
export const PRIVATE_REPORT_STATE_BRANCH='work/fresh216-private-adaptive-state';
export const PRIVATE_REPORT_STATE_PATH=
  'projects/wcl-fresh216/private-adaptive/report-wave-checkpoint.json';
export const PRIVATE_REPORT_STATE_SCOPE='heroic:2026-10-22_27:latest:source';

const need=(value,code)=>{if(!value)throw Error(code);};
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const commit=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const shaBytes=value=>createHash('sha256').update(value).digest('hex');
const shaObject=value=>shaBytes(Buffer.from(JSON.stringify(value),'utf8'));
const requestKey=group=>JSON.stringify([
  group.scopeKey,group.reportCode,group.fightId,group.encounterId,
  group.difficulty,group.reportRevision??null
]);
const slotKey=slot=>JSON.stringify([
  slot.jobKey,slot.rank,slot.snapshotSha
]);
const canonical=value=>{
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object'){
    const out={};
    for(const key of Object.keys(value).sort())out[key]=canonical(value[key]);
    return out;
  }
  return value;
};
const same=(left,right)=>JSON.stringify(canonical(left))===
  JSON.stringify(canonical(right));
const sortRows=rows=>rows.slice().sort((a,b)=>
  slotKey(a).localeCompare(slotKey(b)));
const normalizeVerified=rows=>{
  need(Array.isArray(rows),'PRIVATE_REPORT_STATE_JOIN_INVALID');
  const projected=rows.map(row=>{
    need(row&&typeof row.jobKey==='string'&&row.jobKey&&
      Number.isSafeInteger(row.rank)&&row.rank>=1&&row.rank<=100&&
      sha(row.snapshotSha)&&row.proof&&typeof row.proof==='object',
      'PRIVATE_REPORT_STATE_PROOF_INVALID');
    return {jobKey:row.jobKey,rank:row.rank,
      snapshotSha:row.snapshotSha,proof:row.proof};
  });
  const keys=projected.map(slotKey);
  need(new Set(keys).size===keys.length,
    'PRIVATE_REPORT_STATE_PROOF_DUPLICATE');
  return sortRows(projected);
};
const normalizeUnresolved=rows=>{
  need(Array.isArray(rows),'PRIVATE_REPORT_STATE_JOIN_INVALID');
  const projected=rows.map(row=>{
    need(row&&typeof row.jobKey==='string'&&row.jobKey&&
      Number.isSafeInteger(row.rank)&&row.rank>=1&&row.rank<=100&&
      sha(row.snapshotSha),'PRIVATE_REPORT_STATE_UNRESOLVED_INVALID');
    return {jobKey:row.jobKey,rank:row.rank,snapshotSha:row.snapshotSha};
  });
  const keys=projected.map(slotKey);
  need(new Set(keys).size===keys.length,
    'PRIVATE_REPORT_STATE_UNRESOLVED_DUPLICATE');
  return sortRows(projected);
};
const normalizeSlots=slots=>{
  need(Array.isArray(slots)&&slots.length>0,
    'PRIVATE_REPORT_STATE_SLOTS_INVALID');
  const projected=slots.map(slot=>{
    need(slot&&typeof slot.jobKey==='string'&&slot.jobKey&&
      Number.isSafeInteger(slot.rank)&&slot.rank>=1&&slot.rank<=100&&
      sha(slot.snapshotSha)&&Number.isFinite(slot.totalDps)&&
      Number.isFinite(slot.startTime)&&slot.startTime>0&&
      typeof slot.className==='string'&&typeof slot.specName==='string',
      'PRIVATE_REPORT_STATE_SLOT_INVALID');
    return {
      jobKey:slot.jobKey,rank:slot.rank,snapshotSha:slot.snapshotSha,
      totalDps:slot.totalDps,className:slot.className,
      specName:slot.specName,startTime:slot.startTime,name:slot.name??''
    };
  });
  const keys=projected.map(slotKey);
  need(new Set(keys).size===keys.length,
    'PRIVATE_REPORT_STATE_SLOT_DUPLICATE');
  return sortRows(projected);
};
const normalizeRemote=value=>{
  if(typeof value!=='string')return '';
  return value.trim()
    .replace(/^git@github\.com:/i,'')
    .replace(/^ssh:\/\/git@github\.com\//i,'')
    .replace(/^https?:\/\/github\.com\//i,'')
    .replace(/\.git$/i,'').toLowerCase();
};
const defaultGitCommand=(root,args)=>execFileSync('git',
  ['-C',root,...args],{
    encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:25000,
    maxBuffer:32*1024*1024,
    env:{...process.env,GIT_TERMINAL_PROMPT:'0'}
  });

function validateWaveEvidence({wave,attemptId,evidence,witness}={}){
  need(wave&&typeof wave.waveId==='string'&&wave.waveId&&
    wave.scopeKey===PRIVATE_REPORT_STATE_SCOPE&&
    typeof wave.reportCode==='string'&&wave.reportCode&&
    (wave.reportRevision==null||
      Number.isSafeInteger(wave.reportRevision)&&wave.reportRevision>=0)&&
    Array.isArray(wave.fightGroups)&&wave.fightGroups.length>=1&&
    wave.fightGroups.length<=8,
    'PRIVATE_REPORT_STATE_WAVE_INVALID');
  need(typeof attemptId==='string'&&attemptId&&
    evidence?.schema===1&&evidence.status==='PENDING'&&
    evidence.attemptId===attemptId&&evidence.waveId===wave.waveId&&
    evidence.sourceSha256===SOURCE_SHA256&&
    sha(evidence.waveSha256)&&sha(evidence.requestBodySha256)&&
    sha(evidence.responseBodySha256)&&sha(evidence.witnessSha256)&&
    evidence.witnessRef===
      'report-wave-witnesses/'+evidence.waveSha256+'.json.br',
    'PRIVATE_REPORT_STATE_EVIDENCE_INVALID');
  need(witness?.schema===1&&
    witness.kind==='FRESH216_PRIVATE_REPORT_WAVE_WITNESS_V1'&&
    witness.sourceSha256===SOURCE_SHA256&&
    witness.waveSha256===evidence.waveSha256&&
    witness.requestBodySha256===evidence.requestBodySha256&&
    witness.responseBodySha256===evidence.responseBodySha256&&
    witness.witnessRef===evidence.witnessRef&&
    witness.witnessSha256===evidence.witnessSha256&&
    witness.attemptId===attemptId&&
    witness.httpStatus===200&&
    Number.isSafeInteger(witness.capturedAtMs)&&witness.capturedAtMs>0&&
    Number.isFinite(witness.observedPoints)&&witness.observedPoints>=0&&
    typeof witness.requestBodyText==='string'&&
    typeof witness.responseBodyBase64==='string'&&
    Array.isArray(witness.joinedByFight)&&
    witness.joinedByFight.length===wave.fightGroups.length,
    'PRIVATE_REPORT_STATE_WITNESS_INVALID');
  need(same(witness.wave,wave)&&shaObject(wave)===evidence.waveSha256,
    'PRIVATE_REPORT_STATE_WAVE_DIGEST_MISMATCH');
  need(shaBytes(Buffer.from(witness.requestBodyText,'utf8'))===
    evidence.requestBodySha256,
    'PRIVATE_REPORT_STATE_REQUEST_DIGEST_MISMATCH');
  const raw=witness.responseBodyBytes instanceof Uint8Array?
    Buffer.from(witness.responseBodyBytes):null;
  need(raw&&raw.length>0&&raw.toString('base64')===
    witness.responseBodyBase64&&shaBytes(raw)===evidence.responseBodySha256,
    'PRIVATE_REPORT_STATE_RESPONSE_DIGEST_MISMATCH');

  const keys=wave.fightGroups.map(group=>{
    need(group.scopeKey===wave.scopeKey&&
      group.reportCode===wave.reportCode&&
      (group.reportRevision??null)===(wave.reportRevision??null)&&
      Number.isSafeInteger(group.fightId)&&group.fightId>0&&
      Number.isSafeInteger(group.encounterId)&&group.encounterId>0&&
      Number.isSafeInteger(group.difficulty)&&group.difficulty>0,
      'PRIVATE_REPORT_STATE_GROUP_INVALID');
    return requestKey(group);
  });
  need(new Set(keys).size===keys.length,
    'PRIVATE_REPORT_STATE_WAVE_DUPLICATE_GROUP');
  return {keys,raw};
}
function validateCommittedState(state,{wave,attemptId,evidence,witness,keys}={}){
  need(state?.schema===1&&state.scopeKey===PRIVATE_REPORT_STATE_SCOPE&&
    typeof state.runId==='string'&&state.runId&&
    Number.isSafeInteger(state.version)&&state.version>=1&&
    state.status==='ACTIVE'&&state.entries&&
    typeof state.entries==='object'&&!Array.isArray(state.entries),
    'PRIVATE_REPORT_STATE_CHECKPOINT_INVALID');
  const waveKeys=keys.slice().sort();
  for(let i=0;i<wave.fightGroups.length;i++){
    const group=wave.fightGroups[i],key=keys[i],entry=state.entries[key];
    const joined=witness.joinedByFight[i];
    need(entry&&entry.key===key&&entry.identity&&
      entry.identity.scopeKey===group.scopeKey&&
      entry.identity.reportCode===group.reportCode&&
      entry.identity.fightId===group.fightId&&
      entry.identity.encounterId===group.encounterId&&
      entry.identity.difficulty===group.difficulty&&
      (entry.identity.reportRevision??null)===(group.reportRevision??null),
      'PRIVATE_REPORT_STATE_ENTRY_IDENTITY_MISMATCH');
    need(entry.status==='COMPLETED'||entry.status==='COMPLETED_PARTIAL',
      'PRIVATE_REPORT_STATE_ENTRY_NOT_COMPLETED');
    need(entry.attempt?.id===attemptId&&
      entry.attempt.kind==='REPORT_WAVE'&&
      same(entry.attempt.waveKeys,waveKeys),
      'PRIVATE_REPORT_STATE_ATTEMPT_MISMATCH');
    need(entry.evidence?.schema===1&&entry.evidence.status==='PENDING'&&
      entry.evidence.attemptId===attemptId&&
      entry.evidence.waveId===evidence.waveId&&
      entry.evidence.sourceSha256===evidence.sourceSha256&&
      entry.evidence.waveSha256===evidence.waveSha256&&
      entry.evidence.requestBodySha256===evidence.requestBodySha256&&
      entry.evidence.responseBodySha256===evidence.responseBodySha256&&
      entry.evidence.witnessRef===evidence.witnessRef&&
      entry.evidence.witnessSha256===evidence.witnessSha256,
      'PRIVATE_REPORT_STATE_EVIDENCE_MISMATCH');
    need(entry.observedPoints===witness.observedPoints&&
      joined&&Array.isArray(joined.verified)&&
      Array.isArray(joined.unresolved)&&entry.result&&
      same(normalizeSlots(entry.slots),normalizeSlots(group.slots))&&
      same(normalizeVerified(entry.result.verified),
        normalizeVerified(joined.verified))&&
      same(normalizeUnresolved(entry.result.unresolved),
        normalizeUnresolved(joined.unresolved)),
      'PRIVATE_REPORT_STATE_RESULT_MISMATCH');
    const expectedStatus=joined.unresolved.length?
      'COMPLETED_PARTIAL':'COMPLETED';
    need(entry.status===expectedStatus,
      'PRIVATE_REPORT_STATE_COMPLETION_STATUS_MISMATCH');
  }
}
export function createGitBackedReportStateCommitProvider({
  repoRoot,gitCommand=defaultGitCommand
}={}){
  need(typeof repoRoot==='string'&&path.isAbsolute(repoRoot)&&
    typeof gitCommand==='function',
    'PRIVATE_REPORT_STATE_PROVIDER_CONFIG_INVALID');
  let root;
  try{root=fs.realpathSync(repoRoot);}
  catch{throw Error('PRIVATE_REPORT_STATE_ROOT_INVALID');}
  const git=(...args)=>{
    try{return String(gitCommand(root,args)).trim();}
    catch{throw Error('PRIVATE_REPORT_STATE_GIT_COMMAND_FAILED');}
  };
  return async function getReportStateCommit(input={}){
    const validated=validateWaveEvidence(input);
    need(git('rev-parse','--show-toplevel')===root,
      'PRIVATE_REPORT_STATE_REPOSITORY_ROOT_MISMATCH');
    need(git('symbolic-ref','--short','HEAD')===
      PRIVATE_REPORT_STATE_BRANCH,
      'PRIVATE_REPORT_STATE_BRANCH_MISMATCH');
    need(normalizeRemote(git('remote','get-url','origin'))===
      PRIVATE_REPORT_STATE_REPOSITORY,
      'PRIVATE_REPORT_STATE_REMOTE_MISMATCH');
    need(git('status','--porcelain','--untracked-files=all')==='',
      'PRIVATE_REPORT_STATE_WORKTREE_DIRTY');
    const head=git('rev-parse','HEAD');
    need(commit(head),'PRIVATE_REPORT_STATE_HEAD_INVALID');
    const remoteLine=git('ls-remote','--heads','origin',
      'refs/heads/'+PRIVATE_REPORT_STATE_BRANCH).split('\n')
      .find(line=>line.trim());
    const remoteFields=remoteLine?.trim().split(/\s+/)??[];
    need(remoteFields[0]===head&&
      remoteFields[1]==='refs/heads/'+PRIVATE_REPORT_STATE_BRANCH,
      'PRIVATE_REPORT_STATE_REMOTE_HEAD_UNCONFIRMED');

    const stateCommit=git('log','-1','--format=%H','HEAD','--',
      PRIVATE_REPORT_STATE_PATH);
    need(commit(stateCommit)&&
      git('merge-base','--is-ancestor',stateCommit,head)==='',
      'PRIVATE_REPORT_STATE_COMMIT_NOT_REACHABLE');
    const stateBlob=git('rev-parse',stateCommit+':'+
      PRIVATE_REPORT_STATE_PATH);
    const headBlob=git('rev-parse',head+':'+PRIVATE_REPORT_STATE_PATH);
    need(/^[a-f0-9]{40}$/.test(stateBlob)&&stateBlob===headBlob,
      'PRIVATE_REPORT_STATE_BLOB_DRIFT');
    const treeEntry=git('ls-tree',stateCommit,'--',
      PRIVATE_REPORT_STATE_PATH).split('\t');
    const treeFields=treeEntry[0]?.trim().split(/\s+/)??[];
    need(treeFields[0]==='100644'&&treeFields[1]==='blob'&&
      treeFields[2]===stateBlob&&treeEntry[1]===PRIVATE_REPORT_STATE_PATH,
      'PRIVATE_REPORT_STATE_TREE_ENTRY_INVALID');
    need(git('cat-file','-t',stateBlob)==='blob',
      'PRIVATE_REPORT_STATE_OBJECT_INVALID');
    let state;
    try{state=JSON.parse(git('show',
      stateCommit+':'+PRIVATE_REPORT_STATE_PATH));}
    catch{throw Error('PRIVATE_REPORT_STATE_CHECKPOINT_UNREADABLE');}
    validateCommittedState(state,{...input,...validated});
    return stateCommit;
  };
}
