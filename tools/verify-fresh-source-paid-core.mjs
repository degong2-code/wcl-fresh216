#!/usr/bin/env node
/**
 * Guard against silently changing the charged A source engine while resuming
 * a checkpoint whose sourceCodeCommit pins a DIFFERENT product checkout.
 * Compares the actual origin checkout and successor checkout, no WCL.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const need=(v,c)=>{if(!v)throw Error(c);};
const digest=s=>createHash('sha256').update(s).digest('hex');
const single=(s,fragment)=>{
  let a=s.indexOf(fragment);
  need(a>=0&&s.indexOf(fragment,a+fragment.length)<0,
    'SOURCE_PAID_CORE_BOUNDARY_DRIFT');
  return a;
};
export function paidSourceCoreSegment(s){
  need(typeof s==='string'&&s.length>1000,
    'SOURCE_PAID_CORE_INPUT_INVALID');
  const start=single(s,'/** Refuse export unless');
  const end=single(s,'/** Default PREVIEW');
  need(end>start,'SOURCE_PAID_CORE_EXPORT_BOUNDARY_INVALID');
  return s.slice(0,start)+'\n/* EXPORT_ONLY_SECTION_OMITTED */\n'+s.slice(end);
}
export function verifyFreshSourcePaidCompatibility(origin,current){
  need(origin&&current&&typeof origin==='object'&&
    typeof current==='object','SOURCE_PAID_CORE_INPUT_INVALID');
  const exact=[
    'src/core/fresh-cohort-bounded-runner.mjs',
    'src/core/checkpoint.mjs',
    'src/adapters/json-checkpoint-store.mjs',
    'src/adapters/private-fresh-cohort-host.mjs'
  ];
  const source='src/core/fresh-cohort-source.mjs';
  const storage='tools/run-private-github-fresh216.mjs';
  const names=[...exact,source,storage];
  for(const p of names)need(typeof origin[p]==='string'&&
    typeof current[p]==='string',
    'SOURCE_PAID_CORE_MISSING_MODULE');
  for(const p of exact)need(origin[p]===current[p],
    'SOURCE_PAID_CORE_MODULE_DRIFT');
  need(paidSourceCoreSegment(origin[source])===
    paidSourceCoreSegment(current[source]),
    'SOURCE_PAID_CORE_SOURCE_CODE_DRIFT');
  const storageSegment=s=>{
    let a=single(s,'export function makeGitDurableStore(');
    let b=single(s,'export function restoreGitAdaptiveWitnesses');
    need(b>a,'SOURCE_PAID_CORE_STORAGE_BOUNDARY');
    return s.slice(a,b);
  };
  need(storageSegment(origin[storage])===
    storageSegment(current[storage]),
    'SOURCE_PAID_CORE_GIT_DURABILITY_DRIFT');
  const chunks=exact.map(p=>origin[p])
    .concat(paidSourceCoreSegment(origin[source]))
    .concat(storageSegment(origin[storage]));
  return Object.freeze({
    status:'SOURCE_PAID_CORE_COMPATIBLE',
    originAndSuccessorPaidCoreSha256:digest(chunks.join('\n')),
    modulesVerified:names.length,
    paidOperationSemanticChanges:0
  });
}
function readModules(root){
  need(typeof root==='string'&&path.isAbsolute(root),
    'SOURCE_PAID_CORE_PATH_INVALID');
  const names=['src/core/fresh-cohort-source.mjs',
    'src/core/fresh-cohort-bounded-runner.mjs',
    'src/core/checkpoint.mjs',
    'src/adapters/json-checkpoint-store.mjs',
    'src/adapters/private-fresh-cohort-host.mjs',
    'tools/run-private-github-fresh216.mjs'];
  return Object.fromEntries(names.map(p=>[
    p,fs.readFileSync(path.join(root,p),'utf8')
  ]));
}
const self=path.resolve(fileURLToPath(import.meta.url));
if(process.argv[1]&&path.resolve(process.argv[1])===self){
  try{
    need(process.argv.length===4,
      'SOURCE_PAID_CORE_TWO_CHECKOUTS_REQUIRED');
    console.log(JSON.stringify(verifyFreshSourcePaidCompatibility(
      readModules(path.resolve(process.argv[2])),
      readModules(path.resolve(process.argv[3])))));
  }catch(e){
    const code=String(e.message??'');
    console.error(/^SOURCE_PAID_CORE_/.test(code)?code:
      'SOURCE_PAID_CORE_UNVERIFIED');
    process.exitCode=1;
  }
}
