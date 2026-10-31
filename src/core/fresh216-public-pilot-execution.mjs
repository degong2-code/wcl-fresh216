/** No WCL transport or private identifiers; orchestrates ONE supplied HTTP attempt. */
import {createHash} from 'node:crypto';
import {makeRankingsWaveQuery,decodeRankingsWave} from './report-wave-plan.mjs';
import {joinFightEvidence} from './evidence-join.mjs';
import {crosswalkMaskedReportFight} from './masked-report-crosswalk.mjs';
import {makePilotReservation} from '../adapters/fresh216-public-pilot-journal.mjs';

const sha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fail=(x,c)=>{if(!x)throw Error(c);};
const masked=n=>!n||String(n).trim().toLowerCase()==='anonymous'||
  /^player\s*\(\d+\)$/i.test(n);
const ALLOW_INCIDENT=new Set([
 'HTTP_OR_GRAPHQL_UNCERTAIN','WAVE_REPORT_IDENTITY_DRIFT',
 'WAVE_RANKINGS_SHAPE_INVALID','WAVE_TRANSPORT_OR_PROCESSING_EXCEPTION',
 'RESPONSE_NOT_PERSISTABLE','WCL_POINTS_UNOBSERVED'
]);

/** Any error after reservation leaves a durable one-shot marker, never auto retry. */
export async function executeFresh216PublicPilot({
 env,journal,wave,sourceSha256,transport,clock=Date.now
}={}){
 fail(journal&&typeof journal.reserve==='function'&&
   typeof journal.seal==='function'&&
   typeof transport==='function'&&typeof clock==='function'&&
   wave&&Array.isArray(wave.fightGroups)&&wave.fightGroups.length>=1&&
   wave.fightGroups.length<=4&&
   wave.fightGroups.every(g=>g.scopeKey===
     'heroic:2026-10-22_27:latest:source'&&
     Array.isArray(g.slots)&&g.slots.length>0),
   'PUBLIC_PILOT_WAVE_SCOPE_DENIED');
 const query=makeRankingsWaveQuery(wave);
 const bodySha=sha(query);
 const reservation=makePilotReservation({
   env,waveSha256:sha(wave),sourceSha256,nowMs:clock()
 });
 // NEVER do OAuth, initialize transport, or send a WCL HTTP request unless
 // GitHub has committed IN_FLIGHT and the API readback confirms it.
 const reserved=await journal.reserve(reservation);
 let response=null,incident=null,observedPoints=null,
   verifiedSlots=0,unresolvedSlots=0;
 try {
   response=await transport(query);
   const decoded=decodeRankingsWave(wave,response?.httpStatus,response?.body);
   observedPoints=decoded.observedPoints;
   if(decoded.status!=='OK')
     incident=ALLOW_INCIDENT.has(decoded.status)?
       decoded.status:'RESPONSE_NOT_PERSISTABLE';
   else {
     for(const {group,report} of decoded.results){
       const existing=joinFightEvidence(group,report);
       const additionallyMasked=crosswalkMaskedReportFight(group,report);
       // Existing join is the exact actor proof; the masked crosswalk adds
       // provenance only, it must never invent a new candidate.
       fail(additionallyMasked.verified.length<=existing.verified.length,
         'PUBLIC_PILOT_PROVENANCE_MISMATCH');
       verifiedSlots+=existing.verified.length;
       unresolvedSlots+=existing.unresolved.length;
     }
   }
 }catch{
   incident='WAVE_TRANSPORT_OR_PROCESSING_EXCEPTION';
 }
 if(observedPoints===null)incident=incident??'WCL_POINTS_UNOBSERVED';
 const summary={
   httpStatus:response?.httpStatus??null,
   observedPoints,requestBodySha256:bodySha,
   responseSha256:response?.body==null?null:sha(response.body),
   fightGroups:wave.fightGroups.length,verifiedSlots,unresolvedSlots,
   incident
 };
 const sealed=await journal.seal(reserved,summary);
 return {status:sealed.data.status,attemptedGraphql:1,
   observedPoints,verifiedSlots,unresolvedSlots,
   evidenceCommit:sealed.commitSha};
}
