import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {canonicalCatalogJson} from '../src/core/environment-discovery.mjs';
import {governanceDigest} from '../src/adapters/wcl-capture-trust-governance.mjs';
import {openSqliteCaptureLedger} from '../src/adapters/wcl-sqlite-capture-ledger.mjs';
import {admitWithIndependentAnchor}
  from '../src/adapters/wcl-anchored-admission.mjs';
import {createTrustedCapturedEvidenceVerifier}
  from '../src/core/wcl-captured-evidence-verifier.mjs';
import {buildEvidenceGatedWclPolicy}
  from '../src/core/wcl-catalog-evidence-policy.mjs';
import {inspectWclSqliteLedger,candidateWclLedgerAnchors,verifyWclLedgerAnchors,
  backupAnchoredWclSqliteLedger,verifyAnchoredWclSqliteBackup}
  from '../src/adapters/wcl-sqlite-ledger-recovery.mjs';

const sha=x=>createHash('sha256').update(x).digest('hex');
const encode=o=>new TextEncoder().encode(JSON.stringify(o));
const clone=o=>structuredClone(o);
function fixture(){
  const root=mkdtempSync(join(tmpdir(),'wcl-full-e2e-'));
  const dbPath=join(root,'captures.sqlite');
  const {mkdirSync}=requireNotUsed();
  // The temporary backup root belongs only to this synthetic test.
  const backupRoot=join(root,'backups');
  mkdirSync(backupRoot);
  let ledger=openSqliteCaptureLedger({dbPath});
  const expected={sourceNamespace:'synthetic-retail',expansionId:99,locale:'en_US'};
  const scope={sourceNamespace:expected.sourceNamespace,expansionId:expected.expansionId};
  const genesis=ledger.initializeScope(scope).head;
  let anchor={...scope,generation:genesis.generation,headSha256:governanceDigest(genesis)};
  const flags={failAdvance:false,forgeAcknowledgement:false,skipMutation:false,
    failReadback:false,reads:0,advances:0,captureReads:0};
  const anchorHost={
    readVerifiedAnchor:async()=>{
      flags.reads++;
      if(flags.failReadback&&flags.reads>1)throw Error('TRUSTED_ANCHOR_UNAVAILABLE');
      return clone(anchor);
    },
    compareAndAdvance:async({previous,next})=>{
      flags.advances++;
      if(flags.failAdvance)throw Error('OFF_HOST_STORE_FAILURE');
      if(flags.forgeAcknowledgement)
        return {committed:true,headSha256:'f'.repeat(64),generation:next.generation};
      if(flags.skipMutation)
        return {committed:true,headSha256:next.headSha256,generation:next.generation};
      if(anchor.headSha256!==previous.headSha256 ||
        anchor.generation!==previous.generation)return {committed:false};
      anchor=clone(next);
      return {committed:true,headSha256:next.headSha256,generation:next.generation};
    }
  };
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  const registry={schema:'WCL_CAPTURE_TRUST_REGISTRY_V1',
    sourceNamespace:expected.sourceNamespace,revision:1,
    activeKeyId:'fixture-signer',
    keys:[{keyId:'fixture-signer',
      publicKeyPem:publicKey.export({type:'spki',format:'pem'}),
      status:'ACTIVE',validFromMs:0,validUntilMs:1000,
      allowedExpansionIds:[99]}],
    revokedCaptureSetIds:[]};
  const captures=new Map();
  function add(ref,doc,sourceKind,originHost,endpoint,namespace,extra={}){
    const raw=encode(doc);captures.set(ref,raw);
    return {sourceRef:ref,sourceKind,sourceSha256:sha(raw),
      originHost,endpoint,namespace,locale:'en_US',
      capturedAtMs:10,validUntilMs:700,...extra};
  }
  const wclPin=add('cap:wcl',{
    schema:'WCL_CAPTURED_DIRECTORY_AND_ZONES_V1',
    sourceNamespace:'synthetic-retail',expansionId:99,
    directory:{data:{
      worldData:{expansions:[{id:99,name:'Fixture Expansion'}]},
      gameData:{classes:[{id:8,name:'Mage',slug:'mage',
        specs:[{id:3,name:'Fire',slug:'fire'}]}]}
    }},
    zones:{data:{worldData:{zones:[{id:901,name:'Fixture Raid',
      encounters:[{id:10001,name:'First Boss',journalID:300},
        {id:10002,name:'Second Boss',journalID:301}]}]}}}
  },'WCL_CATALOG_BUNDLE','www.warcraftlogs.com','/api/v2/client',
  'synthetic-retail');
  const specPin=add('cap:blizzard',{
    id:63,name:'Fire',playable_class:{id:8},
    role:{type:'DAMAGE',name:'Damage'}
  },'BLIZZARD_PLAYABLE_SPECIALIZATION','us.api.blizzard.com',
  '/data/wow/playable-specialization/63','static-us');
  const journalPin=add('cap:journal',{
    schema:'WOW_CLIENT_EJ_EXPORT_V1',clientBuild:'12.0.1',
    locale:'en_US',instances:[{journalInstanceID:555,isRaid:true,
      encounters:[{journalEncounterID:300},{journalEncounterID:301}]}]
  },'WOW_CLIENT_JOURNAL','wow-client-export',
  'EJ_GetInstanceByIndex+EJ_GetEncounterInfoByIndex',
  'synthetic-retail',{clientBuild:'12.0.1'});
  const readCapture=async ref=>{flags.captureReads++;
    return Uint8Array.from(captures.get(ref)??[]);
  };
  function bundle(id='set-001',issuedAtMs=50){
    const payload={schema:'WCL_CAPTURE_SET_V1',captureSetId:id,
      sourceNamespace:'synthetic-retail',expansionId:99,
      locale:'en_US',issuedAtMs,expiresAtMs:650,
      wclPin,sourcePins:[specPin,journalPin],
      specCrosswalks:[{wclClassId:8,wclSpecId:3,
        blizzardClassId:8,blizzardSpecId:63,
        wclSourceSha256:wclPin.sourceSha256,
        blizzardSourceSha256:specPin.sourceSha256}]
    };
    const message=Buffer.from('WCL_CAPTURE_SET_V1\n'+canonicalCatalogJson(payload));
    return {schema:'WCL_SIGNED_CAPTURE_V1',payload,signature:{
      alg:'Ed25519',keyId:'fixture-signer',
      valueBase64:sign(null,message,privateKey).toString('base64')
    }};
  }
  const args=(signedBundle=bundle())=>({
    signedBundle,ledger,anchorHost,registry,
    registrySha256:governanceDigest(registry),
    expected,readCapture,nowMs:100
  });
  const manifest={schema:'WCL_CLASSIFICATION_POLICY_V1',
    sourceNamespace:'synthetic-retail',expansionId:99,version:'fixture-v1',
    records:[
      {claim:{kind:'SPEC_ROLE',wclClassId:8,wclClassSlug:'mage',
        wclSpecId:3,wclSpecSlug:'fire',value:'dps'},
        evidence:{sourceKind:specPin.sourceKind,sourceRef:specPin.sourceRef,
          sourceSha256:specPin.sourceSha256,capturedAtMs:10,validUntilMs:700}},
      {claim:{kind:'ZONE_KIND',wclZoneId:901,wclZoneName:'Fixture Raid',
        value:'raid'},
        evidence:{sourceKind:journalPin.sourceKind,sourceRef:journalPin.sourceRef,
          sourceSha256:journalPin.sourceSha256,capturedAtMs:10,validUntilMs:700}}
    ]};
  return {root,dbPath,backupRoot,expected,scope,flags,anchorHost,
    wclPin,specPin,journalPin,bundle,args,manifest,
    ledger:()=>ledger,
    currentAnchor:()=>clone(anchor),
    changeAnchor:x=>{anchor=clone(x);},
    reopen:()=>{ledger.close();ledger=openSqliteCaptureLedger({dbPath});},
    close:()=>{ledger.close();rmSync(root,{recursive:true,force:true});}};
}
function requireNotUsed(){return {mkdirSync:globalThis.__noop_missing__};}
async function setupTest(run){const f=fixture();try{await run(f);}finally{f.close();}}

test('whole chain: signed captures -> SQLite -> independent anchor -> WCL role/raid -> backup -> restart',()=>setupTest(async f=>{
  const accepted=await admitWithIndependentAnchor(f.args());
  assert.equal(accepted.finalization.status,'LEDGER_AND_INDEPENDENT_ANCHOR_CONFIRMED');
  assert.equal(accepted.finalization.upstreamAuthenticated,false);
  assert.equal(f.ledger().readHead(f.scope).generation,1);
  assert.equal(f.currentAnchor().generation,1);
  const verifyEvidence=createTrustedCapturedEvidenceVerifier(accepted);
  const policy=await buildEvidenceGatedWclPolicy({
    manifest:f.manifest,verifyEvidence,sha256:accepted.sha256Text,nowMs:100
  });
  assert.equal(policy.diagnostics.accepted,2);
  assert.equal(policy.classifySpec({id:3,slug:'fire'},{id:8,slug:'mage'}),'dps');
  assert.equal(policy.classifyZone({id:901,name:'Fixture Raid'},{id:99}),'raid');
  assert.equal(accepted.receipt.upstreamAuthenticated,false);
  const audit=inspectWclSqliteLedger({dbPath:f.dbPath});
  const anchors=[f.currentAnchor()];
  assert.equal(verifyWclLedgerAnchors({audit,trustedAnchors:anchors}).status,
    'ANCHORED_HISTORY_VERIFIED');
  const receipt=await backupAnchoredWclSqliteLedger({
    dbPath:f.dbPath,backupRoot:f.backupRoot,trustedAnchors:anchors
  });
  assert.equal(verifyAnchoredWclSqliteBackup({
    dbPath:receipt.backupPath,expectedFileSha256:receipt.sha256,
    trustedAnchors:anchors
  }).status,'BACKUP_BYTES_AND_ANCHORS_VERIFIED');
  f.reopen();
  assert.equal(f.ledger().readHead(f.scope).generation,1);
  await assert.rejects(()=>admitWithIndependentAnchor(f.args()),
    /GOVERNANCE_REPLAY_REVOKED_OR_SIGNER_INVALID/);
}));

test('an external anchor write failure quarantines an ALREADY committed DB head',()=>setupTest(async f=>{
  f.flags.failAdvance=true;
  await assert.rejects(()=>admitWithIndependentAnchor(f.args()),
    /ANCHORED_ADMISSION_DB_COMMITTED_ANCHOR_UNCONFIRMED/);
  assert.equal(f.ledger().readHead(f.scope).generation,1);
  assert.equal(f.currentAnchor().generation,0);
  f.flags.failAdvance=false;
  const before=f.flags.captureReads;
  await assert.rejects(()=>admitWithIndependentAnchor(f.args(f.bundle('set-002',60))),
    /ANCHORED_ADMISSION_LEDGER_ANCHOR_DIVERGENCE/);
  assert.equal(f.flags.captureReads,before);
}));

test('a fake CAS acknowledgement never yields usable evidence',()=>setupTest(async f=>{
  f.flags.forgeAcknowledgement=true;
  await assert.rejects(()=>admitWithIndependentAnchor(f.args()),
    /ANCHORED_ADMISSION_DB_COMMITTED_ANCHOR_UNCONFIRMED/);
  assert.equal(f.ledger().readHead(f.scope).generation,1);
  assert.equal(f.currentAnchor().generation,0);
}));

test('a false success with no independent readback is rejected',()=>setupTest(async f=>{
  f.flags.skipMutation=true;
  await assert.rejects(()=>admitWithIndependentAnchor(f.args()),
    /ANCHORED_ADMISSION_DB_COMMITTED_ANCHOR_READBACK_FAILED/);
  assert.equal(f.ledger().readHead(f.scope).generation,1);
  assert.equal(f.currentAnchor().generation,0);
}));

test('unavailable trusted-anchor readback after CAS blocks promotion',()=>setupTest(async f=>{
  f.flags.failReadback=true;
  await assert.rejects(()=>admitWithIndependentAnchor(f.args()),
    /ANCHORED_ADMISSION_DB_COMMITTED_ANCHOR_READBACK_FAILED/);
}));

test('old DB + new external anchor fails before capture bytes read',()=>setupTest(async f=>{
  f.changeAnchor({...f.currentAnchor(),generation:1,headSha256:'e'.repeat(64)});
  await assert.rejects(()=>admitWithIndependentAnchor(f.args()),
    /ANCHORED_ADMISSION_LEDGER_ANCHOR_DIVERGENCE/);
  assert.equal(f.flags.captureReads,0);
  assert.equal(f.ledger().readHead(f.scope).generation,0);
}));

test('different scope anchor is never accepted as current authority',()=>setupTest(async f=>{
  f.changeAnchor({...f.currentAnchor(),expansionId:100});
  await assert.rejects(()=>admitWithIndependentAnchor(f.args()),
    /ANCHORED_ADMISSION_TRUSTED_ANCHOR_INVALID/);
  assert.equal(f.flags.captureReads,0);
}));

test('tampered signed payload cannot commit SQLite or advance external anchor',()=>setupTest(async f=>{
  const changed=f.bundle();changed.payload.captureSetId='unsigned-new-name';
  await assert.rejects(()=>admitWithIndependentAnchor(f.args(changed)),
    /SIGNED_CAPTURE_SIGNATURE_UNTRUSTED/);
  assert.equal(f.ledger().readHead(f.scope).generation,0);
  assert.equal(f.currentAnchor().generation,0);
  assert.equal(f.flags.advances,0);
}));

test('two overlapping admissions cannot both pass CAS or create divergent anchors',()=>setupTest(async f=>{
  const a=f.args(f.bundle('concurrent-A',51));
  const b=f.args(f.bundle('concurrent-B',52));
  const results=await Promise.allSettled([
    admitWithIndependentAnchor(a),admitWithIndependentAnchor(b)
  ]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(results.filter(x=>x.status==='rejected').length,1);
  assert.equal(f.currentAnchor().generation,1);
  assert.equal(f.ledger().readHead(f.scope).generation,1);
}));

test('two successive admissions increase both durable generation and independent high-water',()=>setupTest(async f=>{
  const first=await admitWithIndependentAnchor(f.args());
  const second=await admitWithIndependentAnchor(
    f.args(f.bundle('set-002',60)));
  assert.equal(first.finalization.generation,1);
  assert.equal(second.finalization.generation,2);
  assert.equal(f.currentAnchor().generation,2);
  assert.equal(f.ledger().readAdmission('set-002').generation,2);
}));
