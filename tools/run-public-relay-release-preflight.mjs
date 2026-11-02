/**
 * Trusted-branch release-intent preview. Never reads a Secret, calls GitHub,
 * queries WCL, stages evidence, or writes to Git. It cannot publish.
 * Release intent must be reviewed in a separate protected-branch PR.
 */
import fs from 'node:fs';
import {
  validatePublicRelayApproval,PUBLIC_RELAY_APPROVAL_KIND
} from '../src/adapters/fresh216-signed-evidence-relay.mjs';

const RELEASE_INTENT_FILE=
  'projects/wcl-fresh216/release-intents/public-actor-wave-v1.json';
const INTENT_KIND='FRESH216_PUBLIC_WAVE_RELEASE_INTENT_V1';
const need=(v,c)=>{if(!v)throw Error(c);};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&
  Object.keys(v).sort().join('|')===keys.slice().sort().join('|');

export function inspectTrustedPublicReleaseIntent({
  intent,githubContext=process.env
}={}){
  need(exact(intent,['schema','kind','privateStageCommit','waveSha256',
    'expectedPublicEvidenceHead'])&&intent.schema===1&&
    intent.kind===INTENT_KIND,
    'FRESH216_PUBLIC_RELEASE_INTENT_SCHEMA_INVALID');
  const approvedPublication={
    schema:1,kind:PUBLIC_RELAY_APPROVAL_KIND,
    privateStageCommit:intent.privateStageCommit,
    waveSha256:intent.waveSha256,
    expectedPublicEvidenceHead:intent.expectedPublicEvidenceHead,
    // GitHub SHA comes from the protected push event, NOT a self-referential
    // commit field in the reviewed release-intent JSON.
    reviewedWorkflowCommit:githubContext?.GITHUB_SHA
  };
  const bound=validatePublicRelayApproval({
    approval:approvedPublication,
    approvedPrivateStageCommit:intent.privateStageCommit,
    waveSha256:intent.waveSha256,
    githubContext
  });
  return {
    status:'FRESH216_PUBLIC_RELEASE_INTENT_READ_ONLY_PREFLIGHT_PASS',
    trustedWorkflowCommit:bound.reviewedWorkflowCommit,
    stageCommitPinned:true,wavePinned:true,publicParentPinned:true,
    independentOwnerReviewVerified:false,
    hmacSignatureVerifiedInThisJob:false,
    publicWriteCapabilityVerified:false,
    realPublicPublicationAuthorized:false,
    wclCalls:0,publicGitWrites:0,privateGitWrites:0,
    apiPoints:0,cDeltaAppends:0,sheetsWrites:0
  };
}
export function runReadOnlyReleaseIntentCli({env=process.env}={}){
  try{
    need(env.GITHUB_ACTIONS==='true'&&
      env.GITHUB_REPOSITORY==='degong2-code/wcl-fresh216'&&
      env.GITHUB_REF==='refs/heads/work/fresh216-autonomous-host-20261031'&&
      env.GITHUB_EVENT_NAME==='push',
      'FRESH216_PUBLIC_RELEASE_UNTRUSTED_CONTEXT');
    if(!fs.existsSync(RELEASE_INTENT_FILE)){
      return {
        status:'FRESH216_PUBLIC_RELEASE_NO_APPROVED_INTENT_BLOCKED',
        filePresent:false,publicWrites:0,wclCalls:0
      };
    }
    const stat=fs.lstatSync(RELEASE_INTENT_FILE);
    need(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&
      stat.size<=4096,'FRESH216_PUBLIC_RELEASE_FILE_UNSAFE');
    const intent=JSON.parse(fs.readFileSync(RELEASE_INTENT_FILE,'utf8'));
    return inspectTrustedPublicReleaseIntent({intent,githubContext:env});
  }catch(e){
    const safe=/^(FRESH216_PUBLIC_RELEASE_|SIGNED_RELAY_)[A-Z0-9_]+$/.test(e?.message??'')?
      e.message:'FRESH216_PUBLIC_RELEASE_PREFLIGHT_FAILED';
    throw Error(safe);
  }
}
if(process.argv[1]&&import.meta.url===new URL('file://'+
  process.argv[1]).href){
  try{console.log(JSON.stringify(runReadOnlyReleaseIntentCli()));}
  catch(e){console.error(e.message);process.exitCode=1;}
}
