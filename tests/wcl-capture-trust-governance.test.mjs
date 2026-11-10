import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {canonicalCatalogJson} from '../src/core/environment-discovery.mjs';
import {
  admitGovernedSignedWclCapture,governanceDigest,makeGenesisCaptureHead,
  isGovernedCaptureCurrentlyTrusted
} from '../src/adapters/wcl-capture-trust-governance.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
const utf=b=>new TextEncoder().encode(JSON.stringify(b));
const clone=o=>structuredClone(o);
function fixture(){
  const a=generateKeyPairSync('ed25519'),b=generateKeyPairSync('ed25519');
  const expected={sourceNamespace:'synthetic-retail',expansionId:99,locale:'en_US'};
  const bytes=utf({schema:'WCL_CAPTURED_DIRECTORY_AND_ZONES_V1',
    sourceNamespace:'synthetic-retail',expansionId:99,
    directory:{data:{worldData:{expansions:[{id:99,name:'Synthetic'}]},
      gameData:{classes:[]}}},
    zones:{data:{worldData:{zones:[]}}}});
  const wclPin={sourceRef:'snapshot:wcl',sourceKind:'WCL_CATALOG_BUNDLE',
    sourceSha256:sha(bytes),originHost:'www.warcraftlogs.com',
    endpoint:'/api/v2/client',namespace:expected.sourceNamespace,
    locale:'en_US',capturedAtMs:10,validUntilMs:500};
  let reads=0,commits=0;
  const captures=new Map([['snapshot:wcl',bytes]]);
  const headStore={head:makeGenesisCaptureHead(expected)};
  const createKey=(kp,keyId,status='ACTIVE')=>({
    keyId,publicKeyPem:kp.publicKey.export({type:'spki',format:'pem'}),
    status,validFromMs:0,validUntilMs:1000,allowedExpansionIds:[99]});
  const ka=createKey(a,'key-2026a'),kb=createKey(b,'key-2026b');
  const registry={schema:'WCL_CAPTURE_TRUST_REGISTRY_V1',
    sourceNamespace:expected.sourceNamespace,revision:1,
    activeKeyId:ka.keyId,keys:[ka],revokedCaptureSetIds:[]};
  const signBundle=({id='set-01',issuedAtMs=50,privateKey=a.privateKey}={})=>{
    const payload={schema:'WCL_CAPTURE_SET_V1',captureSetId:id,
      sourceNamespace:expected.sourceNamespace,expansionId:99,locale:'en_US',
      issuedAtMs,expiresAtMs:400,wclPin:clone(wclPin),sourcePins:[],
      specCrosswalks:[]};
    const message=Buffer.from('WCL_CAPTURE_SET_V1\n'+canonicalCatalogJson(payload));
    return {schema:'WCL_SIGNED_CAPTURE_V1',payload,signature:{
      alg:'Ed25519',keyId:privateKey===a.privateKey?ka.keyId:kb.keyId,
      valueBase64:sign(null,message,privateKey).toString('base64')}};
  };
  const readCapture=async ref=>{
    reads++;let bytes=captures.get(ref);return bytes?Uint8Array.from(bytes):null;
  };
  const commitHead=async ({expectedHeadSha256,nextHead,nextHeadSha256})=>{
    commits++;
    if(governanceDigest(headStore.head)!==expectedHeadSha256)return {committed:false};
    if(governanceDigest(nextHead)!==nextHeadSha256)return {committed:false};
    headStore.head=clone(nextHead);
    return {committed:true,headSha256:nextHeadSha256};
  };
  const admit=(changes={})=>admitGovernedSignedWclCapture({
    signedBundle:signBundle(),registry,
    registrySha256:governanceDigest(registry),
    priorHead:clone(headStore.head),commitHead,expected,readCapture,nowMs:100,
    ...changes});
  return {a,b,ka,kb,registry,expected,wclPin,headStore,signBundle,
    commitHead,readCapture,admit,captures,
    counts:()=>({reads,commits})};
}

test('genesis signed capture is admitted only after durable compare-and-swap',async()=>{
  const f=fixture(),result=await f.admit();
  assert.equal(result.governanceReceipt.captureSetId,'set-01');
  assert.equal(result.governanceReceipt.registryRevision,1);
  assert.equal(result.governanceReceipt.commitStatus,'CONFIRMED_BY_TRUSTED_HOST_CAS');
  assert.equal(result.governanceReceipt.upstreamAuthenticated,false);
  assert.equal(result.receipt.bossDpsCertified,false);
  assert.equal(result.nextHead.generation,1);
  assert.equal(result.nextHead.lastIssuedAtMs,50);
  assert.equal(f.headStore.head.lastPayloadSha256,result.receipt.signedPayloadSha256);
  assert.deepEqual(f.counts(),{reads:1,commits:1});
  assert.equal(isGovernedCaptureCurrentlyTrusted({
    governanceReceipt:result.governanceReceipt,registry:f.registry,
    registrySha256:governanceDigest(f.registry),
    expected:f.expected,nowMs:100}),true);
});

test('same signed capture can never replay against a persisted head',async()=>{
  const f=fixture();await f.admit();
  await assert.rejects(()=>f.admit(),/GOVERNANCE_REPLAY_REVOKED_OR_SIGNER_INVALID/);
  assert.deepEqual(f.counts(),{reads:1,commits:1});
});

test('monotonic issuedAtMs permits a distinct later signed capture and increments generation',async()=>{
  const f=fixture();await f.admit();
  const second=await f.admit({signedBundle:f.signBundle({id:'set-02',issuedAtMs:60}),
    nowMs:100});
  assert.equal(second.nextHead.generation,2);
  assert.equal(f.headStore.head.lastCaptureSetId,'set-02');
  assert.deepEqual(f.counts(),{reads:2,commits:2});
});

test('a duplicate capture set ID is rejected despite a newer signed issue timestamp',async()=>{
  const f=fixture();await f.admit();
  await assert.rejects(()=>f.admit({
    signedBundle:f.signBundle({issuedAtMs:80})
  }),/GOVERNANCE_REPLAY_REVOKED_OR_SIGNER_INVALID/);
  assert.deepEqual(f.counts(),{reads:1,commits:1});
});

test('rotation to a fresh key requires an independently pinned new registry revision',async()=>{
  const f=fixture();
  const first=await f.admit();
  const rotated={...f.registry,revision:2,
    activeKeyId:f.kb.keyId,keys:[{...f.ka,status:'RETIRED'},f.kb]};
  const rotatedHash=governanceDigest(rotated);
  assert.equal(isGovernedCaptureCurrentlyTrusted({
    governanceReceipt:first.governanceReceipt,registry:rotated,
    registrySha256:rotatedHash,expected:f.expected,nowMs:100}),false);
  await assert.rejects(()=>f.admit({registry:rotated,
    registrySha256:rotatedHash,
    signedBundle:f.signBundle({id:'old-key',issuedAtMs:61})
  }),/GOVERNANCE_REPLAY_REVOKED_OR_SIGNER_INVALID/);
  const newOne=await f.admit({registry:rotated,
    registrySha256:rotatedHash,
    signedBundle:f.signBundle({id:'set-02',issuedAtMs:62,
      privateKey:f.b.privateKey})});
  assert.equal(newOne.governanceReceipt.signerId,'key-2026b');
  assert.equal(f.headStore.head.registryRevision,2);
  assert.equal(isGovernedCaptureCurrentlyTrusted({
    governanceReceipt:newOne.governanceReceipt,registry:rotated,
    registrySha256:rotatedHash,expected:f.expected,nowMs:100}),true);
});

test('revocation invalidates a prior receipt without mutating historical audit state',async()=>{
  const f=fixture(),a=await f.admit();
  const revoked={...f.registry,revision:2,revokedCaptureSetIds:['set-01']};
  assert.equal(isGovernedCaptureCurrentlyTrusted({
    governanceReceipt:a.governanceReceipt,registry:revoked,
    registrySha256:governanceDigest(revoked),
    expected:f.expected,nowMs:100}),false);
  assert.equal(f.headStore.head.lastCaptureSetId,'set-01');
  await assert.rejects(()=>f.admit({registry:revoked,
    registrySha256:governanceDigest(revoked),
    signedBundle:f.signBundle({id:'set-01',issuedAtMs:80})
  }),/GOVERNANCE_REPLAY_REVOKED_OR_SIGNER_INVALID/);
});

test('a retired or revoked signer cannot be the active key',async()=>{
  for (const status of ['RETIRED','REVOKED']){
    const f=fixture(),r={...f.registry,keys:[{...f.ka,status}]};
    await assert.rejects(()=>f.admit({registry:r,registrySha256:governanceDigest(r)}),
      /GOVERNANCE_ACTIVE_KEY_AMBIGUOUS/);
    assert.deepEqual(f.counts(),{reads:0,commits:0});
  }
});

test('multiple active keys, duplicated IDs and unauthorized expansion fail closed',async()=>{
  const f=fixture();
  for (const keys of [
    [f.ka,f.kb],[f.ka,{...f.ka}]
  ]){
    const r={...f.registry,keys};
    await assert.rejects(()=>f.admit({registry:r,registrySha256:governanceDigest(r)}),
      /GOVERNANCE_KEY_INVALID|GOVERNANCE_ACTIVE_KEY_AMBIGUOUS/);
  }
  const unauthorized={...f.registry,keys:[{...f.ka,allowedExpansionIds:[100]}]};
  await assert.rejects(()=>f.admit({registry:unauthorized,
    registrySha256:governanceDigest(unauthorized)
  }),/GOVERNANCE_ACTIVE_KEY_NOT_AUTHORIZED/);
  assert.deepEqual(f.counts(),{reads:0,commits:0});
});

test('a changed registry with an old hash is rejected before any source reads',async()=>{
  const f=fixture(),prior=governanceDigest(f.registry);
  f.registry.revokedCaptureSetIds.push('set-01');
  await assert.rejects(()=>f.admit({registrySha256:prior}),
    /GOVERNANCE_REGISTRY_DIGEST_MISMATCH/);
  assert.deepEqual(f.counts(),{reads:0,commits:0});
});

test('registry rollback below previously accepted revision is blocked',async()=>{
  const f=fixture();
  const rev3={...f.registry,revision:3};
  await f.admit({registry:rev3,registrySha256:governanceDigest(rev3)});
  await assert.rejects(()=>f.admit({
    signedBundle:f.signBundle({id:'later',issuedAtMs:70})
  }),/GOVERNANCE_LEDGER_HEAD_INVALID/);
  assert.deepEqual(f.counts(),{reads:1,commits:1});
});

test('concurrent admission using one ledger version permits only one CAS',async()=>{
  const f=fixture();
  const previous=clone(f.headStore.head);
  const input={
    priorHead:previous
  };
  const results=await Promise.allSettled([
    f.admit({...input,signedBundle:f.signBundle({id:'set-A',issuedAtMs:51})}),
    f.admit({...input,signedBundle:f.signBundle({id:'set-B',issuedAtMs:52})})
  ]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(results.filter(x=>x.status==='rejected').length,1);
  assert.match(String(results.find(x=>x.status==='rejected').reason),
    /GOVERNANCE_ATOMIC_LEDGER_COMMIT_UNCONFIRMED/);
  assert.equal(f.headStore.head.generation,1);
  assert.equal(f.counts().commits,2);
});

test('a missing, false, malformed or dishonest CAS acknowledgement never authorizes admission',async()=>{
  for(const reply of [undefined,{committed:false},
    {committed:true,headSha256:'f'.repeat(64)}]){
    const f=fixture();
    await assert.rejects(()=>f.admit({commitHead:async()=>reply}),
      /GOVERNANCE_ATOMIC_LEDGER_COMMIT_UNCONFIRMED/);
  }
});

test('tampered or revoked capture content never advances the ledger',async()=>{
  const f=fixture();
  f.captures.set(f.wclPin.sourceRef,utf({evil:true}));
  await assert.rejects(()=>f.admit(),/SIGNED_CAPTURE_BYTES_DIGEST_MISMATCH/);
  assert.equal(f.headStore.head.generation,0);
  assert.equal(f.counts().commits,0);
});

test('a forged signature or expired bundle does not invoke atomic commit',async()=>{
  const f=fixture(),fake=f.signBundle();
  fake.payload.captureSetId='forged';
  await assert.rejects(()=>f.admit({signedBundle:fake}),
    /SIGNED_CAPTURE_SIGNATURE_UNTRUSTED/);
  await assert.rejects(()=>f.admit({nowMs:401}),
    /SIGNED_CAPTURE_PAYLOAD_SCOPE_OR_TIME_INVALID/);
  assert.equal(f.counts().commits,0);
});

test('missing ledger or untrusted commit host is not an optional safeguard',async()=>{
  const f=fixture();
  await assert.rejects(()=>f.admit({priorHead:null}),/GOVERNANCE_LEDGER_HEAD_INVALID/);
  await assert.rejects(()=>f.admit({commitHead:null}),/GOVERNANCE_INPUT_INVALID/);
  assert.deepEqual(f.counts(),{reads:0,commits:0});
});

test('invalid genesis, scope cross-over and malformed receipt do not pass',async()=>{
  assert.throws(()=>makeGenesisCaptureHead({sourceNamespace:'retail',expansionId:0}),
    /GOVERNANCE_GENESIS_SCOPE_INVALID/);
  const f=fixture();
  const alien=makeGenesisCaptureHead({sourceNamespace:'classic',expansionId:99});
  await assert.rejects(()=>f.admit({priorHead:alien}),/GOVERNANCE_LEDGER_HEAD_INVALID/);
  assert.throws(()=>isGovernedCaptureCurrentlyTrusted({
    governanceReceipt:{},registry:f.registry,
    registrySha256:governanceDigest(f.registry),
    expected:f.expected,nowMs:100}),/GOVERNANCE_RECEIPT_INVALID/);
});
