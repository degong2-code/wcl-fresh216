import test from 'node:test';
import assert from 'node:assert/strict';
import {newCheckpoint,registerPlan} from '../src/core/checkpoint.mjs';
import {
  validateReadOnlyEvidenceGate,EVIDENCE_PUBLIC_WRITE_GATE,
  EVIDENCE_PRIVATE_C_GATE
} from '../src/adapters/private-evidence-readiness.mjs';

const SCOPE='heroic:2026-10-22_27:latest:source';
const HMAC='SYNTHETIC_RANDOM_64_CHARACTER_SECRET_FOR_TESTING_ONLY_N0T_RE4L____';
function state(){
  const groups=Array.from({length:5},(_,i)=>({
    scopeKey:SCOPE,reportCode:'SYNTHETIC_'+i,
    reportRevision:1,fightId:100+i,encounterId:3470,difficulty:4,
    slots:[{jobKey:'synthetic-job-'+i,rank:1,
      snapshotSha:'a'.repeat(64),name:'Synthetic Actor',
      className:'Hunter',specName:'Marksmanship',
      totalDps:1000,startTime:1792594801000}]
  }));
  const s=registerPlan(newCheckpoint(SCOPE,'synthetic-key'),groups);
  s.recoveryBaseline={cExact:21252,named:9,
    maskedQuarantined:339,namedFightGroups:5};
  return s;
}
test('HMAC and real target ref required before preview; write mode always rejected',()=>{
  const s=state();
  assert.throws(()=>validateReadOnlyEvidenceGate({
    checkpoint:s,hmacKey:'too short',publicBranchHead:'a'.repeat(40)
  }),/PRIVATE_EVIDENCE_PREFLIGHT_HMAC_NOT_READY/);
  assert.throws(()=>validateReadOnlyEvidenceGate({
    checkpoint:s,hmacKey:HMAC,publicBranchHead:'unverified'
  }),/PRIVATE_EVIDENCE_PREFLIGHT_PUBLIC_REF_UNVERIFIED/);
  assert.throws(()=>validateReadOnlyEvidenceGate({
    checkpoint:s,hmacKey:HMAC,publicBranchHead:'a'.repeat(40),
    writeEnabled:true
  }),/PRIVATE_EVIDENCE_PREFLIGHT_WRITE_MODE_FORBIDDEN/);
});
test('checkpoint requires five idle READY groups; no pending/billed or review state',()=>{
  const s=state();
  const ok=validateReadOnlyEvidenceGate({
    checkpoint:s,hmacKey:HMAC,publicBranchHead:'a'.repeat(40)
  });
  assert.equal(ok.checkpointReadyGroups,5);
  assert.equal(ok.publicWriteGate,EVIDENCE_PUBLIC_WRITE_GATE);
  assert.equal(ok.cRemoteWriteGate,EVIDENCE_PRIVATE_C_GATE);
  const tampered=structuredClone(s);
  Object.values(tampered.entries)[0].status='IN_FLIGHT';
  assert.throws(()=>validateReadOnlyEvidenceGate({
    checkpoint:tampered,hmacKey:HMAC,publicBranchHead:'a'.repeat(40)
  }),/PRIVATE_EVIDENCE_PREFLIGHT_READY5_DRIFT/);
  const stale=structuredClone(s);
  stale.recoveryBaseline.cExact=21251;
  assert.throws(()=>validateReadOnlyEvidenceGate({
    checkpoint:stale,hmacKey:HMAC,publicBranchHead:'a'.repeat(40)
  }),/PRIVATE_EVIDENCE_PREFLIGHT_READY5_DRIFT/);
});
