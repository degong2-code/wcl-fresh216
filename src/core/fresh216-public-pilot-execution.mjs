/** One bounded WCL wave, raw-byte provenance, and pseudonymized archive persistence. */
import {createHash} from 'node:crypto';
import {makeRankingsWaveQuery,decodeRankingsWave} from './report-wave-plan.mjs';
import {joinFightEvidence} from './evidence-join.mjs';
import {crosswalkMaskedReportFight} from './masked-report-crosswalk.mjs';
import {buildActorProofArchive,verifyActorProofArchive} from './fresh216-actor-proof-archive.mjs';
import {makePilotReservation} from '../adapters/fresh216-public-pilot-journal.mjs';

const shaBytes=v=>createHash('sha256').update(v).digest('hex');
const shaObject=v=>shaBytes(Buffer.from(JSON.stringify(v),'utf8'));
const isSha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const fail=(x,c)=>{if(!x)throw Error(c);};
const proofKey=x=>JSON.stringify([x.jobKey,x.rank,x.snapshotSha]);
const ALLOW_INCIDENT=new Set([
 'HTTP_OR_GRAPHQL_UNCERTAIN','WAVE_REPORT_IDENTITY_DRIFT',
 'WAVE_RANKINGS_SHAPE_INVALID','WAVE_TRANSPORT_OR_PROCESSING_EXCEPTION',
 'RESPONSE_NOT_PERSISTABLE','WCL_POINTS_UNOBSERVED',
 'RAW_RESPONSE_BYTES_UNAVAILABLE','ACTOR_ARCHIVE_BUILD_OR_STORE_FAILED',
 'ACTOR_ARCHIVE_READBACK_COUNT_DRIFT'
]);

/** Any error after reservation leaves a durable one-shot marker, never auto retry. */
export async function executeFresh216PublicPilot({
 env,journal,wave,sourceSha256,transport,actorArchiveStore,hmacKey,
 clock=Date.now
}={}){
 fail(journal&&typeof journal.reserve==='function'&&
   typeof journal.seal==='function'&&
   typeof transport==='function'&&typeof clock==='function'&&
   actorArchiveStore&&typeof actorArchiveStore.persistWave==='function'&&
   typeof hmacKey==='string'&&Buffer.byteLength(hmacKey,'utf8')>=32&&
   wave&&Array.isArray(wave.fightGroups)&&wave.fightGroups.length>=1&&
   wave.fightGroups.length<=4&&
   wave.fightGroups.every(g=>g.scopeKey===
     'heroic:2026-10-22_27:latest:source'&&
     Array.isArray(g.slots)&&g.slots.length>0),
   'PUBLIC_PILOT_WAVE_SCOPE_DENIED');
 const query=makeRankingsWaveQuery(wave);
 // Hash the exact UTF-8 JSON request body which the transport must send.
 const requestBodyText=JSON.stringify(query);
 const requestBodySha256=shaBytes(Buffer.from(requestBodyText,'utf8'));
 const waveSha256=shaObject(wave);
 const reservation=makePilotReservation({
   env,waveSha256,sourceSha256,nowMs:clock()
 });
 // NEVER do OAuth, initialize transport, or send a WCL HTTP request unless
 // GitHub has committed IN_FLIGHT and the API readback confirms it.
 const reserved=await journal.reserve(reservation);
 let response=null,incident=null,observedPoints=null,
   verifiedSlots=0,unresolvedSlots=0,candidateVerifiedSlots=0,
   archiveCount=0,archiveManifestSha256=null,graphqlAttempted=false,
   stage='TRANSPORT';
 try {
   const markGraphqlAttempt=()=>{
     fail(!graphqlAttempted,'PUBLIC_PILOT_GRAPHQL_LIMIT_EXCEEDED');
     graphqlAttempted=true;
   };
   response=await transport(query,requestBodyText,{markGraphqlAttempt});
   if(!isSha(response?.responseBodySha256)){
     incident='RAW_RESPONSE_BYTES_UNAVAILABLE';
   }else{
     stage='DECODE';
     const decoded=decodeRankingsWave(wave,response?.httpStatus,response?.body);
     observedPoints=decoded.observedPoints;
     if(decoded.status!=='OK'){
       incident=ALLOW_INCIDENT.has(decoded.status)?
         decoded.status:'RESPONSE_NOT_PERSISTABLE';
     }else{
       stage='ARCHIVE';
       const capturedAtMs=clock();
       const archives=[];
       for(const {group,report} of decoded.results){
         const existing=joinFightEvidence(group,report);
         const existingByKey=new Map(existing.verified.map(v=>[proofKey(v),v]));
         fail(existingByKey.size===existing.verified.length,
           'PUBLIC_PILOT_CANONICAL_PROOF_DUPLICATE');
         const additionallyMasked=crosswalkMaskedReportFight(group,report);
         // The masked crosswalk may only return an exact subset of the
         // canonical join's source slots; a count-only check is insufficient.
         const maskedKeys=additionallyMasked.verified.map(proofKey);
         fail(new Set(maskedKeys).size===maskedKeys.length&&
           maskedKeys.every(k=>existingByKey.has(k)),
           'PUBLIC_PILOT_MASKED_CROSSWALK_DIVERGENCE');
         candidateVerifiedSlots+=existing.verified.length;
         const archive=buildActorProofArchive({
           group,report,sourceSha256,waveSha256,
           requestBodySha256,responseBodySha256:response.responseBodySha256,
           httpStatus:response.httpStatus,observedPoints,capturedAtMs,hmacKey
         });
         // Replay and HMAC-check the exact archive before any public write.
         // Public VERIFIED rows must be a slot-exact subset of the existing
         // canonical proof, with identical BossDPS values. Stricter archive
         // rules may leave additional slots unresolved, but may never invent
         // or swap a source-slot proof.
         const replay=verifyActorProofArchive(archive,{
           hmacKey,expectedSourceSha256:sourceSha256,
           expectedRequestBodySha256:requestBodySha256,
           expectedResponseBodySha256:response.responseBodySha256
         });
         const archiveVerified=replay.outcomes.filter(o=>o.status==='VERIFIED');
         const archiveKeys=archiveVerified.map(proofKey);
         fail(new Set(archiveKeys).size===archiveKeys.length&&
           archiveVerified.every(o=>{
             const canonical=existingByKey.get(proofKey(o));
             return canonical&&Object.is(canonical.proof.bossDps,o.bossDps);
           }),
           'PUBLIC_PILOT_ARCHIVE_PROOF_DIVERGENCE');
         archives.push(archive);
       }
       const stored=await actorArchiveStore.persistWave(archives,{createdAtMs:capturedAtMs});
       const expectedSlots=wave.fightGroups.reduce((n,g)=>n+g.slots.length,0);
       fail(stored?.archiveCount===wave.fightGroups.length&&
         isSha(stored?.manifestSha256)&&
         Number.isSafeInteger(stored?.verifiedSlots)&&
         Number.isSafeInteger(stored?.unresolvedSlots)&&
         stored.verifiedSlots+stored.unresolvedSlots===expectedSlots&&
         stored.verifiedSlots<=candidateVerifiedSlots,
         'ACTOR_ARCHIVE_READBACK_COUNT_DRIFT');
       archiveCount=stored.archiveCount;
       archiveManifestSha256=stored.manifestSha256;
       verifiedSlots=stored.verifiedSlots;
       unresolvedSlots=stored.unresolvedSlots;
     }
   }
 }catch{
   incident=incident??(stage==='TRANSPORT'?
     'WAVE_TRANSPORT_OR_PROCESSING_EXCEPTION':
     'ACTOR_ARCHIVE_BUILD_OR_STORE_FAILED');
 }
 if(observedPoints===null)incident=incident??'WCL_POINTS_UNOBSERVED';
 const summary={
   httpStatus:response?.httpStatus??null,
   observedPoints,requestBodySha256,
   responseBodySha256:isSha(response?.responseBodySha256)?
     response.responseBodySha256:null,
   fightGroups:wave.fightGroups.length,
   sourceSlots:wave.fightGroups.reduce((n,g)=>n+g.slots.length,0),
   candidateVerifiedSlots,verifiedSlots,unresolvedSlots,
   archiveCount,archiveManifestSha256,incident
 };
 const sealed=await journal.seal(reserved,summary);
 return {status:sealed.data.status,attemptedGraphql:graphqlAttempted?1:0,
   observedPoints,candidateVerifiedSlots,verifiedSlots,unresolvedSlots,
   archiveCount,archiveManifestSha256,evidenceCommit:sealed.commitSha};
}
