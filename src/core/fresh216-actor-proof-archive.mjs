/**
 * Fresh216 redacted actor-proof archive.
 *
 * Stores the minimum paired TotalDPS/BossDPS roster needed to replay exact
 * same-fight attribution. Raw report codes, actor IDs, actor names and the
 * original WCL body are never copied into this archive.
 *
 * Actor/report/name tokens are HMAC-SHA256 pseudonyms. The HMAC key is a
 * separate >=32-byte secret, never the WCL OAuth secret and never committed.
 * Anyone replaying the archive needs the matching key ID + secret.
 *
 * Important boundary: replay proves the arithmetic/identity join over this
 * redacted projection and verifies its HMAC. It does NOT independently
 * re-derive responseBodySha256 from the original WCL bytes, because those
 * bytes are intentionally not archived. WCL provenance still depends on
 * the trusted runner that captured the response and projection digest.
 */
import {
  createHash,createHmac,timingSafeEqual
} from 'node:crypto';

export const ACTOR_PROOF_ARCHIVE_SCHEMA=1;
export const ACTOR_PROOF_ARCHIVE_KIND='FRESH216_REDACTED_ACTOR_PROOF_ARCHIVE_V1';
export const ACTOR_PROOF_ARCHIVE_KEY_ID='fresh216-evidence-hmac-v1';
export const ACTOR_PROOF_ARCHIVE_MAX_BYTES=512*1024;

const TOKEN_RE=/^hmac-sha256:v1:[a-f0-9]{64}$/;
const SHA_RE=/^[a-f0-9]{64}$/;
const need=(v,c)=>{if(!v)throw Error(c);};
const norm=v=>String(v??'').trim().toLowerCase();
const number=v=>{
  if(typeof v!=='number'&&typeof v!=='string')return null;
  if(typeof v==='string'&&!v.trim())return null;
  const n=Number(v);
  return Number.isFinite(n)?n:null;
};
const shaBytes=b=>createHash('sha256').update(b).digest('hex');
function canonical(v){
  if(v===null||typeof v==='string'||typeof v==='boolean')return JSON.stringify(v);
  if(typeof v==='number'){
    need(Number.isFinite(v),'ACTOR_ARCHIVE_NONFINITE_NUMBER');
    return JSON.stringify(v);
  }
  if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
  need(v&&typeof v==='object'&&
    (Object.getPrototypeOf(v)===Object.prototype||
     Object.getPrototypeOf(v)===null),'ACTOR_ARCHIVE_NON_JSON_VALUE');
  const keys=Object.keys(v).sort();
  return '{'+keys.map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
}
const shaObject=v=>shaBytes(Buffer.from(canonical(v),'utf8'));
const keyBytes=key=>{
  const b=Buffer.isBuffer(key)?key:Buffer.from(String(key??''),'utf8');
  need(b.length>=32,'ACTOR_ARCHIVE_HMAC_KEY_TOO_SHORT');
  return b;
};
const mac=(key,domain,value)=>createHmac('sha256',key)
  .update(domain+'\n'+canonical(value),'utf8').digest('hex');
const token=(key,domain,value)=>'hmac-sha256:v1:'+mac(key,domain,value);
const validSha=v=>typeof v==='string'&&SHA_RE.test(v);
const validToken=v=>typeof v==='string'&&TOKEN_RE.test(v);
const nameKind=v=>{
  const n=norm(v);
  if(!n||n==='anonymous')return 'ANONYMOUS';
  if(/^player\s*\(\d+\)$/i.test(n))return 'MASKED_LABEL';
  return 'NAMED';
};
const rawActorRef=a=>{
  const raw=a?.id;
  const id=(typeof raw==='number'||typeof raw==='string')?Number(raw):NaN;
  if(Number.isSafeInteger(id)&&id>0)return {ref:'id:'+id,kind:'REPORT_ACTOR_ID'};
  const n=norm(a?.name);
  if(n&&n!=='anonymous'){
    return {ref:'name:'+n,
      kind:/^player\s*\([1-9]\d*\)$/i.test(n)?
        'MASKED_PLAYER_LABEL':'REPORT_ACTOR_NAME'};
  }
  return {ref:null,kind:'UNRESOLVED'};
};
const exactKeys=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&
  Object.keys(o).sort().join('|')===keys.slice().sort().join('|');
const eq=(a,b)=>canonical(a)===canonical(b);

function findFight(ranking,group,code){
  need(ranking&&Array.isArray(ranking.data),'ACTOR_ARCHIVE_RANKING_SHAPE');
  const matches=ranking.data.filter(f=>Number(f?.fightID)===group.fightId);
  need(matches.length===1,'ACTOR_ARCHIVE_FIGHT_NOT_UNIQUE');
  const f=matches[0];
  need(Number(f?.encounter?.id)===group.encounterId&&
    Number(f?.difficulty)===group.difficulty,
    'ACTOR_ARCHIVE_FIGHT_SCOPE_MISMATCH');
  const actors=f?.roles?.dps?.characters;
  need(Array.isArray(actors)&&actors.length<=200,
    'ACTOR_ARCHIVE_ROSTER_SHAPE');
  return {fight:f,actors};
}
function validateInput({
  group,report,sourceSha256,waveSha256,requestBodySha256,
  responseBodySha256,httpStatus,observedPoints,capturedAtMs
}){
  need(group&&typeof group.scopeKey==='string'&&group.scopeKey.length>0&&
    typeof group.reportCode==='string'&&group.reportCode.length>0&&
    group.reportCode.length<=128&&
    Number.isSafeInteger(group.fightId)&&group.fightId>0&&
    Number.isSafeInteger(group.encounterId)&&group.encounterId>0&&
    Number.isSafeInteger(group.difficulty)&&group.difficulty>0&&
    Array.isArray(group.slots)&&group.slots.length>=1&&
    group.slots.length<=500,'ACTOR_ARCHIVE_GROUP_INVALID');
  need(report&&report.code===group.reportCode&&
    Number.isSafeInteger(report.revision)&&report.revision>=0&&
    (group.reportRevision==null||group.reportRevision===report.revision),
    'ACTOR_ARCHIVE_REPORT_IDENTITY');
  need(validSha(sourceSha256)&&validSha(waveSha256)&&
    validSha(requestBodySha256)&&validSha(responseBodySha256),
    'ACTOR_ARCHIVE_PROVENANCE_HASH_INVALID');
  need(httpStatus===200&&typeof observedPoints==='number'&&
    Number.isFinite(observedPoints)&&observedPoints>=0&&
    Number.isSafeInteger(capturedAtMs)&&capturedAtMs>0,
    'ACTOR_ARCHIVE_RESPONSE_PROVENANCE_INVALID');
  const seen=new Set(),seenJobRanks=new Set();
  for(const s of group.slots){
    need(s&&typeof s.jobKey==='string'&&s.jobKey.length>0&&
      Number.isSafeInteger(s.rank)&&s.rank>=1&&s.rank<=100&&
      validSha(s.snapshotSha)&&
      typeof s.className==='string'&&s.className.length>0&&
      typeof s.specName==='string'&&s.specName.length>0&&
      number(s.totalDps)>0&&Number.isFinite(Number(s.startTime))&&
      Number(s.startTime)>0&&
      (s.reportRevision==null||
       Number.isSafeInteger(s.reportRevision)&&s.reportRevision>=0)&&
      (s.reportRevision==null||s.reportRevision===report.revision),
      'ACTOR_ARCHIVE_SOURCE_SLOT_INVALID');
    const k=JSON.stringify([s.jobKey,s.rank,s.snapshotSha]);
    const jobRank=JSON.stringify([s.jobKey,s.rank]);
    need(!seen.has(k)&&!seenJobRanks.has(jobRank),
      'ACTOR_ARCHIVE_DUPLICATE_SOURCE_SLOT');
    seen.add(k);seenJobRanks.add(jobRank);
  }
  return {
    overall:findFight(report.overall,group,'overall'),
    boss:findFight(report.boss,group,'boss')
  };
}
function buildRoster(actors,key,scope){
  return actors.map(a=>{
    const ref=rawActorRef(a),rawName=norm(a?.name);
    return {
      actorToken:ref.ref?token(key,'fresh216-actor-v1',[...scope,ref.ref]):null,
      identityKind:ref.kind,
      nameToken:rawName&&rawName!=='anonymous'?
        token(key,'fresh216-actor-name-v1',[...scope,rawName]):null,
      className:typeof a?.class==='string'?a.class:null,
      specName:typeof a?.spec==='string'?a.spec:null,
      amount:number(a?.amount)
    };
  });
}
function slotProjection(slots,key,scope){
  return slots.map(s=>{
    const rawName=norm(s.name);
    return {
      slotKey:shaObject([s.jobKey,s.rank,s.snapshotSha]),
      jobKey:s.jobKey,rank:s.rank,snapshotSha:s.snapshotSha,
      totalDps:Number(s.totalDps),className:s.className,specName:s.specName,
      startTime:Number(s.startTime),nameKind:nameKind(s.name),
      nameToken:rawName&&rawName!=='anonymous'?
        token(key,'fresh216-actor-name-v1',[...scope,rawName]):null
    };
  });
}
function replayRows(payload){
  const outcomes=payload.slots.map(s=>{
    const unresolved=reason=>({
      slotKey:s.slotKey,jobKey:s.jobKey,rank:s.rank,
      snapshotSha:s.snapshotSha,status:'UNRESOLVED',reason,
      actorToken:null,identityKind:null,totalDps:s.totalDps,
      bossDps:null,proofType:null
    });
    // Preserve the canonical resolver's order: establish a unique
    // TotalDPS candidate across the full roster BEFORE class/spec/name checks.
    // Filtering first could turn a genuinely ambiguous DPS match into a false
    // actor attribution when another specialization has the same amount.
    const candidates=payload.overallRoster.filter(a=>
      a.amount!==null&&Math.abs(a.amount-s.totalDps)<=0.005);
    if(candidates.length===0)return unresolved('NO_TOTAL_DPS_MATCH');
    if(candidates.length!==1)return unresolved('AMBIGUOUS_TOTAL_DPS_MATCH');
    const candidate=candidates[0];
    if(norm(candidate.className)!==norm(s.className)||
      norm(candidate.specName)!==norm(s.specName))
      return unresolved('CLASS_SPEC_MISMATCH');
    if(s.nameToken!==null&&candidate.nameToken!==s.nameToken)
      return unresolved('NAME_TOKEN_MISMATCH');
    if(!validToken(candidate.actorToken))
      return unresolved('ACTOR_IDENTITY_UNAVAILABLE');
    if(s.nameKind!=='NAMED'&&
      !['REPORT_ACTOR_ID','MASKED_PLAYER_LABEL'].includes(candidate.identityKind))
      return unresolved('MASKED_ACTOR_IDENTITY_NOT_STABLE');
    if(payload.overallRoster.filter(a=>
      a.actorToken===candidate.actorToken).length!==1)
      return unresolved('OVERALL_ACTOR_COLLISION');
    const matching=payload.bossRoster.filter(a=>
      a.actorToken===candidate.actorToken);
    if(matching.length!==1)return unresolved('BOSS_ACTOR_NOT_UNIQUE');
    const boss=matching[0];
    if(norm(boss.className)!==norm(s.className)||
      norm(boss.specName)!==norm(s.specName))
      return unresolved('BOSS_CLASS_SPEC_MISMATCH');
    if(boss.amount===null||boss.amount<0||boss.amount>s.totalDps)
      return unresolved('BOSS_DPS_OUT_OF_RANGE');
    return {
      slotKey:s.slotKey,jobKey:s.jobKey,rank:s.rank,
      snapshotSha:s.snapshotSha,status:'VERIFIED',reason:null,
      actorToken:candidate.actorToken,identityKind:candidate.identityKind,
      totalDps:s.totalDps,bossDps:boss.amount,
      proofType:'EXACT_SAME_FIGHT_ACTOR'
    };
  });
  const claims=new Map();
  for(const o of outcomes){
    if(o.status!=='VERIFIED')continue;
    claims.set(o.actorToken,(claims.get(o.actorToken)||0)+1);
  }
  for(const o of outcomes){
    if(o.status==='VERIFIED'&&claims.get(o.actorToken)>1){
      o.status='UNRESOLVED';o.reason='ACTOR_CLAIM_COLLISION';
      o.bossDps=null;o.proofType=null;
    }
  }
  return outcomes;
}
const payloadKeys=[
  'schema','kind','keyId','archiveId','scopeKey','sourceSha256','waveSha256',
  'requestBodySha256','responseBodySha256','responseProjectionSha256',
  'httpStatus','observedPoints','capturedAtMs','reportToken','fightToken',
  'reportRevision','fightId','encounterId','difficulty','slots',
  'overallRoster','bossRoster','outcomes'
];
const archiveKeys=[...payloadKeys,'archiveSha256','archiveMac'];
const slotKeys=['slotKey','jobKey','rank','snapshotSha','totalDps',
  'className','specName','startTime','nameKind','nameToken'];
const rosterKeys=['actorToken','identityKind','nameToken','className',
  'specName','amount'];
const outcomeKeys=['slotKey','jobKey','rank','snapshotSha','status',
  'reason','actorToken','identityKind','totalDps','bossDps','proofType'];
function validateRedactedShape(a){
  need(exactKeys(a,archiveKeys),'ACTOR_ARCHIVE_TOP_LEVEL_FIELDS');
  need(validSha(a.archiveSha256)&&validSha(a.archiveMac),
    'ACTOR_ARCHIVE_DIGEST_FIELDS_INVALID');
  const expectedArchiveId=shaObject([
    ACTOR_PROOF_ARCHIVE_KIND,a.sourceSha256,a.reportToken,a.fightToken,
    a.requestBodySha256,a.responseBodySha256
  ]);
  need(a.archiveId===expectedArchiveId,'ACTOR_ARCHIVE_ID_MISMATCH');
  need(a.schema===ACTOR_PROOF_ARCHIVE_SCHEMA&&
    a.kind===ACTOR_PROOF_ARCHIVE_KIND&&a.keyId===ACTOR_PROOF_ARCHIVE_KEY_ID&&
    validSha(a.archiveId)&&validSha(a.sourceSha256)&&validSha(a.waveSha256)&&
    validSha(a.requestBodySha256)&&validSha(a.responseBodySha256)&&
    validSha(a.responseProjectionSha256)&&
    validToken(a.reportToken)&&validToken(a.fightToken)&&
    Number.isSafeInteger(a.reportRevision)&&a.reportRevision>=0&&
    Number.isSafeInteger(a.fightId)&&a.fightId>0&&
    Number.isSafeInteger(a.encounterId)&&a.encounterId>0&&
    Number.isSafeInteger(a.difficulty)&&a.difficulty>0&&
    a.httpStatus===200&&typeof a.observedPoints==='number'&&
    Number.isFinite(a.observedPoints)&&a.observedPoints>=0&&
    Number.isSafeInteger(a.capturedAtMs)&&a.capturedAtMs>0&&
    typeof a.scopeKey==='string'&&a.scopeKey.length>0,
    'ACTOR_ARCHIVE_HEADER_INVALID');
  need(Array.isArray(a.slots)&&a.slots.length>=1&&a.slots.length<=500&&
    Array.isArray(a.overallRoster)&&a.overallRoster.length<=200&&
    Array.isArray(a.bossRoster)&&a.bossRoster.length<=200&&
    Array.isArray(a.outcomes)&&a.outcomes.length===a.slots.length,
    'ACTOR_ARCHIVE_COLLECTION_INVALID');
  for(const s of a.slots){
    need(exactKeys(s,slotKeys)&&validSha(s.slotKey)&&
      typeof s.jobKey==='string'&&s.jobKey.length>0&&
      Number.isSafeInteger(s.rank)&&s.rank>=1&&s.rank<=100&&
      validSha(s.snapshotSha)&&typeof s.totalDps==='number'&&
      Number.isFinite(s.totalDps)&&s.totalDps>0&&
      typeof s.className==='string'&&typeof s.specName==='string'&&
      Number.isFinite(s.startTime)&&s.startTime>0&&
      ['ANONYMOUS','MASKED_LABEL','NAMED'].includes(s.nameKind)&&
      (s.nameToken===null||validToken(s.nameToken)),
      'ACTOR_ARCHIVE_SLOT_INVALID');
  }
  for(const list of [a.overallRoster,a.bossRoster]){
    for(const r of list){
      need(exactKeys(r,rosterKeys)&&
        (r.actorToken===null||validToken(r.actorToken))&&
        ['REPORT_ACTOR_ID','MASKED_PLAYER_LABEL','REPORT_ACTOR_NAME','UNRESOLVED'].includes(r.identityKind)&&
        (r.nameToken===null||validToken(r.nameToken))&&
        (r.className===null||typeof r.className==='string')&&
        (r.specName===null||typeof r.specName==='string')&&
        (r.amount===null||typeof r.amount==='number'&&Number.isFinite(r.amount)),
        'ACTOR_ARCHIVE_ROSTER_ROW_INVALID');
    }
  }
  for(const o of a.outcomes){
    need(exactKeys(o,outcomeKeys)&&validSha(o.slotKey)&&
      typeof o.jobKey==='string'&&Number.isSafeInteger(o.rank)&&
      validSha(o.snapshotSha)&&
      ['VERIFIED','UNRESOLVED'].includes(o.status)&&
      (o.reason===null||typeof o.reason==='string')&&
      (o.actorToken===null||validToken(o.actorToken))&&
      (o.identityKind===null||['REPORT_ACTOR_ID','MASKED_PLAYER_LABEL','REPORT_ACTOR_NAME','UNRESOLVED'].includes(o.identityKind))&&
      typeof o.totalDps==='number'&&Number.isFinite(o.totalDps)&&
      (o.bossDps===null||typeof o.bossDps==='number'&&Number.isFinite(o.bossDps))&&
      (o.proofType===null||o.proofType==='EXACT_SAME_FIGHT_ACTOR'),
      'ACTOR_ARCHIVE_OUTCOME_INVALID');
  }
  const forbidden=new Set(['reportCode','actorRef','name','id','sourceID','sourceId']);
  const visit=v=>{
    if(Array.isArray(v)){for(const x of v)visit(x);return;}
    if(!v||typeof v!=='object')return;
    for(const [k,x] of Object.entries(v)){
      need(!forbidden.has(k),'ACTOR_ARCHIVE_RAW_IDENTITY_FIELD');
      visit(x);
    }
  };
  visit(a);
}
export function buildActorProofArchive({
  group,report,sourceSha256,waveSha256,requestBodySha256,
  responseBodySha256,httpStatus=200,observedPoints,capturedAtMs,
  hmacKey
}={}){
  const key=keyBytes(hmacKey);
  const fights=validateInput({
    group,report,sourceSha256,waveSha256,requestBodySha256,
    responseBodySha256,httpStatus,observedPoints,capturedAtMs
  });
  const scope=[group.scopeKey,sourceSha256,report.code,report.revision,group.fightId,group.encounterId,group.difficulty];
  const reportToken=token(key,'fresh216-report-v1',
    [group.scopeKey,sourceSha256,report.code,report.revision]);
  const fightToken=token(key,'fresh216-fight-v1',[
    group.scopeKey,sourceSha256,report.code,report.revision,
    group.fightId,group.encounterId,group.difficulty
  ]);
  const overallRoster=buildRoster(fights.overall.actors,key,scope);
  const bossRoster=buildRoster(fights.boss.actors,key,scope);
  const slots=slotProjection(group.slots,key,scope);
  const responseProjectionSha256=shaObject({
    reportCode:report.code,revision:report.revision,
    fightId:group.fightId,encounterId:group.encounterId,
    difficulty:group.difficulty,
    overall:fights.overall.fight,boss:fights.boss.fight
  });
  const archiveId=shaObject([
    ACTOR_PROOF_ARCHIVE_KIND,sourceSha256,reportToken,fightToken,
    requestBodySha256,responseBodySha256
  ]);
  const payload={
    schema:ACTOR_PROOF_ARCHIVE_SCHEMA,kind:ACTOR_PROOF_ARCHIVE_KIND,
    keyId:ACTOR_PROOF_ARCHIVE_KEY_ID,archiveId,
    scopeKey:group.scopeKey,sourceSha256,waveSha256,
    requestBodySha256,responseBodySha256,responseProjectionSha256,
    httpStatus,observedPoints,capturedAtMs,reportToken,fightToken,
    reportRevision:report.revision,fightId:group.fightId,
    encounterId:group.encounterId,difficulty:group.difficulty,
    slots,overallRoster,bossRoster,outcomes:[]
  };
  payload.outcomes=replayRows(payload);
  const archiveSha256=shaObject(payload);
  const archiveMac=mac(key,'fresh216-archive-v1',archiveSha256);
  const archive={...payload,archiveSha256,archiveMac};
  validateRedactedShape(archive);
  need(Buffer.byteLength(canonical(archive),'utf8')<=
    ACTOR_PROOF_ARCHIVE_MAX_BYTES,'ACTOR_ARCHIVE_SIZE_LIMIT');
  return archive;
}
export function verifyActorProofArchive(archive,{
  hmacKey,expectedSourceSha256,expectedRequestBodySha256,
  expectedResponseBodySha256
}={}){
  const key=keyBytes(hmacKey);
  validateRedactedShape(archive);
  need(expectedSourceSha256==null||archive.sourceSha256===expectedSourceSha256,
    'ACTOR_ARCHIVE_SOURCE_SHA_MISMATCH');
  need(expectedRequestBodySha256==null||
    archive.requestBodySha256===expectedRequestBodySha256,
    'ACTOR_ARCHIVE_REQUEST_SHA_MISMATCH');
  need(expectedResponseBodySha256==null||
    archive.responseBodySha256===expectedResponseBodySha256,
    'ACTOR_ARCHIVE_RESPONSE_SHA_MISMATCH');
  const payload={};
  for(const k of payloadKeys)payload[k]=archive[k];
  const archiveSha256=shaObject(payload);
  need(archiveSha256===archive.archiveSha256,
    'ACTOR_ARCHIVE_CONTENT_SHA_MISMATCH');
  const expectedMac=mac(key,'fresh216-archive-v1',archiveSha256);
  const actual=Buffer.from(archive.archiveMac,'hex');
  const expected=Buffer.from(expectedMac,'hex');
  need(actual.length===expected.length&&timingSafeEqual(actual,expected),
    'ACTOR_ARCHIVE_HMAC_INVALID');
  const outcomes=replayRows(payload);
  need(eq(outcomes,archive.outcomes),'ACTOR_ARCHIVE_REPLAY_MISMATCH');
  const verifiedSlots=outcomes.filter(o=>o.status==='VERIFIED').length;
  return {
    valid:true,archiveId:archive.archiveId,
    archiveSha256:archive.archiveSha256,
    reportToken:archive.reportToken,fightToken:archive.fightToken,
    fightId:archive.fightId,reportRevision:archive.reportRevision,
    verifiedSlots,unresolvedSlots:outcomes.length-verifiedSlots,
    outcomes
  };
}
export const replayActorProofArchive=verifyActorProofArchive;

export const ACTOR_PROOF_WAVE_MANIFEST_SCHEMA=1;
export const ACTOR_PROOF_WAVE_MANIFEST_KIND=
  'FRESH216_REDACTED_ACTOR_PROOF_WAVE_MANIFEST_V1';
const manifestPayloadKeys=[
  'schema','kind','keyId','waveSha256','sourceSha256',
  'requestBodySha256','responseBodySha256','httpStatus','observedPoints',
  'createdAtMs','archives','verifiedSlots','unresolvedSlots'
];
const manifestKeys=[...manifestPayloadKeys,'manifestSha256','manifestMac'];
const manifestEntryKeys=[
  'archiveId','archiveSha256','reportToken','fightToken',
  'reportRevision','fightId','encounterId','difficulty',
  'verifiedSlots','unresolvedSlots'
];
export function buildActorProofWaveManifest({
  archives,hmacKey,createdAtMs
}={}){
  const key=keyBytes(hmacKey);
  need(Array.isArray(archives)&&archives.length>=1&&archives.length<=8,
    'ACTOR_WAVE_MANIFEST_ARCHIVE_COUNT');
  need(Number.isSafeInteger(createdAtMs)&&createdAtMs>0,
    'ACTOR_WAVE_MANIFEST_TIMESTAMP');
  const verified=archives.map(a=>verifyActorProofArchive(a,{hmacKey}));
  const first=archives[0];
  need(archives.every(a=>
    a.waveSha256===first.waveSha256&&
    a.sourceSha256===first.sourceSha256&&
    a.requestBodySha256===first.requestBodySha256&&
    a.responseBodySha256===first.responseBodySha256&&
    a.httpStatus===first.httpStatus&&
    a.observedPoints===first.observedPoints),
    'ACTOR_WAVE_MANIFEST_PROVENANCE_DRIFT');
  const sorted=archives.slice().sort((a,b)=>
    a.archiveId.localeCompare(b.archiveId));
  const seen=new Set(),seenFights=new Set();
  for(const a of sorted){
    need(!seen.has(a.archiveId)&&!seenFights.has(a.fightToken),
      'ACTOR_WAVE_MANIFEST_DUPLICATE_ARCHIVE_OR_FIGHT');
    seen.add(a.archiveId);seenFights.add(a.fightToken);
  }
  const entries=sorted.map(a=>{
    const v=verified.find(x=>x.archiveId===a.archiveId);
    return {
      archiveId:a.archiveId,archiveSha256:a.archiveSha256,
      reportToken:a.reportToken,fightToken:a.fightToken,
      reportRevision:a.reportRevision,fightId:a.fightId,
      encounterId:a.encounterId,difficulty:a.difficulty,
      verifiedSlots:v.verifiedSlots,unresolvedSlots:v.unresolvedSlots
    };
  });
  const payload={
    schema:ACTOR_PROOF_WAVE_MANIFEST_SCHEMA,
    kind:ACTOR_PROOF_WAVE_MANIFEST_KIND,
    keyId:ACTOR_PROOF_ARCHIVE_KEY_ID,
    waveSha256:first.waveSha256,sourceSha256:first.sourceSha256,
    requestBodySha256:first.requestBodySha256,
    responseBodySha256:first.responseBodySha256,
    httpStatus:first.httpStatus,observedPoints:first.observedPoints,
    createdAtMs,archives:entries,
    verifiedSlots:verified.reduce((n,x)=>n+x.verifiedSlots,0),
    unresolvedSlots:verified.reduce((n,x)=>n+x.unresolvedSlots,0)
  };
  const manifestSha256=shaObject(payload);
  const manifestMac=mac(key,'fresh216-wave-manifest-v1',manifestSha256);
  return {...payload,manifestSha256,manifestMac};
}
export function verifyActorProofWaveManifest(manifest,{
  hmacKey,archives
}={}){
  const key=keyBytes(hmacKey);
  need(exactKeys(manifest,manifestKeys)&&
    manifest.schema===ACTOR_PROOF_WAVE_MANIFEST_SCHEMA&&
    manifest.kind===ACTOR_PROOF_WAVE_MANIFEST_KIND&&
    manifest.keyId===ACTOR_PROOF_ARCHIVE_KEY_ID&&
    validSha(manifest.waveSha256)&&validSha(manifest.sourceSha256)&&
    validSha(manifest.requestBodySha256)&&
    validSha(manifest.responseBodySha256)&&manifest.httpStatus===200&&
    typeof manifest.observedPoints==='number'&&
    Number.isFinite(manifest.observedPoints)&&manifest.observedPoints>=0&&
    Number.isSafeInteger(manifest.createdAtMs)&&manifest.createdAtMs>0&&
    Array.isArray(manifest.archives)&&manifest.archives.length>=1&&
    manifest.archives.length<=8&&
    Number.isSafeInteger(manifest.verifiedSlots)&&manifest.verifiedSlots>=0&&
    Number.isSafeInteger(manifest.unresolvedSlots)&&manifest.unresolvedSlots>=0&&
    validSha(manifest.manifestSha256)&&validSha(manifest.manifestMac),
    'ACTOR_WAVE_MANIFEST_SHAPE_INVALID');
  const seen=new Set(),seenFights=new Set();
  for(const e of manifest.archives){
    need(exactKeys(e,manifestEntryKeys)&&
      validSha(e.archiveId)&&validSha(e.archiveSha256)&&
      validToken(e.reportToken)&&validToken(e.fightToken)&&
      Number.isSafeInteger(e.reportRevision)&&e.reportRevision>=0&&
      Number.isSafeInteger(e.fightId)&&e.fightId>0&&
      Number.isSafeInteger(e.encounterId)&&e.encounterId>0&&
      Number.isSafeInteger(e.difficulty)&&e.difficulty>0&&
      Number.isSafeInteger(e.verifiedSlots)&&e.verifiedSlots>=0&&
      Number.isSafeInteger(e.unresolvedSlots)&&e.unresolvedSlots>=0&&
      !seen.has(e.archiveId)&&!seenFights.has(e.fightToken),
      'ACTOR_WAVE_MANIFEST_ENTRY_INVALID');
    seen.add(e.archiveId);seenFights.add(e.fightToken);
  }
  const payload={};
  for(const k of manifestPayloadKeys)payload[k]=manifest[k];
  const digest=shaObject(payload);
  need(digest===manifest.manifestSha256,
    'ACTOR_WAVE_MANIFEST_CONTENT_SHA_MISMATCH');
  const expected=Buffer.from(mac(key,'fresh216-wave-manifest-v1',digest),'hex');
  const actual=Buffer.from(manifest.manifestMac,'hex');
  need(expected.length===actual.length&&timingSafeEqual(expected,actual),
    'ACTOR_WAVE_MANIFEST_HMAC_INVALID');
  need(Array.isArray(archives)&&archives.length===manifest.archives.length,
    'ACTOR_WAVE_MANIFEST_ARCHIVES_REQUIRED');
  const verified=archives.map(a=>verifyActorProofArchive(a,{hmacKey}));
  const byId=new Map(archives.map(a=>[a.archiveId,a]));
  const entries=manifest.archives.map(e=>{
    const a=byId.get(e.archiveId);
    need(a&&a.archiveSha256===e.archiveSha256&&
      a.waveSha256===manifest.waveSha256&&
      a.sourceSha256===manifest.sourceSha256&&
      a.requestBodySha256===manifest.requestBodySha256&&
      a.responseBodySha256===manifest.responseBodySha256&&
      a.reportToken===e.reportToken&&a.fightToken===e.fightToken&&
      a.reportRevision===e.reportRevision&&a.fightId===e.fightId&&
      a.encounterId===e.encounterId&&a.difficulty===e.difficulty,
      'ACTOR_WAVE_MANIFEST_ARCHIVE_LINK_MISMATCH');
    return e;
  });
  const vCount=verified.reduce((n,x)=>n+x.verifiedSlots,0);
  const uCount=verified.reduce((n,x)=>n+x.unresolvedSlots,0);
  need(vCount===manifest.verifiedSlots&&uCount===manifest.unresolvedSlots,
    'ACTOR_WAVE_MANIFEST_COUNT_MISMATCH');
  return {
    valid:true,waveSha256:manifest.waveSha256,
    manifestSha256:manifest.manifestSha256,
    archiveCount:entries.length,verifiedSlots:vCount,unresolvedSlots:uCount
  };
}
