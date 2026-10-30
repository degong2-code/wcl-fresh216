#!/usr/bin/env node
/** PUBLIC-only WCL report-wide rankings cost and same-fight equality pilot.
 * Forum-published reference: wyCNP6db8FrxG7gk, fight 50.
 * Compares whole-report vs fight-scoped DPS + bossDPS, persist only hashes/counts.
 */
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
const CODE='wyCNP6db8FrxG7gk',FIGHT=50;
const BRANCH='work/public-runner-effexp-20261030';
const ROOT='pilot-evidence/20261030-whole-report';
const qs=[
 {name:'whole',query:'query ($code:String!){rateLimitData{currentRequest limitPerHour pointsSpentThisHour} reportData{report(code:$code){code revision o:rankings(playerMetric:dps) b:rankings(playerMetric:bossdps)}}}',variables:{code:CODE}},
 {name:'single',query:'query ($code:String!,$fight:Int!){rateLimitData{currentRequest limitPerHour pointsSpentThisHour} reportData{report(code:$code){code revision o:rankings(fightIDs:[$fight],playerMetric:dps) b:rankings(fightIDs:[$fight],playerMetric:bossdps)}}}',variables:{code:CODE,fight:FIGHT}}
];
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',timeout:20000,stdio:['ignore','pipe','pipe'],env:{...process.env,GIT_TERMINAL_PROMPT:'0'}}).trim();
const need=(v,c)=>{if(!v)throw Error(c)};
const paths=i=>[ROOT+'/'+i+'.start.json',ROOT+'/'+i+'.done.json'];
function write(i,stage,doc){
 const p=paths(i)[stage];
 need(!fs.existsSync(p),'WIDE_ALREADY_ATTEMPTED');
 fs.mkdirSync(ROOT,{recursive:true});
 fs.writeFileSync(p,JSON.stringify(doc,null,2)+'\n',{flag:'wx'});
 git('add',p);
 git('-c','user.name=PublicWclPilot','-c','user.email=public-pilot@users.noreply.github.com','commit','-m','experiment: whole report '+qs[i].name+' '+(stage===0?'started':'finished'));
 git('push','origin','HEAD:refs/heads/'+BRANCH);
}
const cost=b=>{
 let c=b?.data?.rateLimitData?.currentRequest;
 if(typeof c==='string'){try{c=JSON.parse(c)}catch{c=null}}
 return typeof c?.total==='number'&&Number.isFinite(c.total)&&c.total>=0?c.total:null;
};
function view(body){
 const report=body?.data?.reportData?.report;
 need(report?.code===CODE,'WIDE_REPORT_CODE_MISMATCH');
 const a={};const hashes={};
 for(const metric of ['o','b']){
  need(Array.isArray(report[metric]?.data),'WIDE_RANKINGS_MISSING');
  const data=report[metric].data;
  const f=data.filter(x=>Number(x.fightID)===FIGHT);
  a[metric]={fightRecords:data.length,fight50Records:f.length,
   dpsActorsAll:data.reduce((n,f)=>n+(f?.roles?.dps?.characters?.length??0),0),
   fightIds:[...new Set(data.map(x=>x.fightID).filter(Number.isInteger))].length};
  hashes[metric]=f.length===1?hash(f[0]):null;
 }
 return {revision:report.revision,shape:a,hashes};
}
async function main(){
 need(process.env.GITHUB_REPOSITORY==='degong2-code/wcl-fresh216'&&
  git('branch','--show-current')===BRANCH,'WIDE_PUBLIC_BRANCH_ONLY');
 if(process.argv[2]==='--preflight'){
  need(qs.every((_,i)=>paths(i).every(p=>!fs.existsSync(p))),'WIDE_ALREADY_RAN');
  console.log(JSON.stringify({result:'PUBLIC_WIDE_OFFLINE_PASS',tests:qs.map(q=>q.name),apiCalls:0,privateInputs:false}));
  return;
 }
 need(process.argv[2]==='--collect'&&process.env.WCL_CLIENT_ID&&
  process.env.WCL_CLIENT_SECRET&&process.env.FRESH216_PUBLIC_WIDE_APPROVED==='true'&&
  process.env.GITHUB_RUN_ATTEMPT==='1'&&process.env.GITHUB_EVENT_NAME==='push'&&
  process.env.GITHUB_REF==='refs/heads/'+BRANCH,'WIDE_NOT_AUTHORIZED');
 const h=Buffer.from(process.env.WCL_CLIENT_ID+':'+process.env.WCL_CLIENT_SECRET).toString('base64');
 const auth=await fetch('https://www.warcraftlogs.com/oauth/token',{
  method:'POST',signal:AbortSignal.timeout(20000),redirect:'error',
  headers:{Authorization:'Basic '+h,'Content-Type':'application/x-www-form-urlencoded'},
  body:'grant_type=client_credentials'});
 need(auth.status===200,'WIDE_OAUTH_FAILED');
 const token=(await auth.json()).access_token;
 need(typeof token==='string'&&token.length>0,'WIDE_TOKEN_MISSING');
 const inMemory=[];
 let observed=0;
 for(let i=0;i<qs.length;i++){
  if(observed+16>48)break;
  const item=qs[i];
  write(i,0,{schema:1,status:'IN_FLIGHT',kind:item.name,querySha256:hash(item)});
  let response=null,body=null;
  const begin=performance.now();
  try{
   response=await fetch('https://www.warcraftlogs.com/api/v2/client',{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(25000),
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify(item)});
   body=await response.json();
  }catch{}
  let verification='UNVERIFIED',details=null;
  if(response?.status===200&&body?.data&&
   (!Array.isArray(body.errors)||body.errors.length===0)){
   try{details=view(body);verification='VALID'}catch(e){verification=e.message}
  }
  const points=cost(body);
  write(i,1,{schema:1,status:'FINAL',kind:item.name,
   requestSha256:hash(item),httpStatus:response?.status??null,points,
   elapsedMs:Math.round(performance.now()-begin),
   verification,shape:details?.shape??null,revision:details?.revision??null,
   fight50Hashes:details?.hashes??null,
   rawBodySha256:body?hash(body):null,
   privateData:false});
  if(points===null||points>16||verification!=='VALID')break;
  observed+=points;inMemory.push({kind:item.name,points,details});
 }
 const comparison=inMemory.length===2?{
  revisionsEqual:inMemory[0].details.revision===inMemory[1].details.revision,
  totalFight50HashEqual:inMemory[0].details.hashes.o!=null&&inMemory[0].details.hashes.o===inMemory[1].details.hashes.o,
  bossFight50HashEqual:inMemory[0].details.hashes.b!=null&&inMemory[0].details.hashes.b===inMemory[1].details.hashes.b
 }:null;
 console.log(JSON.stringify({result:'PUBLIC_WIDE_COST_COMPARISON',
  observedPoints:observed,performed:inMemory.map(x=>({kind:x.kind,points:x.points,shape:x.details.shape})),
  comparison,publicOnly:true,privateRead:false,sheetsWrites:0}));
}
try{await main()}catch(e){console.error(/^WIDE_/.test(e.message)?e.message:'WIDE_REVIEW_REQUIRED');process.exitCode=1}
