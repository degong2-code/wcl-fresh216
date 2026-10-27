import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {main} from '../tools/run-private-wcl-two-query-probe.mjs';

const validFixture={
  scopeKey:'SYNTHETIC_HEROIC',reportCode:'NOT_REAL_WCL',
  reportRevision:5,fightId:12,encounterId:3470,difficulty:4,
  slots:[{jobKey:'BOSS|Hunter|Marksmanship',rank:3,
    snapshotSha:'a'.repeat(64),totalDps:1000,
    className:'Hunter',specName:'Marksmanship',name:'SyntheticHunter'}]
};
const actor=(amount)=>({
  id:7,amount,name:'SyntheticHunter',class:'Hunter',spec:'Marksmanship'
});
const fight=(amount)=>({
  fightID:12,encounter:{id:3470},difficulty:4,
  roles:{dps:{characters:[actor(amount)]}}
});
function privateSetup(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fresh216-cli-offline-'));
  const fixture=path.join(dir,'fixture.json'),env=path.join(dir,'.env');
  fs.writeFileSync(fixture,JSON.stringify(validFixture));
  fs.writeFileSync(env,'WCL_CLIENT_ID="SYNTHETIC_ID"\nWCL_CLIENT_SECRET="SYNTHETIC_SECRET"\n');
  return {dir,fixture,env};
}
function fetchMock(visited){
  return async (url,options)=>{
    visited.push({url,method:options.method,redirect:options.redirect,
      // Only inspect a boolean; never retain Authorization headers or tokens.
      hasAuth:Boolean(options.headers?.Authorization)});
    if(url.endsWith('/oauth/token'))
      return {status:200,json:async()=>({access_token:'LOCAL_SYNTHETIC_TOKEN'})};
    if(!url.endsWith('/api/v2/client'))throw Error('UNEXPECTED_OUTBOUND_TARGET');
    const query=JSON.parse(options.body).query;
    const rank=query.includes('overall:rankings(');
    return {status:200,json:async()=>({data:{
      rateLimitData:{
        currentRequest:{total:3},limitPerHour:1000,
        pointsSpentThisHour:100,pointsResetIn:1200
      },
      reportData:{report:{
        code:'NOT_REAL_WCL',revision:5,
        ...(rank?{
          overall:{data:[fight(1000)]},boss:{data:[fight(700)]}
        }:{damage:{entries:[],total:0}})
      }}
    }})};
  };
}
const args=(fixture,env,out)=>[
  '--fixture',fixture,'--env-file',env,'--out',out,
  '--i-confirm-authorized-two-wcl-queries'
];

test('local private CLI uses one OAuth exchange + max two separate GraphQL calls',async()=>{
  const old=process.env.GITHUB_ACTIONS;
  process.env.GITHUB_ACTIONS='false';
  const x=privateSetup(),visited=[];
  try{
    const summary=await main(args(x.fixture,x.env,path.join(x.dir,'run001')),
      fetchMock(visited));
    assert.equal(summary.transportCalls,2);
    assert.deepEqual(visited.map(v=>v.url),[
      'https://www.warcraftlogs.com/oauth/token',
      'https://www.warcraftlogs.com/api/v2/client',
      'https://www.warcraftlogs.com/api/v2/client'
    ]);
    assert.ok(visited.every(v=>v.hasAuth&&v.redirect==='error'));
    assert.equal(fs.existsSync(x.fixture+'.wcl-two-query-attempted'),true);
    await assert.rejects(()=>main(args(x.fixture,x.env,
      path.join(x.dir,'run002')),fetchMock(visited)),/EEXIST/);
    assert.equal(visited.filter(v=>v.url.endsWith('/api/v2/client')).length,2);
  }finally{
    if(old===undefined)delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS=old;
    fs.rmSync(x.dir,{recursive:true,force:true});
  }
});

test('without explicit CLI approval flag there are zero mocked network requests',async()=>{
  const old=process.env.GITHUB_ACTIONS;
  process.env.GITHUB_ACTIONS='false';
  const x=privateSetup(),visited=[];
  try{
    const a=args(x.fixture,x.env,path.join(x.dir,'run'));
    a.pop();
    await assert.rejects(()=>main(a,fetchMock(visited)),/ARGS_REQUIRED/);
    assert.equal(visited.length,0);
    assert.equal(fs.existsSync(x.fixture+'.wcl-two-query-attempted'),false);
  }finally{
    if(old===undefined)delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS=old;
    fs.rmSync(x.dir,{recursive:true,force:true});
  }
});

test('GitHub Actions refuses even a fully configured CLI experiment',async()=>{
  const old=process.env.GITHUB_ACTIONS;
  process.env.GITHUB_ACTIONS='true';
  const x=privateSetup(),visited=[];
  try{
    await assert.rejects(()=>main(args(x.fixture,x.env,
      path.join(x.dir,'run')),fetchMock(visited)),/GITHUB_ACTIONS_LIVE_PROBE_REFUSED/);
    assert.equal(visited.length,0);
  }finally{
    if(old===undefined)delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS=old;
    fs.rmSync(x.dir,{recursive:true,force:true});
  }
});
