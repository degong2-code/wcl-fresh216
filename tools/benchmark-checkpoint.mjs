/**
 * Reproducible OFFLINE checkpoint I/O probe at full216 EXACT-100 scale.
 *
 * Usage: node tools/benchmark-checkpoint.mjs [--samples=3]
 * No credentials, network, Sheets, production state or private rankings.
 * This benchmark is a synthetic filesystem workload, NOT WCL wall time.
 *
 * 21,600 rank references -> 800 invented report/fight groups (27 spec refs
 * per fight). This is a deliberate load shape, NOT observed real WCL overlap.
 * Each seeded proof is synthetic; no actor is claimed to be WCL validated.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {randomUUID} from 'node:crypto';
import {planFull216} from '../src/core/full-scope-plan.mjs';
import {JsonCheckpointStore} from '../src/adapters/json-checkpoint-store.mjs';
import {JournalCheckpointStore} from '../src/adapters/journal-checkpoint-store.mjs';
import {
  newCheckpoint,registerPlan,beginFetch,completeFetch,checkpointStats
} from '../src/core/checkpoint.mjs';

const arg=process.argv.slice(2);
if(arg.some(x=>!/^--samples=[1-9][0-9]?$/.test(x))||arg.length>1)
  throw Error('ONLY_OPTION_IS_--samples=1..99');
const samples=arg.length?Number(arg[0].split('=')[1]):3;
if(samples>8)throw Error('MAX_8_SAMPLES_TO_BOUND_CI_COST');
/**
 * Comparison reference: pre-optimization single-file JSON implementation,
 * reproduced ONLY in this synthetic bench. Not used by the collector.
 */
class BaselineUncachedJsonStore extends JsonCheckpointStore {
  read(){return JSON.parse(fs.readFileSync(this.filePath,'utf8'));}
  update(transition){
    fs.mkdirSync(this.lockPath,{mode:0o700});
    let temp;
    try{
      const previous=this.read();
      const next=transition(structuredClone(previous));
      if(next.runId!==previous.runId||next.scopeKey!==previous.scopeKey||
         next.version!==previous.version+1)
        throw Error('REFERENCE_VERSION_OR_SCOPE_DRIFT');
      temp=path.join(path.dirname(this.filePath),
        '.'+path.basename(this.filePath)+'.'+randomUUID()+'.tmp');
      const fd=fs.openSync(temp,'wx',0o600);
      try{fs.writeFileSync(fd,JSON.stringify(next)+'\n');fs.fsyncSync(fd);}
      finally{fs.closeSync(fd);}
      fs.renameSync(temp,this.filePath);temp=null;
      const dirfd=fs.openSync(path.dirname(this.filePath),'r');
      try{fs.fsyncSync(dirfd);}finally{fs.closeSync(dirfd);}
      return this.read();
    }finally{
      if(temp&&fs.existsSync(temp))fs.unlinkSync(temp);
      fs.rmdirSync(this.lockPath);
    }
  }
}

const sha=i=>(i.toString(16).padStart(64,'0'));
const scope='SYNTHETIC_HEROIC_216_CHECKPOINT_BENCHMARK';
const ranks=[];
for(let boss=0;boss<8;boss++){
  for(let spec=0;spec<27;spec++){
    for(let rank=1;rank<=100;rank++){
      ranks.push({
        scopeKey:scope,jobKey:`Boss${boss}|Class${spec}|Spec${spec}`,
        rank,snapshotSha:sha(1+boss*27+spec),status:'PENDING',
        name:'Anonymous',className:`Class${spec}`,specName:`Spec${spec}`,
        totalDps:100000-rank*100-spec,
        reportCode:'SYNTHETIC_REPORT_'+boss,
        fightId:rank,encounterId:3470+boss,difficulty:4,reportRevision:1
      });
    }
  }
}
const graph=planFull216(ranks);
if(graph.jobs!==216||graph.rankSlots!==21600||graph.groups.length!==800)
  throw Error('FULL216_SYNTHETIC_SHAPE_INVALID');
const initial=registerPlan(newCheckpoint(scope,'BENCHMARK_ONLY'),graph.groups);
const entryKeys=Object.keys(initial.entries);
const joinedFor=e=>({verified:e.slots.map(s=>({
  jobKey:s.jobKey,rank:s.rank,snapshotSha:s.snapshotSha,
  proof:{proofType:'EXACT_SAME_FIGHT_ACTOR',actorRef:'id:1',
    bossDps:s.totalDps*0.7,snapshotSha:s.snapshotSha,
    reportCode:e.identity.reportCode,fightId:e.identity.fightId,
    encounterId:e.identity.encounterId,difficulty:e.identity.difficulty,
    reportRevision:e.identity.reportRevision}
})),unresolved:[]});
const percentile=(values,p)=>{
  const sorted=[...values].sort((a,b)=>a-b);
  return Math.round(sorted[Math.ceil(p*sorted.length)-1]*100)/100;
};
const measure=fn=>{
  const at=performance.now(),out=fn();
  return {value:out,ms:performance.now()-at};
};
const root=fs.mkdtempSync(path.join(os.tmpdir(),'fresh216-io-synthetic-'));
try{
  const phases=[];
  const footprints=(type,location)=>{
    if(type!=='APPEND_ONLY_JOURNAL')return fs.statSync(location).size;
    const eventsPath=path.join(location,'events');
    return fs.statSync(path.join(location,'base.json')).size+
      fs.readdirSync(eventsPath).reduce(
        (sum,name)=>sum+fs.statSync(path.join(eventsPath,name)).size,0);
  };
  for(const completed of [0,400,800-samples]){
    for(const type of ['BASELINE_UNCACHED_JSON','FULL_JSON','APPEND_ONLY_JOURNAL']){
      const seed=structuredClone(initial);
      for(let i=0;i<completed;i++){
        const e=seed.entries[entryKeys[i]];
        e.status='COMPLETED';
        e.attempt={id:'SYNTHETIC_SEED_'+i,startedAtMs:1};
        e.result=joinedFor(e);
        e.observedPoints=1; // test marker only; never a real WCL charge
        e.wallMs=1;
      }
      const stage=['EMPTY','HALF_EVIDENCE','NEAR_FULL_EVIDENCE'][
        Math.floor(phases.length/3)];
      const location=path.join(root,stage+'_'+type+
        (type==='APPEND_ONLY_JOURNAL'?'':'.json'));
      const Store=type==='BASELINE_UNCACHED_JSON'?BaselineUncachedJsonStore:
        type==='FULL_JSON'?JsonCheckpointStore:JournalCheckpointStore;
      const store=new Store(location);
      const init=measure(()=>store.init(seed)).ms;
      const startBytes=footprints(type,location);
      const beginTimes=[],finishTimes=[];
      for(let i=0;i<samples;i++){
        const key=entryKeys[completed+i];
        const attemptId='SYNTHETIC_ATTEMPT_'+stage+'_'+i;
        const started=measure(()=>store.update(s=>beginFetch(s,key,attemptId,10)));
        beginTimes.push(started.ms);
        const joined=joinedFor(started.value.entries[key]);
        const finished=measure(()=>store.update(s=>completeFetch(s,key,attemptId,
          joined,{points:1,wallMs:1})));
        finishTimes.push(finished.ms);
      }
      const last=store.read(),stats=checkpointStats(last);
      if(stats.counts.COMPLETED!==completed+samples||
         stats.verifiedSlotEvidence!==(completed+samples)*27||
         stats.counts.IN_FLIGHT!==0||stats.counts.NEEDS_REVIEW!==0)
        throw Error('BENCHMARK_DURABILITY_OR_COUNT_MISMATCH');
      const cold=measure(()=>new Store(location).read());
      if(JSON.stringify(cold.value)!==JSON.stringify(last))
        throw Error('BENCHMARK_COLD_RESTART_REPLAY_MISMATCH');
      const endBytes=footprints(type,location);
      phases.push({
        storeType:type,stage,seedCompletedFightGroups:completed,samples,
        initialCheckpointBytes:startBytes,finalCheckpointBytes:endBytes,
        initMs:Math.round(init*100)/100,
        coldRestartReadMs:Math.round(cold.ms*100)/100,
        beginMsP50:percentile(beginTimes,.5),
        beginMsP95:percentile(beginTimes,.95),
        completeMsP50:percentile(finishTimes,.5),
        completeMsP95:percentile(finishTimes,.95),
        measuredTransitions:samples*2,readbackVerified:true,
        benchmarkLimit:'PRESEEDED_BASELINE; NOT FULL_HISTORY_JOURNAL_REPLAY'
      });
    }
  }
  console.log('FRESH216_OFFLINE_CHECKPOINT_BENCHMARK='+JSON.stringify({
    testKind:'SYNTHETIC_21600_RANK_CHECKPOINT_IO_COMPARISON',
    oneFightPerOperation:true,
    inventedFightGroups:800,ranks:21600,jobs:216,
    sampleHost:'GITHUB_ACTIONS_OR_LOCAL_FILESYSTEM_NOT_PRODUCTION',
    noWclRequests:true,noSheetWrites:true,realApiPointSavings:null,
    realCollectorWallTimeImprovement:null,
    limitations:[
      'SYNTHETIC_800_FIGHT_OVERLAP_NOT_MEASURED_IN_REAL_WCL',
      'EACH_PROGRESS_STAGE_PRESEEDED_NO_FULL_LENGTH_REPLAY_OR_COMPACTION',
      'SMALL_SAMPLES_UNCONTROLLED_CI_HOST',
      'PRIVATE_TARGET_HOST_PERFORMANCE_UNMEASURED'
    ],
    phases
  }));
}finally{
  fs.rmSync(root,{recursive:true,force:true});
}
