import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
const base=dirname(dirname(fileURLToPath(import.meta.url))),host=join(base,'hosts46/takeda');
const cfg=JSON.parse(await readFile(join(host,'host-config.json'))),spec=JSON.parse(await readFile(join(host,'SPEC.json'))),control=JSON.parse(await readFile(join(host,'control-base.json')));
if(process.env.JOBFINDER_CLOUD_SOURCE_ID!==cfg.sourceId||process.env.TSX_DISABLE_CACHE!=='1'||process.env.NODE_DISABLE_COMPILE_CACHE!=='1')throw Error('CHECK_ENV');
globalThis.fetch=async()=>{throw Error('NETWORK_FORBIDDEN');};
const sha=b=>createHash('sha256').update(b).digest('hex'),checks=[];
const reject=async(name,fn,code)=>{let e;try{await fn();}catch(x){e=x;}if(!String(e).includes(code))throw Error(name+':'+e);checks.push({name,expected:code,passed:true});};
const A=Object.getPrototypeOf(async function(){}).constructor,starter=await readFile(join(host,spec.starter),'utf8'),prefix=spec.prefix,now=Date.now();
const source={sourceResultId:'NONQUAL-SOURCE',sourceId:cfg.sourceId,batchId:'NONQUAL-BATCH',releaseCandidateId:'NONQUAL-CANDIDATE',sourceConfigHash:cfg.sourceConfigSha256,startedAt:new Date(now-13*3600000).toISOString(),finishedAt:new Date(now-13*3600000+60000).toISOString()};
const observation={id:'NONQUAL-OBSERVATION',sourceResultId:source.sourceResultId,sourceId:source.sourceId,batchId:source.batchId,releaseCandidateId:source.releaseCandidateId,sourceConfigSha256:source.sourceConfigHash,crawledAt:source.startedAt,observedFrom:source.startedAt,observedTo:source.finishedAt,successful:true,transportSucceeded:true,adapterSucceeded:true,completenessVerified:true,atomicCommitSucceeded:true};
const good={checkedAt:new Date(now).toISOString(),candidateRows:[{commitSha:spec.build.commitSha}],holderId:'',latestSuccessfulSource:{...source,observations:[observation]}};
let launchAttempts=0;
for(const [name,row,batch,code] of [
 ['occupied-lock',{...good,holderId:'OTHER'},'NONQUAL-GUARD','FRESH_CANDIDATE_PRECONDITION'],
 ['wrong-commit',{...good,candidateRows:[{commitSha:'0'.repeat(40)}]},'NONQUAL-GUARD','FRESH_CANDIDATE_PRECONDITION'],
 ['duplicate-candidate',{...good,candidateRows:[...good.candidateRows,...good.candidateRows]},'NONQUAL-GUARD','FRESH_CANDIDATE_PRECONDITION'],
 ['null-batch',good,null,'BATCH_ID'],['undefined-batch',good,undefined,'BATCH_ID'],
 ['stale-bootstrap',{...good,checkedAt:new Date(now-61000).toISOString()},'NONQUAL-GUARD','FRESH_BOOTSTRAP_EXPIRED_BEFORE_LAUNCH']
]){
 globalThis.__takedaFixture={cfg,q:JSON.stringify,rows:x=>x,save:async()=>{},readFile:async()=>({hash:'0'.repeat(64)}),cmd:async()=>''};
 globalThis.load=k=>k===prefix+'cloudPilotHostHelpers'?'return globalThis.__takedaFixture;':k===prefix+'nextBatchId'?batch:undefined;
 globalThis.store=()=>{};globalThis.notify=()=>{};
 globalThis.tools={mcp__codex_apps__supabase_execute_sql:async()=>[row],exec_command:async()=>{launchAttempts++;throw Error('REAL_LAUNCH_FORBIDDEN');}};
 await reject(name,()=>new A(starter)(),code);
}
if(launchAttempts)throw Error('UNEXPECTED_LAUNCH');
const {preflight}=await import(pathToFileURL(join(host,'runtime/preflight/preflight-launch.mjs')).href);
const root=join(host,'NONQUAL-GUARDS-'+randomUUID());await mkdir(root,{mode:0o700});
const candidate=JSON.parse(await readFile(join(base,'verification/CANDIDATE46_REGISTERED.json'))).candidate;
for(const [name,change,hashOverride,expected] of [
 ['bootstrap-hash',()=>{},'0'.repeat(64),'PREFLIGHT_BOOTSTRAP_HASH'],
 ['candidate-id',b=>b.candidateRows[0].id='wrong',null,'PREFLIGHT_CANDIDATE_BINDING'],
 ['candidate-version',b=>b.candidateRows[0].version=42,null,'PREFLIGHT_CANDIDATE_BINDING'],
 ['candidate-source-tree',b=>b.candidateRows[0].sourceTreeHash='0'.repeat(64),null,'PREFLIGHT_CANDIDATE_IDENTITY:sourceTreeHash'],
 ['candidate-runtime-tree',b=>b.candidateRows[0].runtimeTreeHash='0'.repeat(64),null,'PREFLIGHT_CANDIDATE_IDENTITY:runtimeTreeHash']
]){
 const bootstrap={schemaVersion:1,checkedAt:'2000-01-01T00:00:00.000Z',candidateRows:[structuredClone(candidate)],batchId:'NONQUAL-'+name};change(bootstrap);
 const bytes=JSON.stringify(bootstrap),path=join(root,name+'.json');await writeFile(path,bytes,{flag:'wx',mode:0o600});
 await reject(name,()=>preflight(['check',join(host,'host-config.json'),join(host,'control-base.json'),path,hashOverride??sha(bytes),join(root,name)]),expected);
}
// Evaluate the exact frozen DB-started context freshness predicate; preserve its 1s clock tolerance.
const contextSource=await readFile(join(cfg.repo,'src/crawler/cloudDbStartedPilot.ts'),'utf8');
const freshness=contextSource.match(/if\(!Number\.isFinite\(checkedAt\)[^\n]+throw Error\('PILOT_CONTEXT_FRESH_READ_REQUIRED'\);/)[0];
const checkContext=new Function('checkedAt','requestedAt','receivedAt','PILOT_BUDGET',freshness);
const {PILOT_BUDGET}=await import(pathToFileURL(join(cfg.repo,'src/crawler/cloudSourcePilotRelay.ts')).href);
for(const [name,checkedAt,requestedAt,receivedAt,accept] of [
 ['context-age-boundary',now-61000,now-100000,now,true],
 ['context-one-ms-expired',now-61001,now-100000,now,false],
 ['context-request-boundary',now-1000,now,now,true],
 ['context-predates-request',now-1001,now,now,false],
 ['context-future-tolerance',now+1000,now,now,true],
 ['context-too-far-future',now+1001,now,now,false],
 ['context-invalid-time',NaN,now,now,false]
]){
 if(accept){checkContext(checkedAt,requestedAt,receivedAt,PILOT_BUDGET);checks.push({name,passed:true});}
 else await reject(name,()=>checkContext(checkedAt,requestedAt,receivedAt,PILOT_BUDGET),'PILOT_CONTEXT_FRESH_READ_REQUIRED');
}
// Run the actual frozen DB-started function with a synthetic stale read-only response.
const {runDbStartedCloudPublication}=await import(pathToFileURL(join(cfg.repo,'src/crawler/cloudDbStartedPilot.ts')).href);
let relayCalls=0;const syntheticNow=Date.now();
await reject('actual-db-started-stale-context',()=>runDbStartedCloudPublication({
 controlPath:join(host,'control-base.json'),planned:{},source:{pending:{startedAt:new Date(syntheticNow)},sourceAdmissionPolicy:'PLAN_BOUND_SOURCE_QUALITY_V1'},
 initialCertificate:{schemaVersion:'plan-bound-source-quality-v1',acquisition:{finishedAt:new Date(syntheticNow).toISOString()}},
 relay:{sql:async(kind,sql)=>{relayCalls++;if(kind!=='READ_PUBLICATION_CONTEXT'||!sql.includes(cfg.sourceId))throw Error('UNEXPECTED_SQL');return [{context:{checkedAt:new Date(syntheticNow-62000).toISOString()}}];}}
}),'PILOT_CONTEXT_FRESH_READ_REQUIRED');
if(relayCalls!==1)throw Error('UNEXPECTED_PUBLICATION');
const {compileCloudPilotCreatePendingSql}=await import(pathToFileURL(join(cfg.repo,'src/db/cloudPilotSqlControl.ts')).href);
const {deriveCurrentStagedScheduleExpectation}=await import(pathToFileURL(join(cfg.repo,'src/crawler/stagedScheduleAuthority.ts')).href);
const {selectedPilotIdentity}=await import(pathToFileURL(join(cfg.repo,'scripts/p0-cloud-source-pilot.ts')).href);
const {buildPendingRuntimeBatch}=await import(pathToFileURL(join(cfg.repo,'src/crawler/runtimeAtomicEvidence.ts')).href);
const authority=deriveCurrentStagedScheduleExpectation(control.build),plan=authority.plans.find(p=>p.source.id===cfg.sourceId);
const planned=buildPendingRuntimeBatch('NONQUAL-GUARD-'+randomUUID(),[plan],selectedPilotIdentity({releaseCandidateId:control.candidate.id,commitSha:authority.commitSha,rosterSha256:authority.rosterSha256,sourcePlanSha256:authority.sourcePlanSha256,sourceConfigSha256:authority.sourceConfigSha256,adapterBundleSha256:authority.adapterBundleSha256}),new Date());
const sql=compileCloudPilotCreatePendingSql({...control,expiresAt:new Date(Date.now()+120000).toISOString(),holderId:randomUUID(),planned});
const escaped=sql.match(/jsonb_to_recordset\(E'((?:\\.|[^'])*)'::jsonb\) e\("migrationName" text,checksum text\)/);if(!escaped)throw Error('MIGRATION_PROJECTION');
const migrations=JSON.parse(escaped[1].replace(/\\([\\'])/g,'$1'));
if(migrations.length!==48)throw Error('MIGRATION_COUNT');
for(const m of migrations){const b=await readFile(join(cfg.repo,'prisma/migrations',m.migrationName,'migration.sql'));if(sha(b)!==m.checksum)throw Error('MIGRATION_CHECKSUM:'+m.migrationName);}
for(const token of ['PILOT_MIGRATION_HISTORY','PILOT_SQL45_GUARD_DRIFT','PILOT_CANDIDATE_DRIFT','CRAWL_LEASE_LOST','PILOT_REQUEST_EXPIRED','FOR UPDATE',cfg.sourceId,control.candidate.id])if(!sql.includes(token))throw Error('COMPILED_GUARD:'+token);
checks.push({name:'48-original-migrations-and-control-guards',passed:true,sqlExecuted:false});
const report={schemaVersion:1,sourceId:cfg.sourceId,passed:true,scope:'OFFLINE_SYNTHETIC_LAUNCH_PREFLIGHT_AND_CONTEXT_CHECKS',checks,actualStarterLaunchAttempts:launchAttempts,dbStartedSyntheticReadCalls:relayCalls,migrationCount:migrations.length,sourceNetworkAccessed:false,databaseAccessed:false,producerLaunched:false,contextGateSha256:sha(freshness),contextGateClockToleranceMs:1000,contextGateResponseAgeMs:PILOT_BUDGET.controlMs};
await writeFile(join(host,'GUARD_CHECKS.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({passed:true,checks:checks.length,launchAttempts,migrationCount:migrations.length}));
