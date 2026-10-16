/** Actual native CLI + owned wrapper + original sidecar. Only external HTTP and
 * official SQL response ports are synthetic. No install, live HTTP or database. */
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import {spawn,execFileSync} from 'node:child_process';import {createHash,randomBytes} from 'node:crypto';import {setTimeout as delay} from 'node:timers/promises';
import {createBuildIdentity} from '../vendor/c60-source/src/readiness/buildIdentity.ts';
import {deriveCurrentStagedScheduleExpectation,STAGED_SCHEDULE_ORACLE_VERSION} from '../vendor/c60-source/src/crawler/stagedScheduleAuthority.ts';
import {sourcePlanConfigSha256} from '../vendor/c60-source/src/crawler/sourcePlan.ts';
import {createOwnedSessionConsumer} from './ucb-pipe-protocol.mjs';
const pkg=path.resolve(import.meta.dirname,'..'),producer=path.join(pkg,'vendor/c60-source'),repo=path.resolve(pkg,'../..'),state=path.dirname(repo),SOURCE='source-ucb-china-social';
const sha=(x:string|Buffer)=>createHash('sha256').update(x).digest('hex');
const read=(p:string)=>JSON.parse(fs.readFileSync(p,'utf8'));
const write=(p:string,v:any,mode=0o600)=>fs.writeFileSync(p,JSON.stringify(v),{flag:'wx',mode});
for(const scenario of ['zero','multipage','duplicate','unknown-outcome'])test('original UCB CLI with real IPC and synthetic external ports: '+scenario,{timeout:180000},async()=>{
 assert.equal(execFileSync('git',['status','--porcelain'],{cwd:repo,encoding:'utf8'}).trim(),'','COMMITTED_CANDIDATE_REQUIRED');
 const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),build=createBuildIdentity(producer,commit),e=deriveCurrentStagedScheduleExpectation(build),plan=e.plans.find(p=>p.source.id===SOURCE)!;
 const round='round-'+randomBytes(16).toString('hex'),roundRoot=path.join(state,'rounds',round),task=path.join(roundRoot,'connector-host-task'),relay=path.join(task,'relay'),bindings=path.join(state,'connector-host-bindings');
 for(const dir of [path.join(state,'rounds'),roundRoot,task,relay,path.join(roundRoot,'artifacts'),bindings]){if(!fs.existsSync(dir))fs.mkdirSync(dir,{mode:0o700});assert.equal(fs.lstatSync(dir).mode&0o777,0o700);}
 const candidate={id:'synthetic-ucb-command-'+round.slice(6),goalId:'jobfinder-portable-required-40',version:100},databaseIdentity={migrationVersion:'20261014141000_v75_retired_candidate_fence',schemaHash:'6709fcde7b1953fd1d817d61d3239023fb29ec0ae4fc481efc69ffddbfa13af7',dbSnapshotHash:'e'.repeat(64)};
 const registration={...candidate,commitSha:commit,...databaseIdentity,rosterHash:e.rosterSha256,sourcePlanHash:e.sourcePlanSha256,sourceConfigHash:e.sourceConfigSha256,adapterBundleHash:e.adapterBundleSha256,sourceTreeHash:build.sourceTreeSha256,runtimeTreeHash:build.runtimeTreeSha256,oracleVersion:STAGED_SCHEDULE_ORACLE_VERSION,minimumStableCompanyCount:41,status:'BUILDING'};
 const batchId='synthetic-ucb-'+round.slice(6),control={projectId:'yiopvxysxrtrnvqxwgbx',build,candidate,databaseIdentity},config=sourcePlanConfigSha256(plan);
 assert.equal(config,'0423b01f438925ad3e34e29aeda58fe6353fbd264d4472a09bcb1fba281bd146');
 const context=()=>({checkedAt:new Date().toISOString(),sourceId:SOURCE,sourceConfigSha256:config,jobs:[],latestAccepted:null,firstAccepted:null,candidateRow:registration,sourceRow:{id:SOURCE,companyId:plan.company.id,kind:plan.source.kind,atsKind:plan.source.atsKind,status:plan.source.status,officialEntryUrl:plan.source.officialEntryUrl,officialChainEvidenceUrl:plan.source.officialChainEvidenceUrl},companyRow:{id:plan.company.id,officialChineseName:plan.company.officialChineseName}});
 const binding={schemaVersion:1,kind:'NATIVE_PORTABLE_CONNECTOR_V1',enabled:true,projectId:control.projectId,sourceId:SOURCE,sourceConfigSha256:config,route:'PORTABLE',publicationMode:'DB_STARTED_JOB_PROJECTION_DELTA_V1',ownerId:'dot-cloud-ucb-china-social-pilot',control,lockSha256:sha(fs.readFileSync(producer+'/package-lock.json')),entrypointHashes:Object.fromEntries(Object.entries({producer:'scripts/p0-cloud-portable-source-pilot.ts',wrapper:'scripts/run-with-http-diagnostics.mjs',controlCompiler:'src/db/cloudPilotSqlControl.ts',publicationCompiler:'src/db/ingestionRepository.ts',dbStarted:'src/crawler/cloudDbStartedPilot.ts'}).map(([k,p])=>[k,sha(fs.readFileSync(path.join(producer,p)))]))};
 const bindingBytes=JSON.stringify(binding),selector=sha(bindingBytes);fs.writeFileSync(path.join(bindings,selector+'.json'),bindingBytes,{flag:'wx',mode:0o400});
 write(task+'/fixed-seed.json',{candidateId:candidate.id,buildSha256:build.contentSha256,sourceId:SOURCE,projectId:control.projectId,batchId});write(roundRoot+'/control.json',control);
 write(roundRoot+'/bootstrap.json',{schemaVersion:1,checkedAt:new Date().toISOString(),candidateRows:[registration],batchId});
 const count=scenario==='zero'?0:scenario==='multipage'?51:7;
 write(roundRoot+'/synthetic-http.json',{kind:'SYNTHETIC_EXTERNAL_HTTP_ONLY',options:{count,...(scenario==='duplicate'?{duplicateId:true}:{})},httpLog:roundRoot+'/http-port-log.json'});
 const seed={projectId:control.projectId,candidateId:candidate.id,sourceId:SOURCE,batchId,buildSha256:build.contentSha256,launchChallenge:randomBytes(32).toString('hex')};
 let child:ReturnType<typeof spawn>,ended:any=null,stderr='',buffer='';
 const toolsPort={kind:'TRUSTED_SYNTHETIC_TOOL_PORT',launch:async()=>{
  const env:NodeJS.ProcessEnv={...process.env,JOBFINDER_CLOUD_SOURCE_ID:SOURCE,JOBFINDER_OWNED_PIPE_MODE:'TEST_ONLY',JOBFINDER_FIXED_PROJECTION_MODE:'TEST_ONLY',JOBFINDER_CONNECTOR_ROUND_ID:round,JOBFINDER_CONNECTOR_HOST_SHA256:selector,JOBFINDER_UCB_SYNTHETIC_INPUT:roundRoot+'/synthetic-http.json',TSX_DISABLE_CACHE:'1',NODE_DISABLE_COMPILE_CACHE:'1'};
  for(const key of ['NODE_OPTIONS','NODE_PATH','JOBFINDER_FIXED_SEQUENCE_LAYOUT','JOBFINDER_TAKEDA_OWNED_PIPE_MODE','JOBFINDER_TAKEDA_LAUNCH_CHALLENGE','JOBFINDER_BIOGEN_OWNED_PIPE_MODE','JOBFINDER_BIOGEN_LAUNCH_CHALLENGE','JOBFINDER_HENGRUI_OWNED_PIPE_MODE','JOBFINDER_HENGRUI_LAUNCH_CHALLENGE'])delete env[key];
  child=spawn(process.execPath,[pkg+'/connector-gate/ucb-run-with-owned-publication-pipe.mjs',JSON.stringify(seed),roundRoot+'/diagnostics','1800000','--',process.execPath,'--require',pkg+'/test/no-network.cjs','--import',producer+'/node_modules/tsx/dist/loader.mjs','--import',pkg+'/connector-gate/ucb-command-synthetic-preload.mts',producer+'/scripts/p0-cloud-portable-source-pilot.ts',roundRoot+'/bootstrap.json',sha(fs.readFileSync(roundRoot+'/bootstrap.json')),roundRoot+'/artifacts',relay,'--db-started-control',roundRoot+'/control.json'],{cwd:producer,env,stdio:['ignore','pipe','pipe']});
  child.stdout!.setEncoding('utf8');child.stderr!.setEncoding('utf8');child.stdout!.on('data',(s:string)=>buffer+=s);child.stderr!.on('data',(s:string)=>stderr+=s);child.once('error',e=>ended={code:127,error:String(e)});child.once('close',(code,signal)=>ended={code,signal});
  while(!buffer&&!ended)await delay(10);const output=buffer;buffer='';return {session_id:701,output};
 },poll:async(id:number)=>{assert.equal(id,701);const output=buffer;buffer='';return {session_id:701,output,...(ended?{exit_code:ended.code}:{})};}};
 const session=createOwnedSessionConsumer({launch:seed,toolsPort,mode:'TEST_ONLY'} as any),seen=new Set<string>(),kinds:string[]=[];let outcomeRead:any=null,expectedOutcome:any=null,publication:any=null;
 const end=Date.now()+150000;
 try{
  await session.start();
  while(!session.snapshot().toolEnded){
   if(Date.now()>end)throw Error('SYNTHETIC_COMMAND_TIMEOUT');
   await session.poll();
   for(const name of fs.readdirSync(relay).filter(n=>n.endsWith('.request.ready'))){
    const file=path.join(relay,name.replace(/\.ready$/,'.json')),request=read(file);if(seen.has(request.requestId))continue;
    const {requestSha256,...body}=request;assert.equal(sha(JSON.stringify(body)),requestSha256);
    let rows:any[]=[];
    if(request.kind==='READ_CONTEXT')rows=[context()];
    else if(request.kind==='READ_PUBLICATION_CONTEXT')rows=[{context:context()}];
    else if(request.kind==='PUBLISH'){
     if(!session.snapshot().reviewSeen)continue;
     publication=read(task+'/reviewed-publication-data.json');const projections=read(task+'/reviewed-projections.json');assert.equal(publication.sql,request.payload.sql);assert.equal(publication.projectionsSha256,sha(fs.readFileSync(task+'/reviewed-projections.json')));assert.equal(projections.projections.length,count);assert.equal(publication.sourceResult.sourceId,SOURCE);
     session.acceptExpectedRequest({...seed,outerDeadline:session.snapshot().outerDeadline,sourceResultId:batchId+'--'+SOURCE,requestId:request.requestId,requestSha256,sqlSha256:sha(request.payload.sql),expiresAt:Date.parse(request.expiresAt),dispatchBefore:Date.parse(request.payload.dispatchBefore)});session.consumeReview();
    }else if(request.kind==='READ_OUTCOME'){
     assert(publication);const oracle=read(task+'/test-only-reviewed-packet.json');assert.equal(oracle.kind,'TEST_ONLY_PACKET_DATA');assert.equal(oracle.productionQualified,false);assert.equal(oracle.sqlSha256,sha(publication.sql));rows=[{row:oracle.row,batch:oracle.batch,holderId:''}];outcomeRead=request;
    }else throw Error('SYNTHETIC_UNEXPECTED_RELAY_KIND:'+request.kind);
    const result=request.kind==='READ_CONTEXT'?context():scenario==='unknown-outcome'&&request.kind==='READ_OUTCOME'?{status:'FAILED',code:'XX000',outcome:'UNKNOWN'}:{status:'SUCCEEDED',rows};
    const response={schemaVersion:1,requestId:request.requestId,requestSha256,kind:request.kind,result};const responseBytes=JSON.stringify(response);fs.writeFileSync(path.join(relay,request.requestId+'.response.json'),responseBytes,{flag:'wx',mode:0o600});seen.add(request.requestId);kinds.push(request.kind);
    if(request.kind==='READ_OUTCOME')expectedOutcome={type:'PRODUCER_OUTCOME_VERIFIED_V1',tuple:{releaseCandidateId:candidate.id,batchId,sourceId:SOURCE,sourceResultId:batchId+'--'+SOURCE},readRequestSha256:requestSha256,responseSha256:sha(responseBytes)};
   }
   await delay(10);
  }
  const diagnostic=fs.readFileSync(roundRoot+'/diagnostics/stderr.log','utf8');
  if(scenario==='duplicate'){assert.notEqual(ended.code,0);assert.deepEqual(kinds,['READ_CONTEXT']);assert.equal(session.snapshot().reviewSeen,false);assert(!fs.existsSync(task+'/reviewed-publication-data.json'));}
  else if(scenario==='unknown-outcome'){assert.notEqual(ended.code,0);assert.equal(session.snapshot().outcomeSeen,false);assert.equal(session.snapshot().held,true);assert.equal(kinds.filter(x=>x==='PUBLISH').length,1);assert.equal(kinds.filter(x=>x==='READ_OUTCOME').length,1);assert(!kinds.includes('LEASE_RELEASE'));}
  else{assert.equal(ended.code,0,stderr+'\n'+diagnostic);assert.deepEqual(kinds,['READ_CONTEXT','READ_PUBLICATION_CONTEXT','PUBLISH','READ_OUTCOME']);assert.equal(session.snapshot().held,false);assert(outcomeRead);session.acceptExpectedOutcome(expectedOutcome);session.consumeOutcome();assert.throws(()=>session.consumeOutcome());}
  assert.equal(session.snapshot().dispatchAllowed,false);const http=read(roundRoot+'/http-port-log.json');assert.equal(http.realNetworkCalls,0);assert.equal(http.requests.length,scenario==='multipage'?3:2);
  const failures=fs.readdirSync(roundRoot+'/artifacts').filter(n=>n.includes('.failure-')).map(n=>read(roundRoot+'/artifacts/'+n));
  if(scenario==='duplicate'){assert.equal(failures.length,1);assert.equal(failures[0].phase,'PRE_LOCK_ADMISSION');assert.equal(failures[0].errors[0].code,'PILOT_ADMISSION_REJECTED');assert.deepEqual(failures[0].crawlResult.truth,{transportSuccess:true,adapterSuccess:true,completenessVerified:false});assert.deepEqual(failures[0].crawlResult.fetchEvidence.fetchLosses.map((x:any)=>x.details.code),['DUPLICATE_OFFICIAL_ID']);}
  else if(scenario==='unknown-outcome'){assert.equal(failures.length,1);assert.equal(failures[0].phase,'DB_STARTED_PUBLICATION');assert.deepEqual(failures[0].errors.map((x:any)=>x.code),['PILOT_OUTCOME_UNKNOWN_REQUIRES_READONLY_RECONCILIATION','XX000']);}
  else assert.deepEqual(failures,[]);
  const result={scenario,kind:'SYNTHETIC_EXTERNAL_PORTS_ACTUAL_NATIVE_COMMAND',passed:true,commit,build,count,roundRoot,relayKinds:kinds,httpRequestCount:http.requests.length,sidecarProduced:!!publication,oneShotPublication:kinds.filter(x=>x==='PUBLISH').length<=1,realDatabaseCalls:0,realNetworkCalls:0,productionQualified:false,session:session.snapshot()};write(roundRoot+'/result.json',result);console.log(JSON.stringify(result));
 }finally{if(!ended)child!.kill('SIGTERM');}
});
