/** Actual closed two-source generated entry; all external ports are SYNTHETIC.
 * No source factory, source body, shared core, source UI or close gate is mocked.
 * No install, dependency copy, database call, browser call or production activation.
 * Args: Takeda fixture JSON, Biogen fixture JSON, optional report JSON.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {withKnownNotDispatchedScenarios} from '../../tests/source-seal-harness.mjs';
const HERE=path.dirname(fileURLToPath(import.meta.url)),SEQUENCE=path.dirname(HERE),HOST=path.dirname(SEQUENCE);
const sha=x=>createHash('sha256').update(x).digest('hex');
const [takedaPath,biogenPath,reportPath]=process.argv.slice(2);
assert.ok(takedaPath&&biogenPath,'SYNTHETIC_FIXTURE_PATHS_REQUIRED');
const fixturePaths={takeda:path.resolve(takedaPath),biogen:path.resolve(biogenPath)};
const fixtures=Object.fromEntries(Object.entries(fixturePaths).map(([k,p])=>[k,JSON.parse(fs.readFileSync(p,'utf8'))]));
for(const name of ['takeda','biogen']){
 assert.equal(fixtures[name].context.sourceId,`source-${name}-china-social`);
 assert.equal(fixtures[name].context.latestAccepted,null,'FIRST_PUBLIC_FIXTURE_LATEST_ACCEPTED_NULL');
 assert.equal(fixtures[name].context.firstAccepted,null,'FIRST_PUBLIC_FIXTURE_FIRST_ACCEPTED_NULL');
}
assert.equal(fixtures.biogen.model.projections.length,7);
assert.ok(fixtures.biogen.requests.PUBLISH.payload.sql.includes('biibhr.wd3.myworkdayjobs.com'));
assert.ok(!fixtures.biogen.requests.PUBLISH.payload.sql.includes('jobs.takeda.com'));
const original=fs.readFileSync(path.join(SEQUENCE,'functions-entry.js'),'utf8');
const py=String.raw`import json,runpy,sys
sys.dont_write_bytecode=True
m=runpy.run_path(sys.argv[1]);b=m['b'];i=b.load_source_inputs();r=m['synthetic_release'](i);b.validate_release(i,r)
print(json.dumps({'release':r,'entry':b.render_entry(i,r).decode(),'defaultSha256':b.sha(b.render_entry(i))}))`;
const built=spawnSync('python3',['-B','-c',py,path.join(HERE,'canonical.test.py')],{encoding:'utf8',maxBuffer:8*1024*1024});
assert.equal(built.status,0,built.stderr);
const {release,entry,defaultSha256}=JSON.parse(built.stdout);
assert.equal(sha(original),defaultSha256,'ACTUAL_DEFAULT_GENERATED_BYTES');
// Only the outer, build-emitted disabled DATA constant is enabled in memory.
// The actual factory/body/core/UI and the closed validated release stay unchanged.
const outer=entry.split('\n',1)[0];assert.ok(outer.includes('"enabled":false'));
const bundle=entry.replace(outer,outer.replace('"enabled":false','"enabled":true'));
assert.equal(bundle.slice(bundle.indexOf('\n')),entry.slice(entry.indexOf('\n')),'ACTUAL_EXECUTION_BYTES_UNCHANGED');
const digestSource=fs.readFileSync(path.join(HOST,'functions/sha256.js'),'utf8');
const originalHarness=fs.readFileSync(path.join(HOST,'tests/full-composition-v8-harness.js'),'utf8');
const AF=Object.getPrototypeOf(async function(){}).constructor;
function replaceOnce(s,from,to){assert.equal(s.split(from).length,2,'TEST_HARNESS_ANCHOR:'+from);return s.replace(from,to);}
let portSource=withKnownNotDispatchedScenarios(originalHarness);
portSource=portSource.slice(0,portSource.indexOf(' const actualBundle='));
portSource=replaceOnce(portSource,"roundId='round-'+sha(name).slice(0,32)","roundId='round-'+sha(profile+'_'+name).slice(0,32)");
portSource=replaceOnce(portSource,"TASK=BASE+'/rounds/'+roundId","TASK=BASE+'/sources/'+profile+'/rounds/'+roundId");
portSource=replaceOnce(portSource,"buildSha256:'a'.repeat(64)","buildSha256:deployment.build.contentSha256");
portSource=portSource.replaceAll('fixed-functions-v4-unregistered',release.profiles.takeda.candidate.id);
portSource+='\n return {tools:syntheticTools,TestDate,requests,seed,cfg,fixture:f,terminal,stats:()=>({prepareCalls,bootstrapCalls,launchCalls,publishCalls,publishMarkCalls,publishResponseCalls,responseCalls,readOutcomeCalls,polls,ended,resolved,rawEvidenceWrites:[...files.keys()].filter(x=>x.endsWith(\'.raw-diagnostic\')).length,uiCalls:uiCalls.length}),calls,safeNotices};\n}\nreturn scenario(scenarioName);';
function sourcePortCode(name){
 if(name==='takeda')return portSource;
 let h=portSource.replaceAll('source-takeda-china-social','source-biogen-china-social').replaceAll('company-takeda-china','company-biogen-china').replaceAll('武田中国','渤健中国').replaceAll('https://jobs.takeda.com/location/china-jobs/1113/1814991/2','https://biibhr.wd3.myworkdayjobs.com/external').replaceAll('2 个职位','7 个职位');
 return replaceOnce(h,"const jobs=f.model.projections.map(p=>({sourceJobId:p.sourceJobId,officialTitle:p.officialTitle,officialUrl:p.officialUrl}));","const jobs=f.model.projections.map(p=>({sourceJobId:p.officialUrl.slice('https://biibhr.wd3.myworkdayjobs.com/external'.length),officialTitle:p.officialTitle,officialUrl:p.officialUrl}));");
}
const portFactory=Object.fromEntries(['takeda','biogen'].map(n=>[n,new AF('fixtureData','digestSource','mode','deploymentInfo','profile','scenarioName',sourcePortCode(n))]));
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const cases=[
 {name:'success-fresh-context',a:'success',continued:true},
 {name:'not-due-continues',a:'not-due',continued:true},
 {name:'exact-known-failure-continues',a:'known-not-dispatched',continued:true},
 {name:'pending-original-tool-holds',a:'pending-late'},
 {name:'unknown-tool-result-holds',a:'tool-isError'},
 {name:'projection-integrity-holds',a:'projection-tamper'},
 {name:'committed-ui-failure-holds',a:'ui-hold'},
 {name:'may-have-been-sent-holds',a:'known-may-have-been-sent'},
 {name:'signal-terminal-holds',a:'known-signal'},
 {name:'half-frame-terminal-holds',a:'known-half-frame'},
 {name:'raw-evidence-await-before-next-source',a:'success',continued:true,block:'raw'},
 {name:'durable-source-settled-before-next-source',a:'success',continued:true,block:'durable'},
 {name:'record-await-hold-no-publication',a:'record-deferred-hold'},
 {name:'mark-await-hold-no-publication',a:'mark-deferred-hold'},
 {name:'record-half-frame-no-publication',a:'record-half-frame'},
 {name:'mark-half-frame-no-publication',a:'mark-half-frame'},
 {name:'raw-evidence-failure-holds',a:'raw-diagnostic-failure'},
 {name:'not-due-nonzero-holds',a:'not-due-child-nonzero'},
];
const reports=[];
for(const c of cases){
 const events=[],ports={},facts=[],contexts=[],blocked=defer(),releaseBlock=defer();let active=null,closed=false,ledgerVersion=0,activeCommands=0,pendingSeen=false;
 const push=(type,extra={})=>events.push({i:events.length,type,source:active,...extra});
 const noB=()=>{assert.equal(ports.biogen,undefined,'B_FACTORY_NOT_CREATED');assert.equal(events.some(e=>e.type==='source-started'&&e.source==='biogen'),false,'B_NOT_STARTED');};
 const scope={
  assertOriginal(){assert.equal(closed,false,'ORIGINAL_SCOPE_STILL_OPEN');},
  async sourceStarted(profile,releaseSha){
   if(profile==='biogen'){assert.equal(facts.length,1);assert.equal(activeCommands,0);assert.ok(['VERIFIED','NOT_DUE','KNOWN_NOT_DISPATCHED'].includes(facts[0].kind));}
   active=profile;push('source-started',{releaseSha});
   const deployment=release.profiles[profile],activation={enabled:true,mode:'LIVE',deploymentSha256:sha(JSON.stringify(deployment))};
   ports[profile]=await portFactory[profile](fixtures[profile],digestSource,'LIVE',{deployment,activation},profile,profile==='takeda'?c.a:'success');
   ports[profile].fixture.context.syntheticLedgerVersion=ledgerVersion;
   push('fresh-source-seed',{roundId:ports[profile].seed.batchId,challenge:ports[profile].seed.launchChallenge,createdAt:Date.now()});
  },
  async sourceSettled(profile,releaseSha,fact){
   assert.equal(profile,active);assert.equal(activeCommands,0,'ALL_ORIGINAL_COMMANDS_SETTLED');
   const s=ports[profile].stats();assert.ok(s.ended,'ORIGINAL_SYNTHETIC_DUAL_TERMINAL');
   if(fact.kind==='VERIFIED'){assert.equal(s.resolved,true);assert.equal(s.rawEvidenceWrites,1);assert.equal(s.publishResponseCalls,1);assert.ok(s.uiCalls>0);}
   if(profile==='takeda'&&c.block==='durable'){noB();push('durable-ack-pending');blocked.resolve();await releaseBlock.promise;noB();}
   facts.push(fact);push('source-settled',{kind:fact.kind,stats:s});
  },
  closeCycle(result){assert.equal(facts.length,2);assert.equal(result.results.length,2);assert.equal(activeCommands,0);closed=true;push('cycle-closed');}
 };
 const current=()=>{assert.ok(active&&ports[active]);return ports[active];};
 const tools={
  async exec_command(args){
   const profile=active,p=current();activeCommands++;
   try{
    if(args.cmd.includes(" 'prepare'")){assert.ok(args.cmd.includes('cli-'+profile+'.py'),'COMPILE_FIXED_STABLE_CLI');push('prepare');}
    if(c.block==='raw'&&profile==='takeda'&&args.cmd.includes(" 'record-tool-result' ")){noB();push('raw-evidence-pending');blocked.resolve();await releaseBlock.promise;noB();push('raw-evidence-released');}
    return await p.tools.exec_command(args);
   }finally{activeCommands--;}
  },
  async write_stdin(args){activeCommands++;try{return await current().tools.write_stdin(args);}finally{activeCommands--;}}
  ,async apply_patch(patch){activeCommands++;try{return await current().tools.apply_patch(patch);}finally{activeCommands--;}}
  ,mcp__codex_apps__supabase_execute_sql(args){
   const profile=active,p=current(),kind=args.query===p.requests.PUBLISH.payload.sql?'PUBLISH':args.query===p.requests.READ_PUBLICATION_CONTEXT.payload.sql?'READ_PUBLICATION_CONTEXT':args.query==='SELECT TEST_ONLY_CONTEXT'?'READ_CONTEXT':args.query===p.requests.READ_OUTCOME.payload.sql?'READ_OUTCOME':'BOOTSTRAP';
   push('sql',{kind,ledgerVersion});
   if(kind==='READ_CONTEXT'||kind==='READ_PUBLICATION_CONTEXT')contexts.push({source:profile,kind,ledgerVersion,firstPublic:p.fixture.context.latestAccepted===null,querySha256:sha(args.query),at:Date.now()});
   // Capture and return the exact original synthetic official Promise unchanged.
   const originalPromise=p.tools.mcp__codex_apps__supabase_execute_sql(args);
   if(kind==='PUBLISH')originalPromise.then(()=>{if(c.a==='success'||profile==='biogen'){ledgerVersion++;push('synthetic-db-committed',{profile,ledgerVersion});}},()=>{});
   return originalPromise;
  },
  async mcp__cua_repl__js(args){return current().tools.mcp__cua_repl__js(args);}
 };
 class CycleDate extends Date{static now(){return active?current().TestDate.now():Date.now();}}
 const notice=x=>{push('notice',{kind:x.kind});if(x.kind==='ORIGINAL_SESSION_DRAINED_BEFORE_PENDING_SERVICE'&&c.a==='pending-late'){noB();pendingSeen=true;assert.equal(ports.takeda.stats().resolved,false);}};
 const api=new Function('tools','Date','notify','lifecycleScope',bundle)(tools,CycleDate,notice,scope);
 const running=api.runLiveRound();
 if(c.block){await blocked.promise;noB();await sleep(20);noB();releaseBlock.resolve();}
 const result=await running;
 assert.ok(ports.takeda.stats().publishCalls<=1,'A_PUBLISH_AT_MOST_ONCE');
 if(['record-deferred-hold','mark-deferred-hold','record-half-frame','mark-half-frame','known-may-have-been-sent','known-signal','known-half-frame','not-due-child-nonzero'].includes(c.a))assert.equal(ports.takeda.stats().publishCalls,0,'HELD_CONTINUATION_NEVER_PUBLISHES');
 if(c.a==='pending-late'){assert.equal(ports.takeda.stats().publishCalls,1);assert.equal(ports.takeda.stats().publishResponseCalls,0);assert.equal(result.results[0].result.sameOriginalPromise,true);}
 if(c.a==='tool-isError')assert.equal(result.results[0].result.databaseStatus,'UNKNOWN');
 if(c.a==='ui-hold'){assert.equal(result.results[0].result.databaseStatus,'LIVE_VERIFIED');assert.equal(ports.takeda.stats().publishCalls,1);}
 if(c.continued){
  assert.equal(result.status,'SEQUENCE_SAFELY_CLOSED',JSON.stringify(result));assert.equal(closed,true);assert.equal(result.results.length,2);
  const a=ports.takeda,b=ports.biogen;assert.notEqual(a.seed.batchId,b.seed.batchId);assert.notEqual(a.seed.launchChallenge,b.seed.launchChallenge);assert.notEqual(a.cfg.taskRoot,b.cfg.taskRoot);
  assert.equal(b.stats().bootstrapCalls,1);assert.equal(b.stats().prepareCalls,1);assert.equal(b.stats().launchCalls,1);assert.equal(b.stats().publishCalls,1);
  const bcontext=contexts.find(v=>v.source==='biogen'&&v.kind==='READ_PUBLICATION_CONTEXT');assert.ok(bcontext);assert.equal(bcontext.ledgerVersion,c.a==='success'?1:0);
  assert.ok(events.find(e=>e.type==='source-settled'&&e.source==='takeda').i<events.find(e=>e.type==='source-started'&&e.source==='biogen').i);
  if(c.a==='known-not-dispatched'){assert.equal(facts[0].kind,'KNOWN_NOT_DISPATCHED');assert.equal(result.results[0].result.status,'HOLD');assert.equal(result.results[0].result.knownNotDispatchedReceipt.oldFailurePreserved,true);assert.equal(result.results[0].result.knownNotDispatchedReceipt.newSuccessRecorded,false);}
  if(c.a==='not-due'){assert.equal(facts[0].kind,'NOT_DUE');assert.equal(a.stats().publishCalls,0);assert.equal(result.results[0].result.noPublicationReceipt.newSuccessRecorded,false);}
 }else{assert.equal(result.status,'GLOBAL_HOLD',JSON.stringify(result));noB();assert.equal(closed,false);assert.equal(facts.length,0);if(c.a==='pending-late'){assert.equal(pendingSeen,true);assert.equal(ports.takeda.stats().resolved,true);}}
 reports.push({name:c.name,passed:true,status:result.status,sourceResults:result.results.map(r=>({sourceId:r.sourceId,status:r.result.status,databaseStatus:r.result.databaseStatus,errors:r.result.errors,publicationCallCount:r.result.publicationCallCount,sameOriginalPromise:r.result.sameOriginalPromise,pipe:r.result.pipe})),stats:Object.fromEntries(Object.entries(ports).map(([k,p])=>[k,p.stats()])),closedKinds:facts.map(f=>f.kind),contexts,events});
 console.log(JSON.stringify({name:c.name,status:result.status,passed:true}));
}
assert.equal(fs.readFileSync(path.join(SEQUENCE,'functions-entry.js'),'utf8'),original,'SOURCE_NOT_CHANGED_DURING_TEST');
const report={kind:'ACTUAL_TWO_SOURCE_GENERATED_ENTRY_SYNTHETIC_PORT_COMPOSITION',passed:true,nodeVersion:process.version,generatedDefaultSha256:sha(original),closedDisabledEntrySha256:sha(entry),inMemorySyntheticEnabledEntrySha256:sha(bundle),originalHarnessSha256:sha(originalHarness),fixtureInputs:Object.fromEntries(Object.entries(fixturePaths).map(([k,p])=>[k,{path:p,sha256:sha(fs.readFileSync(p)),firstPublicLatestAcceptedNull:true,jobCount:fixtures[k].model.projections.length}])),coverageCount:reports.length,realToolsInvoked:0,realDatabaseCalls:0,realBrowserCalls:0,productionActivated:false,sourceBodiesCoresUiUnchanged:true,limitations:['External SQL, CLI, child terminal, UI, classification and durable receipts are synthetic; this is control-flow/authority composition, not production or original-process/filesystem acceptance.','Both first-public null contexts are fixtures. Due classification port is synthetic; actual source due boundary suites are separate.','Default-disabled/no-argument and cross-cycle capability unit tests are not included in this composition count.'],scenarios:reports};
if(reportPath)fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({kind:report.kind,passed:true,coverageCount:reports.length,generatedDefaultSha256:report.generatedDefaultSha256,closedDisabledEntrySha256:report.closedDisabledEntrySha256,realDatabaseCalls:0,realBrowserCalls:0}));
