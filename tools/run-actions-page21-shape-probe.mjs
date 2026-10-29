#!/usr/bin/env node
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {Buffer} from 'node:buffer';

const REQUEST='experiments/approved-nekzali-page21-shape-probe.json';
const ONCE_REF='refs/heads/wcl-fresh216-approved-nekzali-page21-shape-probe-consumed';
const REPO='degong2-code/wcl-fresh216';
const BRANCH='refs/heads/work/collector-architecture';
const REFS='https://api.github.com/repos/'+REPO+'/git/refs';
const TOKEN='https://www.warcraftlogs.com/oauth/token';
const API='https://www.warcraftlogs.com/api/v2/client';
const FILTER='date.1792594800000.1793199600000';
const describe=v=>{
  const t=v===null?'null':Array.isArray(v)?'array':typeof v;
  const keys=v&&typeof v==='object'&&!Array.isArray(v)?Object.keys(v).sort():[];
  const rk=v&&typeof v==='object'?v.rankings:undefined;
  const rankingsType=rk===null?'null':Array.isArray(rk)?'array':typeof rk;
  return {type:t,keys:keys.slice(0,30),hasRankingsKey:keys.includes('rankings'),
    rankingsType,rankingsLength:Array.isArray(rk)?rk.length:null,
    arrayLength:Array.isArray(v)?v.length:null};
};
const readJson=async r=>r?.json?await r.json().catch(()=>null):null;
export async function main(){
  try{
    const diff=execFileSync('git',['diff-tree','--no-commit-id','--name-status','-r',
      process.env.GITHUB_SHA],{encoding:'utf8',timeout:10000}).trim();
    if(diff!=='A\t'+REQUEST){process.stdout.write('PAGE21_PROBE_NO_REQUEST\n');return;}
    const req=JSON.parse(fs.readFileSync(REQUEST,'utf8'));
    if(req?.request_id!=='FRESH216_NEKZALI_PAGE21_SHAPE_20261028'||
       req?.approval!=='OWNER_APPROVED_20261028_PAGE21_SHAPE_PROBE'||
       req?.encounter_id!==3470||req?.difficulty!==4||
       req?.spec!=='frost_dk'||req?.filter!==FILTER||
       JSON.stringify(req?.pages)!=='[20,21]')
      throw Error('PAGE21_PROBE_SCOPE_INVALID');
    const env=process.env;
    if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_EVENT_NAME!=='push'||
       env.GITHUB_REF!==BRANCH||env.GITHUB_REPOSITORY!==REPO)
      throw Error('PAGE21_PROBE_ACTION_SCOPE_INVALID');
    for(const k of ['GITHUB_TOKEN','WCL_CLIENT_ID','WCL_CLIENT_SECRET'])
      if(!env[k])throw Error('PAGE21_PROBE_SECRET_MISSING');
    const reserve=await fetch(REFS,{method:'POST',redirect:'error',
      signal:AbortSignal.timeout(15000),
      headers:{Authorization:'Bearer '+env.GITHUB_TOKEN,Accept:'application/vnd.github+json',
        'Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},
      body:JSON.stringify({ref:ONCE_REF,sha:env.GITHUB_SHA})});
    if(reserve.status===422){process.stdout.write('PAGE21_PROBE_ALREADY_CONSUMED\n');return;}
    if(reserve.status!==201)throw Error('PAGE21_PROBE_RESERVATION_DENIED');
    const basic=Buffer.from(env.WCL_CLIENT_ID+':'+env.WCL_CLIENT_SECRET).toString('base64');
    const oauth=await fetch(TOKEN,{method:'POST',redirect:'error',
      signal:AbortSignal.timeout(25000),
      headers:{Authorization:'Basic '+basic,'Content-Type':'application/x-www-form-urlencoded'},
      body:'grant_type=client_credentials'});
    if(oauth.status!==200)throw Error('PAGE21_PROBE_OAUTH_FAILED');
    const auth=await readJson(oauth);
    if(!auth?.access_token)throw Error('PAGE21_PROBE_TOKEN_INVALID');
    const query='query Page21Shape($id:Int!,$difficulty:Int!,$filter:String!){'+
      'rateLimitData{currentRequest} worldData{encounter(id:$id){'+
      'b20:characterRankings(difficulty:$difficulty,className:"DeathKnight",specName:"Frost",metric:bossdps,page:20,filter:$filter) '+
      'b21:characterRankings(difficulty:$difficulty,className:"DeathKnight",specName:"Frost",metric:bossdps,page:21,filter:$filter)'+
      '}}}';
    const started=Date.now();
    const res=await fetch(API,{method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),
      headers:{Authorization:'Bearer '+auth.access_token,'Content-Type':'application/json'},
      body:JSON.stringify({query,variables:{id:3470,difficulty:4,filter:FILTER}})});
    const body=await readJson(res),elapsedMs=Date.now()-started;
    let cr=body?.data?.rateLimitData?.currentRequest;
    if(typeof cr==='string'){try{cr=JSON.parse(cr);}catch{cr=null;}}
    const out={httpStatus:res.status,elapsedMs,
      graphqlErrors:Array.isArray(body?.errors)?body.errors.length:null,
      reportedPointTotal:typeof cr?.total==='number'?cr.total:null,
      page20:describe(body?.data?.worldData?.encounter?.b20),
      page21:describe(body?.data?.worldData?.encounter?.b21),
      rawRowsPublished:false};
    process.stdout.write('REDACTED_PAGE21_SHAPE '+JSON.stringify(out)+'\n');
  }catch(e){
    const m=String(e?.message||'');
    process.stderr.write((/^PAGE21_PROBE_[A-Z0-9_]+$/.test(m)?m:'PAGE21_PROBE_ABORTED')+'\n');
    process.exitCode=1;
  }
}
if(process.argv[1]?.endsWith('/run-actions-page21-shape-probe.mjs'))await main();
