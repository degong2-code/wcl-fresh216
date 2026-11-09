/**
 * Pure PUBLIC-only 1/2/4/8 alias packing benchmark.
 * All variants select the identical eight DamageDone tables.
 */
import {createHash} from 'node:crypto';
const check=(ok,code)=>{if(!ok)throw Error(code);};
const sha=o=>createHash('sha256').update(JSON.stringify(o)).digest('hex');
export const PUBLIC_FIGHTS=Object.freeze([
  {report:'L',code:'wyCNP6db8FrxG7gk',fight:50,encounter:3129,difficulty:1,targets:1},
  {report:'L',code:'wyCNP6db8FrxG7gk',fight:6,encounter:3132,difficulty:1,targets:1},
  {report:'L',code:'wyCNP6db8FrxG7gk',fight:10,encounter:3122,difficulty:1,targets:3},
  {report:'H',code:'rPRCwg6fjc9XdQLz',fight:2,encounter:3470,difficulty:4,targets:2}
]);
export const FIELDS=Object.freeze(PUBLIC_FIGHTS.flatMap((f,index)=>[
  {index:index*2,report:f.report,fight:f.fight,kind:'total'},
  {index:index*2+1,report:f.report,fight:f.fight,kind:'boss'}
]));
export const SIZES=Object.freeze([1,2,4,8]);
export const makeMetadataQuery=()=>({
  query:'query Fresh216PublicTableMetadata($l:String!,$h:String!){'+
    'rateLimitData{currentRequest} reportData{'+
    'rL:report(code:$l){code revision fights(fightIDs:[50,6,10])'+
    '{id encounterID difficulty startTime endTime enemyNPCs{id gameID}} '+
    'masterData{actors{id gameID type subType}}} '+
    'rH:report(code:$h){code revision fights(fightIDs:[2])'+
    '{id encounterID difficulty startTime endTime enemyNPCs{id gameID}} '+
    'masterData{actors{id gameID type subType}}}}}',
  variables:{l:PUBLIC_FIGHTS[0].code,h:PUBLIC_FIGHTS[3].code}
});
export function parseMetadata(body){
  check(body?.errors==null||Array.isArray(body.errors)&&!body.errors.length,
    'TABLE_BENCH_METADATA_GRAPHQL_ERROR');
  const rd=body?.data?.reportData;
  check(rd&&typeof rd==='object','TABLE_BENCH_METADATA_MISSING');
  const byReport={L:rd.rL,H:rd.rH},details={};
  for(const f of PUBLIC_FIGHTS){
    const report=byReport[f.report];
    check(report?.code===f.code&&Number.isSafeInteger(report.revision)&&
      Array.isArray(report.fights)&&Array.isArray(report.masterData?.actors),
      'TABLE_BENCH_REPORT_META_DRIFT');
    const fight=report.fights.filter(x=>x.id===f.fight);
    check(fight.length===1&&fight[0].encounterID===f.encounter&&
      fight[0].difficulty===f.difficulty&&
      fight[0].endTime>fight[0].startTime,
      'TABLE_BENCH_FIGHT_META_DRIFT');
    const npcIds=new Set((fight[0].enemyNPCs??[]).map(x=>x.id));
    const bosses=report.masterData.actors.filter(x=>
      x.type==='NPC'&&String(x.subType).toLowerCase()==='boss'&&
      npcIds.has(x.id));
    const ids=[...new Set(bosses.map(x=>x.gameID))];
    check(ids.length===f.targets&&ids.every(x=>Number.isSafeInteger(x)&&x>0),
      'TABLE_BENCH_BOSS_NPC_TARGET_DRIFT');
    details[f.report+':'+f.fight]={
      ids,reportRevision:report.revision,
      durationMs:fight[0].endTime-fight[0].startTime,
      code:report.code
    };
  }
  return details;
}
export function packTableAliases(size,metadata){
  check(SIZES.includes(size)&&metadata&&typeof metadata==='object',
    'TABLE_BENCH_PACK_INPUT_INVALID');
  const plans=[];
  for(let i=0;i<FIELDS.length;i+=size){
    const fields=FIELDS.slice(i,i+size);
    const reports=[...new Set(fields.map(x=>x.report))];
    const vars={},defs=[],groups=[];
    for(const reportId of reports){
      const code=PUBLIC_FIGHTS.find(x=>x.report===reportId).code;
      const codeVar='c'+reportId;
      defs.push('$'+codeVar+':String!');vars[codeVar]=code;
      const subFields=[];
      for(const field of fields.filter(x=>x.report===reportId)){
        const name='t'+field.index;
        const key=field.report+':'+field.fight;
        const meta=metadata[key];
        check(meta&&meta.code===code&&Array.isArray(meta.ids)&&
          meta.ids.length>0,'TABLE_BENCH_UNKNOWN_META');
        const fightVar='f'+field.index;
        defs.push('$'+fightVar+':Int!');vars[fightVar]=field.fight;
        let filter='';
        if(field.kind==='boss'){
          const varName='expr'+field.index;
          defs.push('$'+varName+':String!');
          vars[varName]='target.id IN ('+meta.ids.join(', ')+')';
          filter=',filterExpression:$'+varName;
        }
        subFields.push(name+':table(dataType:DamageDone,'+
          'fightIDs:[$'+fightVar+'],viewBy:Source'+filter+')');
      }
      groups.push('r'+reportId+':report(code:$'+codeVar+')'+
        '{code revision '+subFields.join(' ')+'}');
    }
    const query='query Fresh216TableAliasPack('+defs.join(',')+')'+
      '{rateLimitData{currentRequest} reportData{'+groups.join(' ')+'}}';
    plans.push({size,fields,query,variables:vars,
      fingerprint:sha({query,vars})});
  }
  check(plans.reduce((n,p)=>n+p.fields.length,0)===8,
    'TABLE_BENCH_COVERAGE_INCOMPLETE');
  return plans;
}
const validNum=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
export function observedPoints(body){
  let r=body?.data?.rateLimitData?.currentRequest;
  if(typeof r==='string'){try{r=JSON.parse(r);}catch{r=null;}}
  return {points:validNum(r?.total)?r.total:null,
    databasePoints:validNum(r?.database)?r.database:null,
    appPoints:validNum(r?.application)?r.application:null};
}
export function summarizeTableAliases(plan,metadata,{httpStatus,body,wallMs,bytes}={}){
  check(plan&&SIZES.includes(plan.size)&&Array.isArray(plan.fields)&&
    validNum(wallMs)&&Number.isSafeInteger(bytes)&&bytes>=0,
    'TABLE_BENCH_RESULT_INPUT_INVALID');
  const cost=observedPoints(body);
  const fail=reason=>({status:reason,size:plan.size,
    fields:plan.fields.length,wallMs,bytes,points:cost.points,
    databasePoints:cost.databasePoints,tableCount:0,tables:[]});
  if(httpStatus!==200||!body||body.errors!=null&&
    (!Array.isArray(body.errors)||body.errors.length)||cost.points===null)
    return fail('TABLE_BENCH_HTTP_OR_COST_UNKNOWN');
  const tables=[];
  for(const field of plan.fields){
    const f=PUBLIC_FIGHTS.find(x=>x.report===field.report&&x.fight===field.fight);
    const got=body.data?.reportData?.['r'+field.report];
    const expected=metadata[field.report+':'+field.fight];
    if(!f||!got||got.code!==f.code||got.revision!==expected.reportRevision)
      return fail('TABLE_BENCH_REPORT_REVISION_DRIFT');
    const table=got['t'+field.index];
    if(!table||!Array.isArray(table.data?.entries)||
      table.data.entries.length===0)
      return fail('TABLE_BENCH_TABLE_SHAPE_INVALID');
    tables.push({fieldIndex:field.index,kind:field.kind,
      rowCount:table.data.entries.length,sha256:sha(table)});
  }
  return {status:'MEASURED',size:plan.size,fields:plan.fields.length,
    wallMs,bytes,points:cost.points,databasePoints:cost.databasePoints,
    appPoints:cost.appPoints,tableCount:tables.length,tables};
}
export function comparePackedVariants(results){
  check(Array.isArray(results)&&results.length===4&&
    results.every((v,i)=>v.size===SIZES[i]&&v.results?.length===8/v.size),
    'TABLE_BENCH_SHAPE_INCOMPLETE');
  const base=new Map(),out=[];
  for(const variant of results){
    check(variant.results.every(r=>r.status==='MEASURED'),
      'TABLE_BENCH_UNMEASURED_VARIANT');
    let points=0,db=0,wallMs=0,bytes=0;
    for(const r of variant.results){
      points+=r.points;
      db+=r.databasePoints??0;
      wallMs+=r.wallMs;
      bytes+=r.bytes;
      for(const table of r.tables){
        if(!base.has(table.fieldIndex))base.set(table.fieldIndex,table.sha256);
        else out.push(base.get(table.fieldIndex)===table.sha256);
      }
    }
    variant.total={points:Number(points.toFixed(3)),databasePoints:db,
      wallMs,bytes,requests:variant.results.length,fields:8};
  }
  return {variants:results.map(x=>({size:x.size,...x.total})),
    overlaps:out.length,overlapsEqual:out.filter(Boolean).length,
    allEqual:out.every(Boolean)};
}