// All inputs in this test are local NONQUAL fixtures, never capture or launch authority.
import {readFile,writeFile,mkdir,symlink} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {serialize} from 'node:v8';
import {requirePublisherState} from './publisher-state-guard.mjs';
import {checkNewRun} from './check-new-run.mjs';
import {validateCaptureInputs} from './validate-capture-inputs.mjs';
const host=dirname(dirname(fileURLToPath(import.meta.url))),cfg=JSON.parse(await readFile(join(host,'host-config.json'))),control=JSON.parse(await readFile(join(host,'control-base.json'))),expected=JSON.parse(await readFile(join(host,'runtime/expected-database.json'))),plan=JSON.parse(await readFile(join(host,'source-plan.json'))),checks=[];
const A=Object.getPrototypeOf(async function(){}).constructor,sha=b=>createHash('sha256').update(b).digest('hex'),ok=name=>checks.push({name,passed:true});
async function rejects(fn,code){let error;try{await fn();}catch(e){error=e;}if(!String(error).includes(code))throw Error('EXPECTED:'+code+':'+error);ok(code);}
globalThis.fetch=async()=>{throw Error('LOCAL_NETWORK_FORBIDDEN')};
const state={schemaVersion:1,active:null,pendingReadOnlyTerminalSources:[],runtimeCandidate:{id:control.candidate.id,version:46,commit:control.build.commitSha,sourceTreeSha256:control.build.sourceTreeSha256,runtimeTreeSha256:control.build.runtimeTreeSha256,adapterBundleSha256:expected.candidate.adapterBundleHash}};
for(const key of ['id','version','commit','sourceTreeSha256','runtimeTreeSha256','adapterBundleSha256'])await rejects(()=>requirePublisherState({...state,runtimeCandidate:{...state.runtimeCandidate,[key]:'changed'}},'idle'),'PUBLISHER_CANDIDATE_CHANGED');
await rejects(()=>requirePublisherState({...state,pendingReadOnlyTerminalSources:[{sourceKey:'pfizer',status:'UNKNOWN_ORIGINAL_PROCESS',noRestartWithoutOriginalExitOrHostDestructionProof:true}]},'idle'),'PFIZER_ORIGINAL_PROCESS_UNRESOLVED');
await rejects(()=>requirePublisherState({...state,pendingReadOnlyTerminalSources:undefined},'idle'),'PUBLISHER_UNKNOWN_PROCESS_LIST_REQUIRED');
requirePublisherState({...state,active:{sourceId:cfg.sourceId,batchId:'NONQUAL-PUBLISH'}},'publish','NONQUAL-PUBLISH');ok('own exact active publisher accepted');
await rejects(()=>requirePublisherState({...state,active:{sourceId:cfg.sourceId,batchId:'NONQUAL-OTHER'}},'publish','NONQUAL-PUBLISH'),'ANOTHER_PUBLISHER_ACTIVE');
const helperCode=await readFile(join(host,'host-helper-functions.js'),'utf8'),starter=await readFile(join(host,'runtime/start-monitor-pfizer42.js'),'utf8');
const stores=new Map([['restored46:pfizer:cloudPilotHostConfig',cfg],['restored46:pfizer:cloudPilotHostHelpers',helperCode]]);globalThis.load=k=>stores.get(k);globalThis.store=(k,v)=>stores.set(k,v);globalThis.notify=()=>{};
globalThis.tools=new Proxy({},{get(){throw Error('LOCAL_TOOL_CALL_FORBIDDEN')}});
for(const batch of [undefined,null,123,{},[],['valid'],'bad/path','../outside','']){stores.set('restored46:pfizer:nextBatchId',batch);await rejects(()=>new A(starter)(),'BATCH_ID');}
stores.set('restored46:pfizer:nextBatchId','NONQUAL-GUARD');await rejects(()=>new A(starter)(),'CURRENT_B_INPUT_REQUIRED');
const helper=await new A(helperCode)();for(const p of [host+'-other/f',host+'/../outside',host+'/x\nfile'])await rejects(()=>helper.save(p,'NONQUAL'),'HOST_SAVE_SCOPE');
for(const args of [[],['../bad'],['valid','extra'],[123]])await rejects(()=>checkNewRun(args),'NEW_RUN_ARGUMENTS');
const testId='NONQUAL-GUARDS-'+randomUUID(),testRoot=join(host,testId);await mkdir(testRoot);
await writeFile(join(testRoot,'bootstrap.json'),'NONQUAL');await rejects(()=>checkNewRun([testId]),'RUN_ALREADY_STARTED');
await symlink(testRoot,join(host,testId+'-link'));await rejects(()=>checkNewRun([testId+'-link']),'PREFLIGHT_SYMLINK');
const exec=(file,args=[])=>execFileSync(process.execPath,[file,...args],{cwd:cfg.repo,encoding:'utf8',stdio:'pipe',env:process.env});
await rejects(()=>exec(join(host,'host-files.mts'),['read',join(dirname(host),'servier/host-config.json'),'0']),'HOST_PATH_SCOPE');
await rejects(()=>exec(join(host,'host-files.mts'),['read',join(host,testId+'-link/bootstrap.json'),'0']),'PREFLIGHT_SYMLINK');
await rejects(()=>exec(join(host,'host-files.mts'),['read',join(host,'host-config.json'),'0','extra']),'HOST_ARGUMENTS');
await rejects(()=>exec(join(host,'relay-files.mjs'),['next-meta',join(dirname(host),'servier')]),'RELAY_DIRECTORY_OUTSIDE_TASK');
// Exercise the complete fresh-readback fragment using a local SQL stub only.
const dueCode=await readFile(join(host,'runtime/observation-due-gate.js'),'utf8'),fresh=await readFile(join(host,'runtime/fresh-readback.js'),'utf8'),now=new Date(),start=new Date(now-13*3600000).toISOString(),end=new Date(Date.parse(start)+60000).toISOString(),crawled=new Date(Date.parse(start)+1000).toISOString();
const result={sourceResultId:'NONQUAL-SUCCESS',sourceId:cfg.sourceId,batchId:'NONQUAL-OLD',releaseCandidateId:control.candidate.id,sourceConfigHash:cfg.sourceConfigSha256,startedAt:start,finishedAt:end,observations:[{id:'NONQUAL-OBS',sourceResultId:'NONQUAL-SUCCESS',sourceId:cfg.sourceId,batchId:'NONQUAL-OLD',releaseCandidateId:control.candidate.id,sourceConfigSha256:cfg.sourceConfigSha256,crawledAt:crawled,observedFrom:start,observedTo:end,successful:true,transportSucceeded:true,adapterSucceeded:true,completenessVerified:true,atomicCommitSucceeded:true}]};
const freshRow={checkedAt:now.toISOString(),candidateRows:[expected.candidate],holderId:'',migrationRows:expected.migrations.map(m=>({...m,finishedAt:start,rolledBackAt:null})),sourceResultGuardMd5:expected.sourceResultGuardMd5,sameSourceRunning:[],latestSuccessfulSource:result};
const mockHelper={cfg,cmd:async()=>'',q:x=>x,readFile:async path=>({text:path.endsWith('expected-database.json')?JSON.stringify(expected):path.endsWith('observation-due-gate.js')?dueCode:'LOCAL-READ-ONLY-QUERY'}),rows:raw=>raw};
globalThis.mockHelper=mockHelper;stores.set('restored46:pfizer:cloudPilotHostHelpers','return globalThis.mockHelper;');let mockRow=freshRow,sqlStubCalls=0;
globalThis.tools={mcp__codex_apps__supabase_execute_sql:async({project_id,query})=>{if(project_id!==cfg.project||query!=='LOCAL-READ-ONLY-QUERY')throw Error('STUB_BINDING');sqlStubCalls++;return [mockRow];}};
await new A(fresh)();ok('fresh exact C46, DB48, empty holder, due and no overlap accepted with stub');
for(const [name,changes,code] of [['old read',{checkedAt:new Date(now-61000).toISOString()},'FRESH_READBACK_TIME'],['holder',{holderId:'other'},'FRESH_HOLDER'],['candidate',{candidateRows:[{...expected.candidate,version:42}]},'FRESH_CANDIDATE'],['guard',{sourceResultGuardMd5:'other'},'FRESH_DB48_SCHEMA'],['migration',{migrationRows:freshRow.migrationRows.slice(1)},'FRESH_DB48_SCHEMA'],['unknown process',{sameSourceRunning:[{batchId:'NONQUAL-UNKNOWN',candidateStatus:'INVALIDATED'}]},'FRESH_HOLDER']]){mockRow={...freshRow,...changes};await rejects(()=>new A(fresh)(),code);}
const due=await new A(dueCode)();await rejects(()=>due({...freshRow,checkedAt:new Date(Date.parse(crawled)+43200000-1).toISOString()},cfg),'SOURCE_NOT_DUE');
if(due({...freshRow,checkedAt:new Date(Date.parse(crawled)+43200000).toISOString()},cfg).ageMs!==43200000)throw Error('DUE_BOUNDARY');ok('12h due exact boundary');
await rejects(()=>due({...freshRow,latestSuccessfulSource:{...result,observations:[]}},cfg),'SOURCE_DUE_OBSERVATION_REQUIRED');
// Synthetic Pfizer DOM is kept under a clearly NONQUAL directory and never issued or published.
const imp=p=>import(pathToFileURL(join(cfg.repo,p)).href),{pfizerDomPacketsToPages}=await imp('src/crawler/pfizerRenderedTraversal.ts'),{createOfficialJsonRenderedTraversalValidation,evaluateBGradeValidationRequirement}=await imp('src/crawler/traversalCertificate.ts');
const at=new Date(now-10000).toISOString(),officialId='4964772',externalPath='/job/India---Mumbai/Marketing_4964772-1';
const listPage={url:'https://pfizer.wd1.myworkdayjobs.com/en-US/PfizerCareers?Location_Country=6cb77610a8a543aea2d6bc10457e35d4',title:'Search for Jobs',countryFilter:'China clear filter',filterCount:1,searchText:'',pageLabel:'Page 1 of 1',range:'1 - 2 of 2 jobs',totalText:'2 JOBS FOUND',nextControlPresent:false,capturedAt:at};
const rawRow={capturedAt:at,officialId,externalPath,title:'Marketing',detailUrl:'https://pfizer.wd1.myworkdayjobs.com/en-US/PfizerCareers'+externalPath+'?Location_Country=6cb77610a8a543aea2d6bc10457e35d4',renderedTitle:'Marketing',renderedId:officialId,renderedLocations:['India - Mumbai','APAC - Any Pfizer Site'],applyEnabled:true,jsonLd:JSON.stringify({'@type':'JobPosting',identifier:{value:officialId},title:'Marketing',jobLocation:{address:{addressCountry:'India',addressLocality:'IND - Mumbai'}},datePosted:'2026-10-02'}),detailDom:'<div>NONQUAL fixture only</div>'};
const mainland={...rawRow,officialId:'4964773',externalPath:'/job/China---Shanghai/Marketing_4964773',detailUrl:'https://pfizer.wd1.myworkdayjobs.com/en-US/PfizerCareers/job/China---Shanghai/Marketing_4964773?Location_Country=6cb77610a8a543aea2d6bc10457e35d4',renderedId:'4964773',renderedLocations:['China - Shanghai'],jsonLd:JSON.stringify({'@type':'JobPosting',identifier:{value:'4964773'},title:'Marketing',jobLocation:{address:{addressCountry:'China',addressLocality:'CHN - Shanghai'}},datePosted:'2026-10-02'})};
const raw={captureKind:'MANAGED_BROWSER_DOM_JSONLD',observedAt:at,packets:[{listPage,rows:[rawRow,mainland]}]},rawBytes=JSON.stringify(raw),pages=pfizerDomPacketsToPages(raw.packets,sha(rawBytes));
const validation=createOfficialJsonRenderedTraversalValidation({sourceId:cfg.sourceId,companyId:plan.company.id,sourceConfigSha256:cfg.sourceConfigSha256,surfaceIds:[plan.source.surfaceId],channelIds:plan.expectedChannels.map(c=>c.channelId),pages,observedAt:at,expiresAt:new Date(Date.parse(at)+7*86400000).toISOString()});
for(const [elapsed,accepted]of [[3600000,true],[3600001,false]]){const decision=evaluateBGradeValidationRequirement({trigger:'INITIAL_QUALIFICATION',validationExecution:'CURRENT_RUN',validation,now:new Date(Date.parse(at)+elapsed)});if(decision.acceptable!==accepted)throw Error('CURRENT_RUN_BOUNDARY');}ok('Pfizer exact frozen 1h CURRENT_RUN boundary');
if(evaluateBGradeValidationRequirement({trigger:'INITIAL_QUALIFICATION',validationExecution:'REUSED',validation,now}).acceptable)throw Error('REUSE_ACCEPTED');ok('independent reused evidence rejected');
const fixture=join(host,'captures',testId);await mkdir(fixture,{recursive:true});
const fetched=serialize({ok:true,capturedAt:at,fetchEvidence:{artifacts:[{capturedAt:at}]}}),fetchedPath=join(fixture,'sourceFetchResult.v8');await writeFile(fetchedPath,fetched);
const manifest={schemaVersion:2,sourceId:cfg.sourceId,sourceConfigSha256:cfg.sourceConfigSha256,startedAt:new Date(now-20000).toISOString(),finishedAt:new Date(now-5000).toISOString(),fetched:{path:fetchedPath,sha256:sha(fetched),encoding:'v8'}},manifestPath=join(fixture,'reviewed-worker-capture.json'),validationPath=join(fixture,'independent-validation.json');
await writeFile(manifestPath,JSON.stringify(manifest));await writeFile(validationPath,JSON.stringify(validation));await writeFile(join(fixture,'managed-browser-capture.json'),rawBytes);
await writeFile(join(fixture,'NON_QUALIFYING.json'),JSON.stringify({purpose:'SYNTHETIC_GUARD_FIXTURES_ONLY',neverLaunch:true}));
const args=[manifestPath,sha(JSON.stringify(manifest)),validationPath,sha(JSON.stringify(validation)),new Date(now-3600000).toISOString()];
const verified=await validateCaptureInputs(args,now);if(verified.rawCount!==2||verified.excludedCount!==1||verified.nonCertifying!==true)throw Error('INPUT_CHECK');ok('scoped main checkpoint and original DOM hash replay');
await rejects(()=>validateCaptureInputs([...args,'extra'],now),'CAPTURE_INPUT_ARGUMENTS');
await rejects(()=>validateCaptureInputs([manifestPath,'a'.repeat(64),...args.slice(2)],now),'CAPTURE_INPUT_HASH');
await writeFile(join(fixture,'managed-browser-capture.json'),rawBytes+' ');await rejects(()=>validateCaptureInputs(args,now),'INDEPENDENT_NATIVE_DOM_REPLAY_MISMATCH');
const report={schemaVersion:1,purpose:'NONQUAL_LOCAL_GUARDS_AND_ORIGINAL_PFIZER_REPLAY',passed:true,checkedAt:new Date().toISOString(),databaseAccessed:false,networkAccessed:false,producerLaunched:false,sqlStubCalls,checks};
await writeFile(join(host,'GUARD_CHECK_RESULTS.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({passed:true,checks:checks.length,sqlStubCalls}));
