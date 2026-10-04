import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const root='/workspace/scratch/5e9614251709/job-finder-runtime-restore-20261004T0834Z/hosts/true-a42-next';
const base='/workspace/scratch/5e9614251709/job-finder-runtime-restore-20261004T0834Z';
const key=process.argv[2];if(!['sph','csl','lilly'].includes(key))throw Error('SOURCE_KEY');
const host=join(root,key),rt=join(host,'runtime');
const cfg=JSON.parse(await readFile(join(host,'host-config.json'))),spec=JSON.parse(await readFile(join(host,'SPEC.json'))),prefix=spec.prefix;
if(process.env.JOBFINDER_CLOUD_SOURCE_ID!==cfg.sourceId||process.env.TSX_DISABLE_CACHE!=='1')throw Error('CHECK_PROCESS_ENV');
const sha=x=>createHash('sha256').update(x).digest('hex'),A=Object.getPrototypeOf(async function(){}).constructor,checks=[];
const put=(p,t)=>writeFile(join(host,p),t,{flag:'wx',mode:0o600});
globalThis.fetch=async()=>{throw Error('PREPARATION_NETWORK_FORBIDDEN');};
const fromRepo=p=>import(pathToFileURL(join(cfg.repo,p)).href);
const {createBuildIdentity}=await fromRepo('src/readiness/buildIdentity.ts');
const {deriveCurrentStagedScheduleExpectation}=await fromRepo('src/crawler/stagedScheduleAuthority.ts');
const {sourcePlanConfigSha256}=await fromRepo('src/crawler/sourcePlan.ts');
const {compileCloudPilotPublicationContextSql,CLOUD_PILOT_SOURCE}=await fromRepo('src/db/cloudPilotSqlControl.ts');
const {requiresBGradeTraversalCertificate}=await fromRepo('src/crawler/traversalCertificate.ts');
const {REQUIRED_A_GRADE_COMPLETENESS_CERTIFICATES}=await fromRepo('src/crawler/completenessCertificate.ts');
const {deriveDbStartedPublicationExpiry}=await fromRepo('src/db/ingestionRepository.ts');
const pilot=await fromRepo('scripts/p0-cloud-source-pilot.ts');
const {expiresAt,...control}=JSON.parse(await readFile(join(host,'control-base.json')));
const git=args=>execFileSync('git',args,{cwd:cfg.repo,encoding:'utf8',env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}}).trim();
if(git(['rev-parse','HEAD'])!==control.build.commitSha||git(['status','--porcelain']))throw Error('FROZEN_PRODUCER_CHANGED');
const build=createBuildIdentity(cfg.repo,control.build.commitSha);
if(JSON.stringify(build)!==JSON.stringify(control.build))throw Error('FROZEN_BUILD_CHANGED');
const plan=deriveCurrentStagedScheduleExpectation(build).plans.find(p=>p.source.id===cfg.sourceId);
if(!plan||sourcePlanConfigSha256(plan)!==cfg.sourceConfigSha256||CLOUD_PILOT_SOURCE.id!==cfg.sourceId||CLOUD_PILOT_SOURCE.sourceConfigSha256!==cfg.sourceConfigSha256||requiresBGradeTraversalCertificate(plan)||REQUIRED_A_GRADE_COMPLETENESS_CERTIFICATES[cfg.sourceId]!==plan.company.id)throw Error('CURRENT_TRUE_A_ROUTE_BINDING');
if(pilot.PILOT_SOURCE!==cfg.sourceId||typeof pilot.runCloudSourcePilot!=='function')throw Error('TRUE_A_PILOT_IMPORT');
const start=new Date('2026-10-04T00:00:00Z');
if(deriveDbStartedPublicationExpiry({startedAt:start,completenessCertificate:{schemaVersion:'a-grade-official-total-v2'}})!==start.getTime()+1800000)throw Error('TRUE_A_FRESHNESS_CHANGED');
const sql=compileCloudPilotPublicationContextSql(control);
if(!sql.includes("a-grade-official-total-v2")||sql.includes('plan-bound-source-quality-v1')||sql.includes('PLAN_BOUND_SOURCE_QUALITY_V1'))throw Error('CONTEXT_NOT_TRUE_A');
await put('context-read.sql',sql);await put('source-plan.json',JSON.stringify(plan,null,2)+'\n');
checks.push({check:'frozen original A pilot import, original issuer registration, current plan/config, canonical context SQL, original 30m freshness',passed:true,sourceConfigSha256:cfg.sourceConfigSha256,contextSha256:sha(sql),network:false,sqlExecuted:false});
for(const p of ['host-helper-functions.js','host-stage-functions.js','runtime/load-host-state.js','runtime/start-monitor-true-a42.js','runtime/continuous-relay-v3-durable-monitor.js','runtime/load-true-a42-runtime.js']){
 const t=await readFile(join(host,p),'utf8');new A('root','sourceId','candidateId','commit',t);
 for(const m of t.matchAll(/\b(?:load|store)\(["']([^"']+)["']/g))if(!m[1].startsWith(prefix))throw Error('STORE_NAMESPACE:'+p);
 checks.push({check:'fragment syntax and source namespace',path:p,passed:true});
}
const starter=await readFile(join(rt,'start-monitor-true-a42.js'),'utf8');
const gate=t=>t.split('// BEGIN OBSERVATION_DUE_GATE\n')[1].split('// END OBSERVATION_DUE_GATE')[0];
if(gate(starter)!==gate(await readFile(join(base,'hosts/portable42-next/runtime/start-monitor-portable42.js'),'utf8')))throw Error('DUE_GATE_CHANGED');
if(!starter.includes('P0_SOURCE_HTTP_TIMEOUT_MS=45000')||!starter.includes('scripts/p0-cloud-source-pilot.ts')||starter.includes('p0-cloud-portable-source-pilot.ts')||!starter.includes('--db-started-control')||!starter.includes('60000'))throw Error('A_LAUNCH_ROUTE');
checks.push({check:'original A launch route, actual observation 12h gate, HTTP45s and fresh60s bootstrap',passed:true});
for(const p of ['host-files.mts','relay-files.mjs','archive-transfer.mjs','runtime/preflight/preflight-launch.mjs','runtime/preflight/runtime-check.mjs']){execFileSync(process.execPath,['--check',join(host,p)],{encoding:'utf8',timeout:15000});}
const bootstrap=JSON.parse(await readFile(join(base,'hosts/bayer42/NON_QUALIFYING_BOOTSTRAP.json')));bootstrap.batchId='NON-QUALIFYING-TRUE-A42-'+key.toUpperCase();
await put('NON_QUALIFYING_BOOTSTRAP.json',JSON.stringify(bootstrap,null,2)+'\n');
const {preflight}=await import(pathToFileURL(join(rt,'preflight/preflight-launch.mjs')).href);
const bootPath=join(host,'NON_QUALIFYING_BOOTSTRAP.json');
const pf=await preflight(['check',join(host,'host-config.json'),join(host,'control-base.json'),bootPath,sha(await readFile(bootPath)),join(host,'_local-preflight')]);
if(pf.report.launchPermitted||!pf.report.runtime.archiveSmoke.passed)throw Error('LOCAL_PREFLIGHT_AUTHORITY');
checks.push({check:'dependencies, frozen build and actual archive write/read/hash preflight',passed:true,reportPath:pf.reportPath,launchPermitted:false,nonQualifying:true});
const state=new Map([['cloudPilotHostConfig','PARENT_SENTINEL'],['bayer42:cloudPilotHostConfig','BAYER_SENTINEL']]);
globalThis.store=(k,v)=>{if(!k.startsWith(prefix))throw Error('CROSS_NAMESPACE');state.set(k,v);};
globalThis.load=k=>state.get(k);globalThis.text=()=>{};globalThis.notify=()=>{};
const runLocal=async args=>{
 if(!((args.cmd.startsWith("python3 - '")||args.cmd.startsWith("cat '"))&&args.cmd.includes(host))&&!args.cmd.startsWith('env JOBFINDER_CLOUD_SOURCE_ID='+cfg.sourceId+' node '))throw Error('UNEXPECTED_LOCAL_COMMAND');
 try{return {exit_code:0,output:execFileSync('/bin/bash',['-c',args.cmd],{cwd:args.workdir,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:15000,maxBuffer:1000000,env:{...process.env,TSX_DISABLE_CACHE:'1'}})};}
 catch(e){return {exit_code:e.status??1,output:String(e.stderr||e.message)};}
};
globalThis.tools={exec_command:runLocal};
await new A('sourceKey',await readFile(join(root,'runtime/load-true-a42-runtime.js'),'utf8'))(key);
if(state.get(prefix+'cloudPilotHostConfig').sourceId!==cfg.sourceId||state.get('cloudPilotHostConfig')!=='PARENT_SENTINEL'||state.get('bayer42:cloudPilotHostConfig')!=='BAYER_SENTINEL')throw Error('LOADER_ISOLATION');
for(const k of ['currentIndependentValidationInput','currentCaptureInput','currentRetainedCaptureInput','nextBatchId'])if(state.get(prefix+k)!==null)throw Error('STALE_INPUT');
const h=await new A(state.get(prefix+'cloudPilotHostHelpers'))();
const empty=join(host,'_local-preflight/relay');
const meta=JSON.parse(await h.cmd('node '+h.q(join(host,'relay-files.mjs'))+' next-meta '+h.q(empty)));
if(meta.length||await h.next(empty)!==undefined)throw Error('EMPTY_RELAY');
const context=await h.readFile(join(host,'context-read.sql'));if(context.text!==sql||context.hash!==sha(sql))throw Error('OWN_CONTEXT_READ');
const other=join(root,key==='sph'?'csl':'sph');
async function rejects(action,code){let e;try{await action();}catch(x){e=x;}if(!String(e).includes(code))throw Error('EXPECTED_REJECTION:'+code+':'+e);}
for(const bad of [join(other,'_local-preflight/relay'),host+'-similar/relay']){
 await rejects(()=>h.cmd('node '+h.q(join(host,'relay-files.mjs'))+' next-meta '+h.q(bad)),'RELAY_DIRECTORY_OUTSIDE_TASK');
 await rejects(()=>h.next(bad),'RELAY_DIRECTORY_OUTSIDE_TASK');
}
for(const bad of [join(other,'context-read.sql'),host+'-similar/context-read.sql'])await rejects(()=>h.readFile(bad),'HOST_PATH_SCOPE');
checks.push({check:'sourceKey loader, parent/Bayer namespace isolation, actual empty next-meta/h.next, own context h.readFile, cross-source and similar-prefix rejection',passed:true});
// A local command may return a session before the useful output. The unchanged helper must wait for its terminal result.
let polls=0;globalThis.tools={exec_command:async()=>({session_id:901,output:'first'}),write_stdin:async()=>++polls===1?{session_id:901,output:'second'}:{exit_code:0,output:'third'}};
const terminalOutput=await h.cmd('LOCAL_TERMINAL_WAIT_FIXTURE');if(terminalOutput!=='firstsecondthird'||polls!==2||state.get(prefix+'cloudHostLocalCommandOutcome').status!=='TERMINAL')throw Error('LOCAL_TERMINAL_WAIT');
checks.push({check:'original host local command waits to actual terminal state and concatenates output',passed:true});
const baseline=JSON.parse(await readFile(join(root,'PREPARATION_BASELINE.json')));
for(const [path,hash]of Object.entries(baseline))if(sha(await readFile(path))!==hash)throw Error('REFERENCE_MUTATED:'+path);
if(git(['rev-parse','HEAD'])!==control.build.commitSha||git(['status','--porcelain']))throw Error('PRODUCER_MUTATED');
checks.push({check:'reference host files unchanged; producer frozen commit and clean',passed:true});
const report={schemaVersion:1,checkedAt:new Date().toISOString(),passed:true,sourceKey:key,sourceId:cfg.sourceId,networkAccessed:false,databaseAccessed:false,producerLaunched:false,parentSessionStoresAccessed:false,fullBuildOrTestsRun:false,checks};
await put('CHECK_RESULTS.json',JSON.stringify(report,null,2)+'\n');
await put('PREPARED.json',JSON.stringify({schemaVersion:1,status:'PREPARED_NOT_LAUNCHED',preparedAt:report.checkedAt,...spec,build,candidate:control.candidate,originalIssuer:'issueAGradeOfficialTotalCertificate',sourceAdmissionPolicy:null,readContextSqlSha256:sha(sql),archiveRetention:'SEPARATE_AUTHORIZED_PARENT_STEP',inertTemplateExpiry:expiresAt,freshDbBootstrapAndActualObservationReadRequired:true,singlePublisherRequired:true,automaticPublication:false,networkAccessed:false,databaseAccessed:false},null,2)+'\n');
console.log(JSON.stringify({passed:true,sourceId:cfg.sourceId,checks:checks.length,contextSha256:sha(sql),host}));
