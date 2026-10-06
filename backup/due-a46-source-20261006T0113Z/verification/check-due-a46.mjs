import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
const base='/workspace/scratch/5e9614251709/jb-workspace-recovery-20261005T2019Z',root=join(base,'hosts46');
const key=process.argv[2],testId=randomUUID().slice(0,8);if(!['sph','csl','lilly','daiichi','cr'].includes(key))throw Error('CHECK_SELECTION');
const host=join(root,key),cfg=JSON.parse(await readFile(join(host,'host-config.json'))),spec=JSON.parse(await readFile(join(host,'SPEC.json'))),control=JSON.parse(await readFile(join(host,'control-base.json'))),prefix=spec.prefix;
if(process.env.JOBFINDER_CLOUD_SOURCE_ID!==cfg.sourceId||process.env.TSX_DISABLE_CACHE!=='1')throw Error('CHECK_PROCESS_ENV');
globalThis.fetch=async()=>{throw Error('PREPARATION_NETWORK_FORBIDDEN');};
const sha=x=>createHash('sha256').update(x).digest('hex'),A=Object.getPrototypeOf(async function(){}).constructor;
const imp=p=>import(pathToFileURL(join(cfg.repo,p)).href),checks=[],commands=[];
const ok=(check,more={})=>checks.push({check,passed:true,...more});
async function rejects(fn,code){let found;try{await fn();}catch(e){found=e;}if(!String(found).includes(code))throw Error('EXPECTED_REJECTION:'+code+':'+found);}
const {deriveCurrentStagedScheduleExpectation}=await imp('src/crawler/stagedScheduleAuthority.ts');
const {sourcePlanConfigSha256}=await imp('src/crawler/sourcePlan.ts');
const {compileCloudPilotPublicationContextSql,CLOUD_PILOT_SOURCE}=await imp('src/db/cloudPilotSqlControl.ts');
const {SOURCE_QUALITY_POLICY_ID}=await imp('src/crawler/sourceQualityAdmission.ts');
const {deriveDbStartedPublicationExpiry}=await imp('src/db/ingestionRepository.ts');
const {PILOT_BUDGET}=await imp('src/crawler/cloudSourcePilotRelay.ts');
const {selectedPilotIdentity,PILOT_SOURCE}=await imp('scripts/p0-cloud-source-pilot.ts');
const {buildPendingRuntimeBatch}=await imp('src/crawler/runtimeAtomicEvidence.ts');
const authority=deriveCurrentStagedScheduleExpectation(spec.build),plan=authority.plans.find(p=>p.source.id===cfg.sourceId);
if(!plan||sourcePlanConfigSha256(plan)!==cfg.sourceConfigSha256||PILOT_SOURCE!==cfg.sourceId||CLOUD_PILOT_SOURCE.id!==cfg.sourceId)throw Error('CANONICAL_IMPORT_BINDING');
const {expiresAt,...dbControl}=control,sql=compileCloudPilotPublicationContextSql(dbControl,spec.route==='PORTABLE'?SOURCE_QUALITY_POLICY_ID:undefined);
if(sql!==await readFile(join(host,'context-read.sql'),'utf8')||sha(sql)!==spec.readContextSqlSha256)throw Error('CONTEXT_COMPILER_BYTES');
if(!sql.includes(spec.certificateSchema)||!sql.includes(cfg.sourceId))throw Error('CONTEXT_POLICY');
const start=new Date('2026-10-04T00:00:00Z'),finish=new Date('2026-10-04T00:01:00Z');
const deadline=deriveDbStartedPublicationExpiry({startedAt:start,completenessCertificate:spec.route==='A'?{schemaVersion:spec.certificateSchema}:{schemaVersion:spec.certificateSchema,acquisition:{finishedAt:finish.toISOString()}}});
if(deadline!==(spec.route==='A'?start:finish).getTime()+1800000||PILOT_BUDGET.publishDbMs+PILOT_BUDGET.publishTransportMs!==165000||PILOT_BUDGET.controlCompletionMs!==25000)throw Error('ORIGINAL_TIME_CONTRACT_CHANGED');
ok('canonical plan, current config, original certificate route/compiler, 30m evidence and exact control reserves',{sourceConfigSha256:cfg.sourceConfigSha256,sqlExecuted:false,contextDeadlineOffsetMs:1635000,contextDispatchOffsetMs:1610000});
for(const [dest,v]of Object.entries(spec.templateFiles)){
 if(sha(await readFile(v.originalPath))!==v.originalSha256||sha(await readFile(join(host,dest)))!==v.sha256)throw Error('TEMPLATE_OR_PREPARED_FILE_CHANGED:'+dest);
 const t=await readFile(join(host,dest),'utf8');
 if(dest.endsWith('.js')){
  new A('root','sourceId','candidateId','commit','sourceKey',t);
  for(const m of t.matchAll(/\b(?:load|store)\(["']([^"']+)["']/g))if(!m[1].startsWith(prefix))throw Error('STORE_NAMESPACE:'+dest);
 }
 if(/\.(mjs|mts)$/.test(dest))execFileSync(process.execPath,['--check',join(host,dest)],{encoding:'utf8',timeout:15000});
 if(dest.endsWith('.py'))execFileSync('python3',['-c','import ast,sys;ast.parse(open(sys.argv[1]).read())',join(host,dest)],{encoding:'utf8',timeout:15000});
 if(!dest.includes('review-publication.py')&&(t.includes('/hosts/servier/')||t.includes('/hosts/true-a42-next/csl/')||t.includes('/hosts/portable42-following/')))throw Error('STALE_HOST_PATH:'+dest);
}
ok('all host/runtime/reviewer syntax, exact namespace, source-specific nested paths, original template bytes preserved');
const starter=await readFile(join(host,'runtime',spec.route==='A'?'start-monitor-true-a42.js':'start-monitor-portable42.js'),'utf8');
if(!starter.includes(spec.entrypoint)||!starter.includes('--max-old-space-size='+spec.heapMiB)||!starter.includes('--db-started-control')||!starter.includes('P0_SOURCE_HTTP_TIMEOUT_MS=45000'))throw Error('STARTER_ROUTE_OR_RESOURCE');
const gate=t=>t.split('// BEGIN OBSERVATION_DUE_GATE\n')[1].split('// END OBSERVATION_DUE_GATE')[0];
if(gate(starter)!==gate(await readFile(join(host,'originals',spec.starter),'utf8')))throw Error('DUE_GATE_BYTES_CHANGED');
const requireDue=new Function(gate(starter)+';return requireObservationDue;')();
// Synthetic in-memory gate fixture only; no DB queue or bootstrap authority is asserted.
const dueAt=Date.parse('2026-10-05T12:00:00.000Z');
const fixtureSource={sourceResultId:'NONQUAL-SOURCE-RESULT',sourceId:cfg.sourceId,batchId:'NONQUAL-BATCH',releaseCandidateId:'NONQUAL-CANDIDATE',sourceConfigHash:cfg.sourceConfigSha256,startedAt:'2026-10-04T23:59:00.000Z',finishedAt:'2026-10-05T00:01:00.000Z'};
const o={id:'NONQUAL-OBSERVATION',sourceResultId:fixtureSource.sourceResultId,sourceId:cfg.sourceId,batchId:fixtureSource.batchId,releaseCandidateId:fixtureSource.releaseCandidateId,sourceConfigSha256:cfg.sourceConfigSha256,crawledAt:'2026-10-05T00:00:00.000Z',observedFrom:fixtureSource.startedAt,observedTo:fixtureSource.finishedAt,successful:true,transportSucceeded:true,adapterSucceeded:true,completenessVerified:true,atomicCommitSucceeded:true};
const dueRow={checkedAt:new Date(dueAt).toISOString(),candidateRows:[],holderId:'',latestSuccessfulSource:{...fixtureSource,observations:[o]}};
if(requireDue(dueRow,cfg).nextEligibleAt!==new Date(dueAt).toISOString())throw Error('DUE_EXACT_THRESHOLD');
await rejects(()=>requireDue({...dueRow,checkedAt:new Date(dueAt-1).toISOString()},cfg),'SOURCE_NOT_DUE');
await rejects(()=>requireDue({...dueRow,latestSuccessfulSource:{...dueRow.latestSuccessfulSource,observations:[...dueRow.latestSuccessfulSource.observations,...dueRow.latestSuccessfulSource.observations]}},cfg),'SOURCE_DUE_OBSERVATION_REQUIRED');
await rejects(()=>requireDue(dueRow,{...cfg,sourceId:'source-servier-china-social'}),'SOURCE_DUE_OBSERVATION_REQUIRED');
ok('unchanged actual-crawledAt 12h gate: exact threshold accepted, 1ms early, duplicate observation and wrong source rejected');
const registration=JSON.parse(await readFile(join(base,'verification/CANDIDATE46_REGISTERED.json')));const bootstrap={schemaVersion:1,checkedAt:new Date(registration.checkedAt).toISOString(),candidateRows:[registration.candidate],batchId:'NONQUAL-PREFLIGHT-'+key};
const bootPath=join(host,'NON_QUALIFYING_BOOTSTRAP-'+testId+'.json');await writeFile(bootPath,JSON.stringify(bootstrap)+'\n',{flag:'wx',mode:0o600});
const {preflight,validateBootstrapShape}=await import(pathToFileURL(join(host,'runtime/preflight/preflight-launch.mjs')).href);
for(const batchId of [null,undefined,123])await rejects(()=>validateBootstrapShape({...bootstrap,batchId}),'PREFLIGHT_BOOTSTRAP_SCHEMA');
validateBootstrapShape(bootstrap);ok('preflight explicit batch ID rejects null, undefined, number; accepts normal string');
const localPreflight=join(host,'_local-preflight-'+testId);
const pf=await preflight(['check',join(host,'host-config.json'),join(host,'control-base.json'),bootPath,sha(await readFile(bootPath)),localPreflight]);
if(!pf.report.localChecksPassed||pf.report.launchPermitted||!pf.report.runtime.archiveSmoke.passed||!pf.report.runtime.archiveSmoke.workspaceRoot.startsWith(host+'/'))throw Error('PREFLIGHT_NOT_LOCAL');
ok('original stale-bootstrap preflight, full source/runtime/dependency identity, actual archive write/read/hash',{reportPath:pf.reportPath,launchPermitted:false});
const state=new Map([['cloudPilotHostConfig','PARENT_SENTINEL'],['bayer42:cloudPilotHostConfig','BAYER_SENTINEL'],['trueA42:csl:cloudPilotHostConfig','CSL_SENTINEL']]);
globalThis.store=(k,v)=>{if(!k.startsWith(prefix))throw Error('CROSS_NAMESPACE');state.set(k,v);};globalThis.load=k=>state.get(k);globalThis.text=()=>{};globalThis.notify=()=>{};
const local=async args=>{
 if(!args.cmd.includes(host)||!((args.cmd.startsWith("python3 - '")||args.cmd.startsWith("cat '"))||args.cmd.startsWith('env JOBFINDER_CLOUD_SOURCE_ID='+cfg.sourceId+' ')))throw Error('LOCAL_COMMAND_OUT_OF_SCOPE:'+args.cmd);
 if(/scripts\/p0-cloud|run-with-http-diagnostics/.test(args.cmd))throw Error('PRODUCER_LAUNCH_FORBIDDEN');
 commands.push(args.cmd);
 try{return {exit_code:0,output:execFileSync('/bin/bash',['-c',args.cmd],{cwd:args.workdir,encoding:'utf8',timeout:20000,maxBuffer:3000000,stdio:'pipe',env:{...process.env,TSX_DISABLE_CACHE:'1',PYTHONDONTWRITEBYTECODE:'1'}})};}
 catch(e){return {exit_code:e.status??1,output:String(e.stdout??'')+String(e.stderr??e.message)};}
};
let stubCalls=0,expectedStub;
const localSqlStub=async args=>{stubCalls++;if(!expectedStub||args.project_id!==cfg.project||args.query!==expectedStub.sql)throw Error('LOCAL_SQL_STUB_BINDING');return {structuredContent:{result:'\n<untrusted-data-local-fixture>\n'+JSON.stringify(expectedStub.rows)+'\n</untrusted-data-local-fixture>'}};};
const applyLocal=async patch=>{
 const lines=patch.split('\n');if(lines[0]!=='*** Begin Patch'||!lines[1].startsWith('*** Add File: ')||lines.at(-1)!=='*** End Patch')throw Error('LOCAL_PATCH_FORMAT');
 const p=lines[1].slice('*** Add File: '.length);if(!p.startsWith(host+'/'))throw Error('LOCAL_PATCH_SCOPE');
 const body=lines.slice(2,-1).map(l=>{if(!l.startsWith('+'))throw Error('LOCAL_PATCH_CONTENT');return l.slice(1);}).join('\n');
 await mkdir(dirname(p),{recursive:true,mode:0o700});await writeFile(p,body+'\n',{flag:'wx',mode:0o600});return {};
};
globalThis.tools={exec_command:local,apply_patch:applyLocal,mcp__codex_apps__supabase_execute_sql:localSqlStub};
const loader=await readFile(join(host,'runtime/load-source-runtime.js'),'utf8');
await new A('sourceKey',loader)(key);
const loadState=await readFile(join(host,'runtime/load-host-state.js'),'utf8');
for(const candidateId of ['dot-cloud-restored-fb0b8e3-20261004',control.candidate.id.toLowerCase(),control.candidate.id+'-extra'])await rejects(()=>new A('root','sourceId','candidateId','commit',loadState)(host,cfg.sourceId,candidateId,control.build.commitSha),'HOST_LOAD_ARGUMENT');
if(state.get(prefix+'cloudPilotHostConfig').sourceId!==cfg.sourceId||state.get('cloudPilotHostConfig')!=='PARENT_SENTINEL'||state.get('bayer42:cloudPilotHostConfig')!=='BAYER_SENTINEL'||state.get('trueA42:csl:cloudPilotHostConfig')!=='CSL_SENTINEL')throw Error('LOADER_STATE_ISOLATION');
for(const k of ['currentIndependentValidationInput','currentCaptureInput','currentRetainedCaptureInput','nextBatchId'])if(state.get(prefix+k)!==null)throw Error('LOADER_STALE_INPUT');
for(const invalid of ['bayer','servier','__proto__','../../msd','unknown']){const n=commands.length;await rejects(()=>new A('sourceKey',loader)(invalid),'RESTORED46_SOURCE_SELECTION');if(commands.length!==n)throw Error('INVALID_LOADER_SIDE_EFFECT');}
ok('actual two-level loader, closed key allowlist, cleared stale inputs, parent/Bayer/CSL namespace isolation');
const stages=await new A(state.get(prefix+'cloudPilotHostStages'))(),h=stages.h,empty=join(localPreflight,'relay');
if(await h.next(empty)!==undefined)throw Error('EMPTY_RELAY');
const context=await h.readFile(join(host,'context-read.sql'));if(context.text!==sql||context.hash!==sha(sql))throw Error('CONTEXT_READ_BYTES');
for(const bad of [join(root,key==='hengrui'?'hansoh':'hengrui','_local-preflight/relay'),host+'-similar/relay',join(base,'hosts/servier/relay')])await rejects(()=>h.next(bad),'RELAY_DIRECTORY_OUTSIDE_TASK');
for(const bad of [join(base,'hosts/servier/host-config.json'),host+'-similar/host-config.json'])await rejects(()=>h.readFile(bad),'HOST_PATH_SCOPE');
ok('actual empty next, own context byte/hash read, sibling/Servier/prefix-confusion relay and file rejection');
const mockRun=join(host,'NONQUAL-CONTROL-'+key+'-'+testId),dir=join(mockRun,'relay');await mkdir(dir,{recursive:true,mode:0o700});
await writeFile(join(mockRun,'NON_QUALIFYING.json'),JSON.stringify({purpose:'LOCAL_HOST_CONTROL_PATH_SIMULATION_ONLY',network:false,database:false,producerLaunched:false})+'\n',{flag:'wx',mode:0o600});
async function request(kind,payload){const body={schemaVersion:1,requestId:randomUUID(),kind,expiresAt:new Date(Date.now()+120000).toISOString(),payload:{...payload,dispatchBefore:new Date(Date.now()+90000).toISOString()}};const req={...body,requestSha256:sha(JSON.stringify(body))};await writeFile(join(dir,req.requestId+'.request.json'),JSON.stringify(req),{flag:'wx',mode:0o600});return req;}
let r=await request('READ_CONTEXT',{projectId:cfg.project,sourceId:cfg.sourceId,sourceConfigSha256:cfg.sourceConfigSha256,purpose:'LOCAL_NON_QUALIFYING'});
expectedStub={sql,rows:[{context:{checkedAt:new Date().toISOString(),sourceId:cfg.sourceId,sourceConfigSha256:cfg.sourceConfigSha256,purpose:'LOCAL_NON_QUALIFYING'}}]};
const got=await h.next(dir);if(got.requestId!==r.requestId)throw Error('NONEMPTY_NEXT');
if((await stages.handle(got,dir)).status!=='READ_CONTEXT')throw Error('NESTED_CONTEXT');
if(await h.next(dir)!==undefined)throw Error('CONTEXT_NOT_RESPONDED');
const calls=stubCalls;await rejects(()=>stages.handle(got,dir),'EEXIST');if(stubCalls!==calls)throw Error('REPLAYED_DISPATCH');
ok('nonempty next → exact source READ_CONTEXT → own context SQL → exclusive dispatch marker → local response; duplicate dispatch blocked');
const identity=selectedPilotIdentity({releaseCandidateId:control.candidate.id,commitSha:authority.commitSha,rosterSha256:authority.rosterSha256,sourcePlanSha256:authority.sourcePlanSha256,sourceConfigSha256:authority.sourceConfigSha256,adapterBundleSha256:authority.adapterBundleSha256});
const planned=buildPendingRuntimeBatch('NONQUAL-CONTROL-'+key+'-'+testId,[plan],identity,new Date());
const holderId=randomUUID();r=await request('CREATE_PENDING',{projectId:cfg.project,holderId,planned});
const {compileCloudPilotCreatePendingSql}=await imp('src/db/cloudPilotSqlControl.ts');
expectedStub={sql:compileCloudPilotCreatePendingSql({...control,expiresAt:r.expiresAt,holderId,planned}),rows:[{result:{purpose:'LOCAL_NON_QUALIFYING',batch:planned.batch,sourceRows:planned.sources}}]};
if((await stages.handle(await h.next(dir),dir)).status!=='CREATED_PENDING')throw Error('NESTED_PENDING');
if(await h.next(dir)!==undefined)throw Error('PENDING_NOT_RESPONDED');
ok('nonempty next → CREATE_PENDING → actual frozen compiler and local sql-binding/hash/read/mark/respond paths',{sqlDispatchedToDatabase:false});
r=await request('READ_PUBLICATION_CONTEXT',{projectId:cfg.project,sql});expectedStub={sql,rows:[{context:{checkedAt:new Date().toISOString(),purpose:'LOCAL_NON_QUALIFYING'}}]};
if((await stages.handle(await h.next(dir),dir)).status!=='SUCCEEDED')throw Error('NESTED_DB_STARTED_CONTEXT');
ok('actual DB_STARTED READ_PUBLICATION_CONTEXT sqlDispatch nested path with exact SQL and project, local stub only');
const fakeSql='-- NON_QUALIFYING_LOCAL_HOST_PACKET; NEVER EXECUTE\nSELECT 1;';r=await request('PUBLISH',{projectId:cfg.project,sql:fakeSql});
const beforePublish=stubCalls,pub=await stages.handle(await h.next(dir),dir);
if(pub.status!=='AWAITING_PARENT_REVIEW'||pub.sqlPath!==join(dir,r.requestId+'.request.json.sql')||stubCalls!==beforePublish||state.get(prefix+'cloudPilotPublishRequest').requestId!==r.requestId||await readFile(pub.sqlPath,'utf8')!==fakeSql)throw Error('PUBLISH_REVIEW_GATE');
await rejects(()=>stat(join(dir,r.requestId+'.dispatch.json')),'ENOENT');
await rejects(()=>Promise.resolve(execFileSync('python3',[join(host,'runtime/review-publication.py'),host,mockRun,r.requestId],{encoding:'utf8',stdio:'pipe',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}})),spec.route==='A'?"KeyError: 'source_result_data'":'AssertionError');
ok('nonempty next → PUBLISH packet file/hash → namespaced parent review gate; no SQL dispatch; original reviewer rejects nonqualifying packet');
let polls=0;globalThis.tools={exec_command:async()=>({session_id:901,output:'first'}),write_stdin:async()=>++polls===1?{session_id:901,output:'second'}:{exit_code:0,output:'third'}};
if(await h.cmd('LOCAL_TERMINAL_WAIT_FIXTURE')!=='firstsecondthird'||polls!==2)throw Error('LOCAL_TERMINAL_WAIT');
ok('original local command helper follows same session to terminal and preserves all output');
// Exercise the real starter and monitor using a local-only launch stub. Real preflight above used stale input.
const RealDate=Date,simulationNow=dueAt+1000;globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[simulationNow]));}static now(){return simulationNow;}};
let launchStubCalls=0,preflightStubCalls=0;
const startBatch='NONQUAL-STARTER-'+key+'-'+testId,startRun=join(host,startBatch);dueRow.checkedAt=new Date().toISOString();dueRow.candidateRows=bootstrap.candidateRows;
globalThis.tools={apply_patch:applyLocal,mcp__codex_apps__supabase_execute_sql:async args=>{if(!args.query.includes(cfg.sourceId)||!args.query.includes('CrawlObservation'))throw Error('STARTER_DUE_SQL_SCOPE');return {structuredContent:{result:'\n<untrusted-data-local-fixture>\n'+JSON.stringify([dueRow])+'\n</untrusted-data-local-fixture>'}};},exec_command:async args=>{
 if(args.cmd.includes('preflight-launch.mjs')){preflightStubCalls++;if(!args.cmd.includes(host+'/runtime/preflight/preflight-launch.mjs'))throw Error('STARTER_PREFLIGHT_PATH');return {exit_code:0,output:'LOCAL_NON_QUALIFYING_PREFLIGHT_STUB'};}
 if(args.cmd.includes('scripts/run-with-http-diagnostics.mjs')){launchStubCalls++;if(args.workdir!==cfg.repo||!args.cmd.includes(spec.entrypoint)||!args.cmd.includes('--max-old-space-size='+spec.heapMiB)||!args.cmd.includes(startRun+'/relay'))throw Error('STARTER_CAPTURE_PATH');await mkdir(join(startRun,'relay'),{recursive:true});await mkdir(join(startRun,'diagnostics'),{recursive:true});await writeFile(join(startRun,'diagnostics/process.jsonl'),JSON.stringify({event:'CHILD_EXIT',wrapperExitCode:0,purpose:'NON_QUALIFYING_LOCAL_LAUNCH_STUB'})+'\n');return {session_id:902,output:'NO_PRODUCER_LAUNCHED_LOCAL_STUB'};}
 return local(args);
 },write_stdin:async args=>{if(args.session_id!==902)throw Error('MONITOR_SESSION');return {exit_code:0,output:'LOCAL_NON_QUALIFYING_TERMINAL'};}};
for(const batchId of [null,undefined,123]){state.set(prefix+'nextBatchId',batchId);await rejects(()=>new A(starter)(),'BATCH_ID');}
if(launchStubCalls||preflightStubCalls)throw Error('INVALID_BATCH_STARTED_OR_PREFLIGHTED');
ok('starter explicit batch ID rejects null, undefined, number before save/preflight/launch');
state.set(prefix+'nextBatchId',startBatch);
try{await new A(starter)();}finally{globalThis.Date=RealDate;}
if(launchStubCalls!==1||preflightStubCalls!==1||state.get(prefix+'portableCurrentProcessStatus')?.process?.event!=='CHILD_EXIT'||state.get(prefix+'lastPortableExecPoll')?.exit_code!==0)throw Error('FULL_STARTER_MONITOR_SIMULATION');
ok('actual starter → own preflight path → exact route/heap/run command stub → original durable monitor → same-session terminal read',{producerLaunched:false,simulatedClockOnly:true});
for(const [dest,v]of Object.entries(spec.templateFiles))if(sha(await readFile(v.originalPath))!==v.originalSha256||sha(await readFile(join(host,dest)))!==v.sha256)throw Error('HOST_OR_REFERENCE_MUTATED:'+dest);
const git=a=>execFileSync('git',a,{cwd:cfg.repo,encoding:'utf8',env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}}).trim();if(git(['rev-parse','HEAD'])!==spec.build.commitSha||git(['status','--porcelain']))throw Error('PRODUCER_MUTATED');
ok('prepared/reference files unchanged and frozen producer commit/clean tree retained');
const report={schemaVersion:1,checkedAt:new Date().toISOString(),passed:true,sourceKey:key,sourceId:cfg.sourceId,route:spec.route,prefix,heapMiB:spec.heapMiB,scope:'LOCAL_HOST_PREPARATION_AND_NONQUALIFYING_CONTROL_SIMULATION',sourceNetworkAccessed:false,databaseAccessed:false,producerLaunched:false,fullBuildOrTestsRun:false,parentSessionStoresAccessed:false,localSqlStubCalls:stubCalls,localCommandCount:commands.length,launchAuthorizedByThisReport:false,checks};
await writeFile(join(host,'CHECK_RESULTS.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
await writeFile(join(host,'PREPARED.json'),JSON.stringify({...spec,localChecksPassed:true,checkedAt:report.checkedAt,checkReport:join(host,'CHECK_RESULTS.json')},null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({sourceId:cfg.sourceId,passed:true,checks:checks.length,localSqlStubCalls:stubCalls,localCommandCount:commands.length,launched:false,report:join(host,'CHECK_RESULTS.json')}));
