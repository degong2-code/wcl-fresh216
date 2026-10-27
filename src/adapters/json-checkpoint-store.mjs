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
  }
  read(){return check(JSON.parse(fs.readFileSync(this.filePath,'utf8')));}
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
      const old=this.read();
      const next=check(transition(structuredClone(old)));
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
      return this.read();
    } finally {
      if(temp&&fs.existsSync(temp))fs.unlinkSync(temp);
      fs.rmdirSync(this.lockPath);
    }
  }
}
