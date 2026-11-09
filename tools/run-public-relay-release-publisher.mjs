/**
 * Optional PUBLIC publishing job for a reviewed trusted-branch release intent.
 * No WCL, private HMAC, staging, C-delta or Sheets. Native GITHUB_TOKEN writes
 * only the existing append-only public evidence branch via the signed relay.
 * No intent/credential/trusted push -> stop before ANY network request.
 */
import fs from 'node:fs';
import {inspectTrustedPublicReleaseIntent}
  from './run-public-relay-release-preflight.mjs';
import {publishPinnedPrivateSignedWave,PUBLIC_RELAY_APPROVAL_KIND}
  from '../src/adapters/fresh216-signed-evidence-relay.mjs';

const FILE='projects/wcl-fresh216/release-intents/public-actor-wave-v1.json';
const need=(yes,code)=>{if(!yes)throw Error(code);};
const sha40=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
const sha64=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function buildTrustedPublicReleaseRequest({intent,env={}}={}){
  const checked=inspectTrustedPublicReleaseIntent({
    intent,githubContext:env
  });
  need(checked.status==='FRESH216_PUBLIC_RELEASE_INTENT_READ_ONLY_PREFLIGHT_PASS',
    'FRESH216_PUBLISH_PREFLIGHT_INVALID');
  need(typeof env.FRESH216_PRIVATE_READ_TOKEN==='string'&&
    env.FRESH216_PRIVATE_READ_TOKEN.length>=20&&
    typeof env.GITHUB_TOKEN==='string'&&env.GITHUB_TOKEN.length>=20,
    'FRESH216_PUBLISH_CREDENTIAL_UNAVAILABLE');
  return {
    approvedPrivateStageCommit:intent.privateStageCommit,
    waveSha256:intent.waveSha256,
    privateReadToken:env.FRESH216_PRIVATE_READ_TOKEN,
    publicGitToken:env.GITHUB_TOKEN,
    publicationApproved:true,
    approvedPublication:{
      schema:1,kind:PUBLIC_RELAY_APPROVAL_KIND,
      privateStageCommit:intent.privateStageCommit,
      waveSha256:intent.waveSha256,
      expectedPublicEvidenceHead:intent.expectedPublicEvidenceHead,
      reviewedWorkflowCommit:env.GITHUB_SHA
    },
    githubContext:env
  };
}
export function readTrustedReleaseIntentFile({file=FILE}={}){
  need(fs.existsSync(file),'FRESH216_PUBLIC_RELEASE_NO_APPROVED_INTENT_BLOCKED');
  const stat=fs.lstatSync(file);
  need(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&
    stat.size<=4096,'FRESH216_PUBLISH_INTENT_FILE_UNSAFE');
  try{return JSON.parse(fs.readFileSync(file,'utf8'));}
  catch{throw Error('FRESH216_PUBLISH_INTENT_JSON_INVALID');}
}
export async function runTrustedPublicSignedWaveRelease({
  intent,env=process.env,relay=publishPinnedPrivateSignedWave
}={}){
  need(typeof relay==='function','FRESH216_PUBLISH_RELAY_INVALID');
  const args=buildTrustedPublicReleaseRequest({intent,env});
  const receipt=await relay(args);
  need(receipt?.status==='PUBLIC_SIGNED_RELAY_COMMIT_READBACK_CONFIRMED'&&
    receipt.privateCommitSha===intent.privateStageCommit&&
    sha64(receipt.manifestSha256)&&
    (receipt.publicCommitSha===null||sha40(receipt.publicCommitSha))&&
    Number.isSafeInteger(receipt.archiveCount)&&receipt.archiveCount>=1&&
    receipt.archiveCount<=8&&
    Number.isSafeInteger(receipt.verifiedSlots)&&
    Number.isSafeInteger(receipt.unresolvedSlots),
    'FRESH216_PUBLISH_RECEIPT_DRIFT');
  return {
    status:'FRESH216_TRUSTED_SIGNED_WAVE_PUBLIC_READBACK_CONFIRMED',
    privateCommitSha:receipt.privateCommitSha,
    waveSha256:intent.waveSha256,
    manifestSha256:receipt.manifestSha256,
    publicCommitSha:receipt.publicCommitSha,
    reused:receipt.reused===true,
    archiveCount:receipt.archiveCount,
    verifiedSlots:receipt.verifiedSlots,
    unresolvedSlots:receipt.unresolvedSlots,
    wclCalls:0,cDeltaAppends:0,sheetsWrites:0
  };
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  try{
    const result=await runTrustedPublicSignedWaveRelease({
      intent:readTrustedReleaseIntentFile()
    });
    console.log(JSON.stringify(result));
  }catch(e){
    const code=/^(FRESH216_|SIGNED_RELAY_|PUBLIC_ACTOR_)[A-Z0-9_]+$/.test(e?.message??'')?
      e.message:'FRESH216_PUBLISH_EXECUTION_STOP';
    console.error(code);
    process.exitCode=1;
  }
}
