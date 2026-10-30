#!/usr/bin/env node
/**
 * Fresh216 PUBLIC-RUNNER API cost pilot, isolated from ai-project-lab.
 * Public forum report: https://www.warcraftlogs.com/reports/wyCNP6db8FrxG7gk?fight=50
 * No private ranked slots, player names or raw report bodies persisted.
 * Paid requests use persisted IN_FLIGHT marker per test; NEVER auto retry.
 */
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
const REPO='degong2-code/wcl-fresh216';
const BRANCH='work/public-runner-effexp-20261030';
const CODE='wyCNP6db8FrxG7gk',FIGHT=50;
const STORAGE='pilot-evidence/20261030';
const TESTS=['identify','both_rankings','boss_rankings','damage_table'];
const GUARD=80,RESERVE=16,CEILING=3200;
const report=(suffix)=>'reportData{report(code:$code){code revision '+suffix+'}}';
const quota='rateLimitData{currentRequest limitPerHour pointsSpentThisHour pointsResetIn}';
const queries={
 identify:{query:'query ($code:String!){'+quota+' '+report('fights{id encounterID difficulty kill}')+'}',variables:{code:CODE}},
 both_rankings:{query:'query ($code:String!,$fight:Int!){'+quota+' '+report('o:rankings(fightIDs:[$fight],playerMetric:dps) b:rankings(fightIDs:[$fight],playerMetric:bossdps)')+'}',variables:{code:CODE,fight:FIGHT}},
 boss_rankings:{query:'query ($code:String!,$fight:Int!){'+quota+' '+report('b:rankings(fightIDs:[$fight],playerMetric:bossdps)')+'}',variables:{code:CODE,fight:FIGHT}},
 damage_table:{query:'query ($code:String!,$fight:Int!){'+quota+' '+report('d:table(dataType:DamageDone,fightIDs:[$fight],viewBy:Source)')+'}',variables:{code:CODE,fight:FIGHT}}
};
const sha=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const fail=code=>{throw Error(code)};
const need=(x,c)=>{if(!x)fail(c)};
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}}).trim();
const read=(i)=>{const f=STORAGE+'/'+String(i).padStart(2,'0')+'.json';return fs.existsSync(f)?JSON.parse(fs.readFileSync(f)):null};
const pathFor=(i,ext)=>STORAGE+'/'+String(i).padStart(2,'0')+'.'+ext;
const points=(body)=>{
 let v=body?.data?.rateLimitData?.currentRequest;
 if(typeof v==='string'){try{v=JSON.parse(v)}catch{v=null}}
 const z=body?.data?.rateLimitData;
 const number=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0?x:null;
 return {request:number(v?.total),spent:number(z?.pointsSpentThisHour),
  limit:number(z?.limitPerHour),reset:number(z?.pointsResetIn)};
};
const info=body=>{
 const r=body?.data?.reportData?.report;
 const id=body?.data?.reportData?.report?.code;
 need(id===CODE,'PUBLIC_REPORT_IDENTITY_MISMATCH');
 return r;
};
const summary=(kind,body)=>{
 const r=info(body);
 if(kind==='identify'){
  const fights=r?.fights??[];
  const selected=fights.find(x=>x.id===FIGHT);
  need(selected,'PUBLIC_FIGHT_ID_NOT_FOUND');
  return {totalFights:fights.length,selectedEncounter:selected.encounterID,
   selectedDifficulty:selected.difficulty,selectedKill:selected.kill};
 }
 if(kind==='both_rankings'||kind==='boss_rankings'){
  const stats={};
  for(const k of kind==='both_rankings'?['o','b']:['b']){
   const data=r[k]?.data;
   need(Array.isArray(data),'RANKING_EXPECTED_DATA_ARRAY');
   const fights=data.filter(x=>x.fightID===FIGHT);
   stats[k]={fights:fights.length,characters:fights.reduce((n,x)=>
    n+(x?.roles?.dps?.characters?.length??0),0)};
  }
  return stats;
 }
 if(kind==='damage_table'){
  const d=r?.d;
  need(d!=null&&typeof d==='object','TABLE_MISSING');
  return {topKeys:Object.keys(d).slice(0,16),
   entries:Array.isArray(d?.entries)?d.entries.length:null,
   containsBossDpsAsExplicitField:Object.keys(d).some(x=>/bossdps/i.test(x))};
 }
 fail('TEST_KIND_UNKNOWN');
};
function status(){
 return TESTS.map((kind,i)=>({kind,status:read(i)?.status??'NOT_ATTEMPTED',
  observedPoints:read(i)?.cost??null}));
}
function persist(i,doc){
 const f=pathFor(i,'json');
 fs.mkdirSync(STORAGE,{recursive:true});
 need(!fs.existsSync(f),'PILOT_RECORD_ALREADY_EXISTS');
 fs.writeFileSync(f,JSON.stringify(doc,null,2)+'\n',{flag:'wx'});
 git('add','--',f);
 git('-c','user.name=Fresh216-Public-Probe','-c','user.email=fresh216-probe@users.noreply.github.com',
  'commit','-m', 'experiment: '+TESTS[i]+' '+doc.status);
 git('push','origin','HEAD:refs/heads/'+BRANCH);
}
async function main(){
 const mode=process.argv[2];
 need(['--preflight','--collect','--readback'].includes(mode),'PILOT_MODE');
 need(process.env.GITHUB_REPOSITORY===REPO&&git('branch','--show-current')===BRANCH,
  'PILOT_REPO_BRANCH');
 need(!fs.existsSync(STORAGE+'/unrelated-private-data'),'PILOT_PUBLIC_ONLY');
 if(mode==='--preflight'){
  need(TESTS.every((v,i)=>!read(i)),'PILOT_ALREADY_STARTED');
  need(Object.keys(queries).length===TESTS.length,'PILOT_PLAN');
  console.log(JSON.stringify({result:'PUBLIC_RUNNER_PILOT_PREFLIGHT_PASS',testNames:TESTS,
   publicReport:'https://www.warcraftlogs.com/reports/'+CODE+'?fight='+FIGHT,
   plannedMax:GUARD,reportOnlyPublic:true,noPrivateInputs:true,apiCalls:0}));
  return;
 }
 if(mode==='--readback'){
  console.log(JSON.stringify({result:'PUBLIC_RUNNER_PILOT_READBACK',tests:status(),apiCalls:0}));
  return;
 }
 need(process.env.FRESH216_PILOT_APPROVED==='true'&&process.env.GITHUB_RUN_ATTEMPT==='1'&&
  process.env.GITHUB_EVENT_NAME==='push'&&
  process.env.GITHUB_REF==='refs/heads/'+BRANCH&&
  process.env.WCL_CLIENT_ID&&process.env.WCL_CLIENT_SECRET,
  'PILOT_NOT_APPROVED_OR_SECRETS_MISSING');
 const used=TESTS.reduce((n,_,i)=>n+(read(i)?.cost??0),0);
 need(!TESTS.some((_,i)=>read(i)?.status==='IN_FLIGHT')&&
  used+RESERVE<=GUARD,'PILOT_UNCERTAIN_OLD_REQUEST_OR_BUDGET');
 const basic=Buffer.from(process.env.WCL_CLIENT_ID+':'+process.env.WCL_CLIENT_SECRET).toString('base64');
 let oauth;
 try{oauth=await fetch('https://www.warcraftlogs.com/oauth/token',{
  method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),
  headers:{Authorization:'Basic '+basic,'Content-Type':'application/x-www-form-urlencoded'},
  body:'grant_type=client_credentials'});}catch{fail('PILOT_AUTH_NETWORK')}
 need(oauth.status===200,'PILOT_OAUTH_NOT_200');
 const token=(await oauth.json()).access_token;
 need(typeof token==='string'&&token.length>0,'PILOT_AUTH_TOKEN_ABSENT');
 let observed=used,quotaLast=null;
 for(let i=0;i<TESTS.length;i++){
  if(read(i))continue;
  if(observed+RESERVE>GUARD)break;
  if(quotaLast&&quotaLast.spent!=null&&quotaLast.limit!=null&&
   quotaLast.spent+RESERVE>Math.min(CEILING,Math.floor(.9*quotaLast.limit)))break;
  const kind=TESTS[i];
  persist(i,{schema:1,status:'IN_FLIGHT',kind,source:'PUBLIC_FORUM_REPORT',
   reportUrl:'https://www.warcraftlogs.com/reports/'+CODE+'?fight='+FIGHT,
   querySha256:sha(queries[kind])});
  let rsp=null,body=null;
  const t=performance.now();
  try{
   rsp=await fetch('https://www.warcraftlogs.com/api/v2/client',{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(25000),
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify(queries[kind])});
   body=await rsp.json();
  }catch{}
  const ms=Math.round(performance.now()-t),q=points(body);
  let verification='UNVERIFIED',shape=null;
  if(rsp?.status===200&&body?.data&&(!Array.isArray(body?.errors)||body.errors.length===0)){
   try{shape=summary(kind,body);verification='VALID'}catch(e){verification=e.message}
  }
  // IN_FLIGHT stays permanent audit marker. Separate finalized receipt
  // explicitly refers to its immutable attempt. Any unknown billing
  // prevents next request; no retry is permitted.
  const final={schema:1,status:'FINAL',kind,
   requestSha256:sha(queries[kind]),httpStatus:rsp?.status??null,
   elapsedMs:ms,cost:q.request,quota:{spent:q.spent,limit:q.limit,reset:q.reset},
   evidenceDigest:body?sha(body):null,verification,shape,
   noPrivateDataPublished:true};
  const receiptPath=pathFor(i,'result.json');
  fs.writeFileSync(receiptPath,JSON.stringify(final,null,2)+'\n',{flag:'wx'});
  git('add','--',receiptPath);
  git('-c','user.name=Fresh216-Public-Probe','-c','user.email=fresh216-probe@users.noreply.github.com',
   'commit','-m','experiment: '+kind+' result (no actor details)');
  git('push','origin','HEAD:refs/heads/'+BRANCH);
  if(q.request==null||q.request>RESERVE||verification!=='VALID'||q.spent==null||q.limit==null){
   console.log(JSON.stringify({result:'PUBLIC_RUNNER_PILOT_SAFETY_STOP',kind,
    reason:verification,knownSpentBefore:observed}));
   break;
  }
  observed+=q.request;quotaLast=q;
 }
 const results=TESTS.map((kind,i)=>({kind,
  result:fs.existsSync(pathFor(i,'result.json'))?
   JSON.parse(fs.readFileSync(pathFor(i,'result.json'))):null}));
 console.log(JSON.stringify({result:'PUBLIC_RUNNER_PILOT_DONE',
  knownPrior:used,observedNew:observed-used,
  completed:results.filter(x=>x.result).length,
  results:results.map(({kind,result})=>({kind,
   cost:result?.cost??null,verification:result?.verification??'NOT_RUN',
   shape:result?.shape??null})),noPrivateData:true}));
}
try{await main()}catch(e){
 console.error(/^(PILOT_|PUBLIC_|RANKING_|TABLE_)/.test(e.message)?e.message:'PILOT_REVIEW_REQUIRED');
 process.exitCode=1;
}
