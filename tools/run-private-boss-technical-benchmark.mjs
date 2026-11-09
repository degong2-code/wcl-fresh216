#!/usr/bin/env node
/**
 * One owner-approved, four-query WCL BossDPS packing benchmark.
 * Runs ONLY on isolated private test branch under explicit message+pin.
 * One durable pre-HTTP Git preflight and one post-HTTP Git witness push.
 * No publication, A/B/C mutation, Sheets, retries or raw actors on disk.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {makePrivateWclTransport}
  from '../src/adapters/private-fresh-cohort-host.mjs';
import {makeFreshBossBenchmarkCases,
  summarizeFreshBossBenchmarkResponse,
  createBenchmarkPreflight,finishBenchmarkWave,
  planFullBossDepth2000TechnicalCardinality}
  from '../src/core/fresh-boss-technical-benchmark.mjs';

const need=(ok,code)=>{if(!ok)throw Error(code);};
const validSha=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{
  encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:45000,
  env:{...process.env,GIT_TERMINAL_PROMPT:'0'}
}).trim();
const BENCH_BRANCH='work/fresh216-boss-technical-benchmark-private-20261109';
const GOOD_MESSAGE='chore(fresh216): authorize one bounded BossDPS packing benchmark';
const RESULT='projects/wcl-fresh216/bench/RESULT.json';
export function validatePrivateBossTechnicalBenchmark({
  request,env=process.env,productHead,controlHead
}={}){
  need(env.GITHUB_ACTIONS==='true'&&
    env.GITHUB_REPOSITORY==='degong2-code/ai-project-lab'&&
    env.GITHUB_EVENT_NAME==='push'&&
    env.GITHUB_REF==='refs/heads/'+BENCH_BRANCH&&
    env.FRESH216_BENCH_TRIGGER_MESSAGE===GOOD_MESSAGE,
    'BOSS_BENCH_UNTRUSTED_ACTION_CONTEXT');
  need(request?.schema===1&&
    request.kind==='FRESH216_BOSS_TECHNICAL_BENCH_V1'&&
    request.approved===true&&request.mode==='one-shot-benchmark'&&
    request.productCommit===productHead&&validSha(productHead)&&
    request.controlCommit===controlHead&&validSha(controlHead)&&
    request.sourceHead==='0bb26d81aaac26a5090db34550476a81fc94c47a'&&
    Number.isSafeInteger(request.maxDataRequests)&&
    request.maxDataRequests===4&&
    Number.isSafeInteger(request.maxApplicationPoints)&&
    request.maxApplicationPoints===250&&
    Number.isSafeInteger(request.maxDatabasePoints)&&
    request.maxDatabasePoints===220&&
    request.metric==='bossdps'&&request.maxPage===2&&
    request.publishRawData===false,
    'BOSS_BENCH_OWNER_REQUEST_NOT_PINNED');
  return true;
}
const parseCurrent=c=>{
  if(typeof c==='string'){try{return JSON.parse(c);}catch{return null;}}
  return c;
};
const safeNum=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
export async function runPrivateBossTechnicalBenchmark({
  requestFile,controlRoot,env=process.env
}={}){
  need(path.isAbsolute(requestFile)&&path.isAbsolute(controlRoot),
    'BOSS_BENCH_ABSOLUTE_PATH_REQUIRED');
  const root=fs.realpathSync(controlRoot);
  need(fs.existsSync(requestFile)&&
    fs.realpathSync(requestFile)===path.join(root,
      'projects/wcl-fresh216/bench/REQUEST.json')&&
    fs.statSync(requestFile).size<4096,
    'BOSS_BENCH_REQUEST_FILE_INVALID');
  const request=JSON.parse(fs.readFileSync(requestFile,'utf8'));
  const productRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const productHead=git(productRoot,'rev-parse','HEAD');
  const controlHead=git(root,'rev-parse','HEAD');
  validatePrivateBossTechnicalBenchmark({
    request,env,productHead,controlHead
  });
  need(git(root,'symbolic-ref','--short','HEAD')===BENCH_BRANCH&&
    git(root,'status','--porcelain','--untracked-files=all')===''&&
    git(productRoot,'status','--porcelain','--untracked-files=all')===''&&
    /(?:^|[:/])degong2-code\/ai-project-lab(?:\.git)?$/.test(
      git(root,'remote','get-url','origin'))&&
    !fs.existsSync(path.join(root,RESULT)),
    'BOSS_BENCH_EXISTING_OR_UNTRUSTED_JOURNAL');
  need(env.WCL_CLIENT_ID&&env.WCL_CLIENT_SECRET,
    'BOSS_BENCH_SECRETS_UNAVAILABLE');
  const transport=await makePrivateWclTransport({
    clientId:env.WCL_CLIENT_ID,clientSecret:env.WCL_CLIENT_SECRET
  });
  const read=await transport({query:'query Fresh216BenchQuota { '+
    'rateLimitData {limitPerHour pointsSpentThisHour pointsResetIn '+
    'databaseLimitPerHour databasePointsSpentThisHour currentRequest}}',
    variables:{}});
  const q=read?.body?.data?.rateLimitData;
  const probe=parseCurrent(q?.currentRequest);
  need(read.httpStatus===200&&read.body.errors==null&&
    Number.isSafeInteger(q?.limitPerHour)&&
    safeNum(q?.pointsSpentThisHour)&&
    Number.isSafeInteger(q?.databaseLimitPerHour)&&
    safeNum(q?.databasePointsSpentThisHour)&&
    safeNum(probe?.total)&&probe.total>0,
    'BOSS_BENCH_QUOTA_UNAVAILABLE');
  const remainingApplication=q.limitPerHour-q.pointsSpentThisHour;
  const remainingDatabase=q.databaseLimitPerHour-
    q.databasePointsSpentThisHour;
  const quotaSummary={applicationLimit:q.limitPerHour,
    databaseLimit:q.databaseLimitPerHour,
    remainingApplication,remainingDatabase,
    resetSeconds:q.pointsResetIn,
    probePoints:probe.total};
  if(remainingApplication<request.maxApplicationPoints||
     remainingDatabase<request.maxDatabasePoints)
    return {status:'BENCHMARK_QUOTA_NOT_READY',...quotaSummary,
      paidDataRequests:0,gitCommits:0};
  const cases=makeFreshBossBenchmarkCases();
  need(cases.length===request.maxDataRequests&&
    cases.reduce((a,b)=>a+b.fieldCount,0)===198,
    'BOSS_BENCH_CASE_SCOPE_DRIFT');
  const prepared=createBenchmarkPreflight({
    cases,productCommit:productHead,sourceHead:request.sourceHead
  });
  prepared.quotaBefore=quotaSummary;
  const persist=(value,message)=>{
    const start=performance.now();
    const full=path.join(root,RESULT);
    fs.mkdirSync(path.dirname(full),{recursive:true,mode:0o700});
    fs.writeFileSync(full,JSON.stringify(value,null,2)+'\n',{mode:0o600});
    git(root,'config','user.name','Fresh216 CI Benchmark');
    git(root,'config','user.email','fresh216-benchmark@users.noreply.github.com');
    git(root,'add',RESULT);
    git(root,'commit','-m',message);
    git(root,'push','origin','HEAD:refs/heads/'+BENCH_BRANCH);
    return Math.round(performance.now()-start);
  };
  const preflightCommitMs=persist(prepared,
    'audit(fresh216): all four charged benchmark queries preflight IN_FLIGHT');
  const observations=[];
  for(const c of cases){
    let r=null,raw=null;
    const start=performance.now();
    try{
      r=await transport({query:c.query,variables:c.variables});
      raw=summarizeFreshBossBenchmarkResponse(c,{
        httpStatus:r?.httpStatus,body:r?.body,
        wallMs:Math.round(performance.now()-start)
      });
    }catch{
      raw={name:c.name,status:'TRANSPORT_UNCERTAIN',points:null,
        databasePoints:null,wallMs:Math.round(performance.now()-start),
        fields:c.fieldCount,rowCount:null,details:[]};
    }
    observations.push(raw);
    if(raw.status!=='MEASURED')break;
  }
  const witnessed=observations.length===4&&
    observations.every(o=>o.status==='MEASURED');
  const safeObservations=observations.map(o=>({
    name:o.name,status:o.status,fields:o.fields,
    points:o.points,databasePoints:o.databasePoints,
    wallMs:o.wallMs,rowCount:o.rowCount,
    perFieldPoints:o.perFieldPoints??null
  }));
  let final;
  if(witnessed){
    final=finishBenchmarkWave(prepared,observations);
  }else{
    final=structuredClone(prepared);
    final.status='NEEDS_REVIEW';
    final.attempts=final.attempts.map((a,i)=>{
      const m=observations[i];
      return m?{...a,status:m.status==='MEASURED'?
        'COMPLETED':'NEEDS_REVIEW',
        observedPoints:m.points,
        observedDatabasePoints:m.databasePoints,
        wallMs:m.wallMs,errorCode:m.status==='MEASURED'?null:m.status}:
        {...a,status:'NEEDS_REVIEW',
          errorCode:'PREDECLARED_BUT_NOT_ATTEMPTED_REVIEW_REQUIRED'};
    });
  }
  final.results=safeObservations;
  final.fieldsPerCall=cases.map(c=>c.fieldCount);
  final.fullDepth2000Plan=planFullBossDepth2000TechnicalCardinality();
  final.crossShapeComparisons=[];
  if(witnessed){
    const reference=new Map();
    for(const r of observations){
      for(const d of r.details){
        const key=JSON.stringify([d.encounterId,d.className,
          d.specName,d.page]);
        if(!reference.has(key))reference.set(key,d.sha256);
        else final.crossShapeComparisons.push({
          kind:'SAME_BOSS_SPEC_PAGE',
          equal:reference.get(key)===d.sha256
        });
      }
    }
  }
  final.observedDataPoints=safeObservations.reduce(
    (n,o)=>n+(o.points??0),0);
  final.observedDatabasePoints=safeObservations.reduce(
    (n,o)=>n+(o.databasePoints??0),0);
  final.probePoints=probe.total;
  final.preflightCommitMs=preflightCommitMs;
  const finalCommitMs=persist(final,
    'audit(fresh216): finalized four-query benchmark witness or review');
  return {
    status:final.status,
    ...quotaSummary,
    paidDataRequests:observations.length,
    fields:cases.reduce((n,c)=>n+c.fieldCount,0),
    observedDataPoints:final.observedDataPoints,
    observedDatabasePoints:final.observedDatabasePoints,
    recordedQueryShapes:safeObservations,
    overlapComparisons:final.crossShapeComparisons.length,
    overlapsEqual:final.crossShapeComparisons.filter(x=>x.equal).length,
    gitCommits:2,preflightCommitMs,finalCommitMs,
    fullDepth2000Plan:final.fullDepth2000Plan,
    rawRecordsPublished:0,automaticRetries:0
  };
}
const entry=path.resolve(fileURLToPath(import.meta.url));
if(process.argv[1]&&path.resolve(process.argv[1])===entry){
  try{
    need(process.argv.length===4,'BOSS_BENCH_ARGS_REQUIRED');
    const result=await runPrivateBossTechnicalBenchmark({
      requestFile:path.resolve(process.argv[2]),
      controlRoot:path.resolve(process.argv[3])
    });
    console.log(JSON.stringify(result));
    if(result.status!=='COMPLETED'&&
      result.status!=='BENCHMARK_QUOTA_NOT_READY')
      process.exitCode=2;
  }catch(e){
    console.error(/^BOSS_BENCH_[A-Z0-9_]+$/.test(e?.message??'')?
      e.message:'BOSS_BENCH_UNCERTAIN_REVIEW_REQUIRED');
    process.exitCode=1;
  }
}
