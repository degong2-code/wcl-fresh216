import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildActorProofArchive} from '../src/core/fresh216-actor-proof-archive.mjs';
import {createPublicActorProofArchiveStore}
 from '../src/adapters/fresh216-public-actor-proof-store.mjs';

const KEY='SYNTHETIC_ONLY_HMAC_KEY_DO_NOT_USE_IN_PRODUCTION_20261031';
const sha=x=>createHash('sha256').update(x).digest('hex');
const blobSha=content=>createHash('sha1')
 .update('blob '+Buffer.byteLength(content)+'\0').update(content).digest('hex');
const archive=(fightId=12)=>buildActorProofArchive({
 group:{
  scopeKey:'heroic:synthetic',reportCode:'SYNTHETIC-PRIVATE-REPORT',
  reportRevision:5,fightId,encounterId:3470,difficulty:4,
  slots:[{
   jobKey:'BossA|Hunter|Marksmanship',rank:1,
   snapshotSha:'c'.repeat(64),name:'Anonymous',totalDps:1000,
   className:'Hunter',specName:'Marksmanship',
   startTime:1792594801000,reportRevision:5
  }]
 },
 report:{
  code:'SYNTHETIC-PRIVATE-REPORT',revision:5,
  overall:{data:[{fightID:fightId,encounter:{id:3470},difficulty:4,
   roles:{dps:{characters:[{
    id:7,name:'Player (4)',class:'Hunter',spec:'Marksmanship',amount:1000
   }]}}}]},
  boss:{data:[{fightID:fightId,encounter:{id:3470},difficulty:4,
   roles:{dps:{characters:[{
    id:7,name:'Player (4)',class:'Hunter',spec:'Marksmanship',amount:700
   }]}}}]}
 },
 sourceSha256:'a'.repeat(64),waveSha256:'b'.repeat(64),
 requestBodySha256:sha('synthetic-query'),
 responseBodySha256:sha('synthetic-response'),
 httpStatus:200,observedPoints:24,capturedAtMs:1793450000000,
 hmacKey:KEY
});
function fakeGithub(){
 let saved=null,puts=0,gets=0,deny=false,corrupt=false;
 const fetchImpl=async(url,init={})=>{
  assert.ok(url.startsWith(
   'https://api.github.com/repos/degong2-code/wcl-fresh216/contents/evidence/fresh216/actor-proof/'
  ));
  assert.equal(init.redirect,'error');
  const method=init.method??'GET';
  if(method==='GET'){
   gets++;
   if(saved===null)return {status:404};
   const responseContent=corrupt?saved.content.replace('"bossDps": 700','"bossDps": 701'):saved.content;
   return {status:200,json:async()=>({
    sha:saved.sha,encoding:'base64',
    content:Buffer.from(responseContent,'utf8').toString('base64')
   })};
  }
  assert.equal(method,'PUT');puts++;
  if(deny)return {status:403};
  assert.equal(saved,null);
  const req=JSON.parse(init.body);
  assert.equal(req.branch,'fresh216-public-evidence-pilot-20261031');
  assert.match(req.message,/append redacted actor proof archive/);
  const text=Buffer.from(req.content,'base64').toString('utf8');
  saved={content:text,sha:blobSha(text)};
  return {status:201,json:async()=>({
   content:{sha:saved.sha},commit:{sha:'a'.repeat(40)}
  })};
 };
 return {
  fetchImpl,puts:()=>puts,gets:()=>gets,
  deny:()=>{deny=true;},corrupt:()=>{corrupt=true;},
  saved:()=>saved
 };
}
test('archive store creates one append-only file and verifies exact readback',async()=>{
 const gh=fakeGithub(),a=archive();
 const store=createPublicActorProofArchiveStore({
  token:'SYNTHETIC_GITHUB_TOKEN_WITH_ENOUGH_LENGTH',
  hmacKey:KEY,fetchImpl:gh.fetchImpl
 });
 const r=await store.persist(a);
 assert.equal(r.archiveId,a.archiveId);
 assert.equal(r.verifiedSlots,1);
 assert.equal(r.unresolvedSlots,0);
 assert.equal(gh.puts(),1);
 assert.equal(gh.gets(),2);
 assert.equal(JSON.parse(gh.saved().content).archiveSha256,a.archiveSha256);
 assert.match(r.path,/^[a-z0-9/.-]+[a-f0-9]{64}\.json$/);
});
test('existing archive path is never overwritten or retried',async()=>{
 const gh=fakeGithub(),a=archive();
 const store=createPublicActorProofArchiveStore({
  token:'SYNTHETIC_GITHUB_TOKEN_WITH_ENOUGH_LENGTH',
  hmacKey:KEY,fetchImpl:gh.fetchImpl
 });
 await store.persist(a);
 await assert.rejects(store.persist(a),/PUBLIC_ACTOR_ARCHIVE_ALREADY_EXISTS_STOP/);
 assert.equal(gh.puts(),1);
});
test('denied or uncertain GitHub write fails closed with one PUT attempt',async()=>{
 const gh=fakeGithub();gh.deny();
 const store=createPublicActorProofArchiveStore({
  token:'SYNTHETIC_GITHUB_TOKEN_WITH_ENOUGH_LENGTH',
  hmacKey:KEY,fetchImpl:gh.fetchImpl
 });
 await assert.rejects(store.persist(archive()),
  /PUBLIC_ACTOR_ARCHIVE_WRITE_UNCONFIRMED_STOP/);
 assert.equal(gh.puts(),1);
});
test('readback tampering is detected after the one successful PUT',async()=>{
 const gh=fakeGithub(),store=createPublicActorProofArchiveStore({
  token:'SYNTHETIC_GITHUB_TOKEN_WITH_ENOUGH_LENGTH',
  hmacKey:KEY,fetchImpl:gh.fetchImpl
 });
 gh.corrupt();
 await assert.rejects(store.persist(archive()),
  /PUBLIC_ACTOR_ARCHIVE_READBACK_MISMATCH_STOP/);
 assert.equal(gh.puts(),1);
});
test('invalid HMAC key is rejected before any GitHub access',()=>{
 let calls=0;
 assert.throws(()=>createPublicActorProofArchiveStore({
  token:'SYNTHETIC_GITHUB_TOKEN_WITH_ENOUGH_LENGTH',hmacKey:'short',
  fetchImpl:async()=>{calls++;throw Error('unexpected network');}
 }),/ACTOR_ARCHIVE_HMAC_KEY_TOO_SHORT/);
 assert.equal(calls,0);
});
test('tampered archive is rejected before any GitHub access',async()=>{
 let calls=0;const a=archive();a.slots[0].totalDps=1;
 const store=createPublicActorProofArchiveStore({
  token:'SYNTHETIC_GITHUB_TOKEN_WITH_ENOUGH_LENGTH',hmacKey:KEY,
  fetchImpl:async()=>{calls++;throw Error('unexpected network');}
 });
 await assert.rejects(store.persist(a),/ACTOR_ARCHIVE_CONTENT_SHA_MISMATCH/);
 assert.equal(calls,0);
});

function fakeGithubMany({failPutAt=null}={}){
 const files=new Map();let puts=0,gets=0;
 const fetchImpl=async(url,init={})=>{
  assert.ok(url.startsWith(
   'https://api.github.com/repos/degong2-code/wcl-fresh216/contents/'
  ));
  assert.equal(init.redirect,'error');
  const path=url.split('/contents/')[1].split('?')[0];
  const method=init.method??'GET';
  if(method==='GET'){
   gets++;
   if(!files.has(path))return {status:404};
   const saved=files.get(path);
   return {status:200,json:async()=>({
    sha:saved.sha,encoding:'base64',
    content:Buffer.from(saved.content,'utf8').toString('base64')
   })};
  }
  assert.equal(method,'PUT');puts++;
  if(puts===failPutAt)return {status:403};
  const req=JSON.parse(init.body);
  assert.equal(req.branch,'fresh216-public-evidence-pilot-20261031');
  if(files.has(path))return {status:422};
  const content=Buffer.from(req.content,'base64').toString('utf8');
  const saved={content,sha:blobSha(content)};
  files.set(path,saved);
  return {status:201,json:async()=>({
   content:{sha:saved.sha},commit:{sha:String(puts).padStart(40,'a')}
  })};
 };
 return {fetchImpl,puts:()=>puts,gets:()=>gets,files};
}
test('persistWave appends every fight archive before a signed manifest',async()=>{
 const gh=fakeGithubMany(),archives=[archive(),archive(13)];
 const store=createPublicActorProofArchiveStore({
  token:'SYNTHETIC_GITHUB_TOKEN_WITH_ENOUGH_LENGTH',
  hmacKey:KEY,fetchImpl:gh.fetchImpl
 });
 const result=await store.persistWave(archives,{createdAtMs:1793450002000});
 assert.equal(result.archiveCount,2);
 assert.equal(result.verifiedSlots,2);
 assert.equal(result.unresolvedSlots,0);
 assert.equal(result.archiveReceipts.length,2);
 assert.equal(gh.puts(),3);
 assert.equal(gh.files.size,3);
 const manifest=JSON.parse(gh.files.get(result.manifestPath).content);
 assert.equal(manifest.archives.length,2);
 assert.equal(manifest.waveSha256,archives[0].waveSha256);
 assert.equal(JSON.stringify(manifest).includes('SYNTHETIC-PRIVATE-REPORT'),false);
});
test('partial wave archive write leaves no manifest and never retries',async()=>{
 const gh=fakeGithubMany({failPutAt:2}),archives=[archive(),archive(13)];
 const store=createPublicActorProofArchiveStore({
  token:'SYNTHETIC_GITHUB_TOKEN_WITH_ENOUGH_LENGTH',
  hmacKey:KEY,fetchImpl:gh.fetchImpl
 });
 await assert.rejects(store.persistWave(archives,{createdAtMs:1793450002000}),
  /PUBLIC_ACTOR_ARCHIVE_WRITE_UNCONFIRMED_STOP/);
 assert.equal(gh.puts(),2);
 assert.equal(gh.files.size,1);
 assert.equal([...gh.files.keys()].some(x=>x.startsWith('evidence/fresh216/waves/')),false);
});
