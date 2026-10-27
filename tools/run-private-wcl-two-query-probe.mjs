#!/usr/bin/env node
/**
 * Explicit, local-only paid WCL probe. NEVER run as GitHub Actions CI.
 *
 * Required args:
 *  --fixture ABSOLUTE_PRIVATE_JSON_PATH
 *  --env-file ABSOLUTE_USER_OWNED_DOTENV_PATH
 *  --out ABSOLUTE_NEW_PRIVATE_DIRECTORY
 *  --i-confirm-authorized-two-wcl-queries
 *
 * Only the existing client_credentials OAuth flow is used. No user OAuth,
 * scopes, Sheets, retries, report discovery or queries outside the two
 * prebuilt documents. An OAuth token exchange is an additional HTTP request
 * but is NOT a GraphQL query. No tokens/secrets are persisted or printed.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runPrivateTwoQueryProbe,validatePrivateProbeGroup}
  from '../src/core/private-two-query-probe.mjs';

const CONFIRM='--i-confirm-authorized-two-wcl-queries';
const ENDPOINT='https://www.warcraftlogs.com/api/v2/client';
const TOKEN='https://www.warcraftlogs.com/oauth/token';

function requireArgs(argv,cwd){
  if(argv.length!==7 || !argv.includes(CONFIRM))
    throw Error('ARGS_REQUIRED: --fixture FILE --env-file FILE --out NEW_DIR '+CONFIRM);
  const result={};
  for(let i=0;i<argv.length;i++){
    const s=argv[i];
    if(s===CONFIRM)continue;
    if(!['--fixture','--env-file','--out'].includes(s)||i+1===argv.length||
       argv[i+1].startsWith('--')||Object.hasOwn(result,s))
      throw Error('ARGS_INVALID');
    result[s]=argv[++i];
  }
  for(const k of ['--fixture','--env-file','--out']){
    if(typeof result[k]!=='string'||!path.isAbsolute(result[k]))
      throw Error('ABSOLUTE_PRIVATE_PATH_REQUIRED');
  }
  // Avoid raw WCL data or identifiers inside the public Git clone.
  const inside=p=>{
    const rel=path.relative(cwd,path.resolve(p));
    return rel===''||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel));
  };
  if(inside(result['--out'])||inside(result['--fixture']))
    throw Error('PRIVATE_FILES_MUST_BE_OUTSIDE_REPOSITORY');
  if(fs.existsSync(result['--out']))throw Error('OUTPUT_ALREADY_EXISTS_NO_REPLAY');
  if(!fs.statSync(result['--fixture']).isFile()||
     !fs.statSync(result['--env-file']).isFile())throw Error('INPUT_NOT_REGULAR_FILE');
  return result;
}
function dotenvPairs(contents){
  const out={};
  for(const line of contents.split(/\r?\n/)){
    const s=line.trim();
    if(!s||s.startsWith('#'))continue;
    const m=/^(?:export\s+)?(WCL_CLIENT_ID|WCL_CLIENT_SECRET)\s*=\s*(.*)$/.exec(s);
    if(!m)continue;
    let v=m[2].trim();
    if((v.startsWith('"')&&v.endsWith('"'))||
       (v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);
    out[m[1]]=v;
  }
  return out;
}
async function getToken(env,fetchImpl){
  const id=env.WCL_CLIENT_ID,secret=env.WCL_CLIENT_SECRET;
  if(!id||!secret)throw Error('WCL_CLIENT_CREDENTIALS_NOT_PRESENT');
  const basic=Buffer.from(id+':'+secret,'utf8').toString('base64');
  let response;
  try{
    response=await fetchImpl(TOKEN,{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(25000),
      headers:{Authorization:'Basic '+basic,
        'Content-Type':'application/x-www-form-urlencoded'},
      body:'grant_type=client_credentials'
    });
  }catch(_e){throw Error('LOCAL_OAUTH_TOKEN_EXCHANGE_UNAVAILABLE');}
  if(response.status!==200)throw Error('OAUTH_TOKEN_REQUEST_NOT_SUCCESSFUL');
  const body=await response.json().catch(()=>null);
  if(typeof body?.access_token!=='string'||!body.access_token)
    throw Error('OAUTH_TOKEN_RESPONSE_INVALID');
  return body.access_token;
}
function makeTransport(token,fetchImpl){
  return async query=>{
    const response=await fetchImpl(ENDPOINT,{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(45000),
      headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify(query)
    });
    const body=await response.json().catch(()=>null);
    return {httpStatus:response.status,body};
  };
}
export async function main(argv=process.argv.slice(2),fetchImpl=fetch){
  if(process.env.GITHUB_ACTIONS==='true')throw Error('GITHUB_ACTIONS_LIVE_PROBE_REFUSED');
  const args=requireArgs(argv,path.resolve(fileURLToPath(new URL('..',import.meta.url))));
  const group=JSON.parse(fs.readFileSync(args['--fixture'],'utf8'));
  validatePrivateProbeGroup(group);
  // Existing *client credentials* only. The .env file remains on this machine.
  const env=dotenvPairs(fs.readFileSync(args['--env-file'],'utf8'));
  const token=await getToken(env,fetchImpl);
  const summary=await runPrivateTwoQueryProbe({
    group,privateOutputDir:args['--out'],
    send:makeTransport(token,fetchImpl),
    minAppHeadroom:100
  });
  // Do not print IDs, codes, characters, GraphQL data, OAuth values or tokens.
  process.stdout.write(JSON.stringify({
    status:summary.status,transportCalls:summary.transportCalls,
    failure:summary.failure,reviewRequired:summary.reviewRequired,
    verdict:summary.assessment.semanticVerdict,tableAdopted:false
  },null,2)+'\n');
  return summary;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(e=>{
    // Avoid printing exception objects from raw HTTP/body paths.
    const codes=new Set([
      'ARGS_REQUIRED','ARGS_INVALID','ABSOLUTE_PRIVATE_PATH_REQUIRED',
      'PRIVATE_FILES_MUST_BE_OUTSIDE_REPOSITORY','OUTPUT_ALREADY_EXISTS_NO_REPLAY',
      'INPUT_NOT_REGULAR_FILE','WCL_CLIENT_CREDENTIALS_NOT_PRESENT',
      'LOCAL_OAUTH_TOKEN_EXCHANGE_UNAVAILABLE',
      'OAUTH_TOKEN_REQUEST_NOT_SUCCESSFUL','OAUTH_TOKEN_RESPONSE_INVALID',
      'GITHUB_ACTIONS_LIVE_PROBE_REFUSED',
      'PRIVATE_PROBE_FIXTURE_INVALID','PRIVATE_PROBE_SLOT_INVALID',
      'REPORT_QUERY_SCOPE_INVALID','PRIVATE_PROBE_CONFIG_INVALID'
    ]);
    const msg=String(e?.message||'');
    const safe=msg.startsWith('ARGS_REQUIRED')?'ARGS_REQUIRED':
      codes.has(msg)?msg:'PROBE_ABORTED_INSPECT_PRIVATE_JOURNAL';
    process.stderr.write(safe+'\n');
    process.exitCode=1;
  });
}
