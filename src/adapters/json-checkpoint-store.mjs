import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

/**
 * Local filesystem adapter for the pure checkpoint machine.
 *
 * Designed for a private, PERSISTENT Linux volume, not a public repository or
 * GitHub Actions' ephemeral workspace. It writes 0600, uses atomic rename
 * and rejects concurrent updates. No WCL/Sheets behavior is implemented here.
 *
 * If a process terminates while holding the lock, recovery is MANUAL ONLY.
 * Never blindly delete a lock without checking the running process.
 */
const check=(s)=>{
  if(!s||s.schema!==1||!Number.isSafeInteger(s.version)||s.version<0||
     !s.scopeKey||!s.runId||!s.entries||typeof s.entries!=='object')
    throw new Error('CHECKPOINT_SCHEMA_INVALID');
  return s;
};
export class JsonCheckpointStore {
  constructor(filePath){
    if(typeof filePath!=='string'||!path.isAbsolute(filePath))
      throw new Error('ABSOLUTE_PRIVATE_PATH_REQUIRED');
    this.filePath=filePath;
    this.lockPath=filePath+'.lock';
    this.cached=null;
    this.cachedStamp=null;
  }
  // Atomic rename changes the file identity. Detect another worker changing
  // the checkpoint instead of silently serving an old in-process cache.
  stamp(){
    const info=fs.statSync(this.filePath,{bigint:true});
    return [info.dev,info.ino,info.size,info.mtimeNs,info.ctimeNs]
      .map(v=>String(v)).join(':');
  }
  read(){
    const before=this.stamp();
    if(this.cached){
      if(before!==this.cachedStamp)
        throw new Error('CHECKPOINT_EXTERNAL_CHANGE_REOPEN_REQUIRED');
      return structuredClone(this.cached);
    }
    const state=check(JSON.parse(fs.readFileSync(this.filePath,'utf8')));
    const after=this.stamp();
    if(before!==after)throw Error('CHECKPOINT_READ_RACED_WITH_WRITER');
    this.cached=structuredClone(state);
    this.cachedStamp=after;
    return structuredClone(state);
  }
  /** Initialize exactly once. Refuse overwrite; use mode 0600. */
  init(state){
    check(state);
    fs.mkdirSync(path.dirname(this.filePath),{recursive:true,mode:0o700});
    const fd=fs.openSync(this.filePath,'wx',0o600);
    try{fs.writeFileSync(fd,JSON.stringify(state)+'\n');fs.fsyncSync(fd);}
    finally{fs.closeSync(fd);}
    return this.read();
  }
  /**
   * Atomically apply one pure transition. The update result is durable BEFORE
   * the caller may issue WCL HTTP. No version changes or unrecognized keys
   * can be silently overwritten by a different worker.
   */
  update(transition){
    if(typeof transition!=='function')throw new Error('TRANSITION_REQUIRED');
    fs.mkdirSync(this.lockPath,{mode:0o700}); // fail-closed on contention
    let temp;
    try{
      const old=this.read(); // Already an isolated copy of cached state.
      const next=check(transition(old));
      if(next.runId!==old.runId||next.scopeKey!==old.scopeKey||
         next.version!==old.version+1)throw new Error('CHECKPOINT_VERSION_OR_SCOPE_DRIFT');
      temp=path.join(path.dirname(this.filePath),
        '.'+path.basename(this.filePath)+'.'+randomUUID()+'.tmp');
      const fd=fs.openSync(temp,'wx',0o600);
      try{fs.writeFileSync(fd,JSON.stringify(next)+'\n');fs.fsyncSync(fd);}
      finally{fs.closeSync(fd);}
      fs.renameSync(temp,this.filePath);temp=null;
      // Flush rename's directory entry on Linux persistent storage.
      const dirfd=fs.openSync(path.dirname(this.filePath),'r');
      try{fs.fsyncSync(dirfd);}finally{fs.closeSync(dirfd);}
      // This exact state was just atomically committed; parsing all 21,600
      // ranked slots again is redundant. Keep it in memory while verifying
      // future reads against the on-disk inode/mtime/size fingerprint.
      this.cached=structuredClone(next);
      this.cachedStamp=this.stamp();
      // The caller receives the transition's own next object, while the
      // persistent cache remains insulated by its separate clone.
      return next;
    } finally {
      if(temp&&fs.existsSync(temp))fs.unlinkSync(temp);
      fs.rmdirSync(this.lockPath);
    }
  }
}
