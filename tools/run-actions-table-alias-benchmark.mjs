#!/usr/bin/env node
/**
 * ONE-SHOT live WCL PUBLIC-only DamageDone table alias experiment.
 * Same 8 logical table fields: 8x1, 4x2, 2x4, 1x8 calls (15 paid table calls).
 * 1 metadata call, 1 quota call. No private A, raw actor files, retries or Sheets.
 */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {PUBLIC_FIGHTS,SIZES,makeMetadataQuery,parseMetadata,
  packTableAliases,summarizeTableAliases,comparePackedVariants,observedPoints
} from './lib/fresh216-public-table-alias-core.mjs';

const B='work/fresh216-damage-table-alias-benchmark-20261109';
const P='experiments/fresh216-table-alias-benchmark-20261109/';
const MSG='chore(fresh216): authorize bounded public DamageDone alias benchmark';
const REQUEST=P+'REQUEST.json';
const FAIL='TABLE_ALIAS_BENCHMARK';
const good=(x,code)=>{if(!x)throw Error(FAIL+'_'+code);};
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',
  stdio:['ignore','pipe','pipe'],timeout:35000,
  env:{...process.env,GIT_TERMINAL_PROMPT:'0'}}).trim();
const sha40=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const number=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
const sanitize=e=>/^TABLE_ALIAS_BENCHMARK_[A-Z0-9_]+$/.test(e?.message??'')?
  e.message:'TABLE_ALIAS_BENCHMARK_API_OR_PROCESSING_UNCERTAIN';

function verifyContext(req){
 const e=process.env,head=git('rev-parse','HEAD');
 good(e.GITHUB_ACTIONS==='true'&&
   e.GITHUB_REPOSITORY==='degong2-code/wcl-fresh216'&&
   e.GITHUB_EVENT_NAME==='push'&&e.GITHUB_REF==='refs/heads/'+B&&
   e.GITHUB_SHA===head&&e.GITHUB_RUN_ATTEMPT==='1'&&
   e.FRESH216_BENCH_MESSAGE===MSG,'CONTEXT');
 good(git('diff-tree','--no-commit-id','--name-only','-r','HEAD')===
   REQUEST,'REQUEST_ONLY_COMMIT');
 good(sha40(req?.parentCommit)&&req.parentCommit===
   git('rev-parse','HEAD^')&&req.schema===1&&
   req.kind==='TABLE_ALIAS_1_2_4_8_PUBLIC_V1'&&
   req.mode==='one-shot'&&req.approved===true&&
   req.maxWclCalls===17&&req.maxTableCalls===15&&
   req.maxObservedPoints===100&&req.minAppHeadroom===180&&
   req.saveRawActorData===false&&
   req.source==='PUBLIC_FIXTURE_ONLY','OWNER_GATE');
 good(!fs.existsSync(P+'PREFLIGHT.json')&&
   !fs.existsSync(P+'RESULT.json')&&
   git('ls-remote','origin','refs/heads/'+B).split('\t')[0]===head,
   'EXISTING_ATTEMPT_OR_REMOTE_REF_CHANGED');
 good(git('status','--porcelain','--untracked-files=all')==='',
   'DIRTY_CHECKOUT');
 good(e.WCL_CLIENT_ID&&e.WCL_CLIENT_SECRET,'CREDENTIALS_UNAVAILABLE');
 return head;
}
function persist(file,doc,message){
 fs.mkdirSync(path.dirname(file),{recursive:true});
 fs.writeFileSync(file,JSON.stringify(doc,null,2)+'\n',{flag:'wx',mode:0o600});
 git('add','--',file);
 git('-c','user.name=Fresh216 Public Query Pilot',
   '-c','user.email=fresh216-pilot@users.noreply.github.com',
   'commit','-m',message);
 git('push','origin','HEAD:refs/heads/'+B);
 good(git('ls-remote','origin','refs/heads/'+B).split('\t')[0]===
   git('rev-parse','HEAD'),'REMOTE_COMMIT_NOT_CONFIRMED');
}
async function getToken(){
 const authorization=Buffer.from(process.env.WCL_CLIENT_ID+':'+
   process.env.WCL_CLIENT_SECRET).toString('base64');
 const r=await fetch('https://www.warcraftlogs.com/oauth/token',{
   method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),
   headers:{Authorization:'Basic '+authorization,
     'Content-Type':'application/x-www-form-urlencoded'},
   body:'grant_type=client_credentials'});
 good(r.status===200,'OAUTH_STATUS');
 const data=await r.json();
 good(typeof data?.access_token==='string'&&data.access_token.length>0,
   'OAUTH_TOKEN');
 return data.access_token;
}
async function query(token,request){
 const started=performance.now();
 const r=await fetch('https://www.warcraftlogs.com/api/v2/client',{
   method:'POST',redirect:'error',signal:AbortSignal.timeout(45000),
   headers:{Authorization:'Bearer '+token,
     'Content-Type':'application/json'},
   body:JSON.stringify(request)});
 const body=await r.json();
 return {httpStatus:r.status,body,
   wallMs:Math.round(performance.now()-started),
   bytes:Buffer.byteLength(JSON.stringify(body))};
}
const rate={query:'query Fresh216PublicTableAliasQuota{rateLimitData'+
 '{currentRequest limitPerHour pointsSpentThisHour pointsResetIn databaseLimitPerHour}}',
 variables:{}};
async function main(){
 const req=JSON.parse(fs.readFileSync(REQUEST,'utf8'));
 const head=verifyContext(req);
 const preflight={schema:1,status:'IN_FLIGHT',source:'PUBLIC_FIXTURE_ONLY',
   requestHead:head,baseCommit:req.parentCommit,
   expected:{quotaCalls:1,metadataCalls:1,tableCalls:15,
     tableFieldsPerVariant:8,aliasSizes:SIZES},
   budget:{maxCalls:17,maxObservedPoints:100,minAppHeadroom:180},
   noReplay:true,noPrivateData:true,sheetsWrites:0};
 persist(P+'PREFLIGHT.json',preflight,
   'audit(fresh216): public table alias pack pilot IN_FLIGHT');
 const final={schema:1,status:'NEEDS_REVIEW',preflightHead:head,
   source:'PUBLIC_FIXTURE_ONLY',attemptedWclCalls:0,
   observedPoints:0,costsVerified:false,noPrivateData:true,
   sheetsWrites:0,rawActorDataSaved:false,variants:[],incident:null};
 let spent=0;
 try{
   const token=await getToken();
   const q=await query(token,rate);
   final.attemptedWclCalls++;
   const probe=observedPoints(q.body);
   good(q.httpStatus===200&&(q.body?.errors==null||
     q.body.errors.length===0)&&number(probe.points),
     'QUOTA_RESPONSE');
   spent+=probe.points;
   const meter=q.body.data.rateLimitData;
   good(Number.isFinite(meter.limitPerHour)&&
     Number.isFinite(meter.pointsSpentThisHour)&&
     meter.limitPerHour-meter.pointsSpentThisHour>=
       req.minAppHeadroom,'APP_HEADROOM_LOW');
   final.quota={appLimit:meter.limitPerHour,
     appRemaining:meter.limitPerHour-meter.pointsSpentThisHour,
     dbLimitDisplayed:meter.databaseLimitPerHour,
     pointCost:probe.points};
   const m=await query(token,makeMetadataQuery());
   final.attemptedWclCalls++;
   const mp=observedPoints(m.body);
   good(m.httpStatus===200&&number(mp.points),
     'METADATA_HTTP_OR_COST_UNKNOWN');
   spent+=mp.points;
   const metadata=parseMetadata(m.body);
   final.metadata={pointCost:mp.points,wallMs:m.wallMs,
     bossTargets:PUBLIC_FIGHTS.map(f=>metadata[f.report+':'+f.fight].ids.length),
     reports:2,fights:4};
   const variants=[];
   for(const size of SIZES){
     const plans=packTableAliases(size,metadata),results=[];
     for(const plan of plans){
       good(final.attemptedWclCalls<req.maxWclCalls&&
         results.length+variants.reduce((n,v)=>n+v.results.length,0)<
           req.maxTableCalls,'WCL_CALL_BOUND');
       good(spent+18<=req.maxObservedPoints,
         'LOCAL_POINT_RESERVE_EXCEEDED');
       const raw=await query(token,plan);
       final.attemptedWclCalls++;
       const result=summarizeTableAliases(plan,metadata,raw);
       if(number(result.points))spent+=result.points;
       results.push(result);
       good(result.status==='MEASURED',result.status);
     }
     variants.push({size,results});
   }
   const comparison=comparePackedVariants(variants);
   final.status=comparison.allEqual?'COMPLETED':'NEEDS_REVIEW';
   final.incident=comparison.allEqual?null:
     'TABLE_ALIAS_BENCHMARK_CROSS_SHAPE_MISMATCH';
   final.variants=comparison.variants;
   final.overlaps=comparison.overlaps;
   final.overlapsEqual=comparison.overlapsEqual;
   final.observedPoints=Number(spent.toFixed(3));
   final.costsVerified=true;
   final.summary={sameEightDistinctTableFields:true,
     observedTableFields:32,metadataQueryCount:1,
     queryPacks:15,includesHeroic:true,usesGameIDBossFilter:true};
 }catch(e){
   final.status='NEEDS_REVIEW';final.incident=sanitize(e);
   final.observedPoints=Number(spent.toFixed(3));
 }
 persist(P+'RESULT.json',final,
   'audit(fresh216): final public table alias benchmark or review');
 console.log(JSON.stringify({status:final.status,incident:final.incident,
   observedPoints:final.observedPoints,WclCalls:final.attemptedWclCalls,
   metadata:final.metadata??null,variants:final.variants,
   overlaps:final.overlaps??0,overlapsEqual:final.overlapsEqual??0,
   rawActorDataSaved:false,source:final.source}));
 if(final.status!=='COMPLETED')process.exitCode=2;
}
const self=path.resolve(fileURLToPath(import.meta.url));
if(process.argv[1]&&path.resolve(process.argv[1])===self){
 try{await main()}catch(e){console.error(sanitize(e));process.exitCode=1;}
}