import test from 'node:test';
import assert from 'node:assert/strict';
import {PUBLIC_FIGHTS,FIELDS,SIZES,makeMetadataQuery,parseMetadata,
  packTableAliases,summarizeTableAliases,comparePackedVariants
} from '../tools/lib/fresh216-public-table-alias-core.mjs';
const info={
 L:{code:PUBLIC_FIGHTS[0].code,revision:3,
  fights:PUBLIC_FIGHTS.slice(0,3).map((f,i)=>({
   id:f.fight,encounterID:f.encounter,difficulty:f.difficulty,
   startTime:1000,endTime:21000,
   enemyNPCs:Array.from({length:f.targets},(_,j)=>({id:100+i*10+j}))
  })),
  masterData:{actors:PUBLIC_FIGHTS.slice(0,3).flatMap((f,i)=>
   Array.from({length:f.targets},(_,j)=>({
    id:100+i*10+j,gameID:400+i*10+j,type:'NPC',subType:'Boss'
   })))}
 },
 H:{code:PUBLIC_FIGHTS[3].code,revision:8,
  fights:[{id:2,encounterID:3470,difficulty:4,startTime:5000,endTime:35000,
    enemyNPCs:[{id:200},{id:201}]}],
  masterData:{actors:[{id:200,gameID:501,type:'NPC',subType:'Boss'},
    {id:201,gameID:502,type:'NPC',subType:'Boss'}]}}
};
const meta=()=>parseMetadata({data:{reportData:{rL:info.L,rH:info.H}}});
const fake=p=>{
 const rL={code:info.L.code,revision:info.L.revision},
   rH={code:info.H.code,revision:info.H.revision};
 for(const f of p.fields)(f.report==='L'?rL:rH)['t'+f.index]={
  data:{entries:[{id:1,name:'Synthetic',total:f.index+100}]}};
 return {data:{rateLimitData:{currentRequest:{
  total:p.size+0.1,database:0,application:p.size+0.1
 }},reportData:{rL,rH}}};
};
test('the same eight tables are queried in all four packings',()=>{
 assert.equal(PUBLIC_FIGHTS.length,4);
 assert.equal(FIELDS.length,8);
 assert.match(makeMetadataQuery().query,/masterData/);
 assert.deepEqual(Object.keys(meta()).length,4);
 assert.deepEqual(SIZES.map(s=>packTableAliases(s,meta()).length),[8,4,2,1]);
 for(const s of SIZES){
  const p=packTableAliases(s,meta());
  assert.deepEqual(p.flatMap(q=>q.fields.map(f=>f.index)).sort((a,b)=>a-b),
    [0,1,2,3,4,5,6,7]);
  assert.equal(p.every(q=>q.query.includes('rateLimitData{currentRequest}')),true);
 }
 assert.match(packTableAliases(8,meta())[0].query,/rH:report/);
 assert.match(packTableAliases(8,meta())[0].variables.expr5,
   /target.id IN \(420, 421, 422\)/);
});
test('all 24 cross-packing witnesses agree exactly',()=>{
 const m=meta();
 const variants=SIZES.map(size=>({size,results:packTableAliases(size,m).map(p=>
  summarizeTableAliases(p,m,{httpStatus:200,body:fake(p),
   wallMs:10,bytes:200}))}));
 const out=comparePackedVariants(variants);
 assert.equal(out.overlaps,24);
 assert.equal(out.overlapsEqual,24);
 assert.deepEqual(out.variants.map(v=>v.requests),[8,4,2,1]);
});
test('fail closed on unknown cost, HTTP errors, report revision and missing table',()=>{
 const m=meta(),p=packTableAliases(1,m)[0];
 const b=summarizeTableAliases(p,m,{httpStatus:401,
  body:{errors:[{message:'private secret'}]},wallMs:1,bytes:15});
 assert.equal(b.status,'TABLE_BENCH_HTTP_OR_COST_UNKNOWN');
 assert.equal(JSON.stringify(b).includes('private secret'),false);
 const r=fake(p);r.data.reportData.rL.revision=123;
 assert.equal(summarizeTableAliases(p,m,{httpStatus:200,body:r,wallMs:1,bytes:100}).status,
  'TABLE_BENCH_REPORT_REVISION_DRIFT');
 const x=fake(p);delete x.data.reportData.rL.t0.data.entries;
 assert.equal(summarizeTableAliases(p,m,{httpStatus:200,body:x,wallMs:1,bytes:100}).status,
  'TABLE_BENCH_TABLE_SHAPE_INVALID');
});