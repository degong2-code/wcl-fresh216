import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

/**
 * Single-owner append-only durable checkpoint store.
 * Exact same init/read/update contract as JsonCheckpointStore.
 *
 * Persist one immutable initial plan, then ONLY entry/header changes in an
 * fsync'd sequential operation journal. Events are named by monotonic version
 * and checksum-chained. No snapshots/proofs/actors may be written to Git.
 *
 * A crash BEFORE event rename has no effect (HTTP never started);
 * a crash AFTER rename but BEFORE returning can leave a durable IN_FLIGHT:
 * on restart the caller MUST recoverCheckpoint(), which blocks auto-retry.
 * A corrupt/gapped journal or external concurrent writer FAILS CLOSED.
 */
const copy=x=>structuredClone(x);
const digest=s=>createHash('sha256').update(s).digest('hex');
const check=s=>{
  if(s?.schema!==1||typeof s.scopeKey!=='string'||!s.scopeKey||
     typeof s.runId!=='string'||!s.runId||
     !Number.isSafeInteger(s.version)||s.version<0||
     !s.entries||typeof s.entries!=='object'||Array.isArray(s.entries)||
     !['ACTIVE','STOPPED'].includes(s.status))
    throw Error('JOURNAL_CHECKPOINT_SCHEMA');
  return s;
};
const writeDurably=(dest,bytes)=>{
  const tmp=dest+'.'+randomUUID()+'.tmp';
  let fd;
  try{
    fd=fs.openSync(tmp,'wx',0o600);
    fs.writeFileSync(fd,bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd);fd=null;
    fs.renameSync(tmp,dest); // never overwrite by version
    const dirFd=fs.openSync(path.dirname(dest),'r');
    try{fs.fsyncSync(dirFd);}finally{fs.closeSync(dirFd);}
  }finally{
    if(fd!==undefined&&fd!==null)fs.closeSync(fd);
    // Temporary file from a failed operation may be cleaned while alive;
    // a crash may leave an orphan, but no WCL HTTP ran before update return.
    if(fs.existsSync(tmp))fs.unlinkSync(tmp);
  }
};
const fileFor=(dir,version)=>path.join(dir,String(version).padStart(10,'0')+'.json');
const header=s=>({
  schema:s.schema,runId:s.runId,scopeKey:s.scopeKey,
  status:s.status,version:s.version
});

export class JournalCheckpointStore {
  constructor(directory){
    if(typeof directory!=='string'||!path.isAbsolute(directory))
      throw Error('ABSOLUTE_PRIVATE_DIRECTORY_REQUIRED');
    this.directory=directory;
    this.eventsPath=path.join(directory,'events');
    this.lockPath=path.join(directory,'.update.lock');
    this.basePath=path.join(directory,'base.json');
    this.cached=null;this.lastHash=null;this.recordCount=null;
  }
  init(state){
    check(state);
    fs.mkdirSync(this.directory,{recursive:false,mode:0o700});
    fs.mkdirSync(this.eventsPath,{mode:0o700});
    const bytes=JSON.stringify(state)+'\n';
    writeDurably(this.basePath,bytes);
    this.cached=copy(state);
    this.lastHash=digest(bytes);
    this.recordCount=0;
    return this.read();
  }
  eventNames(){
    const names=fs.readdirSync(this.eventsPath).sort();
    if(names.some(n=>!/^\d{10}\.json$/.test(n)))
      throw Error('JOURNAL_UNEXPECTED_EVENT_FILE');
    return names;
  }
  read(){
    const names=this.eventNames();
    if(this.cached){
      if(names.length!==this.recordCount)
        throw Error('JOURNAL_EXTERNAL_CHANGE_REOPEN_REQUIRED');
      return copy(this.cached);
    }
    const bytes=fs.readFileSync(this.basePath,'utf8');
    let state=check(JSON.parse(bytes)),lastHash=digest(bytes);
    let expected=state.version;
    for(const name of names){
      expected++;
      if(name!==String(expected).padStart(10,'0')+'.json')
        throw Error('JOURNAL_VERSION_GAP');
      const record=JSON.parse(fs.readFileSync(path.join(this.eventsPath,name),'utf8'));
      const {digest:checksum,...payload}=record;
      if(!checksum||checksum!==digest(JSON.stringify(payload))||
         payload.prevHash!==lastHash||
         payload.fromVersion!==state.version||
         payload.toVersion!==state.version+1||
         payload.header?.runId!==state.runId||
         payload.header?.scopeKey!==state.scopeKey||
         payload.header?.version!==payload.toVersion||
         !payload.changes||Array.isArray(payload.changes)||
         typeof payload.changes!=='object')
        throw Error('JOURNAL_CORRUPT_OR_DRIFTED');
      for(const key of Object.keys(payload.changes)){
        if(!Object.hasOwn(state.entries,key))
          throw Error('JOURNAL_UNEXPECTED_NEW_ENTRY');
      }
      state=check({...state,...payload.header,
        entries:{...state.entries,...payload.changes}});
      lastHash=checksum;
    }
    this.cached=copy(state);this.lastHash=lastHash;
    this.recordCount=names.length;
    return copy(state);
  }
  update(transition){
    if(typeof transition!=='function')throw Error('TRANSITION_REQUIRED');
    fs.mkdirSync(this.lockPath,{mode:0o700}); // fail closed; no auto lock stealing
    try{
      const old=this.read();
      const next=check(transition(copy(old)));
      if(next.version!==old.version+1||
         next.runId!==old.runId||next.scopeKey!==old.scopeKey)
        throw Error('JOURNAL_VERSION_OR_SCOPE_DRIFT');
      const changes={};
      for(const [key,item] of Object.entries(next.entries)){
        if(!Object.hasOwn(old.entries,key))
          throw Error('JOURNAL_PLAN_MUTATION_DISALLOWED');
        if(JSON.stringify(item)!==JSON.stringify(old.entries[key]))
          changes[key]=item;
      }
      if(Object.keys(next.entries).length!==Object.keys(old.entries).length)
        throw Error('JOURNAL_PLAN_MUTATION_DISALLOWED');
      const payload={
        fromVersion:old.version,toVersion:next.version,
        prevHash:this.lastHash,
        header:header(next),changes
      };
      const checksum=digest(JSON.stringify(payload));
      const record=JSON.stringify({...payload,digest:checksum})+'\n';
      const target=fileFor(this.eventsPath,next.version);
      if(fs.existsSync(target))throw Error('JOURNAL_DUPLICATE_VERSION');
      writeDurably(target,record);
      this.cached=copy(next);this.lastHash=checksum;this.recordCount++;
      return copy(next);
    }finally{
      fs.rmdirSync(this.lockPath);
    }
  }
}
