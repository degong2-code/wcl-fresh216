#!/usr/bin/env node
/**
 * PUBLIC report only, WCL exact-BossDPS-vs-DamageDone experiment.
 * NO private Fresh216 A/B/C, no raw player/actor names/IDs/amounts in Git.
 *
 * The target-filter test is executed ONLY if the encounter's boss actors can
 * be attributed using official WCL masterData subtype=Boss and fight.enemyNPCs.
 * Each charged query gets a durable IN_FLIGHT Git marker BEFORE dispatch.
 */
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';

const REPO='degong2-code/wcl-fresh216';
const BRANCH='work/public-runner-effexp-20261030';
const CODE='wyCNP6db8FrxG7gk';
const FIGHT=Number(process.env.FRESH216_PUBLIC_FIGHT_ID);
const ENCOUNTER=Number(process.env.FRESH216_PUBLIC_ENCOUNTER_ID);
const DIR='pilot-evidence/20261030-crossfight-'+FIGHT;
const CAP=40,MAX_ONE=24,RESERVE_NEXT=8;
const Q='rateLimitData{currentRequest limitPerHour pointsSpentThisHour pointsResetIn}';
const R=(fields)=>'reportData{report(code:$code){code revision '+fields+'}}';
const sha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const good=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
const need=(x,err)=>{if(!x)throw Error(err)};
const git=(...args)=>execFileSync('git',args,{
 encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000,
 env:{...process.env,GIT_TERMINAL_PROMPT:'0'}
}).trim();
const sKey=i=>DIR+'/'+String(i).padStart(2,'0');
const doc=(i,type)=>{const p=sKey(i)+'.'+type+'.json';return fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):null};
function commit(i,type,value){
 const path=sKey(i)+'.'+type+'.json';
 fs.mkdirSync(DIR,{recursive:true});
 need(!fs.existsSync(path),'PARITY_EXISTING_RECEIPT');
 fs.writeFileSync(path,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
 git('add','--',path);
 git('-c','user.name=Fresh216-Public-Parity',
  '-c','user.email=fresh216-parity@users.noreply.github.com',
  'commit','-m','experiment: public BossDPS parity '+i+' '+type);
 git('push','origin','HEAD:refs/heads/'+BRANCH);
}
function quota(body){
 let v=body?.data?.rateLimitData?.currentRequest;
 if(typeof v==='string'){try{v=JSON.parse(v)}catch{v=null}}
 const s=body?.data?.rateLimitData;
 const safe=n=>good(n)?n:null;
 return {points:safe(v?.total),spent:safe(s?.pointsSpentThisHour),
  limit:safe(s?.limitPerHour),reset:safe(s?.pointsResetIn)};
}
const asRows=table=>{
 const data=table?.data;
 return Array.isArray(data?.entries)?data.entries:null;
};
const actorId=x=>{
 const n=Number(x?.id);
 return Number.isSafeInteger(n)&&n>0?'id:'+n:null;
};
const actorName=x=>{
 const name=String(x?.name??'').trim().toLowerCase();
 return name&&name!=='anonymous'?'name:'+name:null;
};
function matchTable(rank,tableRows){
 const byId=new Map(),byName=new Map();
 for(const row of tableRows){
  const id=actorId(row),name=actorName(row);
  if(id){if(!byId.has(id))byId.set(id,[]);byId.get(id).push(row)}
  if(name){if(!byName.has(name))byName.set(name,[]);byName.get(name).push(row)}
 }
 const matches=[];
 for(const actor of rank){
  const id=actorId(actor),name=actorName(actor);
  const selected=id&&byId.get(id)?.length===1?byId.get(id):
   name&&byName.get(name)?.length===1?byName.get(name):null;
  if(selected?.length===1){
   matches.push({actor,row:selected[0],key:id??name});
  }
 }
 return matches;
}
const numericTotal=row=>{
 for(const k of ['total','amount','totalDamage']){
  const x=Number(row?.[k]);
  if(Number.isFinite(x)&&x>=0)return {field:k,value:x};
 }
 return null;
};
function noActorEvidence(entries){
 return {entries:entries?.length??null,
  firstKeys:entries?.[0]?Object.keys(entries[0]).slice(0,18):[],
  totalFieldCount:entries?.filter(x=>numericTotal(x)!=null).length??null};
}
function compare(matches,durationSec,metric='amount'){
 const out=[];
 for(const {actor,row} of matches){
  const num=numericTotal(row);
  const official=Number(actor?.[metric]);
  if(!num||!good(official)||!Number.isFinite(durationSec)||durationSec<=0)continue;
  out.push(Math.abs(num.value/durationSec-official));
 }
 const sorted=out.toSorted((a,b)=>a-b);
 return {compared:out.length,exact0005:out.filter(x=>x<=0.005).length,
  within001:out.filter(x=>x<=0.01).length,within1:out.filter(x=>x<=1).length,
  medianAbsDps:sorted.length?sorted[Math.floor(sorted.length/2)]:null,
  maxAbsDps:sorted.length?sorted.at(-1):null};
}
const referenceQuery={query:
 'query($code:String!,$fight:Int!){'+Q+' '+R(
  'fights(fightIDs:[$fight]){id encounterID difficulty startTime endTime kill enemyNPCs{id gameID}} '+
  'masterData{actors{id type subType petOwner}} '+
  'o:rankings(fightIDs:[$fight],playerMetric:dps) '+
  'b:rankings(fightIDs:[$fight],playerMetric:bossdps) '+
  's:table(dataType:DamageDone,fightIDs:[$fight],viewBy:Source) '+
  't:table(dataType:DamageDone,fightIDs:[$fight],viewBy:Target)'
 )+'}',variables:{code:CODE,fight:FIGHT}};
function interpretReference(body){
 need(!Array.isArray(body?.errors)||body.errors.length===0,'PARITY_GRAPHQL_ERROR');
 const r=body?.data?.reportData?.report;
 need(r?.code===CODE&&Number.isInteger(r?.revision),'PARITY_REPORT_ID');
 const f=r.fights?.filter(x=>x.id===FIGHT);
 need(f?.length===1&&f[0].encounterID===ENCOUNTER&&f[0].difficulty===1&&
  f[0].kill===true,'PARITY_FIGHT_ID');
 const fight=f[0],duration=(fight.endTime-fight.startTime)/1000;
 need(duration>0,'PARITY_DURATION');
 const rchars=metric=>{
  const fits=r?.[metric]?.data?.filter(x=>x.fightID===FIGHT);
  need(fits?.length===1,'PARITY_RANKING_FIGHT');
  const c=fits[0]?.roles?.dps?.characters;
  need(Array.isArray(c)&&c.length>=1,'PARITY_RANKING_ACTORS');
  return c;
 };
 const all=rchars('o'),boss=rchars('b');
 const source=asRows(r.s),target=asRows(r.t);
 need(source&&target,'PARITY_DAMAGE_TABLE_SHAPE');
 const actors=r.masterData?.actors;
 need(Array.isArray(actors),'PARITY_MASTER_ACTORS');
 const present=new Set(fight.enemyNPCs?.map(x=>x.id));
 const bossNPC=actors.filter(a=>a.type==='NPC'&&
  String(a.subType).toLowerCase()==='boss'&&present.has(a.id));
 const usableBoss=bossNPC.filter(x=>Number.isInteger(x.id)&&x.id>0);
 const joinedSource=matchTable(boss,source);
 const joinedTotal=matchTable(all,source);
 const summary={schema:1,reportRevision:r.revision,encounterID:fight.encounterID,
  difficulty:fight.difficulty,durationMs:fight.endTime-fight.startTime,
  bossNpcTargets:usableBoss.length,totalFightNPCs:fight.enemyNPCs?.length??null,
  totalMasterActors:actors.length,
  totalRankedDpsActors:all.length,bossRankedDpsActors:boss.length,
  sourceTable:noActorEvidence(source),targetTable:noActorEvidence(target),
  bossTableMatchedActors:joinedSource.length,
  totalTableMatchedActors:joinedTotal.length,
  unfilteredTableVsOfficialTotal:compare(joinedTotal,duration),
  unfilteredTableVsOfficialBoss:compare(joinedSource,duration)
 };
 return {summary,bossTargets:usableBoss.map(x=>x.id),boss,source,duration};
}
function groupTargetQuery(ids){
 need(ids.length>0&&ids.length<=4&&
  ids.every(x=>Number.isInteger(x)&&x>0),'PARITY_BOSS_TARGET_ID');
 const fields=ids.map((id,i)=>'b'+i+':table(dataType:DamageDone,fightIDs:[$fight],viewBy:Source,targetID:'+id+')').join(' ');
 return {query:'query($code:String!,$fight:Int!){'+Q+' '+R(fields)+'}',
  variables:{code:CODE,fight:FIGHT}};
}
function interpretTargets(body,reference,ids){
 need(!Array.isArray(body?.errors)||body.errors.length===0,'PARITY_TARGET_GRAPHQL_ERROR');
 const r=body?.data?.reportData?.report;
 need(r?.code===CODE&&r.revision===reference.summary.reportRevision,'PARITY_TARGET_REPORT_DRIFT');
 const tables=ids.map((id,i)=>asRows(r['b'+i]));
 need(tables.every(x=>Array.isArray(x)),'PARITY_BOSS_TABLE_SHAPE');
 const perTargetCounts=tables.map(x=>x.length);
 const counted=[];
 let exact=0,near=0,most=0;
 for(const actor of reference.boss){
  const official=Number(actor?.amount);
  if(!good(official))continue;
  let summed=0,matchedTables=0;
  for(const rows of tables){
   const matched=matchTable([actor],rows);
   if(matched.length!==1)continue;
   const total=numericTotal(matched[0].row);
   if(!total)continue;
   summed+=total.value;matchedTables++;
  }
  if(matchedTables!==tables.length)continue;
  const reconstructed=summed/reference.duration;
  const diff=Math.abs(reconstructed-official);
  counted.push(diff);
  if(diff<=0.005)exact++;
  if(diff<=0.01)near++;
  if(diff<=1)most++;
 }
 const ranked=counted.toSorted((a,b)=>a-b);
 return {bossTargetCount:ids.length,perTargetRows:perTargetCounts,
  rosterSize:reference.boss.length,compared:counted.length,
  exact0005:exact,within001:near,within1:most,
  medianAbsDps:ranked.length?ranked[Math.floor(ranked.length/2)]:null,
  maxAbsDps:ranked.length?ranked.at(-1):null,
  numericFormula:'sum(table.targetID=BossActorID.totalDamage)/(fight.endTime-fight.startTime)*1000',
  proofLevel:'PUBLIC_TEST_ONLY_NOT_AUTHORITATIVE_C'};
}
async function main(){
 need(process.env.GITHUB_REPOSITORY===REPO&&
  git('branch','--show-current')===BRANCH,'PARITY_PUBLIC_BRANCH');
 need(Number.isSafeInteger(FIGHT)&&FIGHT>0&&FIGHT!==50&&
  Number.isSafeInteger(ENCOUNTER)&&ENCOUNTER>0,
  'PARITY_PUBLIC_FIGHT_SELECTION');
 const mode=process.argv[2];
 need(['--preflight','--collect','--readback'].includes(mode),'PARITY_MODE');
 if(mode==='--preflight'){
  need(!doc(0,'start')&&!doc(0,'done'),'PARITY_PRIOR_RUN');
  need(referenceQuery.query.includes('masterData')&&
   referenceQuery.query.includes('viewBy:Target'),'PARITY_QUERY_CONTRACT');
  console.log(JSON.stringify({result:'PUBLIC_BOSS_TABLE_CROSSFIGHT_PREFLIGHT_PASS',
   publicReportCode:CODE,publicFight:FIGHT,maximumObservedPoints:CAP,
   maxTargets:4,pointReservation:MAX_ONE,existingPrivateDataAccess:0,wclCalls:0}));return;
 }
 if(mode==='--readback'){
  console.log(JSON.stringify({result:'PUBLIC_BOSS_TABLE_PARITY_READBACK',
   reference:doc(0,'done'),target:doc(1,'done'),wclCalls:0}));return;
 }
 need(process.env.FRESH216_BOSS_TABLE_APPROVED==='true'&&
  process.env.GITHUB_REF==='refs/heads/'+BRANCH&&
  process.env.GITHUB_EVENT_NAME==='push'&&process.env.GITHUB_RUN_ATTEMPT==='1'&&
  process.env.WCL_CLIENT_ID&&process.env.WCL_CLIENT_SECRET,
  'PARITY_AUTH_REQUIRED');
 need(!doc(0,'start')&&!doc(1,'start'),'PARITY_REPEAT_FORBIDDEN');
 const auth=await fetch('https://www.warcraftlogs.com/oauth/token',{
  method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),
  headers:{Authorization:'Basic '+Buffer.from(process.env.WCL_CLIENT_ID+':'+process.env.WCL_CLIENT_SECRET).toString('base64'),
   'Content-Type':'application/x-www-form-urlencoded'},
  body:'grant_type=client_credentials'});
 need(auth.status===200,'PARITY_OAUTH_HTTP');
 const token=(await auth.json()).access_token;
 need(typeof token==='string'&&token.length>0,'PARITY_OAUTH_MISSING');
 let observed=0,lastQuota=null;
 async function one(i,kind,query,interpreter){
  need(!doc(i,'start'),'PARITY_DUPLICATE_PAID_CALL');
  need(observed+MAX_ONE<=CAP,'PARITY_BUDGET_GUARD');
  if(lastQuota?.spent!=null&&lastQuota?.limit!=null)
   need(lastQuota.spent+MAX_ONE+RESERVE_NEXT<=Math.min(3200,Math.floor(.9*lastQuota.limit)),
    'PARITY_HOURLY_GUARD');
  commit(i,'start',{schema:1,status:'IN_FLIGHT',kind,querySha256:sha(query)});
  const begin=performance.now();
  let rsp=null,body=null;
  try{
   rsp=await fetch('https://www.warcraftlogs.com/api/v2/client',{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify(query)});
   body=await rsp.json();
  }catch{}
  const q=quota(body);
  let interpreted=null,validity='UNVERIFIED_RESPONSE';
  if(rsp?.status===200&&body?.data){
   try{interpreted=interpreter(body);validity='VALID'}
   catch(e){validity=/^PARITY_/.test(e.message)?e.message:'PARITY_INTERPRET_ERROR'}
  }
  const receipt={schema:1,status:'FINAL',kind,querySha256:sha(query),
   httpStatus:rsp?.status??null,observedPoints:q.points,
   quota:{spent:q.spent,limit:q.limit,reset:q.reset},
   elapsedMs:Math.round(performance.now()-begin),bodySha256:body?sha(body):null,
   verification:validity,summary:interpreted?.summary??null,
   privateDataAccess:false,rawActorDataPersisted:false};
  commit(i,'done',receipt);
  if(q.points!=null)observed+=q.points;
  lastQuota=q;
  return {q,validity,interpreted};
 }
 const p=await one(0,'public_reference_rankings_tables',referenceQuery,interpretReference);
 const first=p.interpreted;
 if(p.validity!=='VALID'||p.q.points==null||p.q.points>MAX_ONE||
  p.q.spent==null||p.q.limit==null){
  console.log(JSON.stringify({result:'PARITY_SAFE_STOP_AFTER_REFERENCE',
   verified:false,pointsObserved:observed,reason:p.validity}));return;
 }
 if(first.bossTargets.length===0||first.bossTargets.length>4){
  console.log(JSON.stringify({result:'PARITY_SAFE_STOP_AMBIGUOUS_BOSS_ACTORS',
   bossActorCount:first.bossTargets.length,pointsObserved:observed}));return;
 }
 const query=groupTargetQuery(first.bossTargets);
 const out=await one(1,'public_target_filtered_damage',query,body=>({
  summary:interpretTargets(body,first,first.bossTargets)
 }));
 console.log(JSON.stringify({result:'PUBLIC_BOSS_TABLE_CROSSFIGHT_COMPLETE',
  observedWclPoints:observed,phase1:first.summary,
  targetSummary:out.interpreted?.summary??null,
  phase2Verification:out.validity,
  publicOnly:true,privateSourceReads:0,sheetsWrites:0,
  exactMetricPromoted:false}));
}
try{await main()}catch(e){
 console.error(/^PARITY_/.test(e.message)?e.message:'PARITY_REVIEW_REQUIRED');
 process.exitCode=1;
}
