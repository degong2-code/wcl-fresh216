import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
  buildActorProofArchive,verifyActorProofArchive,buildActorProofWaveManifest,
  verifyActorProofWaveManifest,replayActorProofArchive,ACTOR_PROOF_ARCHIVE_KEY_ID
} from '../src/core/fresh216-actor-proof-archive.mjs';
import {resolveExactBossDps} from '../src/core/resolve-proof.mjs';

const KEY='SYNTHETIC_ONLY_HMAC_KEY_DO_NOT_USE_IN_PRODUCTION_20261031';
const sha=x=>createHash('sha256').update(x).digest('hex');
const sourceSha256='a'.repeat(64),waveSha256='b'.repeat(64);
const requestBodySha256=sha('synthetic-query-bytes');
const responseBodySha256=sha('synthetic-response-bytes');
const baseSlot=(overrides={})=>({
 jobKey:'BossA|Hunter|Marksmanship',rank:1,
 snapshotSha:'c'.repeat(64),name:'Anonymous',
 totalDps:1000,className:'Hunter',specName:'Marksmanship',
 startTime:1792594801000,reportRevision:5,...overrides
});
const actor=(id,name,amount,changes={})=>({
 id,name,class:'Hunter',spec:'Marksmanship',amount,...changes
});
const fight=characters=>({
 fightID:12,encounter:{id:3470},difficulty:4,
 roles:{dps:{characters}}
});
const report=(overall=[actor(7,'Player (4)',1000)],
 boss=[actor(7,'Player (4)',700)],changes={})=>({
 code:'SYNTHETIC-PRIVATE-REPORT',revision:5,
 overall:{data:[fight(overall)]},boss:{data:[fight(boss)]},...changes
});
const group=(slots=[baseSlot()],changes={})=>({
 scopeKey:'heroic:2026-10-22_27:latest:source',
 reportCode:'SYNTHETIC-PRIVATE-REPORT',reportRevision:5,
 fightId:12,encounterId:3470,difficulty:4,slots,...changes
});
const build=(overrides={})=>buildActorProofArchive({
 group:group(),report:report(),sourceSha256,waveSha256,
 requestBodySha256,responseBodySha256,httpStatus:200,
 observedPoints:24,capturedAtMs:1793450000000,hmacKey:KEY,
 ...overrides
});
test('redacted archive replays exact same-fight TotalDPS to BossDPS attribution',()=>{
 const a=build();
 const v=verifyActorProofArchive(a,{hmacKey:KEY,expectedSourceSha256:sourceSha256});
 assert.equal(v.valid,true);
 assert.equal(v.verifiedSlots,1);
 assert.equal(v.unresolvedSlots,0);
 assert.equal(v.outcomes[0].totalDps,1000);
 assert.equal(v.outcomes[0].bossDps,700);
 assert.equal(v.outcomes[0].proofType,'EXACT_SAME_FIGHT_ACTOR');
 assert.equal(a.reportRevision,5);
 assert.equal(a.fightId,12);
 assert.equal(a.encounterId,3470);
 assert.equal(a.difficulty,4);
 assert.equal(a.observedPoints,24);
 assert.equal(a.keyId,ACTOR_PROOF_ARCHIVE_KEY_ID);
});
test('two specializations in one report/fight remain distinct and both replay',()=>{
 const s1=baseSlot();
 const s2=baseSlot({
  jobKey:'BossA|Mage|Arcane',rank:37,snapshotSha:'d'.repeat(64),
  totalDps:900,className:'Mage',specName:'Arcane'
 });
 const a=build({
  group:group([s1,s2]),
  report:report([
   actor(7,'Player (4)',1000),
   actor(8,'Player (5)',900,{class:'Mage',spec:'Arcane'})
  ],[
   actor(7,'Player (4)',700),
   actor(8,'Player (5)',600,{class:'Mage',spec:'Arcane'})
  ])
 });
 const v=replayActorProofArchive(a,{hmacKey:KEY});
 assert.equal(v.verifiedSlots,2);
 assert.deepEqual(v.outcomes.map(x=>x.bossDps),[700,600]);
 assert.notEqual(v.outcomes[0].actorToken,v.outcomes[1].actorToken);
});
test('public archive omits raw report code, actor IDs, actor names and actorRef',()=>{
 const a=build();
 const text=JSON.stringify(a);
 for(const secret of [
  'SYNTHETIC-PRIVATE-REPORT','Player (4)','id:7','HunterDemo'
 ])assert.equal(text.includes(secret),false,secret);
 const forbidden=['reportCode','actorRef','name','id','sourceID','sourceId'];
 const walk=v=>{
  if(Array.isArray(v)){v.forEach(walk);return;}
  if(v&&typeof v==='object'){
   for(const [k,x] of Object.entries(v)){
    assert.equal(forbidden.includes(k),false,k);walk(x);
   }
  }
 };
 walk(a);
 assert.match(a.overallRoster[0].actorToken,/^hmac-sha256:v1:[a-f0-9]{64}$/);
 assert.match(a.reportToken,/^hmac-sha256:v1:[a-f0-9]{64}$/);
});
test('report-local actor token is domain-separated across report, revision and fight',()=>{
 const first=build();
 const otherReport=build({
  group:group(undefined,{reportCode:'ANOTHER-PRIVATE-REPORT'}),
  report:report(undefined,undefined,{code:'ANOTHER-PRIVATE-REPORT'})
 });
 const otherFight=build({
  group:group(undefined,{fightId:13}),
  report:{
   code:'SYNTHETIC-PRIVATE-REPORT',revision:5,
   overall:{data:[{...fight([actor(7,'Player (4)',1000)]),fightID:13}]},
   boss:{data:[{...fight([actor(7,'Player (4)',700)]),fightID:13}]}
  }
 });
 assert.notEqual(first.reportToken,otherReport.reportToken);
 assert.notEqual(first.overallRoster[0].actorToken,
   otherReport.overallRoster[0].actorToken);
 assert.notEqual(first.overallRoster[0].actorToken,
   otherFight.overallRoster[0].actorToken);
});
test('positive report-local actor ID and stable Player(n) label are accepted',()=>{
 const byId=build();
 const noId=build({
  report:report([actor(null,'Player (4)',1000)],
    [actor(null,'Player (4)',700)])
 });
 assert.equal(verifyActorProofArchive(byId,{hmacKey:KEY}).verifiedSlots,1);
 assert.equal(verifyActorProofArchive(noId,{hmacKey:KEY}).verifiedSlots,1);
 assert.equal(noId.overallRoster[0].identityKind,'MASKED_PLAYER_LABEL');
});
test('Anonymous without stable actor identity remains unresolved',()=>{
 const a=build({
  report:report([actor(null,'Anonymous',1000)],
    [actor(null,'Anonymous',700)])
 });
 const v=verifyActorProofArchive(a,{hmacKey:KEY});
 assert.equal(v.verifiedSlots,0);
 assert.equal(v.outcomes[0].reason,'ACTOR_IDENTITY_UNAVAILABLE');
});
test('duplicate TotalDPS candidate is ambiguous; no actor is guessed',()=>{
 const a=build({
  report:report([
   actor(7,'Player (4)',1000),actor(8,'Player (5)',1000)
  ])
 });
 const v=verifyActorProofArchive(a,{hmacKey:KEY});
 assert.equal(v.verifiedSlots,0);
 assert.equal(v.outcomes[0].reason,'AMBIGUOUS_TOTAL_DPS_MATCH');
});
test('duplicate actor in the overall roster is a collision',()=>{
 const a=build({
  report:report([
   actor(7,'Player (4)',1000),actor(7,'Player (4)',900)
  ])
 });
 const v=verifyActorProofArchive(a,{hmacKey:KEY});
 assert.equal(v.verifiedSlots,0);
 assert.equal(v.outcomes[0].reason,'OVERALL_ACTOR_COLLISION');
});
test('duplicate boss actor rows and BossDPS above TotalDPS are rejected',()=>{
 for(const r of [
  report(undefined,[actor(7,'Player (4)',700),actor(7,'Player (4)',699)]),
  report(undefined,[actor(7,'Player (4)',1001)])
 ]){
  const a=build({report:r});
  const v=verifyActorProofArchive(a,{hmacKey:KEY});
  assert.equal(v.verifiedSlots,0);
  assert.ok(v.outcomes[0].reason);
 }
});
test('one report-local actor cannot be assigned to two A source slots',()=>{
 const a=build({
  group:group([
   baseSlot(),
   baseSlot({jobKey:'BossB|Hunter|Marksmanship',rank:2,snapshotSha:'e'.repeat(64)})
  ])
 });
 const v=verifyActorProofArchive(a,{hmacKey:KEY});
 assert.equal(v.verifiedSlots,0);
 assert.equal(v.unresolvedSlots,2);
 assert.ok(v.outcomes.every(x=>x.reason==='ACTOR_CLAIM_COLLISION'));
});
test('Player(n) source label must match the same report-local label when no A name exists',()=>{
 const a=build({
  group:group([baseSlot({name:'Player (3)'})])
 });
 const v=verifyActorProofArchive(a,{hmacKey:KEY});
 assert.equal(v.verifiedSlots,0);
 assert.equal(v.outcomes[0].reason,'NAME_TOKEN_MISMATCH');
});
test('named source slot requires exact pseudonymized name match',()=>{
 const a=build({
  group:group([baseSlot({name:'AliceExample'})]),
  report:report([actor(7,'OtherExample',1000)])
 });
 const v=verifyActorProofArchive(a,{hmacKey:KEY});
 assert.equal(v.verifiedSlots,0);
 assert.equal(v.outcomes[0].reason,'NO_TOTAL_DPS_MATCH');
});
test('report code/revision, fight/encounter/difficulty and source slot scope are pinned',()=>{
 assert.throws(()=>build({
  report:report(undefined,undefined,{code:'OTHER'})
 }),/ACTOR_ARCHIVE_REPORT_IDENTITY/);
 assert.throws(()=>build({
  group:group(undefined,{reportRevision:4})
 }),/ACTOR_ARCHIVE_REPORT_IDENTITY/);
 assert.throws(()=>build({
  group:group(undefined,{fightId:13})
 }),/ACTOR_ARCHIVE_FIGHT_NOT_UNIQUE/);
 assert.throws(()=>build({
  report:report(undefined,undefined,{revision:6})
 }),/ACTOR_ARCHIVE_REPORT_IDENTITY/);
 assert.throws(()=>build({
  group:group([baseSlot({reportRevision:4})])
 }),/ACTOR_ARCHIVE_SOURCE_SLOT_INVALID/);
});
test('missing/duplicate fight rows fail closed',()=>{
 const r=report();
 r.boss.data.push(fight([actor(7,'Player (4)',700)]));
 assert.throws(()=>build({report:r}),/ACTOR_ARCHIVE_FIGHT_NOT_UNIQUE/);
});
test('archive HMAC, content hash and expected provenance detect tampering',()=>{
 const original=build();
 const tampered=structuredClone(original);
 tampered.overallRoster[0].amount=999;
 assert.throws(()=>verifyActorProofArchive(tampered,{hmacKey:KEY}),
  /ACTOR_ARCHIVE_CONTENT_SHA_MISMATCH/);
 assert.throws(()=>verifyActorProofArchive(original,{hmacKey:'WRONG_KEY_'.repeat(5)}),
  /ACTOR_ARCHIVE_HMAC_INVALID/);
 assert.throws(()=>verifyActorProofArchive(original,{
  hmacKey:KEY,expectedResponseBodySha256:'f'.repeat(64)
 }),/ACTOR_ARCHIVE_RESPONSE_SHA_MISMATCH/);
});
test('response/request/source provenance is mandatory and key length is guarded',()=>{
 assert.throws(()=>build({responseBodySha256:'bad'}),
  /ACTOR_ARCHIVE_PROVENANCE_HASH_INVALID/);
 assert.throws(()=>build({requestBodySha256:'bad'}),
  /ACTOR_ARCHIVE_PROVENANCE_HASH_INVALID/);
 assert.throws(()=>build({sourceSha256:'bad'}),
  /ACTOR_ARCHIVE_PROVENANCE_HASH_INVALID/);
 assert.throws(()=>build({hmacKey:'short'}),
  /ACTOR_ARCHIVE_HMAC_KEY_TOO_SHORT/);
 assert.throws(()=>build({httpStatus:503}),
  /ACTOR_ARCHIVE_RESPONSE_PROVENANCE_INVALID/);
});
test('archive key and bounded size are explicit',()=>{
 const a=build();
 assert.equal(a.keyId,'fresh216-evidence-hmac-v1');
 assert.ok(Buffer.byteLength(JSON.stringify(a),'utf8')<512*1024);
});

test('per-wave manifest binds all fight archives and aggregate proof counts',()=>{
 const first=build();
 const second=build({
  group:group(undefined,{fightId:13}),
  report:{
   code:'SYNTHETIC-PRIVATE-REPORT',revision:5,
   overall:{data:[{...fight([actor(7,'Player (4)',1000)]),fightID:13}]},
   boss:{data:[{...fight([actor(7,'Player (4)',700)]),fightID:13}]}
  }
 });
 const manifest=buildActorProofWaveManifest({
  archives:[first,second],hmacKey:KEY,createdAtMs:1793450001000
 });
 const v=verifyActorProofWaveManifest(manifest,{
  hmacKey:KEY,archives:[second,first]
 });
 assert.equal(v.valid,true);
 assert.equal(v.archiveCount,2);
 assert.equal(v.verifiedSlots,2);
 assert.equal(v.unresolvedSlots,0);
 assert.notEqual(first.fightToken,second.fightToken);
 assert.equal(JSON.stringify(manifest).includes('SYNTHETIC-PRIVATE-REPORT'),false);
});
test('wave manifest rejects tampered archive links, missing archives and wrong key',()=>{
 const first=build();
 const second=build({
  group:group(undefined,{fightId:13}),
  report:{
   code:'SYNTHETIC-PRIVATE-REPORT',revision:5,
   overall:{data:[{...fight([actor(7,'Player (4)',1000)]),fightID:13}]},
   boss:{data:[{...fight([actor(7,'Player (4)',700)]),fightID:13}]}
  }
 });
 const manifest=buildActorProofWaveManifest({
  archives:[first,second],hmacKey:KEY,createdAtMs:1793450001000
 });
 assert.throws(()=>verifyActorProofWaveManifest(manifest,{
  hmacKey:KEY,archives:[first]
 }),/ACTOR_WAVE_MANIFEST_ARCHIVES_REQUIRED/);
 const bad=structuredClone(manifest);
 bad.archives[0].archiveSha256='f'.repeat(64);
 assert.throws(()=>verifyActorProofWaveManifest(bad,{
  hmacKey:KEY,archives:[first,second]
 }),/ACTOR_WAVE_MANIFEST_CONTENT_SHA_MISMATCH/);
 assert.throws(()=>verifyActorProofWaveManifest(manifest,{
  hmacKey:'WRONG_KEY_'.repeat(5),archives:[first,second]
 }),/ACTOR_WAVE_MANIFEST_HMAC_INVALID/);
});


test('duplicate TotalDPS across different specializations stays ambiguous before class/spec filtering',()=>{
 const g=group();
 const r=report([
  actor(7,'Player (4)',1000),
  actor(8,'Player (5)',1000,{class:'Mage',spec:'Arcane'})
 ],[
  actor(7,'Player (4)',700),
  actor(8,'Player (5)',600,{class:'Mage',spec:'Arcane'})
 ]);
 const slot={...baseSlot(),fightId:g.fightId,
  encounterId:g.encounterId,difficulty:g.difficulty};
 assert.equal(resolveExactBossDps(slot,r),null);
 const a=build({group:g,report:r});
 const v=verifyActorProofArchive(a,{hmacKey:KEY});
 assert.equal(v.verifiedSlots,0);
 assert.equal(v.outcomes[0].reason,'AMBIGUOUS_TOTAL_DPS_MATCH');
});
