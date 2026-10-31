/**
 * Pure bridge from a public HMAC actor archive + private canonical join rows
 * to exact private C proof rows. No WCL, GitHub, filesystem or Sheets I/O.
 *
 * The public archive alone is intentionally insufficient for C: raw
 * reportCode/actorRef remain private. This bridge joins the two evidence
 * planes by recomputing the archive's scoped HMAC tokens and requiring exact
 * source-slot and BossDPS parity before emitting any C proof.
 */
import {
  verifyActorProofArchive,verifyActorProofWaveManifest,
  deriveActorProofArchiveTokens
} from './fresh216-actor-proof-archive.mjs';

const need=(v,c)=>{if(!v)throw Error(c);};
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const keyOf=s=>JSON.stringify([s.jobKey,s.rank,s.snapshotSha]);
const masked=v=>{
  const n=String(v??'').trim().toLowerCase();
  return !n||n==='anonymous'||/^player[ ]*[(][0-9]+[)]$/i.test(n);
};
const groupId=g=>JSON.stringify([
  g.scopeKey,g.reportCode,g.reportRevision??null,g.fightId,
  g.encounterId,g.difficulty
]);
const sameIdentity=(a,b)=>a.scopeKey===b.scopeKey&&
  a.reportCode===b.reportCode&&a.fightId===b.fightId&&
  a.encounterId===b.encounterId&&a.difficulty===b.difficulty&&
  (a.reportRevision==null||a.reportRevision===b.reportRevision);

function validateGroup(g){
  need(g&&typeof g.scopeKey==='string'&&g.scopeKey&&
    typeof g.reportCode==='string'&&g.reportCode&&
    Number.isSafeInteger(g.fightId)&&g.fightId>0&&
    Number.isSafeInteger(g.encounterId)&&g.encounterId>0&&
    Number.isSafeInteger(g.difficulty)&&g.difficulty>0&&
    (g.reportRevision==null||
      Number.isSafeInteger(g.reportRevision)&&g.reportRevision>=0)&&
    Array.isArray(g.slots)&&g.slots.length>0,
    'ARCHIVE_TO_C_GROUP_INVALID');
  const seen=new Set();
  for(const s of g.slots){
    need(s&&typeof s.jobKey==='string'&&s.jobKey&&
      Number.isSafeInteger(s.rank)&&s.rank>=1&&s.rank<=100&&
      sha(s.snapshotSha)&&typeof s.className==='string'&&s.className&&
      typeof s.specName==='string'&&s.specName&&
      typeof s.totalDps==='number'&&Number.isFinite(s.totalDps)&&
      s.totalDps>0&&Number.isFinite(s.startTime)&&s.startTime>0&&
      typeof s.name==='string',
      'ARCHIVE_TO_C_SOURCE_SLOT_INVALID');
    const k=keyOf(s);
    need(!seen.has(k),'ARCHIVE_TO_C_DUPLICATE_SOURCE_SLOT');
    seen.add(k);
  }
}

function sameArchiveSlot(a,s,hmacKey,archive){
  const refs=deriveActorProofArchiveTokens({
    hmacKey,scopeKey:archive.scopeKey,sourceSha256:archive.sourceSha256,
    reportCode:archive._reportCode,reportRevision:archive.reportRevision,
    fightId:archive.fightId,encounterId:archive.encounterId,
    difficulty:archive.difficulty,actorName:s.name
  });
  need(a.slotKey===keyOf(s)&&a.jobKey===s.jobKey&&
    a.rank===s.rank&&a.snapshotSha===s.snapshotSha&&
    Object.is(a.totalDps,s.totalDps)&&
    a.className===s.className&&a.specName===s.specName&&
    Object.is(a.startTime,s.startTime)&&
    a.nameKind===refs.nameKind&&a.nameToken===refs.nameToken,
    'ARCHIVE_TO_C_SOURCE_SLOT_DRIFT');
}

export function buildFresh216CProofRowsFromActorArchives({
  groups,archives,manifest,privateProofRows,hmacKey,
  expectedSourceSha256,expectedScopeKey
}={}){
  need(Array.isArray(groups)&&groups.length>=1&&groups.length<=8&&
    Array.isArray(archives)&&archives.length===groups.length&&
    Array.isArray(privateProofRows)&&sha(expectedSourceSha256)&&
    typeof expectedScopeKey==='string'&&expectedScopeKey&&
    typeof hmacKey==='string'&&Buffer.byteLength(hmacKey,'utf8')>=32,
    'ARCHIVE_TO_C_INPUT_INVALID');
  const groupById=new Map();
  const sourceByKey=new Map();
  for(const g of groups){
    validateGroup(g);
    need(g.scopeKey===expectedScopeKey&&!groupById.has(groupId(g)),
      'ARCHIVE_TO_C_GROUP_SCOPE_OR_DUPLICATE');
    groupById.set(groupId(g),g);
    for(const s of g.slots){
      const k=keyOf(s);
      need(!sourceByKey.has(k),'ARCHIVE_TO_C_SOURCE_SLOT_COLLISION');
      sourceByKey.set(k,{group:g,slot:s});
    }
  }
  const manifestCheck=verifyActorProofWaveManifest(manifest,{
    hmacKey,archives
  });
  need(manifest.sourceSha256===expectedSourceSha256&&
    manifest.archives.length===groups.length,
    'ARCHIVE_TO_C_MANIFEST_SOURCE_OR_COUNT');
  const archiveByFight=new Map();
  for(const archive of archives){
    const verified=verifyActorProofArchive(archive,{
      hmacKey,expectedSourceSha256
    });
    need(archive.scopeKey===expectedScopeKey&&
      archive.waveSha256===manifest.waveSha256&&
      archive.requestBodySha256===manifest.requestBodySha256&&
      archive.responseBodySha256===manifest.responseBodySha256&&
      archive.httpStatus===200&&
      !archiveByFight.has(archive.fightToken),
      'ARCHIVE_TO_C_ARCHIVE_PROVENANCE_OR_DUPLICATE');
    const matches=groups.filter(g=>{
      if(g.fightId!==archive.fightId||
         g.encounterId!==archive.encounterId||
         g.difficulty!==archive.difficulty||
         (g.reportRevision!=null&&g.reportRevision!==archive.reportRevision))
        return false;
      const refs=deriveActorProofArchiveTokens({
        hmacKey,scopeKey:g.scopeKey,sourceSha256:expectedSourceSha256,
        reportCode:g.reportCode,reportRevision:archive.reportRevision,
        fightId:g.fightId,encounterId:g.encounterId,
        difficulty:g.difficulty
      });
      return refs.reportToken===archive.reportToken&&
        refs.fightToken===archive.fightToken;
    });
    need(matches.length===1,'ARCHIVE_TO_C_REPORT_FIGHT_SCOPE_MISMATCH');
    const group=matches[0];
    need(!archiveByFight.has(archive.fightToken),
      'ARCHIVE_TO_C_DUPLICATE_FIGHT');
    const groupSlots=new Map(group.slots.map(s=>[keyOf(s),s]));
    need(archive.slots.length===groupSlots.size,
      'ARCHIVE_TO_C_ARCHIVE_SLOT_COUNT');
    for(const a of archive.slots){
      const s=groupSlots.get(JSON.stringify([
        a.jobKey,a.rank,a.snapshotSha
      ]));
      need(s,'ARCHIVE_TO_C_ARCHIVE_SLOT_NOT_IN_SOURCE');
      // Bind each archived slot to the exact immutable A values and HMAC name.
      const refs=deriveActorProofArchiveTokens({
        hmacKey,scopeKey:group.scopeKey,sourceSha256:expectedSourceSha256,
        reportCode:group.reportCode,reportRevision:archive.reportRevision,
        fightId:group.fightId,encounterId:group.encounterId,
        difficulty:group.difficulty,actorName:s.name
      });
      need(a.slotKey===keyOf(s)&&Object.is(a.totalDps,s.totalDps)&&
        a.className===s.className&&a.specName===s.specName&&
        Object.is(a.startTime,s.startTime)&&
        a.nameKind===refs.nameKind&&a.nameToken===refs.nameToken,
        'ARCHIVE_TO_C_SOURCE_SLOT_DRIFT');
    }
    need(archive.outcomes.length===group.slots.length&&
      verified.verifiedSlots+verified.unresolvedSlots===group.slots.length,
      'ARCHIVE_TO_C_OUTCOME_COVERAGE');
    archiveByFight.set(archive.fightToken,{archive,group});
  }

  const privateByKey=new Map();
  for(const row of privateProofRows){
    need(row&&typeof row==='object'&&row.identity&&row.proof&&
      typeof row.jobKey==='string'&&Number.isSafeInteger(row.rank)&&
      sha(row.snapshotSha),'ARCHIVE_TO_C_PRIVATE_PROOF_SHAPE');
    const k=keyOf(row);
    need(!privateByKey.has(k),'ARCHIVE_TO_C_DUPLICATE_PRIVATE_PROOF');
    const source=sourceByKey.get(k);
    need(source&&sameIdentity(row.identity,source.group),
      'ARCHIVE_TO_C_PRIVATE_PROOF_IDENTITY');
    privateByKey.set(k,row);
  }

  const proofRows=[],unresolved=[],withheld=[];
  const covered=new Set();
  for(const {archive,group} of archiveByFight.values()){
    for(const outcome of archive.outcomes){
      const k=JSON.stringify([
        outcome.jobKey,outcome.rank,outcome.snapshotSha
      ]);
      const source=sourceByKey.get(k);
      need(source&&source.group===group&&!covered.has(k),
        'ARCHIVE_TO_C_OUTCOME_SOURCE_COVERAGE');
      covered.add(k);
      const privateRow=privateByKey.get(k);
      if(outcome.status!=='VERIFIED'){
        if(privateRow)withheld.push(k);
        unresolved.push({jobKey:outcome.jobKey,rank:outcome.rank,
          snapshotSha:outcome.snapshotSha,reason:outcome.reason});
        continue;
      }
      need(privateRow,'ARCHIVE_TO_C_PRIVATE_PROOF_MISSING');
      const slot=source.slot,proof=privateRow.proof;
      need(proof.proofType==='EXACT_SAME_FIGHT_ACTOR'&&
        typeof proof.actorRef==='string'&&proof.actorRef.length>0&&
        proof.reportCode===group.reportCode&&
        proof.fightId===group.fightId&&
        proof.encounterId===group.encounterId&&
        proof.difficulty===group.difficulty&&
        proof.reportRevision===archive.reportRevision&&
        proof.snapshotSha===slot.snapshotSha&&
        typeof proof.bossDps==='number'&&Number.isFinite(proof.bossDps)&&
        proof.bossDps>=0&&proof.bossDps<=slot.totalDps&&
        Object.is(proof.bossDps,outcome.bossDps)&&
        Object.is(outcome.totalDps,slot.totalDps)&&
        (proof.sourceStartTime==null||
          Object.is(proof.sourceStartTime,slot.startTime)),
        'ARCHIVE_TO_C_CANONICAL_PROOF_DIVERGENCE');
      const refs=deriveActorProofArchiveTokens({
        hmacKey,scopeKey:group.scopeKey,sourceSha256:expectedSourceSha256,
        reportCode:group.reportCode,reportRevision:archive.reportRevision,
        fightId:group.fightId,encounterId:group.encounterId,
        difficulty:group.difficulty,actorRef:proof.actorRef,
        actorName:slot.name
      });
      need(refs.reportToken===archive.reportToken&&
        refs.fightToken===archive.fightToken&&
        refs.actorToken===outcome.actorToken,
        'ARCHIVE_TO_C_HMAC_ACTOR_BINDING_MISMATCH');
      const isMasked=masked(slot.name);
      if(isMasked){
        need(/^id:[1-9]\\d*$/.test(proof.actorRef)||
          /^name:player[ ]*[(][1-9][0-9]*[)]$/i.test(proof.actorRef),
          'ARCHIVE_TO_C_MASKED_ACTOR_NOT_STABLE');
      }
      const discovery={
        kind:isMasked?'REPORT_DUAL_RANKINGS_MASKED':'REPORT_DUAL_RANKINGS',
        evidenceSha256:archive.responseProjectionSha256
      };
      need(sha(discovery.evidenceSha256),'ARCHIVE_TO_C_RESPONSE_PROJECTION_SHA');
      if(proof.discovery!=null)
        need(JSON.stringify(proof.discovery)===JSON.stringify(discovery),
          'ARCHIVE_TO_C_DISCOVERY_DRIFT');
      const promotedProof={
        ...proof,sourceStartTime:slot.startTime,discovery
      };
      proofRows.push({
        jobKey:outcome.jobKey,rank:outcome.rank,
        snapshotSha:outcome.snapshotSha,
        bossDps:outcome.bossDps,proof:promotedProof
      });
    }
  }
  need(covered.size===sourceByKey.size,
    'ARCHIVE_TO_C_INCOMPLETE_SOURCE_COVERAGE');
  need(privateByKey.size===privateProofRows.length,
    'ARCHIVE_TO_C_PRIVATE_PROOF_DUPLICATE');
  return {
    schema:1,kind:'FRESH216_PRIVATE_ARCHIVE_TO_C_PROOF_ROWS_V1',
    sourceSha256:expectedSourceSha256,
    waveSha256:manifest.waveSha256,
    manifestSha256:manifest.manifestSha256,
    requestBodySha256:manifest.requestBodySha256,
    responseBodySha256:manifest.responseBodySha256,
    observedPoints:manifest.observedPoints,
    archiveCount:manifestCheck.archiveCount,
    sourceSlots:sourceByKey.size,
    candidateVerifiedSlots:privateByKey.size,
    verifiedSlots:proofRows.length,
    unresolvedSlots:unresolved.length,
    withheldCanonicalProofs:withheld.length,
    proofRows,unresolved
  };
}
