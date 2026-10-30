#!/usr/bin/env node
/** Public HEROIC report discovery using only explicitly public WCL guild logs.
 * Guild list itself is public: https://www.warcraftlogs.com/guild/reports-list/818162
 * No user/private ranked cohort, no raw combat data or player names persisted.
 */
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const BRANCH='work/public-runner-effexp-20261030';
const DIR='pilot-evidence/20261030-heroic-discovery';
const need=(b,s)=>{if(!b)throw Error(s)};
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const git=(...a)=>execFileSync('git',a,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}}).trim();
const file=(i,stage)=>DIR+'/'+String(i).padStart(2,'0')+'.'+stage+'.json';
function put(i,stage,d){
 const path=file(i,stage);
 fs.mkdirSync(DIR,{recursive:true});
 need(!fs.existsSync(path),'HEROIC_DUPLICATE');
 fs.writeFileSync(path,JSON.stringify(d,null,2)+'\n',{flag:'wx'});
 git('add',path);
 git('-c','user.name=Fresh216-Public-Heroic',
 '-c','user.email=public-heroic@users.noreply.github.com',
 'commit','-m','experiment: public heroic discovery '+i+' '+stage);
 git('push','origin','HEAD:refs/heads/'+BRANCH);
}
const q0={query:'query { rateLimitData{currentRequest limitPerHour pointsSpentThisHour} reportData { reports(guildID:818162,limit:25,page:1){data{code title visibility}}}}'};
const q1=code=>({query:'query($code:String!){rateLimitData{currentRequest limitPerHour pointsSpentThisHour} reportData{report(code:$code){code visibility revision fights{id encounterID difficulty kill}}}}',
 variables:{code}});
const rate=body=>{
 let o=body?.data?.rateLimitData?.currentRequest;
 if(typeof o==='string'){try{o=JSON.parse(o)}catch{o=null}}
 const d=body?.data?.rateLimitData;
 return {cost:typeof o?.total==='number'&&Number.isFinite(o.total)?o.total:null,
  spent:d?.pointsSpentThisHour??null,limit:d?.limitPerHour??null};
};
async function main(){
 const mode=process.argv[2];
 need(['--preflight','--collect'].includes(mode),'HEROIC_MODE');
 need(process.env.GITHUB_REPOSITORY==='degong2-code/wcl-fresh216'&&
  git('branch','--show-current')===BRANCH,'HEROIC_PUBLIC_ONLY');
 if(mode==='--preflight'){
  need(!fs.existsSync(file(0,'start')),'HEROIC_ALREADY_STARTED');
  console.log(JSON.stringify({result:'PUBLIC_HEROIC_DISCOVERY_PREFLIGHT_PASS',
   publicGuildId:818162,selectedMaxTwoRequests:2,paidCalls:0,privateInputs:false}));return;
 }
 need(process.env.FRESH216_HEROIC_APPROVED==='true'&&
  process.env.GITHUB_REF==='refs/heads/'+BRANCH&&
  process.env.GITHUB_EVENT_NAME==='push'&&process.env.GITHUB_RUN_ATTEMPT==='1'&&
  process.env.WCL_CLIENT_ID&&process.env.WCL_CLIENT_SECRET,'HEROIC_NOT_AUTHORIZED');
 const auth=await fetch('https://www.warcraftlogs.com/oauth/token',{
  method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),
  headers:{Authorization:'Basic '+Buffer.from(process.env.WCL_CLIENT_ID+':'+process.env.WCL_CLIENT_SECRET).toString('base64'),
   'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials'});
 need(auth.status===200,'HEROIC_OAUTH_FAIL');
 const token=(await auth.json()).access_token;
 need(typeof token==='string'&&token,'HEROIC_TOKEN');
 async function one(i,q,parse){
  put(i,'start',{schema:1,status:'IN_FLIGHT',queryHash:hash(q)});
  let response=null,body=null;
  try{response=await fetch('https://www.warcraftlogs.com/api/v2/client',{
   method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),
   headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(q)});
   body=await response.json();
  }catch{}
  const r=rate(body);
  let parsed=null,verification='INVALID_RESPONSE';
  if(response?.status===200&&body?.data&&
   (!Array.isArray(body.errors)||body.errors.length===0)){
   try{parsed=parse(body);verification='VALID'}catch(e){
    verification=/^HEROIC_/.test(e.message)?e.message:'HEROIC_PARSE_UNVERIFIED';
   }
  }
  put(i,'done',{schema:1,status:'FINAL',queryHash:hash(q),
   httpStatus:response?.status??null,observedPoints:r.cost,
   quotaSpent:r.spent,quotaLimit:r.limit,verification,
   responseHash:body?hash(body):null,selected:parsed,
   rawActorsSaved:false,publicOnly:true});
  return {verification,parsed,cost:r.cost};
 }
 const list=await one(0,q0,body=>{
  const reports=body?.data?.reportData?.reports?.data;
  need(Array.isArray(reports),'HEROIC_REPORT_LIST_INVALID');
  const candidates=reports.filter(x=>x.visibility?.toLowerCase()==='public'&&
   /heroic/i.test(x.title??'')&&/^[A-Za-z0-9]{12,32}$/.test(x.code));
  need(candidates.length>0,'HEROIC_NO_PUBLIC_REPORTS');
  return {candidateCount:candidates.length,selectedCode:candidates[0].code,
   selectedTitleIsHeroic:true};
 });
 if(list.verification!=='VALID'||list.cost==null||list.cost>20){
  console.log(JSON.stringify({result:'HEROIC_DISCOVERY_STOP_AT_LIST',
   cost:list.cost,verification:list.verification}));return;
 }
 const report=await one(1,q1(list.parsed.selectedCode),body=>{
  const r=body?.data?.reportData?.report;
  need(r?.code===list.parsed.selectedCode&&r.visibility?.toLowerCase()==='public',
   'HEROIC_REPORT_NOT_PUBLIC');
  const fights=r.fights?.filter(x=>x.difficulty===4&&x.encounterID>0&&x.kill);
  need(Array.isArray(fights)&&fights.length>0,'HEROIC_NO_QUALIFYING_KILL');
  const selected=fights.sort((a,b)=>a.id-b.id)[0];
  return {reportCode:r.code,fightId:selected.id,encounterId:selected.encounterID,
   difficulty:4,heroicKills:fights.length};
 });
 console.log(JSON.stringify({result:'PUBLIC_HEROIC_DISCOVERY_RESULT',
  listPoints:list.cost,reportPoints:report.cost,
  candidate:report.parsed,verification:report.verification,
  noPrivateDataUsed:true}));
 if(report.verification!=='VALID'||report.cost==null||report.cost>10)process.exitCode=1;
}
try{await main()}catch(e){console.error(/^HEROIC_/.test(e.message)?e.message:'HEROIC_REVIEW_REQUIRED');process.exitCode=1}
