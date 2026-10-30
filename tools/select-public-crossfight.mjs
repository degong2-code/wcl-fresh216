#!/usr/bin/env node
/** PUBLIC report fight selection: do not persist player names or private state.
 * Exactly one metadata GraphQL query with permanent IN_FLIGHT marker.
 */
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const ROOT='pilot-evidence/20261030-parity-crossfight';
const BRANCH='work/public-runner-effexp-20261030';
const CODE='wyCNP6db8FrxG7gk';
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const need=(x,msg)=>{if(!x)throw Error(msg)};
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:25000,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}}).trim();
const path=(name)=>ROOT+'/'+name+'.json';
const write=(name,x)=>{
 fs.mkdirSync(ROOT,{recursive:true});need(!fs.existsSync(path(name)),'CROSS_SELECTION_EXISTS');
 fs.writeFileSync(path(name),JSON.stringify(x,null,2)+'\n',{flag:'wx'});
 git('add',path(name));
 git('-c','user.name=PublicWclProbe','-c','user.email=public-wcl-probe@users.noreply.github.com',
 'commit','-m','experiment: crossfight public '+name);
 git('push','origin','HEAD:refs/heads/'+BRANCH);
};
const q={query:'query($code:String!){rateLimitData{currentRequest limitPerHour pointsSpentThisHour} reportData{report(code:$code){code revision fights{id encounterID difficulty kill}}}}',variables:{code:CODE}};
const mode=process.argv[2];
need(process.env.GITHUB_REPOSITORY==='degong2-code/wcl-fresh216'&&
 git('branch','--show-current')===BRANCH,'CROSS_PUBLIC_ONLY');
if(mode==='--preflight'){
 need(!fs.existsSync(path('selection-start')),'CROSS_ALREADY_STARTED');
 console.log(JSON.stringify({result:'PUBLIC_CROSS_METADATA_PREFLIGHT_PASS',
  queryHash:sha(q),paidCalls:0,sheetsWrites:0}));process.exit(0);
}
need(mode==='--collect'&&process.env.FRESH216_CROSS_PILOT_APPROVED==='true'&&
 process.env.GITHUB_REF==='refs/heads/'+BRANCH&&
 process.env.GITHUB_EVENT_NAME==='push'&&process.env.GITHUB_RUN_ATTEMPT==='1'&&
 process.env.WCL_CLIENT_ID&&process.env.WCL_CLIENT_SECRET,'CROSS_NOT_APPROVED');
need(!fs.existsSync(path('selection-start')),'CROSS_REPEAT_DENIED');
const auth=await fetch('https://www.warcraftlogs.com/oauth/token',{
 method:'POST',signal:AbortSignal.timeout(20000),redirect:'error',
 headers:{Authorization:'Basic '+Buffer.from(process.env.WCL_CLIENT_ID+':'+process.env.WCL_CLIENT_SECRET).toString('base64'),
 'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials'});
need(auth.status===200,'CROSS_OAUTH_DENIED');
const token=(await auth.json()).access_token;
need(typeof token==='string'&&token,'CROSS_TOKEN_MISSING');
write('selection-start',{schema:1,status:'IN_FLIGHT',kind:'public-fight-metadata',querySha256:sha(q)});
let response=null,body=null;
try{response=await fetch('https://www.warcraftlogs.com/api/v2/client',{
 method:'POST',redirect:'error',signal:AbortSignal.timeout(25000),
 headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
 body:JSON.stringify(q)});body=await response.json()}catch{}
let c=body?.data?.rateLimitData?.currentRequest;
if(typeof c==='string'){try{c=JSON.parse(c)}catch{c=null}}
const points=typeof c?.total==='number'&&Number.isFinite(c.total)?c.total:null;
const report=body?.data?.reportData?.report;
let selection=[];
if(response?.status===200&&body?.errors==null&&report?.code===CODE&&
 Array.isArray(report?.fights)){
 const options=report.fights.filter(f=>f.id!==50&&f.encounterID>0&&
  f.difficulty===1&&f.kill===true).sort((a,b)=>a.id-b.id);
 const seen=new Set([3129]);
 for(const f of options){
  if(seen.has(f.encounterID))continue;
  seen.add(f.encounterID);selection.push({fightId:f.id,encounterId:f.encounterID,difficulty:1});
  if(selection.length===2)break;
 }
 if(selection.length<2){
  const ids=new Set(selection.map(f=>f.fightId));
  for(const f of options){
   if(ids.has(f.id))continue;
   ids.add(f.id);selection.push({fightId:f.id,encounterId:f.encounterID,difficulty:1});
   if(selection.length===2)break;
  }
 }
}
write('selection-result',{schema:1,status:'FINAL',httpStatus:response?.status??null,
 points,querySha256:sha(q),responseHash:body?sha(body):null,publicOnly:true,
 selection,hasTwoCandidates:selection.length===2});
console.log(JSON.stringify({result:'PUBLIC_CROSS_SELECTION',pointCost:points,
 publicFightCandidates:selection,selectedTwo:selection.length===2,
 noPlayerDataPersisted:true,privateInputs:false}));
if(points==null||points>8||selection.length!==2)process.exitCode=1;
