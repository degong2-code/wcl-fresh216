#!/usr/bin/env node
/**
 * PUBLIC exact multi-boss-cost experiment: does one DamageDone filterExpression
 * target.id IN (three confirmed boss actor IDs) equal official BossDPS?
 * Public fight 10, encounter 3122 in wyCNP6db8FrxG7gk; no private inputs.
 * No raw actors/names/damage data persisted.
 */
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
const BRANCH='work/public-runner-effexp-20261030';
const CODE='wyCNP6db8FrxG7gk',FIGHT=10,ENCOUNTER=3122;
const DIR='pilot-evidence/20261030-multiboss-gameid-filter';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const good=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const need=(x,msg)=>{if(!x)throw Error(msg)};
const git=(...args)=>execFileSync('git',args,{
 encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe'],
 env:{...process.env,GIT_TERMINAL_PROMPT:'0'}
}).trim();
const file=(index,stage)=>DIR+'/'+String(index).padStart(2,'0')+'.'+stage+'.json';
function write(index,stage,x){
 const f=file(index,stage);
 fs.mkdirSync(DIR,{recursive:true});need(!fs.existsSync(f),'MULTI_ALREADY_ATTEMPTED');
 fs.writeFileSync(f,JSON.stringify(x,null,2)+'\n',{flag:'wx'});
 git('add','--',f);
 git('-c','user.name=Fresh216-Public-MultiBoss',
  '-c','user.email=multi-boss@users.noreply.github.com',
  'commit','-m','experiment: public multi-boss target filter '+index+' '+stage);
 git('push','origin','HEAD:refs/heads/'+BRANCH);
}
function rate(body){
 let c=body?.data?.rateLimitData?.currentRequest;
 if(typeof c==='string'){try{c=JSON.parse(c)}catch{c=null}}
 const d=body?.data?.rateLimitData;
 return {points:good(c?.total)?c.total:null,
  spent:good(d?.pointsSpentThisHour)?d.pointsSpentThisHour:null,
  limit:good(d?.limitPerHour)?d.limitPerHour:null};
}
const q0={query:'query($code:String!,$f:Int!){rateLimitData{currentRequest limitPerHour pointsSpentThisHour} reportData{report(code:$code){code revision fights(fightIDs:[$f]){id encounterID difficulty kill startTime endTime enemyNPCs{id}} masterData{actors{id gameID type subType}}}}}',
 variables:{code:CODE,f:FIGHT}};
const summaryFirst=body=>{
 const report=body?.data?.reportData?.report;
 need(report?.code===CODE&&Number.isInteger(report.revision),'MULTI_REPORT_CODE');
 const fights=report.fights?.filter(x=>x.id===FIGHT);
 need(fights?.length===1&&fights[0].encounterID===ENCOUNTER&&fights[0].difficulty===1&&fights[0].kill,
  'MULTI_PUBLIC_FIGHT');
 const fight=fights[0],present=new Set(fight.enemyNPCs?.map(x=>x.id));
 const ids=report.masterData?.actors?.filter(x=>x.type==='NPC'&&
  String(x.subType).toLowerCase()==='boss'&&present.has(x.id)).map(x=>Number(x.gameID));
 need(ids?.length===3&&ids.every(x=>Number.isInteger(x)&&x>0),'MULTI_EXPECT_THREE_BOSSES');
 need(fight.endTime>fight.startTime,'MULTI_DURATION');
 return {ids,revision:report.revision,duration:(fight.endTime-fight.startTime)/1000};
};
const actor=(x)=>String(x?.name??'').trim().toLowerCase();
function compare(body,previous){
 need(!Array.isArray(body?.errors)||!body.errors.length,'MULTI_GRAPHQL_REJECTED');
 const r=body?.data?.reportData?.report;
 need(r?.code===CODE&&r.revision===previous.revision,'MULTI_REPORT_REVISION');
 const boss=r.b?.data?.filter(x=>x.fightID===FIGHT);
 need(boss?.length===1,'MULTI_RANKINGS_SHAPE');
 const ranked=boss[0].roles?.dps?.characters;
 const entries=r.damage?.data?.entries;
 need(Array.isArray(ranked)&&ranked.length>0&&Array.isArray(entries),'MULTI_TABLE_SHAPE');
 let compared=0,exact=0,near=0,max=0;
 for(const char of ranked){
  // Exact actor name fallback is uniquely validated inside this public fight.
  const matches=entries.filter(x=>actor(x)===actor(char));
  if(matches.length!==1)continue;
  const row=matches[0];const damage=Number(row.total);
  if(!good(damage)||!good(Number(char.amount)))continue;
  const diff=Math.abs(damage/previous.duration-Number(char.amount));
  compared++;if(diff<=0.005)exact++;if(diff<=1)near++;
  max=Math.max(max,diff);
 }
 return {encounterID:ENCOUNTER,publicFight:FIGHT,bossActors:previous.ids.length,
  rankedPlayers:ranked.length,tableEntries:entries.length,
  compared,exact0005:exact,within1:near,maxAbsDps:max,
  comparisonFormula:'table.total / full fight duration vs official bossdps',
  noPlayerDataPersisted:true};
}
function q1(ids){
 return {query:'query($code:String!,$f:Int!,$expr:String!){rateLimitData{currentRequest limitPerHour pointsSpentThisHour} reportData{report(code:$code){code revision b:rankings(fightIDs:[$f],playerMetric:bossdps) damage:table(dataType:DamageDone,fightIDs:[$f],viewBy:Source,filterExpression:$expr)}}}',
  variables:{code:CODE,f:FIGHT,expr:'target.id IN ('+ids.join(',')+')'}};
}
async function main(){
 const mode=process.argv[2];
 need(['--preflight','--collect'].includes(mode),'MULTI_MODE');
 need(process.env.GITHUB_REPOSITORY==='degong2-code/wcl-fresh216'&&
  git('branch','--show-current')===BRANCH,'MULTI_PUBLIC_ONLY');
 if(mode==='--preflight'){
  need(!fs.existsSync(file(0,'start')),'MULTI_ALREADY_STARTED');
  console.log(JSON.stringify({result:'PUBLIC_MULTIBOSS_FILTER_PREFLIGHT_PASS',
   previousPublicBossActorCount:3,publicFight:10,maxPilotPoints:24,
   apiCalls:0,privateData:false}));return;
 }
 need(process.env.FRESH216_MULTIBOSS_APPROVED==='true'&&
  process.env.GITHUB_REF==='refs/heads/'+BRANCH&&
  process.env.GITHUB_RUN_ATTEMPT==='1'&&process.env.GITHUB_EVENT_NAME==='push'&&
  process.env.WCL_CLIENT_ID&&process.env.WCL_CLIENT_SECRET,'MULTI_AUTH_REQUIRED');
 need(!fs.existsSync(file(0,'start')),'MULTI_NO_PAID_RETRY');
 const auth=await fetch('https://www.warcraftlogs.com/oauth/token',{
  method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),
  headers:{Authorization:'Basic '+Buffer.from(process.env.WCL_CLIENT_ID+':'+process.env.WCL_CLIENT_SECRET).toString('base64'),
   'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials'});
 need(auth.status===200,'MULTI_OAUTH_NOT_200');
 const token=(await auth.json()).access_token;
 need(typeof token==='string'&&token,'MULTI_TOKEN');
 let cost=0,quotaLast=null;
 async function step(index,query,interpret){
  write(index,'start',{schema:1,status:'IN_FLIGHT',querySha256:hash(query)});
  let http=null,body=null;const start=performance.now();
  try{
   http=await fetch('https://www.warcraftlogs.com/api/v2/client',{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify(query)});body=await http.json();
  }catch{}
  const r=rate(body);
  let value=null,verification='UNVERIFIED';
  if(http?.status===200&&body?.data&&(!Array.isArray(body.errors)||!body.errors.length)){
   try{value=interpret(body);verification='VALID'}catch(e){
    verification=/^MULTI_/.test(e.message)?e.message:'MULTI_INVALID_RESPONSE';
   }
  }
  const receipt={schema:1,status:'FINAL',querySha256:hash(query),
   observedPoints:r.points,httpStatus:http?.status??null,
   elapsedMs:Math.round(performance.now()-start),verification,
   bodySha256:body?hash(body):null,
   // Store only summary; boss IDs and personal actors NEVER persist.
   result:verification==='VALID'&&(index===1)?value:null,
   publicOnly:true,rawActorsPersisted:false};
  write(index,'done',receipt);
  if(r.points!=null)cost+=r.points;
  quotaLast=r;
  return {value,verification,points:r.points};
 }
 const first=await step(0,q0,summaryFirst);
 if(first.verification!=='VALID'||first.points==null||first.points>8||
  quotaLast?.spent==null||quotaLast?.limit==null||
  quotaLast.spent+16>Math.min(3200,Math.floor(quotaLast.limit*.9))){
  console.log(JSON.stringify({result:'PUBLIC_MULTIBOSS_STOP_AT_METADATA',
   observedPoints:cost,verification:first.verification}));return;
 }
 const second=await step(1,q1(first.value.ids),
  body=>compare(body,first.value));
 console.log(JSON.stringify({result:'PUBLIC_MULTIBOSS_FILTER_PILOT_DONE',
  totalObservedPoints:cost,metaPoints:first.points,filterRequestPoints:second.points,
  filterVerification:second.verification,comparison:second.value,
  publicOnly:true,privateCReads:0,sheetsWrites:0,methodPromoted:false}));
}
try{await main()}catch(e){
 console.error(/^MULTI_/.test(e.message)?e.message:'MULTI_REVIEW_REQUIRED');
 process.exitCode=1;
}
