/**
 * Private, immutable Report-wave witness store.
 *
 * Stores exact Fetch response bytes and the private wave/proof projection
 * outside the public checkout. It is intentionally separate from the
 * public HMAC archive and is never used by GitHub Actions ephemeral storage.
 */
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {brotliCompressSync,brotliDecompressSync,constants} from 'node:zlib';

const need=(v,c)=>{if(!v)throw Error(c);};
const shaBytes=v=>createHash('sha256').update(v).digest('hex');
const shaObject=v=>shaBytes(Buffer.from(JSON.stringify(v),'utf8'));
const validSha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const under=(p,base)=>p===base||p.startsWith(base+path.sep);
const MAX_EXPANDED_BYTES=16*1024*1024;
const witnessPath=(waveSha256)=>{
  need(validSha(waveSha256),'PRIVATE_WAVE_WITNESS_WAVE_SHA_INVALID');
  return 'report-wave-witnesses/'+waveSha256+'.json.br';
};
function waveIdentity(wave){
  need(wave&&typeof wave.waveId==='string'&&wave.waveId&&
    typeof wave.scopeKey==='string'&&wave.scopeKey&&
    typeof wave.reportCode==='string'&&wave.reportCode&&
    Array.isArray(wave.fightGroups)&&wave.fightGroups.length>=1&&
    wave.fightGroups.length<=8,'PRIVATE_WAVE_WITNESS_WAVE_INVALID');
  const seen=new Set();
  for(const group of wave.fightGroups){
    need(group.scopeKey===wave.scopeKey&&
      group.reportCode===wave.reportCode&&
      Number.isSafeInteger(group.fightId)&&group.fightId>0&&
      Number.isSafeInteger(group.encounterId)&&group.encounterId>0&&
      Number.isSafeInteger(group.difficulty)&&group.difficulty>0&&
      (group.reportRevision==null||
        Number.isSafeInteger(group.reportRevision)&&group.reportRevision>=0)&&
      Array.isArray(group.slots)&&group.slots.length>0,
      'PRIVATE_WAVE_WITNESS_GROUP_INVALID');
    const key=JSON.stringify([group.reportCode,group.reportRevision,
      group.fightId,group.encounterId,group.difficulty]);
    need(!seen.has(key),'PRIVATE_WAVE_WITNESS_DUPLICATE_FIGHT');
    seen.add(key);
    const slots=new Set();
    for(const slot of group.slots){
      const slotKey=JSON.stringify([slot.jobKey,slot.rank,slot.snapshotSha]);
      need(typeof slot.jobKey==='string'&&slot.jobKey&&
        Number.isSafeInteger(slot.rank)&&slot.rank>=1&&slot.rank<=100&&
        validSha(slot.snapshotSha)&&Number.isFinite(slot.totalDps)&&
        slot.totalDps>0&&Number.isFinite(slot.startTime)&&
        slot.startTime>0&&!slots.has(slotKey),
        'PRIVATE_WAVE_WITNESS_SLOT_INVALID');
      slots.add(slotKey);
    }
  }
  return true;
}
function validateWitness(witness,sourceSha256){
  need(witness?.schema===1&&
    witness.kind==='FRESH216_PRIVATE_REPORT_WAVE_WITNESS_V1'&&
    witness.sourceSha256===sourceSha256&&
    validSha(witness.sourceSha256)&&validSha(witness.waveSha256)&&
    validSha(witness.requestBodySha256)&&validSha(witness.responseBodySha256)&&
    Number.isSafeInteger(witness.httpStatus)&&witness.httpStatus===200&&
    Number.isFinite(witness.observedPoints)&&witness.observedPoints>=0&&
    Number.isSafeInteger(witness.capturedAtMs)&&witness.capturedAtMs>0&&
    typeof witness.attemptId==='string'&&witness.attemptId.length>0&&
    typeof witness.requestBodyText==='string'&&
    typeof witness.responseBodyBase64==='string'&&
    Array.isArray(witness.joinedByFight)&&
    witness.joinedByFight.length===witness.wave?.fightGroups?.length,
    'PRIVATE_WAVE_WITNESS_SHAPE_INVALID');
  waveIdentity(witness.wave);
  need(shaObject(witness.wave)===witness.waveSha256,
    'PRIVATE_WAVE_WITNESS_WAVE_SHA_MISMATCH');
  need(shaBytes(Buffer.from(witness.requestBodyText,'utf8'))===
    witness.requestBodySha256,'PRIVATE_WAVE_WITNESS_REQUEST_SHA_MISMATCH');
  let raw;
  try{raw=Buffer.from(witness.responseBodyBase64,'base64');}
  catch{throw Error('PRIVATE_WAVE_WITNESS_RESPONSE_BASE64_INVALID');}
  need(raw.length>0&&raw.toString('base64')===witness.responseBodyBase64&&
    shaBytes(raw)===witness.responseBodySha256,
    'PRIVATE_WAVE_WITNESS_RESPONSE_SHA_MISMATCH');
  for(let i=0;i<witness.joinedByFight.length;i++){
    const joined=witness.joinedByFight[i],group=witness.wave.fightGroups[i];
    need(joined&&Array.isArray(joined.verified)&&
      Array.isArray(joined.unresolved)&&
      joined.verified.length+joined.unresolved.length===group.slots.length,
      'PRIVATE_WAVE_WITNESS_JOIN_COVERAGE');
  }
  return raw;
}
export function createPrivateWaveWitnessStore({
  privateDir,repoRoot,sourceSha256
}={}){
  need(process.platform==='linux'&&typeof privateDir==='string'&&
    path.isAbsolute(privateDir)&&typeof repoRoot==='string'&&
    path.isAbsolute(repoRoot)&&validSha(sourceSha256),
    'PRIVATE_WAVE_WITNESS_CONFIG_INVALID');
  need(!fs.existsSync(privateDir)||!fs.lstatSync(privateDir).isSymbolicLink(),
    'PRIVATE_WAVE_WITNESS_SYMLINK_ROOT_FORBIDDEN');
  fs.mkdirSync(privateDir,{recursive:true,mode:0o700});
  const repo=fs.realpathSync(repoRoot),root=fs.realpathSync(privateDir);
  need(!under(root,repo)&&!under(repo,root),
    'PRIVATE_WAVE_WITNESS_PUBLIC_CHECKOUT_FORBIDDEN');
  need((fs.statSync(root).mode&0o077)===0,
    'PRIVATE_WAVE_WITNESS_ROOT_MODE_INVALID');
  for(let dir=root;dir!==path.dirname(dir);dir=path.dirname(dir)){
    if(fs.existsSync(path.join(dir,'.git')))
      throw Error('PRIVATE_WAVE_WITNESS_GIT_WORKTREE_FORBIDDEN');
  }
  const folder=path.join(root,'report-wave-witnesses');
  if(!fs.existsSync(folder))fs.mkdirSync(folder,{mode:0o700});
  need(!fs.lstatSync(folder).isSymbolicLink()&&
    (fs.statSync(folder).mode&0o077)===0,
    'PRIVATE_WAVE_WITNESS_FOLDER_MODE_INVALID');
  function resolveRef(ref){
    need(typeof ref==='string'&&
      /^report-wave-witnesses\/[a-f0-9]{64}\.json\.br$/.test(ref),
      'PRIVATE_WAVE_WITNESS_REF_INVALID');
    const target=path.join(root,ref);
    need(under(target,folder),'PRIVATE_WAVE_WITNESS_PATH_ESCAPE');
    return target;
  }
  function persist(input){
    const witness={
      schema:1,kind:'FRESH216_PRIVATE_REPORT_WAVE_WITNESS_V1',
      sourceSha256,waveSha256:shaObject(input.wave),
      requestBodySha256:input.requestBodySha256,
      responseBodySha256:input.responseBodySha256,
      httpStatus:input.httpStatus,observedPoints:input.observedPoints,
      capturedAtMs:input.capturedAtMs,attemptId:input.attemptId,
      requestBodyText:input.requestBodyText,
      responseBodyBase64:Buffer.from(input.responseBodyBytes).toString('base64'),
      wave:input.wave,joinedByFight:input.joinedByFight
    };
    validateWitness(witness,sourceSha256);
    const json=Buffer.from(JSON.stringify(witness)+'\n','utf8');
    need(json.length<=MAX_EXPANDED_BYTES,
      'PRIVATE_WAVE_WITNESS_EXPANDED_SIZE_LIMIT');
    const bytes=brotliCompressSync(json,{params:{
      [constants.BROTLI_PARAM_QUALITY]:4
    }});
    const witnessSha256=shaBytes(bytes);
    const ref=witnessPath(witness.waveSha256),target=resolveRef(ref);
    if(fs.existsSync(target)){
      const stat=fs.lstatSync(target);
      need(stat.isFile()&&!stat.isSymbolicLink()&&(stat.mode&0o077)===0,
        'PRIVATE_WAVE_WITNESS_EXISTING_FILE_UNSAFE');
      const existing=fs.readFileSync(target);
      need(shaBytes(existing)===witnessSha256,
        'PRIVATE_WAVE_WITNESS_EXISTING_CONFLICT');
      return {schema:1,sourceSha256,waveId:witness.wave.waveId,
        waveSha256:witness.waveSha256,witnessRef:ref,witnessSha256,reused:true};
    }
    const tmp=target+'.'+randomUUID()+'.tmp';
    const fd=fs.openSync(tmp,'wx',0o600);
    try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}
    finally{fs.closeSync(fd);}
    try{
      // link() is create-only: a racing writer cannot be overwritten.
      fs.linkSync(tmp,target);
      fs.unlinkSync(tmp);
    }catch(error){
      try{fs.unlinkSync(tmp);}catch{}
      if(error?.code==='EEXIST'){
        const existing=fs.readFileSync(target);
        need(shaBytes(existing)===witnessSha256,
          'PRIVATE_WAVE_WITNESS_EXISTING_CONFLICT');
        return {schema:1,sourceSha256,waveSha256:witness.waveSha256,
          witnessRef:ref,witnessSha256,reused:true};
      }
      throw error;
    }
    const dirfd=fs.openSync(folder,'r');
    try{fs.fsyncSync(dirfd);}finally{fs.closeSync(dirfd);}
    return {schema:1,sourceSha256,waveId:witness.wave.waveId,
      waveSha256:witness.waveSha256,witnessRef:ref,witnessSha256,reused:false};
  }
  function read(ref){
    const target=resolveRef(ref),stat=fs.lstatSync(target);
    need(stat.isFile()&&!stat.isSymbolicLink()&&(stat.mode&0o077)===0,
      'PRIVATE_WAVE_WITNESS_FILE_UNSAFE');
    const bytes=fs.readFileSync(target),witnessSha256=shaBytes(bytes);
    const raw=brotliDecompressSync(bytes,{maxOutputLength:MAX_EXPANDED_BYTES});
    const witness=JSON.parse(raw.toString('utf8'));
    const responseBodyBytes=validateWitness(witness,sourceSha256);
    need(witnessPath(witness.waveSha256)===ref,
      'PRIVATE_WAVE_WITNESS_REF_CONTENT_MISMATCH');
    return {...witness,responseBodyBytes,witnessRef:ref,witnessSha256};
  }
  return {persist,read,pathForWave:witnessPath};
}
