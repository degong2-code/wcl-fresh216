/**
 * Immutable A + compact mutable B checkpoint, without copying the A ranks
 * into each remote Git push.
 *
 * The existing BossDPS journal and cost admission consume a *virtual*
 * schema-1 checkpoint. Only the B journal is persisted; original A witnesses
 * remain on a separately pinned, READ-ONLY private Git branch. A remote
 * B store update must synchronously confirm its Git push before returning.
 */
import {createHash} from 'node:crypto';
import {newCheckpoint,checkpointStats} from './checkpoint.mjs';
import {makeFreshDatedHeroicManifest,
  projectCompletedFreshCohort} from './fresh-cohort-source.mjs';
import {planFreshBossFirstPages} from './fresh-boss-first-page.mjs';

const need=(v,code)=>{if(!v)throw Error(code);};
const sha=x=>createHash('sha256').update(JSON.stringify(x))
  .digest('hex');
const sha40=s=>typeof s==='string'&&/^[a-f0-9]{40}$/.test(s);
const plain=o=>o&&typeof o==='object'&&!Array.isArray(o);
const copy=o=>structuredClone(o);

function freezeAndAttestSource(sourceState,{sourceHead,bossJobsPerRequest}={}){
  need(plain(sourceState)&&sha40(sourceHead)&&
    [8,9].includes(bossJobsPerRequest),
    'BOSS_ISOLATED_SOURCE_INPUT_INVALID');
  need(sourceState.schema===1&&sourceState.status==='ACTIVE'&&
    sha40(sourceState.sourceCodeCommit),
    'BOSS_ISOLATED_SOURCE_IDENTITY_INVALID');
  const manifest=makeFreshDatedHeroicManifest(sourceState.scopeKey);
  const projected=projectCompletedFreshCohort(sourceState,manifest);
  need(projected.summary.status==='SOURCE_COMPLETE'&&
    projected.summary.jobsCompleted===216&&
    projected.summary.rankSlotsCompleted===21600,
    'BOSS_ISOLATED_REQUIRES_COMPLETE_A');
  need(Object.keys(sourceState.entries??{}).length===0&&
    Object.keys(sourceState.rankRequests??{}).length===0&&
    Object.keys(sourceState.bossPageRequests??{}).length===0,
    'BOSS_ISOLATED_SOURCE_MUST_BE_A_ONLY');
  const bossPlan=planFreshBossFirstPages(projected.slots,{
    jobsPerRequest:bossJobsPerRequest
  });
  need(bossPlan.partialSource===false&&
    bossPlan.batches.length===(bossJobsPerRequest===9?24:32),
    'BOSS_ISOLATED_PLAN_DRIFT');
  const source=copy(sourceState);
  const pin={
    kind:'FRESH216_ISOLATED_BOSS_SOURCE_V1',
    sourceHead,sourceScopeKey:source.scopeKey,
    sourceCodeCommit:source.sourceCodeCommit,
    sourceVersion:source.version,
    sourceStateSha256:sha(source),
    sourceManifestSha:source.sourceManifestSha,
    sourceJobsPerRequest:source.sourceJobsPerRequest??8,
    bossJobsPerRequest
  };
  const stats=checkpointStats(source);
  need(stats.pointsUnobserved===0&&
    Number.isFinite(stats.witnessedPoints)&&
    stats.witnessedPoints>=0,'BOSS_ISOLATED_A_COST_UNCERTAIN');
  return {source,pin,batches:bossPlan.batches,
    originalSourcePoints:stats.witnessedPoints};
}

export function createIsolatedBossCheckpoint({sourceState,sourceHead,
  bossJobsPerRequest=9,runId}={}){
  need(typeof runId==='string'&&runId.length>0&&
    runId.length<=128,'BOSS_ISOLATED_RUN_ID_INVALID');
  const attested=freezeAndAttestSource(sourceState,{
    sourceHead,bossJobsPerRequest
  });
  const state=newCheckpoint(attested.pin.sourceScopeKey,runId);
  state.bossSourcePin=attested.pin;
  state.bossPageRequests={};
  return state;
}

/** Compose a virtual checkpoint for the existing *unchanged* paid B journal.
 * Persist only the small B-state shape, never reserialized A witnesses.
 * Fail-closed after any ambiguous mutation, commit or remote write.
 */
export function makeIsolatedBossStore({sourceState,sourceHead,
  bossJobsPerRequest=9,bossStore}={}){
  need(bossStore&&typeof bossStore.read==='function'&&
    typeof bossStore.update==='function','BOSS_ISOLATED_STORE_REQUIRED');
  const {source,pin,batches,originalSourcePoints}=
    freezeAndAttestSource(sourceState,{sourceHead,bossJobsPerRequest});
  const validateB=b=>{
    need(plain(b)&&b.schema===1&&b.status==='ACTIVE'&&
      b.scopeKey===pin.sourceScopeKey&&
      plain(b.bossSourcePin)&&
      sha(b.bossSourcePin)===sha(pin)&&
      plain(b.bossPageRequests??{})&&
      Object.keys(b.entries??{}).length===0&&
      Object.keys(b.rankRequests??{}).length===0&&
      Object.keys(b.sourceRequests??{}).length===0&&
      b.sourceManifestSha==null&&b.sourceCodeCommit==null&&
      b.sourceJobsPerRequest==null,
      'BOSS_ISOLATED_B_CHECKPOINT_DRIFT');
    return b;
  };
  const compose=b=>{
    validateB(b);
    return {...copy(b),
      sourceManifestSha:source.sourceManifestSha,
      sourceCodeCommit:source.sourceCodeCommit,
      sourceJobsPerRequest:source.sourceJobsPerRequest??8,
      sourceRequests:copy(source.sourceRequests)};
  };
  const strip=(before,next)=>{
    need(plain(next)&&next.schema===1&&
      next.version===before.version+1&&
      next.status===before.status&&next.scopeKey===before.scopeKey&&
      next.runId===before.runId&&
      sha(next.bossSourcePin)===sha(pin)&&
      sha(next.sourceRequests)===sha(source.sourceRequests)&&
      next.sourceManifestSha===source.sourceManifestSha&&
      next.sourceCodeCommit===source.sourceCodeCommit&&
      next.sourceJobsPerRequest===(source.sourceJobsPerRequest??8)&&
      sha(next.entries??{})===sha(before.entries??{})&&
      sha(next.rankRequests??{})===sha(before.rankRequests??{}),
      'BOSS_ISOLATED_MUTATED_A_OR_IDENTITY');
    const out=copy(next);
    delete out.sourceManifestSha;
    delete out.sourceCodeCommit;
    delete out.sourceJobsPerRequest;
    out.sourceRequests={};
    return validateB(out);
  };
  const adapter={
    read:()=>compose(bossStore.read()),
    update:transition=>{
      need(typeof transition==='function',
        'BOSS_ISOLATED_TRANSITION_INVALID');
      // Local implementation can throw on Git push. Never return a
      // virtual COMMITTED receipt unless underlying store.update returns.
      return compose(bossStore.update(old=>{
        const before=compose(old);
        return strip(before,transition(copy(before)));
      }));
    }
  };
  validateB(bossStore.read());
  return {store:adapter,batches,pin,originalSourcePoints,
    bossAdmissionPolicy:({maxBossObservedPoints,reservePoints,
      notBeforeMs=0}={})=>{
      need(Number.isFinite(maxBossObservedPoints)&&
        maxBossObservedPoints>0&&Number.isFinite(reservePoints)&&
        reservePoints>0&&Number.isSafeInteger(notBeforeMs)&&
        notBeforeMs>=0,'BOSS_ISOLATED_ADMISSION_INVALID');
      // Generic request admission sees the virtual A+B ledger. Subtract
      // exactly the witnessed immutable A cost by translating the cap.
      return {notBeforeMs,
        maxObservedPoints:originalSourcePoints+maxBossObservedPoints,
        reservePoints};
    }
  };
}
