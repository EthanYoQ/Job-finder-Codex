import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,existsSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {compileCloudPilotPublicationContextSql} from '../../producer/src/db/cloudPilotSqlControl.ts';
import {createHash,randomUUID} from 'node:crypto';
import {resolve,join,basename,dirname} from 'node:path';
import vm from 'node:vm';
const here=dirname(new URL(import.meta.url).pathname), installedProject=resolve(here,'..'), project=process.env.NOVARTIS_OWNER_ARTIFACT_ROOT?resolve(process.env.NOVARTIS_OWNER_ARTIFACT_ROOT):installedProject;
const manifest=JSON.parse(readFileSync(join(project,'baseline-manifest.json'),'utf8'));
const runtimeRoot=resolve(installedProject,'..'),root=join(runtimeRoot,'hosts/novartis-next/host');
const cfgTemplate=JSON.parse(readFileSync(join(root,'host-config.json'),'utf8'));
const exactBuild=JSON.parse(readFileSync(join(runtimeRoot,'NEW_LOCAL_BUILD_IDENTITY.json'),'utf8'));
const sourceLoaderCode=readFileSync(join(root,'runtime/load-source-runtime.js'),'utf8');
const preloadCode=readFileSync(join(project,'preload-owner.exec.js'),'utf8');
const testOutput=mkdtempSync(join(here,'run-'));
const protectedFiles=['activation.json','control-base.json','context-read.sql','runtime/load-host-state.js'];
const actualBefore=Object.fromEntries(protectedFiles.map(p=>[p,readFileSync(join(root,p),'utf8')]));
const original=rel=>readFileSync(root+'/'+rel,'utf8');
const rawFactoryCode=readFileSync(join(project,'publish-and-monitor-owner.js'),'utf8');
const factoryCode=rawFactoryCode.replace('const expectedCandidate = null; // OWNER_CANDIDATE_BINDING',"const expectedCandidate = {id:'synthetic-only-novartis-next-owner',goalId:'jobfinder-portable-required-40',version:53}; // OWNER_CANDIDATE_BINDING");
const entryCode=readFileSync(join(project,'publish-reviewed-and-monitor.exec.js'),'utf8');
const monitorCode=original('runtime/continuous-relay-v3-durable-monitor.js');
const helperCode=original('host-helper-functions.js'),stageCode=original('host-stage-functions.js');
const relayCode=original('relay-files.mjs').split('\n').slice(3).join('\n');
const ns='proxyNode22:novartisNext:',sha=x=>createHash('sha256').update(x).digest('hex');
const serial=x=>JSON.parse(JSON.stringify(x));
function fakeClock(){
 let now=Date.parse('2026-10-07T03:00:00Z'),serialId=0;
 const tasks=[];
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const setTimeout=(fn,ms=0)=>{tasks.push({fn,at:now+ms,id:++serialId});return serialId;};
 async function flush(){await new Promise(resolve=>setImmediate(resolve));}
 async function next(){await flush();if(!tasks.length)return false;tasks.sort((a,b)=>a.at-b.at||a.id-b.id);const t=tasks.shift();now=t.at;t.fn();await flush();return true;}
 async function finish(p){let done=false,result,error;p.then(x=>{done=true;result=x;},x=>{done=true;error=x;});for(let i=0;i<10000&&!done;i++){await flush();if(done)break;if(!await next()&&!done)throw Error('FAKE_CLOCK_NO_PROGRESS');}if(!done)throw Error('FAKE_CLOCK_BUDGET');if(error)throw error;return result;}
 return {Clock,setTimeout,flush,next,finish,get now(){return now;}};
}
async function fixture(options={}){
 const clock=fakeClock(),start=clock.now,files=new Map(),state=new Map(),events=[],notices=[];
 const cfg={...cfgTemplate};
 const batch='synthetic-owner-test',run=root+'/'+batch,dir=run+'/relay',session=24680;
 const terminal={chunk_id:'actual-synthetic-terminal',exit_code:options.exitCode??0,output:'complete terminal output\n'+ 'x'.repeat(9000),wall_time_seconds:0.01,original_token_count:9010};
 const packet=(kind,sql,ms=60000)=>{const r={schemaVersion:1,requestId:randomUUID(),kind,expiresAt:new clock.Clock(clock.now+ms).toISOString(),payload:{projectId:cfg.project,sql,...kind==='PUBLISH'?{dispatchBefore:new clock.Clock(clock.now+Math.min(ms,55000)).toISOString()}: {}}};return {...r,requestSha256:sha(JSON.stringify(r))};};
 const sql="SET LOCAL statement_timeout = '120000ms';\nDO $atomic_"+'a'.repeat(32)+"$\nDECLARE affected bigint; job_data jsonb; synthetic\nEND;\n$atomic_"+'a'.repeat(32)+"$;";
 const request=packet('PUBLISH',sql,options.expired?-1:60000);
 files.set(dir+'/'+request.requestId+'.request.json',JSON.stringify(request));
 const supplied={...request,expired:!!options.expired,dispatchRecorded:false};
 const candidate=manifest.expectedCandidate??{id:'synthetic-only-novartis-next-owner',goalId:'jobfinder-portable-required-40',version:53};
 assert.equal(candidate.id,manifest.expectedCandidate?.id??'synthetic-only-novartis-next-owner');assert.equal(candidate.version,53);assert.equal(candidate.goalId,'jobfinder-portable-required-40');
 const databaseIdentity={migrationVersion:'20261006172300_job_projection_delta_contract',schemaHash:'d'.repeat(64),dbSnapshotHash:'e'.repeat(64)};
 const control={projectId:cfg.project,build:exactBuild,candidate,databaseIdentity};
 const contextSql=compileCloudPilotPublicationContextSql(control,'PLAN_BOUND_SOURCE_QUALITY_V1');
 const binding={status:'REGISTERED_VERIFIED',build:exactBuild,candidate,databaseIdentity,contextReadSha256:sha(contextSql)};
 const renderedLoader=original('runtime/load-host-state.js').replace('const expectedCandidate=null; // OWNER_CANDIDATE_BINDING','const expectedCandidate='+JSON.stringify(candidate)+'; // OWNER_CANDIDATE_BINDING').replace('const expectedDatabaseIdentity=null; // OWNER_DATABASE_BINDING','const expectedDatabaseIdentity='+JSON.stringify(databaseIdentity)+'; // OWNER_DATABASE_BINDING');
 const loaderOverlay={[root+'/runtime/load-host-state.js']:renderedLoader,[root+'/activation.json']:JSON.stringify(binding),[root+'/control-base.json']:JSON.stringify(control),[root+'/context-read.sql']:contextSql};
 const review={requestId:request.requestId,requestSha256:request.requestSha256,sqlSha256:sha(sql),sourceResult:{id:batch+'--'+cfg.sourceId,sourceId:cfg.sourceId,sourceConfigHash:cfg.sourceConfigSha256,releaseCandidateId:binding.candidate.id}};
 const dynamicState={refreshCurrentRun:run,refreshCurrentBatch:batch,refreshSession:session,publicationReview:review,cloudPilotPublishRequest:supplied,cloudPilotPublishDirectory:dir};
 let readRequest,readServed=false,publishCalls=0,pollCalls=0,wrapperExit=false,injectSaveFailure=options.saveFailure;
 function scheduleRead(){if(readRequest)return;readRequest=packet('READ_OUTCOME','SELECT original synthetic read outcome');files.set(dir+'/'+readRequest.requestId+'.request.json',JSON.stringify(readRequest));events.push({event:'READ_OUTCOME_CREATED',at:clock.now,expiresAt:readRequest.expiresAt});}
 const fsError=code=>Object.assign(Error(code),{code});
 const memfs={
  readFile:async p=>{if(!files.has(p))throw fsError('ENOENT');return files.get(p);},
  writeFile:async(p,data,opts)=>{if(opts?.flag==='wx'&&files.has(p))throw fsError('EEXIST');files.set(p,String(data));},
  readdir:async p=>[...files.keys()].filter(k=>dirname(k)===p).map(p=>basename(p)),
  lstat:async p=>{if(!files.has(p))throw fsError('ENOENT');return {isSymbolicLink:()=>false,isFile:()=>true};},
  link:async(a,b)=>{if(files.has(b))throw fsError('EEXIST');files.set(b,files.get(a));},
  unlink:async p=>files.delete(p)
 };
 const sandbox={Date:clock.Clock,setTimeout:clock.setTimeout,console,load:k=>state.get(k),store:(k,v)=>{state.set(k,serial(v));events.push({event:'STORE',key:k,at:clock.now});},notify:x=>notices.push(serial(x)),text:()=>{}};
 const context=vm.createContext(sandbox);
 async function runRelay(command,args){let output='';const relay=vm.compileFunction('return (async()=>{'+relayCode+'})()',['readFile','writeFile','readdir','lstat','link','unlink','resolve','join','basename','createHash','randomUUID','process','console'],{parsingContext:context});await relay(...Object.values(memfs),resolve,join,basename,createHash,randomUUID,{argv:['node','relay-files.mjs',command,dir,...args]},{log:x=>{output+=x;}});return output;}
 const qargs=command=>[...command.matchAll(/'((?:[^']|'\\'')*)'/g)].map(m=>m[1].replaceAll("'\\''","'"));
 const realEvidencePaths=[];
 const tools={
  exec_command:async({cmd})=>{
   if(project!==installedProject&&cmd.startsWith('python3 - ')&&cmd.includes('PY_OWNER_LOAD'))cmd=cmd.replace("'"+installedProject+"'","'"+project+"'");
   let output='';const args=qargs(cmd);
   if(cmd.startsWith('python3 - ')&&cmd.includes(" <<'")){
    const m=/^python3 - (.*?) <<'([A-Z_]+)'\n([\s\S]*?)\n?\2$/.exec(cmd);assert(m,'Expected exact local Python heredoc');
    const isPreload=cmd.includes('publish-and-monitor-owner.js');const overlay=options.actualUnbound?{}:{...loaderOverlay};
    if(isPreload)delete overlay[root+'/runtime/load-host-state.js'];
    const overlayLiteral=JSON.stringify(JSON.stringify(overlay));
    const injected="from pathlib import Path\nimport json\n_fixture_overlay=json.loads("+overlayLiteral+")\n_real_read_bytes=Path.read_bytes\n_real_read_text=Path.read_text\ndef _read_bytes(path):\n key=str(path.resolve())\n return _fixture_overlay[key].encode() if key in _fixture_overlay else _real_read_bytes(path)\ndef _read_text(path,*args,**kwargs):\n key=str(path.resolve())\n return _fixture_overlay[key] if key in _fixture_overlay else _real_read_text(path,*args,**kwargs)\nPath.read_bytes=_read_bytes\nPath.read_text=_read_text\n";
    try{output=execFileSync('python3',['-',...qargs(m[1])],{input:injected+(isPreload&&!options.actualUnbound?m[3].replace("candidate==control['candidate']==m['expectedCandidate']","candidate==control['candidate']==json.loads('"+JSON.stringify(candidate)+"')"):m[3]),encoding:'utf8',stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});}
    catch(error){return {exit_code:error.status??1,output:String(error.stderr??error)};}
    if(isPreload&&!options.actualUnbound){const p=JSON.parse(output);p.ownerCode=factoryCode;output=JSON.stringify(p);}
    events.push({event:isPreload?'PRELOAD_LOCAL_READ':'SOURCE_LOADER_LOCAL_READ',at:clock.now});
   }else if(cmd.includes('inspect-host-binding.mts')){
    if(options.realInspector){
      const hook=join(testOutput,'actual-inspector-overlay-'+randomUUID()+'.mjs');
      const hookCode="import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';\nconst overlays="+JSON.stringify(loaderOverlay)+"; const original=fs.readFileSync; fs.readFileSync=function(path,options){const key=String(path);if(Object.hasOwn(overlays,key))return typeof options==='string'||options?.encoding?overlays[key]:Buffer.from(overlays[key]);return original.apply(this,arguments);};syncBuiltinESMExports();globalThis.fetch=async()=>{throw Error('SYNTHETIC_INSPECTOR_NETWORK_FORBIDDEN');};\n";
      writeFileSync(hook,hookCode);
      const actual=spawnSync(cfg.node,['--import',hook,'--import',join(cfg.repo,'node_modules/tsx/dist/loader.mjs'),join(root,'runtime/inspect-host-binding.mts')],{cwd:cfg.repo,encoding:'utf8',env:{...process.env,JOBFINDER_CLOUD_SOURCE_ID:cfg.sourceId,TSX_DISABLE_CACHE:'1',NODE_DISABLE_COMPILE_CACHE:'1',GIT_OPTIONAL_LOCKS:'0'}});
      assert.equal(actual.status,0,actual.stderr);output=actual.stderr+actual.stdout;
      const actualProof=JSON.parse(actual.stdout);assert.deepEqual(actualProof.build,exactBuild);assert.deepEqual(actualProof.candidate,candidate);assert.equal(actualProof.contextReadSha256,sha(contextSql));assert.equal(actualProof.nodeRuntime.execPath,cfg.node);assert.equal(actualProof.nodeRuntime.version,'v22.23.3');
      writeFileSync(join(testOutput,'ACTUAL_INSPECTOR_PROOF.json'),JSON.stringify({syntheticBindingsOnly:true,actualInspectorAndCompiler:true,noHostFilesMutated:true,noNetwork:true,noDatabase:true,proof:actualProof,rawOutput:output},null,2)+'\n');events.push({event:'ACTUAL_INSPECTOR_BUILD_COMPILER_BINARY_CHECK',at:clock.now});
    }else output=JSON.stringify({build:exactBuild,candidate,contextReadSha256:sha(contextSql),nodeRuntime:{execPath:cfg.node,version:'v22.23.3'},noNetwork:true,noDatabase:true});
   }
   else if(cmd.includes('review-packet-envelope.mts'))output=JSON.stringify({validated:true,requestId:request.requestId,requestSha256:request.requestSha256,declarationMode:'FROZEN_COMPILER_SHARED_JSON_V1'});
   else if(cmd.includes('host-files.mts')&&cmd.includes(' read ')){
    const p=args[1],txt=await memfs.readFile(p);output=JSON.stringify({text:txt,sha256:sha(txt),charCount:txt.length,next:null});
   }else if(cmd.includes('relay-files.mjs')){
    const action=cmd.match(/relay-files\.mjs' ([a-z-]+)/)?.[1];
    output=await runRelay(action,args.slice(2));
    if(action==='respond'){
      const input=JSON.parse(files.get(args[2]));
      if(input.requestId===request.requestId){events.push({event:'PUBLISH_RESPONSE',at:clock.now,result:input.result});scheduleRead();}
      else if(input.requestId===readRequest?.requestId){readServed=true;wrapperExit=true;events.push({event:'READ_OUTCOME_SERVED',at:clock.now});}
    }
   }else if(cmd.includes("collections.Counter"))output=JSON.stringify({process:wrapperExit?{event:'CHILD_EXIT',wrapperExitCode:options.wrapperExitCode??options.exitCode??0}:{event:'CHILD_RUNNING'},supervisor:null,observer:null,http:{}});
   else throw Error('UNEXPECTED_SYNTHETIC_COMMAND:'+cmd);
   return {exit_code:0,output};
  },
  apply_patch:async patch=>{
    const lines=patch.split('\n'),path=lines[1].slice('*** Add File: '.length),data=lines.slice(2,lines.indexOf('*** End Patch')).map(x=>x.slice(1)).join('\n');
    if(injectSaveFailure&&path.includes('owner-relay-evidence')){injectSaveFailure=false;throw Error('SYNTHETIC_EVIDENCE_FAILURE');}
    if(options.respondThrow&&path.endsWith('.host-result.json')&&path.includes(request.requestId))throw Error('SYNTHETIC_UNEXPECTED_RESPOND_THROW');
    if(files.has(path))throw Error('SYNTHETIC_SAVE_WOULD_OVERWRITE');
    if(options.realEvidence&&path.includes('owner-relay-evidence')){
      const realPath=join(testOutput,'real-evidence-'+randomUUID()+'.json');
      const realPatch=patch.replace('*** Add File: '+path,'*** Add File: '+realPath);
      execFileSync('/usr/local/bin/apply_patch',[realPatch],{encoding:'utf8'});const persisted=readFileSync(realPath,'utf8');files.set(path,persisted);realEvidencePaths.push({path:realPath,logicalPath:path,sha256:sha(persisted),bytes:Buffer.byteLength(persisted)});
    }else files.set(path,data+(path.includes('owner-relay-evidence')?(options.evidenceSuffix??'\n'):'\n'));return {};
  },
  mcp__codex_apps__supabase_execute_sql:async({query})=>{
    if(query===sql){publishCalls++;events.push({event:'PUBLISH_TOOL',at:clock.now});
      if(options.denied){clock.setTimeout(scheduleRead,60000);return {isError:true,content:[{type:'text',text:'This action was rejected due to unacceptable risk.\nReason: Synthetic test only'}]};}
      if(options.unknown)throw Error('SYNTHETIC_TRANSPORT_UNKNOWN');
    }else if(query===readRequest?.payload.sql)events.push({event:'READ_OUTCOME_TOOL',at:clock.now});
    else throw Error('UNEXPECTED_SYNTHETIC_SQL');
    return {structuredContent:{result:'\n<untrusted-data-synthetic>\n[]\n</untrusted-data-synthetic>'},content:[]};
  },
  write_stdin:async({session_id})=>{
    assert.equal(session_id,session);pollCalls++;events.push({event:'ORIGINAL_EXEC_POLL',at:clock.now,pollCalls});
    if(options.pollThrow)throw Error('SYNTHETIC_POLL_UNRESOLVED');
    if(options.liveForever||pollCalls<=(options.runningPolls??0))return await new Promise(resolve=>clock.setTimeout(()=>resolve({session_id:session,output:'still alive',wall_time_seconds:1}),1000));
    return options.malformedTerminal?{...terminal,session_id:session}:serial(terminal);
  }
 };
 sandbox.tools=tools;
 const runSourceLoader=(key='novartisNext')=>vm.compileFunction('return (async()=>{'+sourceLoaderCode+'})()',['sourceKey'],{parsingContext:context})(key);
 const runPreload=(key='novartisNext')=>vm.compileFunction('return (async()=>{'+preloadCode+'})()',['sourceKey'],{parsingContext:context})(key);
 if(!options.skipSetup){
  await runSourceLoader();
  assert.equal(state.get(ns+'cloudPilotHostHelpers'),helperCode);assert.equal(state.get(ns+'cloudPilotHostStages'),stageCode);assert.equal(state.get(ns+'continuousPortableRelayCodeWithPoll'),monitorCode);
  assert(![...state.keys()].some(k=>k.startsWith('proxyNode22:novartis:')));
  await runPreload();
  const prepared=state.get(ns+'publishMonitorPrepared');assert(prepared,'Prepared owner must be created by actual preload');assert.deepEqual(prepared.registeredBinding,serial(binding));
 }
 for(const [k,v]of Object.entries(dynamicState))state.set(ns+k,v);
 const stages=options.skipSetup?null:await vm.runInContext('(async()=>{'+stageCode+'})()',context);
 const env={...sandbox,tools,Date:clock.Clock,setTimeout:clock.setTimeout};
 const owner=await vm.compileFunction('return (async()=>{'+factoryCode+'})()',['env'],{parsingContext:context})(env);
 const input={sourceKey:'novartisNext',stages,monitorCode,request:supplied,sql};
 return {owner,input,clock,files,state,events,notices,request,terminal,start,ns,run,dir,review,session,binding,realEvidencePaths,runSourceLoader,runPreload,runOriginal:()=>vm.runInContext('(async()=>{'+monitorCode+'})()',context),runEntry:(mode,key='novartisNext')=>vm.compileFunction('return (async()=>{'+entryCode+'})()',['sourceKey','ownerMode'],{parsingContext:context})(key,mode),get publishCalls(){return publishCalls;},get pollCalls(){return pollCalls;},get readServed(){return readServed;}};

}

test('all real input baselines remain byte-identical',()=>{for(const [p,m]of Object.entries(manifest.files))assert.equal(sha(readFileSync(p)),m.sha256,p);});
test('successful PUBLISH attaches awaited monitor before 65s external-message pause completes',async()=>{
 const f=await fixture();let externalFinished=false;f.clock.setTimeout(()=>{externalFinished=true;f.events.push({event:'EXTERNAL_REPORT_FINISHED',at:f.clock.now});},65000);
 const result=await f.clock.finish(f.owner(f.input));assert.equal(result.status,'PROCESS_TERMINATED');assert.equal(f.publishCalls,1);assert.equal(f.readServed,true);assert.equal(externalFinished,false);
 const read=f.events.find(x=>x.event==='READ_OUTCOME_SERVED'),created=f.events.find(x=>x.event==='READ_OUTCOME_CREATED');assert.ok(read.at<Date.parse(created.expiresAt));
 await f.clock.next();assert.equal(externalFinished,true);
 const accepted=f.state.get(ns+'lastPortableExecTerminalAccepted');assert.equal(accepted.validated,true);assert.deepEqual(accepted.raw,f.terminal);
 const evidence=JSON.parse(f.files.get(result.evidencePath));assert.deepEqual(evidence.raw,f.terminal);assert.ok(f.files.get(result.evidencePath).length>9000);assert.equal(result.publicationReconciled,false);
});
test('denial stays UNKNOWN, waits original expiry, original relay settles hold and uses original readback once',async()=>{
 const f=await fixture({denied:true});const result=await f.clock.finish(f.owner(f.input));assert.equal(f.publishCalls,1);assert.equal(f.readServed,true);assert.equal(result.status,'PROCESS_TERMINATED');assert.equal(result.publicationResult.status,'AWAITING_OWNER_RECONCILIATION');
 const response=JSON.parse(f.files.get(f.dir+'/'+f.request.requestId+'.response.json'));assert.deepEqual(response.result,{status:'FAILED',outcome:'UNKNOWN',code:'UNKNOWN'});
 const marker=JSON.parse(f.files.get(f.dir+'/'+f.request.requestId+'.dispatch.json'));assert.equal(marker.state,'MAY_HAVE_BEEN_SENT');assert.equal(f.request.expiresAt,new Date(f.start+60000).toISOString());
 assert.ok(f.events.find(x=>x.event==='READ_OUTCOME_TOOL').at>=f.start+60000);
 await assert.rejects(f.owner(f.input),/OWNER_ALREADY_CLAIMED_NO_PUBLISH_RETRY/);assert.equal(f.publishCalls,1);
});
test('connector transport UNKNOWN follows original response and READ_OUTCOME path without PUBLISH retry',async()=>{
 const f=await fixture({unknown:true});const result=await f.clock.finish(f.owner(f.input));assert.equal(f.publishCalls,1);assert.equal(f.readServed,true);assert.deepEqual(serial(result.publicationResult),{status:'FAILED',outcome:'UNKNOWN',code:'UNKNOWN'});
});
test('expired request fails before submission or accepted state',async()=>{
 const f=await fixture({expired:true});await assert.rejects(f.owner(f.input),/OWNER_STALE_OR_UNCERTAIN_NO_SUBMIT/);assert.equal(f.publishCalls,0);assert.equal(f.pollCalls,0);assert.equal(f.state.has(ns+'lastPortableExecTerminalAccepted'),false);
});
test('live original session never becomes accepted; later terminal retains same session',async()=>{
 const f=await fixture({runningPolls:2});const promise=f.owner(f.input);await f.clock.flush();assert.equal(f.state.has(ns+'lastPortableExecTerminalAccepted'),false);await f.clock.next();assert.equal(f.state.has(ns+'lastPortableExecTerminalAccepted'),false);const result=await f.clock.finish(promise);assert.equal(result.status,'PROCESS_TERMINATED');assert.equal(f.pollCalls,3);assert.equal(f.publishCalls,1);
});
test('original terminal exit 1 is retained, never reclassified as zero or successful completion',async()=>{
 const f=await fixture({exitCode:1});const result=await f.clock.finish(f.owner(f.input));assert.equal(result.originalExec.exitCode,1);assert.equal(result.successfulCompletionEligible,false);assert.equal(f.state.get(ns+'lastPortableExecPoll').exit_code,1);assert.equal(JSON.parse(f.files.get(result.evidencePath)).raw.exit_code,1);
});
test('durable/tool exit mismatch saves full terminal evidence but has no accepted terminal',async()=>{
 const f=await fixture({exitCode:1,wrapperExitCode:0});const result=await f.clock.finish(f.owner(f.input));assert.equal(result.status,'ORIGINAL_EXEC_UNKNOWN');assert.match(result.monitorError,/DURABLE_EXIT_TOOL_EXIT_MISMATCH/);assert.equal(f.state.has(ns+'lastPortableExecTerminalAccepted'),false);assert.deepEqual(JSON.parse(f.files.get(result.evidencePath)).raw,f.terminal);
});
test('unexpected response throw remains UNKNOWN and preserves uncertain dispatch marker without fake response',async()=>{
 const f=await fixture({respondThrow:true});const result=await f.clock.finish(f.owner(f.input));assert.equal(result.status,'ORIGINAL_EXEC_UNKNOWN');assert.equal(result.outcome,'UNKNOWN');assert.equal(f.publishCalls,1);assert.equal(f.files.has(f.dir+'/'+f.request.requestId+'.response.json'),false);assert.equal(JSON.parse(f.files.get(f.dir+'/'+f.request.requestId+'.dispatch.json')).state,'MAY_HAVE_BEEN_SENT');assert.equal(f.state.has(ns+'lastPortableExecTerminalAccepted'),false);
});
test('original-session poll error is unresolved and resume is monitor-only with no PUBLISH replay',async()=>{
 const f=await fixture({pollThrow:true});const result=await f.clock.finish(f.owner(f.input));assert.equal(result.status,'ORIGINAL_EXEC_UNKNOWN');assert.equal(f.publishCalls,1);assert.equal(f.state.has(ns+'lastPortableExecTerminalAccepted'),false);const continued=await f.clock.finish(f.owner({...f.input,mode:'resume'}));assert.equal(continued.status,'ORIGINAL_EXEC_UNKNOWN');assert.equal(f.publishCalls,1);assert.equal(f.pollCalls,2);
});
test('session id plus exit code is malformed, never accepted',async()=>{
 const f=await fixture({malformedTerminal:true});const result=await f.clock.finish(f.owner(f.input));assert.equal(result.status,'ORIGINAL_EXEC_UNKNOWN');assert.equal(f.state.has(ns+'lastPortableExecTerminalAccepted'),false);
});
test('evidence persistence failure blocks accepted state despite tool terminal',async()=>{
 const f=await fixture({saveFailure:true});const result=await f.clock.finish(f.owner(f.input));assert.equal(result.status,'ORIGINAL_EXEC_UNKNOWN');assert.match(result.evidenceError,/SYNTHETIC_EVIDENCE_FAILURE/);assert.equal(f.state.has(ns+'lastPortableExecTerminalAccepted'),false);
});

test('regression: original monitor alone throws on dispatched review hold before its expiry',async()=>{
 const f=await fixture({denied:true});const submitted=await f.input.stages.h.sqlDispatch(f.input.request,f.dir,f.input.sql);assert.equal(submitted.status,'AWAITING_OWNER_RECONCILIATION');await assert.rejects(f.clock.finish(f.runOriginal()),/HOST_STALE_OR_UNCERTAIN_REQUEST:PUBLISH/);assert.equal(f.publishCalls,1);assert.ok(f.clock.now<f.start+60000);
});
test('denied unresolved original exec returns explicit monitor-only continuation',async()=>{
 const f=await fixture({denied:true,pollThrow:true});const result=await f.clock.finish(f.owner(f.input));assert.equal(result.status,'AWAITING_OWNER_RECONCILIATION');assert.equal(result.continuation.mode,'resume');assert.equal(result.outcome,'UNKNOWN');assert.equal(result.retryAuthorized,false);await f.clock.finish(f.owner({...f.input,mode:'resume'}));assert.equal(f.publishCalls,1);
});
test('still-live original session at unchanged monitor budget has no accepted terminal',async()=>{
 const f=await fixture({liveForever:true});const result=await f.clock.finish(f.owner(f.input));assert.equal(result.status,'ORIGINAL_EXEC_UNKNOWN');assert.equal(f.state.has(ns+'lastPortableExecTerminalAccepted'),false);assert.ok(f.clock.now>=f.start+30*60*1000);assert.equal(f.publishCalls,1);
});

test('reviewed functions.exec entry awaits the complete owner lifetime',async()=>{
 const f=await fixture();await f.clock.finish(f.runEntry('publish'));assert.equal(f.publishCalls,1);assert.equal(f.readServed,true);assert.deepEqual(f.state.get(ns+'lastPortableExecTerminalAccepted').raw,f.terminal);
});
test('consumed terminal with failed evidence requests reconciliation, never repolls or republishes',async()=>{
 const f=await fixture({saveFailure:true});const result=await f.clock.finish(f.owner(f.input));assert.equal(result.continuation.mode,'reconcile-retained-terminal');await assert.rejects(f.owner({...f.input,mode:'resume'}),/OWNER_TERMINAL_REQUIRES_RECONCILIATION/);assert.equal(f.pollCalls,1);assert.equal(f.publishCalls,1);
});

test('mock matches observed real apply_patch final LF and accepts it without trim',async()=>{
 const f=await fixture();const result=await f.clock.finish(f.owner(f.input));const text=f.files.get(result.evidencePath);assert.equal(text.endsWith('\n'),true);assert.equal(text.endsWith('\n\n'),false);assert.equal(result.status,'PROCESS_TERMINATED');assert.equal(f.state.get(ns+'lastPortableExecTerminalAccepted').validated,true);
});
test('exact JSON without final LF remains accepted',async()=>{
 const f=await fixture({evidenceSuffix:''});const result=await f.clock.finish(f.owner(f.input));assert.equal(result.status,'PROCESS_TERMINATED');assert.equal(f.files.get(result.evidencePath).endsWith('\n'),false);
});
test('double final LF fails evidence validation instead of being trimmed',async()=>{
 const f=await fixture({evidenceSuffix:'\n\n'});const result=await f.clock.finish(f.owner(f.input));assert.equal(result.status,'ORIGINAL_EXEC_UNKNOWN');assert.match(result.evidenceError,/OWNER_TERMINAL_EVIDENCE_READBACK/);assert.equal(f.state.has(ns+'lastPortableExecTerminalAccepted'),false);
});
test('extra content after JSON fails evidence validation',async()=>{
 const f=await fixture({evidenceSuffix:'\nTAMPERED'});const result=await f.clock.finish(f.owner(f.input));assert.equal(result.status,'ORIGINAL_EXEC_UNKNOWN');assert.match(result.evidenceError,/OWNER_TERMINAL_EVIDENCE_READBACK/);assert.equal(f.state.has(ns+'lastPortableExecTerminalAccepted'),false);
});

test('fixture written by actual apply_patch reads back as exact JSON plus one LF',()=>{
 const raw=readFileSync(join(here,'real-apply-patch-terminal-fixture.json'),'utf8');const value=JSON.parse(raw);assert.equal(raw,JSON.stringify(value)+'\n');assert.notEqual(raw,JSON.stringify(value)+'\n\n');assert.equal(value.raw.exit_code,1);assert.equal(value.raw.chunk_id,'synthetic-only-real-file-roundtrip');
});

// New wiring coverage. Every prepared state below comes from the actual preload entry.
test('source loader novartisNext -> exact novartisNext preload -> publish entry preserves complete lifetime and real terminal bytes',async()=>{
 const f=await fixture({realEvidence:true,realInspector:true});
 const prep=f.state.get(ns+'publishMonitorPrepared');assert.deepEqual(prep.registeredBinding,serial(f.binding));assert.equal(prep.hostRoot,root);
 assert.equal(f.events.filter(x=>x.event==='SOURCE_LOADER_LOCAL_READ').length,2);assert.equal(f.events.filter(x=>x.event==='PRELOAD_LOCAL_READ').length,1);
 await f.clock.finish(f.runEntry('publish'));
 assert.equal(f.publishCalls,1);assert.equal(f.pollCalls,1);assert.equal(f.readServed,true);
 const read=f.events.find(x=>x.event==='READ_OUTCOME_SERVED'),created=f.events.find(x=>x.event==='READ_OUTCOME_CREATED');assert.ok(read.at<Date.parse(created.expiresAt));
 const accepted=f.state.get(ns+'lastPortableExecTerminalAccepted');assert.equal(accepted.validated,true);assert.deepEqual(accepted.raw,f.terminal);
 assert.equal(f.realEvidencePaths.length,1);const actual=f.realEvidencePaths[0],raw=readFileSync(actual.path,'utf8');assert.equal(raw,JSON.stringify(JSON.parse(raw))+'\n');assert(!raw.endsWith('\n\n'));assert.deepEqual(JSON.parse(raw).raw,f.terminal);assert(raw.length>9000);
 writeFileSync(join(testOutput,'COMPLETE_CHAIN_PROOF.json'),JSON.stringify({syntheticOnly:true,noExternalHttp:true,noDatabase:true,noProducerLaunch:true,sourceLoaderKey:'novartisNext',ownerSourceKey:'novartisNext',namespace:ns,build:exactBuild,registeredBinding:prep.registeredBinding,preparedBy:'preload-owner.exec.js',syntheticCandidateTuple:!manifest.expectedCandidate,preparedActualCandidateTuple:!!manifest.expectedCandidate,actualInstalledOwnerCandidateRemainsNull:true,preloadHashChecksUseActualBytes:true,syntheticOwnerBindingAppliedAfterLocalValidation:!manifest.expectedCandidate,syntheticDatabaseIdentity:true,syntheticRequestsAndTerminal:true,publishToolCalls:f.publishCalls,readOutcomeServedBeforeExpiry:true,originalSessionId:f.session,fullTerminalPersisted:true,actualExecutingInspectorCompilerAndBuildVerified:true,evidence:actual,events:f.events},null,2)+'\n');
});
for(const key of ['novartis','abbvie','novartisnext']){
 test('preload rejects wrong owner source '+key+' before reads or state',async()=>{
  const f=await fixture();const before=serial([...f.state.entries()]),eventCount=f.events.length;
  await assert.rejects(f.runPreload(key),/OWNER_SOURCE_KEY/);assert.deepEqual(serial([...f.state.entries()]),before);assert.equal(f.events.length,eventCount);assert.equal(f.publishCalls,0);
 });
 test('entry rejects wrong owner source '+key+' without PUBLISH',async()=>{
  const f=await fixture();await assert.rejects(f.runEntry('publish',key),/OWNER_ENTRY_ARGUMENT/);assert.equal(f.publishCalls,0);assert.equal(f.pollCalls,0);
 });
 test('factory rejects wrong owner source '+key+' without PUBLISH',async()=>{
  const f=await fixture();await assert.rejects(f.owner({...f.input,sourceKey:key}),/OWNER_ARGUMENT/);assert.equal(f.publishCalls,0);assert.equal(f.pollCalls,0);
 });
}
for(const [name,change]of [
 ['version54',b=>{b.candidate.version=54;}],['candidate id',b=>{b.candidate.id+='-wrong';}],['candidate goal',b=>{b.candidate.goalId+='-wrong';}],['build commit',b=>{b.build.commitSha='28402a299bb04cbf5873da66c2fe8ca76827c0d1';}],['build content hash',b=>{b.build.contentSha256='0'.repeat(64);}],['DB snapshot',b=>{b.databaseIdentity.dbSnapshotHash='0'.repeat(64);}],['context hash',b=>{b.contextReadSha256='0'.repeat(64);}]
]){
 test('entry rejects changed preloaded '+name+' tuple',async()=>{
  const f=await fixture();const binding=serial(f.state.get(ns+'registeredCandidateBinding'));change(binding);f.state.set(ns+'registeredCandidateBinding',binding);
  await assert.rejects(f.runEntry('publish'),/OWNER_.*BINDING|OWNER_ENTRY_NOT_PINNED/);assert.equal(f.publishCalls,0);assert.equal(f.pollCalls,0);assert.equal(f.state.has(ns+'lastPortableExecTerminalAccepted'),false);
 });
 test('factory rejects changed preloaded '+name+' tuple',async()=>{
  const f=await fixture();const binding=serial(f.state.get(ns+'registeredCandidateBinding'));change(binding);f.state.set(ns+'registeredCandidateBinding',binding);
  await assert.rejects(f.owner(f.input),/OWNER_.*BINDING/);assert.equal(f.publishCalls,0);assert.equal(f.pollCalls,0);
 });
}
test('actual unbound host loader rejects and creates no prepared owner',async()=>{
 const f=await fixture({skipSetup:true,actualUnbound:true});await assert.rejects(f.runSourceLoader(),/CANDIDATE_NOT_REGISTERED|HOST_OWNER_BINDING_REQUIRED/);assert(!f.state.has(ns+'publishMonitorPrepared'));assert(!f.state.has(ns+'registeredCandidateBinding'));assert.equal(f.publishCalls,0);
});
test('actual unbound preload rejects without touching main host',async()=>{
 const f=await fixture({skipSetup:true,actualUnbound:true});await assert.rejects(f.runPreload(),/OWNER_PRELOAD_LOCAL_READ_FAILED|OWNER_.*BINDING/);assert(!f.state.has(ns+'publishMonitorPrepared'));assert.equal(f.publishCalls,0);
});
test('entry requires preload-produced prepared state',async()=>{
 const f=await fixture();f.state.delete(ns+'publishMonitorPrepared');await assert.rejects(f.runEntry('publish'),/OWNER_ENTRY_NOT_PINNED/);assert.equal(f.publishCalls,0);
});
test('loader rejects owner source key at source-selection boundary',async()=>{
 const f=await fixture({skipSetup:true});await assert.rejects(f.runSourceLoader('novartis'),/RESTORED46_SOURCE_SELECTION/);assert(!f.state.has(ns+'publishMonitorPrepared'));assert.equal(f.publishCalls,0);
});
test('all original 22 test names remain present and actual host remains null and byte-identical',()=>{
 const originalNames=JSON.parse(readFileSync(join(here,'original-22-case-names.json'),'utf8'));assert.equal(originalNames.length,22);
 const source=readFileSync(new URL(import.meta.url),'utf8');for(const name of originalNames)assert(source.includes("test('"+name+"'"),name);
 for(const p of protectedFiles)assert.equal(readFileSync(join(root,p),'utf8'),actualBefore[p]);
 const binding=JSON.parse(original('activation.json'));assert.equal(binding.candidate,null);assert.equal(binding.status,'UNREGISTERED_NOT_ACTIVATED');assert.equal(execFileSync('git',['status','--porcelain'],{cwd:cfgTemplate.repo,encoding:'utf8',env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}}),'');
 writeFileSync(join(testOutput,'TEST_SCOPE.json'),JSON.stringify({syntheticOnly:true,original22Preserved:true,noExternalHttp:true,noDatabase:true,noRegistration:true,noProducerLaunch:true,actualHostUnchanged:true,actualCandidate:null,producerGitClean:true,testOutput},null,2)+'\n');
 writeFileSync(join(here,'LATEST_RUN.json'),JSON.stringify({testOutput},null,2)+'\n');
});
