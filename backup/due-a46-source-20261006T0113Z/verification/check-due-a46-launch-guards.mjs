import {readFile,writeFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const base=dirname(dirname(fileURLToPath(import.meta.url))),keys=['sph','csl','lilly','daiichi','cr'],A=Object.getPrototypeOf(async function(){}).constructor;
for(const key of keys){
 const host=join(base,'hosts46',key),cfg=JSON.parse(await readFile(join(host,'host-config.json'))),spec=JSON.parse(await readFile(join(host,'SPEC.json'))),starter=await readFile(join(host,spec.starter),'utf8'),now=Date.now(),started=new Date(now-13*3600000).toISOString(),finished=new Date(now-13*3600000+60000).toISOString(),prefix=spec.prefix;
 const source={sourceResultId:'NONQUAL-LOCK-SOURCE',sourceId:cfg.sourceId,batchId:'NONQUAL-LOCK-BATCH',releaseCandidateId:'NONQUAL-LOCK-CANDIDATE',sourceConfigHash:cfg.sourceConfigSha256,startedAt:started,finishedAt:finished};
 const observation={id:'NONQUAL-LOCK-OBSERVATION',sourceResultId:source.sourceResultId,sourceId:cfg.sourceId,batchId:source.batchId,releaseCandidateId:source.releaseCandidateId,sourceConfigSha256:cfg.sourceConfigSha256,crawledAt:started,observedFrom:started,observedTo:finished,successful:true,transportSucceeded:true,adapterSucceeded:true,completenessVerified:true,atomicCommitSucceeded:true};
 const good={checkedAt:new Date(now).toISOString(),candidateRows:[{commitSha:spec.build.commitSha}],holderId:'',latestSuccessfulSource:{...source,observations:[observation]}};
 const tests=[['occupied-coordinator-lock',{...good,holderId:'OTHER-RUN'},'FRESH_CANDIDATE_PRECONDITION'],['wrong-candidate-commit',{...good,candidateRows:[{commitSha:'0'.repeat(40)}]},'FRESH_CANDIDATE_PRECONDITION'],['duplicate-candidate-row',{...good,candidateRows:[...good.candidateRows,...good.candidateRows]},'FRESH_CANDIDATE_PRECONDITION'],['stale-bootstrap',{...good,checkedAt:new Date(now-61000).toISOString()},'FRESH_BOOTSTRAP_EXPIRED_BEFORE_LAUNCH']];
 let launchAttempts=0;const checks=[];
 for(const [name,row,expected] of tests){
  let saves=0,preflights=0;
  const helper='return '+JSON.stringify({cfg})+';';
  const h={cfg,q:JSON.stringify,rows:r=>r,save:async()=>{saves++;},readFile:async()=>({hash:'0'.repeat(64)}),cmd:async()=>{preflights++;return 'NONQUAL_ONLY';}};
  globalThis.__dueAGuardHelper=h;globalThis.load=k=>{if(k===prefix+'cloudPilotHostHelpers')return 'return globalThis.__dueAGuardHelper;';if(k===prefix+'nextBatchId')return 'NONQUAL-LAUNCH-GUARD';throw Error('UNEXPECTED_LOAD:'+k);};globalThis.store=(k,v)=>{if(!k.startsWith(prefix))throw Error('CROSS_NAMESPACE');};globalThis.notify=()=>{};
  globalThis.tools={mcp__codex_apps__supabase_execute_sql:async a=>{if(a.project_id!==cfg.project||!a.query.includes("id='formal-crawl'")||!a.query.includes(cfg.sourceId))throw Error('STARTER_SQL_SCOPE');return [row];},exec_command:async()=>{launchAttempts++;throw Error('REAL_LAUNCH_FORBIDDEN');}};
  let error;try{await new A(starter)();}catch(e){error=e;}
  if(!String(error).includes(expected)||launchAttempts!==0)throw Error('GUARD_FAILURE:'+key+':'+name+':'+error);
  if(name!=='stale-bootstrap'&&(saves!==0||preflights!==0))throw Error('PRECONDITION_SIDE_EFFECT');
  checks.push({name,passed:true,error:expected,savesInMemory:saves,preflightStubs:preflights,launchAttempts});
 }
 await writeFile(join(host,'LAUNCH_GUARD_TEST_RESULTS.json'),JSON.stringify({passed:true,purpose:'ACTUAL_STARTER_WITH_IN_MEMORY_SQL_AND_PREFLIGHT_STUBS',sourceId:cfg.sourceId,sourceNetworkAccessed:false,databaseAccessed:false,producerLaunched:false,launchAttempts,checks},null,2)+'\n',{flag:'wx',mode:0o600});
}
console.log(JSON.stringify({passed:true,sources:keys.length,actualStarterCounterexamples:keys.length*4,realLaunchAttempts:0}));
