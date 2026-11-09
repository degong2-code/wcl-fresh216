#!/usr/bin/env node
/**
 * ONE-SHOT, owner-approved eight-fight lean DamageDone cost+parity probe.
 * This is NOT a collector; one measured GraphQL operation, zero retries.
 * Frozen 24 witness values come from existing official parity evidence.
 *
 * Security: only isolated branch, exact request-only commit, SHA-pinned
 * code & gold, no environment secret in PR inputs, remote preflight marker
 * BEFORE any HTTP request, redacted aggregate receipt only.
 */
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {makeLeanBossTableQuery,compareLeanBossTable} from
  './lib/fresh216-lean-boss-table-query.mjs';

const REPO='degong2-code/wcl-fresh216';
const BRANCH='work/fresh216-lean-boss-measure-once-20261109';
const DIR='experiments/fresh216-lean-boss-measure-20261109';
const GOLD=DIR+'/GOLD.json';
const REQUEST=DIR+'/REQUEST.json';
const PREFLIGHT=DIR+'/PREFLIGHT.json';
const RESULT=DIR+'/RESULT.json';
const QUERY_CODE='tools/lib/fresh216-lean-boss-table-query.mjs';
const MESSAGE='chore(fresh216): authorize ONE lean boss table measurement (8 fights 24 actors)';
const MAX_POINTS=30;
const SAFE_HOURLY=3240;
const must=(ok,code)=>{if(!ok)throw Error(code)};
const git=(...a)=>execFileSync('git',a,{encoding:'utf8',timeout:45000,
  env:{...process.env,GIT_TERMINAL_PROMPT:'0'},
  stdio:['ignore','pipe','pipe']}).trim();
const shaBytes=b=>createHash('sha256').update(b).digest('hex');
const finite=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const safeError=e=>/^LEAN_(?:[A-Z0-9_]+)$/.test(e?.message??'')?
  e.message:'LEAN_TRANSPORT_PROCESSING_OR_STORAGE_UNCERTAIN';

function persist(file,record,description) {
 fs.writeFileSync(file,JSON.stringify(record,null,2)+'\n',{encoding:'utf8',
   flag:'wx',mode:0o600});
 git('add','--',file);
 git('-c','user.name=Fresh216 One-Shot Experiment',
   '-c','user.email=fresh216-bot@users.noreply.github.com',
   'commit','-m',description);
 git('push','origin','HEAD:refs/heads/'+BRANCH);
 must(git('ls-remote','origin','refs/heads/'+BRANCH).split(/\s+/)[0]===
   git('rev-parse','HEAD'),'LEAN_REMOTE_COMMIT_NOT_CONFIRMED');
}

function prepare(){
 const e=process.env,head=git('rev-parse','HEAD');
 must(e.GITHUB_ACTIONS==='true'&&e.GITHUB_REPOSITORY===REPO&&
   e.GITHUB_EVENT_NAME==='push'&&
   e.GITHUB_REF==='refs/heads/'+BRANCH&&
   e.GITHUB_RUN_ATTEMPT==='1'&&e.GITHUB_SHA===head,
   'LEAN_EXECUTION_CONTEXT_INVALID');
 must(git('show','-s','--format=%s','HEAD')===MESSAGE,
   'LEAN_OWNER_APPROVAL_COMMIT_MISSING');
 must(git('diff-tree','--no-commit-id','--name-status','-r','HEAD')===
   'A\t'+REQUEST,'LEAN_REQUEST_ONLY_COMMIT_REQUIRED');
 const req=JSON.parse(fs.readFileSync(REQUEST,'utf8'));
 must(req.schema===1&&req.kind==='FRESH216_LEAN_BOSS_MEASURE_8X24_V1'&&
   req.approved===true&&req.mode==='one-shot'&&
   req.maxWclGraphqlCalls===1&&req.maxObservedAppPoints===MAX_POINTS&&
   req.safeHourlyAppPoints===SAFE_HOURLY&&req.ref===BRANCH&&
   req.fights===8&&req.actors===24&&
   /^[a-f0-9]{40}$/.test(req.parentCommit)&&
   req.parentCommit===git('rev-parse','HEAD^'),
   'LEAN_EXPLICIT_APPROVAL_INVALID');
 must(req.goldGitBlobSha===git('hash-object',GOLD)&&
   req.codeGitBlobSha===git('hash-object',QUERY_CODE),
   'LEAN_PINNED_GOLD_OR_CODE_DRIFT');
 must(git('status','--porcelain','--untracked-files=all')===''&&
   !fs.existsSync(PREFLIGHT)&&!fs.existsSync(RESULT)&&
   git('ls-remote','origin','refs/heads/'+BRANCH).split(/\s+/)[0]===head,
   'LEAN_REPLAY_OR_DIRTY_REMOTE');
 must(typeof e.WCL_CLIENT_ID==='string'&&e.WCL_CLIENT_ID.length>0&&
   typeof e.WCL_CLIENT_SECRET==='string'&&e.WCL_CLIENT_SECRET.length>0,
   'LEAN_WCL_CREDENTIALS_UNAVAILABLE');
 const fixture=JSON.parse(fs.readFileSync(GOLD,'utf8'));
 must(fixture.schema===1&&
   fixture.kind==='FRESH216_LEAN_8FIGHT_24ACTOR_GOLD_V1'&&
   fixture.fights?.length===8&&fixture.targetRegistry?.length===8&&
   fixture.fights.reduce((n,f)=>n+f.expectedActors.length,0)===24,
   'LEAN_GOLD_FROZEN_SCOPE_INVALID');
 const plan=makeLeanBossTableQuery(fixture.fights,fixture.targetRegistry);
 must(plan.requestCount===1&&plan.namedTableFields===8&&
   plan.reportGroups===8&&
   (plan.query.match(/table\(dataType:DamageDone/g)??[]).length===8,
   'LEAN_QUERY_NOT_ONE_EIGHT_FIGHT_OPERATION');
 return {e,head,req,plan,fixture};
}

async function token(e) {
 const basic=Buffer.from(e.WCL_CLIENT_ID+':'+e.WCL_CLIENT_SECRET)
   .toString('base64');
 const r=await fetch('https://www.warcraftlogs.com/oauth/token',{
   method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),
   headers:{Authorization:'Basic '+basic,
     'Content-Type':'application/x-www-form-urlencoded'},
   body:'grant_type=client_credentials'
 });
 must(r.status===200,'LEAN_OAUTH_STATUS');
 const d=await r.json();
 must(typeof d?.access_token==='string'&&d.access_token.length>20,
   'LEAN_OAUTH_NO_TOKEN');
 return d.access_token;
}

async function main() {
 const {e,head,plan}=prepare();
 const pre={
   schema:1,status:'IN_FLIGHT',mode:'ONE_SHOT_ONE_GRAPHQL',
   requestHead:head,expected:{fights:8,actors:24,tables:8},
   bounds:{maxGraphqlCalls:1,maxObservedPoints:MAX_POINTS,
     safeHourlyAppPoints:SAFE_HOURLY},
   querySha256:plan.querySha256,rawResponsesPersisted:false,
   noBaselineRefetch:true,noCOrSheets:true
 };
 persist(PREFLIGHT,pre,'audit(fresh216): lean Boss table one-shot consumed BEFORE request');
 const final={
   schema:1,kind:'FRESH216_LEAN_BOSS_MEASURE_8X24_V1',
   status:'NEEDS_REVIEW',incident:null,
   preflightCommit:git('rev-parse','HEAD'),
   querySha256:plan.querySha256,
   attemptedWclGraphqlCalls:0,
   attemptedOauthExchanges:0,observedPoints:null,
   budget:{maxObservedPoints:MAX_POINTS,safeHourly:SAFE_HOURLY},
   output:null,appQuota:null,rawActorNamesSaved:false,
   rawResponsesSaved:false,noWclRetry:true,sheetsWrites:0,cPromotions:0,
   originalGoldUnmodified:true
 };
 try{
   final.attemptedOauthExchanges=1;
   const access=await token(e);
   const requestText=JSON.stringify({query:plan.query,variables:plan.variables});
   const start=performance.now();
   final.attemptedWclGraphqlCalls=1;
   const res=await fetch('https://www.warcraftlogs.com/api/v2/client',{
     method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),
     headers:{Authorization:'Bearer '+access,
       'Content-Type':'application/json'},body:requestText
   });
   const responseText=await res.text();
   const durationMs=Math.round(performance.now()-start);
   const bytes=Buffer.byteLength(responseText,'utf8');
   final.responseSha256=shaBytes(responseText);
   const response=JSON.parse(responseText);
   const outcome=compareLeanBossTable(plan,{httpStatus:res.status,
     body:response,wallMs:durationMs,bytes});
   final.output=outcome;
   final.observedPoints=outcome.points;
   const quota=response.data?.rateLimitData;
   final.appQuota={
     limitPerHour:finite(quota?.limitPerHour)?quota.limitPerHour:null,
     spentThisHour:finite(quota?.pointsSpentThisHour)?quota.pointsSpentThisHour:null
   };
   must(outcome.status==='EXACT_PARITY_PASS'&&outcome.exact===24&&
     outcome.missing===0&&outcome.mismatch===0,
     'LEAN_OFFICIAL_PARITY_FAIL');
   must(finite(outcome.points)&&outcome.points<=MAX_POINTS,
     'LEAN_POINT_BUDGET_EXCEEDED');
   must(finite(quota?.limitPerHour)&&quota.limitPerHour>=SAFE_HOURLY&&
     finite(quota?.pointsSpentThisHour)&&
     quota.pointsSpentThisHour<=SAFE_HOURLY,
     'LEAN_HOURLY_SAFETY_UNCONFIRMED');
   final.status='COMPLETED';
 }catch(err){
   final.status='NEEDS_REVIEW';
   final.incident=safeError(err);
 }
 persist(RESULT,final,'audit(fresh216): one-shot lean Boss table measured or review');
 console.log(JSON.stringify({
   status:final.status,incident:final.incident,
   WclGraphqlCalls:final.attemptedWclGraphqlCalls,
   observedPoints:final.observedPoints,appQuota:final.appQuota,
   output:final.output,
   preflightCommit:final.preflightCommit,
   sheetsWrites:0,originalGoldUnmodified:true
 }));
 if(final.status!=='COMPLETED')process.exitCode=2;
}

try{await main()}catch(e){
 console.error(safeError(e));process.exitCode=1;
}
