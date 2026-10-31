#!/usr/bin/env node
/**
 * Read-only replay of the pinned private Fresh216 C base + append-only delta
 * chain using the PR21 appender and exact A/priority source. This script has
 * no WCL, OAuth, Git write, archive write, C append, or Sheets code path.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {
  SOURCE_SHA256,BASE_UNION_SHA256,shaBytes,shaObject
} from './lib/fresh216-c-delta.mjs';
import {createFresh216ArchiveCDeltaAppender}
  from './lib/fresh216-archive-c-delta.mjs';
import {derivePinnedFresh216SourceSlots}
  from '../src/adapters/private-fresh-cohort-host.mjs';
import {deriveFresh216PriorityByKey}
  from '../src/adapters/fresh216-priority-map.mjs';

const need=(value,code)=>{if(!value)throw Error(code);};
const SCOPE='heroic:2026-10-22_27:latest:source';
const PIN={
  source:'39573a118f2a57f9dc6758936e9d73e9aa6cebf5',
  candidate:'d56befacce6ff8062878ed3a4edec6a55cd91b07',
  report20:'0d6d00e53b240eccb4977a8d70e625072a557a7a',
  report80:'20d13c718b70f1adfce1216b81f518733f11687c',
  report1000:'7ec1e48f9bafa205026c89a8b9aad5809835b32a',
  reportRemaining:'5b302ee00483c1415fa9c3c73df43e8ac4f89dc1',
  plan:'811c4e67878f9b70e420fccb4ecf84301d211223',
  productBaseline:'8bb96e64add3703a9c9d60c973754943b64d57be'
};
const FILE={
  source:'projects/wcl-fresh216/private-source/fresh216-checkpoint.json',
  base:'projects/wcl-fresh216/derived-c-v1/union-c-v1.json.br',
  deltas:'projects/wcl-fresh216/c-deltas-v1',
  plan:'projects/wcl-fresh216/recovery-priority-v1/ordered-fights-v1.json.br',
  reportRemaining:'projects/wcl-fresh216/batch-checkpoints/report-remaining-v1'
};
const PLAN_SHA256='441afb137c70bf9b70911eece8e056229a96ed242a187023c79d277098218c5a';
const PLAN_PLAINTEXT_SHA256='bb7f5653cf0af5f222bac2d85be57334ced4d5b0b05bfa82ad12c23c565958af';
const SOURCE_BLOB_SHA='780afe4498adc07c1477021d4d41a5792972a431';
const BASE_BLOB_SHA='0875784cf74ad1de48165e705be1036b93824e23';
const PLAN_BLOB_SHA='89d43e811b3125bf13844e8c0760859856916f07';
const REPORT_BATCHES=195;
const REPORT_COMMITS=[
  PIN.report20,PIN.report80,PIN.report1000,PIN.reportRemaining
].sort();

const [sourceRoot,deltaRoot,report20Root,report80Root,
  report1000Root,reportRemainingRoot,planRoot,
  productBaselineRoot,productCurrentRoot]=process.argv.slice(2);
const roots=[
  sourceRoot,deltaRoot,report20Root,report80Root,report1000Root,
  reportRemainingRoot,planRoot,productBaselineRoot,productCurrentRoot
];
need(roots.length===9&&roots.every(x=>typeof x==='string'&&path.isAbsolute(x)),
  'FRESH216_CDELTA_AUDIT_ROOTS_INVALID');
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{
  encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:20000
}).trim();
const assertRoot=(root,expected,code)=>{
  need(git(root,'rev-parse','HEAD')===expected,code+'_HEAD_DRIFT');
  need(git(root,'status','--porcelain','--untracked-files=all')==='',
    code+'_WORKTREE_DIRTY');
};
assertRoot(sourceRoot,PIN.source,'FRESH216_CDELTA_SOURCE');
assertRoot(deltaRoot,PIN.candidate,'FRESH216_CDELTA_CANDIDATE');
assertRoot(report20Root,PIN.report20,'FRESH216_CDELTA_REPORT20');
assertRoot(report80Root,PIN.report80,'FRESH216_CDELTA_REPORT80');
assertRoot(report1000Root,PIN.report1000,'FRESH216_CDELTA_REPORT1000');
assertRoot(reportRemainingRoot,PIN.reportRemaining,'FRESH216_CDELTA_REPORT_REMAINING');
assertRoot(planRoot,PIN.plan,'FRESH216_CDELTA_PLAN');
assertRoot(productBaselineRoot,PIN.productBaseline,'FRESH216_CDELTA_PRODUCT_BASELINE');
const currentProductHead=process.env.GITHUB_SHA;
need(typeof currentProductHead==='string'&&/^[a-f0-9]{40}$/.test(currentProductHead),
  'FRESH216_CDELTA_CURRENT_PRODUCT_SHA_MISSING');
assertRoot(productCurrentRoot,currentProductHead,'FRESH216_CDELTA_PRODUCT_CURRENT');

need(git(sourceRoot,'rev-parse','HEAD:'+FILE.source)===SOURCE_BLOB_SHA,
  'FRESH216_CDELTA_SOURCE_BLOB_DRIFT');
need(git(deltaRoot,'rev-parse','HEAD:'+FILE.base)===BASE_BLOB_SHA,
  'FRESH216_CDELTA_BASE_BLOB_DRIFT');
need(git(planRoot,'rev-parse','HEAD:'+FILE.plan)===PLAN_BLOB_SHA,
  'FRESH216_CDELTA_PLAN_BLOB_DRIFT');
for(const module of [
  'src/core/fresh-cohort-source.mjs',
  'src/core/fresh-boss-first-page.mjs'
]){
  need(git(productBaselineRoot,'rev-parse','HEAD:'+module)===
    git(productCurrentRoot,'rev-parse','HEAD:'+module),
    'FRESH216_CDELTA_SOURCE_MODULE_DRIFT');
}
const sourceState=JSON.parse(fs.readFileSync(
  path.join(sourceRoot,FILE.source),'utf8'));
need(sourceState.schema===1&&sourceState.version===0&&
  sourceState.scopeKey===SCOPE&&
  shaObject(sourceState.sourceRequests)===SOURCE_SHA256,
  'FRESH216_CDELTA_A_SOURCE_INVALID');
const sourceModule=await import(pathToFileURL(path.join(
  productBaselineRoot,'src/core/fresh-cohort-source.mjs')).href);
const sourceSlots=derivePinnedFresh216SourceSlots({
  sourceState,expectedSourceSha256:SOURCE_SHA256,expectedScopeKey:SCOPE,
  sourceExporter:sourceModule.exportVerifiedFreshCohort
});
need(sourceSlots.length===21600,'FRESH216_CDELTA_A_SLOT_COUNT');

const firstPageModule=await import(pathToFileURL(path.join(
  productBaselineRoot,'src/core/fresh-boss-first-page.mjs')).href);
const jobs=firstPageModule.planFreshBossFirstPages(sourceSlots)
  .batches.flatMap(batch=>batch.jobs);
need(jobs.length===216,'FRESH216_CDELTA_JOB_COUNT');

const planBytes=fs.readFileSync(path.join(planRoot,FILE.plan));
need(shaBytes(planBytes)===PLAN_SHA256,'FRESH216_CDELTA_PLAN_COMPRESSED_SHA');
const planPlain=zlib.brotliDecompressSync(planBytes);
need(shaBytes(planPlain)===PLAN_PLAINTEXT_SHA256,
  'FRESH216_CDELTA_PLAN_PLAINTEXT_SHA');
const priorityPlan=JSON.parse(planPlain.toString('utf8'));
need(priorityPlan.totals?.sourceSlots===21600&&
  priorityPlan.totals?.proven===18829&&
  priorityPlan.totals?.namedMissing===2432&&
  priorityPlan.totals?.maskedMissing===339&&
  priorityPlan.totals?.fightsByReportFight===2256&&
  priorityPlan.totals?.safePriorityGroups===2256&&
  priorityPlan.unionCompressedSha256===BASE_UNION_SHA256,
  'FRESH216_CDELTA_PLAN_SCOPE_DRIFT');
const priorityByKey=deriveFresh216PriorityByKey({priorityPlan,sourceSlots});
need(priorityByKey.size===2432,'FRESH216_CDELTA_PRIORITY_MAP_COUNT');

const candidateRoot=deltaRoot;
const baseBytes=fs.readFileSync(path.join(candidateRoot,FILE.base));
need(shaBytes(baseBytes)===BASE_UNION_SHA256,'FRESH216_CDELTA_BASE_COMPRESSED_SHA');
const deltaDirectory=path.join(candidateRoot,FILE.deltas);
const reportHeads={
  report20:git(report20Root,'rev-parse','HEAD'),
  report80:git(report80Root,'rev-parse','HEAD'),
  report1000:git(report1000Root,'rev-parse','HEAD'),
  reportRemaining:git(reportRemainingRoot,'rev-parse','HEAD')
};
const sortedReportHeads=Object.values(reportHeads).sort();

const delta20=JSON.parse(fs.readFileSync(path.join(deltaDirectory,
  'delta20-receipt.json'),'utf8'));
const report80=JSON.parse(fs.readFileSync(path.join(deltaDirectory,
  'report21to100-delta-receipt.json'),'utf8'));
const report1000=JSON.parse(fs.readFileSync(path.join(deltaDirectory,
  'report1000pt-delta-receipt.json'),'utf8'));
const reportRemaining=JSON.parse(fs.readFileSync(path.join(deltaDirectory,
  'report-remaining-delta-receipt.json'),'utf8'));
need(delta20.sourceReportCommit===reportHeads.report20&&delta20.partCount===2&&
  delta20.overlayRows===18849,'FRESH216_CDELTA_REPORT20_RECEIPT_DRIFT');
need(report80.reportStateCommit===reportHeads.report80&&
  report80.newDeltaFiles?.length===9&&report80.nextDeltaIndex===11&&
  report80.cAfter===18947,'FRESH216_CDELTA_REPORT80_RECEIPT_DRIFT');
need(report1000.reportCommit===reportHeads.report1000&&
  report1000.newParts?.length===25&&report1000.totalExactC===19339,
  'FRESH216_CDELTA_REPORT1000_RECEIPT_DRIFT');
need(reportRemaining.reportCommit===reportHeads.reportRemaining&&
  reportRemaining.newParts?.length===195&&
  reportRemaining.addedExactC===1913&&reportRemaining.totalExactC===21252,
  'FRESH216_CDELTA_REPORT_REMAINING_RECEIPT_DRIFT');
const reportBatchDir=path.join(reportRemainingRoot,FILE.reportRemaining);
const reportBatchCount=fs.readdirSync(reportBatchDir).filter(name=>
  /^batch-\d{4}\.json\.br$/.test(name)).length;
need(reportBatchCount===REPORT_BATCHES,'FRESH216_CDELTA_REPORT_BATCH_COUNT');

let commitLookupCalls=0;
const appender=createFresh216ArchiveCDeltaAppender({
  sourceSlots,baseCompressedBytes:baseBytes,deltaDirectory,priorityByKey,
  getReportStateCommit:async()=>{
    commitLookupCalls++;
    throw Error('FRESH216_CDELTA_READONLY_AUDIT_APPEND_FORBIDDEN');
  }
});
const snapshot=appender.snapshot();
const reportStateCommits=appender.reportStateCommits();
const uy=appender.countExactUy(jobs);
const uyTotal=Object.values(uy).reduce((sum,value)=>sum+value,0);
need(snapshot.totalExactC===21252&&snapshot.deltaCount===231&&
  snapshot.applied===2423&&
  snapshot.lastDeltaSha256===reportRemaining.lastDeltaSha256,
  'FRESH216_CDELTA_REAL_CHAIN_REPLAY_DRIFT');
need(JSON.stringify(reportStateCommits)===JSON.stringify(sortedReportHeads),
  'FRESH216_CDELTA_REPORT_STATE_COMMITS_DRIFT');
need(uy.rank1===208&&uy.rank30===212&&uy.rank100===212&&
  uy.mean30===139&&uy.mean100===90&&uyTotal===861,
  'FRESH216_CDELTA_REAL_UY_DRIFT');
need(commitLookupCalls===0,'FRESH216_CDELTA_READONLY_CALLBACK_INVOKED');

for(const [root,expected,code] of [
  [sourceRoot,PIN.source,'FRESH216_CDELTA_SOURCE'],
  [deltaRoot,PIN.candidate,'FRESH216_CDELTA_CANDIDATE'],
  [report20Root,PIN.report20,'FRESH216_CDELTA_REPORT20'],
  [report80Root,PIN.report80,'FRESH216_CDELTA_REPORT80'],
  [report1000Root,PIN.report1000,'FRESH216_CDELTA_REPORT1000'],
  [reportRemainingRoot,PIN.reportRemaining,'FRESH216_CDELTA_REPORT_REMAINING'],
  [planRoot,PIN.plan,'FRESH216_CDELTA_PLAN'],
  [productBaselineRoot,PIN.productBaseline,'FRESH216_CDELTA_PRODUCT_BASELINE'],
  [productCurrentRoot,currentProductHead,'FRESH216_CDELTA_PRODUCT_CURRENT']
])assertRoot(root,expected,code);

const receipt={
  result:'FRESH216_PRIVATE_CDELTA_INPUTS_READONLY_PASS',
  sourceSlots:sourceSlots.length,baseRows:18829,
  deltaParts:snapshot.deltaCount,applied:snapshot.applied,
  totalExactC:snapshot.totalExactC,
  priorityGroups:priorityPlan.orderedFightGroups.length,
  prioritySlots:priorityByKey.size,
  reportStateCommits:reportStateCommits.length,
  reportBatchFiles:reportBatchCount,
  exactUy:uy,exactUyTotal:uyTotal,
  reportStateCommitLookupCalls:commitLookupCalls,
  wclGraphqlCalls:0,oauthCalls:0,observedPoints:0,
  cDeltaAppends:0,canonicalPromotions:0,sheetsWrites:0,repositoryWrites:0
};
process.stdout.write(JSON.stringify(receipt)+'\n');
